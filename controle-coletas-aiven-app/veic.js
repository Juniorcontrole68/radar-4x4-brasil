// Abastecimentos do Veic (acesso.veic.com.br) na Frota → Combustível.
// Só CONSULTA: entra com o usuário do Veic (VEIC_USUARIO / VEIC_SENHA) e lê a lista de transações
// (GET /transacao-query/transacao). Nunca envia validação, cancelamento ou qualquer alteração ao Veic.
// O login é o mesmo do site: POST /auth/token (grant_type=password, usuário e senha em Basic).
'use strict';

// Identificação pública do site do Veic (está no próprio JavaScript do acesso.veic.com.br).
const CLIENTE_SITE={
  client_id:'cb79408f9e997dd89a3359ae57192c428b15e4982e421d871a30c5d2b1cac658',
  client_secret:'1ddca911996812ffa3b9bc8e7a5bb96aabdac1358b7bae213cb50e15753e7a71',
  scope:'transacao-query'
};
// O site manda este cabeçalho em toda chamada à API; sem ele a consulta de transações volta 401.
const ISSUER_ID=String(process.env.VEIC_ISSUER_ID||'4b0fe997782a4502a447b752dfac4fdb');
const POR_PAGINA=500, MAX_PAGINAS=40, MAX_DIAS=92;
const FROTA_SEM_ACESSO='Seu usuário não tem acesso à Frota.';

const base=()=>String(process.env.VEIC_API_URL||'https://api.veic.com.br').replace(/\/+$/,'');
const credenciais=()=>({usuario:String(process.env.VEIC_USUARIO||'').trim(),senha:String(process.env.VEIC_SENHA||'')});
const configurado=()=>{const c=credenciais();return !!(c.usuario&&c.senha)};

const num=v=>{if(v===null||v===undefined||v==='')return 0;if(typeof v==='number')return Number.isFinite(v)?v:0;const s=String(v).trim();const n=Number(/,\d{1,3}$/.test(s)?s.replace(/\./g,'').replace(',','.'):s);return Number.isFinite(n)?n:0};
const placa=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const PLACA_RE=/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
// O Veic não diz em um campo fixo onde vem a placa: tenta os nomes conhecidos e, senão, procura na
// transação qualquer texto no formato de placa (ABC1234 / ABC1D23), olhando primeiro o equipamento.
function placaDaTransacao(t){
  const eq=t.equipamento||t.veiculo||{};
  for(const v of [eq.placa,eq.identificacao,t.placa,t.placaVeiculo,t.identificacaoEquipamento,t.equipamentoIdentificacao]){const p=placa(v);if(PLACA_RE.test(p))return p}
  const vistos=new Set();
  const busca=(o,n)=>{if(!o||typeof o!=='object'||n>4||vistos.has(o))return '';vistos.add(o);
    for(const [k,v] of Object.entries(o)){if(typeof v==='string'&&v.length<=10&&/placa|identifica|equipamento|veiculo/i.test(k)){const p=placa(v);if(PLACA_RE.test(p))return p}}
    for(const v of Object.values(o)){const r=busca(v,n+1);if(r)return r}return ''};
  return busca(eq,0)||busca(t,0)||placa(eq.identificacao)
}
// Nomes dos campos (sem valores) de uma transação, para conferir no log do Render.
function camposDe(o,pre='',n=0,out=[]){if(!o||typeof o!=='object'||n>2)return out;for(const [k,v] of Object.entries(o)){if(v&&typeof v==='object'&&!Array.isArray(v))camposDe(v,pre+k+'.',n+1,out);else out.push(pre+k)}return out}
let camposLogados=false;
const isoDia=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''));
const hojeSP=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const diasAntes=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10)};

// Data e hora da transação no horário de Brasília. Aceita ISO com ou sem fuso e "dd/mm/aaaa hh:mm".
function dataHora(v){
  const s=String(v||'').trim();if(!s)return{date:'',time:''};
  let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if(m)return{date:m[3]+'-'+m[2]+'-'+m[1],time:m[4]?m[4]+':'+m[5]:''};
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};
  if(!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s))return{date:m[1]+'-'+m[2]+'-'+m[3],time:m[4]?m[4]+':'+m[5]:''};
  const d=new Date(s);if(isNaN(d))return{date:m[1]+'-'+m[2]+'-'+m[3],time:''};
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
  return{date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute}
}

