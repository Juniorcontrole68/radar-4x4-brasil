'use strict';
// Rastreio de carga lotação: viagem que começa na base do CLIENTE (muitas vezes em outra região,
// longe da base de Americana) e um link público para quem recebe acompanhar o motorista até o
// destino. O link mostra o caminhão enquanto a viagem está ativa e para de mostrar quando a
// entrega é confirmada (botão "Entregue" no quadro, ou a coleta marcada como Entregue na Lotação).
//
// Por que existe: o servidor descartava toda posição a mais de 450 km de Americana (filtro contra
// GPS maluco) e o mapa ao vivo só desenhava pontos de SP e vizinhança. Um motorista carregando em
// Curitiba ou em Goiânia simplesmente não aparecia. Agora, enquanto houver viagem de lotação ativa
// para o motorista/placa, vale também o "corredor" entre a base do cliente e o destino.
// O aplicativo só envia GPS quando tem romaneio do dia; a viagem de lotação conta como romaneio
// para ele (ver assignment/current no server.js). Testado em tests/lotacao-rastreio.js.

const crypto=require('crypto');
const path=require('path');
const fs=require('fs');
const geo=require('./dashboard/geo-endereco');

const PAGINA_CENTRAL=path.join(__dirname,'rastreio-lotacao.html');
const PAGINA_PUBLICA=path.join(__dirname,'rastreio-publico.html');
const RAIO_PONTA_METROS=450000;          // mesmo raio que já valia em volta de Americana
const VALIDADE_DIAS=15;                  // link sem entrega confirmada para de valer sozinho
const UFS=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const limpo=(v,max=200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const placaKey=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
// Igual ao sqlNome do server.js: minúsculas, sem acento, espaços simples.
const nomeKey=v=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const clienteKey=v=>geo.norm(v);
const primeiroNome=v=>{const p=limpo(v,120).split(' ')[0]||'';return p?p[0].toUpperCase()+p.slice(1).toLowerCase():''};

function metros(a,b){
  if(!a||!b)return Infinity;
  const p={lat:Number(a.lat),lon:Number(a.lon)},q={lat:Number(b.lat),lon:Number(b.lon)};
  if(![p.lat,p.lon,q.lat,q.lon].every(Number.isFinite))return Infinity;
  return geo.haversineMeters(p,q)
}

// "-25.43, -49.27", "https://maps.google.com/?q=-25.43,-49.27", ".../@-25.43,-49.27,15z" -> {lat,lon}
function lerCoordenadas(txt){
  const s=String(txt||'');
  const m=s.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/)||s.match(/(-?\d{1,2}\.\d{3,})\s*[,; ]\s*(-?\d{1,3}\.\d{3,})/);
  if(!m)return null;
  const lat=Number(m[1]),lon=Number(m[2]);
  // Só território brasileiro (com folga): evita lat/lon invertidos ou colados errado.
  if(!(lat>=-34.5&&lat<=6&&lon>=-75&&lon<=-28))return null;
  return{lat,lon}
}

// "Rua X, 100 - Campinas - SP" / "Curitiba/PR" / "Goiânia, GO" -> {cidade,uf} quando a cidade existe
function cidadeUfDoTexto(txt){
  const partes=String(txt||'').split(/\s*(?:[-\/,|]|\bCEP\b)\s*/).map(x=>x.trim()).filter(Boolean);
  for(let i=partes.length-1;i>=1;i--){
    const uf=geo.norm(partes[i]);
    if(!UFS.includes(uf))continue;
    const c=geo.cityCentroid(partes[i-1],uf);
    if(c)return{cidade:limpo(partes[i-1],80),uf}
  }
  // Sem UF ("Rua X 54 Jandira"): as últimas palavras, se forem o nome de um município que só
  // existe em uma UF da região da operação.
  const fim=String(partes[partes.length-1]||'').split(' ').filter(Boolean);
  for(let n=Math.min(4,fim.length);n>=1;n--){
    const nome=fim.slice(-n).join(' ');
    if(/\d/.test(nome))continue;
    const c=geo.cityCentroid(nome,'');
    if(c)return{cidade:limpo(nome,80),uf:c.uf}
  }
  return null
}

