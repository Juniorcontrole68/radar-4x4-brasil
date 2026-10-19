'use strict';
// Comprovante de entrega: o motorista marca no MOVIT (rota do dia) que entregou, com foto, ou que
// não conseguiu entregar, com o motivo. A central vê os comprovantes em /entregas.
//
// A parada é identificada pela "chave" (CT-e, NF ou posição), porque a rota do dia é montada na hora
// a partir do SSW ou da carga enviada e não tem id próprio no banco. O app manda a chave de volta
// junto com o comprovante; a rota do dia (/api/router-app/company/today) mostra o que já foi feito.
//
// O celular pode ficar sem sinal: ele guarda o comprovante e reenvia depois. O client_uuid (gerado
// no celular) faz o reenvio não duplicar. Testado em tests/entregas.js.

const fs=require('fs');
const path=require('path');

const PAGINA_CENTRAL=path.join(__dirname,'entregas.html');
const FOTO_MAX=600*1024,MINI_MAX=80*1024;
const MOTIVOS={ausente:'Destinatário ausente',recusou:'Recusou a mercadoria',endereco_errado:'Endereço não encontrado',fechado:'Local fechado',avaria:'Mercadoria avariada',outro:'Outro motivo'};
const ONDE={em_maos:'Em mãos',portaria:'Portaria / recepção',vizinho:'Vizinho',doca:'Doca / almoxarifado',outro:'Outro'};

const limpo=(v,max=200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);

// Mesma regra no servidor e no app: a chave sai daqui e o app só a devolve.
function chaveParada(s){
  const ctrc=limpo(s?.ctrc,40).toUpperCase(),nf=limpo(s?.nf,40).replace(/^0+/,'');
  if(ctrc)return 'ctrc:'+ctrc;
  if(nf)return 'nf:'+nf+(limpo(s?.romaneio,40)?'@'+limpo(s.romaneio,40).toUpperCase():'');
  const lat=num(s?.lat),lon=num(s?.lon);
  if(lat!==null&&lon!==null)return 'pos:'+lat.toFixed(5)+','+lon.toFixed(5);
  return ''
}

function metros(a,b){
  const R=6371000,rad=x=>x*Math.PI/180;
  const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return Math.round(2*R*Math.asin(Math.sqrt(h)))
}

// "data:image/jpeg;base64,..." ou só o base64 -> Buffer de JPEG/PNG/WebP, conferindo o conteúdo.
function lerImagem(v,max){
  const s=String(v||'');
  if(!s)return null;
  const m=s.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
  const buf=Buffer.from(m?m[2]:s,'base64');
  if(!buf.length||buf.length>max)return{erro:true};
  const mime=buf[0]===0xFF&&buf[1]===0xD8?'image/jpeg':buf[0]===0x89&&buf[1]===0x50?'image/png':buf.slice(0,4).toString()==='RIFF'&&buf.slice(8,12).toString()==='WEBP'?'image/webp':'';
  if(!mime)return{erro:true};
  return{mime,buf}
}

const spHoje=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
function dataValida(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))return false;
  // Comprovante guardado no celular sem sinal pode chegar até 3 dias depois.
  const d=new Date(s+'T12:00:00Z').getTime(),h=new Date(spHoje()+'T12:00:00Z').getTime();
  return Number.isFinite(d)&&d<=h&&h-d<=3*86400000
}

