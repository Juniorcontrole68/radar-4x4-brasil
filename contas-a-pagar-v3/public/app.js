const $=s=>document.querySelector(s);
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmt=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'-';
const tc=s=>String(s||'').toLocaleLowerCase('pt-BR').replace(/(^|[\s\-\/])([\p{L}])/gu,(m,sep,ch)=>sep+ch.toLocaleUpperCase('pt-BR'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let bills=[];
let until='';
// Contas desmarcadas no relatório: ficam na tela, mas não saem na impressão nem no total.
const semImprimir=new Set();
const maisNovaPrimeiro=(a,b)=>String(b.due_date||'').localeCompare(String(a.due_date||''));
// Contas pessoais x da empresa, pela área da conta (as já lançadas entram pelo que está gravado nelas).
const AREAS_PESSOAIS=['pessoal','casa','familia'];
const semAc=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const tipoDa=x=>AREAS_PESSOAIS.includes(semAc(x?.area))?'pessoal':'empresa';
let tipo='empresa';try{tipo=localStorage.getItem('contas_tipo')||'empresa'}catch{}
const doTipo=l=>tipo==='todas'?l:l.filter(x=>tipoDa(x)===tipo);
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
async function copyPix(key){
 const value=String(key||'').trim();
 if(!value)return alert('Esta conta não possui chave PIX.');
 let copied=false;
 try{
  if(navigator.clipboard&&window.isSecureContext){
   await navigator.clipboard.writeText(value);
   copied=true;
  }
 }catch{}
 if(!copied){
  try{
   const ta=document.createElement('textarea');
   ta.value=value;
   ta.setAttribute('readonly','');
   ta.style.position='fixed';
   ta.style.left='-9999px';
   ta.style.top='0';
   document.body.appendChild(ta);
   ta.focus();
   ta.select();
   ta.setSelectionRange(0,value.length);
   copied=document.execCommand('copy');
   document.body.removeChild(ta);
  }catch{}
 }
 if(copied){
  const old=document.querySelector('.pixCopyNotice');
  if(old)old.remove();
  const n=document.createElement('div');
  n.className='pixCopyNotice';
  n.textContent='Chave PIX copiada';
  document.body.appendChild(n);
  setTimeout(()=>n.remove(),1800);
 }else{
  prompt('Copie a chave PIX:',value);
 }
}
const docFlag=v=>v===true||v===1||v==='1'||String(v).toLowerCase()==='true'||String(v).toLowerCase()==='t';
const pixText=x=>String(x?.pix_key||'').trim();
async function editPix(id){
 const bill=bills.find(x=>x.id===id);if(!bill)return;
 const type=prompt('Tipo da chave PIX: Email, Celular, CPF ou Aleatoria',bill.pix_type||'');
 if(type===null)return;
 const key=prompt('Chave PIX:',bill.pix_key||'');
 if(key===null)return;
 await api('/api/bills/'+id+'/pix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pixType:type,pixKey:key})});
 await load();
}
let todas=[];
async function load(){todas=await api('/api/bills');render();}
async function moverConta(id){
 const x=todas.find(b=>b.id===id);if(!x)return;
 const destino=tipoDa(x)==='pessoal'?'Empresa':'Pessoal';
 const rec=x.recurrence_group&&todas.filter(b=>b.recurrence_group===x.recurrence_group).length>1;
 if(!confirm('Mover "'+tc(x.description)+'" para '+destino+'?'))return;
 const tudo=rec&&confirm('Mover também as outras parcelas desta recorrência?');
 await api('/api/bills/'+id+'/area',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area:destino,applyToRecurrence:!!tudo})});
 await load();
}
function pendingFiltered(){
 const p=bills.filter(x=>x.status!=='paid');
 return until?p.filter(x=>String(x.due_date||'').slice(0,10)<=until):p;
}
function visibleBills(){
 if(!until)return [...bills];
 return pendingFiltered();
}
function recurrenceCount(x){
 if(!x?.recurrence_group)return 1;
 return todas.filter(b=>b.recurrence_group===x.recurrence_group).length;
}
function render(){
 bills=doTipo(todas);
 document.querySelectorAll('.tipoBtn').forEach(b=>b.classList.toggle('on',b.dataset.tipo===tipo));
 const nP=todas.filter(x=>x.status!=='paid'&&tipoDa(x)==='pessoal').length,nE=todas.filter(x=>x.status!=='paid'&&tipoDa(x)==='empresa').length;
 $('#tipoNEmpresa').textContent='('+nE+' em aberto)';$('#tipoNPessoal').textContent='('+nP+' em aberto)';
 const t=today(),cm=t.slice(0,7),pending=bills.filter(x=>x.status!=='paid'),overdue=pending.filter(x=>String(x.due_date).slice(0,10)<t),month=bills.filter(x=>String(x.due_date).slice(0,7)===cm),paidMonth=bills.filter(x=>x.status==='paid'&&x.payment_date&&String(x.payment_date).slice(0,7)===cm),filtered=pendingFiltered().sort(maisNovaPrimeiro),visible=visibleBills().sort(maisNovaPrimeiro),marcadas=filtered.filter(x=>!semImprimir.has(String(x.id))),totalMarcadas=money(marcadas.reduce((s,x)=>s+Number(x.amount),0));
 $('#cardPending').textContent=money(pending.reduce((s,x)=>s+Number(x.amount),0));$('#cardOverdue').textContent=money(overdue.reduce((s,x)=>s+Number(x.amount),0));$('#cardMonth').textContent=money(month.reduce((s,x)=>s+Number(x.amount),0));$('#cardPaidMonth').textContent=money(paidMonth.reduce((s,x)=>s+Number(x.amount),0));
 $('#filterLabel').textContent=until?'Em aberto até '+fmt(until):'Todas as contas em aberto';$('#filterTotal').textContent=money(filtered.reduce((s,x)=>s+Number(x.amount),0));$('#filterCount').textContent=filtered.length+' conta(s)';
 $('#printFilterLabel').textContent=(tipo==='todas'?'':(tipo==='pessoal'?'Contas pessoais • ':'Contas da empresa • '))+(until?'Vencimentos até '+fmt(until):'Todas as contas em aberto');$('#printTotal').innerHTML='Valor total: '+totalMarcadas+' <span class="printCount">('+marcadas.length+' conta(s))</span>'+(marcadas.length<filtered.length?'<span class="noPrint printHint"> • '+(filtered.length-marcadas.length)+' desmarcada(s) não sairão na impressão</span>':'');
 $('#selPrintAll').checked=filtered.length>0&&marcadas.length===filtered.length;$('#selPrintAll').indeterminate=marcadas.length>0&&marcadas.length<filtered.length;
 $('#reportBody').innerHTML=filtered.map(x=>{
   const due=String(x.due_date||'').slice(0,10),ov=x.status!=='paid'&&due<t,st=x.status==='paid'?'Pago':ov?'Vencido':'Pendente',cl=x.status==='paid'?'ok':ov?'late':'wait';
   const p=pixText(x);
   const pix=p
     ?'<span class="detailItem"><b>PIX '+esc(x.pix_type||'')+':</b> <span class="reportPixKey">'+esc(p)+'</span> <button type="button" class="reportCopyLink" onclick="copyPix('+JSON.stringify(p)+')">Copiar</button></span>'
     :'';
   const boleto=docFlag(x.has_boleto)
     ?'<button type="button" class="reportDocLink" onclick="openDocument(\''+x.id+'\',\'boleto\')">Boleto</button>'
     :'';
   const comp=docFlag(x.has_comprovante)
     ?'<button type="button" class="reportDocLink" onclick="openDocument(\''+x.id+'\',\'comprovante\')">Comprovante</button>'
     :'';
   const rec=x.recurrence_group?'<span class="detailItem"><b>Recorrência:</b> '+recurrenceCount(x)+' parcelas</span>':'';
   const docs=[boleto,comp].filter(Boolean).join('<span class="dotSep">•</span>');
   const sel=!semImprimir.has(String(x.id)),fora=sel?'':' naoImprime';
   return `<tr class="reportMainRow${fora}"><td class="check"><input type="checkbox" class="selPrint noPrint" data-id="${esc(String(x.id))}" title="Imprimir esta conta"${sel?' checked':''}><span class="printOnly">☐</span></td><td><b>${fmt(due)}</b></td><td><b>${esc(tc(x.description))}</b><div class="subInfo">${esc(tc(x.supplier||'-'))}</div></td><td><b>${money(x.amount)}</b></td><td><span class="badge ${cl}">${st}</span></td></tr>
   <tr class="reportDetailRow${fora}"><td></td><td colspan="4"><div class="detailLine"><span class="detailItem"><b>${esc(tc(x.area||'Geral'))}</b> • ${esc(tc(x.category||'-'))}</span>${pix}${rec}${docs?'<span class="detailItem docLinks">'+docs+'</span>':''}</div></td></tr>`
 }).join('')||'<tr><td colspan="5">Nenhuma conta em aberto para o filtro informado.</td></tr>';
 $('#billsBody').innerHTML=visible.map(x=>{
  const due=String(x.due_date).slice(0,10),ov=x.status!=='paid'&&due<t,st=x.status==='paid'?'Pago':ov?'Vencido':'Pendente',cl=x.status==='paid'?'ok':ov?'late':'wait';
  const currentPix=pixText(x);
  const pix=currentPix
    ?'<span class="detailItem"><b>PIX '+esc(x.pix_type||'')+':</b> <span class="wrapText">'+esc(currentPix)+'</span> <button class="linkBtn" onclick="copyPix('+JSON.stringify(currentPix)+')">Copiar</button></span>'
    :'';
  const boleto=docFlag(x.has_boleto)
    ?'<button class="linkBtn" onclick="openDocument(\''+x.id+'\',\'boleto\')">Boleto</button>'
    :'';
  const comp=docFlag(x.has_comprovante)
    ?'<button class="linkBtn" onclick="openDocument(\''+x.id+'\',\'comprovante\')">Comprovante</button>'
    :'';
  const docs=[boleto,comp].filter(Boolean).join('<span class="dotSep">•</span>');
  const rec=x.recurrence_group
    ?'<span class="detailItem"><b>Recorrente:</b> '+recurrenceCount(x)+' parcelas</span>'
    :'<span class="detailItem mutedPay">Avulsa</span>';
  return `<tr class="accountMainRow">
    <td data-label="Vencimento"><b>${fmt(due)}</b></td>
    <td data-label="Conta / Fornecedor"><b>${esc(tc(x.description))}</b><div class="subInfo">${esc(tc(x.supplier||'-'))}</div>${Number(x.postponed_count)>0?'<div class="mini">Prorrogado '+Number(x.postponed_count)+'x</div>':''}</td>
    <td data-label="Valor"><b>${money(x.amount)}</b></td>
    <td data-label="Status"><span class="badge ${cl}">${st}</span></td>
    <td data-label="Ações"><div class="actions"><button class="btn edit miniBtn" onclick="openEditBill('${x.id}')">Alterar</button>${x.status!=='paid'?`<button class="btn pay miniBtn" onclick="payBill('${x.id}')">Pagar</button><button class="btn postpone miniBtn" onclick="openPostpone('${x.id}')">Prorrogar</button>`:''}<button class="btn del miniBtn" onclick="deleteBill('${x.id}')">Excluir</button></div></td>
  </tr>
  <tr class="accountDetailRow">
    <td></td>
    <td colspan="4"><div class="detailLine"><span class="detailItem"><span class="tipoTag ${tipoDa(x)}">${tipoDa(x)==='pessoal'?'Pessoal':'Empresa'}</span> <b>${esc(tc(x.area||'Geral'))}</b> • ${esc(tc(x.category||'-'))} <button class="linkBtn" onclick="moverConta('${x.id}')">Mover para ${tipoDa(x)==='pessoal'?'Empresa':'Pessoal'}</button></span>${pix}${rec}${docs?'<span class="detailItem docLinks">'+docs+'</span>':''}</div></td>
  </tr>`
 }).join('')||(until?'<tr><td colspan="5" class="empty">Nenhuma conta em aberto até '+fmt(until)+'.</td></tr>':'<tr><td colspan="5" class="empty">Nenhuma Conta Cadastrada.</td></tr>');
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
  form.reset();areaPadrao();$('#dueDate').value=today();document.querySelectorAll('.recDate').forEach(x=>x.value='');$('#recSummary').textContent='Nenhuma data adicional';
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
$('#viewReportBtn').onclick=()=>{$('#reportBox').classList.add('screenVisible');$('#reportBox').scrollIntoView({behavior:'smooth',block:'start'});};
$('#closeReportBtn').onclick=()=>$('#reportBox').classList.remove('screenVisible');
$('#printBtn').onclick=()=>{if(pendingFiltered().length&&pendingFiltered().every(x=>semImprimir.has(String(x.id))))return alert('Marque ao menos uma conta para imprimir.');window.print();};
$('#reportBody').addEventListener('change',e=>{const c=e.target.closest('.selPrint');if(!c)return;c.checked?semImprimir.delete(c.dataset.id):semImprimir.add(c.dataset.id);render();});
$('#selPrintAll').onchange=e=>{pendingFiltered().forEach(x=>e.target.checked?semImprimir.delete(String(x.id)):semImprimir.add(String(x.id)));render();};

function openEditBill(id){
 const x=bills.find(v=>v.id===id);if(!x)return;
 $('#editBillId').value=id;
 $('#editBillTitle').innerHTML='<b>'+esc(tc(x.description))+'</b><div>'+fmt(x.due_date)+' • '+money(x.amount)+(x.recurrence_group?' • Conta recorrente':'')+'</div>';
 $('#editPixType').value=x.pix_type||'';
 $('#editPixKey').value=x.pix_key||'';
 $('#editBoletoFile').value='';
 $('#editComprovanteFile').value='';
 $('#applyPixRecurrence').checked=false;
 $('#applyRecurrenceWrap').style.display=x.recurrence_group?'flex':'none';
 const docs=[];
 if(x.has_boleto)docs.push('<button type="button" class="btn secondary miniBtn" onclick="openDocument(\''+x.id+'\',\'boleto\')">Ver boleto atual</button>');
 if(x.has_comprovante)docs.push('<button type="button" class="btn secondary miniBtn" onclick="openDocument(\''+x.id+'\',\'comprovante\')">Ver comprovante atual</button>');
 $('#editExistingDocs').innerHTML=docs.join('')||'<span class="hint">Nenhum documento anexado nesta parcela.</span>';
 $('#editBillModal').showModal();
}
$('#cancelEditBill').onclick=()=>$('#editBillModal').close();
$('#saveEditBill').onclick=async()=>{
 const id=$('#editBillId').value,bill=bills.find(x=>x.id===id);if(!bill)return;
 const btn=$('#saveEditBill'),old=btn.textContent;btn.disabled=true;btn.textContent='Salvando...';
 try{
  await api('/api/bills/'+id+'/pix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   pixType:$('#editPixType').value,
   pixKey:$('#editPixKey').value.trim(),
   applyToRecurrence:!!bill.recurrence_group&&$('#applyPixRecurrence').checked
  })});
  const boleto=$('#editBoletoFile').files?.[0]||null,comp=$('#editComprovanteFile').files?.[0]||null;
  if(boleto)await sendDocument(id,'boleto',boleto);
  if(comp)await sendDocument(id,'comprovante',comp);
  $('#editBillModal').close();
  await load();
 }catch(e){alert(e.message)}
 finally{btn.disabled=false;btn.textContent=old}
};

