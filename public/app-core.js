const DB_NAME="diario-bordo-v2", DB_VERSION=1;
let db, activeTrip=null, selectedTripId=null, gpsWatchId=null, gpsPoints=[], placeLocation=null, installPrompt=null;
let routeMap=null, routeLayer=null, markerLayer=null, serverReady=false, pinRequired=false;

const $=id=>document.getElementById(id);
const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0));
const num=(v,d=2)=>new Intl.NumberFormat("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v||0));
const today=()=>new Date().toISOString().slice(0,10), nowTime=()=>new Date().toTimeString().slice(0,5);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const pin=()=>sessionStorage.getItem("diario_pin")||"";

function toast(msg){const e=$("toast");e.textContent=msg;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2800)}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

function openDB(){return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB_NAME,DB_VERSION);
  r.onupgradeneeded=()=>{
    const d=r.result;
    ["trips","places","expenses","gps","deletes"].forEach(name=>{if(!d.objectStoreNames.contains(name))d.createObjectStore(name,{keyPath:"id"})});
  };
  r.onsuccess=()=>{db=r.result;resolve()};r.onerror=()=>reject(r.error);
})}
const store=(n,m="readonly")=>db.transaction(n,m).objectStore(n);
const put=(n,o)=>new Promise((res,rej)=>{const r=store(n,"readwrite").put(o);r.onsuccess=()=>res(o);r.onerror=()=>rej(r.error)});
const del=(n,id)=>new Promise((res,rej)=>{const r=store(n,"readwrite").delete(id);r.onsuccess=res;r.onerror=()=>rej(r.error)});
const all=n=>new Promise((res,rej)=>{const r=store(n).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});

function haversine(a,b){const R=6371,rad=x=>x*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);const z=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(z),Math.sqrt(1-z))}
function calcDistance(points){let t=0;const p=[...points].sort((a,b)=>a.ts-b.ts);for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];if((a.accuracy||999)<=100&&(b.accuracy||999)<=100){const d=haversine(a,b);if(d<2)t+=d}}return t}

async function health(){
  try{
    const r=await fetch("/api/health",{cache:"no-store"});const j=await r.json();
    serverReady=!!j.database;pinRequired=!!j.pinRequired;
    if(pinRequired && !pin()) $("loginOverlay").classList.remove("hidden");
    setSyncBadge(serverReady?"online":"offline");
  }catch{serverReady=false;setSyncBadge("offline")}
}
function setSyncBadge(state){
  const b=$("syncBadge");b.className=`sync-badge ${state}`;
  b.textContent=state==="online"?"Online":state==="syncing"?"Sincronizando...":"Offline";
}
async function api(url,opts={}){
  const headers={"Content-Type":"application/json",...(opts.headers||{})};
  if(pin())headers["x-app-pin"]=pin();
  const r=await fetch(url,{...opts,headers});
  if(r.status===401){$("loginOverlay").classList.remove("hidden");throw new Error("PIN inválido")}
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||"Falha na sincronização");
  return j;
}

async function snapshot(){
  return {trips:await all("trips"),places:await all("places"),expenses:await all("expenses"),gps:await all("gps"),deletes:await all("deletes")};
}
async function mergeRemote(remote){
  for(const entity of ["trips","places","expenses","gps"]){
    const local=await all(entity), map=new Map(local.map(x=>[x.id,x]));
    for(const item of (remote[entity]||[])){
      const cur=map.get(item.id);
      if(!cur || Number(item.updatedAt||0)>=Number(cur.updatedAt||0)) await put(entity,item);
    }
  }
}
async function syncNow(silent=false){
  if(!serverReady){if(!silent)toast("Sem conexão com banco online.");return}
  try{
    setSyncBadge("syncing");
    const snap=await snapshot();
    const remote=await api("/api/sync",{method:"POST",body:JSON.stringify(snap)});
    await mergeRemote(remote);
    for(const d of snap.deletes) await del("deletes",d.id);
    setSyncBadge("online");
    await refresh(false);
    if(!silent)toast("Dados sincronizados.");
  }catch(e){setSyncBadge("offline");if(!silent)toast(e.message)}
}