// Cidade/UF digitadas na coleta (campos próprios), quando a cidade existe naquela UF.
function cidadeUfInformada(e){
  const cidade=limpo(e?.cidade,80),uf=geo.norm(e?.uf).slice(0,2);
  return cidade&&UFS.includes(uf)&&geo.cityCentroid(cidade,uf)?{cidade,uf}:null
}

// Monta um ponto (origem ou destino) a partir do que a central digitou. Prioridade: coordenada
// colada (exata) > cidade/UF informadas > cidade/UF achadas no endereço. Nunca consulta a internet.
function montarPonto(entrada){
  const e=entrada||{};
  const endereco=limpo(e.endereco,240);
  let cidade=limpo(e.cidade,80),uf=geo.norm(e.uf).slice(0,2);
  if((!cidade||!uf)&&endereco){const x=cidadeUfDoTexto(endereco);if(x){cidade=cidade||x.cidade;uf=uf||x.uf}}
  const exato=lerCoordenadas(e.coordenadas||e.localizacao||'');
  const sede=cidade&&uf?geo.cityCentroid(cidade,uf):null;
  if(!exato&&!sede)return null;
  const p=exato||sede;
  return{endereco,cidade:cidade||'',uf:uf||'',lat:Number(p.lat),lon:Number(p.lon),precisao:exato?'exata':'cidade'}
}

// Uma posição vale para a viagem se estiver perto da base do cliente, perto do destino ou no
// caminho entre os dois (elipse com folga: estrada não é linha reta).
function noTrecho(o,d,p){
  const dpo=metros(o,p),dpd=metros(p,d),dod=metros(o,d);
  if(dpo<=RAIO_PONTA_METROS||dpd<=RAIO_PONTA_METROS)return true;
  return Number.isFinite(dod)&&dpo+dpd<=dod*1.35+RAIO_PONTA_METROS
}
// Com várias entregas o caminho é base -> entrega 1 -> entrega 2 -> ...; vale qualquer trecho.
function noCorredor(v,lat,lon){
  const p={lat,lon},pontos=[{lat:v.origem_lat,lon:v.origem_lon},{lat:v.destino_lat,lon:v.destino_lon},...extrasDe(v)];
  for(let i=1;i<pontos.length;i++)if(noTrecho(pontos[i-1],pontos[i],p))return true;
  return false
}
function extrasDe(v){
  const x=typeof v?.destinos_extras==='string'?(()=>{try{return JSON.parse(v.destinos_extras)}catch{return[]}})():v?.destinos_extras;
  return(Array.isArray(x)?x:[]).filter(d=>Number.isFinite(Number(d?.lat))&&Number.isFinite(Number(d?.lon)))
}
// Todas as entregas da viagem, na ordem: a primeira é a das colunas destino_*.
function destinosDe(v,completo=true){
  const um=d=>{const o={nome:d.nome||'',cidade:d.cidade||'',uf:d.uf||'',lat:Number(d.lat),lon:Number(d.lon)};if(completo){o.endereco=d.endereco||'';o.precisao=d.precisao||'cidade'}return o};
  return[um({nome:v.destino_nome,endereco:v.destino_endereco,cidade:v.destino_cidade,uf:v.destino_uf,lat:v.destino_lat,lon:v.destino_lon,precisao:v.destino_precisao}),...extrasDe(v).map(um)]
}

