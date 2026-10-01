(()=>{
const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
const KEY='construlog_frota_v1';
const empty=()=>({vehicles:[],fuel:[],maintenance:[],tires:[],people:[],documents:[],checklists:[]});
let db;
try{db=Object.assign(empty(),JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(e){db=empty()}
const save=()=>{localStorage.setItem(KEY,JSON.stringify(db));render()};
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const opts=(arr,key,label)=>'<option value="">Selecione...</option>'+arr.map(x=>'<option value="'+esc(x[key])+'">'+esc(label(x))+'</option>').join('');
function val(f,n){return (new FormData(f).get(n)||'').toString().trim()}
function add(kind,obj){db[kind].unshift(Object.assign({id:uid(),createdAt:new Date().toISOString()},obj));save()}
function remove(kind,id){db[kind]=db[kind].filter(x=>x.id!==id);save()}
function rowDel(kind,id){return '<button class="fleet-del" data-kind="'+kind+'" data-id="'+id+'" type="button">Excluir</button>'}
function bindDelete(){qa('.fleet-del').forEach(b=>b.onclick=()=>{if(confirm('Excluir este registro?'))remove(b.dataset.kind,b.dataset.id)})}
function setSub(name){qa('.fleet-sub').forEach(b=>b.classList.toggle('active',b.dataset.fleet===name));qa('.fleet-panel').forEach(p=>p.classList.toggle('active',p.id==='fleet-'+name))}
function render(){
 const fuelTotal=db.fuel.reduce((s,x)=>s+Number(x.total||0),0), maintTotal=db.maintenance.reduce((s,x)=>s+Number(x.total||0),0);
 q('#fleetKpiVehicles').textContent=db.vehicles.length;
 q('#fleetKpiActive').textContent=db.vehicles.filter(x=>x.status==='Ativo').length;
 q('#fleetKpiFuel').textContent=money(fuelTotal);
 q('#fleetKpiMaint').textContent=money(maintTotal);
 q('#fleetKpiDocs').textContent=db.documents.filter(x=>x.expiry&&x.expiry<new Date().toISOString().slice(0,10)).length;
 q('#fleetVehicleBody').innerHTML=db.vehicles.map(x=>'<tr><td>'+esc(x.plate)+'</td><td>'+esc(x.brand)+'</td><td>'+esc(x.model)+'</td><td>'+esc(x.type)+'</td><td>'+esc(x.km)+'</td><td>'+esc(x.driver)+'</td><td>'+esc(x.status)+'</td><td>'+rowDel('vehicles',x.id)+'</td></tr>').join('')||'<tr><td colspan="8" class="muted">Nenhum veículo cadastrado.</td></tr>';
 const vopt=opts(db.vehicles,'plate',x=>x.plate+' • '+x.model), popt=opts(db.people,'name',x=>x.name+' • '+x.role);
 ['#fleetFuelVehicle','#fleetMaintVehicle','#fleetTireVehicle','#fleetDocVehicle','#fleetCheckVehicle'].forEach(s=>{if(q(s))q(s).innerHTML=vopt});
 ['#fleetFuelDriver','#fleetCheckDriver'].forEach(s=>{if(q(s))q(s).innerHTML=popt});
 q('#fleetPeopleBody').innerHTML=db.people.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.role)+'</td><td>'+esc(x.cnh)+'</td><td>'+esc(x.cnhExpiry)+'</td><td>'+esc(x.phone)+'</td><td>'+esc(x.status)+'</td><td>'+rowDel('people',x.id)+'</td></tr>').join('')||'<tr><td colspan="7" class="muted">Nenhuma pessoa cadastrada.</td></tr>';
 q('#fleetFuelBody').innerHTML=db.fuel.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.plate)+'</td><td>'+esc(x.driver)+'</td><td>'+esc(x.km)+'</td><td>'+esc(x.liters)+'</td><td>'+money(x.price)+'</td><td>'+money(x.total)+'</td><td>'+rowDel('fuel',x.id)+'</td></tr>').join('')||'<tr><td colspan="8" class="muted">Nenhum abastecimento.</td></tr>';
 q('#fleetMaintBody').innerHTML=db.maintenance.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.plate)+'</td><td>'+esc(x.service)+'</td><td>'+esc(x.km)+'</td><td>'+esc(x.workshop)+'</td><td>'+money(x.total)+'</td><td>'+esc(x.nextKm||x.nextDate)+'</td><td>'+rowDel('maintenance',x.id)+'</td></tr>').join('')||'<tr><td colspan="8" class="muted">Nenhuma manutenção.</td></tr>';
 q('#fleetTireBody').innerHTML=db.tires.map(x=>'<tr><td>'+esc(x.code)+'</td><td>'+esc(x.brand)+'</td><td>'+esc(x.size)+'</td><td>'+esc(x.plate)+'</td><td>'+esc(x.position)+'</td><td>'+esc(x.kmInstall)+'</td><td>'+money(x.cost)+'</td><td>'+rowDel('tires',x.id)+'</td></tr>').join('')||'<tr><td colspan="8" class="muted">Nenhum pneu cadastrado.</td></tr>';
 q('#fleetDocBody').innerHTML=db.documents.map(x=>'<tr><td>'+esc(x.plate)+'</td><td>'+esc(x.type)+'</td><td>'+esc(x.expiry)+'</td><td>'+esc(x.note)+'</td><td>'+rowDel('documents',x.id)+'</td></tr>').join('')||'<tr><td colspan="5" class="muted">Nenhum documento.</td></tr>';
 q('#fleetCheckBody').innerHTML=db.checklists.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.plate)+'</td><td>'+esc(x.driver)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.note)+'</td><td>'+rowDel('checklists',x.id)+'</td></tr>').join('')||'<tr><td colspan="6" class="muted">Nenhum checklist.</td></tr>';
 q('#fleetCostBody').innerHTML=db.vehicles.map(v=>{const f=db.fuel.filter(x=>x.plate===v.plate).reduce((s,x)=>s+Number(x.total||0),0),m=db.maintenance.filter(x=>x.plate===v.plate).reduce((s,x)=>s+Number(x.total||0),0);return '<tr><td>'+esc(v.plate)+'</td><td>'+esc(v.model)+'</td><td>'+money(f)+'</td><td>'+money(m)+'</td><td><b>'+money(f+m)+'</b></td></tr>'}).join('')||'<tr><td colspan="5" class="muted">Sem dados.</td></tr>';
 bindDelete()
}
function setup(){
 qa('.fleet-sub').forEach(b=>b.onclick=()=>setSub(b.dataset.fleet));
 q('#fleetVehicleForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;add('vehicles',{plate:val(f,'plate').toUpperCase(),brand:val(f,'brand'),model:val(f,'model'),type:val(f,'type'),km:Number(val(f,'km')||0),driver:val(f,'driver'),status:val(f,'status')||'Ativo'});f.reset()};
 q('#fleetPeopleForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;add('people',{name:val(f,'name'),role:val(f,'role'),cnh:val(f,'cnh'),cnhExpiry:val(f,'cnhExpiry'),phone:val(f,'phone'),status:val(f,'status')||'Ativo'});f.reset()};
 q('#fleetFuelForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,lit=Number(val(f,'liters')||0),price=Number(val(f,'price')||0);add('fuel',{date:val(f,'date'),plate:val(f,'plate'),driver:val(f,'driver'),km:Number(val(f,'km')||0),liters:lit,price:price,total:Number(val(f,'total')||0)||lit*price});f.reset()};
 q('#fleetMaintForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,parts=Number(val(f,'parts')||0),labor=Number(val(f,'labor')||0);add('maintenance',{date:val(f,'date'),plate:val(f,'plate'),service:val(f,'service'),km:Number(val(f,'km')||0),workshop:val(f,'workshop'),parts:parts,labor:labor,total:parts+labor,nextKm:val(f,'nextKm'),nextDate:val(f,'nextDate')});f.reset()};
 q('#fleetTireForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;add('tires',{code:val(f,'code'),brand:val(f,'brand'),size:val(f,'size'),plate:val(f,'plate'),position:val(f,'position'),kmInstall:Number(val(f,'kmInstall')||0),cost:Number(val(f,'cost')||0)});f.reset()};
 q('#fleetDocForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;add('documents',{plate:val(f,'plate'),type:val(f,'type'),expiry:val(f,'expiry'),note:val(f,'note')});f.reset()};
 q('#fleetCheckForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;add('checklists',{date:val(f,'date'),plate:val(f,'plate'),driver:val(f,'driver'),status:val(f,'status'),note:val(f,'note')});f.reset()};
 render();setSub('resumo')
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();