async function loadTrips(){
  const trips=(await all("trips")).sort((a,b)=>b.startedAt-a.startedAt);
  activeTrip=trips.find(t=>!t.finishedAt)||null;
  if(!selectedTripId) selectedTripId=activeTrip?.id || trips[0]?.id || null;
  if(selectedTripId && !trips.some(t=>t.id===selectedTripId)) selectedTripId=activeTrip?.id || trips[0]?.id || null;
  const sel=$("tripSelector");
  sel.innerHTML=trips.length?trips.map(t=>`<option value="${t.id}" ${t.id===selectedTripId?"selected":""}>${esc(t.name)}${t.finishedAt?" • encerrada":" • ativa"}</option>`).join(""):'<option value="">Nenhuma viagem</option>';
  return trips.find(t=>t.id===selectedTripId)||null;
}
async function tripData(){
  if(!selectedTripId)return {trip:null,places:[],expenses:[],gps:[]};
  const [trips,places,expenses,gps]=await Promise.all([all("trips"),all("places"),all("expenses"),all("gps")]);
  return {trip:trips.find(t=>t.id===selectedTripId)||null,places:places.filter(x=>x.tripId===selectedTripId),expenses:expenses.filter(x=>x.tripId===selectedTripId),gps:gps.filter(x=>x.tripId===selectedTripId)}
}

async function refresh(updateMap=true){
  const trip=await loadTrips();
  const {places,expenses,gps}=await tripData();
  gpsPoints=activeTrip?(await all("gps")).filter(x=>x.tripId===activeTrip.id):[];
  const dist=calcDistance(gps), total=expenses.reduce((s,e)=>s+Number(e.amount||0),0);
  const fuel=expenses.filter(e=>e.category==="combustivel"), liters=fuel.reduce((s,e)=>s+Number(e.liters||0),0), fuelValue=fuel.reduce((s,e)=>s+Number(e.amount||0),0);
  const avg=liters>0?dist/liters:0, odometer=trip?.startKm?Number(trip.startKm)+dist:null;

  $("distanceStat").textContent=`${num(dist,1)} km`;$("odometerStat").textContent=odometer?`${num(odometer,1)} km`:"—";
  $("spentStat").textContent=money(total);$("expenseCount").textContent=`${expenses.length} lançamento${expenses.length===1?"":"s"}`;
  $("fuelStat").textContent=`${num(liters,2)} L`;$("fuelValueStat").textContent=money(fuelValue);
  $("avgStat").textContent=liters?`${num(avg,2)} km/L`:"— km/L";$("costPerKmStat").textContent=dist?money(total/dist):"R$ 0,00";
  $("sumKm").textContent=`${num(dist,1)} km`;$("sumTotal").textContent=money(total);$("sumLiters").textContent=`${num(liters,2)} L`;$("sumPlaces").textContent=places.length;

  if(trip){
    $("tripStatusPill").textContent=trip.finishedAt?"Viagem encerrada":(activeTrip?.id===trip.id?"Viagem em andamento":"Histórico");
    $("tripTitle").textContent=trip.name;$("tripSubtitle").textContent=`Iniciada em ${new Date(trip.startedAt).toLocaleString("pt-BR")}`;
    $("tripSummary").innerHTML=`<div class="summary-grid"><div><span>Veículo</span><strong>${esc(trip.vehicle||"Não informado")}</strong></div><div><span>KM inicial</span><strong>${trip.startKm?num(trip.startKm,1):"Não informado"}</strong></div><div><span>Distância por GPS</span><strong>${num(dist,1)} km</strong></div><div><span>Paradas registradas</span><strong>${places.length}</strong></div></div>`;
  } else {
    $("tripStatusPill").textContent="Nenhuma viagem ativa";$("tripTitle").textContent="Comece uma nova viagem";$("tripSubtitle").textContent="GPS, fotos, gastos, combustível e diário em um só lugar.";$("tripSummary").textContent="Nenhuma viagem iniciada.";
  }
  $("finishTripBtn").classList.toggle("hidden",!activeTrip);
  $("newTripBtn").classList.toggle("hidden",!!activeTrip);
  renderPlaces(places);renderExpenses(expenses);renderGallery(places);renderBreakdown(expenses);
  $("routeInfoKm").textContent=`${num(dist,1)} km`;$("routeInfoPoints").textContent=`${gps.length} pontos de GPS`;
  if(updateMap)renderMap(gps,places);
}

function categoryLabel(v){return ({combustivel:"Combustível",alimentacao:"Alimentação",pedagio:"Pedágio",hospedagem:"Hospedagem",manutencao:"Manutenção",passeio:"Passeio",outros:"Outros"})[v]||v}
function showPhoto(src){$("photoViewerImg").src=src;$("photoViewer").classList.remove("hidden")}
window.showPhoto=showPhoto;

