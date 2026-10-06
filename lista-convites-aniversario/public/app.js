let DATA={event:{},guests:[]};let NEW_IMAGE_DATA=null;let REMOVE_IMAGE=false;let NEW_EXTRA_IMAGE_DATA=null;let REMOVE_EXTRA_IMAGE=false;
const $=s=>document.querySelector(s);const statusLabel={pendente:'Não enviado',enviado:'Aguardando',talvez:'Ainda não sabe',confirmado:'Confirmado','nao-vai':'Não vai'};
async function api(url,opts={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});if(!r.ok)throw new Error((await r.json()).error||'Erro');return r.json()}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fmtDate(d){if(!d)return'';return new Date(d+'T12:00:00').toLocaleDateString('pt-BR')}
function render(){const g=DATA.guests;$('#pageTitle').textContent=DATA.event.title||'Lista de Convites';const info=[fmtDate(DATA.event.date),DATA.event.time,DATA.event.venue].filter(Boolean).join(' • ');$('#eventInfo').textContent=info;
$('#cConvites').textContent=g.length;$('#cPessoas').textContent=g.reduce((a,x)=>a+Number(x.invited||0),0);$('#cConfirmadas').textContent=g.filter(x=>x.status==='confirmado').reduce((a,x)=>a+Number(x.confirmed||0),0);$('#cAguardando').textContent=g.filter(x=>['pendente','enviado','talvez'].includes(x.status)).reduce((a,x)=>a+Number(x.invited||0),0);$('#cNao').textContent=g.filter(x=>x.status==='nao-vai').reduce((a,x)=>a+Number(x.invited||0),0);
const q=$('#search').value.toLowerCase(),sf=$('#statusFilter').value;const list=g.filter(x=>(!q||x.name.toLowerCase().includes(q)||x.phone.includes(q))&&(!sf||x.status===sf));$('#empty').style.display=list.length?'none':'block';$('#tbody').innerHTML=list.map(x=>`<tr><td><strong>${esc(x.name)}</strong><br><small>${esc(x.phone||'Sem WhatsApp')}</small></td><td>${x.invited}</td><td><span class="badge b-${x.status}">${statusLabel[x.status]||x.status}</span></td><td>${x.confirmed==null?'—':x.confirmed}</td><td><div class="actions">${x.phone?`<button class="wa mini" onclick="sendWa('${x.id}')">WhatsApp</button><button class="ghost mini" onclick="sendInviteOnly('${x.id}')">Enviar convite separado</button>`:''}<button class="ghost mini" onclick="editGuest('${x.id}')">Editar</button><button class="ghost mini" onclick="removeGuest('${x.id}')">Excluir</button></div></td></tr>`).join('')}
async function load(){DATA=await api('/api/data');render()}
$('#search').oninput=render;$('#statusFilter').onchange=render;$('#addGuest').onclick=()=>openGuest();
function syncInvitedChoice(){const choice=$('#invitedChoice');if(!choice)return;const manual=choice.value==='more';$('#invited').hidden=!manual;$('#invited').disabled=!manual;$('#invited').required=manual;if(!manual)$('#invited').value=choice.value;}
if($('#invitedChoice'))$('#invitedChoice').onchange=()=>{syncInvitedChoice();if($('#invitedChoice').value==='more'){$('#invited').value='';$('#invited').focus();}};
function openGuest(g=null){resetContactPicker();$('#guestTitle').textContent=g?'Editar convidado':'Novo convidado';$('#guestId').value=g?.id||'';$('#name').value=g?.name||'';$('#phone').value=g?.phone||'';$('#invited').value=g?.invited||1;if($('#invitedChoice')){$('#invitedChoice').value=Number(g?.invited||1)>5?'more':String(g?.invited||1);syncInvitedChoice();}$('#confirmed').value=g?.confirmed??'';$('#note').value=g?.note||'';$('#guestDlg').showModal()}

