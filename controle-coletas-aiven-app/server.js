const fs = require('fs');
const path = require('path');
const http = require('http');
const Module = require('module');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');

if (process.env.DATABASE_URL) {
  try {
    const u = new URL(process.env.DATABASE_URL);
    if (u.searchParams.get('sslmode') === 'require' && !u.searchParams.has('uselibpqcompat')) {
      u.searchParams.set('uselibpqcompat', 'true');
      process.env.DATABASE_URL = u.toString();
    }
  } catch (e) {
    console.error('DATABASE_URL invalida:', e.message);
  }
}

process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module.Module._initPaths();

const { initDb, pool } = require('../contas-a-pagar-v3/src/db');
const { initColetasDb } = require('../contas-a-pagar-v3/src/coletas');
const { handler } = require('../contas-a-pagar-v3/src/handler');

const PORT = process.env.PORT || 10000;
const PANEL = path.join(__dirname, 'painel.html');
const DRIVER_TEST_PAGE = path.join(__dirname, 'motorista-teste.html');
const DRIVER_INSTALL_PAGE = path.join(__dirname, 'motorista-instalar.html');
const DRIVER_TEST_INSTALL_PAGE = path.join(__dirname, 'motorista-teste-instalar.html');
const LOTACAO_PAGE = path.join(__dirname, 'lotacao.html');
const FROTA_PAGE = path.join(__dirname, 'frota.html');
const PDF_UNIFIER_PAGE = path.join(__dirname, 'pdf-unificador.html');
const MOVIT_PC_PAGE = path.join(__dirname, 'movit-pc.html');
const MOVIT_CENTRAL_PAGE = path.join(__dirname, 'movit-central.html');
const ACCOUNTS_INDEX = path.join(__dirname, '..', 'contas-a-pagar-v3', 'public', 'index.html');
const DRIVER_DOWNLOADS = path.join(__dirname, 'downloads');
const DRIVER_UPDATE_FILE = path.join(DRIVER_DOWNLOADS, 'update.json');
// Endereço público usado em convites, links de rota e atualização do app.
// No ambiente de teste, defina PUBLIC_BASE_URL para não gerar links da produção.
const DRIVER_PUBLIC_BASE = String(process.env.PUBLIC_BASE_URL || 'https://controle-coletas-jr.onrender.com').replace(/\/+$/, '');

// Modo teste: TEST_MODE=1 desliga importações e sondas que falam com sistemas reais.
const TEST_MODE = /^(1|true|sim|yes)$/i.test(String(process.env.TEST_MODE || '').trim());
if (TEST_MODE) {
  // Trava de segurança: o teste nunca pode ligar no banco de produção por engano.
  let dbName = '';
  try { dbName = decodeURIComponent(new URL(process.env.DATABASE_URL || '').pathname.replace(/^\//, '')); } catch {}
  if (!/test/i.test(dbName)) {
    console.error('TEST_MODE ativo, mas o nome do banco ("' + dbName + '") não contém "teste". Inicialização recusada.');
    process.exit(1);
  }
  console.log('*** AMBIENTE DE TESTE (TEST_MODE) *** banco: ' + dbName);
}

// Chave interna, nova a cada inicialização, conhecida só por este processo e pelo
// dashboard que ele inicia. Identifica as chamadas servidor-a-servidor do dashboard.
const INTERNAL_KEY = crypto.randomBytes(32).toString('hex');

// "Hoje" no fuso de São Paulo (AAAA-MM-DD). Nunca usar toISOString() para isso:
// em UTC o dia vira às 21h de Brasília.
function spToday(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

const DASH_INTERNAL_PORT = Number(process.env.DASH_INTERNAL_PORT || 10001);
const DASH_INTERNAL_HOST = '127.0.0.1';
const DASHBOARD_DIR = path.join(__dirname, 'dashboard');
let DASH_CHILD = null;
const DASH_API_PREFIXES = [
  '/api/sheet/','/api/bi2/','/api/ssw/','/api/tracking/','/api/roteirizador/',
  '/api/programacao-entregas','/api/programacao-simulacao','/api/evolucao-motoristas',
  '/api/agendamento-teste','/api/nf-materiais','/api/frota-state','/api/frota-maintenance-file',
  '/api/carregamentos-count','/api/carregamentos-finais','/api/coletas/status',
  '/api/lotacao'
];
// Rotas de rastreio atendidas AQUI: são as que o app do motorista e as páginas de teste usam,
// com token do aparelho ou sem login. Precisam ficar fora do repasse ao dashboard: ele exige
// login de usuário e respondia 401 "Não autenticado" ao aplicativo (GPS parado).
const LOCAL_TRACKING_PATHS = new Set([
  '/api/tracking/app-update','/api/tracking/assignment/current','/api/tracking/enroll',
  '/api/tracking/heartbeat','/api/tracking/invite','/api/tracking/movit-link','/api/tracking/point','/api/tracking/points',
  '/api/tracking/register-request','/api/tracking/register-status',
  '/api/tracking/session/start','/api/tracking/session/stop','/api/tracking/test-invite',
  '/api/tracking/test/point','/api/tracking/test/start','/api/tracking/test/status'
]);
function isDashboardApiPath(pathname){
  if(LOCAL_TRACKING_PATHS.has(pathname))return false;
  return DASH_API_PREFIXES.some(p=>pathname===p||pathname.startsWith(p));
}
function proxyDashboard(req,res,targetPath){
  const headers={...req.headers,host:DASH_INTERNAL_HOST+':'+DASH_INTERNAL_PORT};
  const pr=http.request({
    host:DASH_INTERNAL_HOST,
    port:DASH_INTERNAL_PORT,
    method:req.method,
    path:targetPath,
    headers
  },pres=>{
    const outHeaders={...pres.headers};
    res.writeHead(pres.statusCode||502,outHeaders);
    pres.pipe(res)
  });
  pr.on('error',err=>{
    if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    if(!res.writableEnded)res.end(JSON.stringify({ok:false,error:'Módulo interno da Torre de Controle indisponível: '+err.message}))
  });
  req.pipe(pr)
}
function startUnifiedDashboardChild(){
  if(DASH_CHILD&&!DASH_CHILD.killed)return;
  const childPath=path.join(DASHBOARD_DIR,'server.js');
  if(!fs.existsSync(childPath)){console.warn('Dashboard interno não encontrado:',childPath);return}
  DASH_CHILD=spawn(process.execPath,[childPath],{
    cwd:DASHBOARD_DIR,
    env:{
      ...process.env,
      PORT:String(DASH_INTERNAL_PORT),
      COLETAS_PORTAL_URL:'http://127.0.0.1:'+String(PORT),
      DASH_INTERNAL_KEY:INTERNAL_KEY
    },
    stdio:['ignore','inherit','inherit']
  });
  DASH_CHILD.on('exit',(code,signal)=>{
    console.error('Dashboard interno encerrou',code,signal);
    DASH_CHILD=null;
    setTimeout(()=>{try{startUnifiedDashboardChild()}catch(e){console.error(e)}},2000)
  })
}

// Ao encerrar este processo, encerra também o dashboard interno. Sem isso ele ficava órfão,
// segurando a porta interna, e o próximo início conversava com um dashboard antigo.
function stopDashboardChild(){
  try{if(DASH_CHILD&&!DASH_CHILD.killed){DASH_CHILD.removeAllListeners('exit');DASH_CHILD.kill()}}catch{}
}
process.on('exit',stopDashboardChild);
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{stopDashboardChild();process.exit(0)});

function sendHtml(res, file) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  if (TEST_MODE) {
    // Faixa fixa para ninguém confundir o teste com a produção.
    const banner = '<div style="position:sticky;top:0;z-index:99999;background:#b45309;color:#fff;font:600 13px Segoe UI,Arial,sans-serif;text-align:center;padding:6px 10px">AMBIENTE DE TESTE — dados fictícios, integrações desligadas</div>';
    return res.end(fs.readFileSync(file, 'utf8').replace(/<body([^>]*)>/i, m => m + banner));
  }
  res.end(fs.readFileSync(file));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

const ROUTE_PUBLIC_LIMIT = new Map();
function publicRouteAllowed(req){
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
  const now=Date.now(),key=ip||'unknown',row=ROUTE_PUBLIC_LIMIT.get(key)||{at:now,count:0};
  if(now-row.at>60000){row.at=now;row.count=0}
  row.count++;ROUTE_PUBLIC_LIMIT.set(key,row);
  return row.count<=90
}
function routePublicHaversine(a,b){
  const R=6371000,r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;
  const x=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(x)))
}
function routePublicStreetVariants(raw){
  const out=[],push=x=>{x=String(x||'').trim().replace(/\s+/g,' ');if(x&&!out.includes(x))out.push(x)};
  const clean=String(raw||'').trim().replace(/\s+/g,' ');
  push(clean);

  const addStreetCity=(street,city)=>{
    street=String(street||'').trim().replace(/\s+/g,' ');
    city=String(city||'').trim().replace(/\bSP\b/ig,'').replace(/\s+/g,' ');
    if(!street||!city)return;
    push(street+', '+city);
    const noNum=street.replace(/\b\d+[A-Za-z-]*\b/g,'').replace(/\s+/g,' ').trim();
    if(noNum&&noNum!==street)push(noNum+', '+city);
    const words=noNum.split(/\s+/),last=words[words.length-1]||'';
    if(last.length>=4&&/[aeiou]$/i.test(last)){
      const prev=last[last.length-2];
      if(prev&&/[bcdfghjklmnpqrstvwxyz]/i.test(prev)){
        push([...words.slice(0,-1),last.slice(0,-1)+prev+last.slice(-1)].join(' ')+', '+city)
      }
    }
  };

  const parts=clean.split(',').map(x=>x.trim()).filter(Boolean);
  if(parts.length>=2)addStreetCity(parts.slice(0,-1).join(', '),parts[parts.length-1]);

  if(parts.length===1){
    const words=clean.split(/\s+/).filter(Boolean);
    for(let cityWords=1;cityWords<=3;cityWords++){
      if(words.length<=cityWords+1)break;
      addStreetCity(words.slice(0,-cityWords).join(' '),words.slice(-cityWords).join(' '))
    }
  }
  return out
}
async function routePublicViaCep(raw){
  try{
    const clean=String(raw||'').trim().replace(/\s+/g,' ');
    const number=(clean.match(/\b\d+[A-Za-z-]*\b/)||[])[0]||'';
    const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/^(rua|r\.?|avenida|av\.?|rodovia|estrada|travessa)\s+/,'')
      .replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();

    let bestRow=null;
    for(const v of routePublicStreetVariants(clean)){
      const parts=v.split(',').map(x=>x.trim()).filter(Boolean);
      if(parts.length<2)continue;
      const city=parts[parts.length-1].replace(/\bSP\b/ig,'').trim();
      const street=parts.slice(0,-1).join(' ').replace(/\b\d+[A-Za-z-]*\b/g,'').replace(/\s+/g,' ').trim();
      if(!city||!street)continue;

      const u='https://viacep.com.br/ws/SP/'+encodeURIComponent(city)+'/'+encodeURIComponent(street)+'/json/';
      const r=await fetch(u,{headers:{'User-Agent':'MOVIT/0.8'},signal:AbortSignal.timeout(4500)});
      const j=await r.json().catch(()=>[]);
      if(!r.ok||!Array.isArray(j)||!j.length)continue;

      const target=norm(street);
      const scored=j.map(row=>{
        const n=norm(row.logradouro);
        let score=0;
        if(n===target)score=100;
        else if(n.includes(target)||target.includes(n))score=70;
        else{
          const a=new Set(target.split(' ')),b=new Set(n.split(' '));
          score=[...a].filter(x=>b.has(x)).length*10
        }
        if(norm(row.localidade)===norm(city))score+=30;
        return{row,score}
      }).sort((a,b)=>b.score-a.score);

      if(scored[0]?.score>0){bestRow=scored[0].row;break}
    }
    if(!bestRow)return null;

    const cep=String(bestRow.cep||'').replace(/\D/g,'');
    if(cep.length!==8)return null;

    const targetStreet=norm(bestRow.logradouro);
    const targetCity=norm(bestRow.localidade);
    const canonical=[bestRow.logradouro,number,bestRow.bairro,bestRow.localidade,bestRow.uf,cep,'Brasil'].filter(Boolean).join(', ');

    const pickNominatim=async(query,expectNumber)=>{
      try{
        const u=new URL('https://nominatim.openstreetmap.org/search');
        u.searchParams.set('q',query);
        u.searchParams.set('format','jsonv2');
        u.searchParams.set('limit','8');
        u.searchParams.set('countrycodes','br');
        u.searchParams.set('addressdetails','1');
        const r=await fetch(u,{headers:{'User-Agent':'MOVIT-Rotas/0.8 (+https://controle-coletas-jr.onrender.com)','Accept-Language':'pt-BR,pt;q=0.9'},signal:AbortSignal.timeout(5000)});
        const j=await r.json().catch(()=>[]);
        if(!r.ok||!Array.isArray(j))return null;

        const scored=j.map(x=>{
          const a=x.address||{};
          const road=norm(a.road||a.pedestrian||a.residential||a.path||'');
          const city=norm(a.city||a.town||a.municipality||a.village||a.county||'');
          const house=String(a.house_number||'').trim();
          let score=0;
          if(road===targetStreet)score+=120;
          else if(road&&targetStreet&&(road.includes(targetStreet)||targetStreet.includes(road)))score+=70;
          if(city===targetCity)score+=80;
          else if(city&&targetCity&&(city.includes(targetCity)||targetCity.includes(city)))score+=35;
          if(expectNumber&&number){
            if(house===number)score+=120;
            else if(house)score-=40;
          }
          const lat=Number(x.lat),lon=Number(x.lon);
          return {x,lat,lon,score,road,city,house}
        }).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon))
          .sort((a,b)=>b.score-a.score);

        const hit=scored[0];
        if(!hit)return null;
        // Nunca aceita resultado de outra rua/cidade só porque o Nominatim respondeu algo.
        if(hit.score<150)return null;

        const label=hit.x.display_name||query;
        return {lat:hit.lat,lon:hit.lon,label,city:bestRow.localidade||'',state:bestRow.uf||'SP',cep,
          source:expectNumber&&hit.house===number?'ViaCEP + Nominatim número':'ViaCEP + Nominatim rua',
          precision:expectNumber&&hit.house===number?'number':'street'}
      }catch(e){return null}
    };

    // 1) tenta o número exato, mas somente se rua e cidade também conferirem
    if(number){
      for(const query of [
        canonical,
        [bestRow.logradouro,number,bestRow.localidade,bestRow.uf,'Brasil'].filter(Boolean).join(', ')
      ]){
        const hit=await pickNominatim(query,true);
        if(hit)return hit;
      }
    }

    // 2) se o número não existe no mapa, usa a própria rua em vez do centro genérico do CEP
    for(const query of [
      [bestRow.logradouro,bestRow.bairro,bestRow.localidade,bestRow.uf,'Brasil'].filter(Boolean).join(', '),
      [bestRow.logradouro,bestRow.localidade,bestRow.uf,'Brasil'].filter(Boolean).join(', ')
    ]){
      const hit=await pickNominatim(query,false);
      if(hit){
        hit.label=[bestRow.logradouro,number,bestRow.bairro,bestRow.localidade,bestRow.uf,bestRow.cep].filter(Boolean).join(', ');
        hit.approximate=!!number;
        return hit;
      }
    }

    // 3) último recurso: CEP, marcado como aproximado
    const r=await fetch('https://brasilapi.com.br/api/cep/v2/'+cep,{headers:{'User-Agent':'MOVIT/0.8'},signal:AbortSignal.timeout(4500)});
    const j=await r.json().catch(()=>({}));
    const lat=Number(j?.location?.coordinates?.latitude),lon=Number(j?.location?.coordinates?.longitude);
    if(!r.ok||!Number.isFinite(lat)||!Number.isFinite(lon))return null;
    return {
      lat,lon,
      label:[bestRow.logradouro,number,bestRow.bairro,bestRow.localidade,bestRow.uf,bestRow.cep].filter(Boolean).join(', '),
      city:bestRow.localidade||'',state:bestRow.uf||'SP',cep,
      source:'ViaCEP + BrasilAPI',
      precision:'cep',
      approximate:true
    }
  }catch(e){
    console.warn('MOVIT ViaCEP falhou',String(e?.message||e));
    return null
  }
}
async function routePublicGeocode(q,nearLat=null,nearLon=null,allMatches=false){
  const raw=String(q||'').trim().replace(/\s+/g,' ');
  if(raw.length<4)throw Object.assign(new Error('Informe ao menos o nome da rua.'),{status:400});

  const nlat=Number(nearLat),nlon=Number(nearLon);
  const hasNear=!allMatches&&Number.isFinite(nlat)&&Number.isFinite(nlon)&&nlat>=-90&&nlat<=90&&nlon>=-180&&nlon<=180;

  let nearCity='',nearState='';
  if(hasNear){
    try{
      const u=new URL('https://nominatim.openstreetmap.org/reverse');
      u.searchParams.set('lat',String(nlat));u.searchParams.set('lon',String(nlon));
      u.searchParams.set('format','jsonv2');u.searchParams.set('zoom','10');u.searchParams.set('addressdetails','1');
      const r=await fetch(u,{headers:{'User-Agent':'MOVIT-Rotas/1.2 (+https://controle-coletas-jr.onrender.com)','Accept-Language':'pt-BR,pt;q=0.9'},signal:AbortSignal.timeout(4500)});
      const j=await r.json().catch(()=>({}));
      if(r.ok){
        const a=j.address||{};
        nearCity=String(a.city||a.town||a.municipality||a.village||'').trim();
        nearState=String(a.state_code||a['ISO3166-2-lvl4']||a.state||'').replace(/^BR-/i,'').trim();
        if(nearState.length>2&&/s[aã]o paulo/i.test(nearState))nearState='SP';
      }
    }catch(e){}
  }

  const candidates=[];
  const push=x=>{x=String(x||'').trim().replace(/\s+/g,' ');if(x&&!candidates.includes(x))candidates.push(x)};
  push(raw);

  const hasCityHint=/,/.test(raw)||/\b(s[aã]o paulo|campinas|indaiatuba|americana|sumar[eé]|hortol[aâ]ndia|valinhos|vinhedo|jundia[ií]|paul[ií]nia)\b/i.test(raw);
  if(!allMatches&&!hasCityHint&&nearCity)push(raw+', '+nearCity+(nearState?', '+nearState:'')+', Brasil');
  push(raw+', Brasil');

  const withoutNumber=raw.replace(/(^|,|\s)\d+[A-Za-z-]*(?=,|\s|$)/g,' ').replace(/\s+/g,' ').replace(/\s+,/g,',').trim();
  if(withoutNumber&&withoutNumber!==raw){
    push(withoutNumber);
    if(!allMatches&&!hasCityHint&&nearCity)push(withoutNumber+', '+nearCity+(nearState?', '+nearState:'')+', Brasil');
    push(withoutNumber+', Brasil');
  }

  async function nominatim(query,timeoutMs=6500,limit=allMatches?20:8){
    try{
      const u=new URL('https://nominatim.openstreetmap.org/search');
      u.searchParams.set('q',query);
      u.searchParams.set('format','jsonv2');
      u.searchParams.set('limit',String(limit));
      u.searchParams.set('countrycodes','br');
      u.searchParams.set('addressdetails','1');
      u.searchParams.set('dedupe','1');
      if(hasNear){
        const d=0.35;
        u.searchParams.set('viewbox',(nlon-d)+','+(nlat+d)+','+(nlon+d)+','+(nlat-d));
        u.searchParams.set('bounded','0');
      }
      const r=await fetch(u,{
        headers:{'User-Agent':'MOVIT-Rotas/1.2 (+https://controle-coletas-jr.onrender.com)','Accept-Language':'pt-BR,pt;q=0.9'},
        signal:AbortSignal.timeout(timeoutMs)
      });
      const j=await r.json().catch(()=>[]);
      if(!r.ok||!Array.isArray(j)||!j.length)return[];
      const rows=j.map(x=>{
        const lat=Number(x.lat),lon=Number(x.lon);
        const a=x.address||{};
        const city=String(a.city||a.town||a.municipality||a.village||a.county||'');
        const state=String(a.state||'');
        const road=String(a.road||a.pedestrian||a.residential||a.path||a.neighbourhood||'');
        const distance=hasNear&&Number.isFinite(lat)&&Number.isFinite(lon)?routePublicHaversine({lat:nlat,lon:nlon},{lat,lon}):0;
        return {
          lat,lon,
          label:x.display_name||query,
          road,city,state,
          precision:a.house_number?'number':'street',
          source:'Nominatim',
          approximate:!a.house_number && /\d/.test(raw),
          _distance:distance
        };
      }).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
      if(hasNear)rows.sort((a,b)=>(a._distance||0)-(b._distance||0));
      rows.forEach(x=>delete x._distance);
      return rows;
    }catch(e){
      console.warn('MOVIT Nominatim falhou',query,String(e?.message||e));
      return[];
    }
  }

  if(allMatches){
    const merged=[],seen=new Set();
    // Busca nacional: consulta com e sem número para encontrar ruas homônimas em cidades diferentes.
    for(const query of candidates.slice(0,4)){
      const rows=await nominatim(query,7000,20);
      for(const row of rows){
        const key=(row.city+'|'+row.state+'|'+row.road+'|'+row.lat.toFixed(5)+'|'+row.lon.toFixed(5)).toLowerCase();
        if(seen.has(key))continue;
        seen.add(key);merged.push(row);
        if(merged.length>=25)break;
      }
      if(merged.length>=25)break;
    }
    if(merged.length)return merged;
  }else{
    for(const query of candidates.slice(0,4)){
      const rows=await nominatim(query);
      if(rows.length)return rows;
    }
  }

  if(nearCity&&!hasCityHint&&!allMatches){
    try{
      const cepHit=await Promise.race([
        routePublicViaCep(raw+', '+nearCity+(nearState?', '+nearState:'')),
        new Promise(resolve=>setTimeout(()=>resolve(null),6500))
      ]);
      if(cepHit)return[cepHit];
    }catch(e){}
  }

  try{
    const cepHit=await Promise.race([
      routePublicViaCep(raw),
      new Promise(resolve=>setTimeout(()=>resolve(null),6500))
    ]);
    if(cepHit)return[cepHit];
  }catch(e){}

  throw Object.assign(new Error('Não localizei essa via no Brasil. Tente falar ou digitar novamente.'),{status:404})
}
async function routePublicTable(points){
  const coords=points.map(p=>p.lon+','+p.lat).join(';');
  const bases=['https://router.project-osrm.org','https://routing.openstreetmap.de/routed-car'];
  for(const base of bases){
    try{
      const r=await fetch(base+'/table/v1/driving/'+coords+'?annotations=distance',{headers:{'User-Agent':'MOVIT-Rotas/0.7'},signal:AbortSignal.timeout(18000)});
      const j=await r.json();
      if(r.ok&&j.code==='Ok'&&Array.isArray(j.distances)){
        return j.distances.map(row=>row.map(v=>Number.isFinite(v)?v:Infinity))
      }
    }catch(e){
      console.warn('MOVIT table falhou',base,String(e?.message||e))
    }
  }
  console.warn('MOVIT usando matriz aproximada por distância geográfica');
  return points.map(a=>points.map(b=>routePublicHaversine(a,b)*1.28))
}
function routePublicCycle(order,m){
  if(!order.length)return 0;let d=m[0][order[0]]||0;
  for(let i=1;i<order.length;i++)d+=m[order[i-1]][order[i]]||0;
  d+=m[order[order.length-1]][0]||0;return d
}
function routePublicOpenDistance(order,m){
  if(!order.length)return 0;
  let d=m[0][order[0]]||0;
  for(let i=1;i<order.length;i++)d+=m[order[i-1]][order[i]]||0;
  return d
}
function routePublicTwoOptOpen(order,m){
  let best=order.slice(),bestD=routePublicOpenDistance(best,m),changed=true,loops=0;
  while(changed&&loops++<10){
    changed=false;
    for(let i=0;i<best.length-1;i++)for(let k=i+1;k<best.length;k++){
      const cand=best.slice(0,i).concat(best.slice(i,k+1).reverse(),best.slice(k+1));
      const d=routePublicOpenDistance(cand,m);
      if(d+1<bestD){best=cand;bestD=d;changed=true}
    }
  }
  return best
}

function routePublicNearest(m,n){
  const left=new Set(Array.from({length:n},(_,i)=>i+1)),out=[];let cur=0;
  while(left.size){let best=null,bd=Infinity;for(const x of left){const d=m[cur]?.[x];if(Number.isFinite(d)&&d<bd){bd=d;best=x}}if(best==null)best=[...left][0];out.push(best);left.delete(best);cur=best}
  return out
}
function routePublicTwoOpt(order,m){
  let best=order.slice(),bestD=routePublicCycle(best,m),changed=true,loops=0;
  while(changed&&loops++<10){changed=false;for(let i=0;i<best.length-1;i++)for(let k=i+1;k<best.length;k++){const cand=best.slice(0,i).concat(best.slice(i,k+1).reverse(),best.slice(k+1)),d=routePublicCycle(cand,m);if(d+1<bestD){best=cand;bestD=d;changed=true}}}
  return best
}
function routePublicAvoidanceHits(geometry,avoidPoints,radiusMeters=500){
  const coords=geometry&&Array.isArray(geometry.coordinates)?geometry.coordinates:[];
  if(!coords.length||!avoidPoints.length)return 0;
  let hits=0;
  for(const a of avoidPoints){
    let best=Infinity;
    const step=Math.max(1,Math.floor(coords.length/1600));
    for(let i=0;i<coords.length;i+=step){
      const x=coords[i],d=routePublicHaversine({lat:Number(a.lat),lon:Number(a.lon)},{lat:Number(x[1]),lon:Number(x[0])});
      if(d<best)best=d;
    }
    if(best<=radiusMeters)hits++;
  }
  return hits
}
async function routePublicGeometry(points,order,returnToStart=true,avoidPoints=[]){
  const seq=returnToStart?[0,...order,0]:[0,...order],coords=seq.map(i=>points[i].lon+','+points[i].lat).join(';');
  const bases=['https://router.project-osrm.org','https://routing.openstreetmap.de/routed-car'];
  const avoid=(Array.isArray(avoidPoints)?avoidPoints:[]).map(x=>({lat:Number(x.lat),lon:Number(x.lon),name:String(x.name||'Pedágio')}))
    .filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)).slice(0,12);
  let best=null;
  for(const base of bases){
    for(const alternatives of (avoid.length?[true,false]:[false])){
      try{
        const url=base+'/route/v1/driving/'+coords+'?overview=full&geometries=geojson&steps=false'+(alternatives?'&alternatives=true':'');
        const r=await fetch(url,{headers:{'User-Agent':'MOVIT-Rotas/1.4'},signal:AbortSignal.timeout(20000)});
        const j=await r.json();
        if(!r.ok||j.code!=='Ok'||!Array.isArray(j.routes)||!j.routes.length)continue;
        for(const candidate of j.routes){
          const hits=routePublicAvoidanceHits(candidate.geometry,avoid,500);
          candidate.avoidanceHits=hits;
          if(!best||hits<best.avoidanceHits||(hits===best.avoidanceHits&&Number(candidate.distance||Infinity)<Number(best.distance||Infinity)))best=candidate;
        }
        if(best&&best.avoidanceHits===0)return best;
        if(best&&!avoid.length)return best;
      }catch(e){
        console.warn('MOVIT geometry falhou',base,String(e?.message||e))
      }
    }
  }
  if(best)return best;
  throw Object.assign(new Error('O serviço de rotas está temporariamente indisponível. Tente novamente em alguns segundos.'),{status:503})
}