async function payBill(id){if(!confirm('Marcar esta conta como paga?'))return;await api('/api/bills/'+id+'/pay',{method:'POST'});await load();}
async function deleteBill(id){if(!confirm('Excluir esta conta?'))return;await api('/api/bills/'+id,{method:'DELETE'});await load();}
function openPostpone(id){const x=bills.find(v=>v.id===id);if(!x)return;$('#postponeId').value=id;$('#postponeDesc').textContent=tc(x.description)+' — vencimento atual: '+fmt(x.due_date);$('#postponeDate').value=String(x.due_date).slice(0,10);$('#postponeModal').showModal();}
$('#cancelPostpone').onclick=()=>$('#postponeModal').close();$('#confirmPostpone').onclick=async()=>{const id=$('#postponeId').value,newDueDate=$('#postponeDate').value;if(!newDueDate)return alert('Informe a nova data.');await api('/api/bills/'+id+'/postpone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newDueDate})});$('#postponeModal').close();await load();};
// conta nova entra no lado que está aberto (o campo Área continua editável)
function areaPadrao(){const i=document.querySelector('#billForm [name=area]');if(i&&['','Pessoal','Empresa'].includes(i.value)&&tipo!=='todas')i.value=tipo==='pessoal'?'Pessoal':'Empresa'}
document.querySelectorAll('.tipoBtn').forEach(b=>b.onclick=()=>{tipo=b.dataset.tipo;try{localStorage.setItem('contas_tipo',tipo)}catch{}areaPadrao();render()});
areaPadrao();
window.moverConta=moverConta;window.payBill=payBill;window.deleteBill=deleteBill;window.openPostpone=openPostpone;window.openDocument=openDocument;window.chooseDocument=chooseDocument;window.copyPix=copyPix;window.editPix=editPix;window.openEditBill=openEditBill;
load().catch(e=>{console.error(e);$('#billsBody').innerHTML='<tr><td colspan="5" class="empty">Erro ao carregar. Verifique o banco de dados.</td></tr>';});
