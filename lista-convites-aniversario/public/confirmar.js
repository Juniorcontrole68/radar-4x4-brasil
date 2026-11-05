const $=s=>document.querySelector(s);const id=new URLSearchParams(location.search).get('id');let INV;
async function api(url,opts={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});if(!r.ok)throw new Error((await r.json()).error||'Erro');return r.json()}
function fmtDate(d){return d?new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}):''}
function friendlyMessage(t=''){return String(t).replace(/ter você comigo/gi,'ter você conosco').replace(/ter voce comigo/gi,'ter voce conosco')}
function renderNameFields(count){
  const box=$('#namesBox');box.innerHTML='';
  const old=INV?.guest?.attendees||[];
  for(let i=0;i<count;i++){
    const label=document.createElement('label');
    label.textContent='Nome da pessoa '+(i+1);
    const input=document.createElement('input');
    input.className='attendeeName';
    input.placeholder=i===0?'Ex.: João':'Ex.: Maria';
    input.value=old[i]||'';
    input.required=true;
    label.append(input);box.append(label);
  }
}
async function load(){if(!id)throw new Error('Convite inválido');INV=await api('/api/invite/'+id);const e=INV.event,g=INV.guest;$('#title').textContent=e.title||'Convite';$('#hello').textContent=`Olá, ${g.name}! Vai ser muito legal ter você conosco.`;$('#details').innerHTML=[e.date?`📅 ${fmtDate(e.date)}`:'',e.time?`⏰ ${e.time}`:'',e.venue?`📍 ${e.venue}`:'',e.address?e.address:''].filter(Boolean).join('<br>');$('#message').textContent=friendlyMessage(e.message||'');if(e.hasInviteImage){$('#inviteImage').src='/api/invite-image?t='+Date.now();$('#inviteImageWrap').classList.remove('hidden')}if(e.canvaUrl){$('#canvaLink').href=e.canvaUrl;$('#canvaWrap').classList.remove('hidden')}$('#qty').removeAttribute('max');$('#qty').value=g.confirmed||g.invited||1;renderNameFields(Number($('#qty').value||1));if(g.status==='confirmado')showThanks(`Presença já confirmada para ${g.confirmed} pessoa(s): ${(g.attendees||[]).join(', ')||'nomes não informados'}. Obrigado! 🎉`);if(g.status==='talvez')showThanks('Você marcou que ainda não consegue responder. Quando decidir, abra este link novamente. 😊');if(g.status==='nao-vai')showThanks('Resposta registrada. Obrigado por nos avisar!')}
function showThanks(t){$('#responseBox').classList.add('hidden');$('#thanks').classList.remove('hidden');$('#thanks').textContent=t}
$('#yes').onclick=()=>{$('#qtyBox').classList.remove('hidden');renderNameFields(Math.max(1,Math.floor(Number($('#qty').value||1))))};
$('#qty').oninput=()=>renderNameFields(Math.max(1,Math.floor(Number($('#qty').value||1))));
$('#maybe').onclick=async()=>{await api('/api/invite/'+id+'/respond',{method:'POST',body:JSON.stringify({response:'maybe'})});showThanks('Sem problema! Quando conseguir decidir, é só abrir este link novamente. 😊')};
$('#no').onclick=async()=>{await api('/api/invite/'+id+'/respond',{method:'POST',body:JSON.stringify({response:'no'})});showThanks('Resposta registrada. Obrigado por nos avisar!')};
$('#confirm').onclick=async()=>{const q=Math.max(1,Math.floor(Number($('#qty').value||1)));const attendees=[...document.querySelectorAll('.attendeeName')].map(x=>x.value.trim()).filter(Boolean);if(attendees.length!==q){alert('Preencha o nome de todas as pessoas que irão.');return;}await api('/api/invite/'+id+'/respond',{method:'POST',body:JSON.stringify({response:'yes',confirmed:q,attendees})});showThanks(`Presença confirmada para ${q} pessoa(s): ${attendees.join(', ')}. Esperamos vocês! 🎉`)};
load().catch(e=>{document.body.innerHTML=`<main class="inviteCard"><h1>Convite não encontrado</h1><p>${e.message}</p></main>`});