// Uma transação do Veic vira um abastecimento da Frota. Transações sem abastecimento (manutenção,
// pedágio) ficam de fora.
function abastecimentoDaTransacao(t){
  if(!t||typeof t!=='object')return null;
  const a=t.abastecimento;
  if(!a||typeof a!=='object')return null;
  const liters=num(a.quantidade??a.litros);
  const price=num(a.valorUnitario);
  const total=num(t.valor??a.valorTotal??a.valor)||Math.round(liters*price*100)/100;
  if(!liters&&!total)return null;
  const {date,time}=dataHora(t.data||t.dataTransacao);
  const km=num(a.hodometro), kmPrev=num(a.hodometroAnterior);
  const kmDriven=km>0&&kmPrev>0&&km>kmPrev?km-kmPrev:0;
  const cred=t.credenciado||{};
  return{
    id:'veic-'+String(t.id??t.codigoAutorizacao??t.nsuHost),
    veicId:String(t.id??''),
    source:'veic',
    date,time,
    plate:placaDaTransacao(t),
    driver:String((t.condutor&&t.condutor.nome)||(t.portador&&t.portador.nomeImpresso)||'').trim(),
    km,kmPrev,kmDriven,
    liters,price,total,
    kmPerLiter:kmDriven&&liters?Math.round(kmDriven/liters*100)/100:0,
    fuelType:String(a.servico||t.produto||'').trim(),
    station:String(cred.nome||'').trim(),
    city:[cred.cidade,cred.estado].filter(Boolean).join('/'),
    status:String(t.status&&typeof t.status==='object'?(t.status.descricao||t.status.nome||''):(t.status||'')).trim()
  }
}

// Junta os abastecimentos lidos com os que já estão na Frota: os do Veic são atualizados pelo id,
// os lançados à mão ficam como estão. Mais recentes primeiro.
function mesclar(atuais,novos){
  const lista=Array.isArray(atuais)?atuais.slice():[];
  const pos=new Map();lista.forEach((x,i)=>{if(x&&x.source==='veic'&&x.id)pos.set(x.id,i)});
  let criados=0,atualizados=0;
  const agora=new Date().toISOString();
  for(const n of novos){
    if(!n||!n.id)continue;
    if(pos.has(n.id)){const i=pos.get(n.id);lista[i]=Object.assign({},lista[i],n,{importedAt:agora});atualizados++}
    else{lista.push(Object.assign({createdAt:agora},n,{importedAt:agora}));pos.set(n.id,lista.length-1);criados++}
  }
  // O Veic às vezes devolve o mesmo abastecimento duas vezes (ids diferentes, mesmo dia, KM e litros).
  // Fica um só, de preferência o que não está cancelado/negado.
  const ruim=x=>/cancel|estorn|negad|recus|anulad/i.test(String(x.status||''));
  const chave=x=>[x.date,x.plate||x.driver,Number(x.km||0),Number(x.liters||0)].join('|');
  const escolhido=new Map();
  lista.forEach((x,i)=>{if(!x||x.source!=='veic'||!(Number(x.liters)>0))return;const k=chave(x),j=escolhido.get(k);if(j===undefined||(ruim(lista[j])&&!ruim(x)))escolhido.set(k,i)});
  const antes=lista.length;
  const final=lista.filter((x,i)=>!x||x.source!=='veic'||!(Number(x.liters)>0)||escolhido.get(chave(x))===i);
  final.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.time||'').localeCompare(String(a.time||'')));
  return{fuel:final,criados,atualizados,duplicados:antes-final.length}
}

function erro(msg,status=502){return Object.assign(new Error(msg),{status})}

