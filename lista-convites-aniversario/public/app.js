let DATA={event:{},guests:[]};let NEW_IMAGE_DATA=null;let REMOVE_IMAGE=false;
const $=s=>document.querySelector(s);
const statusLabel={pendente:'Não enviado',enviado:'Aguardando',confirmado:'Confirmado','nao-vai':'Não vai'};
async function api(url,opts={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},cache:'no-store',...opts});if(!r.ok){let j={};try{j=await r.json()}catch{}throw new Error(j.error||'Erro')}return r.json()}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fmtDate(d){if(!d)return'';return new Date(d+'T12:00:00').toLocaleDateString('pt-BR')}
function normalizeContactPhone(value){let digits=String(value||'').replace(/\D/g,'');if(digits.startsWith('00'))digits=digits.slice(2);if(digits.startsWith('55')&&(digits.length===12||digits.length===13))digits=digits.slice(2);return digits}
function render(){
 const g=DATA.guests;
 $('#pageTitle').textContent=DATA.event.title||'Lista de Convites';
 $('#eventInfo').textContent=[fmtDate(DATA.event.date),DATA.event.time,DATA.event.venue].filter(Boolean).join(' • ');
 $('#cConvites').textContent=g.length;
 $('#cPessoas').textContent=g.reduce((a,x)=>a+Number(x.invited||0),0);
 $('#cConfirmadas').textContent=g.filter(x=>x.status==='confirmado').reduce((a,x)=>a+Number(x.confirmed||0),0);
 $('#cAguardando').textContent=g.filter(x=>['pendente','enviado'].includes(x.status)).reduce((a,x)=>a+Number(x.invited||0),0);
 $('#cNao').textContent=g.filter(x=>x.status==='nao-vai').reduce((a,x)=>a+Number(x.invited||0),0);
 const q=$('#search').value.toLowerCase(),sf=$('#statusFilter').value;
 const list=g.filter(x=>(!q||x.name.toLowerCase().includes(q)||(x.phone||'').includes(q))&&(!sf||x.status===sf));
 $('#empty').style.display=list.length?'none':'block';
 $('#tbody').innerHTML=list.map(x=>`<tr><td><strong>${esc(x.name)}</strong><br><small>${esc(x.phone||'Sem WhatsApp')}</small></td><td>${x.invited}</td><td><span class="badge b-${x.status}">${statusLabel[x.status]||x.status}</span></td><td>${x.confirmed==null?'—':x.confirmed}</td><td><div class="actions">${x.phone?`<button class="wa mini" onclick="sendWa('${x.id}')">WhatsApp</button>`:''}<button class="ghost mini" onclick="editGuest('${x.id}')">Editar</button><button class="ghost mini" onclick="removeGuest('${x.id}')">Excluir</button></div></td></tr>`).join('');
}
async function load(){DATA=await api('/api/data');render()}
$('#search').oninput=render;$('#statusFilter').onchange=render;$('#addGuest').onclick=()=>openGuest();

function resetContactPicker(){if($('#contactNumberWrap'))$('#contactNumberWrap').hidden=true;if($('#contactHint'))$('#contactHint').textContent=''}
function syncInvitedChoice(){const c=$('#invitedChoice');if(!c)return;const manual=c.value==='more';$('#invited').hidden=!manual;$('#invited').disabled=!manual;$('#invited').required=manual;if(!manual)$('#invited').value=c.value}
$('#invitedChoice').onchange=()=>{syncInvitedChoice();if($('#invitedChoice').value==='more'){$('#invited').value='';$('#invited').focus()}};
function openGuest(g=null){
 resetContactPicker();$('#guestTitle').textContent=g?'Editar convidado':'Novo convidado';$('#guestId').value=g?.id||'';$('#name').value=g?.name||'';$('#phone').value=g?.phone||'';
 const n=Number(g?.invited||1);$('#invitedChoice').value=n>5?'more':String(n);$('#invited').value=n;syncInvitedChoice();
 $('#confirmed').value=g?.confirmed??'';$('#note').value=g?.note||'';$('#guestDlg').showModal();
}
window.editGuest=id=>openGuest(DATA.guests.find(x=>x.id===id));

$('#selectContact').onclick=async()=>{
 const hint=$('#contactHint');resetContactPicker();
 if(!navigator.contacts||typeof navigator.contacts.select!=='function'){hint.textContent='Abra no Chrome do Android para selecionar um contato, ou digite o WhatsApp.';return}
 try{
  const contacts=await navigator.contacts.select(['name','tel'],{multiple:false});const c=contacts[0];if(!c)return;
  const nums=[...new Set((c.tel||[]).map(normalizeContactPhone).filter(n=>/^\d{10,11}$/.test(n)))];
  if(c.name?.[0])$('#name').value=c.name[0];if(!nums.length){hint.textContent='Esse contato não tem número válido com DDD.';return}
  $('#phone').value=nums[0];
  if(nums.length>1){const s=$('#contactNumber');s.replaceChildren();nums.forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;s.append(o)});$('#contactNumberWrap').hidden=false;s.onchange=()=>$('#phone').value=s.value}
 }catch(e){if(e.name!=='AbortError')hint.textContent='Não foi possível abrir a agenda.'}
};