// Viagens ativas em memória: o GPS chega a cada poucos segundos e não pode virar uma consulta
// a mais no banco por ponto. A lista é pequena e se renova sozinha.
let CACHE={at:0,rows:[]};
function esquecerCache(){CACHE={at:0,rows:[]}}
async function viagensAtivas(pool){
  if(Date.now()-CACHE.at<30000)return CACHE.rows;
  const q=await pool.query(`SELECT id::text AS id,client_id::text AS client_id,cliente,driver_name,vehicle_plate,origem_lat,origem_lon,destino_lat,destino_lon,destinos_extras
    FROM lotacao_rastreios WHERE status='ativo' AND expires_at>NOW()`);
  CACHE={at:Date.now(),rows:q.rows.map(r=>({...r,_placa:placaKey(r.vehicle_plate),_nome:nomeKey(r.driver_name)}))};
  return CACHE.rows
}
function daViagem(v,dev){
  const placa=placaKey(dev?.vehicle_plate),nome=nomeKey(dev?.driver_name);
  return (v._placa&&placa&&v._placa===placa)||(v._nome&&nome&&v._nome===nome)
}
async function viagemDoAparelho(pool,dev){
  const rows=await viagensAtivas(pool);
  return rows.find(v=>daViagem(v,dev))||null
}
// Usado pelo server.js no recebimento do GPS: posição fora da área de Americana ainda vale se o
// aparelho tem viagem de lotação ativa e o ponto está no corredor dela.
async function pontoValidoNaViagem(pool,dev,lat,lon){
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return false;
  const rows=(await viagensAtivas(pool)).filter(v=>daViagem(v,dev));
  return rows.some(v=>noCorredor(v,lat,lon))
}

