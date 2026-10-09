// Montar carga: o operador bipa os CT-es que o motorista vai carregar, o sistema busca o
// endereço no SSW, coloca as entregas em ordem (sai da base e volta para a base), mostra os
// km, imprime a ordem de carregamento e envia a rota para o motorista.
(()=>{
const q=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const KEY='construlog_carga_v1';
const hoje=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const num=(v,d=0)=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
const km=m=>Number.isFinite(Number(m))&&Number(m)>0?num(Number(m)/1000,1)+' km':'—';
const tempo=s=>{s=Math.round(Number(s||0)/60);if(!s)return'—';const h=Math.floor(s/60),m=s%60;return h?h+' h '+String(m).padStart(2,'0')+' min':m+' min'};
const digitos=v=>String(v||'').replace(/\D/g,'');
const fone=v=>{const d=digitos(v);return d.length>=10?'('+d.slice(0,2)+') '+d.slice(2,d.length-4)+'-'+d.slice(-4):d};
// Mesmo CT-e bipado (44 dígitos) ou digitado (AMR15326-5): chave para não repetir na lista.
const codigoKey=c=>{const d=digitos(c);return d.length===44?'K'+d:'C'+String(c||'').toUpperCase().replace(/\s+/g,'').replace(/^([A-Z]{3})0+/,'$1')};
const ctrcKey=c=>String(c||'').toUpperCase().replace(/\s+/g,'').replace(/^([A-Z]{3})0+/,'$1');

// items: {id, code, status:'pending'|'ok'|'erro', stop, error}
// route: null ou {order:[id...], points:[base,...], idx:{id:índice em points}, matrix, seconds, method, geometry}
let S={date:hoje(),driver:'',plate:'',items:[],route:null,stale:false,sent:null};
let seq=0,fila=[],rodando=false,map=null,layer=null,pronto=false,audio=null;

function salvar(){
  try{
    const route=S.route?{...S.route,geometry:null}:null;   // o desenho da rota é grande: refaz ao abrir
    localStorage.setItem(KEY,JSON.stringify({...S,route,items:S.items.filter(x=>x.status==='ok'),sent:null}))
  }catch{}
}
function carregar(){
  try{
    const j=JSON.parse(localStorage.getItem(KEY)||'null');
    if(!j||!Array.isArray(j.items))return;
    S={date:hoje(),driver:String(j.driver||''),plate:String(j.plate||''),items:j.items.filter(x=>x&&x.stop&&x.id),route:j.route&&Array.isArray(j.route.order)?j.route:null,stale:!!j.stale,sent:null};
    seq=S.items.reduce((a,x)=>Math.max(a,Number(String(x.id).replace(/\D/g,''))||0),0);
    // carga montada em outro dia continua na tela, mas a rota precisa ser refeita antes de enviar
    if(j.date&&j.date!==S.date&&S.route)S.stale=true
  }catch{}
}

// ---------------------------------------------------------------- sons do leitor
function bip(tipo){
  try{
    audio=audio||new (window.AudioContext||window.webkitAudioContext)();
    const toca=(freq,ini,dur)=>{const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=freq;o.type='sine';g.gain.value=.12;o.connect(g);g.connect(audio.destination);o.start(audio.currentTime+ini);o.stop(audio.currentTime+ini+dur)};
    if(tipo==='ok')toca(880,0,.09);
    else if(tipo==='rep'){toca(660,0,.07);toca(660,.12,.07)}
    else toca(220,0,.35)
  }catch{}
}
function msg(texto,tipo=''){const el=q('#cgMsg');if(!el)return;el.textContent=texto;el.className='cg-msg'+(tipo?' '+tipo:'')}
function piscar(id){
  const el=q('[data-cg-row="'+id+'"]');if(!el)return;
  el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');
  el.scrollIntoView({block:'nearest'})
}

// ---------------------------------------------------------------- bipagem
function bipar(codigo){
  const raw=String(codigo||'').trim();
  if(!raw)return;
  const key=codigoKey(raw);
  const igual=S.items.find(x=>x.key===key||(x.status==='ok'&&(('K'+x.stop.barcode)===key||('C'+ctrcKey(x.stop.ctrc))===key)));
  if(igual){
    bip('rep');
    msg(igual.status==='ok'?'CT-e '+igual.stop.ctrc+' já está na lista.':'Este código já foi bipado e está sendo consultado.','warn');
    piscar(igual.id);return
  }
  const item={id:'c'+(++seq),code:raw,key,status:'pending',stop:null,error:''};
  S.items.push(item);fila.push(item);
  render();processar()
}
async function processar(){
  if(rodando)return;rodando=true;
  while(fila.length){
    const item=fila.shift();
    if(!S.items.includes(item))continue;          // retirado enquanto esperava
    try{
      const r=await fetch('/api/roteirizador/bipar?codigo='+encodeURIComponent(item.code),{cache:'no-store'});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok)throw new Error(j.error||('Não consegui consultar (erro '+r.status+').'));
      if(!S.items.includes(item))continue;
      const dup=S.items.find(x=>x!==item&&x.status==='ok'&&ctrcKey(x.stop.ctrc)===ctrcKey(j.stop.ctrc));
      if(dup){
        S.items=S.items.filter(x=>x!==item);bip('rep');msg('CT-e '+j.stop.ctrc+' já está na lista.','warn');render();piscar(dup.id);continue
      }
      item.status='ok';item.stop=j.stop;
      if(S.route)S.stale=true;                    // entrou CT-e depois de roteirizar: a ordem precisa ser refeita
      bip('ok');
      msg('✓ '+j.stop.ctrc+' • '+j.stop.destinatario+' • '+(j.stop.cidade||'')+(aprox(j.stop)?' • endereço aproximado, confira':''),aprox(j.stop)?'warn':'ok');
      salvar()
    }catch(e){
      if(!S.items.includes(item))continue;
      item.status='erro';item.error=String(e.message||e);
      bip('erro');msg('✗ '+item.error,'bad')
    }
    render();piscar(item.id)
  }
  rodando=false
}
const aprox=s=>['cidade','cliente','cep','cte-aproximado'].includes(String(s?.precision||''));
function selo(s){
  const p=String(s?.precision||'');
  const t=p==='endereco'?'endereço':p==='rua'?'rua (sem o número)':p==='cep'?'CEP':p==='ssw-cliente'?'ponto do cliente (SSW)':p==='cliente'?'aproximado: ver endereço':'só a cidade';
  return'<span class="precision-badge '+(aprox(s)?'approx':'')+'" title="'+esc(s.coordinateSource||'')+'">'+t+'</span>'
}

// ---------------------------------------------------------------- rota
const validos=()=>S.items.filter(x=>x.status==='ok');
function ordemAtual(){
  const ok=validos();
  if(!S.route)return ok.slice().reverse();        // antes de roteirizar: o último bipado fica em cima
  const by=new Map(ok.map(x=>[x.id,x]));
  const emOrdem=S.route.order.map(id=>by.get(id)).filter(Boolean);
  const fora=ok.filter(x=>!S.route.order.includes(x.id));   // bipados depois da roteirização
  return[...emOrdem,...fora]
}
function trechos(){
  // metros de cada parada (a partir da anterior) e da volta à base, pela ordem atual
  const r=S.route,out={total:0,por:{},volta:0};
  if(!r||!r.matrix)return out;
  const ids=r.order.filter(id=>r.idx[id]!==undefined&&validos().some(x=>x.id===id));
  let ant=0;
  for(const id of ids){const i=r.idx[id],d=Number(r.matrix[ant]?.[i]||0);out.por[id]=d;out.total+=d;ant=i}
  if(ids.length){out.volta=Number(r.matrix[ant]?.[0]||0);out.total+=out.volta}
  return out
}
async function roteirizar(){
  const ok=validos();
  if(!ok.length){msg('Bipe pelo menos um CT-e antes de roteirizar.','warn');return}
  if(fila.length||rodando){msg('Espere terminar a consulta dos CT-es bipados.','warn');return}
  const btn=q('#cgRoute');btn.disabled=true;btn.textContent='Roteirizando…';
  try{
    const r=await fetch('/api/roteirizador/recalcular',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({date:S.date,romaneio:'',motorista:S.driver,veiculo:S.plate,stops:ok.map(x=>({...x.stop,cargaId:x.id}))})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível roteirizar.');
    const idx={};(j.points||[]).forEach((p,i)=>{if(i&&p.cargaId)idx[p.cargaId]=i});
    const order=(j.optimizedOrder||[]).map(i=>j.points[i]?.cargaId).filter(Boolean);
    S.route={date:hoje(),order,idx,points:j.points,matrix:j.matrix,seconds:Number(j.durationSeconds||0),method:j.method||'',geometry:j.geometry||null};
    S.stale=false;S.sent=null;
    const fora=ok.filter(x=>idx[x.id]===undefined);
    msg(fora.length?'Rota pronta, mas '+fora.length+' CT-e(s) ficaram de fora por não terem sido localizados no mapa.':'Rota pronta: '+order.length+' entrega(s), '+km(trechos().total)+' saindo e voltando para a base.',fora.length?'warn':'ok');
    salvar()
  }catch(e){msg('✗ '+String(e.message||e),'bad')}
  btn.textContent='Roteirizar';
  render()
}
// Depois de mexer na ordem (inverter, subir/descer, retirar): refaz o desenho e o tempo da rota.
let desenhoSeq=0;
async function redesenhar(){
  const r=S.route;if(!r)return;
  const ids=r.order.filter(id=>validos().some(x=>x.id===id)&&r.idx[id]!==undefined);
  r.order=ids;r.geometry=null;salvar();render();
  if(!ids.length)return;
  const meu=++desenhoSeq;
  try{
    // só as paradas que continuam na carga, na ordem atual
    const points=[r.points[0],...ids.map(id=>r.points[r.idx[id]])].map(p=>({lat:p.lat,lon:p.lon}));
    const rr=await fetch('/api/roteirizador/geometria-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points,order:ids.map((_,i)=>i+1)})});
    const j=await rr.json().catch(()=>({}));
    if(meu!==desenhoSeq||!rr.ok||!j.ok)return;
    r.geometry=j.geometry||null;r.seconds=Number(j.durationSeconds||r.seconds||0);
    render()
  }catch{}
}
function inverter(){
  if(!S.route||S.stale)return;
  S.route.order.reverse();S.sent=null;
  msg('Rota invertida: agora começa pela entrega que era a última.','ok');
  redesenhar()
}
function mover(id,dir){
  if(!S.route||S.stale)return;
  const o=S.route.order,i=o.indexOf(id),n=i+dir;
  if(i<0||n<0||n>=o.length)return;
  [o[i],o[n]]=[o[n],o[i]];S.sent=null;
  redesenhar()
}
function retirar(id){
  const item=S.items.find(x=>x.id===id);if(!item)return;
  S.items=S.items.filter(x=>x!==item);
  S.sent=null;
  msg(item.status==='ok'?'CT-e '+item.stop.ctrc+' retirado da carga.':'Código retirado da lista.');
  if(!validos().length){S.route=null;S.stale=false}
  if(S.route){
    S.route.order=S.route.order.filter(i=>i!==id);
    // saiu justamente o CT-e que tinha entrado depois da roteirização: a rota volta a valer
    if(S.stale&&S.route.date===hoje()&&!validos().some(x=>S.route.idx[x.id]===undefined))S.stale=false;
    // retirar não exige roteirizar de novo: a ordem das que ficaram continua valendo
    if(!S.stale){redesenhar();return}
  }
  salvar();render()
}
function tentar(id){
  const item=S.items.find(x=>x.id===id);if(!item||item.status!=='erro')return;
  item.status='pending';item.error='';fila.push(item);render();processar()
}
function limpar(){
  if(S.items.length&&!confirm('Limpar a carga inteira? Os CT-es bipados saem da lista.'))return;
  S={date:hoje(),driver:'',plate:'',items:[],route:null,stale:false,sent:null};fila=[];
  q('#cgDriver').value='';q('#cgPlate').value='';
  msg('Carga limpa. Pode bipar a próxima.');salvar();render();q('#cgCode').focus()
}

// ---------------------------------------------------------------- imprimir e enviar
function imprimir(){
  if(!S.route||S.stale)return;
  const t=trechos(),lista=ordemAtual().filter(x=>S.route.order.includes(x.id)),n=lista.length;
  const tot=lista.reduce((a,x)=>({v:a.v+Number(x.stop.volumes||0),p:a.p+Number(x.stop.peso||0)}),{v:0,p:0});
  // No caminhão a última entrega entra primeiro: a folha vem na ordem de carregar.
  const linhas=lista.slice().reverse().map((x,i)=>{
    const s=x.stop,entrega=n-i;
    return'<tr><td class="c big">'+(i+1)+'º</td><td class="c">'+entrega+'ª</td><td><b>'+esc(s.ctrc)+'</b><br><span>NF '+esc(s.nf||'—')+'</span></td><td><b>'+esc(s.destinatario)+'</b><br><span>'+esc([[s.endereco,s.numero].filter(Boolean).join(', '),s.bairro].filter(Boolean).join(' • '))+(s.complemento?' • Compl.: '+esc(s.complemento):'')+(s.telefone?' • Tel.: '+esc(fone(s.telefone)):'')+'</span></td><td>'+esc((s.cidade||'')+(s.uf?'/'+s.uf:''))+'</td><td class="r">'+(s.volumes?num(s.volumes):'—')+'</td><td class="r">'+(s.peso?num(s.peso,1):'—')+'</td><td class="c"><i></i></td></tr>'
  }).join('');
  const agora=new Date().toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Carga '+esc(S.driver||'')+' '+esc(S.date.split('-').reverse().join('/'))+'</title><style>'+
    'body{font-family:system-ui,Arial,sans-serif;color:#111;margin:18px;font-size:12px}h1{font-size:18px;margin:0 0 4px}.sub{color:#444;margin-bottom:10px}'+
    '.box{display:flex;gap:18px;flex-wrap:wrap;border:1px solid #999;border-radius:6px;padding:8px 12px;margin-bottom:12px}.box div b{display:block;font-size:15px}'+
    'table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:5px 6px;vertical-align:top;text-align:left}th{background:#eee;font-size:10px;text-transform:uppercase}'+
    'td.c{text-align:center}td.r{text-align:right}td.big{font-size:16px;font-weight:800}td span{color:#444;font-size:11px}td i{display:inline-block;width:16px;height:16px;border:1.5px solid #333;border-radius:3px}'+
    '.nota{margin-top:10px;color:#444}@media print{body{margin:8mm}.no-print{display:none}}'+
    '</style></head><body><h1>Ordem de carregamento</h1><div class="sub">A última entrega entra primeiro no caminhão. A coluna “Entrega” mostra a ordem em que o motorista vai entregar.</div>'+
    '<div class="box"><div>Motorista<b>'+esc(S.driver||'—')+'</b></div><div>Placa<b>'+esc(S.plate||'—')+'</b></div><div>Entregas<b>'+n+'</b></div><div>Volumes<b>'+(tot.v?num(tot.v):'—')+'</b></div><div>Peso<b>'+(tot.p?num(tot.p,1)+' kg':'—')+'</b></div><div>Rota (base → entregas → base)<b>'+km(t.total)+'</b></div><div>Impresso em<b>'+esc(agora)+'</b></div></div>'+
    '<table><thead><tr><th>Carregar</th><th>Entrega</th><th>CT-e / NF</th><th>Destinatário e endereço</th><th>Cidade</th><th>Vol.</th><th>Peso (kg)</th><th>OK</th></tr></thead><tbody>'+linhas+'</tbody></table>'+
    '<div class="nota">Conferente: ____________________________ &nbsp;&nbsp; Motorista: ____________________________</div>'+
    '<script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script></body></html>';
  const w=window.open('','_blank');
  if(!w){msg('O navegador bloqueou a janela de impressão. Libere pop-ups para este site e tente de novo.','bad');return}
  w.document.open();w.document.write(html);w.document.close()
}
async function enviar(){
  if(!S.route||S.stale)return;
  if(S.driver.trim().length<2){msg('Informe o motorista antes de enviar.','warn');q('#cgDriver').focus();return}
  const r=S.route,ids=r.order.filter(id=>validos().some(x=>x.id===id)&&r.idx[id]!==undefined);
  if(!ids.length)return;
  const btn=q('#cgSend');btn.disabled=true;btn.textContent='Enviando…';
  try{
    const by=new Map(validos().map(x=>[x.id,x.stop]));
    const points=[r.points[0],...ids.map(id=>({...by.get(id),lat:r.points[r.idx[id]].lat,lon:r.points[r.idx[id]].lon}))];
    const plan={points,optimizedOrder:ids.map((_,i)=>i+1),geometry:r.geometry,optimizedDistanceMeters:trechos().total,durationSeconds:r.seconds,baseAddress:r.points[0]?.label||''};
    const rr=await fetch('/api/roteirizador/enviar-carga',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:S.date,driver_name:S.driver.trim(),vehicle_plate:S.plate.trim(),plan})});
    const j=await rr.json().catch(()=>({}));
    if(!rr.ok||!j.ok)throw new Error(j.error||'Não foi possível enviar.');
    S.sent=j;msg('Rota enviada para '+S.driver.trim()+'.','ok')
  }catch(e){msg('✗ '+String(e.message||e),'bad')}
  btn.textContent='Enviar para o motorista';
  render();
  if(S.sent)q('#cgSendBox')?.scrollIntoView({behavior:'smooth',block:'nearest'})
}

