(()=>{
const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
const KEY='construlog_frota_v1';
const empty=()=>({vehicles:[],fuel:[],maintenance:[],tires:[],people:[],documents:[],checklists:[]});
let db=empty();
let saving=false;
async function loadRemote(){
  try{
    const r=await fetch('/api/frota-state',{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    // sem login ainda, ou usuário sem acesso à Frota: fica vazio, sem aviso na tela
    if(r.status===401||r.status===403){db=empty();return}
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao carregar Frota.');
    db=Object.assign(empty(),j.data||{});
  }catch(e){
    console.error(e);
    db=empty();
    alert('Não foi possível carregar os dados da Frota: '+(e.message||e));
  }
}
async function save(){
  render();
  if(saving)return;
  saving=true;
  try{
    const r=await fetch('/api/frota-state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:db})});
    const j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao salvar Frota.');
    db=Object.assign(empty(),j.data||db);
    render();
  }catch(e){
    console.error(e);
    alert('Não foi possível salvar os dados da Frota: '+(e.message||e));
    await loadRemote();
    render();
  }finally{saving=false}
}
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const opts=(arr,key,label)=>'<option value="">Selecione...</option>'+arr.map(x=>'<option value="'+esc(x[key])+'">'+esc(label(x))+'</option>').join('');
function val(f,n){return (new FormData(f).get(n)||'').toString().trim()}
async function add(kind,obj){const item=Object.assign({id:uid(),createdAt:new Date().toISOString()},obj);db[kind].unshift(item);await save();return item}
async function remove(kind,id){db[kind]=db[kind].filter(x=>x.id!==id);await save()}
function rowDel(kind,id){return '<button class="fleet-del" data-kind="'+kind+'" data-id="'+id+'" type="button">Excluir</button>'}
function bindDelete(){qa('.fleet-del').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir este registro?'))return;try{if(b.dataset.kind==='maintenance')await fetch('/api/frota-maintenance-file/'+encodeURIComponent(b.dataset.id),{method:'DELETE'}).catch(()=>{});await remove(b.dataset.kind,b.dataset.id)}catch(e){alert(e.message||'Não foi possível excluir.')}})}
async function fileToDataUrl(file){
  return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));r.readAsDataURL(file)})
}
async function uploadMaintenanceFile(maintenanceId,file){
  if(!file)return null;
  if(file.size>8*1024*1024)throw new Error('O anexo deve ter no máximo 8 MB.');
  const data=await fileToDataUrl(file);
  const r=await fetch('/api/frota-maintenance-file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maintenance_id:maintenanceId,name:file.name||'nota-fiscal',mime:file.type||'application/octet-stream',data})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível enviar a nota fiscal.');
  return j
}
async function openMaintenanceFile(id){
  try{
    const r=await fetch('/api/frota-maintenance-file/'+encodeURIComponent(id),{cache:'no-store'});
    if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'Anexo não encontrado.')}
    const blob=await r.blob(),url=URL.createObjectURL(blob);
    window.open(url,'_blank','noopener,noreferrer');
    setTimeout(()=>URL.revokeObjectURL(url),60000)
  }catch(e){alert(e.message||'Não foi possível abrir o anexo.')}
}
function bindFileButtons(){qa('[data-fleet-file]').forEach(b=>b.onclick=()=>openMaintenanceFile(b.dataset.fleetFile))}
function updateMaintFileLabel(){
  const cam=q('#fleetMaintCamera')?.files?.[0],file=q('#fleetMaintFile')?.files?.[0],chosen=cam||file,box=q('#fleetMaintFileName');
  if(box)box.textContent=chosen?('Selecionado: '+chosen.name+' • '+Math.max(1,Math.round(chosen.size/1024))+' KB'):'Nenhum anexo selecionado.'
}
function setSub(name){qa('.fleet-sub').forEach(b=>b.classList.toggle('active',b.dataset.fleet===name));qa('.fleet-panel').forEach(p=>p.classList.toggle('active',p.id==='fleet-'+name))}
function render(){
 const fuelTotal=db.fuel.reduce((s,x)=>s+Number(x.total||0),0), maintTotal=db.maintenance.reduce((s,x)=>s+Number(x.total||0),0);
 q('#fleetKpiVehicles').textContent=db.vehicles.length;
 q('#fleetKpiActive').textContent=db.vehicles.filter(x=>x.status==='Ativo').length;
 q('#fleetKpiFuel').textContent=money(fuelTotal);
 q('#fleetKpiMaint').textContent=money(maintTotal);
 q('#fleetKpiDocs').textContent=db.documents.filter(x=>x.expiry&&x.expiry<new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})).length;
 q('#fleetVehicleBody').innerHTML=db.vehicles.map(x=>'<tr><td>'+esc(x.plate)+'</td><td>'+esc(x.brand)+'</td><td>'+esc(x.model)+'</td><td>'+esc(x.type)+'</td><td>'+esc(x.km)+'</td><td>'+esc(x.driver)+'</td><td>'+esc(x.status)+'</td><td>'+rowDel('vehicles',x.id)+'</td></tr>').join('')||'<tr><td colspan="8" class="muted">Nenhum veículo cadastrado.</td></tr>';
 const vopt=opts(db.vehicles,'plate',x=>x.plate+' • '+x.model), popt=opts(db.people,'name',x=>x.name+' • '+x.role);
 ['#fleetFuelVehicle','#fleetMaintVehicle','#fleetTireVehicle','#fleetDocVehicle','#fleetCheckVehicle'].forEach(s=>{if(q(s))q(s).innerHTML=vopt});
 ['#fleetFuelDriver','#fleetCheckDriver'].forEach(s=>{if(q(s))q(s).innerHTML=popt});
 q('#fleetPeopleBody').innerHTML=db.people.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.role)+'</td><td>'+esc(x.cnh)+'</td><td>'+esc(x.cnhExpiry)+'</td><td>'+esc(x.phone)+'</td><td>'+esc(x.status)+'</td><td>'+rowDel('people',x.id)+'</td></tr>').join('')||'<tr><td colspan="7" class="muted">Nenhuma pessoa cadastrada.</td></tr>';
 q('#fleetFuelBody').innerHTML=db.fuel.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.plate)+'</td><td>'+esc(x.driver)+'</td><td>'+esc(x.km)+'</td><td>'+esc(x.liters)+'</td><td>'+money(x.price)+'</td><td>'+money(x.total)+'</td><td>'+rowDel('fuel',x.id)+'</td></tr>').join('')||'<tr><td colspan="8" class="muted">Nenhum abastecimento.</td></tr>';
 q('#fleetMaintBody').innerHTML=db.maintenance.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.plate)+'</td><td>'+esc(x.service)+(x.note?'<div class="muted">'+esc(x.note)+'</div>':'')+'</td><td>'+esc(x.km)+'</td><td>'+esc(x.workshop)+'</td><td>'+money(x.total)+'</td><td>'+esc(x.nextKm||x.nextDate)+'</td><td>'+(x.attachmentName?'<button class="fleet-file-btn" type="button" data-fleet-file="'+esc(x.id)+'">Ver NF</button>':'—')+'</td><td>'+rowDel('maintenance',x.id)+'</td></tr>').join('')||'<tr><td colspan="9" class="muted">Nenhuma manutenção.</td></tr>';
 q('#fleetTireBody').innerHTML=db.tires.map(x=>'<tr><td>'+esc(x.code)+'</td><td>'+esc(x.brand)+'</td><td>'+esc(x.size)+'</td><td>'+esc(x.plate)+'</td><td>'+esc(x.position)+'</td><td>'+esc(x.kmInstall)+'</td><td>'+money(x.cost)+'</td><td>'+rowDel('tires',x.id)+'</td></tr>').join('')||'<tr><td colspan="8" class="muted">Nenhum pneu cadastrado.</td></tr>';
 q('#fleetDocBody').innerHTML=db.documents.map(x=>'<tr><td>'+esc(x.plate)+'</td><td>'+esc(x.type)+'</td><td>'+esc(x.expiry)+'</td><td>'+esc(x.note)+'</td><td>'+rowDel('documents',x.id)+'</td></tr>').join('')||'<tr><td colspan="5" class="muted">Nenhum documento.</td></tr>';
 q('#fleetCheckBody').innerHTML=db.checklists.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.plate)+'</td><td>'+esc(x.driver)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.note)+'</td><td>'+rowDel('checklists',x.id)+'</td></tr>').join('')||'<tr><td colspan="6" class="muted">Nenhum checklist.</td></tr>';
 q('#fleetCostBody').innerHTML=db.vehicles.map(v=>{const f=db.fuel.filter(x=>x.plate===v.plate).reduce((s,x)=>s+Number(x.total||0),0),m=db.maintenance.filter(x=>x.plate===v.plate).reduce((s,x)=>s+Number(x.total||0),0);return '<tr><td>'+esc(v.plate)+'</td><td>'+esc(v.model)+'</td><td>'+money(f)+'</td><td>'+money(m)+'</td><td><b>'+money(f+m)+'</b></td></tr>'}).join('')||'<tr><td colspan="5" class="muted">Sem dados.</td></tr>'; if(q('#fleetCostBody2'))q('#fleetCostBody2').innerHTML=q('#fleetCostBody').innerHTML;
 bindDelete();bindFileButtons()
}
async function setup(){
 qa('.fleet-sub').forEach(b=>b.onclick=()=>setSub(b.dataset.fleet));
 ['#fleetMaintFile','#fleetMaintCamera'].forEach(sel=>{const el=q(sel);if(el)el.onchange=()=>{if(sel==='#fleetMaintFile'&&q('#fleetMaintCamera'))q('#fleetMaintCamera').value='';if(sel==='#fleetMaintCamera'&&q('#fleetMaintFile'))q('#fleetMaintFile').value='';updateMaintFileLabel()}});
 q('#fleetVehicleForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;await add('vehicles',{plate:val(f,'plate').toUpperCase(),brand:val(f,'brand'),model:val(f,'model'),type:val(f,'type'),km:Number(val(f,'km')||0),driver:val(f,'driver'),status:val(f,'status')||'Ativo'});f.reset()};
 q('#fleetPeopleForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;await add('people',{name:val(f,'name'),role:val(f,'role'),cnh:val(f,'cnh'),cnhExpiry:val(f,'cnhExpiry'),phone:val(f,'phone'),status:val(f,'status')||'Ativo'});f.reset()};
 q('#fleetFuelForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,lit=Number(val(f,'liters')||0),price=Number(val(f,'price')||0);await add('fuel',{date:val(f,'date'),plate:val(f,'plate'),driver:val(f,'driver'),km:Number(val(f,'km')||0),liters:lit,price:price,total:Number(val(f,'total')||0)||lit*price});f.reset()};
 q('#fleetMaintForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,parts=Number(val(f,'parts')||0),labor=Number(val(f,'labor')||0),cam=q('#fleetMaintCamera')?.files?.[0],file=q('#fleetMaintFile')?.files?.[0],attachment=cam||file;try{const item=await add('maintenance',{date:val(f,'date'),plate:val(f,'plate'),service:val(f,'service'),km:Number(val(f,'km')||0),workshop:val(f,'workshop'),parts:parts,labor:labor,total:parts+labor,nextKm:val(f,'nextKm'),nextDate:val(f,'nextDate'),note:val(f,'note')});if(attachment){const up=await uploadMaintenanceFile(item.id,attachment);item.attachmentName=up.name||attachment.name;item.attachmentMime=up.mime||attachment.type;await save()}f.reset();updateMaintFileLabel()}catch(err){alert(err.message||'Não foi possível salvar a manutenção.')}};
 q('#fleetTireForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;await add('tires',{code:val(f,'code'),brand:val(f,'brand'),size:val(f,'size'),plate:val(f,'plate'),position:val(f,'position'),kmInstall:Number(val(f,'kmInstall')||0),cost:Number(val(f,'cost')||0)});f.reset()};
 q('#fleetDocForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;await add('documents',{plate:val(f,'plate'),type:val(f,'type'),expiry:val(f,'expiry'),note:val(f,'note')});f.reset()};
 q('#fleetCheckForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;await add('checklists',{date:val(f,'date'),plate:val(f,'plate'),driver:val(f,'driver'),status:val(f,'status'),note:val(f,'note')});f.reset()};
 await loadRemote();render();setSub('resumo')
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();