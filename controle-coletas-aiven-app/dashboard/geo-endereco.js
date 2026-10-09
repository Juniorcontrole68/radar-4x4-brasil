// Localização de endereços do SSW no mapa: limpeza do texto, sede do município e conferência
// de que o ponto encontrado fica na cidade certa.
//
// Por que existe (caso real de 09/10/2026, romaneio AMR001060-0):
//  - o SSW traz o endereço com sujeira ("0007      AVENIDA SAUDADE,516", "ENTREGA RUA ... NUM 30
//    BAIRRO PR", "RUA CANANEIA,210-SN", "AVENIDA ROGERIO ZANAGA DE ,272") e o serviço de mapas
//    não achava nenhum; todas as entregas caíam no CEP ou no centro da cidade;
//  - a entrega de Pedreira (cidade) foi localizada no bairro Pedreira de São Paulo capital,
//    a 110 km, e a rota do dia mostrava 115 km a mais.
//
// As contas e a limpeza de texto não usam rede. As consultas aos serviços de mapa ficam em
// createLocator, que recebe o "fetch" de fora: o server.js passa o real, o teste passa respostas
// gravadas.
const fs=require('fs'),path=require('path');

function norm(v){return String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim()}

// ---------------------------------------------------------------- sede do município
let MUNICIPIOS=null;
function municipios(){
  if(MUNICIPIOS)return MUNICIPIOS;
  try{MUNICIPIOS=JSON.parse(fs.readFileSync(path.join(__dirname,'municipios-br.json'),'utf8')).ufs||{}}
  catch(e){console.log('GEO: tabela de municípios indisponível: '+String(e.message||e));MUNICIPIOS={}}
  return MUNICIPIOS
}
const UF_NOMES={'SAO PAULO':'SP','MINAS GERAIS':'MG','RIO DE JANEIRO':'RJ','PARANA':'PR','MATO GROSSO DO SUL':'MS','GOIAS':'GO','ESPIRITO SANTO':'ES','SANTA CATARINA':'SC','RIO GRANDE DO SUL':'RS','MATO GROSSO':'MT','BAHIA':'BA','DISTRITO FEDERAL':'DF'};
function ufSigla(v){const n=norm(v);if(/^[A-Z]{2}$/.test(n))return n;return UF_NOMES[n]||''}
// Coordenada da sede do município. Sem UF, só responde quando o nome existe em uma única UF
// entre as vizinhas da operação; nunca "adivinha" entre homônimos.
function cityCentroid(cidade,uf){
  const key=norm(cidade),all=municipios();if(!key)return null;
  const sigla=ufSigla(uf);
  if(sigla){const v=all[sigla]&&all[sigla][key];return v?{lat:v[0],lon:v[1],cidade:key,uf:sigla}:null}
  const hits=['SP','MG','RJ','PR','MS','GO'].filter(u=>all[u]&&all[u][key]);
  if(hits.length!==1)return null;
  const v=all[hits[0]][key];return{lat:v[0],lon:v[1],cidade:key,uf:hits[0]}
}
// "Pedreira, SP, Brasil" / "Mogi Guaçu, SP" -> sede do município, sem consultar serviço nenhum.
function cityQueryCentroid(query){
  const parts=String(query||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(parts.length&&norm(parts[parts.length-1])==='BRASIL')parts.pop();
  if(parts.length!==2)return null;
  if(!ufSigla(parts[1]))return null;
  return cityCentroid(parts[0],parts[1])
}

function haversineMeters(a,b){
  const R=6371e3,rad=x=>x*Math.PI/180,dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon);
  const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h))
}
// Um ponto só vale para uma entrega se ficar perto da sede do município do destinatário.
// 35 km cobre municípios grandes (zona rural, distritos) e recusa homônimos de outra cidade.
const CITY_RADIUS_METERS=35000;
function insideCity(point,cidade,uf,radius=CITY_RADIUS_METERS){
  const c=cityCentroid(cidade,uf);
  if(!c)return null;                        // cidade desconhecida: não dá para conferir
  if(!point||!Number.isFinite(Number(point.lat))||!Number.isFinite(Number(point.lon)))return false;
  return haversineMeters(c,{lat:Number(point.lat),lon:Number(point.lon)})<=radius
}