function renderPlaces(items){
  const list=$("placesList");if(!selectedTripId){list.innerHTML='<div class="empty-state">Inicie uma viagem para criar o diário.</div>';return}
  if(!items.length){list.innerHTML='<div class="empty-state">Nenhum lugar registrado.</div>';return}
  list.innerHTML=[...items].sort((a,b)=>b.createdAt-a.createdAt).map(p=>{
    const photos=(p.photos||[]).map(x=>`<img src="${x}" onclick="showPhoto(this.src)" alt="Foto">`).join("");
    return `<article class="item-card"><div class="item-top"><div><h3>${esc(p.name)}</h3><div class="item-meta">${esc(p.date||"")} ${esc(p.time||"")}</div></div><div>${p.rating?"★".repeat(Number(p.rating)):""}</div></div>${p.notes?`<p>${esc(p.notes).replace(/\n/g,"<br>")}</p>`:""}${photos?`<div class="photo-strip">${photos}</div>`:""}<div class="item-actions">${p.lat&&p.lon?`<a target="_blank" href="https://www.google.com/maps?q=${p.lat},${p.lon}">Abrir mapa</a>`:""}<button class="danger" onclick="deleteItem('place','${p.id}')">Excluir</button></div></article>`;
  }).join("")
}
function renderGallery(places){
  const g=$("galleryGrid"), photos=[];
  for(const p of places) for(const src of (p.photos||[])) photos.push({src,name:p.name,date:p.date});
  g.innerHTML=photos.length?photos.map(x=>`<div class="gallery-item"><img src="${x.src}" onclick="showPhoto(this.src)" alt="${esc(x.name)}"><div class="gallery-label">${esc(x.name)}${x.date?` • ${esc(x.date)}`:""}</div></div>`).join(""):'<div class="empty-state">As fotos dos lugares aparecerão aqui.</div>'
}
function renderExpenses(items){
  const list=$("expensesList"),filter=$("expenseFilter").value;
  let shown=filter==="all"?items:items.filter(e=>e.category===filter);
  if(!selectedTripId){list.innerHTML='<div class="empty-state">Inicie uma viagem para registrar gastos.</div>';return}
  if(!shown.length){list.innerHTML='<div class="empty-state">Nenhum gasto nesta categoria.</div>';return}
  list.innerHTML=[...shown].sort((a,b)=>b.createdAt-a.createdAt).map(e=>`<article class="item-card"><div class="item-top"><div><span class="category-chip">${categoryLabel(e.category)}</span><h3 style="margin:8px 0 4px">${esc(e.description||categoryLabel(e.category))}</h3><div class="item-meta">${esc(e.date||"")}</div></div><div class="expense-value">${money(e.amount)}</div></div>${e.category==="combustivel"?`<p>${e.liters?`${num(e.liters,2)} L`:""} ${e.unitPrice?`• ${money(e.unitPrice)}/L`:""}</p>`:""}${e.notes?`<p>${esc(e.notes)}</p>`:""}${e.receipt?`<div class="photo-strip"><img src="${e.receipt}" onclick="showPhoto(this.src)" alt="Comprovante"></div>`:""}<div class="item-actions"><button class="danger" onclick="deleteItem('expense','${e.id}')">Excluir</button></div></article>`).join("")
}
function renderBreakdown(items){
  const b=$("categoryBreakdown");if(!items.length){b.innerHTML='<div class="summary-empty">Sem gastos.</div>';return}
  const sums={};items.forEach(e=>sums[e.category]=(sums[e.category]||0)+Number(e.amount||0));const max=Math.max(...Object.values(sums));
  b.innerHTML=Object.entries(sums).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="breakdown-row"><span>${categoryLabel(k)}</span><div class="bar"><div style="width:${v/max*100}%"></div></div><strong>${money(v)}</strong></div>`).join("")
}
function renderMap(gps,places){
  if(!window.L)return;
  if(!routeMap){
    routeMap=L.map("routeMap");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(routeMap);
    routeMap.setView([-22.9,-47.06],8)
  }
  if(routeLayer)routeLayer.remove();if(markerLayer)markerLayer.remove();
  const sorted=[...gps].sort((a,b)=>a.ts-b.ts), coords=sorted.map(p=>[p.lat,p.lon]);
  routeLayer=L.polyline(coords,{weight:4}).addTo(routeMap);markerLayer=L.layerGroup().addTo(routeMap);
  places.filter(p=>p.lat&&p.lon).forEach(p=>L.marker([p.lat,p.lon]).bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.date||"")}`).addTo(markerLayer));
  if(coords.length) routeMap.fitBounds(routeLayer.getBounds(),{padding:[24,24]}); else if(places.some(p=>p.lat&&p.lon)){const pts=places.filter(p=>p.lat&&p.lon).map(p=>[p.lat,p.lon]);routeMap.fitBounds(L.latLngBounds(pts),{padding:[24,24]})}
  setTimeout(()=>routeMap.invalidateSize(),100)
}