$('#saveGuest').onclick=async()=>{
 const invited=Number($('#invited').value);const minimum=$('#invitedChoice').value==='more'?6:1;
 if(!Number.isInteger(invited)||invited<minimum)return alert($('#invitedChoice').value==='more'?'Informe 6 pessoas ou mais.':'Informe a quantidade de pessoas.');
 const id=$('#guestId').value;const body={name:$('#name').value,phone:$('#phone').value,invited,note:$('#note').value};
 if($('#confirmed').value!==''){body.confirmed=Number($('#confirmed').value);body.status=body.confirmed>0?'confirmado':'nao-vai'}
 if(id)await api('/api/guests/'+id,{method:'PUT',body:JSON.stringify(body)});else await api('/api/guests',{method:'POST',body:JSON.stringify(body)});
 $('#guestDlg').close();await load();
};
window.removeGuest=async id=>{if(confirm('Excluir este convidado?')){await api('/api/guests/'+id,{method:'DELETE'});await load()}};

async function shareInviteImage(e){
 if(!e.hasInviteImage)return false;
 const r=await fetch('/api/invite-image?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('Não foi possível carregar a imagem do convite.');
 const blob=await r.blob();const ext=(blob.type||'image/jpeg').includes('png')?'png':'jpg';
 const file=new File([blob],`convite-carol-junior.${ext}`,{type:blob.type||'image/jpeg'});
 if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
   await navigator.share({files:[file],title:'Convite de aniversário'});
   return true;
 }
 throw new Error('Este navegador não permite compartilhar a foto diretamente. Abra o app no Chrome do celular.');
}

window.sendWa=async id=>{
 const g=DATA.guests.find(x=>x.id===id);if(!g?.phone)return;
 const e=DATA.event;const when=[e.date?fmtDate(e.date):'',e.time?`às ${e.time}`:''].filter(Boolean).join(' ');
 const cleanMessage=String(e.message||'').replace(/ter você comigo/gi,'ter você conosco').replace(/ter voce comigo/gi,'ter voce conosco');
 const confirmLink=`${location.origin}/confirmar.html?id=${encodeURIComponent(g.id)}`;
 const canva=e.canvaUrl?`\n\n🎨 Convite no Canva:\n${e.canvaUrl}`:'';
 const text=`Olá, ${g.name}! 🎉\n\nVocê está convidado para nosso aniversário — Junior e Carol${when?` — ${when}`:''}.${e.venue?`\n📍 ${e.venue}`:''}${e.address?` - ${e.address}`:''}\n\n${cleanMessage}${canva}\n\nConfirme sua presença aqui:\n${confirmLink}`;
 try{
   if(e.hasInviteImage)await shareInviteImage(e);
   await api('/api/guests/'+id+'/mark-sent',{method:'POST',body:'{}'});
   window.open(`https://wa.me/55${normalizeContactPhone(g.phone)}?text=${encodeURIComponent(text)}`,'_blank');
   await load();
 }catch(err){alert(err.message)}
};

$('#editEvent').onclick=()=>{
 const e=DATA.event;NEW_IMAGE_DATA=null;REMOVE_IMAGE=false;$('#evInviteImage').value='';
 $('#evTitle').value=e.title||'';$('#evDate').value=e.date||'';$('#evTime').value=e.time||'';$('#evVenue').value=e.venue||'';$('#evAddress').value=e.address||'';$('#evMessage').value=e.message||'';$('#evCanvaUrl').value=e.canvaUrl||'';
 if(e.hasInviteImage){$('#imagePreview').src='/api/invite-image?t='+Date.now();$('#imagePreviewWrap').classList.remove('hidden')}else $('#imagePreviewWrap').classList.add('hidden');
 $('#eventDlg').showModal();
};
$('#evInviteImage').onchange=()=>{const f=$('#evInviteImage').files[0];if(!f)return;if(!f.type.startsWith('image/'))return alert('Escolha uma imagem válida.');if(f.size>2*1024*1024)return alert('A imagem deve ter no máximo 2 MB.');const rd=new FileReader();rd.onload=()=>{NEW_IMAGE_DATA=rd.result;REMOVE_IMAGE=false;$('#imagePreview').src=rd.result;$('#imagePreviewWrap').classList.remove('hidden')};rd.readAsDataURL(f)};
$('#removeInviteImage').onclick=()=>{NEW_IMAGE_DATA=null;REMOVE_IMAGE=true;$('#evInviteImage').value='';$('#imagePreviewWrap').classList.add('hidden')};
$('#saveEvent').onclick=async()=>{
 const body={title:$('#evTitle').value,date:$('#evDate').value,time:$('#evTime').value,venue:$('#evVenue').value,address:$('#evAddress').value,message:$('#evMessage').value,canvaUrl:$('#evCanvaUrl').value.trim()};
 if(NEW_IMAGE_DATA)body.inviteImageData=NEW_IMAGE_DATA;if(REMOVE_IMAGE)body.removeInviteImage=true;
 await api('/api/event',{method:'PUT',body:JSON.stringify(body)});$('#eventDlg').close();await load();
};

let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e});
$('#installApp').onclick=async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null}else alert('No Android: Chrome → menu → Adicionar à tela inicial ou Instalar app.')};
$('#shareApp').onclick=async()=>{const d={title:'Lista de Convites',text:'Abra este app para ajudar a organizar a lista de convidados.',url:location.origin};try{if(navigator.share)await navigator.share(d);else window.open('https://wa.me/?text='+encodeURIComponent(d.text+'\n'+d.url),'_blank')}catch{}};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js?v=20261005-2').catch(()=>{}));
load().catch(e=>alert(e.message));