// ---------------------------------------------------------------- limpeza do endereço do SSW
const TIPOS=[[/^(AV|AVEN|AVDA)\.?\s+/,'AVENIDA '],[/^R\.?\s+/,'RUA '],[/^(ROD|RODOV)\.?\s+/,'RODOVIA '],[/^(EST|ESTR)\.?\s+/,'ESTRADA '],
  [/^(AL|ALAM)\.?\s+/,'ALAMEDA '],[/^(PCA|PC|PRACA)\.?\s+/,'PRACA '],[/^(TV|TRAV)\.?\s+/,'TRAVESSA '],[/^(LD|LAD)\.?\s+/,'LADEIRA '],[/^(VL)\.?\s+/,'VILA ']];
const TITULOS={DR:'DOUTOR',DRA:'DOUTORA',CEL:'CORONEL',PROF:'PROFESSOR',PROFA:'PROFESSORA',ENG:'ENGENHEIRO',STO:'SANTO',STA:'SANTA',PRES:'PRESIDENTE',
  MAL:'MARECHAL',GAL:'GENERAL',GEN:'GENERAL',CAP:'CAPITAO',VER:'VEREADOR',DEP:'DEPUTADO',GOV:'GOVERNADOR',SEN:'SENADOR',DES:'DESEMBARGADOR',
  CON:'CONEGO',PE:'PADRE',BRIG:'BRIGADEIRO',TEN:'TENENTE',SGT:'SARGENTO',COM:'COMENDADOR',MONS:'MONSENHOR',VISC:'VISCONDE'};