async function ensureSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS lotacao_rastreios (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT,
    token TEXT NOT NULL UNIQUE,
    coleta_id TEXT,
    cliente TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    vehicle_plate TEXT NOT NULL DEFAULT '',
    origem_endereco TEXT NOT NULL DEFAULT '', origem_cidade TEXT NOT NULL DEFAULT '', origem_uf TEXT NOT NULL DEFAULT '',
    origem_lat DOUBLE PRECISION NOT NULL, origem_lon DOUBLE PRECISION NOT NULL, origem_precisao TEXT NOT NULL DEFAULT 'cidade',
    destino_nome TEXT NOT NULL DEFAULT '',
    destino_endereco TEXT NOT NULL DEFAULT '', destino_cidade TEXT NOT NULL DEFAULT '', destino_uf TEXT NOT NULL DEFAULT '',
    destino_lat DOUBLE PRECISION NOT NULL, destino_lon DOUBLE PRECISION NOT NULL, destino_precisao TEXT NOT NULL DEFAULT 'cidade',
    status TEXT NOT NULL DEFAULT 'ativo',
    motivo_fim TEXT,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  await pool.query("ALTER TABLE lotacao_rastreios ADD COLUMN IF NOT EXISTS destinos_extras JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_lotacao_rastreios_ativos ON lotacao_rastreios(status,created_at DESC)");
  // Base de cada cliente de lotação: digitada uma vez, sugerida nas próximas viagens.
  await pool.query(`CREATE TABLE IF NOT EXISTS lotacao_clientes_base (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT,
    cliente_key TEXT NOT NULL,
    cliente TEXT NOT NULL,
    endereco TEXT NOT NULL DEFAULT '', cidade TEXT NOT NULL DEFAULT '', uf TEXT NOT NULL DEFAULT '',
    lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL, precisao TEXT NOT NULL DEFAULT 'cidade',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_lotacao_clientes_base_key ON lotacao_clientes_base(COALESCE(client_id,0),cliente_key)");
}

// Encerra viagens cuja coleta foi marcada como Entregue (por qualquer tela) ou cujo prazo venceu.
async function fecharVencidas(pool,filtroId=null){
  const params=[];let extra='';
  if(filtroId){params.push(String(filtroId));extra=' AND r.id::text=$1'}
  const a=await pool.query(`UPDATE lotacao_rastreios r SET status='entregue',motivo_fim='coleta marcada como Entregue',ended_at=NOW()
    FROM coletas c
    WHERE r.status='ativo' AND r.coleta_id IS NOT NULL AND c.id::text=r.coleta_id AND COALESCE(to_jsonb(c)->>'status','')='Entregue'${extra}`,params).catch(()=>({rowCount:0}));
  const b=await pool.query(`UPDATE lotacao_rastreios r SET status='expirado',motivo_fim='prazo do link venceu',ended_at=NOW()
    WHERE r.status='ativo' AND r.expires_at<=NOW()${extra}`,params);
  if(a.rowCount||b.rowCount)esquecerCache()
}
async function encerrarPorColeta(pool,coletaId){
  const r=await pool.query("UPDATE lotacao_rastreios SET status='entregue',motivo_fim='coleta marcada como Entregue',ended_at=NOW() WHERE status='ativo' AND coleta_id=$1",[String(coletaId)]);
  if(r.rowCount)esquecerCache();
  return r.rowCount
}

function linkPublico(base,token){return String(base||'').replace(/\/+$/,'')+'/rastreio/'+token}

// Posições do motorista desde o início da viagem (de qualquer aparelho dele), reduzidas para
// o mapa: no máximo ~600 pontos na linha, sempre com o último.
async function trilhaDaViagem(pool,deps,v,ate=null){
  const {sqlNome,sqlPlaca}=deps;
  const q=await pool.query(`SELECT p.latitude,p.longitude,p.speed_mps,p.captured_at
    FROM driver_tracking_points p JOIN driver_tracking_devices d ON d.id=p.device_id
    WHERE p.captured_at>=$1::timestamptz AND p.captured_at<=COALESCE($4::timestamptz,NOW()+INTERVAL '5 minutes')
      AND ((COALESCE($2,'')<>'' AND ${sqlPlaca('d.vehicle_plate')}=${sqlPlaca('$2')}) OR (COALESCE($3,'')<>'' AND ${sqlNome('d.driver_name')}=${sqlNome('$3')}))
    ORDER BY p.captured_at DESC LIMIT 6000`,[v.created_at,v.vehicle_plate||'',v.driver_name||'',ate]);
  const pts=q.rows.reverse();
  const passo=Math.max(1,Math.ceil(pts.length/600));
  const linha=pts.filter((_,i)=>i%passo===0||i===pts.length-1).map(p=>[Number(Number(p.latitude).toFixed(5)),Number(Number(p.longitude).toFixed(5))]);
  return{linha,ultimo:pts[pts.length-1]||null}
}

function linhaCentral(v,base){
  return{
    id:v.id,cliente:v.cliente,coleta_id:v.coleta_id||'',driver_name:v.driver_name,vehicle_plate:v.vehicle_plate,
    origem:{endereco:v.origem_endereco,cidade:v.origem_cidade,uf:v.origem_uf,lat:v.origem_lat,lon:v.origem_lon,precisao:v.origem_precisao},
    destino:{nome:v.destino_nome,endereco:v.destino_endereco,cidade:v.destino_cidade,uf:v.destino_uf,lat:v.destino_lat,lon:v.destino_lon,precisao:v.destino_precisao},
    destinos:destinosDe(v),
    status:v.status,motivo_fim:v.motivo_fim||'',created_at:v.created_at,ended_at:v.ended_at,expires_at:v.expires_at,
    link:linkPublico(base,v.token),
    ultima_posicao:v.ultima_em?{lat:v.ultima_lat,lon:v.ultima_lon,captured_at:v.ultima_em}:null
  }
}

// Mapa ao vivo da central: cada motorista com viagem de lotação ativa ganha a base do cliente e o
// destino, para o mapa desenhar a viagem a partir de lá (e não da base de Americana).
async function anexarAoMapa(pool,rows,user,base){
  if(!Array.isArray(rows)||!rows.length)return;
  const q=await pool.query(`SELECT * FROM lotacao_rastreios WHERE status='ativo' AND expires_at>NOW()${user?.client_id?' AND client_id=$1':''}`,user?.client_id?[user.client_id]:[]);
  if(!q.rowCount)return;
  const vs=q.rows.map(v=>({...v,_placa:placaKey(v.vehicle_plate),_nome:nomeKey(v.driver_name)}));
  for(const row of rows){
    const v=vs.find(x=>daViagem(x,row));
    if(v)row.lotacao=linhaCentral(v,base)
  }
}

async function podeUsar(deps,req){
  const user=await deps.dashboardSession(req,false);
  if(!(user.is_admin||deps.dashboardHas(user,'tracking')||deps.dashboardHas(user,'lotacao')||deps.dashboardHas(user,'coletas'))){
    const e=new Error('Acesso não autorizado.');e.status=403;throw e
  }
  return user
}

const LIMITE_PUBLICO=new Map();
function publicoPermitido(req){
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim()||'?';
  const now=Date.now(),row=LIMITE_PUBLICO.get(ip)||{at:now,n:0};
  if(now-row.at>60000){row.at=now;row.n=0}
  row.n++;LIMITE_PUBLICO.set(ip,row);
  if(LIMITE_PUBLICO.size>5000)LIMITE_PUBLICO.clear();
  return row.n<=60
}

function enviarPagina(res,file,testMode){
  let html=fs.readFileSync(file,'utf8');
  if(testMode)html=html.replace(/<body([^>]*)>/i,m=>m+'<div style="position:sticky;top:0;z-index:99999;background:#b45309;color:#fff;font:600 13px Segoe UI,Arial,sans-serif;text-align:center;padding:6px 10px">AMBIENTE DE TESTE — dados fictícios, integrações desligadas</div>');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
  res.end(html)
}

async function handle(req,res,u,deps){
  const {pool,sendJson,readJsonBodyLimited,publicBase,testMode}=deps;
  const p=u.pathname;

  // ---------- público: quem tem o link acompanha o motorista até a entrega
  const pub=p.match(/^\/rastreio\/([A-Za-z0-9_-]{16,64})\/?$/);
  if(pub&&req.method==='GET'){enviarPagina(res,PAGINA_PUBLICA,testMode);return true}
  const pubApi=p.match(/^\/api\/rastreio-publico\/([A-Za-z0-9_-]{16,64})$/);
  if(pubApi&&req.method==='GET'){
    try{
      if(!publicoPermitido(req)){sendJson(res,429,{ok:false,error:'Muitas consultas. Aguarde um minuto.'});return true}
      let q=await pool.query('SELECT * FROM lotacao_rastreios WHERE token=$1 LIMIT 1',[pubApi[1]]);
      if(!q.rowCount){sendJson(res,404,{ok:false,error:'Link de rastreio não encontrado.'});return true}
      if(q.rows[0].status==='ativo'){await fecharVencidas(pool,q.rows[0].id);q=await pool.query('SELECT * FROM lotacao_rastreios WHERE id=$1',[q.rows[0].id])}
      const v=q.rows[0];
      const out={ok:true,status:v.status,cliente:v.cliente,motorista:primeiroNome(v.driver_name),placa:v.vehicle_plate,
        origem:{cidade:v.origem_cidade,uf:v.origem_uf,lat:v.origem_lat,lon:v.origem_lon},
        destino:{nome:v.destino_nome,cidade:v.destino_cidade,uf:v.destino_uf,lat:v.destino_lat,lon:v.destino_lon},
        destinos:destinosDe(v,false),
        iniciado_em:v.created_at,encerrado_em:v.ended_at,server_time:new Date().toISOString()};
      // Depois da entrega o link não mostra mais onde o motorista está.
      if(v.status==='ativo'){
        const t=await trilhaDaViagem(pool,deps,v);
        out.trilha=t.linha;
        if(t.ultimo){
          const lat=Number(t.ultimo.latitude),lon=Number(t.ultimo.longitude);
          out.posicao={lat,lon,captured_at:t.ultimo.captured_at,
            idade_segundos:Math.max(0,Math.round((Date.now()-new Date(t.ultimo.captured_at).getTime())/1000)),
            velocidade_kmh:Number.isFinite(Number(t.ultimo.speed_mps))&&t.ultimo.speed_mps!==null?Math.round(Number(t.ultimo.speed_mps)*3.6):null};
          out.distancia_destino_km=Math.round(metros({lat,lon},{lat:v.destino_lat,lon:v.destino_lon})/100)/10;
          // Distância até cada entrega (com várias, o link mostra todas)
          out.destinos.forEach(d=>{d.distancia_km=Math.round(metros({lat,lon},d)/100)/10})
        }
      }
      sendJson(res,200,out)
    }catch(e){sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar o rastreio.'})}
    return true
  }

  // ---------- central
  if(p==='/rastreio-lotacao'||p==='/rastreio-lotacao/'){
    if(req.method!=='GET')return false;
    try{await podeUsar(deps,req)}catch(e){
      if(e.status===403){res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial;padding:30px;color:#334155}h2{color:#991b1b}</style><h2>Acesso não autorizado</h2><p>Este usuário não possui permissão para o rastreio de lotação.</p>');return true}
      res.writeHead(302,{Location:'/?login=1#rastreamento','Cache-Control':'no-store'});res.end();return true
    }
    enviarPagina(res,PAGINA_CENTRAL,testMode);return true
  }

  if(p==='/api/painel/lotacao-rastreios'&&req.method==='GET'){
    try{
      const user=await podeUsar(deps,req);
      await fecharVencidas(pool);
      const cp=user.client_id?[user.client_id]:[],cw=user.client_id?'client_id=$1':'TRUE';
      const viagens=await pool.query(`SELECT r.*,lp.latitude AS ultima_lat,lp.longitude AS ultima_lon,lp.captured_at AS ultima_em
        FROM lotacao_rastreios r
        LEFT JOIN LATERAL (
          SELECT p.latitude,p.longitude,p.captured_at FROM driver_tracking_points p JOIN driver_tracking_devices d ON d.id=p.device_id
          WHERE r.status='ativo' AND p.captured_at>=r.created_at
            AND ((r.vehicle_plate<>'' AND ${deps.sqlPlaca('d.vehicle_plate')}=${deps.sqlPlaca('r.vehicle_plate')}) OR ${deps.sqlNome('d.driver_name')}=${deps.sqlNome('r.driver_name')})
          ORDER BY p.captured_at DESC LIMIT 1
        ) lp ON TRUE
        WHERE ${cw.replace('client_id','r.client_id')} AND (r.status='ativo' OR r.ended_at>=NOW()-INTERVAL '7 days')
        ORDER BY (r.status='ativo') DESC,COALESCE(r.ended_at,r.created_at) DESC LIMIT 200`,cp);
      const bases=await pool.query(`SELECT cliente,endereco,cidade,uf,lat,lon,precisao FROM lotacao_clientes_base WHERE ${cw} ORDER BY lower(cliente) LIMIT 500`,cp);
      const motoristas=await pool.query(`SELECT DISTINCT ON (lower(driver_name)) driver_name,vehicle_plate FROM driver_tracking_devices
        WHERE active=TRUE${user.client_id?' AND (client_id IS NULL OR client_id=$1)':''} ORDER BY lower(driver_name),COALESCE(last_seen_at,enrolled_at) DESC LIMIT 500`,cp);
      const coletas=await pool.query(`SELECT c.id::text AS id,
          COALESCE(to_jsonb(c)->>'os_numero',to_jsonb(c)->>'numero_os','') AS os,
          COALESCE(to_jsonb(c)->>'cliente','') AS cliente,
          COALESCE(to_jsonb(c)->>'destinatario','') AS destinatario,
          COALESCE(to_jsonb(c)->>'endereco_coleta',to_jsonb(c)->>'origem','') AS origem,
          COALESCE(to_jsonb(c)->>'endereco_entrega',to_jsonb(c)->>'destino','') AS destino,
          COALESCE(to_jsonb(c)->>'motorista','') AS motorista,
          COALESCE(to_jsonb(c)->>'placa','') AS placa,
          COALESCE(to_jsonb(c)->>'status','') AS status,
          COALESCE(to_jsonb(c)->'entregas_extras','[]'::jsonb) AS entregas_extras,
          COALESCE(to_jsonb(c)->'entrega_principal','{}'::jsonb) AS entrega_principal,
          COALESCE(to_jsonb(c)->>'data_carregamento',LEFT(COALESCE(to_jsonb(c)->>'created_at',''),10)) AS data
        FROM coletas c
        WHERE ${user.client_id?'(c.client_id=$1 OR c.client_id IS NULL)':'TRUE'} AND COALESCE(to_jsonb(c)->>'status','') NOT IN ('Entregue','Cancelada')
        ORDER BY c.id DESC LIMIT 80`,cp).catch(()=>({rows:[]}));
      sendJson(res,200,{ok:true,viagens:viagens.rows.map(v=>linhaCentral(v,publicBase)),bases:bases.rows,motoristas:motoristas.rows,coletas:coletas.rows.map(c=>{const ep=c.entrega_principal||{};return{...c,entrega_principal:undefined,origem_sugerida:cidadeUfDoTexto(c.origem),
        destino_sugerido:cidadeUfInformada(ep)||cidadeUfDoTexto(c.destino),destino_localizacao:limpo(ep.localizacao,300),
        entregas_extras:(Array.isArray(c.entregas_extras)?c.entregas_extras:[]).map(e=>({destinatario:limpo(e?.destinatario,160),endereco:limpo(e?.endereco_entrega,300),
          sugerido:cidadeUfInformada(e)||cidadeUfDoTexto(e?.endereco_entrega),localizacao:limpo(e?.localizacao,300)}))}})})
    }catch(e){sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar o rastreio de lotação.'})}
    return true
  }

  if(p==='/api/painel/lotacao-rastreios'&&req.method==='POST'){
    try{
      const user=await podeUsar(deps,req);
      const b=await readJsonBodyLimited(req,32*1024);
      const cliente=limpo(b.cliente,160),driver=limpo(b.driver_name,120),placa=placaKey(b.vehicle_plate).slice(0,10);
      if(cliente.length<2){sendJson(res,400,{ok:false,error:'Informe o cliente.'});return true}
      if(driver.length<2){sendJson(res,400,{ok:false,error:'Informe o motorista.'});return true}
      if(placa&&placa.length<7){sendJson(res,400,{ok:false,error:'Placa inválida.'});return true}
      const origem=montarPonto(b.origem),destino=montarPonto(b.destino);
      if(!origem){sendJson(res,400,{ok:false,error:'Não localizei a base do cliente. Informe cidade e UF (ex.: Curitiba / PR) ou cole a localização do Google Maps.'});return true}
      if(!destino){sendJson(res,400,{ok:false,error:'Não localizei o destino. Informe cidade e UF ou cole a localização do Google Maps.'});return true}
      const extras=[];
      for(const [i,e] of (Array.isArray(b.destinos_extras)?b.destinos_extras:[]).slice(0,10).entries()){
        if(!limpo(e?.nome)&&!limpo(e?.cidade)&&!limpo(e?.endereco)&&!limpo(e?.coordenadas))continue;
        const d=montarPonto(e);
        if(!d){sendJson(res,400,{ok:false,error:'Não localizei a entrega '+(i+2)+'. Informe cidade e UF ou cole a localização do Google Maps.'});return true}
        extras.push({nome:limpo(e.nome,160),...d})
      }
      const coletaId=/^\d{1,18}$/.test(String(b.coleta_id||''))?String(b.coleta_id):null;
      const token=crypto.randomBytes(18).toString('base64url');
      // Uma viagem ativa por motorista/placa: a nova substitui a anterior (que deixa de mostrar o caminhão).
      await pool.query(`UPDATE lotacao_rastreios SET status='cancelado',motivo_fim='substituída por nova viagem',ended_at=NOW()
        WHERE status='ativo' AND client_id IS NOT DISTINCT FROM $1 AND ((COALESCE($2,'')<>'' AND ${deps.sqlPlaca('vehicle_plate')}=${deps.sqlPlaca('$2')}) OR ${deps.sqlNome('driver_name')}=${deps.sqlNome('$3')})`,
        [user.client_id||null,placa,driver]);
      const q=await pool.query(`INSERT INTO lotacao_rastreios(client_id,token,coleta_id,cliente,driver_name,vehicle_plate,
          origem_endereco,origem_cidade,origem_uf,origem_lat,origem_lon,origem_precisao,
          destino_nome,destino_endereco,destino_cidade,destino_uf,destino_lat,destino_lon,destino_precisao,created_by,expires_at,destinos_extras)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW()+($21*INTERVAL '1 day'),$22::jsonb) RETURNING *`,
        [user.client_id||null,token,coletaId,cliente,driver,placa,
         origem.endereco,origem.cidade,origem.uf,origem.lat,origem.lon,origem.precisao,
         limpo(b.destino?.nome,160),destino.endereco,destino.cidade,destino.uf,destino.lat,destino.lon,destino.precisao,
         /^\d+$/.test(String(user.id||''))?user.id:null,VALIDADE_DIAS,JSON.stringify(extras)]);
      await pool.query(`INSERT INTO lotacao_clientes_base(client_id,cliente_key,cliente,endereco,cidade,uf,lat,lon,precisao)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (COALESCE(client_id,0),cliente_key) DO UPDATE SET cliente=EXCLUDED.cliente,endereco=EXCLUDED.endereco,cidade=EXCLUDED.cidade,uf=EXCLUDED.uf,lat=EXCLUDED.lat,lon=EXCLUDED.lon,precisao=EXCLUDED.precisao,updated_at=NOW()`,
        [user.client_id||null,clienteKey(cliente),cliente,origem.endereco,origem.cidade,origem.uf,origem.lat,origem.lon,origem.precisao]);
      esquecerCache();
      console.log('LOTACAO RASTREIO CRIADO: '+JSON.stringify({id:q.rows[0].id,cliente,driver,placa,origem:origem.cidade+'/'+origem.uf,destino:destino.cidade+'/'+destino.uf,entregas:1+extras.length}));
      sendJson(res,201,{ok:true,viagem:linhaCentral(q.rows[0],publicBase)})
    }catch(e){sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao criar o rastreio.'})}
    return true
  }

  const acao=p.match(/^\/api\/painel\/lotacao-rastreios\/(\d+)\/(entregue|cancelar)$/);
  if(acao&&req.method==='POST'){
    try{
      const user=await podeUsar(deps,req);
      const [status,motivo]=acao[2]==='entregue'?['entregue','entrega confirmada pela central']:['cancelado','cancelado pela central'];
      const params=[status,motivo,acao[1]];
      let where="id=$3 AND status='ativo'";
      if(user.client_id){params.push(user.client_id);where+=' AND client_id=$4'}
      const q=await pool.query(`UPDATE lotacao_rastreios SET status=$1,motivo_fim=$2,ended_at=NOW() WHERE ${where} RETURNING *`,params);
      if(!q.rowCount){sendJson(res,404,{ok:false,error:'Viagem não encontrada ou já encerrada.'});return true}
      esquecerCache();
      sendJson(res,200,{ok:true,viagem:linhaCentral(q.rows[0],publicBase)})
    }catch(e){sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao encerrar o rastreio.'})}
    return true
  }
  return false
}

module.exports={ensureSchema,handle,anexarAoMapa,pontoValidoNaViagem,viagemDoAparelho,encerrarPorColeta,esquecerCache,
  lerCoordenadas,cidadeUfDoTexto,montarPonto,noCorredor};