async function entrar({usuario,senha}){
  const corpo=new URLSearchParams({grant_type:'password',...CLIENTE_SITE}).toString();
  let r;
  try{
    r=await fetch(base()+'/auth/token',{method:'POST',headers:{'x-issuer-id':ISSUER_ID,authorization:'Basic '+Buffer.from(usuario+':'+senha).toString('base64'),'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:corpo,signal:AbortSignal.timeout(30000)});
  }catch(e){throw erro('Não consegui falar com o Veic: '+(e.message||e))}
  const j=await r.json().catch(()=>({}));
  if(r.status===400||r.status===401)throw erro('O Veic recusou o usuário ou a senha (VEIC_USUARIO / VEIC_SENHA).',502);
  if(!r.ok||!j.access_token)throw erro('Falha no login do Veic (HTTP '+r.status+').');
  return j.access_token
}

async function listarTransacoes(token,from,to){
  const todas=[];
  for(let pagina=1;pagina<=MAX_PAGINAS;pagina++){
    const qs=new URLSearchParams({sortOrder:'desc',pageIndex:String(pagina),pageSize:String(POR_PAGINA),dataInicioTransacao:from,dataFimTransacao:to,dataInicio:from,dataFim:to});
    let r;
    try{r=await fetch(base()+'/transacao-query/transacao?'+qs,{headers:{'x-issuer-id':ISSUER_ID,Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(60000)})}
    catch(e){throw erro('Não consegui ler as transações do Veic: '+(e.message||e))}
    if(!r.ok)console.warn('VEIC transações HTTP '+r.status+': '+String(await r.clone().text().catch(()=>'')).slice(0,300));
    if(r.status===401||r.status===403)throw erro('O Veic não liberou a consulta de transações para este usuário (HTTP '+r.status+').');
    if(!r.ok)throw erro('Falha ao ler as transações do Veic (HTTP '+r.status+').');
    const j=await r.json().catch(()=>null);
    const lista=Array.isArray(j)?j:(j&&(j.list||j.content||j.items||j.data))||[];
    if(!Array.isArray(lista))throw erro('Resposta do Veic em formato inesperado.');
    if(!camposLogados&&lista[0]){camposLogados=true;console.log('VEIC campos da transação: '+camposDe(lista[0]).join(', ').slice(0,1500))}
    todas.push(...lista);
    const total=j&&!Array.isArray(j)?num(j.total??j.totalElements??j.totalCount):0;
    if(lista.length<POR_PAGINA||(total&&todas.length>=total))break;
  }
  return todas
}

// Lê o período no Veic e devolve os abastecimentos (sem gravar nada).
async function lerAbastecimentos(from,to){
  if(!configurado())throw erro('Faltam VEIC_USUARIO e VEIC_SENHA nas variáveis do Render.',400);
  const token=await entrar(credenciais());
  const trans=await listarTransacoes(token,from,to);
  const abast=trans.map(abastecimentoDaTransacao).filter(Boolean).filter(x=>!x.date||(x.date>=from&&x.date<=to));
  return{transacoes:trans.length,abastecimentos:abast}
}

let ultima=null, rodando=null;

// Quando o Veic não traz a placa, usa a do veículo da Frota cujo motorista é o mesmo do abastecimento
// (todos os nomes cadastrados no veículo aparecem no nome do Veic, e só um veículo bate).
const nomeTokens=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().split(/[^A-Z]+/).filter(t=>t.length>1);
function placaPeloMotorista(fuel,vehicles){
  const vs=(Array.isArray(vehicles)?vehicles:[]).map(v=>({plate:placa(v&&v.plate),t:nomeTokens(v&&v.driver)})).filter(v=>v.plate&&v.t.length);
  let n=0;
  for(const x of fuel){
    if(!x||x.source!=='veic'||(x.plate&&!x.plateFromDriver))continue;
    const ft=new Set(nomeTokens(x.driver));if(!ft.size)continue;
    const bate=[...new Set(vs.filter(v=>v.t.every(t=>ft.has(t))).map(v=>v.plate))];
    if(bate.length===1){if(x.plate!==bate[0])n++;x.plate=bate[0];x.plateFromDriver=true}
  }
  return n
}

async function importar(pool,from,to,origem='manual'){
  if(rodando)return rodando;
  rodando=(async()=>{
    try{
      const {transacoes,abastecimentos}=await lerAbastecimentos(from,to);
      const c=await pool.connect();
      let res;
      try{
        await c.query('BEGIN');
        const q=await c.query('SELECT data FROM fleet_state WHERE id=1 FOR UPDATE');
        const data=Object.assign({vehicles:[],fuel:[],maintenance:[],tires:[],people:[],documents:[],checklists:[]},q.rows[0]?.data||{});
        res=mesclar(data.fuel,abastecimentos);
        placaPeloMotorista(res.fuel,data.vehicles);
        data.fuel=res.fuel;
        await c.query('UPDATE fleet_state SET data=$1::jsonb,updated_at=NOW() WHERE id=1',[JSON.stringify(data)]);
        await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
      finally{c.release()}
      const ids=new Set(abastecimentos.map(x=>x.id)),placas=new Set(res.fuel.filter(x=>x&&ids.has(x.id)).map(x=>x.plate).filter(Boolean));
      ultima={ok:true,em:new Date().toISOString(),origem,from,to,transacoes,abastecimentos:abastecimentos.length,criados:res.criados,atualizados:res.atualizados,duplicados:res.duplicados,veiculos:placas.size};
      return ultima
    }catch(e){
      ultima={ok:false,em:new Date().toISOString(),origem,from,to,error:String(e.message||e)};
      throw e
    }finally{rodando=null}
  })();
  return rodando
}

// Rotas: GET /api/painel/frota-veic (situação) e POST /api/painel/frota-veic/importar {from,to}.
async function handle(req,res,u,{pool,sendJson,readJsonBodyLimited,dashboardSession,dashboardHas}){
  if(u.pathname!=='/api/painel/frota-veic'&&u.pathname!=='/api/painel/frota-veic/importar')return false;
  try{
    if(!dashboardHas(await dashboardSession(req),'frota'))return sendJson(res,403,{ok:false,error:FROTA_SEM_ACESSO}),true;
    if(u.pathname==='/api/painel/frota-veic'&&req.method==='GET'){
      sendJson(res,200,{ok:true,configurado:configurado(),importando:!!rodando,ultima});return true
    }
    if(u.pathname==='/api/painel/frota-veic/importar'&&req.method==='POST'){
      const body=await readJsonBodyLimited(req,16*1024)||{};
      const to=isoDia(body.to)?body.to:hojeSP(), from=isoDia(body.from)?body.from:diasAntes(to,30);
      if(from>to)return sendJson(res,400,{ok:false,error:'A data inicial é depois da final.'}),true;
      if((new Date(to)-new Date(from))/864e5>MAX_DIAS)return sendJson(res,400,{ok:false,error:'Importe no máximo '+MAX_DIAS+' dias por vez.'}),true;
      const r=await importar(pool,from,to,'manual');
      sendJson(res,200,r);return true
    }
    sendJson(res,405,{ok:false,error:'Método não permitido.'});return true
  }catch(e){sendJson(res,e.status||500,{ok:false,error:e.message||'Falha na importação do Veic.'});return true}
}

// Importação automática dos últimos dias, de tempos em tempos (desliga com VEIC_AUTO=0).
function iniciarImportacaoAutomatica(pool){
  if(!configurado()||process.env.VEIC_AUTO==='0')return false;
  const horas=Math.max(1,Number(process.env.VEIC_AUTO_HORAS||6));
  const rodar=()=>{const to=hojeSP();importar(pool,diasAntes(to,7),to,'automatica').then(r=>console.log('VEIC importados: '+r.abastecimentos+' ('+r.criados+' novos)')).catch(e=>console.log('VEIC importação: '+String(e.message||e)))};
  setTimeout(rodar,60*1000).unref?.();
  setInterval(rodar,horas*3600*1000).unref?.();
  return true
}

module.exports={abastecimentoDaTransacao,mesclar,placaPeloMotorista,dataHora,handle,iniciarImportacaoAutomatica,importar,lerAbastecimentos,configurado};
