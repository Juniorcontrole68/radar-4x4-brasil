const $=s=>document.querySelector(s);const id=new URLSearchParams(location.search).get('id');let INV;
async function api(url,opts={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},cache:'no-store',...opts});if(!r.ok){let j={};try{j=await r.json()}catch{}throw new Error(j.error||'Erro')}return r.json()}
function fmtDate(d){return d?new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}):''}
function friendlyMessage(t=''){return String(t).replace(/ter você comigo/gi,'ter você conosco').replace(/ter voce comigo/gi,'ter voce conosco')}
async function load(){
 if(!id)throw new Error('Convite inválido');
 INV=await api('/api/invite/'+id);const e=INV.event,g=INV.guest;
 $('#title').textContent=e.title||'Convite';$('#hello').textContent=`Olá, ${g.name}! Vai ser muito legal ter você conosco.`;
 $('#details').innerHTML=[e.date?`📅 ${fmtDate(e.date)}`:'',e.time?`⏰ ${e.time}`:'',e.venue?`📍 ${e.venue}`:'',e.address||''].filter(Boolean).join('<br>');
 $('#message').textContent=friendlyMessage(e.message||'');
 if(e.hasInviteImage){$('#inviteImage').src='/api/invite-image?t='+Date.now();$('#inviteImageWrap').classList.remove('hidden')}
 if(e.canvaUrl){$('#canvaLink').href=e.canvaUrl;$('#canvaWrap').classList.remove('hidden')}
 $('#qty').removeAttribute('max');$('#qty').value=g.confirmed||g.invited||1;
 if(g.status==='confirmado')showThanks(`Presença já confirmada para ${g.confirmed} pessoa(s). Obrigado! 🎉`);
 if(g.status==='nao-vai')showThanks('Resposta registrada. Obrigado por nos avisar!');
}
function showThanks(t){$('#responseBox').classList.add('hidden');$('#thanks').classList.remove('hidden');$('#thanks').textContent=t}
$('#yes').onclick=()=>{$('#qtyBox').classList.remove('hidden')};
$('#maybe').onclick=async()=>{await api('/api/invite/'+id+'/respond',{method:'POST',body:JSON.stringify({response:'maybe'})});showThanks('Sem problema! Quando decidir, abra este convite novamente. 😊')};
$('#no').onclick=async()=>{await api('/api/invite/'+id+'/respond',{method:'POST',body:JSON.stringify({response:'no'})});showThanks('Resposta registrada. Obrigado por nos avisar!')};
$('#confirm').onclick=async()=>{const q=Math.max(1,Number($('#qty').value||1));await api('/api/invite/'+id+'/respond',{method:'POST',body:JSON.stringify({response:'yes',confirmed:q})});showThanks(`Presença confirmada para ${q} pessoa(s). Esperamos vocês! 🎉`)};
load().catch(e=>{document.body.innerHTML=`<main class="inviteCard"><h1>Convite não encontrado</h1><p>${e.message}</p></main>`});