function normalizeContactPhone(value){let digits=String(value||'').replace(/\D/g,'');if(digits.startsWith('00'))digits=digits.slice(2);if(digits.startsWith('55')&&(digits.length===12||digits.length===13))digits=digits.slice(2);return digits;}
function resetContactPicker(){const wrap=$('#contactNumberWrap');if(wrap)wrap.hidden=true;const hint=$('#contactHint');if(hint)hint.textContent='';}
const contactButton=$('#selectContact');
if(contactButton){
  contactButton.onclick=async()=>{
    const hint=$('#contactHint');
    resetContactPicker();
    if(!navigator.contacts||typeof navigator.contacts.select!=='function'){
      hint.textContent='Para selecionar um contato, abra este app no Chrome do celular Android. Você também pode copiar o número da agenda e colar no campo WhatsApp.';
      return;
    }
    contactButton.disabled=true;
    try{
      const contacts=await navigator.contacts.select(['name','tel'],{multiple:false});
      const contact=contacts[0];if(!contact)return;
      const numbers=[...new Set((contact.tel||[]).map(normalizeContactPhone).filter(n=>/^\d{10,11}$/.test(n)))];
      if(!numbers.length){hint.textContent='O contato não tem um número brasileiro válido com DDD. Selecione outro ou preencha o WhatsApp manualmente.';return;}
      if(contact.name?.[0])$('#name').value=contact.name[0];
      if(numbers.length===1){$('#phone').value=numbers[0];hint.textContent='Contato preenchido. Confira os dados e toque em Salvar.';}
      else{
        $('#phone').value=numbers[0];
        const select=$('#contactNumber');select.replaceChildren();
        numbers.forEach(number=>{const option=document.createElement('option');option.value=number;option.textContent=number;select.append(option)});
        $('#contactNumberWrap').hidden=false;
        select.value=numbers[0];
        hint.textContent='O primeiro número foi preenchido. Se ele não usa WhatsApp, escolha outro na lista acima.';
        const applyNumber=()=>{$('#phone').value=select.value;hint.textContent='Número preenchido. Confira os dados e toque em Salvar.';};select.onchange=applyNumber;select.oninput=applyNumber;
        select.focus();
      }
    }catch(error){
      if(error.name!=='AbortError')hint.textContent='Não foi possível abrir a agenda. Tente novamente no Chrome do Android ou preencha o WhatsApp manualmente.';
    }finally{contactButton.disabled=false;}
  };
}

window.editGuest=id=>openGuest(DATA.guests.find(x=>x.id===id));
$('#saveGuest').onclick=async()=>{const invited=Number($('#invited').value);const minimum=$('#invitedChoice')?.value==='more'?6:1;if(!Number.isInteger(invited)||invited<minimum){$('#invited').setCustomValidity('Informe um número inteiro de '+minimum+' pessoas ou mais.');$('#invited').reportValidity();$('#invited').setCustomValidity('');return;}const id=$('#guestId').value;const body={name:$('#name').value,phone:$('#phone').value,invited,note:$('#note').value};if($('#confirmed').value!==''){body.confirmed=Number($('#confirmed').value);body.status=body.confirmed>0?'confirmado':'nao-vai'};if(id)await api('/api/guests/'+id,{method:'PUT',body:JSON.stringify(body)});else await api('/api/guests',{method:'POST',body:JSON.stringify(body)});$('#guestDlg').close();await load()};
window.removeGuest=async id=>{if(confirm('Excluir este convidado?')){await api('/api/guests/'+id,{method:'DELETE'});await load()}};

window.sendWa=async id=>{
  const g=DATA.guests.find(x=>x.id===id);if(!g?.phone)return;
  const link=`${location.origin}/confirmar.html?id=${encodeURIComponent(g.id)}`;
  const e=DATA.event;
  const when=[e.date?fmtDate(e.date):'',e.time?`às ${e.time}`:''].filter(Boolean).join(' ');
  const cleanMessage=String(e.message||'').replace(/ter você comigo/gi,'ter você conosco').replace(/ter voce comigo/gi,'ter voce conosco');
  const text=`Olá, ${g.name}! 🎉\n\nVenha comemorar com a gente! Junior e Carol${when?` — ${when}`:''}.${e.venue?`\n📍 ${e.venue}`:''}${e.address?` - ${e.address}`:''}\n\n${cleanMessage}\n\nConfirme sua presença aqui:\n${link}`;
  await api('/api/guests/'+id+'/mark-sent',{method:'POST',body:'{}'});
  window.open(`https://wa.me/55${normalizeContactPhone(g.phone)}?text=${encodeURIComponent(text)}`,'_blank');
  await load();
};

