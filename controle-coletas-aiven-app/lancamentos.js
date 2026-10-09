'use strict';
// Lançamentos da operação (um romaneio por linha): substitui a aba de lançamentos da planilha
// "Controle de Entregas". Cada linha guarda os mesmos títulos de coluna da planilha em `dados`,
// para os painéis lerem do sistema sem mudar nada do que já calculam.
//   origem 'sistema'  = lançado no card Lançamentos
//   origem 'planilha' = histórico copiado da planilha (botão do administrador)
// A fonte dos painéis fica em operacao_config('fonte'): 'planilha' até o histórico ser trazido,
// 'sistema' depois. Testado em tests/lancamentos.js.

const COLUNAS=['Data','Motorista','Veiculo','Filial','Romaneio','Operação','Entregas','Realizadas','Pend','Pend Reali','Retorno','KM','Valor KM','Frete Comb','Desc.','Frete Mot Liq','Frete Vialog','Desc','Frete Vialog Liq','Conferente','Erros','Rota','Ajudante','VAlor','HORARIO PROGR','HORÁRIO CHEGADA','INICIO CARREGA','TERMINO CARREGA'];
const OPERACOES=['MATCOM','ECOM','MATCOM/ECOM'];

const limpo=(v,max=200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
// "1.704,05" / " 550,00 " / "1704.05" / 550 -> número (NaN quando não é número)
function numero(v){
  if(typeof v==='number')return v;
  let s=String(v??'').replace(/R\$/gi,'').replace(/\s/g,'');
  if(!s||s==='-')return NaN;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  else if(/^-?\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');   // "1.200" digitado como mil e duzentos
  return/^-?\d+(\.\d+)?$/.test(s)?Number(s):NaN
}
const dinheiro=n=>Number.isFinite(n)?n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'';
const inteiro=n=>Number.isFinite(n)?String(Math.round(n)):'';
// "09/10/2026" ou "2026-10-09" -> "2026-10-09" ('' quando não é data)
function dataIso(v){
  const s=String(v??'').trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m)return m[1]+'-'+m[2]+'-'+m[3];
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if(!m)return'';
  const y=m[3].length===2?'20'+m[3]:m[3],d=m[1].padStart(2,'0'),mo=m[2].padStart(2,'0');
  const t=new Date(y+'-'+mo+'-'+d+'T12:00:00Z');
  return(!isNaN(t)&&t.getUTCDate()===Number(d)&&t.getUTCMonth()+1===Number(mo))?y+'-'+mo+'-'+d:''
}
const dataBr=iso=>{const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:''};
// Mesmo romaneio escrito de jeitos diferentes: "AMR001061-8", "1061-8", "10618" -> "10618"
function romaneioKey(v){
  const s=String(v??'').toUpperCase().trim();
  const m=s.match(/(\d+)\s*-\s*(\d)\s*$/);
  if(m)return String(Number(m[1]))+m[2];
  const d=s.replace(/\D/g,'');
  return d?String(Number(d)):''
}
// Como a operação escreve o romaneio na planilha: sem a sigla e sem os zeros ("1061-8")
function romaneioCurto(v){
  const s=String(v??'').toUpperCase().trim();
  const m=s.match(/(\d+)\s*-\s*(\d)\s*$/);
  return m?String(Number(m[1]))+'-'+m[2]:limpo(s,40)
}
// Frete líquido da Construlog = frete do romaneio menos o frete das entregas não feitas.
// Aqui: a soma do frete dos CT-es (fretes: {ctrc: valor}) que não estão entre os entregues.
function freteNaoEntregue(fretes,entregues){
  const feitos=entregues instanceof Set?entregues:new Set(entregues||[]);
  let soma=0;
  for(const[ct,v]of Object.entries(fretes||{}))if(!feitos.has(ct))soma+=Number(v||0);
  return Math.round(soma*100)/100
}
// Situação de cada entrega (CT-e) do romaneio: 'e' entregue (ocorrência 01), 'o' outra ocorrência,
// 'p' ainda sem baixa, '?' o sistema não achou a entrega no acompanhamento do SSW.
// Regra da Construlog: tudo o que não for "mercadoria entregue" é descontado do frete do romaneio.
// As sem informação ficam de fora do desconto (não dá para afirmar que não foram entregues).
function contasDasEntregas(ctes){
  let feitas=0,naoFeitas=0,semInfo=0,desconto=0,semBaixa=0;
  for(const x of ctes||[]){
    if(x.s==='e')feitas++;
    else if(x.s==='o'||x.s==='p'){naoFeitas++;if(x.s==='p')semBaixa++;desconto+=Number(x.f||0)}
    else semInfo++
  }
  return{total:(ctes||[]).length,feitas,naoFeitas,semBaixa,semInfo,desconto:Math.round(desconto*100)/100}
}
// Motorista com mais de um romaneio no mesmo dia = um lançamento só (o valor pago é um só):
// os romaneios aparecem lado a lado e entregas, frete e cidades são somados.
const PIOR={pendente:4,erro:3,parcial:2,ok:1};
function juntar(rs){
  rs=rs.slice().sort((a,b)=>(Number(romaneioKey(a.romaneio))||0)-(Number(romaneioKey(b.romaneio))||0)||Number(a.id)-Number(b.id));
  const p=rs[0];
  if(rs.length===1)return{...p,ids:[p.id],partes:null,km_soma:false};
  const prim=f=>{for(const r of rs){const v=f(r);if(v!==null&&v!==undefined&&v!=='')return v}return null};
  const soma=f=>{let t=null;for(const r of rs){const v=f(r);if(v!==null&&v!==undefined)t=(t||0)+Number(v)}return t===null?null:Math.round(t*100)/100};
  const valor=prim(r=>r.valor),desconto=prim(r=>r.desconto);
  // km da rota única com as entregas de todos os romaneios (calculado à parte); enquanto não vem, a soma das rotas
  const keys=rs.map(r=>romaneioKey(r.romaneio)).sort().join(',');
  const cj=p.conjunto&&p.conjunto.keys===keys&&Number(p.conjunto.km)>0?Number(p.conjunto.km):null;
  const cid=new Map();
  for(const r of rs)for(const c of (r.cidades||String(r.rota||'').split(',').map(x=>({c:x.trim(),n:0}))))if(c.c)cid.set(c.c,(cid.get(c.c)||0)+Number(c.n||0));
  const status=rs.map(r=>r.calculo?.status||'pendente').sort((a,b)=>(PIOR[b]||0)-(PIOR[a]||0))[0];
  const frete=soma(r=>r.frete_vialog),descV=soma(r=>r.desconto_vialog);
  return{
    ...p,ids:rs.map(r=>r.id),
    romaneio:rs.map(r=>r.romaneio).join(' / '),romaneio_ssw:rs.map(r=>r.romaneio_ssw).filter(Boolean).join(' / '),
    veiculo_tipo:prim(r=>r.veiculo_tipo)||'',placa:prim(r=>r.placa)||'',filial:prim(r=>r.filial)||'',operacao:prim(r=>r.operacao)||'',conferente:prim(r=>r.conferente)||'',
    erros:soma(r=>r.erros),entregas:soma(r=>r.entregas),realizadas:rs.every(r=>r.realizadas!==null)?soma(r=>r.realizadas):null,pend:soma(r=>r.pend),retorno:soma(r=>r.retorno),
    km:cj??soma(r=>r.km),km_soma:cj===null&&rs.filter(r=>r.km).length>1,
    valor,desconto,frete_mot_liq:valor===null?null:Math.round((valor-(desconto||0))*100)/100,
    frete_vialog:frete,desconto_vialog:descV,frete_vialog_liq:frete===null?null:Math.round((frete-(descV||0))*100)/100,
    rota:[...cid.keys()].join(','),cidades:[...cid].map(([c,n])=>({c,n})),
    ctes:rs.some(r=>r.ctes)?rs.flatMap(r=>(r.ctes||[]).map(x=>({...x,r:r.romaneio}))):null,
    ao_vivo:rs.some(r=>r.realizadas!==null||r.ao_vivo!==null)?rs.reduce((t,r)=>t+Number(r.realizadas??r.ao_vivo??0),0):null,
    auto:rs.every(r=>r.auto),
    calculo:{status,msg:rs.map(r=>r.calculo?.msg?r.romaneio+': '+r.calculo.msg:'').filter(Boolean).join(' • ').slice(0,500),fechado:rs.every(r=>r.calculo?.fechado),tentativas:Math.max(...rs.map(r=>Number(r.calculo?.tentativas||0)))},
    partes:rs.map(r=>({id:r.id,romaneio:r.romaneio,romaneio_ssw:r.romaneio_ssw,entregas:r.entregas,km:r.km,frete_vialog:r.frete_vialog,status:r.calculo?.status||''})),
    conjunto:undefined
  }
}
function agrupar(lista){
  const grupos=new Map();
  for(const r of lista){
    const m=limpo(r.motorista,120).toUpperCase();
    const k=r.origem==='sistema'&&m&&m!=='SEM MOTORISTA'?r.data+'|'+m:'#'+r.id;
    if(!grupos.has(k))grupos.set(k,[]);
    grupos.get(k).push(r)
  }
  return[...grupos.values()].map(juntar).sort((a,b)=>a.data.localeCompare(b.data)||(Number(romaneioKey(a.partes?a.partes[0].romaneio:a.romaneio))||0)-(Number(romaneioKey(b.partes?b.partes[0].romaneio:b.romaneio))||0)||Number(a.id)-Number(b.id))
}
// Campos de um lançamento (um romaneio ou vários do mesmo motorista) para virar linha da planilha.
const camposDoGrupo=g=>({data:g.data,motorista:g.motorista,veiculo_tipo:g.veiculo_tipo,filial:g.filial,romaneio:g.romaneio,operacao:g.operacao,entregas:g.entregas,realizadas:g.realizadas,
  pend:g.pend,retorno:g.retorno,km:g.km,valor:g.valor,desconto:g.desconto,frete_vialog:g.frete_vialog,desconto_vialog:g.desconto_vialog,conferente:g.conferente,erros:g.erros,rota:g.rota});
const dataLinha=r=>dataIso(r?.Data||r?.DATA||r?.ENTREGUE||r?.Entregue||r?.['  Data']||'');

// Linha no formato da planilha a partir dos campos do lançamento do sistema.
function montarDados(c){
  const comb=numero(c.valor),desc=numero(c.desconto),vialog=numero(c.frete_vialog),descV=numero(c.desconto_vialog);
  const liq=Number.isFinite(comb)?comb-(Number.isFinite(desc)?desc:0):NaN;
  const vliq=Number.isFinite(vialog)?vialog-(Number.isFinite(descV)?descV:0):NaN;
  const km=numero(c.km);
  const o={};for(const k of COLUNAS)o[k]='';
  Object.assign(o,{
    'Data':dataBr(c.data),'Motorista':limpo(c.motorista,120).toUpperCase(),'Veiculo':limpo(c.veiculo_tipo,40).toUpperCase(),'Filial':limpo(c.filial,10).toUpperCase(),
    'Romaneio':limpo(c.romaneio,80),'Operação':limpo(c.operacao,40).toUpperCase(),
    'Entregas':inteiro(numero(c.entregas)),'Realizadas':inteiro(numero(c.realizadas)),'Pend':inteiro(numero(c.pend)),'Retorno':inteiro(numero(c.retorno)),
    'KM':inteiro(km),'Valor KM':(Number.isFinite(liq)&&km>0)?dinheiro(liq/km):'',
    'Frete Comb':dinheiro(comb),'Desc.':Number.isFinite(desc)&&desc?dinheiro(desc):'','Frete Mot Liq':dinheiro(liq),
    'Frete Vialog':dinheiro(vialog),'Desc':Number.isFinite(descV)&&descV?dinheiro(descV):'','Frete Vialog Liq':dinheiro(vliq),
    'Conferente':limpo(c.conferente,80).toUpperCase(),'Erros':inteiro(numero(c.erros)),'Rota':limpo(c.rota,600).toUpperCase()
  });
  return o
}
// O contrário: o que o card mostra, tirado da linha guardada.
function resumir(row){
  const d=row.dados||{},s=row.ssw||{};
  const n=k=>{const x=numero(d[k]);return Number.isFinite(x)?x:null};
  return{
    id:String(row.id),origem:row.origem,data:row.event_date||dataLinha(d),romaneio:row.romaneio||limpo(d.Romaneio,40),romaneio_ssw:s.romaneio_ssw||'',
    motorista:row.motorista||limpo(d.Motorista,120),veiculo_tipo:limpo(d.Veiculo,40),placa:s.placa||'',filial:limpo(d.Filial,10),operacao:limpo(d['Operação'],40),
    entregas:n('Entregas'),realizadas:n('Realizadas'),pend:n('Pend'),retorno:n('Retorno'),km:n('KM'),
    valor:n('Frete Comb'),desconto:n('Desc.'),frete_mot_liq:n('Frete Mot Liq'),
    // frete Construlog (na planilha a coluna se chama "Frete Vialog"): o frete do romaneio; o líquido desconta o frete das entregas não feitas
    frete_vialog:n('Frete Vialog'),desconto_vialog:n('Desc'),frete_vialog_liq:n('Frete Vialog Liq'),
    conferente:limpo(d.Conferente,80),erros:n('Erros'),rota:limpo(d.Rota,600),
    // durante o dia as baixas ficam só aqui; a coluna Realizadas só é gravada com o dia fechado (os
    // painéis tratam Realizadas em branco como "ainda sem fechamento")
    ao_vivo:Number.isFinite(Number(s.calculo?.ao_vivo))&&s.calculo?.ao_vivo!==null?Number(s.calculo.ao_vivo):null,
    // auto = a linha entrou sozinha, a partir do romaneio feito no SSW (o usuário só informa o valor)
    auto:!!s.auto,cidades:Array.isArray(s.cidades)?s.cidades:null,
    // entregas do romaneio, uma a uma (frete e situação), e o km da rota única quando o motorista tem mais de um romaneio
    ctes:Array.isArray(s.ctes)?s.ctes:null,conjunto:s.conjunto||null,
    calculo:s.calculo||null,criado_por:row.created_by||'',atualizado_em:row.updated_at||null
  }
}
// Campos do lançamento a partir da linha guardada (para regravar depois de uma alteração).
function campos(row){
  const r=resumir(row),s=row.ssw||{};
  return{data:r.data,motorista:r.motorista,veiculo_tipo:r.veiculo_tipo,filial:r.filial,romaneio:r.romaneio,operacao:r.operacao,entregas:r.entregas,realizadas:r.realizadas,
    pend:r.pend,retorno:r.retorno,km:r.km,valor:r.valor,desconto:r.desconto,frete_vialog:r.frete_vialog,desconto_vialog:r.desconto_vialog,conferente:r.conferente,erros:r.erros,rota:r.rota,
    placa:s.placa||'',romaneio_ssw:s.romaneio_ssw||''}
}

async function ensureSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS operacao_lancamentos (
    id BIGSERIAL PRIMARY KEY,
    origem TEXT NOT NULL DEFAULT 'sistema',
    event_date DATE,
    romaneio TEXT NOT NULL DEFAULT '',
    romaneio_key TEXT NOT NULL DEFAULT '',
    motorista TEXT NOT NULL DEFAULT '',
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    ssw JSONB NOT NULL DEFAULT '{}'::jsonb,
    linha INTEGER,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_operacao_lancamentos_sistema ON operacao_lancamentos(romaneio_key) WHERE origem='sistema' AND romaneio_key<>''");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_operacao_lancamentos_data ON operacao_lancamentos(event_date)');
  await pool.query(`CREATE TABLE IF NOT EXISTS operacao_config (
    chave TEXT PRIMARY KEY,
    valor JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
}
const SEL="SELECT id::text AS id,origem,to_char(event_date,'YYYY-MM-DD') AS event_date,romaneio,romaneio_key,motorista,dados,ssw,linha,created_by,updated_at FROM operacao_lancamentos";
async function fonteAtual(pool){
  const q=await pool.query("SELECT valor FROM operacao_config WHERE chave='fonte' LIMIT 1");
  const v=q.rows[0]?.valor||{};
  return{fonte:v.fonte==='sistema'?'sistema':'planilha',importado_em:v.importado_em||null,importado_por:v.importado_por||'',linhas_importadas:Number(v.linhas_importadas||0)}
}

// Romaneios cujo lançamento foi excluído pelo usuário: o sistema não recria sozinho (só pelo formulário).
async function lerIgnorados(pool){
  const q=await pool.query("SELECT valor FROM operacao_config WHERE chave='ignorados' LIMIT 1");
  const k=q.rows[0]?.valor?.keys;
  return k&&typeof k==='object'?k:{}
}
async function gravarIgnorados(pool,keys){
  const limite=new Date(Date.now()-15*864e5).toISOString(),limpo2={};
  for(const[k,em]of Object.entries(keys))if(String(em)>=limite)limpo2[k]=em;
  await pool.query("INSERT INTO operacao_config(chave,valor,updated_at) VALUES('ignorados',$1::jsonb,NOW()) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor,updated_at=NOW()",[JSON.stringify({keys:limpo2})])
}

// O que as gravações devolvem: "linha" é o romaneio gravado; "row" é o lançamento como a tela mostra
// (com os outros romaneios do mesmo motorista no dia, quando houver).
async function resposta(pool,row){
  const linha=resumir(row);
  if(row.origem!=='sistema')return{row:{...linha,ids:[linha.id],partes:null},linha};
  const q=await pool.query(SEL+" WHERE origem='sistema' AND event_date=$1::date AND upper(trim(motorista))=upper(trim($2))",[row.event_date,row.motorista]);
  const g=agrupar(q.rows.map(resumir)).find(x=>x.ids.includes(linha.id));
  return{row:g||{...linha,ids:[linha.id],partes:null},linha}
}
// Atende as rotas /api/painel/lancamentos*. Devolve true quando a rota era daqui (a resposta já foi
// enviada: quem chamou não pode seguir para as outras rotas).
async function handle(req,res,u,ctx){
  if(u.pathname!=='/api/painel/lancamentos'&&!u.pathname.startsWith('/api/painel/lancamentos/'))return false;
  await atender(req,res,u,ctx);
  return true
}
async function atender(req,res,u,ctx){
  const{pool,sendJson,readJsonBodyLimited,sessionOrInternal,dashboardSession,dashboardHas,spToday}=ctx;
  const p=u.pathname;
  const nega=()=>sendJson(res,403,{ok:false,error:'Seu usuário não tem acesso aos Lançamentos. Peça a liberação a um administrador.'});
  try{
    // ---- painéis: todas as linhas no formato da planilha (só o próprio sistema e o administrador pedem)
    if(p==='/api/painel/lancamentos/planilha'&&req.method==='GET'){
      const user=await sessionOrInternal(req);
      if(!user.internal&&!user.is_admin)return nega();
      const f=await fonteAtual(pool);
      if(f.fonte!=='sistema'&&u.searchParams.get('sempre')!=='1')return sendJson(res,200,{ok:true,...f,rows:[]});
      const q=await pool.query(SEL+" ORDER BY event_date NULLS LAST,(origem='sistema'),linha NULLS LAST,id");
      // histórico da planilha como veio; lançamentos do sistema já com os romaneios do mesmo motorista juntos
      const linhas=q.rows.filter(r=>r.origem!=='sistema').map(r=>({d:r.event_date||'',o:0,dados:r.dados}));
      for(const g of agrupar(q.rows.filter(r=>r.origem==='sistema').map(resumir)))linhas.push({d:g.data||'',o:1,dados:montarDados(camposDoGrupo(g))});
      linhas.sort((a,b)=>(a.d||'9999').localeCompare(b.d||'9999')||a.o-b.o);
      return sendJson(res,200,{ok:true,...f,rows:linhas.map(x=>x.dados),total:linhas.length})
    }
    if(p==='/api/painel/lancamentos/config'&&req.method==='GET'){
      const user=await sessionOrInternal(req);
      if(!dashboardHas(user,'lancamentos'))return nega();
      const c=await pool.query("SELECT origem,COUNT(*)::int AS n,to_char(MIN(event_date),'YYYY-MM-DD') AS de,to_char(MAX(event_date),'YYYY-MM-DD') AS ate FROM operacao_lancamentos GROUP BY origem");
      const por={};for(const r of c.rows)por[r.origem]={linhas:r.n,de:r.de,ate:r.ate};
      return sendJson(res,200,{ok:true,...await fonteAtual(pool),sistema:por.sistema||{linhas:0},planilha:por.planilha||{linhas:0},operacoes:OPERACOES})
    }
    // ---- motoristas dos últimos dias, com o tipo de veículo e a operação do último lançamento de cada um
    if(p==='/api/painel/lancamentos/motoristas'&&req.method==='GET'){
      const user=await sessionOrInternal(req);
      if(!dashboardHas(user,'lancamentos'))return nega();
      const dias=Math.min(120,Math.max(1,Number(u.searchParams.get('dias'))||30));
      const todos=await pool.query(
        `SELECT upper(trim(motorista)) AS motorista,upper(trim(COALESCE(dados->>'Veiculo',''))) AS veiculo_tipo,upper(trim(COALESCE(dados->>'Operação',''))) AS operacao,
                upper(trim(COALESCE(dados->>'Filial',''))) AS filial,to_char(event_date,'YYYY-MM-DD') AS ultimo
         FROM operacao_lancamentos
         WHERE event_date>=($1::date-$2::int) AND event_date<=$1::date AND trim(motorista)<>''
         ORDER BY event_date DESC,id DESC LIMIT 6000`,[spToday(),dias]);
      // um por motorista: a data do último lançamento e o último tipo de carro informado (linhas que
      // entraram sozinhas do SSW podem ainda estar sem o carro)
      const por=new Map();
      for(const r of todos.rows){const a=por.get(r.motorista);if(!a)por.set(r.motorista,{...r});else{if(!a.veiculo_tipo&&r.veiculo_tipo)a.veiculo_tipo=r.veiculo_tipo;if(!a.operacao&&r.operacao)a.operacao=r.operacao;if(!a.filial&&r.filial)a.filial=r.filial}}
      const q={rows:[...por.values()].sort((a,b)=>a.motorista.localeCompare(b.motorista,'pt-BR'))};
      const t=await pool.query("SELECT upper(trim(dados->>'Veiculo')) AS tipo,COUNT(*)::int AS n FROM operacao_lancamentos WHERE event_date>=($1::date-120) AND trim(COALESCE(dados->>'Veiculo',''))<>'' GROUP BY 1 ORDER BY n DESC LIMIT 12",[spToday()]);
      return sendJson(res,200,{ok:true,dias,rows:q.rows,tipos:t.rows.map(r=>r.tipo)})
    }
    // ---- trazer o histórico da planilha e passar os painéis para o sistema (administrador)
    if(p==='/api/painel/lancamentos/importar'&&req.method==='POST'){
      const user=await sessionOrInternal(req);
      if(!user.is_admin)return sendJson(res,403,{ok:false,error:'Só o administrador pode trazer o histórico da planilha.'});
      const body=await readJsonBodyLimited(req,24*1024*1024);
      const brutas=Array.isArray(body.rows)?body.rows:[];
      // linha de verdade: tem data e motorista (a planilha tem linhas-modelo só com fórmula)
      const linhas=[];
      brutas.forEach((r,i)=>{
        if(!r||typeof r!=='object')return;
        const data=dataLinha(r),mot=limpo(r.Motorista,120);
        if(!data||!mot)return;
        const dados={};for(const[k,v]of Object.entries(r))dados[limpo(k,60)]=String(v??'').slice(0,700);
        linhas.push({linha:i+2,data,mot,rom:limpo(r.Romaneio,40),key:romaneioKey(r.Romaneio),dados})
      });
      if(!linhas.length)return sendJson(res,400,{ok:false,error:'A planilha veio sem nenhuma linha com data e motorista. Nada foi alterado.'});
      const por=limpo(body.por||user.username,80);
      const cx=await pool.connect();
      let gravadas=0,repetidas=0;
      try{
        await cx.query('BEGIN');
        // O que já foi lançado no sistema vale mais do que a mesma linha na planilha.
        const sis=await cx.query("SELECT romaneio_key,to_char(event_date,'YYYY-MM-DD') AS d FROM operacao_lancamentos WHERE origem='sistema' AND romaneio_key<>''");
        const jaTem=new Set(sis.rows.map(r=>r.romaneio_key+'|'+r.d));
        const novas=linhas.filter(l=>!(l.key&&jaTem.has(l.key+'|'+l.data)));
        repetidas=linhas.length-novas.length;
        await cx.query("DELETE FROM operacao_lancamentos WHERE origem='planilha'");
        for(let i=0;i<novas.length;i+=400){
          const parte=novas.slice(i,i+400);
          const r=await cx.query(
            `INSERT INTO operacao_lancamentos(origem,event_date,romaneio,romaneio_key,motorista,dados,linha,created_by)
             SELECT 'planilha',(x->>'data')::date,x->>'rom',x->>'key',x->>'mot',x->'dados',(x->>'linha')::int,$2
             FROM jsonb_array_elements($1::jsonb) AS x`,[JSON.stringify(parte),por]);
          gravadas+=r.rowCount
        }
        const valor={fonte:'sistema',importado_em:new Date().toISOString(),importado_por:por,linhas_importadas:gravadas};
        await cx.query("INSERT INTO operacao_config(chave,valor,updated_at) VALUES('fonte',$1::jsonb,NOW()) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor,updated_at=NOW()",[JSON.stringify(valor)]);
        await cx.query('COMMIT')
      }catch(e){await cx.query('ROLLBACK').catch(()=>{});throw e}
      finally{cx.release()}
      console.log('LANCAMENTOS histórico da planilha trazido: '+JSON.stringify({por,recebidas:brutas.length,gravadas,repetidas}));
      return sendJson(res,200,{ok:true,fonte:'sistema',recebidas:brutas.length,gravadas,repetidas_no_sistema:repetidas,ignoradas:brutas.length-linhas.length})
    }
    // ---- voltar os painéis para a planilha (ou de novo para o sistema) sem apagar nada
    if(p==='/api/painel/lancamentos/fonte'&&req.method==='POST'){
      const user=await dashboardSession(req,true);
      const body=await readJsonBodyLimited(req,4096);
      const fonte=body.fonte==='sistema'?'sistema':'planilha';
      const atual=await fonteAtual(pool);
      if(fonte==='sistema'&&!atual.importado_em)return sendJson(res,400,{ok:false,error:'Traga primeiro o histórico da planilha: sem ele os painéis ficariam só com os lançamentos novos.'});
      const valor={fonte,importado_em:atual.importado_em,importado_por:atual.importado_por,linhas_importadas:atual.linhas_importadas,trocado_por:user.username,trocado_em:new Date().toISOString()};
      await pool.query("INSERT INTO operacao_config(chave,valor,updated_at) VALUES('fonte',$1::jsonb,NOW()) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor,updated_at=NOW()",[JSON.stringify(valor)]);
      console.log('LANCAMENTOS fonte dos painéis: '+fonte+' (por '+user.username+')');
      return sendJson(res,200,{ok:true,fonte})
    }
    // ---- lista do card
    if(p==='/api/painel/lancamentos'&&req.method==='GET'){
      const user=await sessionOrInternal(req);
      if(!dashboardHas(user,'lancamentos'))return nega();
      const hoje=spToday(),de=dataIso(u.searchParams.get('de'))||hoje,ate=dataIso(u.searchParams.get('ate'))||de;
      const origem=u.searchParams.get('origem')==='todas'?null:'sistema';
      const q=await pool.query(SEL+" WHERE event_date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR origem=$3) ORDER BY event_date,id LIMIT 3000",[de,ate,origem]);
      // soltos=1: uma linha por romaneio (uso do próprio sistema); a tela recebe os romaneios do mesmo motorista juntos
      if(u.searchParams.get('soltos')!=='1')return sendJson(res,200,{ok:true,de,ate,rows:agrupar(q.rows.map(resumir))});
      const rows=q.rows.map(resumir).sort((a,b)=>a.data.localeCompare(b.data)||(Number(romaneioKey(a.romaneio))||0)-(Number(romaneioKey(b.romaneio))||0)||Number(a.id)-Number(b.id));
      return sendJson(res,200,{ok:true,de,ate,rows})
    }
    // ---- novo lançamento
    if(p==='/api/painel/lancamentos'&&req.method==='POST'){
      const user=await sessionOrInternal(req);
      if(!dashboardHas(user,'lancamentos'))return nega();
      const b=await readJsonBodyLimited(req,64*1024);
      const c={data:dataIso(b.data)||spToday(),motorista:limpo(b.motorista,120),romaneio:romaneioCurto(b.romaneio_ssw||b.romaneio),valor:numero(b.valor),
        veiculo_tipo:b.veiculo_tipo,filial:b.filial,operacao:b.operacao,entregas:b.entregas,conferente:b.conferente,erros:b.erros,desconto:b.desconto};
      const key=romaneioKey(b.romaneio_ssw||b.romaneio);
      // auto: o próprio sistema cria a linha quando o romaneio aparece no SSW; o valor fica para o usuário
      const auto=!!user.internal&&b.auto===true;
      if(c.motorista.length<2)return sendJson(res,400,{ok:false,error:'Informe o motorista.'});
      if(!key)return sendJson(res,400,{ok:false,error:'Informe o número do romaneio.'});
      if(auto)c.valor=NaN;
      else{
        if(!Number.isFinite(c.valor)||c.valor<0)return sendJson(res,400,{ok:false,error:'Informe o valor negociado com o motorista.'});
        if(c.valor>100000)return sendJson(res,400,{ok:false,error:'Valor negociado alto demais. Confira os números.'})
      }
      const ign=await lerIgnorados(pool);
      if(auto&&ign[key])return sendJson(res,200,{ok:true,ignorado:true});
      const ja=await pool.query(SEL+" WHERE origem='sistema' AND romaneio_key=$1 LIMIT 1",[key]);
      if(ja.rowCount){
        const row=ja.rows[0],r=resumir(row);
        if(auto)return sendJson(res,200,{ok:true,existente:true,row:r,linha:r});
        // linha que veio do SSW e ainda está sem valor: o formulário completa essa mesma linha
        if(r.valor===null){
          const c2=campos(row);
          Object.assign(c2,{valor:c.valor,motorista:c.motorista,data:c.data});
          for(const k of['veiculo_tipo','operacao','conferente'])if(limpo(b[k],80))c2[k]=limpo(b[k],80);
          const er=numero(b.erros);if(Number.isFinite(er)&&er>0)c2.erros=er;
          const up=await pool.query(
            "UPDATE operacao_lancamentos SET event_date=$2::date,motorista=$3,dados=$4::jsonb,updated_at=NOW() WHERE id=$1 RETURNING id::text AS id,origem,to_char(event_date,'YYYY-MM-DD') AS event_date,romaneio,romaneio_key,motorista,dados,ssw,linha,created_by,updated_at",
            [row.id,c2.data,c2.motorista.toUpperCase(),JSON.stringify(montarDados(c2))]);
          console.log('LANCAMENTO completado pelo formulário: '+JSON.stringify({por:user.username,romaneio:r.romaneio,valor:c.valor}));
          return sendJson(res,200,{ok:true,atualizado:true,...await resposta(pool,up.rows[0])})
        }
        return sendJson(res,409,{ok:false,error:'O romaneio '+r.romaneio+' já foi lançado em '+dataBr(r.data)+' para '+r.motorista+'. Edite o lançamento que já existe.',existente:r})
      }
      const ssw={romaneio_ssw:limpo(b.romaneio_ssw,40).toUpperCase(),placa:limpo(b.placa,12).toUpperCase(),calculo:{status:'pendente',em:new Date().toISOString()}};
      if(auto)ssw.auto=true;
      else if(ign[key]){delete ign[key];await gravarIgnorados(pool,ign)}
      const por=auto?'SSW (automático)':limpo(b.por||user.username,80);
      const q=await pool.query(
        "INSERT INTO operacao_lancamentos(origem,event_date,romaneio,romaneio_key,motorista,dados,ssw,created_by) VALUES('sistema',$1::date,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING id::text AS id,origem,to_char(event_date,'YYYY-MM-DD') AS event_date,romaneio,romaneio_key,motorista,dados,ssw,linha,created_by,updated_at",
        [c.data,c.romaneio,key,c.motorista.toUpperCase(),JSON.stringify(montarDados(c)),JSON.stringify(ssw),por]);
      console.log('LANCAMENTO novo: '+JSON.stringify({por,data:c.data,romaneio:c.romaneio,motorista:c.motorista,valor:auto?null:c.valor}));
      return sendJson(res,201,{ok:true,...await resposta(pool,q.rows[0])})
    }
    const m=p.match(/^\/api\/painel\/lancamentos\/(\d+)$/);
    // ---- alterar (pelo usuário) ou completar com o que veio do SSW (campo "calculo")
    if(m&&req.method==='PATCH'){
      const user=await sessionOrInternal(req);
      if(!dashboardHas(user,'lancamentos'))return nega();
      const b=await readJsonBodyLimited(req,64*1024);
      const q=await pool.query(SEL+' WHERE id=$1 LIMIT 1',[m[1]]);
      if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Lançamento não encontrado.'});
      const row=q.rows[0];
      if(row.origem!=='sistema')return sendJson(res,400,{ok:false,error:'Esta linha veio da planilha e não é alterada por aqui.'});
      const c=campos(row),ssw={...(row.ssw||{})};
      let key=row.romaneio_key;
      const tem=k=>Object.prototype.hasOwnProperty.call(b,k);
      if(tem('data')){const d=dataIso(b.data);if(!d)return sendJson(res,400,{ok:false,error:'Data inválida.'});c.data=d}
      if(tem('motorista')){c.motorista=limpo(b.motorista,120);if(c.motorista.length<2)return sendJson(res,400,{ok:false,error:'Informe o motorista.'})}
      if(tem('valor')){const v=numero(b.valor);if(!Number.isFinite(v)||v<0||v>100000)return sendJson(res,400,{ok:false,error:'Valor negociado inválido.'});c.valor=v}
      if(tem('desconto')){const v=numero(b.desconto);c.desconto=Number.isFinite(v)&&v>0?v:null}
      for(const k of['veiculo_tipo','operacao','conferente','filial'])if(tem(k))c[k]=limpo(b[k],80);
      if(tem('erros')){const v=numero(b.erros);c.erros=Number.isFinite(v)&&v>0?v:null}
      if(tem('romaneio')||tem('romaneio_ssw')){
        const nk=romaneioKey(b.romaneio_ssw||b.romaneio);
        if(!nk)return sendJson(res,400,{ok:false,error:'Informe o número do romaneio.'});
        if(nk!==key){
          const ja=await pool.query("SELECT 1 FROM operacao_lancamentos WHERE origem='sistema' AND romaneio_key=$1 AND id<>$2 LIMIT 1",[nk,m[1]]);
          if(ja.rowCount)return sendJson(res,409,{ok:false,error:'Esse romaneio já tem outro lançamento.'});
          key=nk;c.romaneio=romaneioCurto(b.romaneio_ssw||b.romaneio);
          ssw.romaneio_ssw=limpo(b.romaneio_ssw,40).toUpperCase();ssw.placa=limpo(b.placa,12).toUpperCase();
          // romaneio trocado: o que tinha sido lido do SSW era do outro
          Object.assign(c,{entregas:b.entregas??null,realizadas:null,pend:null,retorno:null,km:null,frete_vialog:null,desconto_vialog:null,rota:''});
          delete ssw.fretes;delete ssw.cidades;delete ssw.ctes;delete ssw.conjunto;
          ssw.calculo={status:'pendente',em:new Date().toISOString()}
        }
      }
      // km da rota única dos romaneios do mesmo motorista (só o próprio sistema grava)
      if(user.internal&&b.conjunto&&typeof b.conjunto==='object'){const kmc=numero(b.conjunto.km);ssw.conjunto=Number.isFinite(kmc)&&kmc>0?{km:Math.round(kmc),keys:limpo(b.conjunto.keys,200),em:new Date().toISOString()}:undefined}
      if(b.calculo&&typeof b.calculo==='object'){
        const k=b.calculo;
        for(const f of['entregas','pend','retorno','km','frete_vialog','desconto_vialog'])if(Object.prototype.hasOwnProperty.call(k,f)){const v=numero(k[f]);c[f]=Number.isFinite(v)?v:null}
        let aoVivo=ssw.calculo?.ao_vivo??null;
        if(Object.prototype.hasOwnProperty.call(k,'realizadas')){
          const v=numero(k.realizadas),ent=numero(c.entregas);
          aoVivo=Number.isFinite(v)?v:null;
          // fechado = dia já passou, todas entregues, ou o SSW já tem baixa de todas as entregas do romaneio
          const fechado=c.data<spToday()||k.fechado===true||(k.fechado===undefined&&ssw.calculo?.fechado===true)||(Number.isFinite(v)&&Number.isFinite(ent)&&ent>0&&v>=ent);
          c.realizadas=fechado&&Number.isFinite(v)?v:null
        }
        // frete de cada CT-e do romaneio: é com ele que se desconta o das entregas não feitas
        // entregas do romaneio, uma a uma ("ctes" sozinho é a contagem)
        if(Array.isArray(k.lista)){
          ssw.ctes=k.lista.slice(0,400).map(x=>{const f=numero(x?.f);return{c:limpo(x?.c,20).toUpperCase(),k:limpo(x?.k,24).toUpperCase(),f:Number.isFinite(f)&&f>=0?Math.round(f*100)/100:null,
            s:['e','o','p','?'].includes(x?.s)?x.s:'?',d:limpo(x?.d,50),ci:limpo(x?.ci,40).toUpperCase(),o:limpo(x?.o,70)}}).filter(x=>x.c||x.k);
          delete ssw.fretes
        }
        if(Array.isArray(k.cidades))ssw.cidades=k.cidades.slice(0,80).map(x=>({c:limpo(x?.c,60).toUpperCase(),n:Math.max(0,Math.round(numero(x?.n))||0)})).filter(x=>x.c);
        if(typeof k.rota==='string')c.rota=k.rota;
        if(typeof k.filial==='string'&&k.filial)c.filial=k.filial;
        if(typeof k.placa==='string'&&k.placa)ssw.placa=limpo(k.placa,12).toUpperCase();
        if(typeof k.romaneio_ssw==='string'&&k.romaneio_ssw)ssw.romaneio_ssw=limpo(k.romaneio_ssw,40).toUpperCase();
        const status=limpo(k.status,20)||'ok';
        // tentativas seguidas sem conseguir completar: o sistema para de insistir sozinho depois de algumas
        ssw.calculo={status,msg:limpo(k.msg,240),em:new Date().toISOString(),ctes:Number(k.ctes||0)||0,lidos:Number(k.lidos||0)||0,baixas_em:k.baixas_em||ssw.calculo?.baixas_em||null,ao_vivo:aoVivo,
          fechado:k.fechado===undefined?!!ssw.calculo?.fechado:k.fechado===true,
          tentativas:status==='erro'?Number(ssw.calculo?.tentativas||0)+1:0}
      }
      const r=await pool.query(
        "UPDATE operacao_lancamentos SET event_date=$2::date,romaneio=$3,romaneio_key=$4,motorista=$5,dados=$6::jsonb,ssw=$7::jsonb,updated_at=NOW() WHERE id=$1 RETURNING id::text AS id,origem,to_char(event_date,'YYYY-MM-DD') AS event_date,romaneio,romaneio_key,motorista,dados,ssw,linha,created_by,updated_at",
        [m[1],c.data,c.romaneio,key,c.motorista.toUpperCase(),JSON.stringify(montarDados(c)),JSON.stringify(ssw)]);
      if(!b.calculo)console.log('LANCAMENTO alterado: '+JSON.stringify({por:user.username,id:m[1],romaneio:c.romaneio,valor:c.valor}));
      // alterou data ou motorista de um lançamento com vários romaneios: os outros romaneios acompanham
      if(b.grupo===true&&(tem('data')||tem('motorista'))&&(c.data!==row.event_date||c.motorista.toUpperCase()!==String(row.motorista).toUpperCase())){
        const irm=await pool.query(SEL+" WHERE origem='sistema' AND event_date=$1::date AND upper(trim(motorista))=upper(trim($2)) AND id<>$3",[row.event_date,row.motorista,m[1]]);
        for(const o of irm.rows){
          const co=campos(o);co.data=c.data;co.motorista=c.motorista;
          await pool.query("UPDATE operacao_lancamentos SET event_date=$2::date,motorista=$3,dados=$4::jsonb,updated_at=NOW() WHERE id=$1",[o.id,co.data,co.motorista.toUpperCase(),JSON.stringify(montarDados(co))])
        }
      }
      return sendJson(res,200,{ok:true,...await resposta(pool,r.rows[0])})
    }
    if(m&&req.method==='DELETE'){
      const user=await sessionOrInternal(req);
      if(!dashboardHas(user,'lancamentos'))return nega();
      const q=await pool.query("DELETE FROM operacao_lancamentos WHERE id=$1 AND origem='sistema' RETURNING romaneio,motorista,romaneio_key",[m[1]]);
      if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Lançamento não encontrado (linhas que vieram da planilha não são excluídas por aqui).'});
      // excluído pelo usuário: o sistema não traz de volta sozinho (só lançando pelo formulário)
      const rk=q.rows[0].romaneio_key;delete q.rows[0].romaneio_key;
      if(rk){const ign=await lerIgnorados(pool);ign[rk]=new Date().toISOString();await gravarIgnorados(pool,ign)}
      console.log('LANCAMENTO excluído: '+JSON.stringify({por:user.username,id:m[1],...q.rows[0]}));
      return sendJson(res,200,{ok:true})
    }
    return sendJson(res,404,{ok:false,error:'Rota de lançamentos não encontrada.'})
  }catch(e){
    if(e&&e.code==='23505')return sendJson(res,409,{ok:false,error:'Esse romaneio já tem lançamento.'});
    return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha nos lançamentos.'})
  }
}

module.exports={COLUNAS,OPERACOES,freteNaoEntregue,contasDasEntregas,agrupar,numero,dinheiro,dataIso,dataBr,romaneioKey,romaneioCurto,montarDados,resumir,ensureSchema,handle};