// ---------- MOVIT: rota do dia do motorista da empresa ----------
const MOVIT_DAY_CACHE=new Map();
function movitAddressText(p){
  const rua=[String(p.endereco||'').trim(),String(p.numero||'').trim()].filter(Boolean).join(', ');
  const cidade=[String(p.cidade||'').trim(),String(p.uf||'').trim()].filter(Boolean).join(' - ');
  return [rua,String(p.bairro||'').trim(),cidade].filter(Boolean).join(', ')
}
// Converte uma parada do planejamento (romaneio lido do SSW) para o formato do MOVIT.
function movitStopFromPlan(p,seq){
  const destinatario=String(p.destinatario||p.cliente||'').trim();
  const address=movitAddressText(p);
  const exact=String(p.precision||'')==='ssw-coordenada';
  const hasStreet=!!String(p.endereco||'').trim();
  return{
    seq,lat:Number(p.lat),lon:Number(p.lon),
    label:destinatario||String(p.label||'Entrega '+seq),
    resolved:address||String(p.displayName||p.label||''),
    // Sem coordenada exata do SSW, o aplicativo de navegação recebe o endereço escrito:
    // ele acha o número da casa melhor do que a posição aproximada do nosso mapa.
    original:hasStreet?address+', Brasil':'',
    approximate:!exact,precision:String(p.precision||''),
    destinatario,nf:String(p.nf||''),ctrc:String(p.ctrc||''),
    cidade:String(p.cidade||''),uf:String(p.uf||''),bairro:String(p.bairro||''),cep:String(p.cep||''),
    romaneio:String(p.sourceRomaneio||''),
    entregue:!!p.entregue,baixaAt:String(p.baixaAt||'')
  }
}
function movitDayFromPlan(plan){
  const points=Array.isArray(plan?.points)?plan.points:[];
  const order=Array.isArray(plan?.optimizedOrder)&&plan.optimizedOrder.length?plan.optimizedOrder:points.map((_,i)=>i).slice(1);
  const stops=[];
  for(const idx of order){
    const p=points[idx];
    if(!p||!Number.isFinite(Number(p.lat))||!Number.isFinite(Number(p.lon))||p.precision==='base'||p.precision==='fixed-end')continue;
    stops.push(movitStopFromPlan(p,stops.length+1))
  }
  const base=points[0]&&Number.isFinite(Number(points[0].lat))?{lat:Number(points[0].lat),lon:Number(points[0].lon),label:String(points[0].label||plan.baseAddress||'Base'),resolved:String(points[0].address||points[0].label||plan.baseAddress||'Base')}:null;
  return{
    stops,start:base,returnToStart:true,
    geometry:plan?.outboundGeometry||plan?.geometry||null,
    distanceMeters:Number(plan?.geometryDistanceMeters||plan?.optimizedDistanceMeters||0)||0,
    durationSeconds:Number(plan?.durationSeconds||0)||0,
    romaneios:Array.isArray(plan?.romaneios)&&plan.romaneios.length?plan.romaneios.map(String):String(plan?.romaneio||'').split('+').map(x=>x.trim()).filter(Boolean),
    approximate:!!plan?.approximate
  }
}
async function movitCompanyLinkFromReq(req){
  const token=routerBearer(req);
  if(!token){const e=new Error('Este celular não está vinculado à empresa.');e.status=401;throw e}
  const q=await pool.query(
    "SELECT id::text AS id,driver_name,vehicle_plate FROM router_company_links WHERE token_hash=$1 AND active=TRUE LIMIT 1",
    [dashboardTokenHash(token)]
  );
  if(!q.rowCount){const e=new Error('Vínculo com a empresa não encontrado. Abra a rota pelo aplicativo CONSTRULOG Motorista.');e.status=401;throw e}
  return q.rows[0]
}
async function movitBuildDay(link){
  const today=spToday();
  const out={ok:true,date:today,driver_name:link.driver_name,vehicle_plate:link.vehicle_plate||'',company:'CONSTRULOG',
    romaneios:[],source:'',stops:[],start:null,returnToStart:true,geometry:null,distanceMeters:0,durationSeconds:0,message:'',updated_at:new Date().toISOString()};
  const a=await pool.query(
    `SELECT romaneios FROM driver_tracking_assignments
     WHERE active=TRUE AND work_date=$1::date
       AND (lower(trim(driver_name))=lower(trim($2))
            OR (COALESCE($3,'')<>'' AND upper(trim(COALESCE(vehicle_plate,'')))=upper(trim($3))))
     ORDER BY updated_at DESC,id DESC LIMIT 1`,
    [today,link.driver_name,link.vehicle_plate||'']
  );
  const roms=a.rowCount&&Array.isArray(a.rows[0].romaneios)?a.rows[0].romaneios.map(String):[];
  out.romaneios=roms;
  // 1) Rota que a operação já montou/ajustou e exportou para este romaneio tem prioridade.
  const mr=await pool.query(
    `SELECT romaneio,title,route_data,updated_at FROM movit_romaneio_routes
     WHERE event_date=$1::date AND (romaneio=ANY($2::text[]) OR lower(trim(driver_name))=lower(trim($3)))
     ORDER BY (romaneio=ANY($2::text[])) DESC,updated_at DESC LIMIT 1`,
    [today,roms,link.driver_name]
  );
  if(mr.rowCount){
    const d=mr.rows[0].route_data||{},list=Array.isArray(d.stops)?d.stops:[];
    const stops=list.filter(x=>Number.isFinite(Number(x?.lat))&&Number.isFinite(Number(x?.lon))).map((x,i)=>({
      ...x,seq:i+1,lat:Number(x.lat),lon:Number(x.lon),
      label:String(x.destinatario||x.label||x.resolved||'Parada '+(i+1)),resolved:String(x.resolved||x.label||''),
      destinatario:String(x.destinatario||''),nf:String(x.nf||''),entregue:!!x.entregue
    }));
    if(stops.length){
      const st=d.start&&Number.isFinite(Number(d.start.lat))&&Number.isFinite(Number(d.start.lon))?d.start:null;
      Object.assign(out,{source:'movit',stops,start:st,returnToStart:d.returnToStart!==false,geometry:d.geometry||null,
        distanceMeters:Number(d.distanceMeters||0)||0,durationSeconds:Number(d.durationSeconds||0)||0});
      if(!out.romaneios.length&&mr.rows[0].romaneio)out.romaneios=[String(mr.rows[0].romaneio)];
      return out
    }
  }
  // 2) Romaneio do dia lido do SSW pelo dashboard (mesma rota planejada do Mapa ao Vivo).
  try{
    const qs=new URLSearchParams({date:today,driver:link.driver_name,plate:link.vehicle_plate||''});
    const r=await fetch('http://'+DASH_INTERNAL_HOST+':'+DASH_INTERNAL_PORT+'/api/tracking/planned-route?'+qs.toString(),{
      headers:{'X-Internal-Key':INTERNAL_KEY,'Accept':'application/json'},signal:AbortSignal.timeout(90000)
    });
    const j=await r.json().catch(()=>({}));
    if(r.ok&&j.ok){
      const day=movitDayFromPlan(j);
      Object.assign(out,day,{source:'ssw'});
      if(!out.stops.length)out.message='O romaneio de hoje foi encontrado, mas nenhuma entrega pôde ser localizada no mapa.';
      return out
    }
    out.message=r.status===404?'Ainda não há romaneio para você hoje. Assim que sair, a rota aparece aqui.'
      :'Não consegui carregar a rota agora. Toque em Atualizar em alguns instantes.';
    out.pending=r.status!==404
  }catch(e){
    out.message='Não consegui carregar a rota agora. Toque em Atualizar em alguns instantes.';
    out.pending=true
  }
  return out
}

function routerBearer(req){
  const m=String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);
  return m?m[1].trim():'';
}
async function routerUserFromReq(req){
  const token=routerBearer(req);
  if(!token){const e=new Error('Faça login para continuar.');e.status=401;throw e}
  const q=await pool.query("SELECT u.id::text,u.email,u.name,u.plan,u.active FROM router_app_sessions s JOIN router_app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE LIMIT 1",[dashboardTokenHash(token)]);
  if(!q.rowCount){const e=new Error('Sessão expirada. Entre novamente.');e.status=401;throw e}
  return q.rows[0]
}
async function routerCreateSession(userId){
  const token=crypto.randomBytes(32).toString('hex');
  await pool.query('DELETE FROM router_app_sessions WHERE expires_at<=NOW()');
  await pool.query("INSERT INTO router_app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')",[dashboardTokenHash(token),userId]);
  return token
}
function routerPlanLimits(plan){
  const p=String(plan||'free').toLowerCase();
  if(p==='pro')return{routesPerMonth:500,maxStops:100};
  if(p==='business')return{routesPerMonth:5000,maxStops:200};
  return{routesPerMonth:15,maxStops:30}
}
async function routerMonthlyUsage(userId){
  const q=await pool.query("SELECT COUNT(*)::int AS n FROM router_app_routes WHERE user_id=$1 AND created_at>=date_trunc('month',NOW())",[userId]);
  return Number(q.rows[0]?.n||0)
}

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw new Error('JSON inválido'); }
}

async function readJsonBodyLimited(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const e = new Error('Arquivo muito grande. Tire a foto novamente.');
      e.status = 413;
      throw e;
    }
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); }
  catch {
    const e = new Error('Dados inválidos.');
    e.status = 400;
    throw e;
  }
}

function parseImageDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!m) {
    const e = new Error('Foto inválida.');
    e.status = 400;
    throw e;
  }
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > 900 * 1024) {
    const e = new Error('A foto deve ter no máximo 900 KB após a compactação.');
    e.status = 413;
    throw e;
  }
  return { mime, buffer };
}

function parseDocumentDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(application\/pdf|image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!m) {
    const e = new Error('Documento inválido. Envie PDF, JPG, PNG ou WEBP.');
    e.status = 400;
    throw e;
  }
  let mime = m[1].toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > 7 * 1024 * 1024) {
    const e = new Error('O documento deve ter no máximo 7 MB.');
    e.status = 413;
    throw e;
  }
  return { mime, buffer };
}



function dashboardHashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function dashboardVerifyPassword(password, salt, expectedHash) {
  try {
    const actual = crypto.scryptSync(String(password), String(salt), 64);
    const expected = Buffer.from(String(expectedHash), 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
function dashboardTokenHash(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function dashboardCookie(req, name='cl_session') {
  const raw=String(req.headers.cookie||'');
  for(const part of raw.split(';')){
    const i=part.indexOf('=');
    if(i<0)continue;
    const k=part.slice(0,i).trim();
    if(k===name){try{return decodeURIComponent(part.slice(i+1).trim())}catch{return part.slice(i+1).trim()}}
  }
  return '';
}
function dashboardBearer(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : dashboardCookie(req);
}
function dashboardSetCookie(token,maxAge=14*24*60*60){
  return 'cl_session='+encodeURIComponent(token||'')+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;
}
function dashboardPerms(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') { try { const p=JSON.parse(v); return Array.isArray(p)?p.map(String):[]; } catch { return []; } }
  return [];
}
function dashboardHas(user,perm){return !!(user&&(user.is_admin||user.permissions?.includes('*')||user.permissions?.includes(perm)))}
async function dashboardUserContext(row){
  let client=null,clientModules=[];
  if(row?.client_id){
    const cq=await pool.query("SELECT id::text,name,slug,status,plan,monthly_fee,due_day FROM movit_clients WHERE id=$1 LIMIT 1",[row.client_id]);
    if(cq.rowCount){
      client=cq.rows[0];
      const mq=await pool.query("SELECT module_key FROM movit_client_modules WHERE client_id=$1 AND enabled=TRUE ORDER BY module_key",[row.client_id]);
      clientModules=mq.rows.map(x=>String(x.module_key));
    }
  }
  return {
    id:String(row.id),username:row.username,is_admin:!!row.is_admin,active:!!row.active,
    permissions:row.is_admin?['*']:dashboardPerms(row.permissions),
    client_id:row.client_id==null?null:String(row.client_id),
    is_platform_admin:!!row.is_platform_admin,
    client,
    client_modules:clientModules
  };
}
async function dashboardSession(req, adminOnly=false) {
  const token=dashboardBearer(req);
  if(!token){const e=new Error('Sessão não informada.');e.status=401;throw e}
  const r=await pool.query("SELECT u.id::text AS id,u.username,u.is_admin,u.active,u.permissions,u.client_id,u.is_platform_admin FROM dashboard_sessions s JOIN dashboard_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE LIMIT 1",[dashboardTokenHash(token)]);
  if(!r.rowCount){const e=new Error('Sessão expirada ou inválida.');e.status=401;throw e}
  const row=r.rows[0];
  if(adminOnly&&!row.is_admin){const e=new Error('Acesso exclusivo do administrador.');e.status=403;throw e}
  return dashboardUserContext(row);
}
// Chamada interna do dashboard (mesma máquina), identificada pela chave gerada na inicialização.
function isInternalCall(req){
  const given=Buffer.from(String(req.headers['x-internal-key']||''));
  const expected=Buffer.from(INTERNAL_KEY);
  return given.length===expected.length&&crypto.timingSafeEqual(given,expected);
}
// Aceita sessão de usuário OU chamada interna do dashboard. Sem nenhuma das duas: 401.
// O dashboard já conferiu a permissão do usuário antes de fazer a chamada interna.
async function sessionOrInternal(req){
  if(isInternalCall(req))return {id:null,username:'(dashboard interno)',is_admin:true,active:true,permissions:['*'],client_id:null,is_platform_admin:false,client:null,client_modules:[],internal:true};
  return dashboardSession(req,false);
}
async function dashboardPlatformSession(req){
  const user=await dashboardSession(req,true);
  if(!user.is_platform_admin){const e=new Error('Acesso exclusivo da administração MOVIT.');e.status=403;throw e}
  return user;
}
async function dashboardCreateSession(userId, days=14){
  const token=crypto.randomBytes(32).toString('hex');
  const safeDays=Math.max(1,Math.min(365,Number(days)||14));
  await pool.query('DELETE FROM dashboard_sessions WHERE expires_at<=NOW()');
  await pool.query("INSERT INTO dashboard_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+($3 * INTERVAL '1 day'))",[dashboardTokenHash(token),userId,safeDays]);
  return token;
}

function trackingBearer(req){
  const m=String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);
  return m?m[1].trim():'';
}
// Um aparelho "vivo" é o que deu sinal nos últimos 10 minutos DEPOIS de ter sido criado.
// A aprovação grava last_seen_at igual a enrolled_at (mesma transação), então last_seen_at
// maior que enrolled_at é a prova de que o celular conectou de verdade pelo menos uma vez.
const TRACKING_SIBLING_ALIVE_SQL=`
  SELECT 1 FROM driver_tracking_devices o
  WHERE o.active=TRUE AND o.id<>$1
    AND lower(trim(o.driver_name))=lower(trim($2))
    AND upper(trim(COALESCE(o.vehicle_plate,'')))=upper(trim(COALESCE($3,'')))
    AND o.last_seen_at>=NOW()-INTERVAL '10 minutes'
    AND o.last_seen_at>o.enrolled_at`;
async function trackingDeviceFromReq(req){
  const token=trackingBearer(req);
  if(!token){const e=new Error('Dispositivo não autenticado.');e.status=401;throw e}
  const q=await pool.query(
    "SELECT id::text AS id, driver_name, vehicle_plate, active, enrolled_at FROM driver_tracking_devices WHERE token_hash=$1 LIMIT 1",
    [dashboardTokenHash(token)]
  );
  if(!q.rowCount){const e=new Error('Dispositivo não autorizado.');e.status=401;throw e}
  const dev=q.rows[0];
  if(!dev.active){
    // O aparelho só fica inativo quando outra aprovação do mesmo motorista/placa o substitui.
    // Se o substituto nunca conectou (pedido antigo aprovado por engano, celular que não
    // buscou a nova credencial), este aparelho volta a valer sozinho em vez de ficar mudo.
    const sib=await pool.query(TRACKING_SIBLING_ALIVE_SQL+' LIMIT 1',[dev.id,dev.driver_name,dev.vehicle_plate||'']);
    if(sib.rowCount){const e=new Error('Dispositivo substituído por outro aparelho.');e.status=401;throw e}
    await pool.query('UPDATE driver_tracking_devices SET active=TRUE,reactivated_at=NOW() WHERE id=$1',[dev.id]);
    dev.active=true;
    console.log('TRACKING AUTO-REATIVACAO: '+JSON.stringify({deviceId:dev.id,driver:dev.driver_name,plate:dev.vehicle_plate||''}));
  }
  return dev
}
// Quando dois aparelhos do mesmo motorista/placa estão ativos e vivos, vale o mais novo.
async function trackingYieldToNewerDevice(dev){
  const newer=await pool.query(TRACKING_SIBLING_ALIVE_SQL+' AND o.enrolled_at>$4 LIMIT 1',[dev.id,dev.driver_name,dev.vehicle_plate||'',dev.enrolled_at]);
  if(!newer.rowCount)return false;
  await pool.query('UPDATE driver_tracking_devices SET active=FALSE WHERE id=$1',[dev.id]);
  return true
}
function trackingCleanHealth(h){
  if(!h||typeof h!=='object'||Array.isArray(h))return null;
  const out={};
  const bool=k=>{if(typeof h[k]==='boolean')out[k]=h[k]};
  const num=(k,min,max)=>{const v=Number(h[k]);if(h[k]!==null&&h[k]!==undefined&&h[k]!==''&&Number.isFinite(v)&&v>=min&&v<=max)out[k]=v};
  const str=(k,n)=>{if(typeof h[k]==='string'&&h[k].trim())out[k]=h[k].trim().slice(0,n)};
  ['perm_location','perm_background','perm_notifications','battery_unrestricted','gps_on','charging','power_save','tracking','exact_alarms','service_running'].forEach(bool);
  num('battery_pct',0,100);num('last_fix_age_s',0,864000);num('queued_points',0,100000);num('restarts',0,1000000);num('android_sdk',1,200);num('version_code',0,1000000);
  str('net',16);str('last_error',160);
  return Object.keys(out).length?out:null
}
function trackingPhoneDigits(v){
  let d=String(v||'').replace(/\D/g,'');
  if(d.startsWith('0'))d=d.replace(/^0+/,'');
  if(d.length===10||d.length===11)d='55'+d;
  return d.length>=12&&d.length<=13?d:''
}
function trackingContactKey(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim()
}
function trackingLatestApp(){
  try{
    const item=(JSON.parse(fs.readFileSync(DRIVER_UPDATE_FILE,'utf8'))||{}).normal||{};
    const code=Number(item.versionCode||0);
    return code>0?{latest_version_code:code,latest_version_name:String(item.versionName||''),apk_url:DRIVER_PUBLIC_BASE+String(item.url||'')}:{}
  }catch(e){return {}}
}
function trackingCode(){
  return String(Math.floor(100000+Math.random()*900000))
}
function trackingHistoryDistanceMeters(a,b){
  const lat1=Number(a?.latitude),lon1=Number(a?.longitude),lat2=Number(b?.latitude),lon2=Number(b?.longitude);
  if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return 0;
  const R=6371000,rad=Math.PI/180,dLat=(lat2-lat1)*rad,dLon=(lon2-lon1)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)))
}
const TRACKING_BASE_POINT={latitude:-22.69552,longitude:-47.307};
const TRACKING_MAX_DISTANCE_METERS=450000;
function trackingPointPlausible(lat,lon){
  const latitude=Number(lat),longitude=Number(lon);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return false;
  if(latitude<-90||latitude>90||longitude<-180||longitude>180)return false;
  return trackingHistoryDistanceMeters(
    TRACKING_BASE_POINT,
    {latitude,longitude}
  )<=TRACKING_MAX_DISTANCE_METERS
}
function trackingHistoryStops(points,minMinutes=5,radiusMeters=150){
  const pts=(points||[]).filter(p=>Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&p.captured_at);
  const out=[];let i=0;
  while(i<pts.length){
    let j=i,sumLat=Number(pts[i].latitude),sumLon=Number(pts[i].longitude),count=1;
    let center={latitude:sumLat,longitude:sumLon};
    while(j+1<pts.length){
      const next=pts[j+1];
      if(trackingHistoryDistanceMeters(center,next)>radiusMeters)break;
      j++;sumLat+=Number(next.latitude);sumLon+=Number(next.longitude);count++;
      center={latitude:sumLat/count,longitude:sumLon/count};
    }
    if(j>i){
      const start=new Date(pts[i].captured_at),end=new Date(pts[j].captured_at);
      const seconds=Math.max(0,Math.round((end-start)/1000));
      if(seconds>=minMinutes*60){
        out.push({
          latitude:center.latitude,longitude:center.longitude,
          arrived_at:pts[i].captured_at,left_at:pts[j].captured_at,
          duration_seconds:seconds,point_count:j-i+1
        })
      }
    }
    i=Math.max(i+1,j+1)
  }
  return out
}
function trackingHistorySessionSummary(session){
  const points=session.points||[];
  let meters=0;
  for(let i=1;i<points.length;i++){
    const d=trackingHistoryDistanceMeters(points[i-1],points[i]);
    if(Number.isFinite(d)&&d<5000)meters+=d
  }
  const stops=trackingHistoryStops(points);
  return Object.assign(session,{stops,distance_km:Math.round(meters)/1000})
}
async function duplicateColetaMinimal(id, novaData, clientId=null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(novaData || ''))) {
    const e = new Error('Nova data inválida.'); e.status = 400; throw e;
  }
  const meta = await pool.query(`
    SELECT column_name, data_type, is_nullable, is_identity, is_generated, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='coletas'
    ORDER BY ordinal_position
  `);
  const originalResult = clientId ? await pool.query('SELECT * FROM coletas WHERE id::text=$1 AND client_id=$2 LIMIT 1',[id,clientId]) : await pool.query('SELECT * FROM coletas WHERE id::text=$1 LIMIT 1',[id]);
  if (!originalResult.rowCount) { const e=new Error('Coleta não encontrada.'); e.status=404; throw e; }
  const original=originalResult.rows[0], names=new Set(meta.rows.map(x=>x.column_name));
  const first=(arr)=>arr.find(x=>names.has(x));
  const like=(patterns)=>{const hit=meta.rows.find(m=>patterns.some(re=>re.test(String(m.column_name||'').toLowerCase())));return hit?.column_name||null;};

  let dateCol=first(['data_carregamento','data_coleta','data_agendada','data_agendamento','data_solicitacao','data_programada','collection_date','pickup_date','data','date']);
  if(!dateCol) dateCol=like([/data.*colet/,/colet.*data/,/data.*agend/,/agend.*data/,/data.*program/,/program.*data/,/collection.*date/,/pickup.*date/]);
  if(!dateCol){
    const candidates=meta.rows.filter(m=>
      /date|timestamp/.test(String(m.data_type||'')) &&
      !['created_at','updated_at','data_recebimento','previsao_pagamento_fatura','payment_date','due_date'].includes(m.column_name)
    );
    if(candidates.length===1) dateCol=candidates[0].column_name;
  }
  if(!dateCol){
    console.error('Duplicação: coluna de data não localizada. Colunas disponíveis:',meta.rows.map(x=>x.column_name).join(', '));
    const e=new Error('Não consegui localizar automaticamente a data da coleta. Tente novamente após atualizar a página.');
    e.status=500;
    throw e;
  }

  const remetente=first(['cliente_remetente','remetente','nome_remetente','shipper']) || like([/remetente/,/cliente.*origem/]);
  const destinatario=first(['destinatario','nome_destinatario','recipient','cliente_destinatario']) || like([/destinat/,/recipient/]);
  const enderecoColeta=first(['endereco_coleta','endereco_origem','collection_address','pickup_address','origem']) || like([/endereco.*colet/,/colet.*endereco/,/endereco.*origem/,/pickup.*address/]);
  const enderecoEntrega=first(['endereco_entrega','endereco_destino','delivery_address','destino']) || like([/endereco.*entreg/,/entreg.*endereco/,/endereco.*destino/,/delivery.*address/]);

  const preserve=new Set([remetente,destinatario,enderecoColeta,enderecoEntrega].filter(Boolean));

  const cols=[], vals=[];
  for(const m of meta.rows){
    const col=m.column_name;
    if(m.is_identity==='YES'||m.is_generated==='ALWAYS') continue;
    if(col==='id'){
      if(m.data_type==='uuid'){cols.push(col);vals.push(crypto.randomUUID());}
      continue;
    }
    if(col==='created_at'||col==='updated_at') continue;
    cols.push(col);
    if(col===dateCol) vals.push(novaData);
    else if(preserve.has(col)) vals.push(original[col]);
    else if(col==='recebido') vals.push(false);
    else if(col==='data_recebimento'||col==='previsao_pagamento_fatura') vals.push(null);
    else if(m.column_default!=null) { cols.pop(); continue; }
    else if(m.is_nullable==='YES') vals.push(null);
    else if(/char|text|json/.test(m.data_type)) vals.push('');
    else if(/int|numeric|decimal|real|double/.test(m.data_type)) vals.push(0);
    else if(m.data_type==='boolean') vals.push(false);
    else if(m.data_type==='date') vals.push(novaData);
    else if(/timestamp/.test(m.data_type)) vals.push(new Date());
    else if(m.data_type==='uuid') vals.push(crypto.randomUUID());
    else vals.push(original[col] ?? null);
  }
  const qCols=cols.map(x=>'"'+x.replace(/"/g,'""')+'"').join(',');
  const placeholders=vals.map((_,i)=>'$'+(i+1)).join(',');
  const inserted=await pool.query('INSERT INTO coletas ('+qCols+') VALUES ('+placeholders+') RETURNING id::text AS id',vals);
  return inserted.rows[0];
}

async function migrateLegacyBillsIfNeeded() {
  try {
    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM bills');
    const current = countResult.rows[0]?.total || 0;
    if (current > 0) {
      console.log('Contas a Pagar no Aiven: ' + current + ' registro(s). Migracao automatica dispensada.');
      return;
    }

    const response = await fetch('https://contas-jr.onrender.com/api/bills', {
      headers: { 'User-Agent': 'PainelTransportadora-Migracao/1.0' },
      signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bills = await response.json();
    if (!Array.isArray(bills) || bills.length === 0) {
      console.log('Sistema antigo sem contas para migrar.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const b of bills) {
        await client.query(
          `INSERT INTO bills
          (id, recurrence_group, description, supplier, area, category, amount, due_date, original_due_date, status, payment_date, postponed_count, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (id) DO NOTHING`,
          [
            b.id,
            b.recurrence_group || null,
            b.description || '',
            b.supplier || '',
            b.area || 'Pessoal',
            b.category || 'Outros',
            Number(b.amount || 0),
            String(b.due_date || '').slice(0, 10),
            b.original_due_date ? String(b.original_due_date).slice(0, 10) : null,
            b.status === 'paid' ? 'paid' : 'pending',
            b.payment_date ? String(b.payment_date).slice(0, 10) : null,
            Number(b.postponed_count || 0),
            b.created_at || new Date().toISOString(),
            b.updated_at || b.created_at || new Date().toISOString()
          ]
        );
      }
      await client.query('COMMIT');
      console.log('Migracao Contas a Pagar concluida: ' + bills.length + ' registro(s) copiados para o Aiven.');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Migracao automatica do Contas a Pagar nao concluida:', e.message);
  }
}


async function start() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL nao configurada');
  await Promise.all([initDb(), initColetasDb()]);
  await pool.query(`CREATE TABLE IF NOT EXISTS router_app_users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS router_app_sessions (
    id BIGSERIAL PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    user_id BIGINT NOT NULL REFERENCES router_app_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_router_app_sessions_user ON router_app_sessions(user_id,expires_at DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS router_app_routes (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES router_app_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    route_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_router_app_routes_user ON router_app_routes(user_id,updated_at DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS router_shared_routes (
    id BIGSERIAL PRIMARY KEY,
    share_token TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    driver_name TEXT NOT NULL DEFAULT '',
    event_date DATE,
    route_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_router_shared_routes_token ON router_shared_routes(share_token)');
  await pool.query(`CREATE TABLE IF NOT EXISTS movit_romaneio_routes (
    id BIGSERIAL PRIMARY KEY,
    romaneio TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    event_date DATE NOT NULL,
    title TEXT NOT NULL,
    route_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    source TEXT NOT NULL DEFAULT 'MOVIT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (romaneio,event_date)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movit_romaneio_routes_driver_date ON movit_romaneio_routes(lower(driver_name),event_date DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movit_romaneio_routes_romaneio ON movit_romaneio_routes(romaneio,event_date DESC)');

  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS recebido BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS data_recebimento DATE');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS previsao_pagamento_fatura DATE');
  await pool.query(`CREATE TABLE IF NOT EXISTS driver_tracking_test_devices (
    id BIGSERIAL PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    driver_name TEXT NOT NULL,
    vehicle_plate TEXT,
    device_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS driver_tracking_test_points (
    id BIGSERIAL PRIMARY KEY,
    test_device_id BIGINT NOT NULL REFERENCES driver_tracking_test_devices(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy_m DOUBLE PRECISION,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_test_points_device_time ON driver_tracking_test_points(test_device_id,captured_at DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS driver_tracking_assignments (
    id BIGSERIAL PRIMARY KEY,
    invite_token_hash TEXT UNIQUE NOT NULL,
    driver_name TEXT NOT NULL,
    vehicle_plate TEXT,
    romaneios JSONB NOT NULL DEFAULT '[]'::jsonb,
    work_date DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_assignments_plate_date ON driver_tracking_assignments (upper(vehicle_plate),work_date DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_assignments_driver_date ON driver_tracking_assignments (lower(driver_name),work_date DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS driver_tracking_test_assignments (
    id BIGSERIAL PRIMARY KEY,
    invite_token_hash TEXT UNIQUE NOT NULL,
    driver_name TEXT NOT NULL,
    vehicle_plate TEXT,
    romaneios JSONB NOT NULL DEFAULT '[]'::jsonb,
    work_date DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_test_assignments_plate_date ON driver_tracking_test_assignments (upper(vehicle_plate),work_date DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS agendamento_teste (
    id BIGSERIAL PRIMARY KEY,
    nf TEXT NOT NULL,
    ctrc TEXT,
    cliente TEXT,
    cidade TEXT,
    uf TEXT,
    status_ssw TEXT,
    mercadoria TEXT,
    peso NUMERIC(14,3) NOT NULL DEFAULT 0,
    volumes NUMERIC(14,3) NOT NULL DEFAULT 0,
    previsao_ssw TEXT,
    dia_rota TEXT,
    agendado BOOLEAN NOT NULL DEFAULT FALSE,
    data_agendamento DATE,
    criado_por BIGINT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_agendamento_teste_nf ON agendamento_teste (nf)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_agendamento_teste_data ON agendamento_teste (data_agendamento DESC, criado_em DESC)');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS destinatario TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS motorista_cpf TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS motorista_rg TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS placa_carreta TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS capacidade_carga_cavalo TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS eixos_cavalo INTEGER');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS capacidade_carga_carreta TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS eixos_carreta INTEGER');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coleta_documentos (
      id BIGSERIAL PRIMARY KEY,
      coleta_id TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('motorista','cavalo','carreta')),
      nome_arquivo TEXT NOT NULL,
      mime TEXT NOT NULL,
      arquivo BYTEA NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (coleta_id, tipo)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_coleta_documentos_coleta ON coleta_documentos (coleta_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carregamentos_finais (
      id BIGSERIAL PRIMARY KEY,
      conferente TEXT NOT NULL,
      motorista TEXT NOT NULL,
      quantidade_entregas INTEGER NOT NULL CHECK (quantidade_entregas >= 0),
      foto BYTEA NOT NULL,
      foto_mime TEXT NOT NULL DEFAULT 'image/jpeg',
      foto_bytes INTEGER NOT NULL DEFAULT 0,
      capturada_em TIMESTAMPTZ NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_carregamentos_finais_capturada_em ON carregamentos_finais (capturada_em DESC)');
  await pool.query("ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'carregamento'");
  await pool.query("UPDATE carregamentos_finais SET tipo='carregamento' WHERE tipo IS NULL OR trim(tipo)=''");
  await pool.query("ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS conferente_coleta_devolucao TEXT");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS carregamentos_avarias (
      id BIGSERIAL PRIMARY KEY,
      carregamento_id BIGINT NOT NULL REFERENCES carregamentos_finais(id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL CHECK (ordem BETWEEN 1 AND 10),
      foto BYTEA NOT NULL,
      foto_mime TEXT NOT NULL DEFAULT 'image/jpeg',
      foto_bytes INTEGER NOT NULL DEFAULT 0,
      capturada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(carregamento_id, ordem)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_carregamentos_avarias_registro ON carregamentos_avarias (carregamento_id, ordem)');
  for (const n of [2,3,4]) {
    await pool.query(`ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS foto${n} BYTEA`);
    await pool.query(`ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS foto${n}_mime TEXT`);
    await pool.query(`ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS foto${n}_bytes INTEGER NOT NULL DEFAULT 0`);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nf_materiais (
      id BIGSERIAL PRIMARY KEY,
      chave TEXT NOT NULL,
      nf TEXT NOT NULL,
      emitente_cnpj TEXT,
      emitente_nome TEXT,
      cliente TEXT,
      cidade TEXT,
      uf TEXT,
      classificacao TEXT NOT NULL DEFAULT 'normal',
      produtos JSONB NOT NULL DEFAULT '[]'::jsonb,
      importado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_materiais_chave ON nf_materiais (chave)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_nf_materiais_nf ON nf_materiais (nf)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_nf_materiais_classificacao ON nf_materiais (classificacao)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_enrollments (
      id BIGSERIAL PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      driver_name TEXT NOT NULL,
      vehicle_plate TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_enrollments_exp ON driver_tracking_enrollments (expires_at DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_devices (
      id BIGSERIAL PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      driver_name TEXT NOT NULL,
      vehicle_plate TEXT,
      device_name TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_devices_driver ON driver_tracking_devices (lower(driver_name))');
  // Diagnóstico enviado pelo próprio aplicativo (versão, permissões, GPS, bateria) e
  // registro de quando um aparelho substituído voltou a valer sozinho.
  await pool.query("ALTER TABLE driver_tracking_devices ADD COLUMN IF NOT EXISTS app_version TEXT");
  await pool.query("ALTER TABLE driver_tracking_devices ADD COLUMN IF NOT EXISTS health JSONB");
  await pool.query("ALTER TABLE driver_tracking_devices ADD COLUMN IF NOT EXISTS health_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE driver_tracking_devices ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ");
  // Vínculo do MOVIT com um motorista da empresa. Nasce de um código de uso único pedido pelo
  // aplicativo CONSTRULOG Motorista (que já foi liberado pela central), então o MOVIT não
  // precisa de cadastro nem de aprovação própria para receber a rota do dia.
  await pool.query(`CREATE TABLE IF NOT EXISTS router_company_links (
    id BIGSERIAL PRIMARY KEY,
    code_hash TEXT UNIQUE,
    code_expires_at TIMESTAMPTZ,
    token_hash TEXT UNIQUE,
    device_id BIGINT REFERENCES driver_tracking_devices(id) ON DELETE CASCADE,
    driver_name TEXT NOT NULL,
    vehicle_plate TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_router_company_links_device ON router_company_links(device_id)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_contacts (
      driver_key TEXT PRIMARY KEY,
      driver_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by BIGINT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_requests (
      id BIGSERIAL PRIMARY KEY,
      request_token_hash TEXT NOT NULL UNIQUE,
      driver_name TEXT NOT NULL,
      vehicle_plate TEXT,
      device_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      issued_token TEXT,
      approved_device_id BIGINT REFERENCES driver_tracking_devices(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ,
      decided_by BIGINT
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_requests_status ON driver_tracking_requests (status, created_at DESC)');
  await pool.query("ALTER TABLE driver_tracking_requests ADD COLUMN IF NOT EXISTS issued_token TEXT");
  await pool.query("ALTER TABLE driver_tracking_requests ADD COLUMN IF NOT EXISTS approved_device_id BIGINT");
  await pool.query("ALTER TABLE driver_tracking_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE driver_tracking_requests ADD COLUMN IF NOT EXISTS decided_by BIGINT");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_sessions (
      id BIGSERIAL PRIMARY KEY,
      device_id BIGINT NOT NULL REFERENCES driver_tracking_devices(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_sessions_device ON driver_tracking_sessions (device_id, started_at DESC)');
  // Dispositivos recém-aprovados já entram com uma sessão ativa, mesmo se o app
  // ainda não tiver chamado /session/start. Isso evita sumir do mapa após a aprovação.
  await pool.query(`
    INSERT INTO driver_tracking_sessions(device_id,status)
    SELECT d.id,'active'
    FROM driver_tracking_devices d
    JOIN (
      SELECT DISTINCT ON (lower(trim(driver_name)), upper(trim(COALESCE(vehicle_plate,''))))
             id
      FROM driver_tracking_devices
      WHERE active=TRUE
        AND enrolled_at >= NOW()-INTERVAL '1 day'
        AND last_seen_at > enrolled_at
      ORDER BY lower(trim(driver_name)), upper(trim(COALESCE(vehicle_plate,''))), enrolled_at DESC, id DESC
    ) latest ON latest.id=d.id
    WHERE NOT EXISTS (
      SELECT 1 FROM driver_tracking_sessions s WHERE s.device_id=d.id
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_points (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL REFERENCES driver_tracking_sessions(id) ON DELETE CASCADE,
      device_id BIGINT NOT NULL REFERENCES driver_tracking_devices(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      accuracy_m REAL,
      speed_mps REAL,
      bearing_deg REAL,
      battery_pct REAL,
      captured_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_points_device_time ON driver_tracking_points (device_id, captured_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_points_session_time ON driver_tracking_points (session_id, captured_at DESC)');

  await pool.query("CREATE TABLE IF NOT EXISTS dashboard_users (id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE, permissions JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_users_username_lower ON dashboard_users (lower(username))');
  await pool.query('CREATE TABLE IF NOT EXISTS dashboard_sessions (token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_exp ON dashboard_sessions (expires_at)');
  await pool.query(`CREATE TABLE IF NOT EXISTS fleet_state (
    id INTEGER PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{"vehicles":[],"fuel":[],"maintenance":[],"tires":[],"people":[],"documents":[],"checklists":[]}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO fleet_state(id,data) VALUES(1,'{"vehicles":[],"fuel":[],"maintenance":[],"tires":[],"people":[],"documents":[],"checklists":[]}'::jsonb) ON CONFLICT (id) DO NOTHING`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fleet_maintenance_files (
    maintenance_id TEXT PRIMARY KEY,
    nome_arquivo TEXT NOT NULL,
    mime TEXT NOT NULL,
    arquivo BYTEA NOT NULL,
    bytes INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE TABLE IF NOT EXISTS dashboard_embed_tickets (ticket_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_dashboard_embed_tickets_exp ON dashboard_embed_tickets (expires_at)');
  await pool.query(`CREATE TABLE IF NOT EXISTS movit_modules (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Operação',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS movit_clients (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    document TEXT,
    email TEXT,
    phone TEXT,
    plan TEXT NOT NULL DEFAULT 'Personalizado',
    monthly_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    due_day INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'pilot',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_movit_clients_slug_lower ON movit_clients(lower(slug))');
  await pool.query(`CREATE TABLE IF NOT EXISTS movit_client_modules (
    client_id BIGINT NOT NULL REFERENCES movit_clients(id) ON DELETE CASCADE,
    module_key TEXT NOT NULL REFERENCES movit_modules(key) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(client_id,module_key)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS movit_payments (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT NOT NULL REFERENCES movit_clients(id) ON DELETE CASCADE,
    reference_month DATE NOT NULL,
    due_date DATE,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    paid_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(client_id,reference_month)
  )`);
  const movitSeedModules=[
    ['lotacao','Lotação','Logística'],
    ['coletas','Coletas','Lotação'],
    ['financeiro_lotacao','Financeiro Lotação','Lotação'],
    ['operacao','Operação','Operação'],
    ['visao_geral','Visão Geral','Operação'],
    ['dashboards','Dashboards','Operação'],
    ['agendamento','Agendamento','Operação'],
    ['programacao','Programação','Operação'],
    ['roteirizador','Roteirizador','Operação'],
    ['rastreio','Rastreio de Carga','Operação'],
    ['financeiro_operacoes','Financeiro Operações','Operação'],
    ['frota','Frota','Gestão'],
    ['contas_pagar','Contas a Pagar','Gestão'],
    ['usuarios','Usuários','Administração'],
    ['app_movit','App MOVIT','Aplicativo']
  ];
  for(const m of movitSeedModules){
    await pool.query('INSERT INTO movit_modules(key,name,category) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,updated_at=NOW()',m);
  }
  const construlogSeed=await pool.query("INSERT INTO movit_clients(name,slug,plan,monthly_fee,due_day,status,notes) VALUES('CONSTRULOG','construlog','Personalizado',0,10,'pilot','Cliente inicial / piloto da plataforma MOVIT') ON CONFLICT DO NOTHING RETURNING id");
  let construlogId=construlogSeed.rows[0]?.id;
  if(!construlogId){
    const cq=await pool.query("SELECT id FROM movit_clients WHERE lower(slug)='construlog' LIMIT 1");
    construlogId=cq.rows[0]?.id;
  }
  if(construlogId){
    const initialModules=['lotacao','coletas','financeiro_lotacao','operacao','visao_geral','dashboards','agendamento','programacao','roteirizador','rastreio','frota','contas_pagar','usuarios'];
    for(const moduleKey of initialModules){
      await pool.query('INSERT INTO movit_client_modules(client_id,module_key,enabled) VALUES($1,$2,TRUE) ON CONFLICT(client_id,module_key) DO NOTHING',[construlogId,moduleKey]);
    }
  }
  // Fase 1 multiempresa: vincula os usuários atuais ao cliente CONSTRULOG.
  await pool.query('ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES movit_clients(id)');
  await pool.query('ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE');
  if(construlogId){
    await pool.query('UPDATE dashboard_users SET client_id=$1 WHERE client_id IS NULL',[construlogId]);
  }
  // Administradores já existentes são considerados administradores MOVIT nesta migração inicial.
  await pool.query('UPDATE dashboard_users SET is_platform_admin=TRUE WHERE is_admin=TRUE AND is_platform_admin=FALSE');

  // Marca dados operacionais atuais como pertencentes à CONSTRULOG sem alterar ainda as consultas existentes.
  if(construlogId){
    const tenantTables=['bills','coletas','driver_tracking_devices','driver_tracking_assignments','driver_tracking_test_devices','driver_tracking_test_assignments','agendamento_teste'];
    for(const tableName of tenantTables){
      try{
        await pool.query('ALTER TABLE '+tableName+' ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES movit_clients(id)');
        await pool.query('UPDATE '+tableName+' SET client_id=$1 WHERE client_id IS NULL',[construlogId]);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_'+tableName+'_client_id ON '+tableName+'(client_id)');
      }catch(e){
        console.warn('Migração multiempresa pendente para '+tableName+': '+e.message);
      }
    }
  }
  const adminUser=String(process.env.DASHBOARD_INITIAL_ADMIN_USER||'Junior').trim();
  const adminPass=String(process.env.DASHBOARD_INITIAL_ADMIN_PASSWORD||'').trim();
  if(adminUser&&adminPass){
    const existing=await pool.query('SELECT id FROM dashboard_users WHERE lower(username)=lower($1) LIMIT 1',[adminUser]);
    if(!existing.rowCount){
      const ph=dashboardHashPassword(adminPass);
      await pool.query("INSERT INTO dashboard_users(username,password_salt,password_hash,is_admin,active,permissions) VALUES($1,$2,$3,TRUE,TRUE,'[]'::jsonb)",[adminUser,ph.salt,ph.hash]);
      console.log('Administrador inicial do dashboard criado: '+adminUser);
    }
  }
  // No modo teste não importa nada do sistema antigo (traria contas reais para o banco de teste).
  if (!TEST_MODE) await migrateLegacyBillsIfNeeded();
  else console.log('TEST_MODE: importação do sistema antigo de contas desativada.');
  startUnifiedDashboardChild();
  

  http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');

      // Torre de Controle unificada: dashboard e APIs do dashboard rodam neste mesmo serviço.
      if(u.pathname==='/dashboard'||u.pathname.startsWith('/dashboard/')){
        const sub=u.pathname.replace(/^\/dashboard/,'')||'/';
        return proxyDashboard(req,res,sub+(u.search||''))
      }
      if(isDashboardApiPath(u.pathname)){
        return proxyDashboard(req,res,u.pathname+(u.search||''))
      }

      // Aplicativo CONSTRULOG Motorista pede um código de uso único para abrir o MOVIT já
      // identificado como este motorista/placa (o aparelho já foi liberado pela central).
      if (u.pathname === '/api/tracking/movit-link' && req.method === 'POST') {
        try{
          const device=await trackingDeviceFromReq(req);
          const code=crypto.randomBytes(12).toString('hex');
          await pool.query("DELETE FROM router_company_links WHERE token_hash IS NULL AND (code_expires_at<NOW() OR device_id=$1)",[device.id]);
          await pool.query(
            "INSERT INTO router_company_links(code_hash,code_expires_at,device_id,driver_name,vehicle_plate) VALUES($1,NOW()+INTERVAL '10 minutes',$2,$3,$4)",
            [dashboardTokenHash(code),device.id,device.driver_name,device.vehicle_plate||'']
          );
          return sendJson(res,201,{ok:true,code,app_url:'movit://empresa/'+code,download_url:DRIVER_PUBLIC_BASE+'/downloads/MOVIT.apk',expires_minutes:10});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao preparar a rota do dia.'})}
      }

      if (u.pathname === '/api/router-app/company/claim' && req.method === 'POST') {
        try{
          if(!publicRouteAllowed(req))return sendJson(res,429,{ok:false,error:'Muitas tentativas. Aguarde um minuto.'});
          const body=await readJsonBodyLimited(req,16*1024);
          const code=String(body.code||'').trim().toLowerCase();
          if(!/^[a-f0-9]{24}$/.test(code))return sendJson(res,400,{ok:false,error:'Código inválido.'});
          const token=crypto.randomBytes(32).toString('hex');
          const q=await pool.query(
            `UPDATE router_company_links
             SET token_hash=$2,code_hash=NULL,code_expires_at=NULL,claimed_at=NOW(),last_used_at=NOW()
             WHERE code_hash=$1 AND token_hash IS NULL AND code_expires_at>NOW() AND active=TRUE
             RETURNING id::text AS id,device_id,driver_name,vehicle_plate`,
            [dashboardTokenHash(code),dashboardTokenHash(token)]
          );
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Código vencido ou já usado. Abra de novo pelo aplicativo CONSTRULOG Motorista.'});
          const row=q.rows[0];
          // Um vínculo por aparelho de rastreio: o novo substitui os anteriores.
          await pool.query("UPDATE router_company_links SET active=FALSE WHERE device_id=$1 AND id<>$2 AND active=TRUE",[row.device_id,row.id]);
          return sendJson(res,200,{ok:true,company_token:token,company:'CONSTRULOG',driver_name:row.driver_name,vehicle_plate:row.vehicle_plate||''});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao vincular o aplicativo.'})}
      }

      if (u.pathname === '/api/router-app/company/today' && req.method === 'GET') {
        try{
          const link=await movitCompanyLinkFromReq(req);
          const hit=MOVIT_DAY_CACHE.get(link.id),fresh=u.searchParams.get('fresh')==='1';
          // A rota do SSW é cara de montar: reaproveita por 3 minutos (30 s quando o motorista pede).
          // Resposta vazia vale só 20 s, para a rota aparecer logo depois que o romaneio sai.
          const ttl=hit&&!hit.value.stops.length?20000:(fresh?30000:180000);
          if(hit&&hit.value.date===spToday()&&Date.now()-hit.at<ttl)return sendJson(res,200,hit.value);
          const value=await movitBuildDay(link);
          MOVIT_DAY_CACHE.set(link.id,{at:Date.now(),value});
          if(MOVIT_DAY_CACHE.size>500)MOVIT_DAY_CACHE.delete(MOVIT_DAY_CACHE.keys().next().value);
          pool.query('UPDATE router_company_links SET last_used_at=NOW() WHERE id=$1',[link.id]).catch(()=>{});
          return sendJson(res,200,value);
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar a rota do dia.'})}
      }

      if (u.pathname === '/api/router-app/register' && req.method === 'POST') {
        try{
          const body=await readJsonBodyLimited(req,64*1024);
          const email=String(body.email||'').trim().toLowerCase().slice(0,180);
          let name=String(body.name||'').trim().slice(0,120);
          const password=String(body.password||'');
          console.log('MOVIT REGISTER tentativa',email);
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return sendJson(res,400,{ok:false,error:'Informe um e-mail válido.'});
          if(password.length<6)return sendJson(res,400,{ok:false,error:'A senha deve ter pelo menos 6 caracteres.'});
          if(name.length<2)name=email.split('@')[0].replace(/[._-]+/g,' ').trim()||'Usuário MOVIT';

          const existing=await pool.query("SELECT id::text,email,name,plan,active,password_salt,password_hash FROM router_app_users WHERE email=$1 LIMIT 1",[email]);
          if(existing.rowCount){
            const user=existing.rows[0];
            if(!user.active)return sendJson(res,403,{ok:false,error:'Esta conta está desativada.'});
            if(!dashboardVerifyPassword(password,user.password_salt,user.password_hash)){
              return sendJson(res,409,{ok:false,error:'Este e-mail já está cadastrado. Use a mesma senha para entrar ou toque em Entrar.'})
            }
            const token=await routerCreateSession(user.id),limits=routerPlanLimits(user.plan),usage=await routerMonthlyUsage(user.id);
            console.log('MOVIT REGISTER existente autenticado',email);
            return sendJson(res,200,{ok:true,token,existing:true,user:{id:user.id,email:user.email,name:user.name,plan:user.plan,limits,usage}})
          }

          const ph=dashboardHashPassword(password);
          const q=await pool.query("INSERT INTO router_app_users(email,name,password_salt,password_hash) VALUES($1,$2,$3,$4) RETURNING id::text,email,name,plan",[email,name,ph.salt,ph.hash]);
          const user=q.rows[0],token=await routerCreateSession(user.id),limits=routerPlanLimits(user.plan);
          console.log('MOVIT REGISTER criada',email);
          return sendJson(res,201,{ok:true,token,user:{...user,limits,usage:0}})
        }catch(e){
          console.error('MOVIT REGISTER erro',String(e?.message||e));
          return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao criar conta.'})
        }
      }

      if (u.pathname === '/api/router-app/login' && req.method === 'POST') {
        try{
          const body=await readJsonBodyLimited(req,64*1024);
          const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
          const q=await pool.query("SELECT id::text,email,name,plan,active,password_salt,password_hash FROM router_app_users WHERE email=$1 LIMIT 1",[email]);
          if(!q.rowCount||!q.rows[0].active||!dashboardVerifyPassword(password,q.rows[0].password_salt,q.rows[0].password_hash))return sendJson(res,401,{ok:false,error:'E-mail ou senha inválidos.'});
          const user=q.rows[0],token=await routerCreateSession(user.id),limits=routerPlanLimits(user.plan),usage=await routerMonthlyUsage(user.id);
          return sendJson(res,200,{ok:true,token,user:{id:user.id,email:user.email,name:user.name,plan:user.plan,limits,usage}})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao entrar.'})}
      }

      if (u.pathname === '/api/router-app/me' && req.method === 'GET') {
        try{
          const user=await routerUserFromReq(req),limits=routerPlanLimits(user.plan),usage=await routerMonthlyUsage(user.id);
          return sendJson(res,200,{ok:true,user:{...user,limits,usage}})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar conta.'})}
      }

      if (u.pathname === '/api/router-app/routes' && req.method === 'GET') {
        try{
          const user=await routerUserFromReq(req);
          const q=await pool.query("SELECT id::text,name,route_data,created_at,updated_at FROM router_app_routes WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100",[user.id]);
          return sendJson(res,200,{ok:true,rows:q.rows})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar rotas.'})}
      }

      if (u.pathname === '/api/router-app/routes' && req.method === 'POST') {
        try{
          const user=await routerUserFromReq(req),limits=routerPlanLimits(user.plan),usage=await routerMonthlyUsage(user.id);
          if(usage>=limits.routesPerMonth)return sendJson(res,402,{ok:false,error:'Limite mensal do plano atingido.',upgrade_required:true,limits,usage});
          const body=await readJsonBodyLimited(req,1024*1024);
          const name=String(body.name||'Minha rota').trim().slice(0,160)||'Minha rota';
          const data=body.route_data&&typeof body.route_data==='object'?body.route_data:{};
          const stops=Array.isArray(data.stops)?data.stops:[];
          if(stops.length>limits.maxStops)return sendJson(res,400,{ok:false,error:'Seu plano permite até '+limits.maxStops+' paradas por rota.'});
          const q=await pool.query("INSERT INTO router_app_routes(user_id,name,route_data) VALUES($1,$2,$3::jsonb) RETURNING id::text,name,route_data,created_at,updated_at",[user.id,name,JSON.stringify(data)]);
          return sendJson(res,201,{ok:true,row:q.rows[0],usage:usage+1,limits})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao salvar rota.'})}
      }

      if (u.pathname.match(/^\/api\/router-app\/routes\/\d+$/) && req.method === 'DELETE') {
        try{
          const user=await routerUserFromReq(req),id=u.pathname.split('/').pop();
          const q=await pool.query("DELETE FROM router_app_routes WHERE id=$1 AND user_id=$2 RETURNING id",[id,user.id]);
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Rota não encontrada.'});
          return sendJson(res,200,{ok:true})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao excluir rota.'})}
      }

      if (u.pathname === '/api/public-router/share' && req.method === 'POST') {
        try{
          if(!publicRouteAllowed(req))return sendJson(res,429,{ok:false,error:'Muitas consultas. Aguarde um minuto.'});
          const body=await readJsonBodyLimited(req,1024*1024);
          const driver=String(body.driver_name||'').trim().slice(0,120);
          const eventDate=String(body.event_date||'').trim().slice(0,10);
          const title=String(body.title||'').trim().slice(0,180)||[driver,eventDate].filter(Boolean).join(' ')||'Rota MOVIT';
          const routeData=body.route_data&&typeof body.route_data==='object'?body.route_data:{};
          const stops=Array.isArray(routeData.stops)?routeData.stops:[];
          if(!stops.length)return sendJson(res,400,{ok:false,error:'A rota precisa ter pelo menos uma parada para compartilhar.'});
          const token=crypto.randomBytes(10).toString('hex');
          await pool.query("INSERT INTO router_shared_routes(share_token,title,driver_name,event_date,route_data) VALUES($1,$2,$3,$4::date,$5::jsonb)",[
            token,title,driver,eventDate||null,JSON.stringify(routeData)
          ]);
          const base=DRIVER_PUBLIC_BASE;
          return sendJson(res,201,{ok:true,token,title,shareUrl:base+'/movit/rota/'+token,appUrl:'movit://route/'+token})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao compartilhar rota.'})}
      }

      if (u.pathname.match(/^\/api\/public-router\/share\/[a-f0-9]{20}$/) && req.method === 'GET') {
        try{
          const token=u.pathname.split('/').pop();
          const q=await pool.query("SELECT title,driver_name,event_date::text,route_data,created_at FROM router_shared_routes WHERE share_token=$1 LIMIT 1",[token]);
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Rota compartilhada não encontrada.'});
          return sendJson(res,200,{ok:true,...q.rows[0],token})
        }catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao abrir rota compartilhada.'})}
      }

      if (u.pathname.match(/^\/movit\/rota\/[a-f0-9]{20}$/) && req.method === 'GET') {
        try{
          const token=u.pathname.split('/').pop();
          const q=await pool.query("SELECT title,driver_name,event_date::text,route_data FROM router_shared_routes WHERE share_token=$1 LIMIT 1",[token]);
          if(!q.rowCount){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});return res.end('<h2>Rota não encontrada</h2>')}
          const row=q.rows[0],data=row.route_data||{},stops=Array.isArray(data.stops)?data.stops:[];
          const esc=s=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
          const list=stops.map((s,i)=>'<div class="stop"><b>'+(i+1)+'. '+esc(s.label||s.resolved||'Parada')+'</b><div>'+esc(s.resolved||'')+'</div></div>').join('');
          const html='<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>'+esc(row.title)+'</title><style>body{font-family:system-ui;margin:0;background:#f7f9fc;color:#16142f}.wrap{max-width:620px;margin:auto;padding:20px}.card{background:#fff;border-radius:20px;padding:18px;box-shadow:0 4px 20px #0001;margin-bottom:14px}.btn{display:block;text-align:center;background:#2f73e8;color:#fff;text-decoration:none;font-weight:700;padding:16px;border-radius:14px}.stop{padding:12px 0;border-bottom:1px solid #e6ebf2}.muted{color:#667085;font-size:14px}</style></head><body><div class="wrap"><div class="card"><h2>MOVIT</h2><h3>'+esc(row.title)+'</h3><div class="muted">'+stops.length+' paradas</div></div><div class="card"><a class="btn" href="movit://route/'+token+'">Abrir esta rota no MOVIT</a></div><div class="card">'+list+'</div></div></body></html>';
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html)
        }catch(e){res.writeHead(500,{'Content-Type':'text/html; charset=utf-8'});return res.end('<h2>Erro ao abrir rota</h2>')}
      }

      if (u.pathname === '/api/public-router/export-construlog' && req.method === 'POST') {
        try{
          if(!publicRouteAllowed(req))return sendJson(res,429,{ok:false,error:'Muitas consultas. Aguarde um minuto.'});
          const body=await readJsonBodyLimited(req,1024*1024);
          const romaneio=String(body.romaneio||'').trim().replace(/\s+/g,' ').slice(0,80);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const eventDate=String(body.event_date||'').trim().slice(0,10);
          const title=String(body.title||'').trim().slice(0,180)||[driver,eventDate].filter(Boolean).join(' ');
          const routeData=body.route_data&&typeof body.route_data==='object'?body.route_data:{};
          const stops=Array.isArray(routeData.stops)?routeData.stops:[];
          if(!romaneio)return sendJson(res,400,{ok:false,error:'Informe o número do romaneio.'});
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Informe o motorista.'});
          if(!/^\d{4}-\d{2}-\d{2}$/.test(eventDate))return sendJson(res,400,{ok:false,error:'Data do evento inválida.'});
          if(!stops.length)return sendJson(res,400,{ok:false,error:'A rota precisa ter ao menos uma parada.'});

          await pool.query(
            `INSERT INTO movit_romaneio_routes(romaneio,driver_name,event_date,title,route_data,updated_at)
             VALUES($1,$2,$3::date,$4,$5::jsonb,NOW())
             ON CONFLICT (romaneio,event_date) DO UPDATE SET
               driver_name=EXCLUDED.driver_name,title=EXCLUDED.title,route_data=EXCLUDED.route_data,updated_at=NOW()`,
            [romaneio,driver,eventDate,title,JSON.stringify(routeData)]
          );

          // Se já existir uma associação de rastreio para este motorista/data,
          // acrescenta o romaneio sem apagar os demais.
          const a=await pool.query(
            `SELECT id,romaneios FROM driver_tracking_assignments
             WHERE active=TRUE AND work_date=$1::date
               AND lower(trim(driver_name))=lower(trim($2))
             ORDER BY updated_at DESC,id DESC LIMIT 1`,
            [eventDate,driver]
          );
          let linked=false;
          if(a.rowCount){
            const current=Array.isArray(a.rows[0].romaneios)?a.rows[0].romaneios:[];
            const next=[...new Set([...current.map(String),romaneio])].slice(0,20);
            await pool.query("UPDATE driver_tracking_assignments SET romaneios=$1::jsonb,updated_at=NOW() WHERE id=$2",[JSON.stringify(next),a.rows[0].id]);
            linked=true;
          }

          return sendJson(res,200,{ok:true,romaneio,driver_name:driver,event_date:eventDate,linked_to_tracking:linked,
            message:linked?'Rota enviada à CONSTRULOG e associada ao rastreamento.':'Rota enviada à CONSTRULOG. O romaneio ficará disponível para o mapa quando o motorista estiver associado no rastreamento.'});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao enviar rota para a CONSTRULOG.'})}
      }

      if (u.pathname === '/api/public-router/test-tracking/start' && req.method === 'POST') {
        try{
          if(!publicRouteAllowed(req))return sendJson(res,429,{ok:false,error:'Muitas consultas. Aguarde um minuto.'});
          const body=await readJsonBodyLimited(req,1024*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const romaneio=String(body.romaneio||'').trim().replace(/\s+/g,' ').slice(0,80);
          const eventDate=/^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date||''))?String(body.event_date):(new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}));
          const routeData=body.route_data&&typeof body.route_data==='object'?body.route_data:{};
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Informe o motorista do teste.'});
          if(!romaneio)return sendJson(res,400,{ok:false,error:'Informe o romaneio do teste.'});

          let plate='TESTE001';
          const real=await pool.query(
            `SELECT vehicle_plate,romaneios FROM driver_tracking_assignments
             WHERE work_date=$1::date
               AND active=TRUE
               AND (
                 lower(trim(driver_name))=lower(trim($2))
                 OR romaneios ? $3
               )
             ORDER BY updated_at DESC,id DESC LIMIT 1`,
            [eventDate,driver,romaneio]
          );
          if(real.rowCount&&String(real.rows[0].vehicle_plate||'').trim())plate=String(real.rows[0].vehicle_plate).trim().toUpperCase();

          const token=crypto.randomBytes(32).toString('hex');
          const dev=await pool.query(
            "INSERT INTO driver_tracking_test_devices(token_hash,driver_name,vehicle_plate,device_name,last_seen_at) VALUES($1,$2,$3,$4,NOW()) RETURNING id::text AS id",
            [dashboardTokenHash(token),driver,plate,'MOVIT Teste - celular do administrador']
          );

          await pool.query(
            `UPDATE driver_tracking_test_assignments
             SET active=FALSE
             WHERE work_date=$1::date
               AND lower(trim(driver_name))=lower(trim($2))`,
            [eventDate,driver]
          );
          await pool.query(
            "INSERT INTO driver_tracking_test_assignments(invite_token_hash,driver_name,vehicle_plate,romaneios,work_date,active) VALUES($1,$2,$3,$4::jsonb,$5::date,TRUE)",
            [dashboardTokenHash(token),driver,plate,JSON.stringify([romaneio]),eventDate]
          );

          if(Array.isArray(routeData.stops)&&routeData.stops.length){
            const title=String(body.title||driver+' '+eventDate).slice(0,180);
            await pool.query(
              `INSERT INTO movit_romaneio_routes(romaneio,driver_name,event_date,title,route_data,updated_at)
               VALUES($1,$2,$3::date,$4,$5::jsonb,NOW())
               ON CONFLICT (romaneio,event_date) DO UPDATE SET
                 driver_name=EXCLUDED.driver_name,title=EXCLUDED.title,route_data=EXCLUDED.route_data,updated_at=NOW()`,
              [romaneio,driver,eventDate,title,JSON.stringify(routeData)]
            );
          }

          return sendJson(res,201,{ok:true,test_only:true,token,test_device_id:dev.rows[0].id,driver_name:driver,vehicle_plate:plate,romaneio,event_date:eventDate});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao iniciar teste MOVIT/CONSTRULOG.'})}
      }

      if (req.method === 'GET' && u.pathname === '/movit/privacidade') {
        const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de Privacidade - MOVIT</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:820px;margin:0 auto;padding:28px;color:#18142f;line-height:1.55}h1,h2{color:#18142f}a{color:#2f73e8}.box{background:#f7f9fc;border:1px solid #e5e7eb;border-radius:14px;padding:16px}</style></head><body>
        <h1>Política de Privacidade do MOVIT</h1>
        <p>Última atualização: 6 de outubro de 2026.</p>
        <p>O MOVIT é um aplicativo de roteirização para criação, otimização e compartilhamento de rotas de entrega.</p>
        <h2>Dados tratados</h2>
        <p>O aplicativo pode tratar endereços informados pelo usuário, coordenadas de latitude e longitude, nome do motorista, número de romaneio, data da rota e dados técnicos necessários para calcular e compartilhar rotas.</p>
        <h2>Localização</h2>
        <p>A localização do aparelho é acessada somente quando o usuário solicita usar a localização atual como ponto de partida ou utiliza uma função de rastreamento/teste disponibilizada fora da versão pública da Play Store. A versão pública da Play Store não executa rastreamento contínuo em segundo plano.</p>
        <h2>Finalidades</h2>
        <p>Os dados são usados para localizar endereços, otimizar a sequência das paradas, desenhar rotas, abrir destinos em aplicativos de navegação, compartilhar rotas e, quando aplicável, integrar a operação ao sistema CONSTRULOG.</p>
        <h2>Compartilhamento</h2>
        <p>Para geocodificação e cálculo de rotas, dados de endereço e coordenadas podem ser enviados a serviços de mapas e roteamento. Quando o usuário cria um link de compartilhamento, os dados necessários da rota ficam armazenados em nossos servidores para que o destinatário possa abrir a mesma rota.</p>
        <h2>Retenção e exclusão</h2>
        <p>Rotas salvas localmente permanecem no aparelho até serem removidas pelo usuário. Links e rotas enviados ao servidor podem ser mantidos enquanto forem necessários para a funcionalidade e operação do serviço. Solicitações de exclusão podem ser feitas pelo canal de suporte informado na página do aplicativo na Google Play.</p>
        <h2>Segurança</h2>
        <p>Adotamos medidas técnicas para proteger os dados em trânsito e restringir o acesso aos recursos do serviço.</p>
        <h2>Contato</h2>
        <div class="box">Suporte MOVIT: junior.controle68@gmail.com</div>
        </body></html>`;
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=300'});
        return res.end(html);
      }

      if (req.method === 'GET' && u.pathname === '/movit/termos') {
        const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Termos de Uso - MOVIT</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:820px;margin:0 auto;padding:28px;color:#18142f;line-height:1.55}h1,h2{color:#18142f}</style></head><body>
        <h1>Termos de Uso do MOVIT</h1><p>Última atualização: 6 de outubro de 2026.</p>
        <p>O MOVIT auxilia no planejamento e navegação de rotas. O usuário é responsável por conferir endereços, condições da via, restrições de trânsito, segurança e regras aplicáveis ao veículo antes de iniciar o deslocamento.</p>
        <p>Resultados de geocodificação, distância e tempo são estimativas e podem variar conforme os dados cartográficos, trânsito, obras e condições reais da via.</p>
        <p>Ao compartilhar uma rota, o usuário declara possuir autorização para usar os dados operacionais envolvidos e reconhece que o destinatário do link poderá visualizar os pontos compartilhados.</p>
        <p>Contato: junior.controle68@gmail.com</p></body></html>`;
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=300'});
        return res.end(html);
      }

      if (u.pathname === '/api/public-router/geocode' && req.method === 'GET') {
        try{
          if(!publicRouteAllowed(req))return sendJson(res,429,{ok:false,error:'Muitas consultas. Aguarde um minuto.'});
          const q=String(u.searchParams.get('q')||'').trim().slice(0,250);
          if(q.length<4)return sendJson(res,400,{ok:false,error:'Informe ao menos o nome da rua.'});
          const lat=Number(u.searchParams.get('lat')),lon=Number(u.searchParams.get('lon'));
          const allMatches=u.searchParams.get('all')==='1';
          const rows=await routePublicGeocode(q,lat,lon,allMatches);
          return sendJson(res,200,{ok:true,rows});
        }catch(e){return sendJson(res,e.status||502,{ok:false,error:e.message||'Falha ao localizar endereço.'})}
      }

      if (u.pathname === '/api/public-router/fuel-stations' && req.method === 'POST') {
        try{
          if(!publicRouteAllowed(req))return sendJson(res,429,{ok:false,error:'Muitas consultas. Aguarde um minuto.'});
          const body=await readJsonBodyLimited(req,512*1024);
          const lat=Number(body.lat),lon=Number(body.lon);
          if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180){
            return sendJson(res,400,{ok:false,error:'Localização atual inválida.'});
          }

          const geom=body.geometry&&Array.isArray(body.geometry.coordinates)?body.geometry.coordinates:[];
          const routePoints=geom.map(x=>({lat:Number(x[1]),lon:Number(x[0])})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
          const radius=routePoints.length?22000:12000;
          const q='[out:json][timeout:18];('+
            'node["amenity"="fuel"](around:'+radius+','+lat+','+lon+');'+
            'way["amenity"="fuel"](around:'+radius+','+lat+','+lon+');'+
            'relation["amenity"="fuel"](around:'+radius+','+lat+','+lon+');'+
            ');out center tags;';
          let data=null,lastErr=null;
          for(const base of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']){
            try{
              const r=await fetch(base,{
                method:'POST',
                headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','User-Agent':'MOVIT-Rotas/1.0'},
                body:'data='+encodeURIComponent(q),
                signal:AbortSignal.timeout(22000)
              });
              const j=await r.json();
              if(r.ok&&Array.isArray(j.elements)){data=j;break}
            }catch(e){lastErr=e}
          }
          if(!data)throw Object.assign(new Error('Serviço de postos temporariamente indisponível. Tente novamente.'),{status:503,cause:lastErr});

          const routeCum=[];
          if(routePoints.length){
            routeCum.push(0);
            for(let i=1;i<routePoints.length;i++){
              routeCum.push(routeCum[i-1]+routePublicHaversine(routePoints[i-1],routePoints[i]));
            }
          }
          function nearestRouteInfo(p){
            if(!routePoints.length)return {offset:null,index:-1,progress:null};
            let best=Infinity,bestIdx=-1;
            const step=Math.max(1,Math.floor(routePoints.length/900));
            for(let i=0;i<routePoints.length;i+=step){
              const d=routePublicHaversine(p,routePoints[i]);
              if(d<best){best=d;bestIdx=i}
            }
            // Refina ao redor do melhor ponto amostrado.
            const lo=Math.max(0,bestIdx-step),hi=Math.min(routePoints.length-1,bestIdx+step);
            for(let i=lo;i<=hi;i++){
              const d=routePublicHaversine(p,routePoints[i]);
              if(d<best){best=d;bestIdx=i}
            }
            return {offset:best,index:bestIdx,progress:bestIdx>=0?routeCum[bestIdx]:null};
          }
          const currentRoute=nearestRouteInfo({lat,lon});

          const raw=[];
          const seen=new Set();
          for(const el of data.elements){
            const plat=Number(el.lat??el.center?.lat),plon=Number(el.lon??el.center?.lon);
            if(!Number.isFinite(plat)||!Number.isFinite(plon))continue;
            const key=plat.toFixed(5)+','+plon.toFixed(5);
            if(seen.has(key))continue;seen.add(key);
            const tags=el.tags||{};
            const p={lat:plat,lon:plon};
            const routeInfo=nearestRouteInfo(p);
            const off=routeInfo.offset;
            const ahead=(routePoints.length&&Number.isFinite(routeInfo.progress)&&Number.isFinite(currentRoute.progress))
              ? routeInfo.progress-currentRoute.progress
              : null;
            // Se há rota calculada, manter postos praticamente no trajeto e evitar os que já ficaram para trás.
            if(routePoints.length&&Number.isFinite(off)&&off>1800)continue;
            if(routePoints.length&&Number.isFinite(ahead)&&ahead<-800)continue;
            raw.push({
              id:String(el.type||'')+String(el.id||''),
              name:String(tags.name||tags.brand||'Posto de combustível').slice(0,160),
              brand:String(tags.brand||'').slice(0,120),
              operator:String(tags.operator||'').slice(0,120),
              lat:plat,lon:plon,
              routeOffsetMeters:Number.isFinite(off)?off:null,
              routeProgressMeters:Number.isFinite(routeInfo.progress)?routeInfo.progress:null,
              aheadMeters:Number.isFinite(ahead)?Math.max(0,ahead):null,
              directMeters:routePublicHaversine({lat,lon},p),
              openingHours:String(tags.opening_hours||'').slice(0,180)
            });
          }

          raw.sort((a,b)=>{
            if(routePoints.length){
              const aa=Number.isFinite(a.aheadMeters)?a.aheadMeters:Infinity;
              const bb=Number.isFinite(b.aheadMeters)?b.aheadMeters:Infinity;
              if(aa!==bb)return aa-bb;
            }
            return a.directMeters-b.directMeters;
          });
          const candidates=raw.slice(0,18);
          if(!candidates.length)return sendJson(res,200,{ok:true,rows:[],routeFiltered:routePoints.length>0});

          const matrix=await routePublicTable([{lat,lon},...candidates.map(x=>({lat:x.lat,lon:x.lon}))]);
          const rows=candidates.map((s,i)=>({
            ...s,
            distanceMeters:Number.isFinite(matrix?.[0]?.[i+1])?matrix[0][i+1]:s.directMeters*1.28
          })).sort((a,b)=>{
            if(routePoints.length){
              const aa=Number.isFinite(a.aheadMeters)?a.aheadMeters:Infinity;
              const bb=Number.isFinite(b.aheadMeters)?b.aheadMeters:Infinity;
              if(aa!==bb)return aa-bb;
            }
            return a.distanceMeters-b.distanceMeters;
          }).slice(0,10);

          return sendJson(res,200,{
            ok:true,
            rows,
            routeFiltered:routePoints.length>0,
            maxRouteOffsetMeters:routePoints.length?1800:null,
            note:routePoints.length
              ?'Postos à frente, até aproximadamente 1,8 km do trajeto atual. A distância “à frente” é estimada sobre a linha da rota.'
              :'Rota ainda não otimizada; mostrando postos próximos da localização atual.'
          });
        }catch(e){return sendJson(res,e.status||502,{ok:false,error:e.message||'Falha ao localizar postos.'})}
      }

      if (u.pathname === '/api/public-router/tolls' && req.method === 'POST') {
        try{
          if(!publicRouteAllowed(req))return sendJson(res,429,{ok:false,error:'Muitas consultas. Aguarde um minuto.'});
          const body=await readJsonBodyLimited(req,1024*1024);
          const geom=body.geometry&&Array.isArray(body.geometry.coordinates)?body.geometry.coordinates:[];
          if(geom.length<2)return sendJson(res,400,{ok:false,error:'Otimize a rota antes de calcular os pedágios.'});

          const vehicle=body.vehicle&&typeof body.vehicle==='object'?body.vehicle:{};
          const type=String(vehicle.type||'Carro');
          let axles=Math.max(1,Math.min(9,Number(vehicle.axles)||1));
          if(/carro|moto/i.test(type))axles=1;

          // Fonte principal de pedágios: QualP. Mantemos a base pública abaixo como fallback.
          const qualpToken=String(process.env.QUALP_API_KEY||'').trim();
          const qualpLocations=Array.isArray(body.locations)?body.locations.map(x=>String(x||'').trim()).filter(Boolean):[];
          if(qualpToken&&qualpLocations.length>=2){
            try{
              const qualpTruck=/vuc|3\/4|toco|truck|carreta|caminh/i.test(type);
              const qualpAxis=qualpTruck?Math.max(2,Math.min(9,Number(vehicle.axles)||2)):2;
              const qr=await fetch('https://api.qualp.com.br/rotas/v4',{
                method:'POST',
                headers:{
                  'Content-Type':'application/json',
                  'Accept':'application/json',
                  'Access-Token':qualpToken,
                  'User-Agent':'MOVIT-Rotas/1.0'
                },
                body:JSON.stringify({
                  locations:qualpLocations,
                  config:{
                    route:{type_route:'efficient',calculate_return:false,optimized_route:false},
                    vehicle:{type:qualpTruck?'truck':'car',axis:qualpAxis}
                  },
                  show:{tolls:true,polyline:false}
                }),
                signal:AbortSignal.timeout(25000)
              });
              const qj=await qr.json().catch(()=>null);
              if(qr.ok&&qj&&Array.isArray(qj.pedagios)){
                const rows=qj.pedagios.map((p,idx)=>{
                  const tariffs=p&&typeof p.tarifa==='object'&&p.tarifa?p.tarifa:{};
                  let amount=Number(tariffs[String(qualpAxis)]);
                  if(!Number.isFinite(amount)&&!qualpTruck)amount=Number(tariffs['2']);
                  if(!Number.isFinite(amount)){
                    const vals=Object.values(tariffs).map(Number).filter(Number.isFinite);
                    if(vals.length)amount=vals[0];
                  }
                  const lat=Number(p.latitude??p.lat??p.coordenada_latitude);
                  const lon=Number(p.longitude??p.lng??p.lon??p.coordenada_longitude);
                  return {
                    name:String(p.nome||p.name||'Praça de pedágio').slice(0,160),
                    operator:String(p.concessionaria||p.operator||'').slice(0,140),
                    road:String(p.rodovia||'').slice(0,80),
                    municipality:String(p.municipio||'').slice(0,100),
                    state:String(p.uf||'').slice(0,8),
                    lat:Number.isFinite(lat)?lat:null,
                    lon:Number.isFinite(lon)?lon:null,
                    kmFromStart:Number.isFinite(Number(p.km))?Number(p.km):idx,
                    routeOffsetMeters:0,
                    baseAmount:Number.isFinite(amount)?amount:null,
                    amount:Number.isFinite(amount)?Math.round(amount*100)/100:null,
                    estimated:false,
                    source:'QualP'
                  };
                });
                let total=0,priced=0;
                for(const p of rows){if(Number.isFinite(p.amount)){total+=p.amount;priced++}}
                return sendJson(res,200,{
                  ok:true,
                  provider:'QualP',
                  vehicleType:type,
                  axles:qualpAxis,
                  routeKm:Number(qj?.distancia?.valor)||null,
                  rows,
                  count:rows.length,
                  pricedCount:priced,
                  total:Math.round(total*100)/100,
                  totalComplete:priced===rows.length,
                  warning:priced===rows.length
                    ?'Pedágios e tarifas calculados pelo QualP conforme o perfil do veículo.'
                    :'O QualP retornou a rota, mas alguma tarifa não veio disponível para o perfil selecionado.'
                });
              }
              console.warn('MOVIT QUALP TOLLS fallback',{status:qr.status,message:qj?.message||'resposta sem pedágios'});
            }catch(qe){
              console.warn('MOVIT QUALP TOLLS fallback',{error:String(qe&&qe.message||qe)});
            }
          }

          const routePoints=geom.map(x=>({lat:Number(x[1]),lon:Number(x[0])})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
          if(routePoints.length<2)return sendJson(res,400,{ok:false,error:'Geometria da rota inválida.'});

          const routeCum=[0];
          for(let i=1;i<routePoints.length;i++)routeCum.push(routeCum[i-1]+routePublicHaversine(routePoints[i-1],routePoints[i]));
          const totalRoute=routeCum[routeCum.length-1]||0;

          // Amostra pontos da rota para consultar praças próximas sem um bbox gigantesco.
          const sampleIdx=[0];
          let lastM=0;
          for(let i=1;i<routePoints.length-1;i++){
            if(routeCum[i]-lastM>=12000){sampleIdx.push(i);lastM=routeCum[i]}
          }
          sampleIdx.push(routePoints.length-1);
          const queries=sampleIdx.slice(0,35).map(i=>{
            const p=routePoints[i];
            return 'node["barrier"="toll_booth"](around:7000,'+p.lat+','+p.lon+');'+
                   'node["highway"="toll_gantry"](around:7000,'+p.lat+','+p.lon+');'+
                   'way["barrier"="toll_booth"](around:7000,'+p.lat+','+p.lon+');'+
                   'way["highway"="toll_gantry"](around:7000,'+p.lat+','+p.lon+');';
          }).join('');
          const q='[out:json][timeout:25];('+queries+');out center tags;';

          let data=null,lastErr=null;
          for(const base of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']){
            try{
              const r=await fetch(base,{
                method:'POST',
                headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','User-Agent':'MOVIT-Rotas/1.3'},
                body:'data='+encodeURIComponent(q),
                signal:AbortSignal.timeout(26000)
              });
              const j=await r.json().catch(()=>null);
              if(r.ok&&j&&Array.isArray(j.elements)){data=j;break}
            }catch(e){lastErr=e}
          }
          if(!data)throw Object.assign(new Error('Serviço de pedágios temporariamente indisponível.'),{status:503,cause:lastErr});

          const seen=new Set(),plazas=[];
          function nearestRoute(p){
            let best=Infinity,bestIdx=0;
            const step=Math.max(1,Math.floor(routePoints.length/1200));
            for(let i=0;i<routePoints.length;i+=step){
              const d=routePublicHaversine(p,routePoints[i]);
              if(d<best){best=d;bestIdx=i}
            }
            const lo=Math.max(0,bestIdx-step),hi=Math.min(routePoints.length-1,bestIdx+step);
            for(let i=lo;i<=hi;i++){
              const d=routePublicHaversine(p,routePoints[i]);
              if(d<best){best=d;bestIdx=i}
            }
            return {offset:best,progress:routeCum[bestIdx]||0};
          }
          function parseCharge(tags){
            const raw=String(tags.charge||tags['charge:motorcar']||tags['fee:amount']||'').trim();
            if(!raw)return null;
            const m=raw.replace(',','.').match(/(?:BRL|R\$)?\s*(\d+(?:\.\d+)?)/i);
            if(!m)return null;
            const value=Number(m[1]);
            return Number.isFinite(value)&&value>0?value:null;
          }

          for(const el of data.elements){
            const lat=Number(el.lat??el.center?.lat),lon=Number(el.lon??el.center?.lon);
            if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
            const near=nearestRoute({lat,lon});
            if(near.offset>1400)continue;
            const key=lat.toFixed(4)+','+lon.toFixed(4);
            if(seen.has(key))continue;seen.add(key);
            const tags=el.tags||{};
            const baseCharge=parseCharge(tags);
            // Quando OSM informa uma tarifa simples, tratamos como tarifa-base.
            // Para caminhões a estimativa multiplica pelos eixos; o app marca isso como estimativa.
            let amount=null,estimated=false;
            if(Number.isFinite(baseCharge)){
              amount=baseCharge;
              if(!/carro|moto/i.test(type)&&axles>1){amount=baseCharge*axles;estimated=true}
            }
            plazas.push({
              name:String(tags.name||tags.operator||'Praça de pedágio').slice(0,160),
              operator:String(tags.operator||tags.brand||'').slice(0,140),
              lat,lon,
              kmFromStart:near.progress/1000,
              routeOffsetMeters:near.offset,
              baseAmount:Number.isFinite(baseCharge)?baseCharge:null,
              amount:Number.isFinite(amount)?Math.round(amount*100)/100:null,
              estimated,
              source:Number.isFinite(baseCharge)?'OpenStreetMap / tarifa cadastrada':'OpenStreetMap / tarifa não cadastrada'
            });
          }

          plazas.sort((a,b)=>a.kmFromStart-b.kmFromStart);
          let total=0,priced=0;
          for(const p of plazas){if(Number.isFinite(p.amount)){total+=p.amount;priced++}}
          return sendJson(res,200,{
            ok:true,
            vehicleType:type,
            axles,
            routeKm:totalRoute/1000,
            rows:plazas,
            count:plazas.length,
            pricedCount:priced,
            total:Math.round(total*100)/100,
            totalComplete:priced===plazas.length,
            warning:priced===plazas.length
              ?'Valores calculados conforme as tarifas disponíveis na base cartográfica. Confira a sinalização e a concessionária.'
              :'Algumas praças não têm tarifa cadastrada na base pública; nesses casos o MOVIT mostra a praça, mas não inventa o valor.'
          });
        }catch(e){return sendJson(res,e.status||502,{ok:false,error:e.message||'Falha ao calcular pedágios.'})}
      }

      if (u.pathname === '/api/public-router/truck-restrictions' && req.method === 'POST') {
        try{
          if(!publicRouteAllowed(req))return sendJson(res,429,{ok:false,error:'Muitas consultas. Aguarde um minuto.'});
          const body=await readJsonBodyLimited(req,512*1024);
          const vehicle=body.vehicle&&typeof body.vehicle==='object'?body.vehicle:{};
          const points=Array.isArray(body.points)?body.points.slice(0,40):[];
          const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
          const has=(txt,names)=>names.some(n=>norm(txt).includes(norm(n)));
          const alerts=[];
          const citySeen=new Set();

          const spRuleA=[
            'Avenida Paulista','Av Paulista','Avenida Rebouças','Av Rebouças','Avenida Eusébio Matoso','Av Eusebio Matoso',
            'Avenida Professor Francisco Morato','Av Professor Francisco Morato','Avenida Nove de Julho','Av Nove de Julho','Avenida 9 de Julho','Av 9 de Julho',
            'Avenida Cidade Jardim','Av Cidade Jardim','Avenida São Gabriel','Av Sao Gabriel','Avenida Santo Amaro','Av Santo Amaro',
            'Avenida Santos Dumont','Av Santos Dumont','Avenida Tiradentes','Av Tiradentes','Avenida Prestes Maia','Av Prestes Maia',
            'Avenida Rio Branco','Av Rio Branco','Avenida Senador Queirós','Av Senador Queiros','Avenida Ipiranga','Av Ipiranga',
            'Avenida São Luiz','Av Sao Luiz','Rua Maria Paula','Avenida Vinte e Três de Maio','Av 23 de Maio','Avenida Rubem Berta','Av Rubem Berta',
            'Avenida Alcântara Machado','Av Alcantara Machado','Rua Melo Freire','Avenida Conde de Frontin','Av Conde de Frontin',
            'Marginal Pinheiros','Avenida dos Bandeirantes','Av dos Bandeirantes','Avenida Jornalista Roberto Marinho','Av Jornalista Roberto Marinho',
            'Avenida Giovanni Gronchi','Av Giovanni Gronchi','Avenida Morumbi','Av Morumbi','Rua Doutor Luiz Migliano','Rua Dr Luiz Migliano',
            'Avenida Padre Lebret','Av Padre Lebret','Avenida Jules Rimet','Av Jules Rimet'
          ];
          const spRulePeak=[
            'Marginal Tietê','Marginal Tiete','Avenida General Edgar Facó','Av General Edgar Faco','Avenida Ermano Marchetti','Av Ermano Marchetti',
            'Avenida Marquês de São Vicente','Av Marques de Sao Vicente','Rua Norma Pieruccini Giannotti','Rua Sérgio Tomás','Rua Sergio Tomas',
            'Avenida Presidente Castello Branco','Av Presidente Castello Branco','Avenida do Estado','Av do Estado',
            'Avenida Professor Luiz Inácio de Anhaia Mello','Av Professor Luiz Inacio de Anhaia Mello','Avenida Presidente Tancredo Neves','Av Presidente Tancredo Neves',
            'Rua das Juntas Provisórias','Rua das Juntas Provisorias','Rua Bresser','Avenida Paes de Barros','Av Paes de Barros',
            'Avenida Salim Farah Maluf','Av Salim Farah Maluf','Avenida São Miguel','Av Sao Miguel','Avenida Marechal Tito','Av Marechal Tito'
          ];

          for(let i=0;i<points.length;i++){
            const p=points[i]||{};
            const label=String(p.resolved||p.label||p.address||'');
            const n=norm(label);
            const inSaoPaulo=(n.includes('sao paulo')||n.includes(' sao paulo sp')||n.endsWith('sp brasil')) && !n.includes('estado de sao paulo');
            if(!inSaoPaulo)continue;

            if(!citySeen.has('sao-paulo')){
              citySeen.add('sao-paulo');
              alerts.push({
                level:'city',
                city:'São Paulo',
                title:'São Paulo possui áreas e vias com restrição para caminhões',
                detail:'Na ZMRC, a regra geral é proibição de 2ª a 6ª das 05h às 21h e aos sábados das 10h às 14h, exceto feriados. Há exceções e autorizações específicas, inclusive para alguns VUCs cadastrados.',
                schedule:'2ª–6ª 05:00–21:00 • sábado 10:00–14:00',
                source:'Prefeitura de São Paulo • Portaria SMT 137/2018'
              });
            }
            if(has(label,spRuleA)){
              alerts.push({
                level:'street',city:'São Paulo',stopIndex:i,
                title:'Via com restrição de caminhões',
                street:label,
                detail:'Trecho/endereço coincide com via estrutural restrita. Confira o trecho exato e a sinalização local antes de entrar.',
                schedule:'2ª–6ª 05:00–21:00 • sábado 10:00–14:00',
                source:'Prefeitura de São Paulo • Portaria SMT 137/2018'
              });
            }else if(has(label,spRulePeak)){
              alerts.push({
                level:'street',city:'São Paulo',stopIndex:i,
                title:'Via com restrição em horários de pico',
                street:label,
                detail:'Trecho/endereço coincide com via estrutural restrita. Algumas vias desta categoria têm restrição em períodos de pico; confira o trecho e a sinalização.',
                schedule:'2ª–6ª 05:00–09:00 e 17:00–21:00 • sábado 10:00–14:00',
                source:'Prefeitura de São Paulo • Portaria SMT 137/2018'
              });
            }
          }

          const type=String(vehicle.type||'').trim();
          const truck=/vuc|3\/4|toco|truck|carreta|caminh/i.test(type);
          const response={
            ok:true,
            vehicleType:type||'Não informado',
            isTruck:truck,
            alerts,
            count:alerts.length,
            coverage:'Base inicial: regras oficiais do Município de São Paulo. Outras cidades serão adicionadas progressivamente.',
            warning:'O MOVIT é um auxílio. Sinalização da via, autorizações especiais, obras e regras temporárias prevalecem.'
          };
          return sendJson(res,200,response);
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao verificar restrições.'})}
      }

      if (u.pathname === '/api/public-router/optimize' && req.method === 'POST') {
        try{
          if(!publicRouteAllowed(req))return sendJson(res,429,{ok:false,error:'Muitas consultas. Aguarde um minuto.'});
          const body=await readJsonBodyLimited(req,512*1024);
          let raw=Array.isArray(body.stops)?body.stops.slice(0,30):[];
          const returnToStart=body.returnToStart===true;
          let start=body.start&&typeof body.start==='object'?body.start:null;

          // Quando o usuário pede para terminar no mesmo local de início e não
          // definiu um ponto inicial por GPS, a PRIMEIRA parada digitada passa a
          // ser o ponto fixo de saída/retorno. Ela não entra novamente na lista
          // de paradas a otimizar.
          if(returnToStart&&!start&&raw.length>=2){
            start={...raw[0],label:raw[0].resolved||raw[0].label||'Início'};
            raw=raw.slice(1);
          }else if(!start&&raw.length){
            start={lat:raw[0].lat,lon:raw[0].lon,label:raw[0].resolved||raw[0].label||'Início'};
          }

          if(returnToStart){
            if(!start||raw.length<1)return sendJson(res,400,{ok:false,error:'Informe o ponto inicial e pelo menos uma parada.'});
          }else{
            if(raw.length<2)return sendJson(res,400,{ok:false,error:'Informe pelo menos duas paradas.'});
          }

          const points=[start,...raw].map((p,i)=>({
            ...p,
            lat:Number(p.lat),
            lon:Number(p.lon),
            original:String(p.original||p.label||p.address||'').slice(0,240),
            resolved:String(p.resolved||p.label||p.address||('Parada '+i)).slice(0,320),
            label:String(p.resolved||p.label||p.address||('Parada '+i)).slice(0,220)
          }));
          if(points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||p.lat<-90||p.lat>90||p.lon<-180||p.lon>180))return sendJson(res,400,{ok:false,error:'Há coordenadas inválidas na rota.'});
          console.log('MOVIT OPTIMIZE',JSON.stringify({stops:raw.length,returnToStart,hasExplicitStart:!!body.start,startLabel:start?.label||''}));
          const m=await routePublicTable(points),n=raw.length;
          let order=routePublicNearest(m,n);
          order=returnToStart?routePublicTwoOpt(order,m):routePublicTwoOptOpen(order,m);
          const avoidTolls=Array.isArray(body.avoidTolls)?body.avoidTolls.slice(0,12):[];
          const route=await routePublicGeometry(points,order,returnToStart,avoidTolls);
          const avoidanceHits=Number(route.avoidanceHits||0);
          console.log('MOVIT OPTIMIZE OK',JSON.stringify({stops:raw.length,distance:route.distance,duration:route.duration,avoidTolls:avoidTolls.length,avoidanceHits}));
          return sendJson(res,200,{ok:true,order,distanceMeters:route.distance,durationSeconds:route.duration,geometry:route.geometry,points,returnToStart,avoidanceRequested:avoidTolls.length,avoidanceHits});
        }catch(e){return sendJson(res,e.status||502,{ok:false,error:e.message||'Falha ao otimizar rota.'})}
      }

      if (u.pathname === '/api/painel/frota-state' && req.method === 'GET') {
        try {
          await dashboardSession(req);
          const q=await pool.query('SELECT data,updated_at FROM fleet_state WHERE id=1 LIMIT 1');
          return sendJson(res,200,{ok:true,data:q.rows[0]?.data||{},updated_at:q.rows[0]?.updated_at||null});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar Frota.'})}
      }

      if (u.pathname === '/api/painel/frota-state' && req.method === 'PUT') {
        try {
          await dashboardSession(req);
          const body=await readJsonBodyLimited(req,2*1024*1024);
          const data=body&&body.data&&typeof body.data==='object'?body.data:body;
          const out={
            vehicles:Array.isArray(data.vehicles)?data.vehicles:[],
            fuel:Array.isArray(data.fuel)?data.fuel:[],
            maintenance:Array.isArray(data.maintenance)?data.maintenance:[],
            tires:Array.isArray(data.tires)?data.tires:[],
            people:Array.isArray(data.people)?data.people:[],
            documents:Array.isArray(data.documents)?data.documents:[],
            checklists:Array.isArray(data.checklists)?data.checklists:[]
          };
          const q=await pool.query('UPDATE fleet_state SET data=$1::jsonb,updated_at=NOW() WHERE id=1 RETURNING updated_at',[JSON.stringify(out)]);
          return sendJson(res,200,{ok:true,data:out,updated_at:q.rows[0]?.updated_at||null});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao salvar Frota.'})}
      }

      if (u.pathname === '/api/painel/frota-maintenance-file' && req.method === 'POST') {
        try {
          await dashboardSession(req);
          const body=await readJsonBodyLimited(req,12*1024*1024);
          const maintenanceId=String(body.maintenance_id||'').trim().slice(0,120);
          const name=String(body.name||'nota-fiscal').trim().slice(0,240);
          const mime=String(body.mime||'application/octet-stream').trim().slice(0,120);
          let raw=String(body.data||'');
          const comma=raw.indexOf(',');
          if(raw.startsWith('data:')&&comma>=0)raw=raw.slice(comma+1);
          const buf=Buffer.from(raw,'base64');
          if(!maintenanceId)return sendJson(res,400,{ok:false,error:'Manutenção não informada.'});
          if(!buf.length)return sendJson(res,400,{ok:false,error:'Arquivo vazio.'});
          if(buf.length>8*1024*1024)return sendJson(res,413,{ok:false,error:'Arquivo maior que 8 MB.'});
          await pool.query(`INSERT INTO fleet_maintenance_files(maintenance_id,nome_arquivo,mime,arquivo,bytes)
            VALUES($1,$2,$3,$4,$5)
            ON CONFLICT (maintenance_id) DO UPDATE SET nome_arquivo=EXCLUDED.nome_arquivo,mime=EXCLUDED.mime,arquivo=EXCLUDED.arquivo,bytes=EXCLUDED.bytes,atualizado_em=NOW()`,
            [maintenanceId,name,mime,buf,buf.length]);
          return sendJson(res,200,{ok:true,maintenance_id:maintenanceId,name,mime,bytes:buf.length});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao salvar nota fiscal.'})}
      }

      const fleetFileMatch=u.pathname.match(/^\/api\/painel\/frota-maintenance-file\/([^/]+)$/);
      if (fleetFileMatch && req.method === 'GET') {
        try {
          await dashboardSession(req);
          const maintenanceId=decodeURIComponent(fleetFileMatch[1]);
          const q=await pool.query('SELECT nome_arquivo,mime,arquivo,bytes FROM fleet_maintenance_files WHERE maintenance_id=$1 LIMIT 1',[maintenanceId]);
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Anexo não encontrado.'});
          const row=q.rows[0],buf=row.arquivo;
          res.writeHead(200,{
            'Content-Type':row.mime||'application/octet-stream',
            'Content-Length':buf.length,
            'Content-Disposition':'inline; filename="'+String(row.nome_arquivo||'anexo').replace(/["\\]/g,'_')+'"',
            'Cache-Control':'private, max-age=300'
          });
          return res.end(buf);
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao abrir nota fiscal.'})}
      }

      if (fleetFileMatch && req.method === 'DELETE') {
        try {
          await dashboardSession(req);
          const maintenanceId=decodeURIComponent(fleetFileMatch[1]);
          await pool.query('DELETE FROM fleet_maintenance_files WHERE maintenance_id=$1',[maintenanceId]);
          return sendJson(res,200,{ok:true});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao excluir anexo.'})}
      }

      if (req.method === 'GET' && u.pathname === '/motorista-teste') {
        return sendHtml(res, DRIVER_TEST_PAGE);
      }

      if (req.method === 'GET' && u.pathname === '/motorista-instalar') {
        return sendHtml(res, DRIVER_INSTALL_PAGE);
      }

      if (req.method === 'GET' && u.pathname === '/motorista-teste-instalar') {
        return sendHtml(res, DRIVER_TEST_INSTALL_PAGE);
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/test-invite') {
        try {
          const token=String(u.searchParams.get('token')||'').trim();
          if(token.length<20)return sendJson(res,400,{ok:false,error:'Convite de teste inválido.'});
          const q=await pool.query(
            "SELECT driver_name,vehicle_plate,romaneios,work_date,active,created_at FROM driver_tracking_test_assignments WHERE invite_token_hash=$1 AND active=TRUE ORDER BY created_at DESC LIMIT 1",
            [dashboardTokenHash(token)]
          );
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Convite de teste não encontrado ou expirado.'});
          return sendJson(res,200,{ok:true,assignment:q.rows[0],test_only:true});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao consultar convite de teste.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/invite') {
        try {
          const token=String(u.searchParams.get('token')||'').trim();
          if(token.length<20)return sendJson(res,400,{ok:false,error:'Convite inválido.'});
          const q=await pool.query(
            "SELECT driver_name,vehicle_plate,romaneios,work_date,active,created_at FROM driver_tracking_assignments WHERE invite_token_hash=$1 AND active=TRUE ORDER BY created_at DESC LIMIT 1",
            [dashboardTokenHash(token)]
          );
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Convite não encontrado ou expirado.'});
          return sendJson(res,200,{ok:true,assignment:q.rows[0]});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao consultar convite.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/assignment/current') {
        try {
          const device=await trackingDeviceFromReq(req);
          const q=await pool.query(
            `SELECT driver_name,vehicle_plate,romaneios,work_date,updated_at
             FROM driver_tracking_assignments
             WHERE active=TRUE
               AND work_date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
               AND (
                 (COALESCE(vehicle_plate,'')<>'' AND upper(trim(vehicle_plate))=upper(trim(COALESCE($1,''))))
                 OR lower(trim(driver_name))=lower(trim($2))
               )
             ORDER BY
               CASE WHEN COALESCE(vehicle_plate,'')<>'' AND upper(trim(vehicle_plate))=upper(trim(COALESCE($1,''))) THEN 0 ELSE 1 END,
               updated_at DESC
             LIMIT 1`,
            [device.vehicle_plate||'',device.driver_name]
          );
          return sendJson(res,200,{ok:true,assignment:q.rows[0]||null});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar romaneio do motorista.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/test/start') {
        try {
          const body=await readJsonBodyLimited(req,32*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const plate=String(body.vehicle_plate||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Informe o nome do motorista.'});
          if(plate.length<7)return sendJson(res,400,{ok:false,error:'Informe uma placa válida.'});
          const token=crypto.randomBytes(32).toString('hex');
          const q=await pool.query(
            "INSERT INTO driver_tracking_test_devices(token_hash,driver_name,vehicle_plate,device_name,last_seen_at) VALUES($1,$2,$3,$4,NOW()) RETURNING id::text AS id",
            [dashboardTokenHash(token),driver,plate,String(body.device_name||'Celular de teste').slice(0,120)]
          );
          return sendJson(res,201,{ok:true,token,test_device_id:q.rows[0].id,driver_name:driver,vehicle_plate:plate,test_only:true});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao iniciar teste.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/test/point') {
        try {
          const token=trackingBearer(req);
          if(!token)return sendJson(res,401,{ok:false,error:'Teste não autenticado.'});
          const d=await pool.query("SELECT id::text AS id FROM driver_tracking_test_devices WHERE token_hash=$1 LIMIT 1",[dashboardTokenHash(token)]);
          if(!d.rowCount)return sendJson(res,401,{ok:false,error:'Teste inválido.'});
          const body=await readJsonBodyLimited(req,16*1024);
          const lat=Number(body.latitude),lon=Number(body.longitude),acc=Number(body.accuracy_m);
          const captured=new Date(body.captured_at||Date.now());
          if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180)return sendJson(res,400,{ok:false,error:'Coordenadas inválidas.'});
          await pool.query(
            "INSERT INTO driver_tracking_test_points(test_device_id,latitude,longitude,accuracy_m,captured_at) VALUES($1,$2,$3,$4,$5)",
            [d.rows[0].id,lat,lon,Number.isFinite(acc)?acc:null,captured.toISOString()]
          );
          await pool.query("UPDATE driver_tracking_test_devices SET last_seen_at=NOW() WHERE id=$1",[d.rows[0].id]);
          return sendJson(res,200,{ok:true,test_only:true,server_time:new Date().toISOString()});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao registrar ponto de teste.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/test/status') {
        try {
          const token=trackingBearer(req);
          if(!token)return sendJson(res,401,{ok:false,error:'Teste não autenticado.'});
          const q=await pool.query(`
            SELECT d.id::text AS id,d.driver_name,d.vehicle_plate,d.last_seen_at,
                   p.latitude,p.longitude,p.accuracy_m,p.captured_at,
                   (SELECT COUNT(*)::int FROM driver_tracking_test_points x WHERE x.test_device_id=d.id) AS points
            FROM driver_tracking_test_devices d
            LEFT JOIN LATERAL (
              SELECT latitude,longitude,accuracy_m,captured_at
              FROM driver_tracking_test_points
              WHERE test_device_id=d.id
              ORDER BY captured_at DESC LIMIT 1
            ) p ON TRUE
            WHERE d.token_hash=$1 LIMIT 1
          `,[dashboardTokenHash(token)]);
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Teste não encontrado.'});
          return sendJson(res,200,{ok:true,row:q.rows[0],test_only:true});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao consultar teste.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/app-update') {
        try {
          const channel=String(u.searchParams.get('channel')||'normal').toLowerCase()==='teste'?'teste':'normal';
          const current=Number(u.searchParams.get('version_code')||0);
          if(!fs.existsSync(DRIVER_UPDATE_FILE))return sendJson(res,200,{ok:true,available:false,currentVersionCode:current});
          const meta=JSON.parse(fs.readFileSync(DRIVER_UPDATE_FILE,'utf8'));
          const item=meta[channel]||null;
          if(!item)return sendJson(res,200,{ok:true,available:false,currentVersionCode:current});
          const latest=Number(item.versionCode||0);
          return sendJson(res,200,{
            ok:true,
            available:latest>current,
            currentVersionCode:current,
            latestVersionCode:latest,
            latestVersionName:String(item.versionName||''),
            apkUrl:DRIVER_PUBLIC_BASE+String(item.url||''),
            notes:String(item.notes||'Atualização do CONSTRULOG Motorista.')
          });
        } catch(e){return sendJson(res,500,{ok:false,error:'Não foi possível verificar atualização.'});}
      }

      if (req.method === 'GET' && /^\/downloads\/(CONSTRULOG-Motorista-(NORMAL|TESTE)\.apk|MOVIT\.apk|MOVIT-PLAYSTORE\.aab)$/i.test(u.pathname)) {
        try {
          const file=path.join(DRIVER_DOWNLOADS,path.basename(u.pathname));
          if(!fs.existsSync(file))return sendJson(res,404,{ok:false,error:'Arquivo ainda não publicado.'});
          const st=fs.statSync(file);
          const isAab=/\.aab$/i.test(file);
          res.writeHead(200,{
            'Content-Type':isAab?'application/octet-stream':'application/vnd.android.package-archive',
            'Content-Length':st.size,
            'Content-Disposition':'attachment; filename="'+path.basename(file)+'"',
            'Cache-Control':'no-store'
          });
          return fs.createReadStream(file).pipe(res);
        } catch(e){return sendJson(res,500,{ok:false,error:'Falha ao baixar aplicativo.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/auth/login') {
        try {
          const body=await readJsonBodyLimited(req,64*1024);
          const username=String(body.username||'').trim();
          const password=String(body.password||'');
          if(!username||!password)return sendJson(res,400,{ok:false,error:'Informe usuário e senha.'});
          const r=await pool.query('SELECT id::text AS id,username,password_salt,password_hash,is_admin,active,permissions,client_id,is_platform_admin FROM dashboard_users WHERE lower(username)=lower($1) LIMIT 1',[username]);
          if(!r.rowCount||!r.rows[0].active||!dashboardVerifyPassword(password,r.rows[0].password_salt,r.rows[0].password_hash)){
            return sendJson(res,401,{ok:false,error:'Usuário ou senha inválidos.'});
          }
          const row=r.rows[0],sessionDays=row.is_admin?365:14,token=await dashboardCreateSession(row.id,sessionDays);
          res.writeHead(200,{
            'Content-Type':'application/json; charset=utf-8',
            'Cache-Control':'no-store',
            'Set-Cookie':dashboardSetCookie(token,sessionDays*24*60*60)
          });
          const user=await dashboardUserContext(row);
          return res.end(JSON.stringify({ok:true,user}));
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao entrar.'});}
      }

      if (req.method === 'GET' && u.pathname === '/api/auth/me') {
        try {
          const user=await dashboardSession(req,false);
          if(user.is_admin){
            const token=dashboardBearer(req);
            if(token){
              await pool.query("UPDATE dashboard_sessions SET expires_at=NOW()+INTERVAL '365 days' WHERE token_hash=$1",[dashboardTokenHash(token)]);
              res.writeHead(200,{
                'Content-Type':'application/json; charset=utf-8',
                'Cache-Control':'no-store',
                'Set-Cookie':dashboardSetCookie(token,365*24*60*60)
              });
              return res.end(JSON.stringify({ok:true,user}));
            }
          }
          return sendJson(res,200,{ok:true,user});
        } catch(e){return sendJson(res,e.status||401,{ok:false,error:e.message||'Sessão inválida.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/auth/logout') {
        try {
          const token=dashboardBearer(req);
          if(token)await pool.query('DELETE FROM dashboard_sessions WHERE token_hash=$1',[dashboardTokenHash(token)]);
        } catch {}
        res.writeHead(200,{
          'Content-Type':'application/json; charset=utf-8',
          'Cache-Control':'no-store',
          'Set-Cookie':dashboardSetCookie('',0)
        });
        return res.end(JSON.stringify({ok:true}));
      }

      if (req.method === 'POST' && u.pathname === '/api/auth/admin-dashboard-token') {
        try {
          const user=await dashboardSession(req,true);
          const token=await dashboardCreateSession(user.id,365);
          return sendJson(res,200,{ok:true,token});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível abrir o dashboard do administrador.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/auth/embed-ticket') {
        try {
          const user=await dashboardSession(req,false);
          const ticket=crypto.randomBytes(24).toString('hex');
          await pool.query('DELETE FROM dashboard_embed_tickets WHERE expires_at<=NOW() OR used_at IS NOT NULL');
          await pool.query("INSERT INTO dashboard_embed_tickets(ticket_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '2 minutes')",[dashboardTokenHash(ticket),user.id]);
          return sendJson(res,200,{ok:true,ticket});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível abrir o módulo.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/auth/embed-exchange') {
        try {
          const body=await readJsonBodyLimited(req,32*1024);
          const ticket=String(body.ticket||'').trim();
          if(!ticket)return sendJson(res,400,{ok:false,error:'Ticket não informado.'});
          const r=await pool.query("UPDATE dashboard_embed_tickets SET used_at=NOW() WHERE ticket_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING user_id",[dashboardTokenHash(ticket)]);
          if(!r.rowCount)return sendJson(res,401,{ok:false,error:'Ticket expirado ou já utilizado.'});
          const ur=await pool.query('SELECT id::text AS id,username,is_admin,active,permissions,client_id,is_platform_admin FROM dashboard_users WHERE id=$1 AND active=TRUE LIMIT 1',[r.rows[0].user_id]);
          if(!ur.rowCount)return sendJson(res,401,{ok:false,error:'Usuário inativo.'});
          const row=ur.rows[0],token=await dashboardCreateSession(row.id),user=await dashboardUserContext(row);
          return sendJson(res,200,{ok:true,token,user});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao autorizar módulo.'});}
      }
      if (req.method === 'GET' && (u.pathname === '/movit-central' || u.pathname === '/movit-central/')) {
        try{
          await dashboardPlatformSession(req);
          return sendHtml(res,MOVIT_CENTRAL_PAGE);
        }catch(e){
          res.writeHead(302,{Location:'/?login=1','Cache-Control':'no-store'});
          return res.end();
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/movit-central/clients') {
        try{
          await dashboardPlatformSession(req);
          const mq=await pool.query("SELECT key,name,category FROM movit_modules WHERE active=TRUE ORDER BY category,name");
          const cq=await pool.query(`SELECT c.id::text,c.name,c.slug,c.document,c.email,c.phone,c.plan,c.monthly_fee,c.due_day,c.status,c.notes,c.created_at,c.updated_at,
            COALESCE((SELECT json_agg(cm.module_key ORDER BY cm.module_key) FROM movit_client_modules cm WHERE cm.client_id=c.id AND cm.enabled=TRUE),'[]'::json) AS modules
            FROM movit_clients c ORDER BY lower(c.name)`);
          return sendJson(res,200,{ok:true,modules:mq.rows,clients:cq.rows});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar MOVIT Central.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/movit-central/clients') {
        try{
          await dashboardPlatformSession(req);
          const body=await readJsonBodyLimited(req,128*1024);
          const name=String(body.name||'').trim().slice(0,160);
          const slug=String(body.slug||name).trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100);
          if(name.length<2||slug.length<2)return sendJson(res,400,{ok:false,error:'Informe o nome e o identificador do cliente.'});
          const dueDay=Math.min(31,Math.max(1,Number(body.due_day)||10));
          const monthlyFee=Math.max(0,Number(body.monthly_fee)||0);
          const status=['pilot','active','trial','overdue','blocked'].includes(body.status)?body.status:'pilot';
          const q=await pool.query(`INSERT INTO movit_clients(name,slug,document,email,phone,plan,monthly_fee,due_day,status,notes)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id::text,name,slug,document,email,phone,plan,monthly_fee,due_day,status,notes`,
            [name,slug,String(body.document||'').trim().slice(0,60)||null,String(body.email||'').trim().slice(0,180)||null,String(body.phone||'').trim().slice(0,80)||null,String(body.plan||'Personalizado').trim().slice(0,80),monthlyFee,dueDay,status,String(body.notes||'').trim().slice(0,2000)||null]);
          const client=q.rows[0];
          const modules=Array.isArray(body.modules)?[...new Set(body.modules.map(String))]:[];
          for(const moduleKey of modules){
            await pool.query('INSERT INTO movit_client_modules(client_id,module_key,enabled) SELECT $1,key,TRUE FROM movit_modules WHERE key=$2 ON CONFLICT(client_id,module_key) DO UPDATE SET enabled=TRUE,updated_at=NOW()',[client.id,moduleKey]);
          }
          client.modules=modules;
          return sendJson(res,201,{ok:true,client});
        }catch(e){
          const msg=e.code==='23505'?'Já existe um cliente com esse identificador.':(e.message||'Falha ao criar cliente.');
          return sendJson(res,e.code==='23505'?409:(e.status||500),{ok:false,error:msg})
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/movit-central/payments') {
        try{
          await dashboardPlatformSession(req);
          const q=await pool.query(`SELECT p.id::text,p.client_id::text,c.name AS client_name,p.reference_month,p.due_date,p.amount,p.status,p.paid_at,p.notes,p.created_at,p.updated_at
            FROM movit_payments p JOIN movit_clients c ON c.id=p.client_id
            ORDER BY p.reference_month DESC,lower(c.name),p.id DESC LIMIT 500`);
          return sendJson(res,200,{ok:true,rows:q.rows});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar mensalidades.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/movit-central/payments') {
        try{
          await dashboardPlatformSession(req);
          const body=await readJsonBodyLimited(req,64*1024);
          const clientId=String(body.client_id||'').trim();
          if(!/^\d+$/.test(clientId))return sendJson(res,400,{ok:false,error:'Cliente inválido.'});
          const cq=await pool.query('SELECT id,name,monthly_fee,due_day FROM movit_clients WHERE id=$1 LIMIT 1',[clientId]);
          if(!cq.rowCount)return sendJson(res,404,{ok:false,error:'Cliente não encontrado.'});
          const c=cq.rows[0];
          let ref=String(body.reference_month||'').trim();
          if(!/^\d{4}-\d{2}$/.test(ref)){
            ref=spToday().slice(0,7);
          }
          const refDate=ref+'-01';
          const [yy,mm]=ref.split('-').map(Number);
          const lastDay=new Date(Date.UTC(yy,mm,0)).getUTCDate();
          const dueDay=Math.min(Number(c.due_day)||10,lastDay);
          const dueDate=ref+'-'+String(dueDay).padStart(2,'0');
          const amount=body.amount==null?Number(c.monthly_fee||0):Math.max(0,Number(body.amount)||0);
          const q=await pool.query(`INSERT INTO movit_payments(client_id,reference_month,due_date,amount,status,notes)
            VALUES($1,$2::date,$3::date,$4,'pending',$5)
            ON CONFLICT(client_id,reference_month) DO UPDATE SET due_date=EXCLUDED.due_date,amount=EXCLUDED.amount,notes=EXCLUDED.notes,updated_at=NOW()
            RETURNING id::text,client_id::text,reference_month,due_date,amount,status,paid_at,notes`,
            [clientId,refDate,dueDate,amount,String(body.notes||'').trim().slice(0,1000)||null]);
          return sendJson(res,200,{ok:true,payment:q.rows[0]});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao gerar mensalidade.'})}
      }

      const movitPaymentMatch=u.pathname.match(/^\/api\/movit-central\/payments\/(\d+)$/);
      if (movitPaymentMatch && req.method === 'PATCH') {
        try{
          await dashboardPlatformSession(req);
          const id=movitPaymentMatch[1],body=await readJsonBodyLimited(req,64*1024);
          const status=['pending','paid','overdue','cancelled'].includes(body.status)?body.status:null;
          if(!status)return sendJson(res,400,{ok:false,error:'Status de pagamento inválido.'});
          const q=await pool.query(`UPDATE movit_payments SET status=$1,paid_at=CASE WHEN $1='paid' THEN COALESCE(paid_at,NOW()) ELSE NULL END,updated_at=NOW()
            WHERE id=$2 RETURNING id::text,client_id::text,reference_month,due_date,amount,status,paid_at,notes`,[status,id]);
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Mensalidade não encontrada.'});
          return sendJson(res,200,{ok:true,payment:q.rows[0]});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao atualizar mensalidade.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/movit-central/payments/recalculate-overdue') {
        try{
          await dashboardPlatformSession(req);
          const q=await pool.query("UPDATE movit_payments SET status='overdue',updated_at=NOW() WHERE status='pending' AND due_date<(NOW() AT TIME ZONE 'America/Sao_Paulo')::date RETURNING id");
          return sendJson(res,200,{ok:true,updated:q.rowCount});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao atualizar vencimentos.'})}
      }

      const movitClientMatch=u.pathname.match(/^\/api\/movit-central\/clients\/(\d+)$/);
      if (movitClientMatch && req.method === 'PATCH') {
        try{
          await dashboardPlatformSession(req);
          const id=movitClientMatch[1],body=await readJsonBodyLimited(req,128*1024);
          const name=String(body.name||'').trim().slice(0,160);
          const slug=String(body.slug||name).trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100);
          if(name.length<2||slug.length<2)return sendJson(res,400,{ok:false,error:'Informe o nome e o identificador do cliente.'});
          const dueDay=Math.min(31,Math.max(1,Number(body.due_day)||10));
          const monthlyFee=Math.max(0,Number(body.monthly_fee)||0);
          const status=['pilot','active','trial','overdue','blocked'].includes(body.status)?body.status:'pilot';
          const q=await pool.query(`UPDATE movit_clients SET name=$1,slug=$2,document=$3,email=$4,phone=$5,plan=$6,monthly_fee=$7,due_day=$8,status=$9,notes=$10,updated_at=NOW()
            WHERE id=$11 RETURNING id::text,name,slug,document,email,phone,plan,monthly_fee,due_day,status,notes`,
            [name,slug,String(body.document||'').trim().slice(0,60)||null,String(body.email||'').trim().slice(0,180)||null,String(body.phone||'').trim().slice(0,80)||null,String(body.plan||'Personalizado').trim().slice(0,80),monthlyFee,dueDay,status,String(body.notes||'').trim().slice(0,2000)||null,id]);
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Cliente não encontrado.'});
          const modules=Array.isArray(body.modules)?[...new Set(body.modules.map(String))]:[];
          await pool.query('UPDATE movit_client_modules SET enabled=FALSE,updated_at=NOW() WHERE client_id=$1',[id]);
          for(const moduleKey of modules){
            await pool.query('INSERT INTO movit_client_modules(client_id,module_key,enabled) SELECT $1,key,TRUE FROM movit_modules WHERE key=$2 ON CONFLICT(client_id,module_key) DO UPDATE SET enabled=TRUE,updated_at=NOW()',[id,moduleKey]);
          }
          const client=q.rows[0];client.modules=modules;
          return sendJson(res,200,{ok:true,client});
        }catch(e){
          const msg=e.code==='23505'?'Já existe um cliente com esse identificador.':(e.message||'Falha ao atualizar cliente.');
          return sendJson(res,e.code==='23505'?409:(e.status||500),{ok:false,error:msg})
        }
      }

      if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/painel')) {
        return sendHtml(res, PANEL);
      }

      if (req.method === 'GET' && (u.pathname === '/movit-pc' || u.pathname === '/movit-pc/')) {
        return sendHtml(res, MOVIT_PC_PAGE);
      }

      if (req.method === 'GET' && (u.pathname === '/pdf-unificador' || u.pathname === '/pdf-unificador/')) {
        try {
          await dashboardSession(req,false);
          return sendHtml(res,PDF_UNIFIER_PAGE);
        } catch(e){
          res.writeHead(302,{Location:'/?login=1#pdf-unificador','Cache-Control':'no-store'});
          return res.end();
        }
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/pdf-unificador') {
        let client=null;
        try{
          await dashboardSession(req,false);
          const body=await readJsonBodyLimited(req,64*1024);
          const email=String(body.email||'').trim().slice(0,180);
          const password=String(body.password||'');
          const sender=String(body.sender||'').trim().slice(0,220);
          const scope=body.scope==='all'?'all':'inbox';
          const pdfMode=body.mode==='city'?'city':'tubes';
          const requestedHost=String(body.host||'auto');
          const emailDomain=(email.split('@')[1]||'').toLowerCase();
          const providerHosts={
            'gmail.com':['imap.gmail.com'],
            'googlemail.com':['imap.gmail.com'],
            'outlook.com':['outlook.office365.com'],
            'hotmail.com':['outlook.office365.com'],
            'live.com':['outlook.office365.com'],
            'yahoo.com':['imap.mail.yahoo.com'],
            'yahoo.com.br':['imap.mail.yahoo.com']
          };
          const allowedHosts=['imap.titan.email','imap0101.titan.email','imap.gmail.com','outlook.office365.com','imap.mail.yahoo.com'];
          const hostCandidates=requestedHost==='auto'
            ? (providerHosts[emailDomain]||['imap.titan.email','imap0101.titan.email'])
            : ([requestedHost].filter(h=>allowedHosts.includes(h)));
          if(!hostCandidates.length)hostCandidates.push(...(providerHosts[emailDomain]||['imap.titan.email','imap0101.titan.email']));
          const from=String(body.from||''),to=String(body.to||'');
          if(!email||!password)return sendJson(res,400,{ok:false,error:'Informe o e-mail e a senha do Titan.'});
          if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return sendJson(res,400,{ok:false,error:'Informe um período válido.'});
          const since=new Date(from+'T00:00:00-03:00');
          const before=new Date(to+'T00:00:00-03:00');before.setDate(before.getDate()+1);
          if(!Number.isFinite(since.getTime())||!Number.isFinite(before.getTime())||before<=since)return sendJson(res,400,{ok:false,error:'Período inválido.'});
          const days=(before-since)/86400000;
          if(days>93)return sendJson(res,400,{ok:false,error:'Para segurança, consulte no máximo 90 dias por vez.'});

          let connectedHost='',lastConnectError=null;
          for(const host of hostCandidates){
            try{
              client=new ImapFlow({
                host,port:993,secure:true,
                auth:{user:email,pass:password},
                logger:false,
                tls:{rejectUnauthorized:true},
                socketTimeout:45000,
                greetingTimeout:20000
              });
              await client.connect();
              connectedHost=host;
              lastConnectError=null;
              break;
            }catch(err){
              lastConnectError=err;
              try{client?.close()}catch(_){}
              client=null;
            }
          }
          if(!client){
            const raw=String(lastConnectError?.message||'').toLowerCase();
            const authFail=lastConnectError?.authenticationFailed||raw.includes('auth')||raw.includes('password')||raw.includes('login');
            if(authFail){
              const provider=emailDomain==='gmail.com'||emailDomain==='googlemail.com'?'Gmail':(emailDomain.includes('outlook')||emailDomain==='hotmail.com'||emailDomain==='live.com'?'Microsoft':(emailDomain.includes('yahoo')?'Yahoo':'Titan'));
              const e=new Error(provider+' recusou o login IMAP. Para Gmail, Microsoft ou Yahoo, normalmente é necessário usar uma senha de aplicativo quando a conta tem verificação em duas etapas. Confirme também o endereço completo do e-mail.');
              e.status=401;throw e;
            }
            const e=new Error('Não foi possível conectar ao servidor IMAP do Titan. Tente novamente em alguns instantes.');
            e.status=502;throw e;
          }

          let mailboxes=['INBOX'];
          if(scope==='all'){
            const boxes=await client.list();
            mailboxes=boxes
              .filter(b=>!(b.flags&&typeof b.flags.has==='function'&&b.flags.has('\\Noselect')))
              .map(b=>b.path)
              .filter(Boolean)
              .slice(0,80);
            if(!mailboxes.includes('INBOX'))mailboxes.unshift('INBOX');
            mailboxes=[...new Set(mailboxes)];
          }

          const found=[];
          let scanned=0,matchedMessages=0,pdfAttachmentsSeen=0;
          for(const box of mailboxes){
            if(found.length>=60||scanned>=250)break;
            let lock=null;
            try{
              lock=await client.getMailboxLock(box,{description:'CONSTRULOG PDF Unificador'});
              // Busca primeiro pelo período no próprio servidor IMAP. Isso evita perder notas antigas
              // quando há mais de 250 mensagens novas na caixa.
              let uidList=[];
              try{
                const searchQuery={since,before};
                if(sender)searchQuery.from=sender;
                uidList=await client.search(searchQuery,{uid:true});
              }catch(searchErr){
                console.warn('PDF Unificador: SEARCH por período falhou, usando fallback recente',box,searchErr.message);
              }

              if(uidList.length){
                const remaining=Math.max(0,250-scanned);
                uidList=uidList.slice(-remaining);
                scanned+=uidList.length;
                const uidRange=uidList.join(',');
                for await (const msg of client.fetch(uidRange,{uid:true,internalDate:true,source:true,envelope:true},{uid:true})){
                  if(found.length>=60)break;
                  if(!msg.source)continue;
                  const parsed=await simpleParser(msg.source,{skipHtmlToText:true,skipTextToHtml:true});
                  if(sender){
                    const needle=sender.trim().toLowerCase();
                    const fromText=String(parsed.from?.text||'').toLowerCase();
                    const fromAddresses=(parsed.from?.value||[]).map(x=>String(x.address||'').toLowerCase());
                    const displayNames=(parsed.from?.value||[]).map(x=>String(x.name||'').toLowerCase());
                    const match=fromText.includes(needle)||fromAddresses.some(x=>x===needle||x.includes(needle))||displayNames.some(x=>x.includes(needle));
                    if(!match)continue;
                  }
                  matchedMessages++;
                  for(const a of parsed.attachments||[]){
                    if(found.length>=60)break;
                    const filename=String(a.filename||'anexo');
                    const contentType=String(a.contentType||'').toLowerCase();
                    const isPdf=contentType==='application/pdf'||contentType==='application/x-pdf'||/\.pdf$/i.test(filename);
                    if(isPdf)pdfAttachmentsSeen++;
                    if(!isPdf||!a.content||!a.content.length)continue;
                    found.push({
                      date:msg.internalDate?new Date(msg.internalDate).getTime():0,
                      filename:/\.pdf$/i.test(filename)?filename:(filename+'.pdf'),
                      content:Buffer.from(a.content)
                    });
                  }
                }
              }else{
                // Fallback: servidores que não suportarem SEARCH por período.
                const total=Number(client.mailbox?.exists||0);
                if(!total)continue;
                const remaining=Math.max(0,250-scanned);
                if(!remaining)break;
                const take=Math.min(total,remaining);
                const seqStart=Math.max(1,total-take+1);
                const seqRange=seqStart+':'+total;
                scanned+=take;
                for await (const msg of client.fetch(seqRange,{uid:true,internalDate:true,source:true,envelope:true})){
                  const msgDate=msg.internalDate?new Date(msg.internalDate):null;
                  if(!msgDate||msgDate<since||msgDate>=before)continue;
                  if(found.length>=60)break;
                  if(!msg.source)continue;
                  const parsed=await simpleParser(msg.source,{skipHtmlToText:true,skipTextToHtml:true});
                  if(sender){
                    const needle=sender.trim().toLowerCase();
                    const fromText=String(parsed.from?.text||'').toLowerCase();
                    const fromAddresses=(parsed.from?.value||[]).map(x=>String(x.address||'').toLowerCase());
                    const displayNames=(parsed.from?.value||[]).map(x=>String(x.name||'').toLowerCase());
                    const match=fromText.includes(needle)||fromAddresses.some(x=>x===needle||x.includes(needle))||displayNames.some(x=>x.includes(needle));
                    if(!match)continue;
                  }
                  matchedMessages++;
                  for(const a of parsed.attachments||[]){
                    if(found.length>=60)break;
                    const filename=String(a.filename||'anexo');
                    const contentType=String(a.contentType||'').toLowerCase();
                    const isPdf=contentType==='application/pdf'||contentType==='application/x-pdf'||/\.pdf$/i.test(filename);
                    if(isPdf)pdfAttachmentsSeen++;
                    if(!isPdf||!a.content||!a.content.length)continue;
                    found.push({
                      date:msg.internalDate?new Date(msg.internalDate).getTime():0,
                      filename:/\.pdf$/i.test(filename)?filename:(filename+'.pdf'),
                      content:Buffer.from(a.content)
                    });
                  }
                }
              }
            }catch(e){
              console.warn('PDF Unificador: pasta ignorada',box,e.message);
            }finally{
              try{if(lock)lock.release()}catch(e){}
            }
          }

          if(!found.length){
            let error='Nenhum anexo PDF foi encontrado com esses filtros.';
            if(scanned===0)error='A pasta foi aberta, mas não foi possível ler mensagens. Tente selecionar “Todas as pastas”.';
            else if(sender&&matchedMessages===0)error='Nenhum e-mail desse remetente foi encontrado no período entre as '+scanned+' mensagens mais recentes verificadas. Confira o remetente ou deixe o campo em branco.';
            else if(matchedMessages>0&&pdfAttachmentsSeen===0)error='Foram encontrados '+matchedMessages+' e-mail(s) no período, mas nenhum anexo PDF. Os anexos podem estar em XML ou outro formato.';
            else if(matchedMessages===0)error='Nenhum e-mail do período foi encontrado entre as '+scanned+' mensagens mais recentes verificadas.';
            return sendJson(res,404,{ok:false,error,matchedMessages,pdfAttachmentsSeen,scanned});
          }
          found.sort((a,b)=>a.date-b.date||a.filename.localeCompare(b.filename,'pt-BR'));

          const normPdfText=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toUpperCase().trim();
          const cityFromDanfe=text=>{
            const compact=String(text||'').replace(/\s+/g,' ');
            const dest=(compact.match(/DESTINAT[AÁ]RIO\s*\/\s*REMETENTE([\s\S]{0,1800}?)(?:FATURA|C[AÁ]LCULO\s+DO\s+IMPOSTO|TRANSPORTADOR)/i)||[])[1]||compact;
            const patterns=[
              /MUNIC[IÍ]PIO\s+([A-ZÀ-Ý][A-ZÀ-Ý0-9 .'-]{1,70}?)\s+(?:FONE\s*\/\s*FAX|UF\b|INSCRI[CÇ][AÃ]O\s+ESTADUAL|HORA\s+SA[IÍ]DA)/i,
              /MUNIC[IÍ]PIO\s+([A-ZÀ-Ý][A-ZÀ-Ý0-9 .'-]{1,70}?)\s+SP\b/i
            ];
            for(const re of patterns){
              const m=dest.match(re);
              if(m&&m[1])return m[1].replace(/\s+/g,' ').trim();
            }
            return 'SEM CIDADE';
          };

          const notes=[];
          let nonNotes=0,parseFailures=0;
          for(const item of found){
            try{
              const parsedPdf=await pdfParse(item.content);
              const text=String(parsedPdf?.text||'');
              const norm=normPdfText(text);
              const isNote=/\bDANFE\b/.test(norm)||/NOTA\s+FISCAL\s+ELETRONICA/.test(norm)||/\bNF-?E\b/.test(norm);
              if(!isNote){nonNotes++;continue}
              item.hasTube=/\bTUBO(?:S)?\b/.test(norm);
              item.city=cityFromDanfe(text);
              notes.push(item);
            }catch(e){
              parseFailures++;
              console.warn('PDF Unificador: texto não lido',item.filename,e.message);
            }
          }

          if(!notes.length){
            return sendJson(res,422,{ok:false,error:'Os PDFs foram encontrados, mas nenhuma nota fiscal DANFE pôde ser identificada para ordenar.',pdfAttachmentsSeen,nonNotes,parseFailures});
          }

          if(pdfMode==='city'){
            notes.sort((a,b)=>{
              const ca=normPdfText(a.city||'SEM CIDADE'),cb=normPdfText(b.city||'SEM CIDADE');
              if(ca==='SEM CIDADE'&&cb!=='SEM CIDADE')return 1;
              if(cb==='SEM CIDADE'&&ca!=='SEM CIDADE')return -1;
              return ca.localeCompare(cb,'pt-BR')||a.date-b.date||a.filename.localeCompare(b.filename,'pt-BR');
            });
          }else{
            notes.sort((a,b)=>Number(b.hasTube)-Number(a.hasTube)||a.date-b.date||a.filename.localeCompare(b.filename,'pt-BR'));
          }

          const merged=await PDFDocument.create();
          let mergedCount=0,skipped=0;
          for(const item of notes){
            try{
              const src=await PDFDocument.load(item.content,{ignoreEncryption:true,updateMetadata:false});
              const indices=src.getPageIndices();
              if(!indices.length){skipped++;continue}
              const copiedPages=await merged.copyPages(src,indices);
              copiedPages.forEach(p=>merged.addPage(p));
              mergedCount++;
            }catch(e){
              skipped++;
              console.warn('PDF Unificador: PDF ignorado',item.filename,e.message);
            }
          }
          if(!mergedCount||merged.getPageCount()===0)return sendJson(res,422,{ok:false,error:'As notas encontradas não puderam ser unidas. Verifique se os PDFs não estão protegidos por senha.'});
          const bytes=await merged.save({useObjectStreams:false});
          const safeFrom=from.replace(/-/g,''),safeTo=to.replace(/-/g,'');
          const filename=(pdfMode==='city'?'Notas-por-cidade-':'Notas-por-tubos-')+safeFrom+'-a-'+safeTo+'.pdf';
          const tubeCount=notes.filter(x=>x.hasTube).length;
          const cityCount=new Set(notes.map(x=>normPdfText(x.city||'SEM CIDADE'))).size;
          res.writeHead(200,{
            'Content-Type':'application/pdf',
            'Content-Length':bytes.length,
            'Content-Disposition':'attachment; filename="'+filename+'"',
            'Cache-Control':'no-store',
            'X-PDF-Count':String(mergedCount),
            'X-PDF-Skipped':String(skipped+nonNotes+parseFailures),
            'X-Tube-Count':String(tubeCount),
            'X-City-Count':String(cityCount),
            'X-PDF-Mode':pdfMode
          });
          return res.end(Buffer.from(bytes));
        }catch(e){
          const raw=String(e?.message||'');
          const authLike=e?.authenticationFailed||/auth|password|login|credentials|senha/i.test(raw);
          const msg=authLike
            ? 'O servidor de e-mail recusou o login IMAP. Se estiver usando Gmail, Microsoft, Yahoo ou Titan com 2FA, use uma senha de aplicativo e confirme o endereço completo do e-mail.'
            : (raw||'Falha ao unificar PDFs.');
          return sendJson(res,e.status||(authLike?401:500),{ok:false,error:msg});
        }finally{
          try{if(client)await client.logout()}catch(e){try{client?.close()}catch(_){}}
        }
      }

      if (req.method === 'GET' && (u.pathname === '/frota' || u.pathname === '/frota/')) {
        try {
          await dashboardSession(req,false);
          return sendHtml(res,FROTA_PAGE);
        } catch(e){
          res.writeHead(302,{Location:'/?login=1#frota','Cache-Control':'no-store'});
          return res.end();
        }
      }

      if (req.method === 'GET' && (u.pathname === '/lotacao' || u.pathname === '/lotacao/')) {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'lotacao')||dashboardHas(user,'coletas')||dashboardHas(user,'financeiro'))){
            res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
            return res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial;padding:30px;color:#334155}h2{color:#991b1b}</style><h2>Acesso não autorizado</h2><p>Este usuário não possui permissão para Lotação.</p>');
          }
          return sendHtml(res,LOTACAO_PAGE);
        } catch(e){
          res.writeHead(302,{Location:'/?login=1#lotacao','Cache-Control':'no-store'});
          return res.end();
        }
      }

      if (req.method === 'GET' && (u.pathname === '/coletas' || u.pathname === '/coletas/' || u.pathname === '/contas' || u.pathname === '/contas/')) {
        try {
          const user=await dashboardSession(req,false);
          const isContas=u.pathname.startsWith('/contas');
          const isFinanceiro=!isContas&&u.searchParams.get('view')==='financeiro';
          const allowed=isContas?dashboardHas(user,'contas_pagar'):(isFinanceiro?dashboardHas(user,'financeiro'):dashboardHas(user,'coletas'));
          if(!allowed){
            res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
            return res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial;padding:30px;color:#334155}h2{color:#991b1b}</style><h2>Acesso não autorizado</h2><p>Este usuário não possui permissão para este módulo.</p>');
          }
        } catch(e){
          res.writeHead(302,{Location:'/?login=1'+(u.pathname.startsWith('/contas')?'#contas':'#coletas'),'Cache-Control':'no-store'});
          return res.end();
        }
      }

      if (req.method === 'GET' && (u.pathname === '/coletas' || u.pathname === '/coletas/') && u.searchParams.get('embed') !== '1') {
        res.writeHead(302, { Location: '/#lotacao', 'Cache-Control': 'no-store' });
        return res.end();
      }

      if (req.method === 'GET' && (u.pathname === '/contas' || u.pathname === '/contas/') && u.searchParams.get('embed') !== '1') {
        res.writeHead(302, { Location: '/#contas', 'Cache-Control': 'no-store' });
        return res.end();
      }

      if (req.method === 'GET' && (u.pathname === '/contas' || u.pathname === '/contas/')) {
        return sendHtml(res, ACCOUNTS_INDEX);
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/auth/login') {
        try {
          const body=await readJsonBodyLimited(req,64*1024);
          const username=String(body.username||'').trim();
          const password=String(body.password||'');
          if(!username||!password)return sendJson(res,400,{ok:false,error:'Informe usuário e senha.'});
          const r=await pool.query('SELECT id::text AS id,username,password_salt,password_hash,is_admin,active,permissions FROM dashboard_users WHERE lower(username)=lower($1) LIMIT 1',[username]);
          if(!r.rowCount||!r.rows[0].active||!dashboardVerifyPassword(password,r.rows[0].password_salt,r.rows[0].password_hash))return sendJson(res,401,{ok:false,error:'Usuário ou senha inválidos.'});
          const row=r.rows[0];
          const token=await dashboardCreateSession(row.id);
          return sendJson(res,200,{ok:true,token,user:{id:row.id,username:row.username,is_admin:!!row.is_admin,permissions:row.is_admin?['*']:dashboardPerms(row.permissions)}});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao entrar.'});}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/auth/me') {
        try {const user=await dashboardSession(req,false);return sendJson(res,200,{ok:true,user});}
        catch(e){return sendJson(res,e.status||401,{ok:false,error:e.message||'Sessão inválida.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/auth/logout') {
        try {const token=dashboardBearer(req);if(token)await pool.query('DELETE FROM dashboard_sessions WHERE token_hash=$1',[dashboardTokenHash(token)]);} catch {}
        return sendJson(res,200,{ok:true});
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/auth/users') {
        try {
          const admin=await dashboardSession(req,true);
          const r=admin.client_id
            ? await pool.query('SELECT id::text AS id,username,is_admin,active,permissions,created_at,updated_at FROM dashboard_users WHERE client_id=$1 ORDER BY is_admin DESC,lower(username)',[admin.client_id])
            : await pool.query('SELECT id::text AS id,username,is_admin,active,permissions,created_at,updated_at FROM dashboard_users ORDER BY is_admin DESC,lower(username)');
          return sendJson(res,200,{ok:true,rows:r.rows.map(x=>Object.assign({},x,{permissions:x.is_admin?['*']:dashboardPerms(x.permissions)}))});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível carregar os usuários.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/auth/users') {
        try {
          const admin=await dashboardSession(req,true);
          const body=await readJsonBodyLimited(req,128*1024);
          const username=String(body.username||'').trim();
          const password=String(body.password||'');
          const permissions=Array.isArray(body.permissions)?Array.from(new Set(body.permissions.map(String))):[];
          const active=body.active!==false;
          if(username.length<2)return sendJson(res,400,{ok:false,error:'Informe um nome de usuário.'});
          if(password.length<4)return sendJson(res,400,{ok:false,error:'A senha deve ter pelo menos 4 caracteres.'});
          const ph=dashboardHashPassword(password);
          const r=await pool.query('INSERT INTO dashboard_users(username,password_salt,password_hash,is_admin,active,permissions,client_id,is_platform_admin,updated_at) VALUES($1,$2,$3,FALSE,$4,$5::jsonb,$6,FALSE,NOW()) RETURNING id::text AS id,username,is_admin,active,permissions,created_at,updated_at',[username,ph.salt,ph.hash,active,JSON.stringify(permissions),admin.client_id]);
          const user=Object.assign({},r.rows[0],{permissions:dashboardPerms(r.rows[0].permissions)});
          return sendJson(res,201,{ok:true,user});
        } catch(e){
          const msg=e.code==='23505'?'Já existe um usuário com esse nome.':(e.message||'Não foi possível criar o usuário.');
          return sendJson(res,e.code==='23505'?409:(e.status||500),{ok:false,error:msg});
        }
      }

      if (req.method === 'PATCH' && u.pathname.startsWith('/api/painel/auth/users/')) {
        try {
          const admin=await dashboardSession(req,true);
          const id=u.pathname.slice('/api/painel/auth/users/'.length);
          if(!/^[0-9]+$/.test(id))return sendJson(res,404,{ok:false,error:'Usuário não encontrado.'});
          const body=await readJsonBodyLimited(req,128*1024);
          const current=admin.client_id
            ? await pool.query('SELECT id::text AS id,is_admin FROM dashboard_users WHERE id=$1 AND client_id=$2 LIMIT 1',[id,admin.client_id])
            : await pool.query('SELECT id::text AS id,is_admin FROM dashboard_users WHERE id=$1 LIMIT 1',[id]);
          if(!current.rowCount)return sendJson(res,404,{ok:false,error:'Usuário não encontrado.'});
          const username=body.username==null?null:String(body.username).trim();
          const active=body.active==null?null:!!body.active;
          const permissions=Array.isArray(body.permissions)?Array.from(new Set(body.permissions.map(String))):null;
          const password=body.password==null?'':String(body.password);
          if(username!==null&&username.length<2)return sendJson(res,400,{ok:false,error:'Nome de usuário inválido.'});
          if(password&&password.length<4)return sendJson(res,400,{ok:false,error:'A senha deve ter pelo menos 4 caracteres.'});
          if(String(admin.id)===String(id)&&active===false)return sendJson(res,400,{ok:false,error:'O administrador não pode desativar a própria conta.'});
          const sets=[];const vals=[];
          const add=(expr,value)=>{vals.push(value);sets.push(expr.replace('?',String.fromCharCode(36)+vals.length));};
          if(username!==null)add('username=?',username);
          if(active!==null)add('active=?',active);
          if(permissions!==null&&!current.rows[0].is_admin)add('permissions=?::jsonb',JSON.stringify(permissions));
          if(password){const ph=dashboardHashPassword(password);add('password_salt=?',ph.salt);add('password_hash=?',ph.hash);}
          sets.push('updated_at=NOW()');
          vals.push(id);
          const r=await pool.query('UPDATE dashboard_users SET '+sets.join(', ')+' WHERE id='+String.fromCharCode(36)+vals.length+' RETURNING id::text AS id,username,is_admin,active,permissions,created_at,updated_at',vals);
          const user=Object.assign({},r.rows[0],{permissions:r.rows[0].is_admin?['*']:dashboardPerms(r.rows[0].permissions)});
          return sendJson(res,200,{ok:true,user});
        } catch(e){
          const msg=e.code==='23505'?'Já existe um usuário com esse nome.':(e.message||'Não foi possível atualizar o usuário.');
          return sendJson(res,e.code==='23505'?409:(e.status||500),{ok:false,error:msg});
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/motoristas-veiculos') {
        try {
          const user=await sessionOrInternal(req);
          const r = user.client_id ? await pool.query(`
            SELECT DISTINCT ON (upper(trim(placa)))
              upper(trim(placa)) AS placa,
              trim(COALESCE(motorista,'')) AS motorista
            FROM coletas
            WHERE client_id=$1
              AND trim(COALESCE(placa,'')) <> ''
              AND trim(COALESCE(motorista,'')) <> ''
            ORDER BY upper(trim(placa)), updated_at DESC NULLS LAST, id DESC
          `,[user.client_id]) : await pool.query(`
            SELECT DISTINCT ON (upper(trim(placa)))
              upper(trim(placa)) AS placa,
              trim(COALESCE(motorista,'')) AS motorista
            FROM coletas
            WHERE trim(COALESCE(placa,'')) <> ''
              AND trim(COALESCE(motorista,'')) <> ''
            ORDER BY upper(trim(placa)), updated_at DESC NULLS LAST, id DESC
          `);
          return sendJson(res, 200, { ok: true, rows: r.rows });
        } catch (e) {
          return sendJson(res, e.status||500, { ok: false, error: e.message || 'Não foi possível carregar motoristas e veículos.' });
        }
      }


      const dadosDocumentaisMatch = u.pathname.match(/^\/api\/painel\/coletas-documentais\/([^/]+)$/);
      if (req.method === 'PATCH' && dadosDocumentaisMatch) {
        try {
          const docUser=await dashboardSession(req,false);
          if(!dashboardHas(docUser,'coletas')) return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});

          const id = decodeURIComponent(dadosDocumentaisMatch[1]);
          const body = await readJsonBodyLimited(req, 256 * 1024);
          const rg = String(body.motorista_rg || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 50);
          const placaCarreta = String(body.placa_carreta || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
          const capacidadeCavalo = String(body.capacidade_carga_cavalo || '').trim().slice(0, 80);
          const capacidadeCarreta = String(body.capacidade_carga_carreta || '').trim().slice(0, 80);
          const intOrNull = v => {
            if (v === '' || v === null || v === undefined) return null;
            const n = Number(v);
            return Number.isInteger(n) && n >= 0 && n <= 20 ? n : null;
          };
          const eixosCavalo = intOrNull(body.eixos_cavalo);
          const eixosCarreta = intOrNull(body.eixos_carreta);
          let eixosTotal = intOrNull(body.eixos_total);
          if (eixosTotal === null && (eixosCavalo !== null || eixosCarreta !== null)) {
            eixosTotal = Number(eixosCavalo || 0) + Number(eixosCarreta || 0);
          }
          const sql = 'UPDATE coletas SET motorista_rg=$1, placa_carreta=$2, capacidade_carga_cavalo=$3, ' +
            'eixos_cavalo=$4, capacidade_carga_carreta=$5, eixos_carreta=$6, ' +
            'eixos=COALESCE($7,eixos), updated_at=NOW() WHERE id::text=$8 ' +
            'RETURNING id::text AS id, motorista, motorista_rg, motorista_cpf, placa, placa_carreta, ' +
            'capacidade_carga_cavalo, eixos_cavalo, capacidade_carga_carreta, eixos_carreta, eixos';
          const r = await pool.query(sql, [
            rg || null, placaCarreta || null, capacidadeCavalo || null, eixosCavalo,
            capacidadeCarreta || null, eixosCarreta, eixosTotal, id
          ]);
          if (!r.rowCount) return sendJson(res, 404, { ok:false, error:'Coleta não encontrada.' });
          return sendJson(res, 200, { ok:true, ...r.rows[0] });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok:false, error:e.message || 'Não foi possível salvar os dados documentais.' });
        }
      }

      const docsListMatch = u.pathname.match(/^\/api\/painel\/coletas-documentos\/([^/]+)$/);
      if (req.method === 'GET' && docsListMatch) {
        try {
          const docUser=await dashboardSession(req,false);
          if(!dashboardHas(docUser,'coletas')) return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});

          const id = decodeURIComponent(docsListMatch[1]);
          const r = await pool.query(
            'SELECT tipo, nome_arquivo, mime, bytes, criado_em, atualizado_em FROM coleta_documentos WHERE coleta_id=$1 ORDER BY tipo',
            [id]
          );
          return sendJson(res, 200, { ok:true, rows:r.rows });
        } catch (e) {
          return sendJson(res, 500, { ok:false, error:e.message || 'Não foi possível consultar os documentos.' });
        }
      }

      if (req.method === 'POST' && docsListMatch) {
        try {
          const docUser=await dashboardSession(req,false);
          if(!dashboardHas(docUser,'coletas')) return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});

          const id = decodeURIComponent(docsListMatch[1]);
          const exists = await pool.query('SELECT 1 FROM coletas WHERE id::text=$1 LIMIT 1',[id]);
          if (!exists.rowCount) return sendJson(res,404,{ok:false,error:'Coleta não encontrada.'});
          const body = await readJsonBodyLimited(req, 10 * 1024 * 1024);
          const tipo = String(body.tipo || '').toLowerCase();
          if (!['motorista','cavalo','carreta'].includes(tipo)) {
            return sendJson(res,400,{ok:false,error:'Tipo de documento inválido.'});
          }
          const doc = parseDocumentDataUrl(body.arquivo);
          const nome = String(body.nome_arquivo || ('documento-'+tipo)).trim().slice(0,180) || ('documento-'+tipo);
          const sql = 'INSERT INTO coleta_documentos(coleta_id,tipo,nome_arquivo,mime,arquivo,bytes) VALUES($1,$2,$3,$4,$5,$6) ' +
            'ON CONFLICT (coleta_id,tipo) DO UPDATE SET nome_arquivo=EXCLUDED.nome_arquivo,mime=EXCLUDED.mime,' +
            'arquivo=EXCLUDED.arquivo,bytes=EXCLUDED.bytes,atualizado_em=NOW()';
          await pool.query(sql,[id,tipo,nome,doc.mime,doc.buffer,doc.buffer.length]);
          return sendJson(res,201,{ok:true,tipo,nome_arquivo:nome,mime:doc.mime,bytes:doc.buffer.length});
        } catch (e) {
          return sendJson(res,e.status || 500,{ok:false,error:e.message || 'Não foi possível salvar o documento.'});
        }
      }

      const docFileMatch = u.pathname.match(/^\/api\/painel\/coletas-documentos\/([^/]+)\/(motorista|cavalo|carreta)$/);
      if (req.method === 'GET' && docFileMatch) {
        try {
          const docUser=await dashboardSession(req,false);
          if(!dashboardHas(docUser,'coletas')) return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});

          const id=decodeURIComponent(docFileMatch[1]),tipo=docFileMatch[2];
          const r=await pool.query(
            'SELECT nome_arquivo,mime,arquivo FROM coleta_documentos WHERE coleta_id=$1 AND tipo=$2 LIMIT 1',
            [id,tipo]
          );
          if(!r.rowCount) return sendJson(res,404,{ok:false,error:'Documento não encontrado.'});
          const row=r.rows[0],safeName=String(row.nome_arquivo||('documento-'+tipo)).replace(/["\r\n]/g,'_');
          res.writeHead(200,{
            'Content-Type':row.mime || 'application/octet-stream',
            'Content-Length':row.arquivo.length,
            'Content-Disposition':'inline; filename="'+safeName+'"',
            'Cache-Control':'private, max-age=300'
          });
          return res.end(row.arquivo);
        } catch(e) {
          return sendJson(res,500,{ok:false,error:e.message || 'Não foi possível abrir o documento.'});
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/coletas-status-resumo') {
        try {
          await sessionOrInternal(req);
          const from = String(u.searchParams.get('from') || '').trim();
          const to = String(u.searchParams.get('to') || '').trim();
          const params = [];
          const where = [];
          if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); where.push('data_carregamento >= $' + params.length); }
          if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { params.push(to); where.push('data_carregamento <= $' + params.length); }
          const sql = 'SELECT ' +
            "COUNT(*)::int AS total, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,'')))='programada')::int AS programadas, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,'')))='carregando')::int AS carregando, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,''))) IN ('em trânsito','em transito'))::int AS em_transito, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,'')))='entregue')::int AS entregues, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,''))) LIKE 'cancel%')::int AS canceladas, " +
            'MAX(updated_at) AS ultima_atualizacao FROM coletas ' +
            (where.length ? 'WHERE ' + where.join(' AND ') : '');
          const r = await pool.query(sql, params);
          const row = r.rows[0] || {};
          row.ativas = Math.max(0, Number(row.total || 0) - Number(row.canceladas || 0));
          row.pendentes = Number(row.programadas || 0) + Number(row.carregando || 0) + Number(row.em_transito || 0);
          return sendJson(res, 200, { ok: true, from: from || null, to: to || null, ...row });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Não foi possível resumir as coletas.' });
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/agendamento-teste') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'agendamentos')||dashboardHas(user,'dashboard')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const nf=String(u.searchParams.get('nf')||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');
          const params=[],where=[];
          if(user.client_id){params.push(user.client_id);where.push('client_id=$'+params.length)}
          if(nf){params.push(nf);where.push('nf=$'+params.length)}
          const limit=Math.max(1,Math.min(500,Number(u.searchParams.get('limit')||100)));
          params.push(limit);
          const sql='SELECT id::text AS id,nf,ctrc,cliente,cidade,uf,status_ssw,mercadoria,peso,volumes,previsao_ssw,dia_rota,agendado,data_agendamento,criado_em,atualizado_em FROM agendamento_teste ' +
            (where.length?('WHERE '+where.join(' AND ')+' '):'') + 'ORDER BY criado_em DESC LIMIT $'+params.length;
          const q=await pool.query(sql,params);
          return sendJson(res,200,{ok:true,rows:q.rows});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar agendamentos de teste.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/agendamento-teste') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'agendamentos')||dashboardHas(user,'dashboard')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,64*1024);
          const nf=String(body.nf||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');
          if(!nf)return sendJson(res,400,{ok:false,error:'Informe a nota fiscal.'});
          const agendado=!!body.agendado;
          const data=/^\d{4}-\d{2}-\d{2}$/.test(String(body.data_agendamento||''))?String(body.data_agendamento):null;
          if(agendado&&!data)return sendJson(res,400,{ok:false,error:'Informe a data do agendamento.'});
          const q=await pool.query(
            'INSERT INTO agendamento_teste (nf,ctrc,cliente,cidade,uf,status_ssw,mercadoria,peso,volumes,previsao_ssw,dia_rota,agendado,data_agendamento,criado_por,client_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id::text AS id,nf,ctrc,cliente,cidade,uf,status_ssw,mercadoria,peso,volumes,previsao_ssw,dia_rota,agendado,data_agendamento,criado_em',
            [nf,String(body.ctrc||''),String(body.cliente||''),String(body.cidade||''),String(body.uf||''),String(body.status_ssw||''),String(body.mercadoria||''),Number(body.peso||0),Number(body.volumes||0),String(body.previsao_ssw||''),String(body.dia_rota||''),agendado,data,user.id,user.client_id]
          );
          return sendJson(res,201,{ok:true,row:q.rows[0]});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao salvar agendamento de teste.'})}
      }
      const coletaStatusMatch=u.pathname.match(/^\/api\/painel\/coletas-status\/(\d+)$/);
      if (coletaStatusMatch && req.method === 'PATCH') {
        try{
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'coletas')||dashboardHas(user,'lotacao')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,32*1024);
          const allowed=['Programada','Em trânsito','Coletada','Entregue'];
          const status=allowed.find(x=>x.toLocaleLowerCase('pt-BR')===String(body.status||'').trim().toLocaleLowerCase('pt-BR'));
          if(!status)return sendJson(res,400,{ok:false,error:'Status inválido.'});
          const params=[status,coletaStatusMatch[1]];
          let where='id=$2';
          if(user.client_id){params.push(user.client_id);where+=' AND client_id=$3'}
          const q=await pool.query('UPDATE coletas SET status=$1,updated_at=NOW() WHERE '+where+' RETURNING id::text AS id,status',params);
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Coleta não encontrada.'});
          return sendJson(res,200,{ok:true,row:q.rows[0]});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível atualizar o status da coleta.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/coletas-resumo') {
        const user=await dashboardSession(req,false);
        const from=String(u.searchParams.get('from')||'').trim();
        const to=String(u.searchParams.get('to')||'').trim();
        const params=[],where=[];
        if(user.client_id){params.push(user.client_id);where.push('c.client_id=$'+params.length)}
        if(/^\d{4}-\d{2}-\d{2}$/.test(from)){params.push(from);where.push("COALESCE(NULLIF(to_jsonb(c)->>'data_carregamento',''),NULLIF(to_jsonb(c)->>'data_coleta',''),NULLIF(to_jsonb(c)->>'collection_date',''),LEFT(COALESCE(to_jsonb(c)->>'created_at',''),10)) >= $"+params.length)}
        if(/^\d{4}-\d{2}-\d{2}$/.test(to)){params.push(to);where.push("COALESCE(NULLIF(to_jsonb(c)->>'data_carregamento',''),NULLIF(to_jsonb(c)->>'data_coleta',''),NULLIF(to_jsonb(c)->>'collection_date',''),LEFT(COALESCE(to_jsonb(c)->>'created_at',''),10)) <= $"+params.length)}
        const result = await pool.query(`
          SELECT
            id::text AS id,
            COALESCE(to_jsonb(c)->>'os_numero', to_jsonb(c)->>'numero_os', to_jsonb(c)->>'os', to_jsonb(c)->>'numero_coleta', to_jsonb(c)->>'collection_number', '') AS os,
            COALESCE(to_jsonb(c)->>'cliente', to_jsonb(c)->>'client', to_jsonb(c)->>'nome_cliente', to_jsonb(c)->>'customer', '') AS cliente,
            COALESCE(to_jsonb(c)->>'destinatario', '') AS destinatario,
            COALESCE(to_jsonb(c)->>'origem', to_jsonb(c)->>'cidade_coleta', to_jsonb(c)->>'endereco_coleta', '') AS origem,
            COALESCE(to_jsonb(c)->>'destino', to_jsonb(c)->>'cidade_entrega', to_jsonb(c)->>'endereco_entrega', to_jsonb(c)->>'delivery_address', '') AS destino,
            COALESCE(to_jsonb(c)->>'motorista', to_jsonb(c)->>'driver', to_jsonb(c)->>'nome_motorista', '') AS motorista,
            COALESCE(to_jsonb(c)->>'placa', to_jsonb(c)->>'plate', '') AS placa,
            COALESCE(to_jsonb(c)->>'status','') AS status,
            COALESCE(to_jsonb(c)->>'data_carregamento', to_jsonb(c)->>'data_coleta', to_jsonb(c)->>'collection_date', to_jsonb(c)->>'created_at', '') AS data,
            COALESCE(
              NULLIF(to_jsonb(c)->>'frete_receber','')::numeric,
              NULLIF(to_jsonb(c)->>'frete_a_receber','')::numeric,
              NULLIF(to_jsonb(c)->>'frete_cobrado','')::numeric,
              NULLIF(to_jsonb(c)->>'valor_frete','')::numeric,
              0
            ) AS frete_receber,
            COALESCE(
              NULLIF(to_jsonb(c)->>'frete_pago','')::numeric,
              NULLIF(to_jsonb(c)->>'frete_motorista','')::numeric,
              NULLIF(to_jsonb(c)->>'valor_motorista','')::numeric,
              0
            ) AS frete_pago,
            COALESCE(
              NULLIF(to_jsonb(c)->>'pedagio','')::numeric,
              NULLIF(to_jsonb(c)->>'pedágio','')::numeric,
              0
            ) AS pedagio,
            COALESCE(to_jsonb(c)->>'adiantamento', to_jsonb(c)->>'percentual_adiantamento', '') AS adiantamento,
            COALESCE(c.recebido,false) AS recebido,
            c.data_recebimento,
            c.previsao_pagamento_fatura
          FROM coletas c
          ${where.length?'WHERE '+where.join(' AND '):''}
          ORDER BY COALESCE(NULLIF(to_jsonb(c)->>'data_carregamento',''),NULLIF(to_jsonb(c)->>'data_coleta',''),NULLIF(to_jsonb(c)->>'collection_date',''),LEFT(COALESCE(to_jsonb(c)->>'created_at',''),10)) DESC, id DESC
          LIMIT 500
        `,params);
        const rows=result.rows.map(r=>{
          const receber=Number(r.frete_receber||0),pago=Number(r.frete_pago||0),pedagio=Number(r.pedagio||0);
          return {...r,lucro:receber-pago-pedagio,margem:receber>0?((receber-pago-pedagio)/receber*100):0}
        });
        return sendJson(res, 200, {ok:true,rows});
      }



      if (req.method === 'POST' && u.pathname === '/api/tracking/register-request') {
        try {
          const body=await readJsonBodyLimited(req,64*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const plate=String(body.vehicle_plate||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
          const deviceName=String(body.device_name||'Android').trim().slice(0,120);
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Informe o nome do motorista.'});
          if(plate&&plate.length<7)return sendJson(res,400,{ok:false,error:'Informe uma placa válida ou deixe em branco.'});
          const requestToken=crypto.randomBytes(32).toString('hex');

          // Auto-recuperação: se este mesmo motorista/placa/aparelho já foi
          // aprovado antes, não exige uma nova aprovação manual. Gera uma nova
          // credencial válida e deixa o app recuperar o rastreio sozinho.
          const previouslyApproved=await pool.query(
            `SELECT 1
             FROM driver_tracking_requests
             WHERE status='approved'
               AND lower(trim(driver_name))=lower(trim($1))
               AND upper(trim(COALESCE(vehicle_plate,'')))=upper(trim(COALESCE($2,'')))
               AND lower(trim(COALESCE(device_name,'')))=lower(trim(COALESCE($3,'')))
             ORDER BY decided_at DESC NULLS LAST,created_at DESC
             LIMIT 1`,
            [driver,plate,deviceName]
          );
          if(previouslyApproved.rowCount){
            const token=crypto.randomBytes(32).toString('hex');
            const client=await pool.connect();
            try{
              await client.query('BEGIN');
              const dev=await client.query(
                "INSERT INTO driver_tracking_devices(token_hash,driver_name,vehicle_plate,device_name,last_seen_at) VALUES($1,$2,$3,$4,NOW()) RETURNING id::text AS id",
                [dashboardTokenHash(token),driver,plate,deviceName]
              );
              await client.query(
                "INSERT INTO driver_tracking_sessions(device_id,status) VALUES($1,'active')",
                [dev.rows[0].id]
              );
              await client.query(
                "INSERT INTO driver_tracking_requests(request_token_hash,driver_name,vehicle_plate,device_name,status,issued_token,approved_device_id,decided_at) VALUES($1,$2,$3,$4,'approved',$5,$6,NOW())",
                [dashboardTokenHash(requestToken),driver,plate,deviceName,token,dev.rows[0].id]
              );
              await client.query('COMMIT');
              console.log('TRACKING AUTO-RECUPERACAO aprovada: '+JSON.stringify({driver,plate,deviceName,deviceId:dev.rows[0].id}));
              return sendJson(res,201,{ok:true,status:'approved',request_token:requestToken,token,driver_name:driver,vehicle_plate:plate,message:'Aparelho reconhecido. Rastreamento liberado automaticamente.'});
            }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
          }

          await pool.query(
            "INSERT INTO driver_tracking_requests(request_token_hash,driver_name,vehicle_plate,device_name,status) VALUES($1,$2,$3,$4,'pending')",
            [dashboardTokenHash(requestToken),driver,plate,deviceName]
          );
          console.log('TRACKING APROVACAO solicitada: '+JSON.stringify({driver,plate,deviceName}));
          return sendJson(res,201,{ok:true,status:'pending',request_token:requestToken,message:'Solicitação enviada. Aguarde a aprovação da central.'});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao solicitar ativação.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/register-status') {
        try {
          const requestToken=String(u.searchParams.get('request_token')||'').trim();
          if(requestToken.length<20)return sendJson(res,400,{ok:false,error:'Solicitação inválida.'});
          const q=await pool.query(
            "SELECT id::text AS id,driver_name,vehicle_plate,status,issued_token,created_at,decided_at FROM driver_tracking_requests WHERE request_token_hash=$1 LIMIT 1",
            [dashboardTokenHash(requestToken)]
          );
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Solicitação não encontrada.'});
          const row=q.rows[0];
          if(row.status==='approved'&&row.issued_token){
            return sendJson(res,200,{ok:true,status:'approved',token:row.issued_token,driver_name:row.driver_name,vehicle_plate:row.vehicle_plate||''});
          }
          return sendJson(res,200,{ok:true,status:row.status,driver_name:row.driver_name,vehicle_plate:row.vehicle_plate||''});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar aprovação.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/enroll') {
        try {
          const body=await readJsonBodyLimited(req,64*1024);
          const code=String(body.code||'').replace(/\D/g,'');
          const deviceName=String(body.device_name||'Android').trim().slice(0,120);
          if(!/^\d{6}$/.test(code))return sendJson(res,400,{ok:false,error:'Código de ativação inválido.'});
          const codeHash=dashboardTokenHash(code);
          const q=await pool.query(
            "SELECT id::text AS id, driver_name, vehicle_plate FROM driver_tracking_enrollments WHERE code_hash=$1 AND used_at IS NULL AND expires_at>NOW() LIMIT 1",
            [codeHash]
          );
          if(!q.rowCount)return sendJson(res,401,{ok:false,error:'Código expirado ou já utilizado.'});
          const row=q.rows[0],token=crypto.randomBytes(32).toString('hex');
          const client=await pool.connect();
          try{
            await client.query('BEGIN');
            // Não desativa imediatamente aparelhos anteriores da mesma placa.
            // Isso evita que uma nova solicitação/reaprovação invalide o token
            // que o app ainda está usando enquanto recebe a nova credencial.
            const dev=await client.query(
              "INSERT INTO driver_tracking_devices(token_hash,driver_name,vehicle_plate,device_name,last_seen_at) VALUES($1,$2,$3,$4,NOW()) RETURNING id::text AS id",
              [dashboardTokenHash(token),row.driver_name,row.vehicle_plate||'',deviceName]
            );
            await client.query('UPDATE driver_tracking_enrollments SET used_at=NOW() WHERE id=$1',[row.id]);
            await client.query('COMMIT');
            return sendJson(res,200,{ok:true,token,device_id:dev.rows[0].id,driver_name:row.driver_name,vehicle_plate:row.vehicle_plate||''})
          }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao ativar dispositivo.'})}
      }

      async function trackingEnsureTodaySession(deviceId) {
        const active=await pool.query(
          "SELECT id::text AS id,started_at FROM driver_tracking_sessions WHERE device_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",
          [deviceId]
        );
        if(active.rowCount){
          const sameDay=await pool.query(
            "SELECT (($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AS ok",
            [active.rows[0].started_at]
          );
          if(sameDay.rows[0]?.ok)return active.rows[0].id;
          await pool.query(
            "UPDATE driver_tracking_sessions SET status='ended',ended_at=COALESCE(ended_at,NOW()) WHERE id::text=$1",
            [active.rows[0].id]
          );
        }
        const today=await pool.query(
          "SELECT id::text AS id,status FROM driver_tracking_sessions WHERE device_id=$1 AND (started_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY started_at DESC LIMIT 1",
          [deviceId]
        );
        // Se a rota foi encerrada hoje, só reabre quando existe um romaneio ativo para
        // este motorista/placa. O encerramento desativa a associação, então uma associação
        // ativa aqui é sempre posterior a ele (novo romaneio no mesmo dia).
        if(today.rowCount&&today.rows[0].status==='ended'){
          const assigned=await pool.query(
            `SELECT 1
             FROM driver_tracking_assignments a
             JOIN driver_tracking_devices d ON d.id=$1
             WHERE a.active=TRUE
               AND a.work_date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
               AND (
                 (COALESCE(a.vehicle_plate,'')<>'' AND upper(trim(a.vehicle_plate))=upper(trim(COALESCE(d.vehicle_plate,''))))
                 OR lower(trim(a.driver_name))=lower(trim(d.driver_name))
               )
             LIMIT 1`,
            [deviceId]
          );
          if(!assigned.rowCount)return '';
        }
        const q=await pool.query("INSERT INTO driver_tracking_sessions(device_id,status) VALUES($1,'active') RETURNING id::text AS id",[deviceId]);
        return q.rows[0]?.id||'';
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/session/start') {
        try {
          const device=await trackingDeviceFromReq(req);
          await pool.query("UPDATE driver_tracking_sessions SET status='ended',ended_at=COALESCE(ended_at,NOW()) WHERE device_id=$1 AND status='active'",[device.id]);
          const q=await pool.query("INSERT INTO driver_tracking_sessions(device_id,status) VALUES($1,'active') RETURNING id::text AS id,started_at",[device.id]);
          await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
          return sendJson(res,200,{ok:true,session_id:q.rows[0].id,started_at:q.rows[0].started_at,driver_name:device.driver_name,vehicle_plate:device.vehicle_plate||''})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao iniciar rota.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/session/stop') {
        try {
          const device=await trackingDeviceFromReq(req);
          const body=await readJsonBodyLimited(req,32*1024),sessionId=String(body.session_id||'').trim();
          if(sessionId)await pool.query("UPDATE driver_tracking_sessions SET status='ended',ended_at=NOW() WHERE id::text=$1 AND device_id=$2",[sessionId,device.id]);
          else await pool.query("UPDATE driver_tracking_sessions SET status='ended',ended_at=NOW() WHERE device_id=$1 AND status='active'",[device.id]);
          await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
          return sendJson(res,200,{ok:true})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao encerrar rota.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/heartbeat') {
        try {
          const device=await trackingDeviceFromReq(req);
          if(await trackingYieldToNewerDevice(device))return sendJson(res,401,{ok:false,error:'Dispositivo substituído por outro aparelho.'});
          const body=await readJsonBodyLimited(req,16*1024);
          const health=trackingCleanHealth(body.health);
          const appVersion=typeof body.app_version==='string'?body.app_version.trim().slice(0,40):'';
          // A sessão válida é sempre a de HOJE (abre ou reaproveita). O sinal de vida é registrado
          // de qualquer forma: antes, uma sessão vencida fazia o servidor recusar o aviso e o
          // motorista aparecia como "sem sinal" mesmo com o aplicativo funcionando; e uma sessão
          // de ontem ainda aberta continuava recebendo as posições de hoje.
          const effectiveSessionId=await trackingEnsureTodaySession(device.id);
          await pool.query(
            `UPDATE driver_tracking_devices
             SET last_seen_at=NOW(),
                 app_version=COALESCE(NULLIF($2,''),app_version),
                 health=COALESCE($3::jsonb,health),
                 health_at=CASE WHEN $3::jsonb IS NULL THEN health_at ELSE NOW() END
             WHERE id=$1`,
            [device.id,appVersion,health?JSON.stringify(health):null]
          );
          return sendJson(res,200,{ok:true,session_id:effectiveSessionId||null,server_time:new Date().toISOString(),...trackingLatestApp()})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao confirmar comunicação do dispositivo.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/point') {
        try {
          const device=await trackingDeviceFromReq(req);
          const body=await readJsonBodyLimited(req,48*1024);
          const sessionId=String(body.session_id||'').trim(),lat=Number(body.latitude),lon=Number(body.longitude);
          const captured=new Date(body.captured_at||Date.now());
          if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180)return sendJson(res,400,{ok:false,error:'Coordenadas inválidas.'});
          if(!trackingPointPlausible(lat,lon)){
            console.log('TRACKING GPS descartado fora da área operacional: '+JSON.stringify({driver:device.driver_name,plate:device.vehicle_plate,lat,lon}));
            await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
            return sendJson(res,200,{ok:true,ignored:true,reason:'outside_operational_area'});
          }
          if(!Number.isFinite(captured.getTime()))return sendJson(res,400,{ok:false,error:'Data/hora inválida.'});
          let effectiveSessionId=sessionId;
          if(sessionId){
            // Só vale sessão ativa e aberta HOJE; a de ontem é trocada pela de hoje logo abaixo.
            const sess=await pool.query("SELECT id::text AS id FROM driver_tracking_sessions WHERE id::text=$1 AND device_id=$2 AND status='active' AND (started_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date LIMIT 1",[sessionId,device.id]);
            if(!sess.rowCount)effectiveSessionId='';
          }
          if(!effectiveSessionId){
            effectiveSessionId=await trackingEnsureTodaySession(device.id);
          }
          if(!effectiveSessionId){
            await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
            return sendJson(res,409,{ok:false,error:'Sessão de rota foi encerrada hoje. Inicie uma nova rota para voltar ao mapa.'});
          }
          await pool.query(
            "INSERT INTO driver_tracking_points(session_id,device_id,latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [effectiveSessionId,device.id,lat,lon,Number.isFinite(Number(body.accuracy_m))?Number(body.accuracy_m):null,Number.isFinite(Number(body.speed_mps))?Number(body.speed_mps):null,Number.isFinite(Number(body.bearing_deg))?Number(body.bearing_deg):null,Number.isFinite(Number(body.battery_pct))?Number(body.battery_pct):null,captured.toISOString()]
          );
          await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
          return sendJson(res,200,{ok:true,session_id:effectiveSessionId})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao registrar posição.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/points') {
        try {
          const device=await trackingDeviceFromReq(req);
          const body=await readJsonBodyLimited(req,512*1024);
          const list=(Array.isArray(body.points)?body.points:[]).slice(0,300);
          if(!list.length)return sendJson(res,400,{ok:false,error:'Nenhuma posição enviada.'});
          const sessionId=await trackingEnsureTodaySession(device.id);
          if(!sessionId){
            await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
            return sendJson(res,409,{ok:false,error:'Sessão de rota foi encerrada hoje.'});
          }
          let saved=0,ignored=0;
          const now=Date.now();
          for(const p of list){
            const lat=Number(p&&p.latitude),lon=Number(p&&p.longitude),captured=new Date(p&&p.captured_at);
            const t=captured.getTime();
            // Só entra o que é do período recente: a fila serve para cobrir trechos sem internet,
            // não para regravar dias anteriores.
            if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(t)||t>now+5*60*1000||t<now-18*3600*1000||!trackingPointPlausible(lat,lon)){ignored++;continue}
            const n=k=>Number.isFinite(Number(p[k]))&&p[k]!==null&&p[k]!==''?Number(p[k]):null;
            const r=await pool.query(
              `INSERT INTO driver_tracking_points(session_id,device_id,latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at)
               SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz
               WHERE NOT EXISTS (SELECT 1 FROM driver_tracking_points WHERE device_id=$2 AND captured_at=$9::timestamptz)`,
              [sessionId,device.id,lat,lon,n('accuracy_m'),n('speed_mps'),n('bearing_deg'),n('battery_pct'),captured.toISOString()]
            );
            if(r.rowCount)saved++;else ignored++;
          }
          await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
          return sendJson(res,200,{ok:true,session_id:sessionId,saved,ignored})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao registrar posições.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/contacts') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const q=await pool.query('SELECT driver_key,driver_name,phone,updated_at FROM driver_tracking_contacts ORDER BY driver_name LIMIT 1000');
          return sendJson(res,200,{ok:true,rows:q.rows});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar telefones.'})}
      }

      if (req.method === 'PUT' && u.pathname === '/api/painel/tracking/contacts') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,16*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120),key=trackingContactKey(driver);
          if(key.length<2)return sendJson(res,400,{ok:false,error:'Motorista inválido.'});
          const raw=String(body.phone||'').trim();
          if(!raw){
            await pool.query('DELETE FROM driver_tracking_contacts WHERE driver_key=$1',[key]);
            return sendJson(res,200,{ok:true,driver_key:key,phone:''});
          }
          const phone=trackingPhoneDigits(raw);
          if(!phone)return sendJson(res,400,{ok:false,error:'Telefone inválido. Informe DDD + número, por exemplo 19 99999-9999.'});
          await pool.query(
            `INSERT INTO driver_tracking_contacts(driver_key,driver_name,phone,updated_by) VALUES($1,$2,$3,$4)
             ON CONFLICT (driver_key) DO UPDATE SET driver_name=EXCLUDED.driver_name,phone=EXCLUDED.phone,updated_at=NOW(),updated_by=EXCLUDED.updated_by`,
            [key,driver,phone,user.id]
          );
          return sendJson(res,200,{ok:true,driver_key:key,phone});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao salvar telefone.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/requests') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const q=await pool.query(`
            SELECT x.id::text AS id,x.driver_name,x.vehicle_plate,x.device_name,x.status,x.created_at,x.decided_at,
                   (x.status='approved' AND d.id IS NOT NULL AND d.last_seen_at<=d.enrolled_at) AS never_connected,
                   EXISTS(
                     SELECT 1 FROM driver_tracking_devices l
                     WHERE l.active=TRUE
                       AND l.last_seen_at>=NOW()-INTERVAL '10 minutes'
                       AND l.last_seen_at>l.enrolled_at
                       AND l.id IS DISTINCT FROM x.approved_device_id
                       AND (
                         (COALESCE(x.vehicle_plate,'')<>'' AND upper(trim(COALESCE(l.vehicle_plate,'')))=upper(trim(x.vehicle_plate)))
                         OR lower(trim(l.driver_name))=lower(trim(x.driver_name))
                       )
                   ) AS has_live_device
            FROM (
              SELECT r.*,
                     ROW_NUMBER() OVER (
                       PARTITION BY lower(trim(driver_name)), upper(trim(COALESCE(vehicle_plate,'')))
                       ORDER BY created_at DESC,id DESC
                     ) AS rn
              FROM driver_tracking_requests r
            ) x
            LEFT JOIN driver_tracking_devices d ON d.id=x.approved_device_id
            WHERE x.rn=1
              AND (x.status='pending'
                   OR (x.created_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                   OR (x.decided_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
            ORDER BY (x.status='pending') DESC,x.created_at DESC
            LIMIT 100
          `);
          return sendJson(res,200,{ok:true,rows:q.rows});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar solicitações.'})}
      }

      if (req.method === 'POST' && /^\/api\/painel\/tracking\/requests\/\d+\/approve$/.test(u.pathname)) {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const id=(u.pathname.match(/requests\/(\d+)\/approve$/)||[])[1];
          const client=await pool.connect();
          try{
            await client.query('BEGIN');
            const rq=await client.query("SELECT * FROM driver_tracking_requests WHERE id=$1 FOR UPDATE",[id]);
            if(!rq.rowCount){await client.query('ROLLBACK');return sendJson(res,404,{ok:false,error:'Solicitação não encontrada.'})}
            const row=rq.rows[0];
            if(row.status==='approved'){await client.query('COMMIT');return sendJson(res,200,{ok:true,status:'approved'})}
            const token=crypto.randomBytes(32).toString('hex');
            // Aparelhos anteriores do mesmo motorista/placa que estão PARADOS são desativados.
            // Quem está enviando sinal agora continua valendo: se o novo aparelho conectar de
            // verdade, o antigo cede a vez sozinho no próximo sinal (trackingYieldToNewerDevice).
            await client.query(
              `UPDATE driver_tracking_devices
               SET active=FALSE
               WHERE active=TRUE
                 AND lower(trim(driver_name))=lower(trim($1))
                 AND upper(trim(COALESCE(vehicle_plate,'')))=upper(trim(COALESCE($2,'')))
                 AND COALESCE(last_seen_at,enrolled_at)<NOW()-INTERVAL '10 minutes'`,
              [row.driver_name,row.vehicle_plate||'']
            );
            const dev=await client.query(
              "INSERT INTO driver_tracking_devices(token_hash,driver_name,vehicle_plate,device_name,last_seen_at) VALUES($1,$2,$3,$4,NOW()) RETURNING id::text AS id",
              [dashboardTokenHash(token),row.driver_name,row.vehicle_plate||'',row.device_name||'Android']
            );
            // A sessão do dia nasce no primeiro sinal do aplicativo (trackingEnsureTodaySession).
            // Criá-la aqui fazia o motorista aparecer "Em rota" sem o celular ter conectado.
            await client.query(
              "UPDATE driver_tracking_requests SET status='approved',issued_token=$1,approved_device_id=$2,decided_at=NOW(),decided_by=$3 WHERE id=$4",
              [token,dev.rows[0].id,user.id,id]
            );
            await client.query('COMMIT');
            console.log('TRACKING APROVACAO aprovada: '+JSON.stringify({id,driver:row.driver_name,plate:row.vehicle_plate||'',deviceId:dev.rows[0].id}));
            return sendJson(res,200,{ok:true,status:'approved',driver_name:row.driver_name,vehicle_plate:row.vehicle_plate||'',device_id:dev.rows[0].id});
          }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao aprovar dispositivo.'})}
      }

      if (req.method === 'POST' && /^\/api\/painel\/tracking\/requests\/\d+\/reject$/.test(u.pathname)) {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const id=(u.pathname.match(/requests\/(\d+)\/reject$/)||[])[1];
          await pool.query("UPDATE driver_tracking_requests SET status='rejected',decided_at=NOW(),decided_by=$1 WHERE id=$2 AND status='pending'",[user.id,id]);
          return sendJson(res,200,{ok:true,status:'rejected'});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao rejeitar dispositivo.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/tracking/test-assignment') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,64*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const plate=String(body.vehicle_plate||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
          const romaneios=[...new Set((Array.isArray(body.romaneios)?body.romaneios:[body.romaneio]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,20);
          const workDate=/^\d{4}-\d{2}-\d{2}$/.test(String(body.work_date||''))?String(body.work_date):(new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}));
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Motorista inválido.'});
          if(plate.length<7)return sendJson(res,400,{ok:false,error:'Placa inválida.'});
          if(!romaneios.length)return sendJson(res,400,{ok:false,error:'Romaneio não informado.'});
          const invite=crypto.randomBytes(32).toString('hex');
          await pool.query(
            "INSERT INTO driver_tracking_test_assignments(invite_token_hash,driver_name,vehicle_plate,romaneios,work_date,active) VALUES($1,$2,$3,$4::jsonb,$5::date,TRUE)",
            [dashboardTokenHash(invite),driver,plate,JSON.stringify(romaneios),workDate]
          );
          const installUrl=DRIVER_PUBLIC_BASE+'/motorista-teste-instalar?i='+encodeURIComponent(invite);
          return sendJson(res,201,{ok:true,driver_name:driver,vehicle_plate:plate,romaneios,work_date:workDate,install_url:installUrl,test_only:true});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao criar convite de teste.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/tracking/assignment') {
        try {
          const user=await sessionOrInternal(req);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,64*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const plate=String(body.vehicle_plate||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
          const romaneios=[...new Set((Array.isArray(body.romaneios)?body.romaneios:[body.romaneio]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,20);
          const workDate=/^\d{4}-\d{2}-\d{2}$/.test(String(body.work_date||''))?String(body.work_date):(new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}));
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Motorista inválido.'});
          if(plate.length<7)return sendJson(res,400,{ok:false,error:'Placa inválida.'});

          if(body.stop===true||body.active===false){
            const client=await pool.connect();
            try{
              await client.query('BEGIN');
              await client.query(
                `UPDATE driver_tracking_assignments SET active=FALSE,updated_at=NOW()
                 WHERE work_date=$1::date AND active=TRUE
                   AND (upper(trim(COALESCE(vehicle_plate,'')))=upper(trim($2)) OR lower(trim(driver_name))=lower(trim($3)))`,
                [workDate,plate,driver]
              );
              // Só encerra sessões de GPS quando o pedido é para HOJE. Um pedido referente a
              // outra data (ex.: consulta de dia anterior) não pode derrubar o rastreio em curso.
              if(workDate===spToday()){
                await client.query(
                  `UPDATE driver_tracking_sessions s
                   SET status='ended',ended_at=COALESCE(ended_at,NOW())
                   FROM driver_tracking_devices d
                   WHERE s.device_id=d.id AND s.status='active'
                     AND (upper(trim(COALESCE(d.vehicle_plate,'')))=upper(trim($1)) OR lower(trim(d.driver_name))=lower(trim($2)))`,
                  [plate,driver]
                );
              }
              await client.query('COMMIT');
            }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
            console.log('TRACKING AUTO STOP: '+JSON.stringify({driver,plate,workDate,reason:String(body.reason||'rota_concluida')}));
            return sendJson(res,200,{ok:true,stopped:true,driver_name:driver,vehicle_plate:plate,work_date:workDate});
          }

          if(!romaneios.length)return sendJson(res,400,{ok:false,error:'Romaneio não informado.'});
          const invite=crypto.randomBytes(32).toString('hex');
          const client=await pool.connect();
          try{
            await client.query('BEGIN');
            await client.query(
              `UPDATE driver_tracking_assignments SET active=FALSE,updated_at=NOW()
               WHERE work_date=$1::date AND active=TRUE
                 AND (upper(trim(COALESCE(vehicle_plate,'')))=upper(trim($2)) OR lower(trim(driver_name))=lower(trim($3)))`,
              [workDate,plate,driver]
            );
            await client.query(
              "INSERT INTO driver_tracking_assignments(invite_token_hash,driver_name,vehicle_plate,romaneios,work_date,active,created_by) VALUES($1,$2,$3,$4::jsonb,$5::date,TRUE,$6)",
              [dashboardTokenHash(invite),driver,plate,JSON.stringify(romaneios),workDate,user.id]
            );
            await client.query('COMMIT');
          }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
          const installUrl=DRIVER_PUBLIC_BASE+'/motorista-instalar?i='+encodeURIComponent(invite);
          return sendJson(res,201,{ok:true,driver_name:driver,vehicle_plate:plate,romaneios,work_date:workDate,invite_token:invite,install_url:installUrl});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao associar romaneio ao motorista.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/tracking/enrollments') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,32*1024);
          const driver=String(body.driver_name||'').trim(),plate=String(body.vehicle_plate||'').trim().toUpperCase().slice(0,20);
          const hours=Math.max(1,Math.min(168,Number(body.expires_hours||24)));
          if(!driver)return sendJson(res,400,{ok:false,error:'Informe o motorista.'});
          let code='';
          for(let i=0;i<10;i++){
            code=trackingCode();
            const exists=await pool.query('SELECT 1 FROM driver_tracking_enrollments WHERE code_hash=$1 AND used_at IS NULL AND expires_at>NOW() LIMIT 1',[dashboardTokenHash(code)]);
            if(!exists.rowCount)break
          }
          await pool.query(
            "INSERT INTO driver_tracking_enrollments(code_hash,driver_name,vehicle_plate,expires_at,created_by) VALUES($1,$2,$3,NOW()+($4*INTERVAL '1 hour'),$5)",
            [dashboardTokenHash(code),driver,plate,hours,user.id]
          );
          return sendJson(res,201,{ok:true,code,driver_name:driver,vehicle_plate:plate,expires_hours:hours})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao gerar código.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/test-live') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const q=await pool.query(`
            SELECT d.id::text AS device_id,d.driver_name,d.vehicle_plate,d.device_name,d.last_seen_at,
                   p.latitude,p.longitude,p.accuracy_m,p.captured_at,
                   EXTRACT(EPOCH FROM (NOW()-p.captured_at))::int AS age_seconds,
                   EXTRACT(EPOCH FROM (NOW()-d.last_seen_at))::int AS device_age_seconds
            FROM driver_tracking_test_devices d
            LEFT JOIN LATERAL (
              SELECT latitude,longitude,accuracy_m,captured_at
              FROM driver_tracking_test_points
              WHERE test_device_id=d.id
                AND (captured_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              ORDER BY captured_at DESC LIMIT 1
            ) p ON TRUE
            WHERE d.last_seen_at IS NOT NULL
              AND (d.last_seen_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
            ORDER BY COALESCE(p.captured_at,d.last_seen_at) DESC
            LIMIT 100
          `);
          const rows=[];
          for(const r of q.rows){
            const a=await pool.query(
              `SELECT romaneios FROM driver_tracking_test_assignments
               WHERE active=TRUE
                 AND work_date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                 AND lower(trim(driver_name))=lower(trim($1))
               ORDER BY created_at DESC,id DESC LIMIT 1`,
              [r.driver_name]
            );
            const romaneios=a.rowCount&&Array.isArray(a.rows[0].romaneios)?a.rows[0].romaneios:[];
            let movitRoute=null;
            if(romaneios.length){
              const mr=await pool.query(
                `SELECT romaneio,title,route_data,updated_at
                 FROM movit_romaneio_routes
                 WHERE event_date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                   AND romaneio=ANY($1::text[])
                 ORDER BY updated_at DESC LIMIT 1`,
                [romaneios.map(String)]
              );
              if(mr.rowCount)movitRoute=mr.rows[0];
            }
            rows.push({
              ...r,
              original_driver_name:r.driver_name,
              original_vehicle_plate:r.vehicle_plate,
              driver_name:'TESTE - '+r.driver_name,
              vehicle_plate:(String(r.vehicle_plate||'').trim()+' T').trim(),
              session_id:'TEST-'+r.device_id,
              session_status:'active',
              map_active:!!r.captured_at||Number(r.device_age_seconds)<=300,
              test_only:true,
              romaneios,
              movit_route:movitRoute,
              speed_mps:null,bearing_deg:null,battery_pct:null,trail:[]
            });
          }
          return sendJson(res,200,{ok:true,rows,test_only:true});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar GPS de teste.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/live') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const light=String(u.searchParams.get('light')||'')==='1';
          const q=await pool.query(light?`
            SELECT d.id::text AS device_id,d.driver_name,d.vehicle_plate,d.device_name,d.last_seen_at,
                   d.enrolled_at,d.app_version,d.health,d.health_at,
                   (d.last_seen_at IS NULL OR d.last_seen_at<=d.enrolled_at) AS never_connected,
                   s.id::text AS session_id,s.started_at,s.ended_at,s.status AS session_status,
                   p.latitude,p.longitude,p.accuracy_m,p.speed_mps,p.bearing_deg,p.battery_pct,p.captured_at,
                   '[]'::json AS trail,
                   EXTRACT(EPOCH FROM (NOW()-p.captured_at))::int AS age_seconds,
                   EXTRACT(EPOCH FROM (NOW()-d.last_seen_at))::int AS device_age_seconds,
                   (p.captured_at IS NOT NULL OR (d.last_seen_at >= NOW()-INTERVAL '5 minutes' AND d.last_seen_at>d.enrolled_at)) AS map_active
            FROM driver_tracking_devices d
            LEFT JOIN LATERAL (
              SELECT id,started_at,ended_at,status FROM driver_tracking_sessions
              WHERE device_id=d.id
                AND (started_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              ORDER BY (status='active') DESC,started_at DESC LIMIT 1
            ) s ON TRUE
            LEFT JOIN LATERAL (
              SELECT latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at
              FROM driver_tracking_points
              WHERE device_id=d.id
                AND captured_at >= NOW()-INTERVAL '7 days'
                AND latitude BETWEEN -27.5 AND -18.0
                AND longitude BETWEEN -52.5 AND -42.0
              ORDER BY ((captured_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) DESC,
                       (s.id IS NOT NULL AND session_id=s.id) DESC,captured_at DESC LIMIT 1
            ) p ON TRUE
            WHERE d.active=TRUE
            ORDER BY COALESCE(p.captured_at,d.last_seen_at) DESC NULLS LAST
            LIMIT 300
          `:`
            SELECT d.id::text AS device_id,d.driver_name,d.vehicle_plate,d.device_name,d.last_seen_at,
                   d.enrolled_at,d.app_version,d.health,d.health_at,
                   (d.last_seen_at IS NULL OR d.last_seen_at<=d.enrolled_at) AS never_connected,
                   s.id::text AS session_id,s.started_at,s.ended_at,s.status AS session_status,
                   p.latitude,p.longitude,p.accuracy_m,p.speed_mps,p.bearing_deg,p.battery_pct,p.captured_at,
                   COALESCE(t.trail,'[]'::json) AS trail,
                   EXTRACT(EPOCH FROM (NOW()-p.captured_at))::int AS age_seconds,
                   EXTRACT(EPOCH FROM (NOW()-d.last_seen_at))::int AS device_age_seconds,
                   (p.captured_at IS NOT NULL OR (d.last_seen_at >= NOW()-INTERVAL '5 minutes' AND d.last_seen_at>d.enrolled_at)) AS map_active
            FROM driver_tracking_devices d
            LEFT JOIN LATERAL (
              SELECT id,started_at,ended_at,status FROM driver_tracking_sessions
              WHERE device_id=d.id
                AND (started_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              ORDER BY (status='active') DESC,started_at DESC LIMIT 1
            ) s ON TRUE
            LEFT JOIN LATERAL (
              SELECT latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at
              FROM driver_tracking_points
              WHERE device_id=d.id
                AND captured_at >= NOW()-INTERVAL '7 days'
                AND latitude BETWEEN -27.5 AND -18.0
                AND longitude BETWEEN -52.5 AND -42.0
              ORDER BY ((captured_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) DESC,
                       (s.id IS NOT NULL AND session_id=s.id) DESC,captured_at DESC LIMIT 1
            ) p ON TRUE
            LEFT JOIN LATERAL (
              SELECT json_agg(json_build_object(
                'latitude',x.latitude,'longitude',x.longitude,'accuracy_m',x.accuracy_m,
                'speed_mps',x.speed_mps,'bearing_deg',x.bearing_deg,'battery_pct',x.battery_pct,
                'captured_at',x.captured_at
              ) ORDER BY x.captured_at) AS trail
              FROM (
                SELECT latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at
                FROM driver_tracking_points
                WHERE s.id IS NOT NULL AND session_id=s.id
                  AND latitude BETWEEN -27.5 AND -18.0
                  AND longitude BETWEEN -52.5 AND -42.0
                ORDER BY captured_at DESC
                LIMIT 1200
              ) x
            ) t ON TRUE
            WHERE d.active=TRUE
            ORDER BY COALESCE(p.captured_at,d.last_seen_at) DESC NULLS LAST
            LIMIT 300
          `);
          const freshest=new Map();
          for(const row of q.rows){
            const plate=String(row.vehicle_plate||'').trim().toUpperCase();
            const driver=String(row.driver_name||'').trim().toLocaleUpperCase('pt-BR');
            const key=plate?('P|'+plate):('D|'+driver);
            const at=Math.max(
              row.captured_at?new Date(row.captured_at).getTime():0,
              row.last_seen_at?new Date(row.last_seen_at).getTime():0,
              row.started_at?new Date(row.started_at).getTime():0
            );
            const prev=freshest.get(key);
            if(!prev||at>prev._freshAt)freshest.set(key,{...row,_freshAt:at});
          }
          let rows=[...freshest.values()].map(({_freshAt,...row})=>row)
            .sort((a,b)=>{
              const ta=Math.max(a.captured_at?new Date(a.captured_at).getTime():0,a.last_seen_at?new Date(a.last_seen_at).getTime():0);
              const tb=Math.max(b.captured_at?new Date(b.captured_at).getTime():0,b.last_seen_at?new Date(b.last_seen_at).getTime():0);
              return tb-ta
            });

          // Enriquece cada motorista do mapa com romaneio e rota planejada recebida do MOVIT.
          if(rows.length){
            const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
            for(const row of rows){
              const ar=await pool.query(
                `SELECT romaneios FROM driver_tracking_assignments
                 WHERE active=TRUE AND work_date=$1::date
                   AND (
                     lower(trim(driver_name))=lower(trim($2))
                     OR (COALESCE($3,'')<>'' AND upper(trim(COALESCE(vehicle_plate,'')))=upper(trim($3)))
                   )
                 ORDER BY updated_at DESC,id DESC LIMIT 1`,
                [today,row.driver_name||'',row.vehicle_plate||'']
              );
              row.romaneios=ar.rowCount&&Array.isArray(ar.rows[0].romaneios)?ar.rows[0].romaneios:[];
              const rr=await pool.query(
                `SELECT romaneio,title,route_data,updated_at
                 FROM movit_romaneio_routes
                 WHERE event_date=$1::date
                   AND (
                     lower(trim(driver_name))=lower(trim($2))
                     OR romaneio=ANY($3::text[])
                   )
                 ORDER BY updated_at DESC LIMIT 1`,
                [today,row.driver_name||'',row.romaneios.map(String)]
              );
              row.movit_route=rr.rowCount?rr.rows[0]:null;
            }
          }
          return sendJson(res,200,{ok:true,light,rows,server_time:new Date().toISOString()})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar rastreamento.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/history-drivers') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const date=String(u.searchParams.get('date')||'').trim();
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return sendJson(res,400,{ok:false,error:'Data inválida.'});
          const q=await pool.query(`
            SELECT d.driver_name,d.vehicle_plate,COUNT(*)::int AS points,
                   MIN(p.captured_at) AS first_point,MAX(p.captured_at) AS last_point
            FROM driver_tracking_points p
            JOIN driver_tracking_devices d ON d.id=p.device_id
            WHERE p.captured_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
              AND p.captured_at < (($1::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
            GROUP BY d.driver_name,d.vehicle_plate
            ORDER BY lower(d.driver_name),d.vehicle_plate
          `,[date]);
          return sendJson(res,200,{ok:true,date,rows:q.rows})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao listar motoristas do histórico.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/history') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const sessionId=String(u.searchParams.get('session_id')||'').trim();
          if(sessionId){
            const q=await pool.query(
              "SELECT latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at FROM driver_tracking_points WHERE session_id::text=$1 ORDER BY captured_at ASC LIMIT 10000",
              [sessionId]
            );
            return sendJson(res,200,{ok:true,rows:q.rows})
          }
          const date=String(u.searchParams.get('date')||'').trim();
          const driver=String(u.searchParams.get('driver')||'').trim();
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return sendJson(res,400,{ok:false,error:'Data inválida.'});
          const raw=String(u.searchParams.get('raw')||'')==='1';
          const plate=String(u.searchParams.get('plate')||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
          if(raw){
            const qr=await pool.query(`
              SELECT p.session_id::text AS session_id,d.driver_name,d.vehicle_plate,
                     p.latitude,p.longitude,p.accuracy_m,p.speed_mps,p.bearing_deg,p.battery_pct,p.captured_at
              FROM driver_tracking_points p
              JOIN driver_tracking_devices d ON d.id=p.device_id
              WHERE p.captured_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
                AND p.captured_at < (($1::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
                AND (
                  ($3<>'' AND regexp_replace(upper(COALESCE(d.vehicle_plate,'')),'[^A-Z0-9]','','g')=$3)
                  OR ($3='' AND ($2='' OR lower(trim(d.driver_name))=lower(trim($2))))
                )
              ORDER BY p.captured_at ASC
              LIMIT 60000
            `,[date,driver,plate]);
            return sendJson(res,200,{ok:true,date,driver:driver||'',plate:plate||'',raw:true,rows:qr.rows,points:qr.rows.length})
          }
          const q=await pool.query(`
            SELECT s.id::text AS session_id,d.driver_name,d.vehicle_plate,
                   s.started_at,s.ended_at,s.status,
                   p.latitude,p.longitude,p.accuracy_m,p.speed_mps,p.bearing_deg,p.battery_pct,p.captured_at
            FROM driver_tracking_points p
            JOIN driver_tracking_sessions s ON s.id=p.session_id
            JOIN driver_tracking_devices d ON d.id=p.device_id
            WHERE p.captured_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
              AND p.captured_at < (($1::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
              AND (
                ($3<>'' AND regexp_replace(upper(COALESCE(d.vehicle_plate,'')),'[^A-Z0-9]','','g')=$3)
                OR ($3='' AND ($2='' OR lower(trim(d.driver_name))=lower(trim($2))))
              )
            ORDER BY lower(d.driver_name),s.started_at,p.captured_at
            LIMIT 60000
          `,[date,driver,plate]);
          const map=new Map();
          for(const r of q.rows){
            if(!map.has(r.session_id))map.set(r.session_id,{
              session_id:r.session_id,driver_name:r.driver_name,vehicle_plate:r.vehicle_plate,
              started_at:r.started_at,ended_at:r.ended_at,status:r.status,points:[]
            });
            map.get(r.session_id).points.push({
              latitude:r.latitude,longitude:r.longitude,accuracy_m:r.accuracy_m,
              speed_mps:r.speed_mps,bearing_deg:r.bearing_deg,battery_pct:r.battery_pct,captured_at:r.captured_at
            })
          }
          const sessions=[...map.values()].map(trackingHistorySessionSummary);
          const drivers=new Set(sessions.map(x=>String(x.driver_name||'').trim()).filter(Boolean));
          const totalStops=sessions.reduce((a,x)=>a+(x.stops?.length||0),0);
          const distanceKm=sessions.reduce((a,x)=>a+Number(x.distance_km||0),0);
          return sendJson(res,200,{ok:true,date,driver:driver||'',sessions,summary:{
            drivers:drivers.size,sessions:sessions.length,points:q.rows.length,stops:totalStops,
            distance_km:Math.round(distanceKm*10)/10,stop_min_minutes:5,stop_radius_meters:150
          }})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar histórico.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/nf-materiais') {
        try {
          await sessionOrInternal(req);
          const special = String(u.searchParams.get('special') || '').trim() === '1';
          const limit = Math.max(1, Math.min(3000, Number(u.searchParams.get('limit') || 1500)));
          const where = special ? "WHERE classificacao <> 'normal'" : '';
          const qr = await pool.query(
            'SELECT id::text AS id, chave, nf, emitente_cnpj, emitente_nome, cliente, cidade, uf, classificacao, produtos, importado_em, atualizado_em ' +
            'FROM nf_materiais ' + where + ' ORDER BY atualizado_em DESC LIMIT $1',
            [limit]
          );
          return sendJson(res, 200, { ok: true, rows: qr.rows, count: qr.rows.length });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Não foi possível consultar a classificação das notas.' });
        }
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/nf-materiais/import') {
        try {
          await sessionOrInternal(req);
          const body = await readJsonBodyLimited(req, 4 * 1024 * 1024);
          const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
          if (!rows.length) return sendJson(res, 400, { ok: false, error: 'Nenhuma nota foi enviada para importação.' });
          let imported = 0;
          for (const item of rows) {
            const chave = String(item.chave || '').replace(/\D/g, '').trim();
            const nf = String(item.nf || '').replace(/\D/g, '').replace(/^0+/, '') || '0';
            const classificacao = String(item.classificacao || 'normal').trim().toLowerCase();
            const allowed = ['normal','tubos','caixa_agua','tubos_caixa_agua'];
            if (chave.length !== 44 || !allowed.includes(classificacao)) continue;
            const produtos = Array.isArray(item.produtos) ? item.produtos.map(x=>String(x||'').trim()).filter(Boolean).slice(0,250) : [];
            await pool.query(`
              INSERT INTO nf_materiais
                (chave,nf,emitente_cnpj,emitente_nome,cliente,cidade,uf,classificacao,produtos,atualizado_em)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
              ON CONFLICT (chave) DO UPDATE SET
                nf=EXCLUDED.nf,
                emitente_cnpj=EXCLUDED.emitente_cnpj,
                emitente_nome=EXCLUDED.emitente_nome,
                cliente=EXCLUDED.cliente,
                cidade=EXCLUDED.cidade,
                uf=EXCLUDED.uf,
                classificacao=EXCLUDED.classificacao,
                produtos=EXCLUDED.produtos,
                atualizado_em=NOW()
            `, [
              chave,nf,String(item.emitente_cnpj||'').trim(),String(item.emitente_nome||'').trim(),
              String(item.cliente||'').trim(),String(item.cidade||'').trim(),String(item.uf||'').trim(),
              classificacao,JSON.stringify(produtos)
            ]);
            imported++;
          }
          return sendJson(res, 200, { ok: true, imported });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Não foi possível importar os XMLs.' });
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/carregamentos-finais') {
        try {
          await sessionOrInternal(req);
          const limit = Math.max(1, Math.min(100, Number(u.searchParams.get('limit') || 30)));
          const motorista = String(u.searchParams.get('motorista') || '').trim();
          const data = String(u.searchParams.get('data') || '').trim();
          const tipo = String(u.searchParams.get('tipo') || '').trim().toLowerCase();
          const where = [];
          const params = [];

          if (motorista) {
            params.push('%' + motorista + '%');
            where.push('motorista ILIKE $' + params.length);
          }
          if (tipo) {
            if (!['carregamento','descarga'].includes(tipo)) {
              return sendJson(res, 400, { ok: false, error: 'Tipo de operação inválido.' });
            }
            params.push(tipo);
            where.push('lower(tipo) = $' + params.length);
          }
          if (data) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
              return sendJson(res, 400, { ok: false, error: 'Data de consulta inválida.' });
            }
            params.push(data);
            where.push("(capturada_em AT TIME ZONE 'America/Sao_Paulo')::date = $" + params.length + '::date');
          }

          params.push(limit);
          const sql =
            'SELECT id::text AS id, tipo, conferente, motorista, quantidade_entregas, ' +
            'capturada_em, criado_em, foto_mime, foto_bytes, foto2_bytes, foto3_bytes, foto4_bytes, conferente_coleta_devolucao, ' +
            '(SELECT COUNT(*)::int FROM carregamentos_avarias a WHERE a.carregamento_id=carregamentos_finais.id) AS avaria_count ' +
            'FROM carregamentos_finais ' +
            (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
            'ORDER BY capturada_em DESC, id DESC LIMIT $' + params.length;
          const qr = await pool.query(sql, params);
          return sendJson(res, 200, { ok: true, motorista: motorista || null, data: data || null, tipo: tipo || null, rows: qr.rows });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Não foi possível carregar os registros de carga e descarga.' });
        }
      }

      const carregamentoFotoMatch = u.pathname.match(/^\/api\/painel\/carregamentos-finais\/(\d+)\/foto(?:\/(\d))?$/);
      if (req.method === 'GET' && carregamentoFotoMatch) {
        try {
          await sessionOrInternal(req);
          const slot=Math.max(1,Math.min(4,Number(carregamentoFotoMatch[2]||1)));
          const photoCol=slot===1?'foto':'foto'+slot;
          const mimeCol=slot===1?'foto_mime':'foto'+slot+'_mime';
          const r = await pool.query(
            'SELECT '+photoCol+' AS foto, '+mimeCol+' AS foto_mime FROM carregamentos_finais WHERE id=$1 LIMIT 1',
            [carregamentoFotoMatch[1]]
          );
          if (!r.rowCount || !r.rows[0].foto) return sendJson(res, 404, { ok: false, error: 'Foto não encontrada.' });
          const row = r.rows[0];
          res.writeHead(200, {
            'Content-Type': row.foto_mime || 'image/jpeg',
            'Content-Length': row.foto.length,
            'Cache-Control': 'private, max-age=3600'
          });
          return res.end(row.foto);
        } catch (e) {
          return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Não foi possível carregar a foto.' });
        }
      }

      const avariaFotoMatch = u.pathname.match(/^\/api\/painel\/carregamentos-finais\/(\d+)\/avaria\/(\d+)$/);
      if (req.method === 'GET' && avariaFotoMatch) {
        try {
          await sessionOrInternal(req);
          const ordem=Math.max(1,Math.min(10,Number(avariaFotoMatch[2]||1)));
          const r=await pool.query(
            'SELECT foto, foto_mime FROM carregamentos_avarias WHERE carregamento_id=$1 AND ordem=$2 LIMIT 1',
            [avariaFotoMatch[1],ordem]
          );
          if(!r.rowCount)return sendJson(res,404,{ok:false,error:'Foto de avaria não encontrada.'});
          const row=r.rows[0];
          res.writeHead(200,{
            'Content-Type':row.foto_mime||'image/jpeg',
            'Content-Length':row.foto.length,
            'Cache-Control':'private, max-age=3600'
          });
          return res.end(row.foto);
        } catch(e) {
          return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível carregar a foto de avaria.'});
        }
      }

      const carregamentoColetaDevMatch = u.pathname.match(/^\/api\/painel\/carregamentos-finais\/(\d+)\/coleta-devolucao$/);
      if (req.method === 'PATCH' && carregamentoColetaDevMatch) {
        try {
          await sessionOrInternal(req);
          const body=await readJsonBodyLimited(req, 3 * 1024 * 1024);
          const conferente=String(body.conferente_coleta_devolucao||'').trim();
          const captured=new Date(body.capturada_em||Date.now());
          if(!conferente)return sendJson(res,400,{ok:false,error:'Informe o nome do conferente.'});
          if(!Number.isFinite(captured.getTime()))return sendJson(res,400,{ok:false,error:'Data/hora da foto inválida.'});
          const photo=parseImageDataUrl(body.foto);
          const current=await pool.query('SELECT tipo FROM carregamentos_finais WHERE id=$1 LIMIT 1',[carregamentoColetaDevMatch[1]]);
          if(!current.rowCount)return sendJson(res,404,{ok:false,error:'Registro de carregamento não encontrado.'});
          if(String(current.rows[0].tipo||'').toLowerCase()!=='carregamento')return sendJson(res,400,{ok:false,error:'Este registro não é um carregamento.'});
          const r=await pool.query(
            'UPDATE carregamentos_finais SET conferente_coleta_devolucao=$1,foto4=$2,foto4_mime=$3,foto4_bytes=$4 WHERE id=$5 RETURNING id::text AS id,conferente_coleta_devolucao,foto4_bytes',
            [conferente,photo.buffer,photo.mime,photo.buffer.length,carregamentoColetaDevMatch[1]]
          );
          return sendJson(res,200,{ok:true,...r.rows[0],capturada_em:captured.toISOString()});
        } catch(e) {
          return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível atualizar coleta e devolução.'});
        }
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/carregamentos-finais') {
        try {
          await sessionOrInternal(req);
          const body = await readJsonBodyLimited(req, 14 * 1024 * 1024);
          const tipo = String(body.tipo || 'carregamento').trim().toLowerCase();
          const conferente = String(body.conferente || '').trim();
          const motorista = String(body.motorista || '').trim();
          const conferenteColetaDevolucao = String(body.conferente_coleta_devolucao || '').trim();
          const quantidade = Number(body.quantidade_entregas);
          const captured = new Date(body.capturada_em || Date.now());

          if (!['carregamento','descarga'].includes(tipo)) return sendJson(res, 400, { ok: false, error: 'Tipo de operação inválido.' });
          if (!conferente) return sendJson(res, 400, { ok: false, error: 'Informe o nome do conferente.' });
          if (!motorista) return sendJson(res, 400, { ok: false, error: 'Informe o nome do motorista.' });
          if (!Number.isInteger(quantidade) || quantidade < 0 || quantidade > 1000) {
            return sendJson(res, 400, { ok: false, error: 'Quantidade de entregas inválida.' });
          }
          if (!Number.isFinite(captured.getTime())) {
            return sendJson(res, 400, { ok: false, error: 'Data/hora da foto inválida.' });
          }

          const photo = parseImageDataUrl(body.foto);
          const extras=[body.foto2,body.foto3,body.foto4].map(v=>v?parseImageDataUrl(v):null);
          const avarias=(Array.isArray(body.avarias)?body.avarias:[]).slice(0,10).filter(Boolean).map((v,i)=>({
            ordem:i+1,
            photo:parseImageDataUrl(v)
          }));
          const r = await pool.query(`
            INSERT INTO carregamentos_finais
              (tipo, conferente, motorista, quantidade_entregas, foto, foto_mime, foto_bytes,
               foto2, foto2_mime, foto2_bytes, foto3, foto3_mime, foto3_bytes, foto4, foto4_mime, foto4_bytes,
               conferente_coleta_devolucao, capturada_em)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            RETURNING id::text AS id, tipo, conferente, motorista, quantidade_entregas, capturada_em, criado_em,
              foto_bytes, foto2_bytes, foto3_bytes, foto4_bytes, conferente_coleta_devolucao
          `, [
            tipo, conferente, motorista, quantidade, photo.buffer, photo.mime, photo.buffer.length,
            extras[0]?.buffer||null,extras[0]?.mime||null,extras[0]?.buffer?.length||0,
            extras[1]?.buffer||null,extras[1]?.mime||null,extras[1]?.buffer?.length||0,
            extras[2]?.buffer||null,extras[2]?.mime||null,extras[2]?.buffer?.length||0,
            tipo==='carregamento'?(conferenteColetaDevolucao||null):null,
            captured.toISOString()
          ]);
          const registroId=r.rows[0].id;
          for(const av of avarias){
            await pool.query(
              'INSERT INTO carregamentos_avarias(carregamento_id,ordem,foto,foto_mime,foto_bytes,capturada_em) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(carregamento_id,ordem) DO UPDATE SET foto=EXCLUDED.foto,foto_mime=EXCLUDED.foto_mime,foto_bytes=EXCLUDED.foto_bytes,capturada_em=EXCLUDED.capturada_em',
              [registroId,av.ordem,av.photo.buffer,av.photo.mime,av.photo.buffer.length,captured.toISOString()]
            )
          }
          return sendJson(res, 201, { ok: true, ...r.rows[0], avaria_count:avarias.length });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Não foi possível salvar o final do carregamento.' });
        }
      }

      const duplicarMatch = u.pathname.match(/^\/api\/painel\/coletas-duplicar\/([^/]+)$/);
      if (req.method === 'POST' && duplicarMatch) {
        try {
          const user=await dashboardSession(req,false);
          if(!dashboardHas(user,'coletas'))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const id = decodeURIComponent(duplicarMatch[1]);
          const body = await readJsonBody(req);
          const nova = await duplicateColetaMinimal(id, body.data, user.client_id);
          return sendJson(res, 201, { ok: true, ...nova });
        } catch (e) {
          return sendJson(res, e.status || 500, { error: e.message || 'Não foi possível duplicar a coleta.' });
        }
      }

      const destinatarioMatch = u.pathname.match(/^\/api\/painel\/coletas-destinatario\/([^/]+)$/);
      if (req.method === 'PATCH' && destinatarioMatch) {
        const user=await dashboardSession(req,false);
        if(!dashboardHas(user,'coletas'))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
        const id = decodeURIComponent(destinatarioMatch[1]);
        const body = await readJsonBody(req);
        const destinatario = String(body.destinatario || '').trim();
        const result = user.client_id ? await pool.query(
          'UPDATE coletas SET destinatario=$1, updated_at=NOW() WHERE id::text=$2 AND client_id=$3 RETURNING id::text AS id, destinatario',
          [destinatario, id, user.client_id]
        ) : await pool.query(
          'UPDATE coletas SET destinatario=$1, updated_at=NOW() WHERE id::text=$2 RETURNING id::text AS id, destinatario',
          [destinatario, id]
        );
        if (!result.rowCount) return sendJson(res, 404, { error: 'Coleta não encontrada.' });
        return sendJson(res, 200, { ok: true, ...result.rows[0] });
      }

      const recebimentoMatch = u.pathname.match(/^\/api\/painel\/coletas-financeiro\/([^/]+)$/);
      if (req.method === 'PATCH' && recebimentoMatch) {
        const user=await dashboardSession(req,false);
        if(!(dashboardHas(user,'financeiro')||dashboardHas(user,'coletas')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
        const id = decodeURIComponent(recebimentoMatch[1]);
        const body = await readJsonBody(req);
        const recebido = body.recebido === true || body.recebido === 'true' || body.recebido === 1 || body.recebido === '1';
        let dataRecebimento = body.data_recebimento ? String(body.data_recebimento).slice(0,10) : null;
        if (recebido && !dataRecebimento) dataRecebimento = spToday();
        if (!recebido) dataRecebimento = null;

        const result = user.client_id ? await pool.query(
          'UPDATE coletas SET recebido=$1, data_recebimento=$2, updated_at=NOW() WHERE id::text=$3 AND client_id=$4 RETURNING id::text AS id, recebido, data_recebimento',
          [recebido, dataRecebimento, id, user.client_id]
        ) : await pool.query(
          'UPDATE coletas SET recebido=$1, data_recebimento=$2, updated_at=NOW() WHERE id::text=$3 RETURNING id::text AS id, recebido, data_recebimento',
          [recebido, dataRecebimento, id]
        );
        if (!result.rowCount) return sendJson(res, 404, { error: 'Coleta não encontrada.' });
        return sendJson(res, 200, { ok: true, ...result.rows[0] });
      }

      const previsaoMatch = u.pathname.match(/^\/api\/painel\/coletas-previsao\/([^/]+)$/);
      if (req.method === 'PATCH' && previsaoMatch) {
        const user=await dashboardSession(req,false);
        if(!(dashboardHas(user,'financeiro')||dashboardHas(user,'coletas')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
        const id = decodeURIComponent(previsaoMatch[1]);
        const body = await readJsonBody(req);
        const previsao = body.previsao_pagamento_fatura ? String(body.previsao_pagamento_fatura).slice(0,10) : null;
        if (previsao && !/^\d{4}-\d{2}-\d{2}$/.test(previsao)) {
          return sendJson(res, 400, { error: 'Data de previsão inválida.' });
        }
        const result = user.client_id ? await pool.query(
          'UPDATE coletas SET previsao_pagamento_fatura=$1, updated_at=NOW() WHERE id::text=$2 AND client_id=$3 RETURNING id::text AS id, previsao_pagamento_fatura',
          [previsao, id, user.client_id]
        ) : await pool.query(
          'UPDATE coletas SET previsao_pagamento_fatura=$1, updated_at=NOW() WHERE id::text=$2 RETURNING id::text AS id, previsao_pagamento_fatura',
          [previsao, id]
        );
        if (!result.rowCount) return sendJson(res, 404, { error: 'Coleta não encontrada.' });
        return sendJson(res, 200, { ok: true, ...result.rows[0] });
      }

      const deleteMatch = u.pathname.match(/^\/api\/painel\/coletas\/([^/]+)$/);
      if (req.method === 'DELETE' && deleteMatch) {
        const user=await dashboardSession(req,false);
        if(!dashboardHas(user,'coletas'))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
        const id = decodeURIComponent(deleteMatch[1]);
        const result = user.client_id ? await pool.query(
          'DELETE FROM coletas WHERE id::text=$1 AND client_id=$2 RETURNING id::text AS id',
          [id,user.client_id]
        ) : await pool.query(
          'DELETE FROM coletas WHERE id::text=$1 RETURNING id::text AS id',
          [id]
        );
        if (!result.rowCount) return sendJson(res, 404, { error: 'Coleta não encontrada.' });
        return sendJson(res, 200, { ok: true, id: result.rows[0].id });
      }

      if ((u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/painel/')) || u.pathname.startsWith('/coletas/api/')) {
        try {
          const user=await dashboardSession(req,false);
          const p=u.pathname;
          const allowed=p.startsWith('/api/bills')||p==='/api/export.csv'
            ? dashboardHas(user,'contas_pagar')
            : (dashboardHas(user,'coletas')||dashboardHas(user,'financeiro'));
          if(!allowed)return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
        } catch(e){
          return sendJson(res,e.status||401,{ok:false,error:e.message||'Sessão inválida.'});
        }
      }
      return handler(req, res);
    } catch (e) {
      if (e && Number(e.status) >= 400 && Number(e.status) < 500 && !res.headersSent) {
        return sendJson(res, Number(e.status), { ok: false, error: e.message || 'Requisição não autorizada.' });
      }
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro interno');
    }
  }).listen(PORT, '0.0.0.0', () => {
    console.log('Painel da Transportadora ativo na porta ' + PORT + ' com PostgreSQL Aiven');
  });
}

start().catch(err => {
  console.error('Falha ao iniciar Painel da Transportadora:', err);
  process.exit(1);
});
