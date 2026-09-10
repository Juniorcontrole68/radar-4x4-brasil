const $=s=>document.querySelector(s);
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmt=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'-';
const tc=s=>String(s||'').toLocaleLowerCase('pt-BR').replace(/(^|[\s\-\/])([\p{L}])/gu,(m,sep,ch)=>sep+ch.toLocaleUpperCase('pt-BR'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let bills=[];
let until='';
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});

async function api(url,options={}){const r=await fetch(url,options);if(!r.ok)throw new Error(await r.text()||'Erro');const ct=r.headers.get('content-type')||'';return ct.includes('json')?r.json():r.text();}
async function load(){bills=await api('/api/bills');render();}
function pendingFiltered(){const p=bills.filter(x=>x.status!=='paid');return until?p.filter(x=>String(x.due_date).slice(0,10)<=until):p;}
function render(){
 const t=today(),cm=t.slice(0,7),pending=bills.filter(x=>x.status!=='paid'),overdue=pending.filter(x=>String(x.due_date).slice(0,10)<t),month=bills.filter(x=>String(x.due_date).slice(0,7)===cm),paidMonth=bills.filter(x=>x.status==='paid'&&x.payment_date&&String(x.payment_date).slice(0,7)===cm),filtered=pendingFiltered();
 $('#cardPending').textContent=money(pending.reduce((s,x)=>s+Number(x.amount),0));$('#cardOverdue').textContent=money(overdue.reduce((s,x)=>s+Number(x.amount),0));$('#cardMonth').textContent=money(month.reduce((s,x)=>s+Number(x.amount),0));$('#cardPaidMonth').textContent=money(paidMonth.reduce((s,x)=>s+Number(x.amount),0));
 $('#filterLabel').textContent=until?'Em aberto até '+fmt(until):'Todas as contas em aberto';$('#filterTotal').textContent=money(filtered.reduce((s,x)=>s+Number(x.amount),0));$('#filterCount').textContent=filtered.length+' conta(s)';
 $('#printFilterLabel').textContent=until?'Vencimentos até '+fmt(until):'Todas as contas em aberto';$('#printTotal').textContent='Total: '+money(filtered.reduce((s,x)=>s+Number(x.amount),0));
 $('#reportBody').innerHTML=filtered.map(x=>`<tr><td class="check">☐</td><td>${fmt(x.due_date)}</td><td>${esc(tc(x.description))}</td><td>${esc(tc(x.supplier||'-'))}</td><td>${esc(tc(x.area||'Geral'))}</td><td>${esc(tc(x.category||'-'))}</td><td>${money(x.amount)}</td></tr>`).join('')||'<tr><td colspan="7">Nenhuma conta em aberto para o filtro informado.</td></tr>';
 $('#billsBody').innerHTML=bills.map(x=>{const due=String(x.due_date).slice(0,10),ov=x.status!=='paid'&&due<t,st=x.status==='paid'?'Pago':ov?'Vencido':'Pendente',cl=x.status==='paid'?'ok':ov?'late':'wait';return `<tr><td>${fmt(due)}</td><td><b>${esc(tc(x.description))}</b>${Number(x.postponed_count)>0?'<div class="mini">Prorrogado '+Number(x.postponed_count)+'x</div>':''}</td><td>${esc(tc(x.supplier||'-'))}</td><td>${esc(tc(x.area||'Geral'))}</td><td>${esc(tc(x.category||'-'))}</td><td>${money(x.amount)}</td><td><span class="badge ${cl}">${st}</span></td><td><div class="actions">${x.status!=='paid'?`<button class="btn pay" onclick="payBill('${x.id}')">Pagar</button><button class="btn postpone" onclick="openPostpone('${x.id}')">Prorrogar</button>`:''}<button class="btn del" onclick="deleteBill('${x.id}')">Excluir</button></div></td></tr>`}).join('')||'<tr><td colspan="8" class="empty">Nenhuma Conta Cadastrada.</td></tr>';
}

$('#dueDate').value=today();
$('#billForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form),payload=Object.fromEntries(f.entries());payload.recurrenceDates=[...document.querySelectorAll('.recDate')].map(x=>x.value).filter(Boolean);try{await api('/api/bills',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});form.reset();$('#dueDate').value=today();document.querySelectorAll('.recDate').forEach(x=>x.value='');$('#recSummary').textContent='Nenhuma data adicional';$('#saveMsg').textContent='Conta(s) salva(s).';await load();setTimeout(()=>$('#saveMsg').textContent='',2500);}catch(err){alert(err.message);}});

$('#openRec').onclick=()=>$('#recModal').showModal();$('#cancelRec').onclick=()=>$('#recModal').close();$('#saveRec').onclick=()=>{const n=[...document.querySelectorAll('.recDate')].filter(x=>x.value).length;$('#recSummary').textContent=n?n+' data(s) adicional(is) selecionada(s)':'Nenhuma data adicional';$('#recModal').close();};$('#addRecDate').onclick=()=>{const box=$('#recDates'),count=box.querySelectorAll('.recDate').length+2,lab=document.createElement('label');lab.className='recItem';lab.textContent=count+'ª Data';const inp=document.createElement('input');inp.type='date';inp.className='recDate';lab.appendChild(inp);box.appendChild(lab);};
$('#filterBtn').onclick=()=>{until=$('#untilDate').value;render();};$('#clearFilter').onclick=()=>{until='';$('#untilDate').value='';render();};$('#printBtn').onclick=()=>window.print();

async function payBill(id){if(!confirm('Marcar esta conta como paga?'))return;await api('/api/bills/'+id+'/pay',{method:'POST'});await load();}
async function deleteBill(id){if(!confirm('Excluir esta conta?'))return;await api('/api/bills/'+id,{method:'DELETE'});await load();}
function openPostpone(id){const x=bills.find(v=>v.id===id);if(!x)return;$('#postponeId').value=id;$('#postponeDesc').textContent=tc(x.description)+' — vencimento atual: '+fmt(x.due_date);$('#postponeDate').value=String(x.due_date).slice(0,10);$('#postponeModal').showModal();}
$('#cancelPostpone').onclick=()=>$('#postponeModal').close();$('#confirmPostpone').onclick=async()=>{const id=$('#postponeId').value,newDueDate=$('#postponeDate').value;if(!newDueDate)return alert('Informe a nova data.');await api('/api/bills/'+id+'/postpone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newDueDate})});$('#postponeModal').close();await load();};
window.payBill=payBill;window.deleteBill=deleteBill;window.openPostpone=openPostpone;
load().catch(e=>{console.error(e);$('#billsBody').innerHTML='<tr><td colspan="8" class="empty">Erro ao carregar. Verifique o banco de dados.</td></tr>';});