window.sendInviteOnly=async id=>{
  const g=DATA.guests.find(x=>x.id===id);
  const e=DATA.event;
  if(!g?.phone)return;
  if(!e.hasInviteImage){
    alert('Ainda não há uma imagem do convite cadastrada.');
    return;
  }
  try{
    const files=[];
    const r1=await fetch('/api/invite-image?t='+Date.now());
    if(!r1.ok)throw new Error('Não foi possível carregar a imagem do convite.');
    const b1=await r1.blob();
    const ext1=b1.type.includes('png')?'png':b1.type.includes('webp')?'webp':'jpg';
    files.push(new File([b1],`convite-junior-carol.${ext1}`,{type:b1.type||'image/jpeg'}));

    if(e.hasExtraImage){
      const r2=await fetch('/api/extra-image?t='+Date.now());
      if(r2.ok){
        const b2=await r2.blob();
        const ext2=b2.type.includes('png')?'png':b2.type.includes('webp')?'webp':'jpg';
        files.push(new File([b2],`foto-extra.${ext2}`,{type:b2.type||'image/jpeg'}));
      }
    }

    if(navigator.share&&(!navigator.canShare||navigator.canShare({files}))){
      await navigator.share({files,title:'Convite de aniversário'});
      return;
    }

    for(const file of files){
      const url=URL.createObjectURL(file);
      const a=document.createElement('a');
      a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
    }
    alert(files.length===2?'As duas imagens foram salvas para você encaminhar pelo WhatsApp.':'A imagem do convite foi salva para você encaminhar pelo WhatsApp.');
  }catch(err){
    if(err?.name!=='AbortError')alert(err?.message||'Não foi possível preparar as imagens.');
  }
};
$('#editEvent').onclick=()=>{const e=DATA.event;NEW_IMAGE_DATA=null;REMOVE_IMAGE=false;NEW_EXTRA_IMAGE_DATA=null;REMOVE_EXTRA_IMAGE=false;$('#evInviteImage').value='';$('#evExtraImage').value='';$('#evTitle').value=e.title||'';$('#evDate').value=e.date||'';$('#evTime').value=e.time||'';$('#evVenue').value=e.venue||'';$('#evAddress').value=e.address||'';$('#evMessage').value=e.message||'';$('#evCanvaUrl').value=e.canvaUrl||'';if(e.hasInviteImage){$('#imagePreview').src='/api/invite-image?t='+Date.now();$('#imagePreviewWrap').classList.remove('hidden')}else{$('#imagePreviewWrap').classList.add('hidden')}if(e.hasExtraImage){$('#extraImagePreview').src='/api/extra-image?t='+Date.now();$('#extraImagePreviewWrap').classList.remove('hidden')}else{$('#extraImagePreviewWrap').classList.add('hidden')}$('#eventDlg').showModal()};
$('#evInviteImage').onchange=()=>{const f=$('#evInviteImage').files[0];if(!f)return;if(!f.type.startsWith('image/'))return alert('Escolha uma imagem válida.');if(f.size>2*1024*1024)return alert('A imagem deve ter no máximo 2 MB.');const rd=new FileReader();rd.onload=()=>{NEW_IMAGE_DATA=rd.result;REMOVE_IMAGE=false;$('#imagePreview').src=rd.result;$('#imagePreviewWrap').classList.remove('hidden')};rd.readAsDataURL(f)};
$('#removeInviteImage').onclick=()=>{NEW_IMAGE_DATA=null;REMOVE_IMAGE=true;$('#evInviteImage').value='';$('#imagePreviewWrap').classList.add('hidden')};
$('#evExtraImage').onchange=()=>{const f=$('#evExtraImage').files[0];if(!f)return;if(!f.type.startsWith('image/'))return alert('Escolha uma foto extra válida.');if(f.size>5*1024*1024)return alert('A foto extra deve ter no máximo 5 MB.');const rd=new FileReader();rd.onload=()=>{NEW_EXTRA_IMAGE_DATA=rd.result;REMOVE_EXTRA_IMAGE=false;$('#extraImagePreview').src=rd.result;$('#extraImagePreviewWrap').classList.remove('hidden')};rd.readAsDataURL(f)};
$('#removeExtraImage').onclick=()=>{NEW_EXTRA_IMAGE_DATA=null;REMOVE_EXTRA_IMAGE=true;$('#evExtraImage').value='';$('#extraImagePreviewWrap').classList.add('hidden')};
$('#saveEvent').onclick=async()=>{const body={title:$('#evTitle').value,date:$('#evDate').value,time:$('#evTime').value,venue:$('#evVenue').value,address:$('#evAddress').value,message:$('#evMessage').value,canvaUrl:$('#evCanvaUrl').value.trim()};if(NEW_IMAGE_DATA)body.inviteImageData=NEW_IMAGE_DATA;if(REMOVE_IMAGE)body.removeInviteImage=true;if(NEW_EXTRA_IMAGE_DATA)body.extraImageData=NEW_EXTRA_IMAGE_DATA;if(REMOVE_EXTRA_IMAGE)body.removeExtraImage=true;await api('/api/event',{method:'PUT',body:JSON.stringify(body)});$('#eventDlg').close();await load()};
load().catch(e=>alert(e.message));

let deferredInstallPrompt=null;
const installBtn=document.querySelector('#installApp');
const shareBtn=document.querySelector('#shareApp');

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  if(installBtn) installBtn.style.display='';
});
window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  if(installBtn) installBtn.textContent='✓ App instalado';
});
if(installBtn){
  installBtn.onclick=async()=>{
    if(deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt=null;
    }else{
      alert('No Android: abra no Chrome e use “Adicionar à tela inicial” ou “Instalar app”. No iPhone: Safari → Compartilhar → Adicionar à Tela de Início.');
    }
  };
}
if(shareBtn){
  shareBtn.onclick=async()=>{
    const shareData={
      title:'Lista de Convites',
      text:'Abra este app para ajudar a organizar a lista de convidados.',
      url:location.origin
    };
    try{
      if(navigator.share) await navigator.share(shareData);
      else window.open('https://wa.me/?text='+encodeURIComponent(shareData.text+'\n'+shareData.url),'_blank');
    }catch(e){}
  };
}
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