// ---------------------------------------------------------------- tela
function renderMapa(){
  const box=q('#cgMap'),card=q('#cgMapCard');if(!box||!card)return;
  const r=S.route;
  card.hidden=!r;
  if(!r)return;
  if(typeof L==='undefined'){box.innerHTML='<div class="cg-nomap">Mapa indisponível agora. A ordem e os km acima continuam valendo.</div>';return}
  if(!map){map=L.map(box,{zoomControl:true});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map)}
  if(layer)layer.remove();
  layer=L.layerGroup().addTo(map);
  const base=r.points[0],pts=[[base.lat,base.lon]];
  L.marker([base.lat,base.lon]).addTo(layer).bindTooltip('Base');
  r.order.forEach((id,pos)=>{
    const p=r.points[r.idx[id]];if(!p)return;
    const icon=L.divIcon({className:'',html:'<div style="background:#0f766e;color:#fff;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:800;border:2px solid #fff;box-shadow:0 1px 5px #0005">'+(pos+1)+'</div>',iconSize:[28,28],iconAnchor:[14,14]});
    L.marker([p.lat,p.lon],{icon}).addTo(layer).bindPopup('<b>'+esc(p.destinatario||p.label||'')+'</b><br>'+esc([p.endereco,p.numero].filter(Boolean).join(', '))+'<br>'+esc((p.cidade||'')+(p.uf?' / '+p.uf:'')));
    pts.push([p.lat,p.lon])
  });
  const coords=(r.geometry?.coordinates||[]).map(x=>[x[1],x[0]]);
  if(coords.length)L.polyline(coords,{weight:5,opacity:.8,color:'#0f766e'}).addTo(layer);
  const b=L.latLngBounds(pts);if(b.isValid())map.fitBounds(b.pad(.12));
  setTimeout(()=>map.invalidateSize(),80)
}
function render(){
  if(!pronto)return;
  const ok=validos(),t=trechos(),roteada=!!S.route&&!S.stale,pend=S.items.filter(x=>x.status==='pending').length;
  const tot=ok.reduce((a,x)=>({v:a.v+Number(x.stop.volumes||0),p:a.p+Number(x.stop.peso||0)}),{v:0,p:0});
  q('#cgKpiCtes').textContent=num(ok.length);
  q('#cgKpiVol').textContent=tot.v?num(tot.v):'—';
  q('#cgKpiPeso').textContent=tot.p?num(tot.p,1)+' kg':'—';
  q('#cgKpiKm').textContent=roteada?km(t.total):'—';
  q('#cgKpiTempo').textContent=roteada?tempo(S.route.seconds):'—';
  q('#cgKpiKmSub').textContent=roteada?'base → entregas → base':(S.stale?'roteirize de novo':'aparece ao roteirizar');
  q('#cgKpiTempoSub').textContent=roteada?'só de estrada, sem as paradas':'';
  document.querySelectorAll('#carga .kpi.route').forEach(el=>el.classList.toggle('off',!roteada));
  q('#cgRoute').disabled=!ok.length||pend>0;
  q('#cgRoute').textContent=S.route?'Roteirizar de novo':'Roteirizar';
  q('#cgRoute').classList.toggle('primary',!roteada);
  for(const id of ['#cgReverse','#cgPrint','#cgSend'])q(id).disabled=!roteada;
  q('#cgSend').classList.toggle('primary',roteada);
  q('#cgClear').disabled=!S.items.length;
  const st=q('#cgStale');st.hidden=!S.stale;
  if(S.stale)st.textContent='A lista mudou depois da roteirização. Clique em “Roteirizar de novo” para colocar tudo em ordem antes de imprimir ou enviar.';

  const lista=q('#cgList'),head=q('#cgColHead');
  const erros=S.items.filter(x=>x.status!=='ok');
  head.style.display=S.items.length?'':'none';
  if(!S.items.length){lista.innerHTML='<div class="cg-empty">Nenhum CT-e bipado ainda. Tudo o que for bipado aparece aqui.</div>'}
  else{
    const linhas=[];
    // o que ainda está sendo consultado ou deu erro fica em cima, à vista
    for(const x of erros.slice().reverse()){
      linhas.push(x.status==='pending'
        ?'<div class="cg-row pending" data-cg-row="'+x.id+'"><div class="seq">…</div><div><div class="who">Consultando no SSW…</div><div class="meta">'+esc(x.code)+'</div></div><div></div><div></div><div></div><div class="acts"><button type="button" class="rm" data-cg-rm="'+x.id+'" title="Retirar" aria-label="Retirar">✕</button></div></div>'
        :'<div class="cg-row erro" data-cg-row="'+x.id+'"><div class="seq">!</div><div><div class="who">'+esc(x.error)+'</div><div class="meta">Código lido: '+esc(x.code)+'</div></div><div></div><div></div><div></div><div class="acts"><button type="button" data-cg-retry="'+x.id+'" title="Tentar de novo" aria-label="Tentar de novo">↻</button><button type="button" class="rm" data-cg-rm="'+x.id+'" title="Retirar" aria-label="Retirar">✕</button></div></div>')
    }
    const ordem=ordemAtual(),nRota=S.route?S.route.order.length:0;
    ordem.forEach((x,i)=>{
      const s=x.stop,pos=S.route?S.route.order.indexOf(x.id):-1,naRota=pos>=0;
      const numero=naRota?pos+1:(S.route?'+':ok.length-i);
      const end=[[s.endereco,s.numero].filter(Boolean).join(', '),s.bairro,(s.cidade||'')+(s.uf?'/'+s.uf:'')].filter(Boolean).join(' • ');
      const extra=[s.complemento?'Compl.: '+esc(s.complemento):'',s.telefone?'Tel.: '+esc(fone(s.telefone)):'',s.situacao?esc(s.situacao):''].filter(Boolean).join(' • ');
      linhas.push('<div class="cg-row'+(naRota&&!S.stale?'':' unrouted')+'" data-cg-row="'+x.id+'"><div class="seq">'+numero+'</div>'+
        '<div><div class="who">'+esc(s.destinatario)+'</div><div class="meta"><b>'+esc(s.ctrc)+'</b> • NF '+esc(s.nf||'—')+' • '+esc(end)+' '+selo(s)+'</div>'+(extra?'<div class="meta">'+extra+'</div>':'')+'</div>'+
        '<div class="num"><small>Vol.</small>'+(s.volumes?num(s.volumes):'—')+'</div><div class="num"><small>Peso</small>'+(s.peso?num(s.peso,1)+' kg':'—')+'</div>'+
        '<div class="num"><small>Trecho</small>'+(roteada&&naRota?km(t.por[x.id]):'—')+'</div>'+
        '<div class="acts">'+(S.route?'<button type="button" data-cg-up="'+x.id+'" '+(!roteada||pos<=0?'disabled':'')+' title="Entregar antes" aria-label="Entregar antes">↑</button><button type="button" data-cg-down="'+x.id+'" '+(!roteada||!naRota||pos>=nRota-1?'disabled':'')+' title="Entregar depois" aria-label="Entregar depois">↓</button>':'')+
        '<button type="button" class="rm" data-cg-rm="'+x.id+'" title="Retirar da carga" aria-label="Retirar '+esc(s.ctrc)+' da carga">✕</button></div></div>')
    });
    if(roteada&&nRota)linhas.push('<div class="cg-base"><span>↩ Volta para a base (Av. do Algodão, 316 – Americana)</span><span>'+km(t.volta)+'</span></div>');
    lista.innerHTML=linhas.join('')
  }
  q('#cgListTitle').textContent=S.route&&!S.stale?'Ordem de entrega':'CT-es bipados';
  q('#cgListSub').textContent=S.route&&!S.stale?'Saindo da base e voltando para a base. Use ↑ ↓ para ajustar ou ✕ para retirar.':'O último bipado aparece em cima. Use ✕ para retirar.';

  const sb=q('#cgSendBox');
  if(S.sent){
    const j=S.sent,texto='Rota da carga '+(j.title||'')+': '+j.open_url;
    const fone=String(j.phone||'').replace(/\D/g,''),wa='https://wa.me/'+(fone?(fone.startsWith('55')?fone:'55'+fone):'')+'?text='+encodeURIComponent(texto);
    sb.hidden=false;
    sb.innerHTML='<b>Rota enviada</b><div class="muted" style="margin-top:4px">'+esc(j.title||'')+'</div>'+
      '<div class="meta" style="margin-top:8px;font-size:13px">'+(j.para_motorista?'Ficou gravada como a rota de hoje de <b>'+esc(j.driver_name)+'</b> no aplicativo MOVIT. Para abrir agora no celular dele, mande o link:':'Mande o link para o celular do motorista:')+'</div>'+
      '<input type="text" readonly value="'+esc(j.open_url)+'" data-cg-link aria-label="Link da rota">'+
      '<div class="cg-actions"><a class="cg-btn wa" target="_blank" rel="noopener" href="'+esc(wa)+'">💬 '+(fone?'Enviar no WhatsApp do motorista':'Enviar por WhatsApp')+'</a><button type="button" class="cg-btn" data-cg-copy>Copiar link</button><a class="cg-btn" target="_blank" rel="noopener" href="'+esc(j.open_url)+'">Abrir</a></div>'
  }else{sb.hidden=true;sb.innerHTML=''}
  renderMapa()
}