async function ensureSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS entregas_comprovantes (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT,
    client_uuid TEXT NOT NULL UNIQUE,
    link_id BIGINT,
    work_date DATE NOT NULL,
    driver_name TEXT NOT NULL,
    vehicle_plate TEXT NOT NULL DEFAULT '',
    chave TEXT NOT NULL,
    seq INTEGER,
    romaneio TEXT NOT NULL DEFAULT '',
    ctrc TEXT NOT NULL DEFAULT '',
    nf TEXT NOT NULL DEFAULT '',
    destinatario TEXT NOT NULL DEFAULT '',
    endereco TEXT NOT NULL DEFAULT '',
    parada_lat DOUBLE PRECISION, parada_lon DOUBLE PRECISION,
    resultado TEXT NOT NULL CHECK (resultado IN ('entregue','falhou')),
    motivo_falha TEXT CHECK (motivo_falha IS NULL OR motivo_falha IN ('ausente','recusou','endereco_errado','fechado','avaria','outro')),
    recebedor_nome TEXT NOT NULL DEFAULT '',
    onde_deixou TEXT CHECK (onde_deixou IS NULL OR onde_deixou IN ('em_maos','portaria','vizinho','doca','outro')),
    observacao TEXT NOT NULL DEFAULT '',
    lat DOUBLE PRECISION, lon DOUBLE PRECISION,
    distancia_m INTEGER,
    registrado_em TIMESTAMPTZ NOT NULL,
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT falha_tem_motivo CHECK (resultado<>'falhou' OR motivo_falha IS NOT NULL)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_entregas_comprovantes_dia ON entregas_comprovantes (work_date,client_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_entregas_comprovantes_motorista ON entregas_comprovantes (work_date,lower(driver_name))');
  await pool.query(`CREATE TABLE IF NOT EXISTS entregas_comprovante_arquivos (
    id BIGSERIAL PRIMARY KEY,
    comprovante_id BIGINT NOT NULL REFERENCES entregas_comprovantes(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('foto','miniatura','assinatura')),
    mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
    arquivo BYTEA NOT NULL,
    bytes INTEGER NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_entregas_arquivos_comprovante ON entregas_comprovante_arquivos (comprovante_id)');
}

// Rota do dia do MOVIT: marca nas paradas o que já tem comprovante. Chamado a cada resposta
// (a rota fica em cache por alguns minutos, o comprovante tem de aparecer na hora).
async function marcarNoDia(pool,deps,link,dia){
  if(!dia||!Array.isArray(dia.stops)||!dia.stops.length)return dia;
  const q=await pool.query(`SELECT DISTINCT ON (chave) chave,resultado,motivo_falha,registrado_em FROM entregas_comprovantes
    WHERE work_date=$1::date AND (link_id=$2 OR ${deps.sqlNome('driver_name')}=${deps.sqlNome('$3')})
    ORDER BY chave,registrado_em DESC`,[dia.date||spHoje(),link.id,link.driver_name]);
  const por=new Map(q.rows.map(r=>[r.chave,r]));
  const hm=t=>new Date(t).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
  return{...dia,stops:dia.stops.map(s=>{
    const chave=chaveParada(s),c=chave&&por.get(chave);
    const out={...s,chave};
    if(c){
      out.comprovante={resultado:c.resultado,motivo:c.motivo_falha||'',hora:hm(c.registrado_em)};
      if(c.resultado==='entregue'){out.entregue=true;out.baixaAt=out.baixaAt||hm(c.registrado_em)}
      else{out.falhou=true;out.motivoFalha=MOTIVOS[c.motivo_falha]||'Não entregue'}
    }
    return out
  })}
}

async function podeVer(deps,req){
  const user=await deps.dashboardSession(req,false);
  if(!(user.is_admin||deps.dashboardHas(user,'tracking')||deps.dashboardHas(user,'montar_carga'))){
    const e=new Error('Acesso não autorizado.');e.status=403;throw e
  }
  return user
}

// Comprovante sem empresa (client_id NULL) é da operação própria: aparece para a CONSTRULOG,
// nunca para as outras empresas da Torre.
function filtroEmpresa(user,params){
  if(!user.client_id)return '';
  params.push(user.client_id);
  const casa=String(user.client?.slug||'').toLowerCase()==='construlog';
  return casa?` AND (c.client_id=$${params.length} OR c.client_id IS NULL)`:` AND c.client_id=$${params.length}`
}

function enviarPagina(res,testMode){
  let html=fs.readFileSync(PAGINA_CENTRAL,'utf8');
  if(testMode)html=html.replace(/<body([^>]*)>/i,m=>m+'<div style="position:sticky;top:0;z-index:99999;background:#b45309;color:#fff;font:600 13px Segoe UI,Arial,sans-serif;text-align:center;padding:6px 10px">AMBIENTE DE TESTE — dados fictícios, integrações desligadas</div>');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
  res.end(html)
}

async function handle(req,res,u,deps){
  const {pool,sendJson,readJsonBodyLimited,testMode}=deps;
  const p=u.pathname;

  // ---------- app MOVIT: motorista registra a entrega
  if(p==='/api/router-app/company/comprovante'&&req.method==='POST'){
    try{
      const link=await deps.movitCompanyLinkFromReq(req);
      const b=await readJsonBodyLimited(req,1536*1024);
      const uuid=String(b.client_uuid||'');
      if(!/^[A-Za-z0-9-]{8,64}$/.test(uuid)){sendJson(res,400,{ok:false,error:'Identificador do comprovante inválido.'});return true}
      const workDate=String(b.work_date||spHoje());
      if(!dataValida(workDate)){sendJson(res,400,{ok:false,error:'Data da entrega inválida.'});return true}
      const s=b.stop&&typeof b.stop==='object'?b.stop:{};
      const chave=chaveParada(s);
      if(!chave){sendJson(res,400,{ok:false,error:'Parada sem identificação.'});return true}
      const resultado=b.resultado==='falhou'?'falhou':b.resultado==='entregue'?'entregue':'';
      if(!resultado){sendJson(res,400,{ok:false,error:'Informe se a entrega foi feita.'});return true}
      const motivo=resultado==='falhou'?String(b.motivo||''):null;
      if(resultado==='falhou'&&!MOTIVOS[motivo]){sendJson(res,400,{ok:false,error:'Informe o motivo de não ter entregue.'});return true}
      const onde=resultado==='entregue'&&ONDE[b.onde_deixou]?b.onde_deixou:null;
      const foto=lerImagem(b.foto,FOTO_MAX),mini=lerImagem(b.miniatura,MINI_MAX);
      if(foto?.erro||mini?.erro){sendJson(res,400,{ok:false,error:'Foto inválida ou grande demais.'});return true}
      if(resultado==='entregue'&&!foto){sendJson(res,400,{ok:false,error:'Tire a foto da entrega.'});return true}
      const lat=num(b.lat),lon=num(b.lon),plat=num(s.lat),plon=num(s.lon);
      const gpsOk=lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
      const dist=gpsOk&&plat!==null&&plon!==null?metros({lat,lon},{lat:plat,lon:plon}):null;
      let quando=new Date(b.registrado_em||Date.now());
      if(!Number.isFinite(quando.getTime())||quando.getTime()>Date.now()+5*60000)quando=new Date();

      // Empresa do aparelho (CONSTRULOG = NULL). Vínculo de simulação não tem aparelho.
      const cli=await pool.query('SELECT d.client_id FROM router_company_links l LEFT JOIN driver_tracking_devices d ON d.id=l.device_id WHERE l.id=$1',[link.id]).catch(()=>({rows:[]}));
      const clientId=cli.rows[0]?.client_id||null;

      const client=await pool.connect();
      let id,duplicado=false;
      try{
        await client.query('BEGIN');
        const ins=await client.query(`INSERT INTO entregas_comprovantes(client_id,client_uuid,link_id,work_date,driver_name,vehicle_plate,chave,seq,romaneio,ctrc,nf,
            destinatario,endereco,parada_lat,parada_lon,resultado,motivo_falha,recebedor_nome,onde_deixou,observacao,lat,lon,distancia_m,registrado_em)
          VALUES($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
          ON CONFLICT (client_uuid) DO NOTHING RETURNING id::text AS id`,
          [clientId,uuid,link.id,workDate,link.driver_name,link.vehicle_plate||'',chave,Number.isInteger(Number(s.seq))?Number(s.seq):null,
           limpo(s.romaneio,40),limpo(s.ctrc,40),limpo(s.nf,40),limpo(s.destinatario||s.label,160),limpo(s.resolved,300),plat,plon,
           resultado,motivo,limpo(b.recebedor_nome,120),onde,limpo(b.observacao,500),gpsOk?lat:null,gpsOk?lon:null,dist,quando.toISOString()]);
        if(!ins.rowCount){
          duplicado=true;
          id=(await client.query('SELECT id::text AS id FROM entregas_comprovantes WHERE client_uuid=$1',[uuid])).rows[0]?.id
        }else{
          id=ins.rows[0].id;
          for(const [tipo,img] of [['foto',foto],['miniatura',mini]])if(img)
            await client.query('INSERT INTO entregas_comprovante_arquivos(comprovante_id,tipo,mime,arquivo,bytes) VALUES($1,$2,$3,$4,$5)',[id,tipo,img.mime,img.buf,img.buf.length]);
        }
        await client.query('COMMIT')
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
      if(!duplicado)console.log('ENTREGA COMPROVANTE: '+JSON.stringify({id,motorista:link.driver_name,chave,resultado,motivo,dist,foto:foto?foto.buf.length:0}));
      sendJson(res,duplicado?200:201,{ok:true,id,duplicado,chave,resultado})
    }catch(e){sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao registrar a entrega.'})}
    return true
  }

  // ---------- central
  if(p==='/entregas'||p==='/entregas/'){
    if(req.method!=='GET')return false;
    try{await podeVer(deps,req)}catch(e){
      if(e.status===403){res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial;padding:30px;color:#334155}h2{color:#991b1b}</style><h2>Acesso não autorizado</h2><p>Este usuário não possui permissão para ver os comprovantes de entrega.</p>');return true}
      res.writeHead(302,{Location:'/?login=1','Cache-Control':'no-store'});res.end();return true
    }
    enviarPagina(res,testMode);return true
  }

  if(p==='/api/painel/entregas'&&req.method==='GET'){
    try{
      const user=await podeVer(deps,req);
      const data=/^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('data')||'')?u.searchParams.get('data'):spHoje();
      const params=[data],filtro=filtroEmpresa(user,params);
      const q=await pool.query(`SELECT c.id::text AS id,c.driver_name,c.vehicle_plate,c.seq,c.romaneio,c.ctrc,c.nf,c.destinatario,c.endereco,c.resultado,c.motivo_falha,
          c.recebedor_nome,c.onde_deixou,c.observacao,c.distancia_m,c.registrado_em,c.recebido_em,
          (SELECT a.id::text FROM entregas_comprovante_arquivos a WHERE a.comprovante_id=c.id AND a.tipo='foto' ORDER BY a.id LIMIT 1) AS foto_id,
          (SELECT a.id::text FROM entregas_comprovante_arquivos a WHERE a.comprovante_id=c.id AND a.tipo='miniatura' ORDER BY a.id LIMIT 1) AS mini_id
        FROM entregas_comprovantes c WHERE c.work_date=$1::date${filtro}
        ORDER BY lower(c.driver_name),c.registrado_em DESC LIMIT 2000`,params);
      sendJson(res,200,{ok:true,data,rows:q.rows.map(r=>({...r,motivo_texto:r.motivo_falha?MOTIVOS[r.motivo_falha]:'',onde_texto:r.onde_deixou?ONDE[r.onde_deixou]:''}))})
    }catch(e){sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar os comprovantes.'})}
    return true
  }

  const arq=p.match(/^\/api\/painel\/entregas\/arquivo\/(\d{1,18})$/);
  if(arq&&req.method==='GET'){
    try{
      const user=await podeVer(deps,req);
      const params=[arq[1]],filtro=filtroEmpresa(user,params);
      const q=await pool.query(`SELECT a.mime,a.arquivo FROM entregas_comprovante_arquivos a JOIN entregas_comprovantes c ON c.id=a.comprovante_id WHERE a.id=$1${filtro}`,params);
      if(!q.rowCount){sendJson(res,404,{ok:false,error:'Foto não encontrada.'});return true}
      // A foto não muda depois de gravada: o navegador guarda e não baixa de novo (banda do Render).
      res.writeHead(200,{'Content-Type':q.rows[0].mime,'Content-Length':q.rows[0].arquivo.length,'Cache-Control':'private, max-age=604800, immutable','X-Content-Type-Options':'nosniff'});
      res.end(q.rows[0].arquivo)
    }catch(e){sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao abrir a foto.'})}
    return true
  }
  return false
}

module.exports={ensureSchema,handle,marcarNoDia,chaveParada,lerImagem,dataValida,MOTIVOS,ONDE};
