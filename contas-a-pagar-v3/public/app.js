const $=s=>document.querySelector(s);
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmt=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'-';
const tc=s=>String(s||'').toLocaleLowerCase('pt-BR').replace(/(^|[\s\-\/])([\p{L}])/gu,(m,sep,ch)=>sep+ch.toLocaleUpperCase('pt-BR'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let bills=[];
let until='';
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});

async function api(url,options={}){const r=await fetch(url,options);if(!r.ok)throw new Error(await r.text()||'Erro');const ct=r.headers.get('content-type')||'';return ct.includes('json')?r.json():r.text();}
function fileDataUrl(file){return new Promise((resolve,reject)=>{if(!file)return resolve('');if(file.size>7*1024*1024)return reject(new Error('O arquivo deve ter no máximo 7 MB.'));const rd=new FileReader();rd.onload=()=>resolve(String(rd.result||''));rd.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));rd.readAsDataURL(file);});}
async function sendDocument(id,kind,file){
 if(!file)return;
 const dataUrl=await fileDataUrl(file);
 await api('/api/bills/'+id+'/document/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileName:file.name,mimeType:file.type||'application/octet-stream',dataUrl})});
}
function openDocument(id,kind){window.open('/api/bills/'+id+'/document/'+kind,'_blank','noopener');}
function chooseDocument(id,kind){
 const input=document.createElement('input');input.type='file';input.accept='application/pdf,image/jpeg,image/png,image/webp';
 input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{await sendDocument(id,kind,file);await load();}catch(e){alert(e.message)}};
 input.click();
}
async function copyPix(key){try{await navigator.clipboard.writeText(String(key||''));alert('Chave PIX copiada.');}catch{prompt('Copie a chave PIX:',String(key||''));}}
async function editPix(id){
 const bill=bills.find(x=>x.id===id);if(!bill)return;
 const type=prompt('Tipo da chave PIX: Email, Celular, CPF ou Aleatoria',bill.pix_type||'');
 if(type===null)return;
 const key=prompt('Chave PIX:',bill.pix_key||'');
 if(key===null)return;
 await api('/api/bills/'+id+'/pix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pixType:type,pixKey:key})});
 await load();
}
async function load(){bills=await api('/api/bills');render();}
function pendingFiltered(){
 const p=bills.filter(x=>x.status!=='paid');
 return until?p.filter(x=>String(x.due_date||'').slice(0,10)<=until):p;
}
function visibleBills(){
 if(!until)return [...bills];
 return pendingFiltered();
}
function render(){
 const t=today(),cm=t.slice(0,7),pending=bills.filter(x=>x.status!=='paid'),overdue=pending.filter(x=>String(x.due_date).slice(0,10)<t),month=bills.filter(x=>String(x.due_date).slice(0,7)===cm),paidMonth=bills.filter(x=>x.status==='paid'&&x.payment_date&&String(x.payment_date).slice(0,7)===cm),filtered=pendingFiltered(),visible=visibleBills().sort((a,b)=>String(a.due_date||'').localeCompare(String(b.due_date||'')));
 $('#cardPending').textContent=money(pending.reduce((s,x)=>s+Number(x.amount),0));$('#cardOverdue').textContent=money(overdue.reduce((s,x)=>s+Number(x.amount),0));$('#cardMonth').textContent=money(month.reduce((s,x)=>s+Number(x.amount),0));$('#cardPaidMonth').textContent=money(paidMonth.reduce((s,x)=>s+Number(x.amount),0));
 $('#filterLabel').textContent=until?'Em aberto até '+fmt(until):'Todas as contas em aberto';$('#filterTotal').textContent=money(filtered.reduce((s,x)=>s+Number(x.amount),0));$('#filterCount').textContent=filtered.length+' conta(s)';
 $('#printFilterLabel').textContent=until?'Vencimentos até '+fmt(until):'Todas as contas em aberto';$('#printTotal').textContent='Total: '+money(filtered.reduce((s,x)=>s+Number(x.amount),0));
 $('#reportBody').innerHTML=filtered.map(x=>`<tr><td class="check">☐</td><td>${fmt(x.due_date)}</td><td>${esc(tc(x.description))}</td><td>${esc(tc(x.supplier||'-'))}</td><td>${esc(tc(x.area||'Geral'))}</td><td>${esc(tc(x.category||'-'))}</td><td>${money(x.amount)}</td></tr>`).join('')||'<tr><td colspan="7">Nenhuma conta em aberto para o filtro informado.</td></tr>';
 $('#billsBody').innerHTML=visible.map(x=>{
  const due=String(x.due_date).slice(0,10),ov=x.status!=='paid'&&due<t,st=x.status==='paid'?'Pago':ov?'Vencido':'Pendente',cl=x.status==='paid'?'ok':ov?'late':'wait';
  const pix=x.pix_key?('<div class="pixcell"><b>'+esc(x.pix_type||'PIX')+'</b><div>'+esc(x.pix_key)+'</div><button class="btn secondary miniBtn" onclick="copyPix('+JSON.stringify(String(x.pix_key))+')">Copiar</button></div>'):'<span class="mini">Sem PIX</span>';
  const boleto=x.has_boleto?'<div class="docActions"><button class="btn secondary miniBtn" onclick="openDocument(\''+x.id+'\',\'boleto\')">Ver</button><button class="btn rec miniBtn" onclick="chooseDocument(\''+x.id+'\',\'boleto\')">Trocar</button></div>':'<button class="btn rec miniBtn" onclick="chooseDocument(\''+x.id+'\',\'boleto\')">Anexar</button>';
  const comp=x.has_comprovante?'<div class="docActions"><button class="btn secondary miniBtn" onclick="openDocument(\''+x.id+'\',\'comprovante\')">Ver</button><button class="btn rec miniBtn" onclick="chooseDocument(\''+x.id+'\',\'comprovante\')">Trocar</button></div>':'<button class="btn rec miniBtn" onclick="chooseDocument(\''+x.id+'\',\'comprovante\')">Anexar</button>';
  return `<tr><td>${fmt(due)}</td><td><b>${esc(tc(x.description))}</b>${Number(x.postponed_count)>0?'<div class="mini">Prorrogado '+Number(x.postponed_count)+'x</div>':''}</td><td>${esc(tc(x.supplier||'-'))}</td><td>${esc(tc(x.area||'Geral'))}</td><td>${esc(tc(x.category||'-'))}</td><td>${money(x.amount)}</td><td>${pix}</td><td>${boleto}</td><td>${comp}</td><td><span class="badge ${cl}">${st}</span></td><td><div class="actions"><button class="btn secondary miniBtn" onclick="editPix('${x.id}')">PIX</button>${x.status!=='paid'?`<button class="btn pay" onclick="payBill('${x.id}')">Pagar</button><button class="btn postpone" onclick="openPostpone('${x.id}')">Prorrogar</button>`:''}<button class="btn del" onclick="deleteBill('${x.id}')">Excluir</button></div></td></tr>`
 }).join('')||(until?'<tr><td colspan="11" class="empty">Nenhuma conta em aberto até '+fmt(until)+'.</td></tr>':'<tr><td colspan="11" class="empty">Nenhuma Conta Cadastrada.</td></tr>');
}

$('#dueDate').value=today();
$('#billForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const form=e.currentTarget,f=new FormData(form),boleto=$('#boletoFile').files?.[0]||null,comprovante=$('#comprovanteFile').files?.[0]||null;
 const payload=Object.fromEntries([...f.entries()].filter(([k])=>!['boletoFile','comprovanteFile'].includes(k)));
 payload.recurrenceDates=[...document.querySelectorAll('.recDate')].map(x=>x.value).filter(Boolean);
 try{
  const saved=await api('/api/bills',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const firstId=saved.ids?.[0];
  if(firstId){if(boleto)await sendDocument(firstId,'boleto',boleto);if(comprovante)await sendDocument(firstId,'comprovante',comprovante)}
  form.reset();$('#dueDate').value=today();document.querySelectorAll('.recDate').forEach(x=>x.value='');$('#recSummary').textContent='Nenhuma data adicional';
  $('#saveMsg').textContent=saved.count>1&&(boleto||comprovante)?'Contas salvas. Documento(s) anexado(s) à 1ª parcela.':'Conta(s) salva(s).';
  await load();setTimeout(()=>$('#saveMsg').textContent='',4000);
 }catch(err){alert(err.message)}
});

$('#openRec').onclick=()=>$('#recModal').showModal();$('#cancelRec').onclick=()=>$('#recModal').close();$('#saveRec').onclick=()=>{const n=[...document.querySelectorAll('.recDate')].filter(x=>x.value).length;$('#recSummary').textContent=n?n+' data(s) adicional(is) selecionada(s)':'Nenhuma data adicional';$('#recModal').close();};$('#addRecDate').onclick=()=>{const box=$('#recDates'),count=box.querySelectorAll('.recDate').length+2,lab=document.createElement('label');lab.className='recItem';lab.textContent=count+'ª Data';const inp=document.createElement('input');inp.type='date';inp.className='recDate';lab.appendChild(inp);box.appendChild(lab);};
$('#filterBtn').onclick=()=>{
 const v=$('#untilDate').value;
 if(!v)return alert('Informe a data limite para filtrar.');
 until=v;
 render();
};
$('#untilDate').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#filterBtn').click();}});
$('#untilDate').addEventListener('change',()=>{if(until){until=$('#untilDate').value;render();}});
$('#clearFilter').onclick=()=>{until='';$('#untilDate').value='';render();};
$('#printBtn').onclick=()=>window.print();

async function payBill(id){if(!confirm('Marcar esta conta como paga?'))return;await api('/api/bills/'+id+'/pay',{method:'POST'});await load();}
async function deleteBill(id){if(!confirm('Excluir esta conta?'))return;await api('/api/bills/'+id,{method:'DELETE'});await load();}
function openPostpone(id){const x=bills.find(v=>v.id===id);if(!x)return;$('#postponeId').value=id;$('#postponeDesc').textContent=tc(x.description)+' — vencimento atual: '+fmt(x.due_date);$('#postponeDate').value=String(x.due_date).slice(0,10);$('#postponeModal').showModal();}
$('#cancelPostpone').onclick=()=>$('#postponeModal').close();$('#confirmPostpone').onclick=async()=>{const id=$('#postponeId').value,newDueDate=$('#postponeDate').value;if(!newDueDate)return alert('Informe a nova data.');await api('/api/bills/'+id+'/postpone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newDueDate})});$('#postponeModal').close();await load();};
window.payBill=payBill;window.deleteBill=deleteBill;window.openPostpone=openPostpone;window.openDocument=openDocument;window.chooseDocument=chooseDocument;window.copyPix=copyPix;window.editPix=editPix;
load().catch(e=>{console.error(e);$('#billsBody').innerHTML='<tr><td colspan="11" class="empty">Erro ao carregar. Verifique o banco de dados.</td></tr>';});