async function motoristas(){
  try{
    const r=await fetch('/api/roteirizador/motoristas',{cache:'no-store'}),j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)return;
    const rows=j.rows||[];
    q('#cgDriverList').innerHTML=rows.map(x=>'<option value="'+esc(x.driver_name)+'">'+esc(x.vehicle_plate||'')+'</option>').join('');
    q('#cgDriver').onchange=()=>{
      S.driver=q('#cgDriver').value.trim();
      const hit=rows.find(x=>x.driver_name.toLowerCase()===S.driver.toLowerCase());
      if(hit&&hit.vehicle_plate&&!q('#cgPlate').value.trim()){q('#cgPlate').value=hit.vehicle_plate;S.plate=hit.vehicle_plate}
      S.sent=null;salvar();render()
    }
  }catch{}
}
function setup(){
  if(pronto||!q('#carga'))return;
  pronto=true;carregar();
  const code=q('#cgCode'),drv=q('#cgDriver'),plt=q('#cgPlate');
  drv.value=S.driver;plt.value=S.plate;
  drv.oninput=()=>{S.driver=drv.value.trim();S.sent=null;salvar()};
  drv.onchange=()=>{S.driver=drv.value.trim();S.sent=null;salvar();render()};
  plt.oninput=()=>{plt.value=plt.value.toUpperCase().replace(/[^A-Z0-9]/g,'');S.plate=plt.value;S.sent=null;salvar()};
  const envia=()=>{const v=code.value;code.value='';bipar(v);code.focus()};
  let timer=null;
  // O leitor digita como teclado e termina com Enter. Se o leitor não mandar Enter, os 44
  // dígitos da chave bastam para saber que a leitura acabou.
  code.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(timer);envia()}};
  code.oninput=()=>{clearTimeout(timer);if(digitos(code.value).length===44)timer=setTimeout(envia,180)};
  q('#cgAdd').onclick=envia;
  q('#cgRoute').onclick=roteirizar;q('#cgReverse').onclick=inverter;q('#cgPrint').onclick=imprimir;q('#cgSend').onclick=enviar;q('#cgClear').onclick=limpar;
  q('#cgList').onclick=e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.cgRm)retirar(b.dataset.cgRm);
    else if(b.dataset.cgRetry)tentar(b.dataset.cgRetry);
    else if(b.dataset.cgUp)mover(b.dataset.cgUp,-1);
    else if(b.dataset.cgDown)mover(b.dataset.cgDown,1)
  };
  q('#cgSendBox').onclick=async e=>{
    const b=e.target.closest('[data-cg-copy]');if(!b)return;
    const input=q('[data-cg-link]');
    try{await navigator.clipboard.writeText(input.value);b.textContent='Copiado'}catch{input.focus();input.select();b.textContent='Selecionado: copie com Ctrl+C'}
  };
  render();motoristas();
  if(S.route&&!S.route.geometry&&!S.stale)redesenhar()
}
// Chamado pelo painel quando a aba "Montar carga" é aberta.
window.cargaAbrir=()=>{
  setup();
  if(S.date!==hoje()){S.date=hoje();if(S.route)S.stale=true;render()}
  setTimeout(()=>{q('#cgCode')?.focus();if(map)map.invalidateSize()},60)
};
})();