const SOLTAS=new Set(['DE','DA','DO','DOS','DAS','E','N','NR','NUM','NUMERO','S','SN']);
// Devolve {street, number, bairro}. "street" já vem sem código, sem "ENTREGA", sem número e
// com as abreviações comuns por extenso. Campos que não deu para extrair voltam vazios.
function cleanSswAddress(raw,numeroCampo=''){
  let s=String(raw||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
  // "0007      AVENIDA SAUDADE": código de sequência antes do logradouro
  s=s.replace(/^0\d{2,3}\s+(?=[A-Z])/,'').replace(/^\d{3,4}\s{2,}/,'');
  s=s.replace(/^(END(ERECO)?\.?\s*(DE\s+)?ENTREGA|LOCAL\s+DE\s+ENTREGA|ENTREGAR?(\s+EM|\s+NA|\s+NO)?)\s*[:\-]?\s+/,'');
  let bairro='';
  const mb=s.match(/[\s,]+(?:BAIRRO|B\.)\s+(.+)$/);
  if(mb){bairro=mb[1].replace(/[,;].*$/,'').trim();s=s.slice(0,mb.index).trim()}
  if(bairro.length<=3)bairro='';                // "BAIRRO PR": texto cortado pelo SSW
  let number=String(numeroCampo||'').match(/\d{1,6}/)?.[0]||'';
  let street=s;
  const comma=s.indexOf(',');
  if(/\bKM\s*\d/.test(s)){                      // "ROD SP 340 KM 172": o quilômetro faz parte do endereço
    street=(comma>=0?s.slice(0,comma):s);number=''
  }else if(comma>=0){
    street=s.slice(0,comma);
    if(!number)number=s.slice(comma+1).match(/\d{1,6}/)?.[0]||''   // ", 620,SN" / ",210-SN" / ",12-22"
  }
  const km=/\bKM\s*\d/.test(street);
  const mn=km?null:street.match(/\s+(?:NUMERO|NUM|NRO|NR|N[O.]?)\s*[:.]?\s*(\d{1,6})\b.*$/);   // "... NUM 30"
  if(mn){if(!number)number=mn[1];street=street.slice(0,mn.index)}
  else if(!km){const mt=street.match(/^(.*[A-Z])\s+(\d{1,6})$/);if(mt&&!number){number=mt[2];street=mt[1]}} // "RUA X 123"
  street=street.replace(/\bS\s*\/\s*N\b/g,' ').replace(/[^A-Z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
  let words=street.split(' ').filter(Boolean);
  while(words.length>2&&SOLTAS.has(words[words.length-1]))words.pop();     // "ZANAGA DE", "CASSIMIRO N"
  street=words.join(' ');
  for(const [re,full] of TIPOS){if(re.test(street+' ')){street=(street+' ').replace(re,full).trim();break}}
  words=street.split(' ');
  street=words.map((w,i)=>i>0&&TITULOS[w]?TITULOS[w]:w).join(' ');
  if(norm(number).replace(/^0+/,'')==='')number='';
  return{street,number:number.replace(/^0+(?=\d)/,''),bairro}
}

// ---------------------------------------------------------------- comparação de nomes de rua
const TIPO_PALAVRAS=new Set(['RUA','AVENIDA','ALAMEDA','TRAVESSA','ESTRADA','RODOVIA','PRACA','LADEIRA','VILA','VIA','LARGO','VIELA','PASSAGEM']);
function streetTokens(v){
  return norm(v).split(' ').filter(w=>w&&!TIPO_PALAVRAS.has(w)&&!SOLTAS.has(w)).map(w=>TITULOS[w]||w)
}
function editDistance(a,b){
  if(a===b)return 0;const m=a.length,n=b.length;if(!m)return n;if(!n)return m;
  let prev=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur}
  return prev[n]
}
function tokenMatch(a,b){
  if(a===b)return true;
  if(a.length>=5&&b.length>=5&&editDistance(a,b)<=(Math.max(a.length,b.length)>=8?2:1))return true;   // "ELTEVAO" ~ "ESTEVAO"
  if(a.length>=4&&b.length>a.length&&b.startsWith(a))return true;                                    // texto cortado pelo SSW
  return false
}
// 0 a 1: quanto do nome procurado aparece no nome encontrado. O SSW corta nomes longos, então
// conta o que foi pedido, não o que sobrou no mapa ("ROGERIO ZANAGA" bate com "Rogério Zanaga de
// Camargo Neves").
// Palavras que não identificam um lugar sozinhas: "SITIO" casava com qualquer "Sítio ..." do mapa.
const GENERICAS=new Set(['SITIO','FAZENDA','CHACARA','ZONA','RURAL','BAIRRO','CENTRO','LOTE','LOTEAMENTO','QUADRA','GLEBA','MUNICIPAL','VICINAL','KM','SN','CASA','GALPAO','AREA','DISTRITO','CONDOMINIO','RESIDENCIAL','JARDIM','VILA','PARQUE']);
function streetSimilarity(wanted,found){
  const a=streetTokens(wanted),b=streetTokens(found);
  if(!a.length||!b.length)return 0;
  // sem "RUA/AVENIDA…" na frente e só com palavra genérica: não há nome de rua para comparar
  if(!norm(wanted).split(' ').some(w=>TIPO_PALAVRAS.has(w))&&!a.some(w=>!GENERICAS.has(w)&&w.length>=3&&!/^\d+$/.test(w)))return 0;
  let hit=0;for(const w of a)if(b.some(x=>tokenMatch(w,x)))hit++;
  return hit/a.length
}

// ---------------------------------------------------------------- escolha do resultado
// candidates: [{lat,lon,street,name,housenumber,city,state,type}] de qualquer serviço.
// Aceita só o que fica na cidade do destinatário e cujo nome de rua bate com o procurado.
// Devolve o melhor, com precision 'endereco' (achou o número) ou 'rua' (só a via), ou null.
function pickAddressResult(candidates,wanted){
  const street=wanted.street||'',number=String(wanted.number||'');
  let best=null;
  for(const c of (Array.isArray(candidates)?candidates:[])){
    const lat=Number(c?.lat),lon=Number(c?.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||(lat===0&&lon===0))continue;
    const dentro=insideCity({lat,lon},wanted.cidade,wanted.uf);
    if(dentro===false)continue;
    if(dentro===null&&wanted.cidade&&c.city&&norm(c.city)!==norm(wanted.cidade))continue;
    const sim=Math.max(streetSimilarity(street,c.street||''),streetSimilarity(street,c.name||''));
    if(sim<0.6)continue;
    const exactNumber=!!number&&String(c.housenumber||'').replace(/\D.*$/,'')===number;
    const score=sim*10+(exactNumber?5:0)+(norm(c.city)===norm(wanted.cidade)?1:0);
    if(!best||score>best.score)best={lat,lon,score,precision:exactNumber?'endereco':'rua',
      displayName:[c.name&&c.name!==c.street?c.name:'',c.street||c.name||'',c.housenumber||'',c.district||'',c.city||'',c.state||''].filter(Boolean).join(', '),
      city:c.city||'',state:c.state||'',similarity:sim}
  }
  return best
}

// ---------------------------------------------------------------- consulta aos serviços de mapa
// createLocator recebe de fora o que fala com a rede (fetch, consulta de CEP, fila do Nominatim).
// Assim o server.js usa os serviços reais e o teste usa respostas gravadas.
function createLocator({fetch:doFetch,geocodeCep,nominatimSlot=fn=>fn(),log=()=>{},now=()=>Date.now()}={}){
  // Um serviço que falha 3 vezes seguidas fica 10 minutos sem ser consultado. Sem isso, cada
  // entrega esperava o tempo máximo do serviço fora do ar e a rota do dia levava minutos.
  const providers={photon:{fails:0,pausedUntil:0,ok:0,empty:0,err:0},nominatim:{fails:0,pausedUntil:0,ok:0,empty:0,err:0}};
  const providerAvailable=name=>now()>=providers[name].pausedUntil;
  function providerResult(name,kind,detail=''){
    const p=providers[name];p[kind]++;
    if(kind!=='err'){p.fails=0;return}
    p.fails++;
    if(p.fails>=3){p.fails=0;p.pausedUntil=now()+10*60*1000;log('GEO: '+name+' em pausa por 10 min (3 falhas seguidas'+(detail?': '+detail:'')+')')}
  }
  const box=(c,d=0.45)=>({w:c.lon-d,s:c.lat-d,e:c.lon+d,n:c.lat+d});
  const hasCenter=c=>!!c&&Number.isFinite(c.lat)&&Number.isFinite(c.lon);
  let photonActive=0;const photonWait=[];
  // Photon (dados do OpenStreetMap): busca tolerante a erro de digitação. No máximo 2 consultas
  // ao mesmo tempo, para não abusar de um serviço gratuito. null = o serviço falhou.
  async function photonSearch(q,center=null){
    if(!providerAvailable('photon'))return null;
    if(photonActive>=2)await new Promise(r=>photonWait.push(r));
    photonActive++;
    try{
      if(!providerAvailable('photon'))return null;
      const u=new URL('https://photon.komoot.io/api/');
      u.searchParams.set('q',q);u.searchParams.set('limit','6');
      if(hasCenter(center)){
        const b=box(center);
        u.searchParams.set('lat',String(center.lat));u.searchParams.set('lon',String(center.lon));
        u.searchParams.set('bbox',[b.w,b.s,b.e,b.n].map(v=>v.toFixed(4)).join(','))
      }
      const r=await doFetch(u,{headers:{'User-Agent':'CONSTRULOG-Roteirizador/1.1 (operacao interna)'},signal:AbortSignal.timeout(9000)});
      if(!r.ok){providerResult('photon','err','HTTP '+r.status);return null}
      const j=await r.json().catch(()=>null);
      if(!j||!Array.isArray(j.features)){providerResult('photon','err','resposta inválida');return null}
      const list=j.features.filter(f=>!f?.properties?.countrycode||String(f.properties.countrycode).toUpperCase()==='BR').map(f=>({
        lat:Number(f?.geometry?.coordinates?.[1]),lon:Number(f?.geometry?.coordinates?.[0]),
        name:String(f.properties.name||''),street:String(f.properties.street||''),housenumber:String(f.properties.housenumber||''),
        city:String(f.properties.city||f.properties.town||f.properties.village||''),district:String(f.properties.district||f.properties.locality||''),
        state:String(f.properties.state||''),type:String(f.properties.type||'')
      }));
      providerResult('photon',list.length?'ok':'empty');
      return list
    }catch(e){providerResult('photon','err',String(e?.name||e?.message||e));return null}
    finally{photonActive--;const next=photonWait.shift();if(next)setTimeout(next,150)}
  }
  // Nominatim como segunda opção, restrito à região da cidade. null = o serviço falhou.
  async function nominatimAddress(q,center=null){
    if(!providerAvailable('nominatim'))return null;
    return nominatimSlot(async()=>{
      if(!providerAvailable('nominatim'))return null;
      const u=new URL('https://nominatim.openstreetmap.org/search');
      u.searchParams.set('format','jsonv2');u.searchParams.set('limit','6');u.searchParams.set('addressdetails','1');u.searchParams.set('countrycodes','br');u.searchParams.set('q',q);
      if(hasCenter(center)){const b=box(center);u.searchParams.set('viewbox',[b.w,b.n,b.e,b.s].map(v=>v.toFixed(4)).join(','));u.searchParams.set('bounded','1')}
      try{
        const r=await doFetch(u,{headers:{'User-Agent':'CONSTRULOG-Roteirizador/1.1 (operacao interna)','Accept-Language':'pt-BR,pt;q=0.9'},signal:AbortSignal.timeout(9000)});
        if(!r.ok){providerResult('nominatim','err','HTTP '+r.status);return null}
        const j=await r.json().catch(()=>null);
        if(!Array.isArray(j)){providerResult('nominatim','err','resposta inválida');return null}
        const list=j.map(x=>({lat:Number(x.lat),lon:Number(x.lon),name:String(x.name||''),street:String(x.address?.road||x.address?.pedestrian||''),housenumber:String(x.address?.house_number||''),
          city:String(x.address?.city||x.address?.town||x.address?.municipality||x.address?.village||''),district:String(x.address?.suburb||x.address?.neighbourhood||''),state:String(x.address?.state||''),type:String(x.type||'')}));
        providerResult('nominatim',list.length?'ok':'empty');
        return list
      }catch(e){providerResult('nominatim','err',String(e?.name||e?.message||e));return null}
    })
  }
  const cache=new Map(),inflight=new Map();
  // Localiza o endereço de um destinatário. Ordem: rua e número no mapa (Photon, depois
  // Nominatim), CEP e, por fim, a sede do município. Tudo que não fica na cidade do destinatário
  // é recusado: foi assim que uma entrega de Pedreira (SP) apareceu em São Paulo capital.
  // Devolve {lat,lon,precision,coordinateSource,query,displayName} ou null.
  //   precision 'endereco' = achou a porta; 'rua' = achou a via, sem o número; 'cep'; 'cidade'.
  async function locateAddress({endereco='',numero='',cidade='',uf='SP',cep=''}={}){
    const clean=cleanSswAddress(endereco,numero);
    const sigla=ufSigla(uf)||'SP';
    const key=[clean.street,clean.number,norm(cidade),sigla,String(cep||'').replace(/\D/g,'')].join('|');
    const hit=cache.get(key);
    if(hit&&now()-hit.at<hit.ttl)return hit.value;
    if(inflight.has(key))return inflight.get(key);
    const job=(async()=>{
      const centroid=cityCentroid(cidade,sigla);
      const wanted={street:clean.street,number:clean.number,cidade,uf:sigla};
      let serviceFailed=false,value=null;
      if(clean.street.length>=4&&cidade){
        const q=clean.street+(clean.number?' '+clean.number:'')+', '+cidade;
        for(const name of ['Photon','Nominatim']){
          const list=name==='Photon'?await photonSearch(q,centroid):await nominatimAddress(q+', '+sigla+', Brasil',centroid);
          if(list===null){serviceFailed=true;continue}
          const pick=pickAddressResult(list,wanted);
          if(pick){
            value={lat:pick.lat,lon:pick.lon,precision:pick.precision,displayName:pick.displayName,query:q,
              coordinateSource:pick.precision==='endereco'?'Endereço do cliente':'Rua do cliente (sem o número no mapa)'};
            break
          }
        }
      }
      if(!value&&cep&&geocodeCep){
        const g=await Promise.resolve(geocodeCep(cep)).catch(()=>null);
        if(g&&Number.isFinite(Number(g.lat))&&Number.isFinite(Number(g.lon))){
          if(insideCity(g,cidade,sigla)===false)log('GEO: CEP '+cep+' recusado, fica fora de '+cidade+'/'+sigla+' ('+g.lat+','+g.lon+')');
          else value={lat:Number(g.lat),lon:Number(g.lon),precision:'cep',displayName:g.displayName||'',query:String(cep)+', Brasil',coordinateSource:'CEP BrasilAPI'}
        }
      }
      if(!value&&centroid)value={lat:centroid.lat,lon:centroid.lon,precision:'cidade',displayName:cidade+' - '+sigla,query:cidade+', '+sigla+', Brasil',coordinateSource:'cidade-aproximada'};
      // Resultado bom vale 24 h. Se algum serviço falhou no caminho, tenta de novo em 10 minutos.
      const exact=value&&(value.precision==='endereco'||value.precision==='rua');
      cache.set(key,{at:now(),ttl:(exact||!serviceFailed)?24*60*60*1000:10*60*1000,value});
      if(cache.size>5000)cache.delete(cache.keys().next().value);
      return value
    })().finally(()=>inflight.delete(key));
    inflight.set(key,job);
    return job
  }
  return{locateAddress,photonSearch,nominatimAddress,providers,providerAvailable,providerResult}
}

module.exports={norm,ufSigla,cityCentroid,cityQueryCentroid,haversineMeters,insideCity,CITY_RADIUS_METERS,cleanSswAddress,streetTokens,streetSimilarity,pickAddressResult,createLocator};
