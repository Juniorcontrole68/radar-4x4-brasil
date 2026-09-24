const DASH_SESSION_KEY='construlog_dashboard_session';
const DASH_EMBEDDED=new URLSearchParams(location.search).get('embed')==='1';
const PORTAL_ORIGIN='https://controle-coletas-jr.onrender.com';
let DASH_SESSION_TOKEN=String(window.__DASHBOARD_SESSION_TOKEN__||'');
let DASH_SESSION_USER=window.__DASHBOARD_SESSION_USER__||null;
try{
  if(DASH_SESSION_TOKEN)sessionStorage.setItem(DASH_SESSION_KEY,DASH_SESSION_TOKEN);
  try{delete window.__DASHBOARD_SESSION_TOKEN__}catch{}
  try{delete window.__DASHBOARD_SESSION_USER__}catch{}
}catch{}
try{
  const hp=new URLSearchParams(String(location.hash||'').replace(/^#/,''));
  const token=hp.get('cltoken')||'';
  if(token){
    DASH_SESSION_TOKEN=token;
    try{sessionStorage.setItem(DASH_SESSION_KEY,token)}catch{}
    hp.delete('cltoken');
    const rest=hp.toString();
    try{history.replaceState(null,'',location.pathname+location.search+(rest?'#'+rest:''))}catch{}
  }else{
    try{DASH_SESSION_TOKEN=sessionStorage.getItem(DASH_SESSION_KEY)||''}catch{}
  }
}catch{}
function setDashboardSessionToken(token){
  DASH_SESSION_TOKEN=String(token||'');
  try{
    if(DASH_SESSION_TOKEN)sessionStorage.setItem(DASH_SESSION_KEY,DASH_SESSION_TOKEN);
    else sessionStorage.removeItem(DASH_SESSION_KEY)
  }catch{}
}
const DASH_NATIVE_FETCH=window.fetch.bind(window);
window.fetch=function(input,init){
  const opts=init?Object.assign({},init):{};
  try{
    const raw=typeof input==='string'||input instanceof URL?String(input):(input&&input.url?input.url:'');
    const target=new URL(raw,location.href);
    if(DASH_SESSION_TOKEN&&target.origin===location.origin&&target.pathname.startsWith('/api/')){
      const headers=new Headers(opts.headers||(typeof Request!=='undefined'&&input instanceof Request?input.headers:undefined)||{});
      if(!headers.has('Authorization'))headers.set('Authorization','Bearer '+DASH_SESSION_TOKEN);
      opts.headers=headers;
      if(typeof Request!=='undefined'&&input instanceof Request)return DASH_NATIVE_FETCH(new Request(input,opts));
      return DASH_NATIVE_FETCH(input,opts)
    }
  }catch{}
  return DASH_NATIVE_FETCH(input,opts)
};


const PERMISSION_OPTIONS=[
  ['coletas','Controle de Coletas'],
  ['contas_pagar','Contas a Pagar'],
  ['dashboard','Dashboard principal'],
  ['ssw_saidas','SSW • Saídas x Baixas'],
  ['evolucao','Evolução e previsão por motorista'],
  ['cidade_destino','Entregas por cidade destino'],
  ['roteirizador','Roteirizador de romaneios'],
  ['final_carregamento','Final do carregamento'],
  ['operacional','Operacional / Entregas'],
  ['financeiro','Financeiro'],
  ['receita_ssw','Receita SSW'],
  ['motoristas','Motoristas'],
  ['filiais','Filiais'],
  ['agendamentos','Agendamentos'],
  ['ajudantes','Ajudantes e Conferentes'],
  ['rotas','Rotas e Produtividade'],
  ['ocorrencias','Ocorrências e SLA'],
  ['remetentes','Entregas por Cliente Remetente'],
  ['remetentes_comparativo','Comparativo de Clientes Remetentes'],
  ['ssw_atrasos','SSW • CT-es Atrasados'],
  ['bi2','SSW / BI2']
];
let AUTH=null;
function hasPerm(p){return !!(AUTH&&(AUTH.is_admin||AUTH.permissions?.includes('*')||AUTH.permissions?.includes(p)))}
function hasAnyPerm(list){return list.some(hasPerm)}
function tabAllowed(tab){
  const map={
    dashboard:'dashboard',operacoes:'operacional',conferencia:'final_carregamento',
    agendamentos:'agendamentos',ajudantes:'ajudantes',
    'ssw-motoristas':'ssw_saidas','motoristas-evolucao':'evolucao',
    'ssw-atrasos':'ssw_atrasos','ssw-remetentes':'remetentes',
    'ssw-remetentes-comparativo':'remetentes_comparativo','receita-ssw':'receita_ssw'
  };
  if(tab==='usuarios')return !!AUTH?.is_admin;
  if(tab==='roteirizador')return hasPerm('roteirizador');
  if(tab==='agendamentos-copia')return hasAnyPerm(['dashboard','agendamentos','agendamentos_copia']);
  if(tab==='dashboards')return AUTH?.is_admin||PERMISSION_OPTIONS.some(([p])=>hasPerm(p)&&p!=='dashboard');
  return map[tab]?hasPerm(map[tab]):false
}
function applyPermissions(){
  const navMap={dashboard:'dashboard',operacoes:'operacional',conferencia:'final_carregamento',agendamentos:'agendamentos',ajudantes:'ajudantes'};
  document.querySelectorAll('.nav button').forEach(b=>{
    let show=true;
    if(b.dataset.adminOnly==='1')show=!!AUTH?.is_admin;
    else if(b.dataset.tab==='dashboards')show=tabAllowed('dashboards');
    else if(b.dataset.tab==='agendamentos')show=hasPerm('agendamentos')&&!hasPerm('dashboard');
    else if(navMap[b.dataset.tab])show=hasPerm(navMap[b.dataset.tab]);
    b.style.display=show?'':'none';
  });

  const cardMap={
    'SSW • Saídas x Baixas':'ssw_saidas',
    'Evolução e Previsão por Motorista':'evolucao',
    'Entregas por Cidade Destino':'cidade_destino',
    'Final do Carregamento':'final_carregamento',
    'Operacional':'operacional',
    'Financeiro':'financeiro',
    'Receita SSW':'receita_ssw',
    'Motoristas':'motoristas',
    'Filiais':'filiais',
    'Agendamentos':'agendamentos',
    'Ajudantes e Conferentes':'ajudantes',
    'Rotas e Produtividade':'rotas',
    'Ocorrências e SLA':'ocorrencias',
    'Entregas por Cliente Remetente':'remetentes',
    'Comparativo de Clientes Remetentes':'remetentes_comparativo',
    'SSW • CT-es Atrasados':'ssw_atrasos',
    'SSW / BI2':'bi2'
  };
  document.querySelectorAll('#dashboards .dash-card').forEach(card=>{
    const title=card.querySelector('h3')?.textContent.trim()||'';
    const perm=cardMap[title];
    card.style.display=!perm||hasPerm(perm)?'':'none';
    card.querySelectorAll('.dash-open[data-open]').forEach(btn=>{
      btn.style.display=tabAllowed(btn.dataset.open)?'':'none';
    });
  });

  const cu=document.querySelector('#currentUser');
  if(cu)cu.textContent=AUTH?(AUTH.username+(AUTH.is_admin?' • Administrador':'')):'';
  const rb=document.querySelector('#routeTopBtn');
  if(rb)rb.style.display=hasPerm('roteirizador')?'':'none';
  const ub=document.querySelector('#usersTopBtn');
  if(ub)ub.style.display=AUTH?.is_admin?'':'none';
}
function firstAllowedTab(){
  const btn=[...document.querySelectorAll('.nav button')].find(b=>b.style.display!=='none'&&tabAllowed(b.dataset.tab));
  return btn?.dataset.tab||(hasPerm('roteirizador')?'roteirizador':null)
}
function whatsappShare(username=''){
  const msg=username
    ?'Acesso ao CONSTRULOG\nSite: '+location.origin+'\nUsuário: '+username+'\nA senha será informada separadamente.'
    :'Acesso ao CONSTRULOG\n'+location.origin;
  window.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank','noopener')
}
function renderPermissionOptions(){
  const box=document.querySelector('#userPermGrid');if(!box)return;
  box.innerHTML=PERMISSION_OPTIONS.map(([id,label])=>'<label class="perm-item"><input type="checkbox" value="'+id+'"> <span>'+label+'</span></label>').join('')
}
function resetUserForm(){
  const f=document.querySelector('#userForm');if(!f)return;
  f.reset();
  document.querySelector('#userEditId').value='';
  document.querySelector('#userActive').checked=true;
  document.querySelectorAll('#userPermGrid input[type=checkbox]').forEach(x=>x.checked=false);
  const m=document.querySelector('#userAdminMsg');if(m)m.textContent=''
}
function editDashboardUser(id){
  const u=(window.__dashboardUsers||[]).find(x=>String(x.id)===String(id));if(!u)return;
  document.querySelector('#userEditId').value=u.id;
  document.querySelector('#userName').value=u.username||'';
  document.querySelector('#userPassword').value='';
  document.querySelector('#userActive').checked=u.active!==false;
  const set=new Set(u.permissions||[]);
  document.querySelectorAll('#userPermGrid input[type=checkbox]').forEach(x=>x.checked=u.is_admin||set.has(x.value));
  document.querySelector('#userAdminMsg').textContent=u.is_admin?'Conta administradora: acesso total.':'Editando '+u.username;
  document.querySelector('#userName').scrollIntoView({behavior:'smooth',block:'center'})
}
function renderDashboardUsers(rows){
  window.__dashboardUsers=rows;
  const box=document.querySelector('#userList');if(!box)return;
  if(!rows.length){box.innerHTML='<div class="muted">Nenhum usuário cadastrado.</div>';return}
  box.innerHTML=rows.map(u=>{
    const perms=u.is_admin?'Acesso total':((u.permissions||[]).map(p=>(PERMISSION_OPTIONS.find(x=>x[0]===p)||[p,p])[1]).join(' • ')||'Sem cards liberados');
    return '<div class="user-row"><div><b>'+safe(u.username)+'</b> '+(u.is_admin?'<span class="dash-tag live">ADMIN</span>':(u.active?'<span class="dash-tag live">ATIVO</span>':'<span class="dash-tag wait">INATIVO</span>'))+'<div class="meta">'+safe(perms)+'</div></div><div class="actions"><button class="edit" data-user-edit="'+u.id+'">Editar</button><button class="wa" data-user-wa="'+safe(u.username)+'">💬 WhatsApp</button></div></div>'
  }).join('');
  box.querySelectorAll('[data-user-edit]').forEach(b=>b.onclick=()=>editDashboardUser(b.dataset.userEdit));
  box.querySelectorAll('[data-user-wa]').forEach(b=>b.onclick=()=>whatsappShare(b.dataset.userWa))
}
async function loadDashboardUsers(){
  if(!AUTH?.is_admin)return;
  const box=document.querySelector('#userList');if(box)box.innerHTML='<div class="muted">Carregando usuários…</div>';
  try{
    const r=await fetch('/api/auth/users',{cache:'no-store'}),j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao carregar usuários.');
    renderDashboardUsers(j.rows||[])
  }catch(e){if(box)box.innerHTML='<div class="muted">'+safe(e.message)+'</div>'}
}
function setupUserAdmin(){
  renderPermissionOptions();
  const form=document.querySelector('#userForm'),nw=document.querySelector('#userNew'),rf=document.querySelector('#usersRefresh');
  if(nw)nw.onclick=resetUserForm;
  if(rf)rf.onclick=loadDashboardUsers;
  if(!form)return;
  form.onsubmit=async e=>{
    e.preventDefault();
    const id=document.querySelector('#userEditId').value;
    const username=document.querySelector('#userName').value.trim();
    const password=document.querySelector('#userPassword').value;
    const active=document.querySelector('#userActive').checked;
    const permissions=[...document.querySelectorAll('#userPermGrid input[type=checkbox]:checked')].map(x=>x.value);
    const msg=document.querySelector('#userAdminMsg');
    if(!id&&!password){msg.style.color='#b91c1c';msg.textContent='Informe uma senha para o novo usuário.';return}
    const body={username,active,permissions};
    if(password)body.password=password;
    try{
      msg.style.color='#475569';msg.textContent='Salvando…';
      const r=await fetch(id?('/api/auth/users/'+id):'/api/auth/users',{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível salvar o usuário.');
      msg.style.color='#15803d';msg.textContent='✓ Usuário salvo com sucesso.';
      resetUserForm();await loadDashboardUsers()
    }catch(err){msg.style.color='#b91c1c';msg.textContent=err.message}
  }
}
async function showAuthenticatedApp(user){
  AUTH=user;
  document.body.classList.remove('auth-pending');
  document.querySelector('#authGate')?.classList.add('hide');
  const authLoading=document.querySelector('#loading');
  if(authLoading){
    authLoading.style.removeProperty('display');
    authLoading.classList.add('hide');
  }
  applyPermissions();
  setupUserAdmin();
  setupLoadingForm();
  setupAgCopy();
  setupRoteirizador();
  if(AUTH.is_admin)loadDashboardUsers();
  if(!window.__appStarted){
    window.__appStarted=true;
    try{
      await start()
    }catch(e){
      console.error('Falha ao iniciar dashboard:',e);
      const er=document.querySelector('#err');
      if(er){
        er.style.display='block';
        er.innerHTML='<b>O acesso foi realizado.</b><br>Houve uma falha ao carregar um dos componentes. Atualize a página para tentar novamente.';
      }
    }
  }
}
async function bootstrapAuth(){
  const form=document.querySelector('#authForm'),err=document.querySelector('#authError'),btn=document.querySelector('#authSubmit');
  if(form)form.onsubmit=async e=>{
    e.preventDefault();err.textContent='';btn.disabled=true;btn.textContent='Entrando…';
    try{
      const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.querySelector('#authUser').value.trim(),password:document.querySelector('#authPass').value})});
      const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível entrar.');
      if(j.token)setDashboardSessionToken(j.token);
      await showAuthenticatedApp(j.user)
    }catch(x){err.textContent=x.message}
    finally{btn.disabled=false;btn.textContent='Entrar'}
  };
  try{
    const r=await fetch('/api/auth/me',{cache:'no-store'}),j=await r.json();
    if(r.ok&&j.ok)return showAuthenticatedApp(j.user)
  }catch{}
  document.body.classList.add('auth-pending');
  document.querySelector('#authGate')?.classList.remove('hide');
  document.querySelector('#loading')?.classList.add('hide')
}
async function authenticateEmbeddedToken(token){
  if(!token)return false;
  setDashboardSessionToken(token);
  try{
    const r=await fetch('/api/auth/me',{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(r.ok&&j.ok){
      await showAuthenticatedApp(j.user);
      return true
    }
  }catch(e){}
  return false
}
function bootstrapEmbeddedAuth(){
  const gate=document.querySelector('#authGate');
  if(gate)gate.classList.add('hide');
  const loading=document.querySelector('#loading');
  if(loading){
    loading.style.removeProperty('display');
    loading.classList.add('hide');
  }

  if(DASH_SESSION_TOKEN&&DASH_SESSION_USER){
    setDashboardSessionToken(DASH_SESSION_TOKEN);
    const user=DASH_SESSION_USER;
    DASH_SESSION_USER=null;
    showAuthenticatedApp(user);
    return;
  }

  const tryExisting=async()=>{
    if(DASH_SESSION_TOKEN){
      const ok=await authenticateEmbeddedToken(DASH_SESSION_TOKEN);
      if(!ok){
        const er=document.querySelector('#err');
        document.body.classList.remove('auth-pending');
        document.querySelector('.app')?.removeAttribute('hidden');
        if(er){
          er.style.display='block';
          er.textContent='Não foi possível validar a sessão. Reabra Visão Geral pelo portal.';
        }
      }
    }
  };
  window.addEventListener('message',async e=>{
    if(e.origin!==PORTAL_ORIGIN)return;
    const d=e.data||{};
    if(d.type!=='CONSTRULOG_ADMIN_AUTH'||!d.token)return;
    await authenticateEmbeddedToken(String(d.token))
  });
  tryExisting();
}

const S={ops:[],sch:[],help:[],agCopy:[],ssw:null,remetentes:null,receita:null,coletas:null,sswMotoristas:null},$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const gd=o=>o['Data']??o['  Data']??'',g=(o,...k)=>{for(const x of k)if(o[x]!==undefined)return o[x];return''};
const pd=s=>{if(!s)return null;const p=String(s).trim().split('/');if(p.length!==3)return null;const d=new Date(+p[2],+p[1]-1,+p[0]);return isNaN(d)?null:d};
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const num=v=>{if(v==null||v==='')return 0;let s=String(v).replace(/R\$/g,'').trim();if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');s=s.replace(/[^0-9.-]/g,'');return Number(s)||0};
const brl=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),nf=v=>Math.round(v).toLocaleString('pt-BR'),safe=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
async function load(n){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),18000);
  try{
    const r=await fetch('/api/sheet/'+n+'?t='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'},signal:ctrl.signal}),j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'Falha ao carregar '+n);
    return j.rows||[]
  }finally{clearTimeout(timer)}
}
async function loadColetasStatus(){
  const q=new URLSearchParams(),f=$('#from')?.value||'',t=$('#to')?.value||'';
  if(f)q.set('from',f);if(t)q.set('to',t);q.set('t',Date.now());
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),7000);
  try{
    const r=await fetch('/api/coletas/status?'+q.toString(),{cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'},signal:ctrl.signal}),j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'Falha ao carregar status das coletas');
    return j
  }finally{clearTimeout(timer)}
}
async function refreshColetasStatus(){
  if(window.__coletasStatusLoading)return;
  window.__coletasStatusLoading=true;
  try{const co=await loadColetasStatus();if(co&&co.ok){S.coletas=co;update()}}
  catch(e){console.warn('Coletas resumo indisponível:',e.message||e)}
  finally{window.__coletasStatusLoading=false}
}
function agCopyNorm(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim()}
function agCopyKey(v){return agCopyNorm(v).replace(/[^a-z0-9]/g,'')}
function agCopyField(o,...names){
  for(const name of names){if(o&&o[name]!==undefined&&String(o[name]??'').trim()!=='')return o[name]}
  const wanted=new Set(names.map(agCopyKey));
  for(const [k,v] of Object.entries(o||{})){if(wanted.has(agCopyKey(k))&&String(v??'').trim()!=='')return v}
  return''
}
function agCopyDateInfo(v){
  if(v===null||v===undefined||String(v).trim()==='')return null;
  const raw=String(v).trim();
  let d=null,m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if(m)d=new Date(+m[3],+m[2]-1,+m[1]);
  if(!d||isNaN(d)){m=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)d=new Date(+m[1],+m[2]-1,+m[3])}
  if(!d||isNaN(d)){const x=new Date(raw);if(!isNaN(x))d=x}
  return d&&!isNaN(d)?{raw,date:d}:null
}
function agCopyLastMovementInfo(o){
  const names=[
    'DATA ÚLTIMA MOVIMENTAÇÃO','DATA ULTIMA MOVIMENTAÇÃO','DATA ULTIMA MOVIMENTACAO','ÚLTIMA MOVIMENTAÇÃO','ULTIMA MOVIMENTAÇÃO','ULTIMA MOVIMENTACAO',
    'DATA MOVIMENTAÇÃO','DATA MOVIMENTACAO','DATA STATUS','DATA ATUALIZAÇÃO','DATA ATUALIZACAO','ATUALIZADO EM',
    'DATA ENTREGA','DATA DA ENTREGA','2º TENTATIVA','2ª TENTATIVA','SEGUNDA TENTATIVA','DATA CONTATO','DATA AGENDADA'
  ];
  const found=[];
  for(const name of names){
    const v=agCopyField(o,name);
    if(v){const info=agCopyDateInfo(v);if(info)found.push(info)}
  }
  if(!found.length)return null;
  found.sort((x,y)=>y.date-x.date);
  return found[0]
}
function agCopyLastMovement(o){
  const x=agCopyLastMovementInfo(o);
  return x?x.raw:''
}
function agCopyOldDelivered(o){
  if(!agCopyNorm(g(o,'STATUS')).includes('entregue'))return false;
  const raw=agCopyField(o,'DATA ENTREGA','DATA DA ENTREGA','DATA ÚLTIMA MOVIMENTAÇÃO','DATA ULTIMA MOVIMENTAÇÃO','DATA ULTIMA MOVIMENTACAO','DATA AGENDADA');
  const info=agCopyDateInfo(raw)||agCopyLastMovementInfo(o);
  if(!info)return false;
  const today=new Date();today.setHours(0,0,0,0);
  const d=new Date(info.date);d.setHours(0,0,0,0);
  return d<today
}
function renderAgStatusCards(id,rows){
  const box=$(id);if(!box)return;
  const counts=new Map();
  for(const o of (rows||[])){
    const raw=String(g(o,'STATUS')||'').trim()||'Sem status';
    if(agCopyNorm(raw).includes('entregue'))continue;
    counts.set(raw,(counts.get(raw)||0)+1)
  }
  const items=[...counts.entries()].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0],'pt-BR'));
  box.innerHTML=items.length?items.map(([status,n])=>'<div class="ag-status-card"><div class="label">'+safe(status)+'</div><div class="value">'+nf(n)+'</div></div>').join(''):'<div class="ag-status-card empty">Nenhum status em aberto no período.</div>'
}

function agCopyFillSelect(id,key,label){
  const el=$(id);if(!el)return;
  const current=el.value;
  const values=[...new Set((S.agCopy||[]).map(o=>String(g(o,key)||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  el.innerHTML='<option value="">'+label+'</option>'+values.map(v=>'<option value="'+safe(v)+'">'+safe(v)+'</option>').join('');
  if(values.includes(current))el.value=current
}
function agCopyPopulateFilters(){
  agCopyFillSelect('#agcStatus','STATUS','Todos os status')
}
function agCopyFiltered(){
  const status=$('#agcStatus')?.value||'';
  const selected=$('#agcDate')?.value||'';
  return (S.agCopy||[]).filter(o=>{
    if(agCopyOldDelivered(o))return false;
    if(status&&agCopyNorm(g(o,'STATUS'))!==agCopyNorm(status))return false;
    if(selected){
      const dt=pd(g(o,'DATA AGENDADA'));
      if(!dt||iso(dt)!==selected)return false
    }
    return true
  })
}
function agCopyReportRows(){
  return agCopyFiltered().slice(0,1000).map(o=>({
    ultimaMovimentacao:agCopyLastMovement(o),
    status:agCopyField(o,'STATUS'),
    notaFiscal:agCopyField(o,'NF','NOTA FISCAL','Nº NF','NUMERO NF','NÚMERO NF','NOTA','COL_1'),
    cliente:agCopyField(o,'NOME CLIENTE','CLIENTE','NOME DO CLIENTE'),
    cidade:agCopyField(o,'CIDADE','CIDADE DESTINO','MUNICIPIO','MUNICÍPIO'),
    mercadoria:agCopyField(o,'MERCADORIA','PRODUTO','DESCRIÇÃO MERCADORIA','DESCRICAO MERCADORIA'),
    observacao:agCopyField(o,'OBSERVAÇÃO','OBSERVACAO','OBS','OBSERVAÇÕES','OBSERVACOES')
  }))
}
function renderAgCopy(){
  const rows=agCopyFiltered();
  const info=$('#agcInfo');
  if(info)info.textContent=nf(rows.length)+' registro(s) encontrado(s) de '+nf((S.agCopy||[]).length)+' na aba Cópia de AGENDAMENTOS • entregues anteriores a hoje não entram no relatório'+(rows.length>1000?' • exibindo os 1.000 primeiros':'');
  renderAgStatusCards('#agcStatusSummary',rows);
  const reportRows=agCopyReportRows();
  window.__agCopyReportRows=reportRows;
  const reportTable=$('#agcTable');
  if(reportTable){
    reportTable.innerHTML='<thead><tr><th>Última movimentação</th><th>Status</th><th>Nota Fiscal</th><th>Nome do cliente</th><th>Cidade</th><th>Mercadoria</th></tr></thead><tbody>'+reportRows.map((r,i)=>{
      const cliente=r.observacao
        ?'<button type="button" class="ag-observation-link" data-ag-observation="'+i+'" title="Ver observação">'+safe(r.cliente||'Cliente sem nome')+'</button>'
        :safe(r.cliente);
      return '<tr><td>'+safe(r.ultimaMovimentacao)+'</td><td>'+safe(r.status)+'</td><td>'+safe(r.notaFiscal)+'</td><td>'+cliente+'</td><td>'+safe(r.cidade)+'</td><td>'+safe(r.mercadoria)+'</td></tr>'
    }).join('')+'</tbody>';
    reportTable.querySelectorAll('[data-ag-observation]').forEach(btn=>btn.onclick=()=>openAgObservation(Number(btn.dataset.agObservation)))
  }
}
function openAgObservation(index){
  const r=(window.__agCopyReportRows||[])[index];if(!r||!r.observacao)return;
  const modal=$('#agObservationModal'),client=$('#agObservationClient'),textEl=$('#agObservationText');
  if(client)client.textContent=r.cliente||'Cliente sem nome';
  if(textEl)textEl.textContent=r.observacao;
  if(modal){modal.classList.add('open');document.body.style.overflow='hidden'}
}
function closeAgObservation(){
  const modal=$('#agObservationModal');
  if(modal)modal.classList.remove('open');
  document.body.style.overflow=''
}
function printAgCopyReport(){
  const rows=agCopyReportRows();
  const status=$('#agcStatus')?.value||'Todos os status';
  const date=$('#agcDate')?.value||'Todas as datas';
  const body=rows.map(r=>'<tr><td>'+safe(r.ultimaMovimentacao)+'</td><td>'+safe(r.status)+'</td><td>'+safe(r.notaFiscal)+'</td><td>'+safe(r.cliente)+'</td><td>'+safe(r.cidade)+'</td><td>'+safe(r.mercadoria)+'</td></tr>').join('');
  const w=window.open('','_blank','noopener,noreferrer');
  if(!w){alert('O navegador bloqueou a janela de impressão. Libere pop-ups para este site e tente novamente.');return}
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Relatório de Agendamentos</title><style>body{font-family:Arial,sans-serif;color:#111827;margin:24px}h1{font-size:20px;margin:0 0 6px}.meta{font-size:12px;color:#4b5563;margin-bottom:14px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #d1d5db;padding:6px;text-align:left;vertical-align:top}th{background:#f3f4f6} @media print{body{margin:10mm}}</style></head><body><h1>Relatório de Agendamentos por Status</h1><div class="meta">Data: '+safe(date)+' • Status: '+safe(status)+' • Registros: '+nf(rows.length)+'<br>Entregues com datas anteriores a hoje foram desconsiderados.</div><table><thead><tr><th>Última movimentação</th><th>Status</th><th>NF</th><th>Cliente</th><th>Cidade</th><th>Mercadoria</th></tr></thead><tbody>'+body+'</tbody></table><script>window.onload=()=>{window.print()}<\/script></body></html>');
  w.document.close()
}
function renderAgCopyHub(){
  const rows=(S.agCopy||[]).filter(o=>!agCopyOldDelivered(o)),set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  set('#hubAgCopyN',nf(rows.length));
  set('#hubAgCopyScheduled',nf(rows.filter(o=>agCopyNorm(g(o,'STATUS')).includes('agendado')).length));
  set('#hubAgCopyDelivered',nf(rows.filter(o=>agCopyNorm(g(o,'STATUS')).includes('entregue')).length));
  set('#hubAgCopyFailed',nf(rows.filter(o=>agCopyNorm(g(o,'STATUS')).includes('insucesso')).length));
  set('#hubAgCopyInfo',rows.length?'Dados atualizados da aba Cópia de AGENDAMENTOS.':'Sem registros disponíveis.')
}
async function refreshAgCopy(force=false){
  if(!hasAnyPerm(['dashboard','agendamentos','agendamentos_copia']))return;
  if(window.__agCopyLoading)return;
  if(!force&&S.agCopy.length&&Date.now()-(window.__agCopyLoadedAt||0)<60000){agCopyPopulateFilters();renderAgCopy();renderAgCopyHub();renderAgStatusCards('#agStatusCards',S.agCopy||[]);return}
  window.__agCopyLoading=true;
  const info=$('#agcInfo');if(info)info.textContent='Atualizando dados da Cópia de AGENDAMENTOS…';
  try{
    const r=await fetch('/api/sheet/agendamentos_copia?t='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
    const j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível carregar a Cópia de AGENDAMENTOS.');
    S.agCopy=j.rows||[];window.__agCopyLoadedAt=Date.now();
    agCopyPopulateFilters();renderAgCopy();renderAgCopyHub();renderAgStatusCards('#agStatusCards',S.agCopy||[])
  }catch(e){
    if(info)info.textContent='Não foi possível carregar os agendamentos: '+e.message;
    const h=$('#hubAgCopyInfo');if(h)h.textContent='Consulta de agendamentos indisponível: '+e.message
  }finally{window.__agCopyLoading=false}
}
function setupAgCopy(){
  const apply=$('#agcApply'),print=$('#agcPrint'),today=$('#agcToday'),clear=$('#agcClear'),refresh=$('#agcRefresh'),obsClose=$('#agObservationClose'),obsModal=$('#agObservationModal');
  if(apply)apply.onclick=renderAgCopy;
  if(print)print.onclick=printAgCopyReport;
  if(today)today.onclick=()=>{const d=iso(new Date());if($('#agcDate'))$('#agcDate').value=d;renderAgCopy()};
  if(clear)clear.onclick=()=>{if($('#agcDate'))$('#agcDate').value='';if($('#agcStatus'))$('#agcStatus').value='';renderAgCopy()};
  if(refresh)refresh.onclick=()=>refreshAgCopy(true);
  if($('#agcDate'))$('#agcDate').onchange=renderAgCopy;
  if($('#agcStatus'))$('#agcStatus').onchange=renderAgCopy;
  if(obsClose)obsClose.onclick=closeAgObservation;
  if(obsModal)obsModal.onclick=e=>{if(e.target===obsModal)closeAgObservation()};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&obsModal?.classList.contains('open'))closeAgObservation()})
}
function init(){const t=new Date(),f=new Date(t.getFullYear(),t.getMonth(),1);$('#from').value=iso(f);$('#to').value=iso(t)}
function setDashboardToday(){
  const d=iso(new Date());
  if($('#from'))$('#from').value=d;
  if($('#to'))$('#to').value=d;
}
function inper(d){const f=$('#from').value?new Date($('#from').value+'T00:00:00'):null,t=$('#to').value?new Date($('#to').value+'T23:59:59'):null;return(!f||!d||d>=f)&&(!t||!d||d<=t)}
function ops(){const d=$('#driver').value,b=$('#branch').value;return S.ops.filter(o=>inper(pd(gd(o)))&&(!d||g(o,'Motorista')===d)&&(!b||g(o,'Filial')===b))}
function help(){return S.help.filter(o=>inper(pd(g(o,'Data'))))}
function sch(){return S.sch.filter(o=>inper(pd(g(o,'DATA AGENDADA'))||pd(g(o,'DATA CONTATO'))))}
function filters(){const curD=$('#driver').value,curB=$('#branch').value,ds=[...new Set(S.ops.map(o=>g(o,'Motorista')).filter(Boolean))].sort(),bs=[...new Set(S.ops.map(o=>g(o,'Filial')).filter(Boolean))].sort();$('#driver').innerHTML='<option value="">Todos motoristas</option>'+ds.map(x=>'<option>'+safe(x)+'</option>').join('');$('#branch').innerHTML='<option value="">Todas filiais</option>'+bs.map(x=>'<option>'+safe(x)+'</option>').join('');if(ds.includes(curD))$('#driver').value=curD;if(bs.includes(curB))$('#branch').value=curB}
function cv(id){const c=$(id),b=c.parentElement,w=Math.max(290,b.clientWidth),h=Math.max(220,b.clientHeight),d=devicePixelRatio||1;c.width=w*d;c.height=h*d;c.style.width=w+'px';c.style.height=h+'px';const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);x.clearRect(0,0,w,h);x.font='12px Segoe UI';return{x,w,h}}
function empty(id){const{x,w,h}=cv(id);x.fillStyle='#94a3b8';x.textAlign='center';x.fillText('Sem dados no período',w/2,h/2)}
function bars(id,L,D,labels=[],inside=false){if(!D.length)return empty(id);const{x,w,h}=cv(id),p={l:42,r:12,t:28,b:58},cw=w-p.l-p.r,ch=h-p.t-p.b,m=Math.max(...D,1),bw=Math.max(5,Math.min(38,cw/D.length*.65));x.strokeStyle='#e2e8f0';x.strokeRect(p.l,p.t,cw,ch);D.forEach((v,i)=>{const px=p.l+(i+.5)*cw/D.length,bh=v/m*ch;x.fillStyle='#0f766e';x.fillRect(px-bw/2,h-p.b-bh,bw,bh);if(labels[i]!==undefined&&labels[i]!==null&&String(labels[i])!==''){x.save();x.textAlign='center';x.font='700 11px Segoe UI';if(inside&&bh>=15){x.textBaseline='top';x.fillStyle='#fff';x.fillText(String(labels[i]),px,h-p.b-bh+4)}else{x.textBaseline='bottom';x.fillStyle='#172033';x.fillText(String(labels[i]),px,Math.max(14,h-p.b-bh-5))}x.restore()}x.save();x.translate(px,h-p.b+8);x.rotate(-Math.PI/4);x.textAlign='right';x.fillStyle='#64748b';x.font='12px Segoe UI';x.fillText(String(L[i]).slice(0,18),0,0);x.restore()})}

function groupedBars(id,L,A,B,labelsA=[],labelsB=[]){
  if(!L.length)return empty(id);
  const{x,w,h}=cv(id),p={l:42,r:12,t:48,b:62},cw=w-p.l-p.r,ch=h-p.t-p.b,m=Math.max(...A,...B,1),groupW=cw/Math.max(L.length,1),gap=Math.max(3,Math.min(8,groupW*.08)),bw=Math.max(5,Math.min(28,(groupW-gap*3)/2));
  x.strokeStyle='#e2e8f0';x.strokeRect(p.l,p.t,cw,ch);
  x.font='700 11px Segoe UI';x.textAlign='left';x.textBaseline='middle';
  x.fillStyle='#0f766e';x.fillRect(p.l,16,12,12);x.fillStyle='#475569';x.fillText('Ajudantes',p.l+18,22);
  x.fillStyle='#0284c7';x.fillRect(p.l+105,16,12,12);x.fillStyle='#475569';x.fillText('Conferentes',p.l+123,22);
  L.forEach((label,i)=>{
    const cx=p.l+(i+.5)*groupW,va=Number(A[i]||0),vb=Number(B[i]||0),ha=va/m*ch,hb=vb/m*ch;
    const ax=cx-gap/2-bw,bx=cx+gap/2;
    x.fillStyle='#0f766e';x.fillRect(ax,h-p.b-ha,bw,ha);
    x.fillStyle='#0284c7';x.fillRect(bx,h-p.b-hb,bw,hb);
    if(labelsA[i]!==undefined&&String(labelsA[i])!==''){
      x.save();x.textAlign='center';x.textBaseline='bottom';x.fillStyle='#172033';x.font='700 10px Segoe UI';
      x.fillText(String(labelsA[i]),ax+bw/2,Math.max(42,h-p.b-ha-4));x.restore()
    }
    if(labelsB[i]!==undefined&&String(labelsB[i])!==''){
      x.save();x.textAlign='center';x.textBaseline='bottom';x.fillStyle='#172033';x.font='700 10px Segoe UI';
      x.fillText(String(labelsB[i]),bx+bw/2,Math.max(42,h-p.b-hb-4));x.restore()
    }
    x.save();x.translate(cx,h-p.b+9);x.rotate(-Math.PI/4);x.textAlign='right';x.fillStyle='#64748b';x.font='12px Segoe UI';x.fillText(String(label).slice(0,18),0,0);x.restore()
  })
}

function lines(id,L,A,B){if(!L.length)return empty(id);const{x,w,h}=cv(id),p={l:42,r:12,t:20,b:42},cw=w-p.l-p.r,ch=h-p.t-p.b,m=Math.max(...A,...B,1);x.strokeStyle='#e2e8f0';x.strokeRect(p.l,p.t,cw,ch);const d=(V,c)=>{x.strokeStyle=c;x.lineWidth=2;x.beginPath();V.forEach((v,i)=>{const px=p.l+(L.length===1?cw/2:i*cw/(L.length-1)),py=p.t+ch-v/m*ch;i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke()};d(A,'#0f766e');d(B,'#b45309')}
function donut(id,L,D){if(!D.length)return empty(id);const{x,w,h}=cv(id),sum=D.reduce((a,b)=>a+b,0),cx=Math.min(w*.33,150),cy=h/2,r=Math.min(75,h*.28),C=['#0f766e','#0284c7','#d97706','#dc2626','#7c3aed','#64748b'];let a=-Math.PI/2;D.forEach((v,i)=>{const z=v/sum*Math.PI*2;x.strokeStyle=C[i%C.length];x.lineWidth=25;x.beginPath();x.arc(cx,cy,r,a,a+z);x.stroke();a+=z});x.fillStyle='#172033';x.textAlign='center';x.font='700 18px Segoe UI';x.fillText(nf(sum),cx,cy+5);x.font='11px Segoe UI';x.textAlign='left';L.slice(0,7).forEach((l,i)=>{const y=24+i*25,xx=Math.max(cx+r+30,w*.53);x.fillStyle=C[i%C.length];x.fillRect(xx,y-9,9,9);x.fillStyle='#475569';x.fillText(String(l).slice(0,24)+' ('+D[i]+')',xx+14,y)})}
function mood(el,v){el.classList.remove('positive','negative');el.classList.add(v>=0?'positive':'negative')}
function table(id,cols,rows){$(id).innerHTML='<thead><tr>'+cols.map(c=>'<th>'+c[0]+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+cols.map(c=>'<td>'+safe(g(r,...c.slice(1)))+'</td>').join('')+'</tr>').join('')+'</tbody>'}
function update(){const O=ops(),H=help(),A=sch(),roleNorm=o=>String(g(o,'FUNÇÃO','FUNCAO','Função','Funcao')||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(),HCf=H.filter(o=>roleNorm(o).includes('CONFER')),HA=H.filter(o=>!roleNorm(o).includes('CONFER')),delSheet=O.reduce((a,o)=>a+num(g(o,'Entregas')),0),doneSheet=O.reduce((a,o)=>a+num(g(o,'Realizadas')),0),co=S.coletas&&S.coletas.ok?S.coletas:null,del=co?num(co.ativas):delSheet,done=co?num(co.entregues):doneSheet,km=O.reduce((a,o)=>a+num(g(o,'KM')),0),rev=O.reduce((a,o)=>a+num(g(o,'Frete Vialog Liq',' Frete Vialog Liq')),0),dc=O.reduce((a,o)=>a+num(g(o,'Frete Mot Liq',' Frete Mot Liq')),0),helperCost=HA.reduce((a,o)=>a+num(g(o,'Valor')),0),checkerCost=HCf.reduce((a,o)=>a+num(g(o,'Valor')),0),hc=helperCost+checkerCost,gross=rev-dc,margin=rev?gross/rev*100:0,net=gross-hc,ret=O.reduce((a,o)=>a+num(g(o,'Retorno')),0),pending=co?num(co.pendentes):Math.max(del-done,0);
$('#del').textContent=nf(del);$('#done').textContent=nf(done);$('#rate').textContent=(del?done/del*100:0).toFixed(1).replace('.',',')+'%';$('#km').textContent=nf(km);$('#revenue').textContent=brl(rev);$('#driverCost').textContent=brl(dc);$('#gross').textContent=brl(gross);$('#margin').textContent=margin.toFixed(1).replace('.',',')+'%';$('#helpersCost').textContent=brl(helperCost);$('#checkersCost').textContent=brl(checkerCost);$('#net').textContent=brl(net);mood($('#gross'),gross);mood($('#margin'),margin);mood($('#net'),net);
const sla=del?done/del*100:0;
const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
set('#hubExecDel',nf(done)+' / '+nf(del));set('#hubExecSla',sla.toFixed(1).replace('.',',')+'%');set('#hubExecRev',brl(rev));set('#hubExecNet',brl(net));
set('#hubOpPlan',nf(del));set('#hubOpDone',nf(done));set('#hubOpPend',nf(pending));set('#hubOpKm',nf(km));
set('#hubFinRev',brl(rev));set('#hubFinDriver',brl(dc));set('#hubFinHelp',brl(helperCost));set('#hubFinChecker',brl(checkerCost));set('#hubFinMargin',margin.toFixed(1).replace('.',',')+'%');
set('#hubHelpCost',brl(helperCost));set('#hubHelpPeople',nf(new Set(HA.map(o=>g(o,'NOME')).filter(Boolean)).size));set('#hubCheckerCost',brl(checkerCost));set('#hubCheckerPeople',nf(new Set(HCf.map(o=>g(o,'NOME')).filter(Boolean)).size));
set('#hubSchN',nf(A.length));
const hs={};A.forEach(o=>{const k=(g(o,'STATUS')||'SEM STATUS').trim();hs[k]=(hs[k]||0)+1});set('#hubSchStatus',nf(Object.keys(hs).length));const hsTop=Object.entries(hs).sort((a,b)=>b[1]-a[1]).slice(0,4);set('#hubSchList',hsTop.length?hsTop.map(x=>x[0]+': '+nf(x[1])).join(' • '):'Sem agendamentos no período');
const hdm={};O.forEach(o=>{const k=g(o,'Motorista')||'Sem motorista';hdm[k]=(hdm[k]||0)+num(g(o,'Realizadas'))});const hdTop=Object.entries(hdm).sort((a,b)=>b[1]-a[1]).slice(0,5);set('#hubDrivers',hdTop.length?hdTop.map((x,i)=>(i+1)+'. '+x[0]+' — '+nf(x[1])).join(' | '):'Sem dados de motoristas');
const hbm={};O.forEach(o=>{const k=g(o,'Filial')||'Sem filial';hbm[k]??={p:0,d:0};hbm[k].p+=num(g(o,'Entregas'));hbm[k].d+=num(g(o,'Realizadas'))});const hbTop=Object.entries(hbm).sort((a,b)=>b[1].d-a[1].d).slice(0,5);set('#hubBranches',hbTop.length?hbTop.map(x=>x[0]+': '+nf(x[1].d)+'/'+nf(x[1].p)).join(' | '):'Sem dados de filiais');
const hrm={};O.forEach(o=>{const k=g(o,'Rota')||'Sem rota';hrm[k]=(hrm[k]||0)+num(g(o,'Realizadas'))});const hrTop=Object.entries(hrm).sort((a,b)=>b[1]-a[1]).slice(0,4);set('#hubRoutes',hrTop.length?hrTop.map(x=>x[0]+': '+nf(x[1])).join(' • '):'Sem dados de rotas');set('#hubKmDel',done?(km/done).toFixed(1).replace('.',','):'0');set('#hubRouteN',nf(Object.keys(hrm).filter(x=>x!=='Sem rota').length));
set('#hubIssue',nf(ret));set('#hubIssueRate',(del?ret/del*100:0).toFixed(1).replace('.',',')+'%');set('#hubIssueSla',sla.toFixed(1).replace('.',',')+'%');set('#hubIssuePend',nf(pending));$('#sswPlanned').textContent=nf(del);$('#sswRoute').textContent=nf(pending);$('#sswDone').textContent=nf(done);$('#sswIssue').textContent=nf(ret);$('#sswSla').textContent=sla.toFixed(1).replace('.',',')+'%';$('#sswSlaBar').style.width=Math.min(100,Math.max(0,sla))+'%';
const active=$('.section.active')?.id||'dashboard';
if(active==='dashboard'){
  const bd={};O.forEach(o=>{const k=gd(o)||'Sem data';bd[k]??={d:0,r:0};bd[k].d+=num(g(o,'Realizadas'));bd[k].r+=num(g(o,'Retorno'))});const K=Object.keys(bd).sort((a,b)=>(pd(a)||0)-(pd(b)||0));lines('#trend',K,K.map(k=>bd[k].d),K.map(k=>bd[k].r));
  const dm={};O.forEach(o=>{const k=g(o,'Motorista')||'Sem motorista';dm[k]=(dm[k]||0)+num(g(o,'Entregas'))});const T=Object.entries(dm).sort((a,b)=>b[1]-a[1]).slice(0,10);bars('#drivers',T.map(x=>x[0]),T.map(x=>x[1]),T.map(x=>nf(x[1])),true);
  renderAgStatusCards('#agStatusCards',S.agCopy||[]);
  const hdA={},hdC={};HA.forEach(o=>{const k=g(o,'Data')||'Sem data';hdA[k]??={valor:0,nomes:new Set()};hdA[k].valor+=num(g(o,'Valor'));const nome=String(g(o,'NOME')||'').trim();if(nome)hdA[k].nomes.add(nome)});HCf.forEach(o=>{const k=g(o,'Data')||'Sem data';hdC[k]??={valor:0,nomes:new Set()};hdC[k].valor+=num(g(o,'Valor'));const nome=String(g(o,'NOME')||'').trim();if(nome)hdC[k].nomes.add(nome)});const HK=[...new Set([...Object.keys(hdA),...Object.keys(hdC)])].sort((a,b)=>(pd(a)||0)-(pd(b)||0));groupedBars('#helpersChart',HK,HK.map(k=>hdA[k]?.valor||0),HK.map(k=>hdC[k]?.valor||0),HK.map(k=>nf(hdA[k]?.nomes.size||0)),HK.map(k=>nf(hdC[k]?.nomes.size||0)));
}
$('#hc').textContent=brl(helperCost);$('#hcc').textContent=brl(checkerCost);$('#hn').textContent=nf(H.length);$('#hp').textContent=new Set(HA.map(o=>g(o,'NOME')).filter(Boolean)).size;$('#hcp').textContent=new Set(HCf.map(o=>g(o,'NOME')).filter(Boolean)).size;
if(active==='operacoes')table('#ops',[['Data','Data','  Data'],['Motorista','Motorista'],['Veículo','Veiculo'],['Filial','Filial'],['Entregas','Entregas'],['Realizadas','Realizadas'],['KM','KM'],['Frete Motorista','Frete Mot Liq',' Frete Mot Liq'],['Receita Líq.','Frete Vialog Liq',' Frete Vialog Liq'],['Rota','Rota']],O.slice().reverse().slice(0,500));
if(active==='agendamentos')table('#sch',[['NF','NF'],['Cidade','CIDADE'],['Cliente','NOME CLIENTE'],['Data','DATA AGENDADA'],['Status','STATUS'],['Motorista','MOTORISTA'],['Observação','OBSERVAÇÃO']],A.slice().reverse().slice(0,500));
if(active==='ajudantes'){table('#helpHelpers',[['Data','Data'],['Nome','NOME'],['Valor','Valor'],['Função','FUNÇÃO']],HA.slice().reverse().slice(0,500));table('#helpCheckers',[['Data','Data'],['Nome','NOME'],['Valor','Valor'],['Função','FUNÇÃO']],HCf.slice().reverse().slice(0,500));}
const now=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('#status').textContent='Atualização automática a cada 5 s • última: '+now+' • '+S.ops.length.toLocaleString('pt-BR')+' operações • '+S.sch.length.toLocaleString('pt-BR')+' agendamentos • '+S.help.length.toLocaleString('pt-BR')+' registros de ajudantes/conferentes'}
function sswRangeQuery(){const f=$('#from')?.value||'',t=$('#to')?.value||'';return f&&t?'?from='+encodeURIComponent(f)+'&to='+encodeURIComponent(t):''}
function renderSswAtrasos(){const d=S.ssw;if(!d||!d.ok)return;const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};set('#sswLateTotal',nf(d.total||0));set('#sswLateBranches',nf(d.filiaisCount||0));set('#sswLateCities',nf(d.cidadesCount||0));set('#sswLateRecipients',nf(d.destinatariosCount||0));set('#sswLateTime',(d.meta&&d.meta.hora)||'—');set('#sswLateGoods',brl(d.valorMercadoria||0));set('#sswLateFreight',brl(d.freteTotal||0));set('#sswLateVolumes',nf(d.volumesTotal||0));set('#sswLateWeight',nf(d.pesoTotal||0));set('#sswLateM3',(d.m3Total||0).toLocaleString('pt-BR',{maximumFractionDigits:2}));set('#hubSswLate',nf(d.total||0));set('#hubSswBranches',nf(d.filiaisCount||0));const p=d.period,periodText=p?('Período '+p.from+' a '+p.to+' • '+p.daysAvailable+'/'+p.daysRequested+' dia(s) com arquivo BI2'):'';const metaText=(d.meta&&d.meta.relatorio?d.meta.relatorio+' • ':'')+((d.meta&&d.meta.data)||'')+((d.meta&&d.meta.hora)?' '+d.meta.hora:'')+(periodText?' • '+periodText:'');set('#sswLateMeta',metaText||'Relatório BI2');set('#hubSswLateMeta',metaText||'Relatório BI2');set('#sswHistoryInfo',periodText||'Arquivo mais recente do BI2');if(p&&Array.isArray(p.series)){const hs=p.series.filter(x=>x.total!==null);lines('#sswHistoryChart',hs.map(x=>x.date.slice(5)),hs.map(x=>x.total),[])}const f=d.filiais||[],ci=d.cidades||[];bars('#sswBranchChart',f.map(x=>x.label),f.map(x=>x.value));bars('#sswCityChart',ci.map(x=>x.label),ci.map(x=>x.value));set('#sswLocationsList',(d.localizacoes||[]).slice(0,10).map((x,i)=>(i+1)+'. '+x.label+' — '+nf(x.value)).join(' | ')||'Sem dados');set('#sswOccurrencesList',(d.ocorrencias||[]).slice(0,10).map((x,i)=>(i+1)+'. '+x.label+' — '+nf(x.value)).join(' | ')||'Sem dados');set('#sswRecipientsList',(d.destinatarios||[]).slice(0,10).map((x,i)=>(i+1)+'. '+x.label+' — '+nf(x.value)).join(' | ')||'Sem dados');set('#sswSendersList',(d.remetentes||[]).slice(0,10).map((x,i)=>(i+1)+'. '+x.label+' — '+nf(x.value)).join(' | ')||'Sem dados');table('#sswLateTable',[['Filial','filial'],['CTRC','ctrc'],['NF','nf'],['Remetente','remetente'],['Destinatário','destinatario'],['UF','uf'],['Cidade','cidade'],['Agendada','entregaAgendada'],['Previsão','previsao'],['Atraso','diasAtraso'],['Unidade atual','unidadeAtual'],['Localização atual','localizacaoAtual'],['Última ocorrência','ultimaOcorrencia'],['Data ocorrência','dataUltimaOcorrencia'],['Tipo documento','tipoDocumento']],(d.rows||[]).slice(0,500))}
async function refreshSswAtrasos(){try{const q=sswRangeQuery(),sep=q?'&':'?';const r=await fetch('/api/bi2/atrasos'+q+sep+'t='+Date.now(),{cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Falha ao carregar relatório SSW');S.ssw=j;renderSswAtrasos()}catch(e){const m=$('#sswLateMeta');if(m)m.textContent='Não foi possível carregar os CT-es atrasados: '+e.message;const h=$('#hubSswLateMeta');if(h)h.textContent='SSW indisponível neste momento.'}}
function driverProgressStatus(r){
  if(r&&r.entregue)return'entregue';
  const t=((r?.ocorrenciaCodigo||'')+' '+(r?.ocorrencia||'')).toUpperCase().trim();
  if(!t)return'pendente';
  if(/SA[IÍ]DA PARA ENTREGA|EM ROTA|EM TR[ÂA]NSITO|PR[EÉ][ -]?ENTREG|AGUARD|CARREG|MANIFEST|TRANSFER|EXPEDI/.test(t))return'pendente';
  return'ocorrencia'
}
function buildDriverProgress(d){
  const official=Array.isArray(d?.motoristas38)?d.motoristas38:[];
  if(official.length){
    return official.map(x=>({
      motorista:x.motorista||'Não identificado',
      veiculo:x.veiculo||'',
      total:Number(x.total||0),
      entregues:Number(x.entregues||0),
      pendentes:Number(x.pendentes||0),
      ocorrencias:Number(x.ocorrencias||0),
      romaneios:Array.isArray(x.romaneios)?x.romaneios:[],
      vinculados:Number(x.vinculados||0)
    })).filter(x=>x.total>0).sort((a,b)=>b.total-a.total||String(a.motorista).localeCompare(String(b.motorista),'pt-BR'))
  }
  const groups=new Map(),rows=Array.isArray(d?.rows)?d.rows:[];
  rows.forEach(r=>{
    const k=(r.motorista||r.veiculo||'Não identificado').trim();
    if(!groups.has(k))groups.set(k,{motorista:r.motorista||'Não identificado',veiculo:r.veiculo||'',total:0,entregues:0,pendentes:0,ocorrencias:0});
    const g=groups.get(k),st=driverProgressStatus(r);g.total++;if(st==='entregue')g.entregues++;else if(st==='ocorrencia')g.ocorrencias++;else g.pendentes++;
  });
  return[...groups.values()].filter(x=>x.total>0).sort((a,b)=>b.total-a.total||String(a.motorista).localeCompare(String(b.motorista),'pt-BR'))
}
function renderDriverProgress(){
  const d=S.sswMotoristas;if(!d||!d.ok)return;
  const list=$('#driverProgressList');if(!list)return;
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  const G=buildDriverProgress(d),tot=G.reduce((a,x)=>a+x.total,0),del=G.reduce((a,x)=>a+x.entregues,0),pen=G.reduce((a,x)=>a+x.pendentes,0),occ=G.reduce((a,x)=>a+x.ocorrencias,0);
  set('#driverProgTotal',nf(tot));set('#driverProgDelivered',nf(del));set('#driverProgPending',nf(pen));set('#driverProgOcc',nf(occ));
  set('#hubDriverProgDrivers',nf(G.length));set('#hubDriverProgDelivered',nf(del));set('#hubDriverProgPending',nf(pen));set('#hubDriverProgOcc',nf(occ));
  set('#driverProgressMeta','Período '+(d.from||'—')+' a '+(d.to||'—')+' • base oficial da opção 38 • '+nf((d.motoristas38||[]).reduce((a,x)=>a+Number(x.vinculados||0),0))+' CT-es vinculados ao rastreamento');
  if(!G.length){list.innerHTML='<div class="card muted">Nenhum motorista disponível para o período selecionado.</div>';return}
  list.innerHTML=G.map(x=>{
    const t=Math.max(1,x.total),pg=x.entregues/t*100,py=x.pendentes/t*100,pr=x.ocorrencias/t*100,processed=(x.entregues+x.ocorrencias)/t*100,truck=Math.max(2,Math.min(98,processed));
    const pct=x.total?x.entregues/x.total*100:0;
    return'<div class="driver-progress-row"><div class="driver-progress-head"><div><div class="driver-progress-name">'+safe(x.motorista)+'</div><div class="driver-progress-meta">'+(x.veiculo?'Veículo '+safe(x.veiculo)+' • ':'')+nf(x.total)+' entregas no total'+(x.romaneios&&x.romaneios.length?' • Romaneio(s): '+safe(x.romaneios.join(', ')):'')+'</div></div><div class="driver-progress-stats"><b>'+nf(x.entregues)+'</b> entregues • <b>'+nf(x.pendentes)+'</b> pendentes • <b>'+nf(x.ocorrencias)+'</b> ocorrências • <b>'+pct.toFixed(1).replace('.',',')+'%</b></div></div><div class="driver-progress-track"><div class="driver-progress-fill"><div class="driver-seg-delivered" style="width:'+pg+'%"></div><div class="driver-seg-occurrence" style="width:'+pr+'%"></div><div class="driver-seg-pending" style="width:'+py+'%"></div></div><div class="driver-progress-truck" style="left:'+truck+'%">🚚</div></div></div>'
  }).join('')
}
function driverForecasts(d){
  const G=buildDriverProgress(d),rows=Array.isArray(d?.rows)?d.rows:[],now=new Date(),deadline=new Date(now);
  deadline.setHours(18,0,0,0);
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const fmt=t=>String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
  const rank={red:0,yellow:1,green:2};

  const out=G.map(g=>{
    const dk=norm(g.motorista),R=rows.filter(r=>norm(r.motorista)===dk);

    const deliveredTimes=R.filter(r=>r.entregue&&r.dataOcorrencia&&r.horaOcorrencia).map(r=>{
      const z=new Date(r.dataOcorrencia+'T'+r.horaOcorrencia+':00');
      return isNaN(z)?null:z
    }).filter(Boolean).sort((a,b)=>a-b);

    const intervals=[];
    for(let i=1;i<deliveredTimes.length;i++){
      const m=(deliveredTimes[i]-deliveredTimes[i-1])/60000;
      if(m>=5&&m<=120)intervals.push(m)
    }
    intervals.sort((a,b)=>a-b);
    const median=intervals.length?intervals[Math.floor(intervals.length/2)]:0;

    const pendingRows=R.filter(r=>!r.entregue);
    const pendingCities=[...new Set(pendingRows.map(r=>{
      const city=String(r.cidade||'').trim(),uf=String(r.uf||'').trim();
      return city+(uf?' / '+uf:'')
    }).filter(Boolean))];

    const deliveredRows=R.filter(r=>r.entregue&&r.dataOcorrencia&&r.horaOcorrencia).sort((a,b)=>{
      return (a.dataOcorrencia+' '+a.horaOcorrencia).localeCompare(b.dataOcorrencia+' '+b.horaOcorrencia)
    });
    const lastDelivered=deliveredRows.length?deliveredRows[deliveredRows.length-1]:null;
    const lastCity=lastDelivered?(String(lastDelivered.cidade||'').trim()+(lastDelivered.uf?' / '+String(lastDelivered.uf).trim():'')):'';

    // 17,5 min por atendimento, conforme média operacional informada.
    // O deslocamento é estimado pelo ritmo real das baixas; sem amostra suficiente,
    // parte de 12 min por trecho e sobe quando há várias cidades pendentes.
    let travelPerStop=median?Math.max(5,Math.min(45,median-17.5)):12;
    if(pendingCities.length>1)travelPerStop+=Math.min(10,(pendingCities.length-1)*1.5);
    if(lastCity&&pendingCities.length&&!pendingCities.includes(lastCity))travelPerStop+=3;

    const perStop=17.5+travelPerStop;
    const remaining=Math.max(0,Number(g.pendentes||0));
    const eta=new Date(now.getTime()+remaining*perStop*60000);
    const margin=(deadline-eta)/60000;

    let level='green',label='Provável até 18h',icon='🟢';
    if(remaining===0){
      label='Rota concluída';icon='✅';
    }else if(margin<0){
      level='red';label='Risco após 18h';icon='🔴';
    }else if(margin<45){
      level='yellow';label='Atenção';icon='🟡';
    }

    const confidence=deliveredTimes.length>=3?'boa':(deliveredTimes.length?'média':'inicial');
    return {
      ...g,remaining,etaText:fmt(eta),margin,level,label,icon,confidence,
      lastCity,pendingCities:pendingCities.length,perStop,deliveredSamples:deliveredTimes.length
    }
  });

  out.sort((a,b)=>(rank[a.level]??9)-(rank[b.level]??9)||a.margin-b.margin);
  return out;
}

function renderForecast(){
  const d=S.sswMotoristas;if(!d||!d.ok)return;
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  const F=driverForecasts(d);

  set('#hubForecastGreen',nf(F.filter(x=>x.level==='green').length));
  set('#hubForecastYellow',nf(F.filter(x=>x.level==='yellow').length));
  set('#hubForecastRed',nf(F.filter(x=>x.level==='red').length));

  const list=$('#hubForecastList');if(!list)return;
  if(!F.length){
    list.textContent='Sem dados suficientes para calcular a previsão.';
    return
  }

  list.innerHTML=F.map(x=>{
    const delta=x.margin>=0?Math.round(x.margin)+' min de folga':Math.abs(Math.round(x.margin))+' min após 18h';
    const city=x.lastCity?' • última cidade: '+safe(x.lastCity):'';
    return '<div style="margin:0 0 8px"><b>'+x.icon+' '+safe(x.motorista)+'</b> — '+nf(x.entregues)+' entregues • '+nf(x.remaining)+' pendentes • previsão <b>'+x.etaText+'</b> • '+delta+' • confiança '+x.confidence+city+'</div>'
  }).join('');
}

function renderSswMotoristas(){
  const d=S.sswMotoristas;if(!d||!d.ok)return;
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  const official=Number(d.totalRomaneado||0),driverN=Array.isArray(d.motoristas38)&&d.motoristas38.length?d.motoristas38.length:(d.motoristasIdentificados||0);set('#sswPlannedOnline',nf(d.candidatos||0));set('#sswOut',nf(official||d.saidas||0));set('#sswDown',nf(d.baixadas||0));set('#sswPend',nf(d.pendentes||0));set('#sswRate',(d.taxa||0).toFixed(1).replace('.',',')+'%');set('#sswTrackingOk',nf(d.trackingOk||0)+' / '+nf(d.trackingConsultados||0));set('#sswDriversCount',nf(driverN));
  set('#hubSswOut',nf(Number(d.totalRomaneado||0)||d.saidas||0));set('#hubSswDown',nf(d.baixasSsw||0));set('#hubSswPend',nf(d.pendentes||0));set('#hubSswRate',(d.taxa||0).toFixed(1).replace('.',',')+'%');

  // Card "Entregas por Cidade Destino" — usa a mesma carga já obtida do SSW,
  // sem disparar uma nova consulta pesada.
  const cityMap=new Map(),citySeen=new Set();
  for(const r of (d.rows||[])){
    const cidade=String(r.cidade||'').trim(),uf=String(r.uf||'').trim();
    if(!cidade)continue;
    const rowKey=String(r.ctrcOficial||r.ctrc||r.nf||cidade+'|'+citySeen.size).trim();
    if(rowKey&&citySeen.has(rowKey))continue;
    if(rowKey)citySeen.add(rowKey);
    const label=cidade+(uf?' / '+uf:'');
    cityMap.set(label,(cityMap.get(label)||0)+1);
  }
  const cityRank=[...cityMap.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR'));
  const cityMapped=cityRank.reduce((a,x)=>a+x[1],0),cityTotal=Number(d.totalRomaneado||0)||Number(d.saidas||0)||cityMapped;
  set('#hubCityDestCities',nf(cityRank.length));
  set('#hubCityDestMapped',nf(cityMapped));
  set('#hubCityDestTotal',nf(cityTotal));
  set('#hubCityDestList',cityRank.length
    ?cityRank.slice(0,10).map((x,i)=>(i+1)+'. '+x[0]+' — '+nf(x[1])).join(' • ')
    :(d.refreshing?'Atualizando cidades de destino do SSW…':'Nenhuma cidade de destino identificada no período.'));
  const meta=d.refreshing
    ? 'Atualizando Saídas x Baixas em segundo plano… exibindo o último resultado disponível.'
    : 'Período '+d.from+' a '+d.to+' • status on-line SSW consultado em '+nf(d.trackingOk||0)+' de '+nf(d.trackingConsultados||0)+' NF(s)';
  set('#sswDriverMeta',meta);set('#hubSswDriverMeta',meta);
  const note=$('#sswDriverNote');if(note){note.textContent=(d.totalRomaneado?'BASE OFICIAL DA OPÇÃO 38: '+nf(d.totalRomaneado)+' CT-es em '+nf((d.romaneios38||[]).length)+' romaneios e '+nf((d.motoristas38||[]).length)+' motoristas. ':'')+'Verde = entregue, amarelo = pendente real na coluna Falta Ocorr. da opção 38, vermelho = baixa com ocorrência.';note.style.display='block'}
  const M=(d.motoristas||[]).slice(0,12),labels=M.map(x=>x.motorista||x.veiculo||'Sem identificação');
  lines('#sswDriverChart',labels,M.map(x=>x.saidas||0),M.map(x=>x.baixadas||0));
  const O=(d.ocorrencias||[]).slice(0,10);bars('#sswDriverOccChart',O.map(x=>x.label),O.map(x=>x.value));
  const mr=(d.motoristas||[]).map(x=>({motorista:x.motorista||'Não identificado',veiculo:x.veiculo||'—',saidas:nf(x.saidas||0),baixadas:nf(x.baixadas||0),pendentes:nf(x.pendentes||0),taxa:(x.taxa||0).toFixed(1).replace('.',',')+'%',ocorrencias:nf(x.ocorrencias||0)}));
  table('#sswDriverTable',[['Motorista','motorista'],['Veículo','veiculo'],['Saíram','saidas'],['Baixadas','baixadas'],['Pendentes','pendentes'],['Taxa','taxa'],['Ocorrências','ocorrencias']],mr);
  const dr=(d.rows||[]).map(x=>({ctrc:x.ctrc,nf:x.nf,remetente:x.remetente,destinatario:x.destinatario,cidade:(x.cidade||'')+(x.uf?' / '+x.uf:''),veiculo:x.veiculo||'—',motorista:x.motorista||'Não identificado',situacao:x.entregue?'BAIXADA':(x.ocorrenciaCodigo==='085'||x.ocorrenciaCodigo==='85'?'EM ROTA':'PENDENTE'),ocorrencia:(x.ocorrenciaCodigo?x.ocorrenciaCodigo+' - ':'')+(x.ocorrencia||''),data:(x.dataOcorrencia||'')+(x.horaOcorrencia?' '+x.horaOcorrencia:''),entrega:x.dataEntrega||''}));
  table('#sswDriverDetail',[['CTRC','ctrc'],['NF','nf'],['Remetente','remetente'],['Destinatário','destinatario'],['Cidade','cidade'],['Veículo','veiculo'],['Motorista','motorista'],['Situação','situacao'],['Última ocorrência','ocorrencia'],['Data / hora','data'],['Baixa','entrega']],dr);renderDriverProgress();renderForecast();
}
async function refreshSswMotoristas(){
  if(window.__sswMotoristasLoading)return;
  window.__sswMotoristasLoading=true;
  try{
    const q=sswRangeQuery(),sep=q?'&':'?';
    const r=await fetch('/api/bi2/saidas-baixas'+q+sep+'t='+Date.now(),{cache:'no-store'}),j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'Falha ao carregar saídas e baixas do SSW');
    S.sswMotoristas=j;renderSswMotoristas();loadingDriverOptions();
    clearTimeout(window.__sswMotoristasRetry);
    if(j.refreshing)window.__sswMotoristasRetry=setTimeout(refreshSswMotoristas,8000);
  }catch(e){
    const msg='Não foi possível carregar Saídas x Baixas: '+e.message;
    ['#sswDriverMeta','#hubSswDriverMeta'].forEach(id=>{const el=$(id);if(el)el.textContent=msg});
    clearTimeout(window.__sswMotoristasRetry);
    window.__sswMotoristasRetry=setTimeout(refreshSswMotoristas,15000);
  }finally{
    window.__sswMotoristasLoading=false;
  }
}

function renderSswReceita(){
  const d=S.receita,set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  if(!d||!d.ok){
    set('#hubRevenueTotal','—');set('#hubRevenueClients','—');set('#hubRevenueTop','—');
    const msg=d?.error||'Receita SSW aguardando relatório 073.';
    set('#hubRevenueInfo',msg);set('#revenueMeta',msg);
    set('#revenueTotal','—');set('#revenueClients','—');set('#revenueRows','—');set('#revenueField','—');
    if($('#sswRevenueChart'))empty('#sswRevenueChart');
    if($('#sswRevenueTable'))$('#sswRevenueTable').innerHTML='<tbody><tr><td>'+safe(msg)+'</td></tr></tbody>';
    return
  }
  const C=d.clientes||[],top=C[0]||null,total=Number(d.totalFaturamento||0);
  set('#hubRevenueTotal',brl(total));set('#hubRevenueClients',nf(d.totalClientes||0));set('#hubRevenueTop',top?top.cliente:'—');
  set('#hubRevenueInfo',(top?('Maior faturamento: '+top.cliente+' • '+brl(top.faturamento)):'Sem clientes')+' • '+(d.aliasRule||''));
  set('#revenueTotal',brl(total));set('#revenueClients',nf(d.totalClientes||0));set('#revenueRows',nf(d.totalRegistros||0));set('#revenueField',d.revenueField||'—');
  const meta=[d.sourceName||'Relatório 073',d.periodo?('Referência: '+d.periodo):'',d.meta?.data,d.meta?.hora,'Cliente: '+(d.clientField||'—'),'Receita: '+(d.revenueField||'—'),d.aliasRule].filter(Boolean).join(' • ');
  set('#revenueMeta',meta);
  const top10=C.slice(0,10);
  bars('#sswRevenueChart',top10.map(x=>x.cliente),top10.map(x=>x.faturamento),top10.map(x=>brl(x.faturamento)));
  const rows=C.map((x,i)=>({pos:String(i+1),cliente:x.cliente,faturamento:brl(x.faturamento),participacao:(total?x.faturamento/total*100:0).toFixed(1).replace('.',',')+'%',registros:nf(x.registros)}));
  table('#sswRevenueTable',[['#','pos'],['Cliente','cliente'],['Faturamento','faturamento'],['Participação','participacao'],['CT-es','registros']],rows)
}
async function refreshSswReceita(){
  if(!hasPerm('receita_ssw'))return;
  try{
    const q=sswRangeQuery(),sep=q?'&':'?';
    const r=await fetch('/api/bi2/receita'+q+sep+'t='+Date.now(),{cache:'no-store'});
    const j=await r.json().catch(()=>({ok:false,error:'Resposta inválida do SSW.'}));
    S.receita=j;renderSswReceita()
  }catch(e){
    S.receita={ok:false,error:'Não foi possível carregar a Receita SSW: '+e.message};renderSswReceita()
  }
}

function renderRemetentes(){const d=S.remetentes;if(!d||!d.ok)return;const set=(id,v)=>{const e=$(id);if(e)e.textContent=v},C=d.clientes||[];set('#hubRemClients',nf(d.totalClientes||0));set('#hubRemCtrcs',nf(d.totalCtrcs||0));set('#hubRemFreight',brl(d.totalFrete||0));set('#hubRemVolumes',nf(d.totalVolumes||0));set('#hubRemNote',d.note||'Dados SSW / BI2');set('#remClients',nf(d.totalClientes||0));set('#remCtrcs',nf(d.totalCtrcs||0));set('#remFreight',brl(d.totalFrete||0));set('#remGoods',brl(d.totalMercadoria||0));set('#remVolumes',nf(d.totalVolumes||0));const p=d.period,pt=p?('Período '+p.from+' a '+p.to+' • '+p.daysAvailable+'/'+p.daysRequested+' dia(s) com arquivo BI2'):'';const meta=(d.meta&&d.meta.data?d.meta.data+' '+(d.meta.hora||''):'')+(pt?' • '+pt:'')+' • '+(d.note||'');set('#remMeta',meta);const top=C.slice(0,10),topF=C.slice().sort((a,b)=>b.frete-a.frete).slice(0,10);bars('#remCtrcChart',top.map(x=>x.remetente),top.map(x=>x.ctrcs));bars('#remFreightChart',topF.map(x=>x.remetente),topF.map(x=>x.frete));const rows=C.map((x,i)=>({pos:String(i+1),remetente:x.remetente,ctrcs:nf(x.ctrcs),frete:brl(x.frete),mercadoria:brl(x.valorMercadoria),volumes:nf(x.volumes),peso:nf(x.peso),m3:(x.m3||0).toLocaleString('pt-BR',{maximumFractionDigits:2}),atraso:(x.atrasoMedio||0).toFixed(1).replace('.',',')+' d',cidades:nf(x.cidades),destinatarios:nf(x.destinatarios)}));table('#remTable',[['#','pos'],['Cliente remetente','remetente'],['CT-es','ctrcs'],['Frete','frete'],['Valor mercadoria','mercadoria'],['Volumes','volumes'],['Peso','peso'],['m³','m3'],['Atraso médio','atraso'],['Cidades','cidades'],['Destinatários','destinatarios']],rows);table('#remCompareTable',[['#','pos'],['Cliente remetente','remetente'],['CT-es','ctrcs'],['Frete','frete'],['Volumes','volumes'],['Atraso médio','atraso'],['Cidades','cidades'],['Destinatários','destinatarios']],rows);const a=$('#remClientA'),b=$('#remClientB');if(a&&b){const va=a.value,vb=b.value,opts=C.map(x=>'<option value="'+safe(x.remetente)+'">'+safe(x.remetente)+'</option>').join('');a.innerHTML=opts;b.innerHTML=opts;if(C.some(x=>x.remetente===va))a.value=va;else if(C[0])a.value=C[0].remetente;if(C.some(x=>x.remetente===vb))b.value=vb;else if(C[1])b.value=C[1].remetente;else if(C[0])b.value=C[0].remetente;renderRemCompare()}}
function renderRemCompare(){const d=S.remetentes;if(!d||!d.ok)return;const C=d.clientes||[],a=$('#remClientA'),b=$('#remClientB');if(!a||!b)return;const A=C.find(x=>x.remetente===a.value),B=C.find(x=>x.remetente===b.value),set=(id,v)=>{const e=$(id);if(e)e.textContent=v};const fill=(p,x)=>{set('#rem'+p+'Name',x?x.remetente:'—');set('#rem'+p+'Ctrcs',x?nf(x.ctrcs):'—');set('#rem'+p+'Freight',x?brl(x.frete):'—');set('#rem'+p+'Goods',x?brl(x.valorMercadoria):'—');set('#rem'+p+'Volumes',x?nf(x.volumes):'—');set('#rem'+p+'Weight',x?nf(x.peso):'—');set('#rem'+p+'Delay',x?(x.atrasoMedio||0).toFixed(1).replace('.',',')+' d':'—');set('#rem'+p+'Cities',x?nf(x.cidades):'—');set('#rem'+p+'Recipients',x?nf(x.destinatarios):'—')};fill('A',A);fill('B',B);set('#remCompareMeta',(d.note||'')+(d.meta&&d.meta.data?' • '+d.meta.data+' '+(d.meta.hora||''):''))}
async function refreshSswRemetentes(){try{const q=sswRangeQuery(),sep=q?'&':'?';const r=await fetch('/api/bi2/remetentes'+q+sep+'t='+Date.now(),{cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Falha ao carregar clientes remetentes');S.remetentes=j;renderRemetentes()}catch(e){const ids=['#remMeta','#hubRemNote','#remCompareMeta'];ids.forEach(id=>{const el=$(id);if(el)el.textContent='Não foi possível carregar os clientes remetentes: '+e.message})}}
async function checkSsw(){try{const [rs,rb,ra]=await Promise.all([fetch('/api/ssw/status?t='+Date.now(),{cache:'no-store'}),fetch('/api/bi2/status?t='+Date.now(),{cache:'no-store'}),fetch('/api/bi2/api-status?t='+Date.now(),{cache:'no-store'})]),s=await rs.json(),b2=await rb.json(),api=await ra.json(),b=$('#sswSource');if(!b)return;if(api.connected){b.textContent='BI2 WebAPI conectada • consulta a cada 1 min • usando Google Sheets';const tag=$('#hubBi2Tag'),txt=$('#hubBi2Text');if(tag){tag.textContent='WEBAPI BI2 CONECTADA';tag.classList.remove('wait');tag.classList.add('live')}if(txt)txt.textContent='WebAPI BI2 conectada. Relatórios monitorados a cada 1 minuto; SFTP mantido como contingência.';b.style.background='#dcfce7';b.style.color='#166534';b.style.borderColor='#86efac'}else if(b2.connected){b.textContent=(b2.fileCount>0?'BI2 SFTP conectado • '+b2.fileCount+' arquivo(s) disponível(is) • usando Google Sheets':'BI2 SFTP conectado • aguardando arquivos do SSW • usando Google Sheets');const tag=$('#hubBi2Tag'),txt=$('#hubBi2Text');if(tag){tag.textContent=b2.fileCount>0?'ARQUIVOS DISPONÍVEIS':'BI2 CONECTADO';tag.classList.remove('wait');tag.classList.add('live')}if(txt)txt.textContent=b2.fileCount>0?'BI2 conectado com '+b2.fileCount+' arquivo(s) disponível(is) para processamento.':'BI2 conectado com sucesso. Aguardando o SSW publicar os primeiros arquivos.';b.style.background='#dcfce7';b.style.color='#166534';b.style.borderColor='#86efac'}else if(b2.configured){b.textContent='BI2 configurado • conexão indisponível • usando Google Sheets';const tag=$('#hubBi2Tag'),txt=$('#hubBi2Text');if(tag){tag.textContent='BI2 INDISPONÍVEL';tag.classList.remove('live');tag.classList.add('wait')}if(txt)txt.textContent='Credenciais configuradas, mas a conexão BI2 não está disponível neste momento.';b.style.background='#fee2e2';b.style.color='#991b1b';b.style.borderColor='#fecaca'}else if(s.connected){b.textContent='SSW WebAPI conectado • usando Google Sheets';b.style.background='#dcfce7';b.style.color='#166534';b.style.borderColor='#86efac'}else if(s.configured){b.textContent='SSW WebAPI: falha de autenticação • usando Google Sheets';b.style.background='#fee2e2';b.style.color='#991b1b';b.style.borderColor='#fecaca'}else{b.textContent='SSW/BI2 aguardando configuração • usando Google Sheets';b.style.background='#ecfeff';b.style.color='#0f766e';b.style.borderColor='#99f6e4'}}catch(e){const b=$('#sswSource');if(b)b.textContent='Fontes SSW indisponíveis • usando Google Sheets'}}
async function refreshData(first=false){
  if(window.__refreshing)return;
  window.__refreshing=true;
  if(first)$('#loading').classList.remove('hide');
  try{
    const needOps=hasAnyPerm(['dashboard','operacional','financeiro','motoristas','filiais','rotas','ocorrencias']);
    const needSch=hasAnyPerm(['dashboard','agendamentos']);
    const needHelp=hasAnyPerm(['dashboard','ajudantes','financeiro']);
    const [ro,ra,rh]=await Promise.allSettled([
      needOps?load('lancamentos'):Promise.resolve(null),
      needSch?load('agendamentos'):Promise.resolve(null),
      needHelp?load('ajudantes'):Promise.resolve(null)
    ]);
    let updated=false,errors=[];
    if(needOps){
      if(ro.status==='fulfilled'){S.ops=ro.value||[];S.opsUpdatedAt=Date.now();updated=true}else errors.push('Operações: '+(ro.reason?.message||ro.reason))
    }else S.ops=[];
    if(needSch){
      if(ra.status==='fulfilled'){S.sch=ra.value||[];updated=true}else errors.push('Agendamentos: '+(ra.reason?.message||ra.reason))
    }else S.sch=[];
    if(needHelp){
      if(rh.status==='fulfilled'){S.help=rh.value||[];updated=true}else errors.push('Ajudantes: '+(rh.reason?.message||rh.reason))
    }else S.help=[];
    if(updated||!needOps){filters();update()}
    const er=$('#err');
    if(errors.length){
      er.style.display='block';
      er.innerHTML='<b>Atualização parcial.</b><br>'+errors.map(safe).join('<br>')+'<br>Os módulos permitidos que responderam continuam atualizando normalmente.';
    }else er.style.display='none';
    if(hasAnyPerm(['dashboard','operacional']))refreshColetasStatus();
  }catch(e){
    $('#err').style.display='block';
    $('#err').innerHTML='<b>Erro ao atualizar os dados.</b><br>'+safe(e.message)+'<br><button onclick="refreshData(false)">Tentar novamente</button>';
  }finally{
    window.__refreshing=false;
    if(first)$('#loading').classList.add('hide')
  }
}
function loadingDriverOptions(){
  const names=new Set();
  for(const x of (S.sswMotoristas?.motoristas38||[]))if(x.motorista)names.add(String(x.motorista).trim());
  for(const x of (S.sswMotoristas?.rows||[]))if(x.motorista)names.add(String(x.motorista).trim());
  const dl=$('#loadDriverList');
  if(dl)dl.innerHTML=[...names].filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR')).map(n=>'<option value="'+safe(n)+'"></option>').join('');
}
function loadingDateTime(v){
  const d=new Date(v);
  if(isNaN(d))return'—';
  return d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})
}
async function compressLoadingPhoto(file){
  const dataUrl=await new Promise((resolve,reject)=>{
    const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=()=>reject(new Error('Não foi possível ler a foto.'));fr.readAsDataURL(file)
  });
  const img=await new Promise((resolve,reject)=>{
    const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Foto inválida.'));im.src=dataUrl
  });
  let max=1280,quality=.72,result='';
  for(let attempt=0;attempt<4;attempt++){
    const scale=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
    const w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
    const h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);
    result=canvas.toDataURL('image/jpeg',quality);
    const approx=Math.round((result.length-result.indexOf(',')-1)*.75);
    if(approx<=850*1024)return result;
    max=Math.round(max*.82);quality=Math.max(.52,quality-.08)
  }
  return result
}
function clearLoadingPhotoUrls(){
  const urls=Array.isArray(window.__loadingPhotoObjectUrls)?window.__loadingPhotoObjectUrls:[];
  urls.forEach(u=>{try{URL.revokeObjectURL(u)}catch{}});
  window.__loadingPhotoObjectUrls=[]
}
async function hydrateLoadingPhotos(){
  const box=$('#loadRecords');if(!box)return;
  const imgs=[...box.querySelectorAll('img[data-loading-photo-id]')];
  await Promise.all(imgs.map(async img=>{
    const id=img.dataset.loadingPhotoId;
    if(!id)return;
    const wrap=img.closest('a');
    try{
      const r=await fetch('/api/carregamentos-finais/'+encodeURIComponent(id)+'/foto?t='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const blob=await r.blob();
      if(!blob.size)throw new Error('Foto vazia');
      const url=URL.createObjectURL(blob);
      if(!Array.isArray(window.__loadingPhotoObjectUrls))window.__loadingPhotoObjectUrls=[];
      window.__loadingPhotoObjectUrls.push(url);
      img.src=url;
      img.classList.remove('load-photo-pending','load-photo-error');
      if(wrap){wrap.href=url;wrap.target='_blank';wrap.rel='noopener'}
    }catch(e){
      img.classList.remove('load-photo-pending');
      img.classList.add('load-photo-error');
      img.alt='Não foi possível carregar a foto';
      if(wrap){wrap.removeAttribute('href');wrap.removeAttribute('target');wrap.title='Não foi possível carregar esta foto.'}
    }
  }))
}
function renderLoadingRecords(rows){
  const box=$('#loadRecords');
  clearLoadingPhotoUrls();
  if(box){
    if(!rows.length)box.innerHTML='<div class="muted">Nenhum final de carregamento registrado ainda.</div>';
    else{
      box.innerHTML=rows.map(r=>{
        const dt=loadingDateTime(r.capturada_em);
        return '<div class="load-record"><a class="load-photo-link" data-loading-photo-id="'+safe(r.id)+'" title="Abrir foto"><img class="load-photo-pending" data-loading-photo-id="'+safe(r.id)+'" alt="Carregando foto do final do carregamento"></a><div><b>'+safe(r.motorista||'Motorista não informado')+'</b><div class="meta">Conferente: '+safe(r.conferente||'—')+'<br>Entregas: <b>'+nf(Number(r.quantidade_entregas||0))+'</b><br>Foto: '+safe(dt)+'</div></div></div>'
      }).join('');
      hydrateLoadingPhotos().catch(()=>{})
    }
  }
  const today=iso(new Date()),todayRows=rows.filter(r=>{
    const d=new Date(r.capturada_em);return !isNaN(d)&&iso(d)===today
  });
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  set('#hubLoadCount',nf(todayRows.length));
  set('#hubLoadLast',rows.length?new Date(rows[0].capturada_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—');
  const info=$('#hubLoadInfo');
  if(info)info.textContent=rows.length?('Último: '+(rows[0].motorista||'—')+' • '+nf(Number(rows[0].quantidade_entregas||0))+' entregas • '+loadingDateTime(rows[0].capturada_em)):'Nenhum registro realizado ainda.';
}
async function refreshLoadingRecords(useFilters=true){
  if(window.__loadingRecordsBusy)return;
  window.__loadingRecordsBusy=true;
  try{
    const q=new URLSearchParams({limit:'30',t:String(Date.now())});
    const motorista=useFilters?($('#loadFilterDriver')?.value||'').trim():'';
    const data=useFilters?($('#loadFilterDate')?.value||'').trim():'';
    if(motorista)q.set('motorista',motorista);
    if(data)q.set('data',data);

    const r=await fetch('/api/carregamentos-finais?'+q.toString(),{cache:'no-store'});
    const j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao carregar registros.');
    const rows=Array.isArray(j.rows)?j.rows:[];
    renderLoadingRecords(rows);

    const fi=$('#loadFilterInfo');
    if(fi){
      const parts=[];
      if(motorista)parts.push('motorista: '+motorista);
      if(data){
        const p=data.split('-');
        parts.push('data: '+(p.length===3?p[2]+'/'+p[1]+'/'+p[0]:data))
      }
      fi.textContent=parts.length
        ? nf(rows.length)+' registro(s) encontrado(s) • '+parts.join(' • ')
        : 'Mostrando os últimos registros.'
    }
  }catch(e){
    const box=$('#loadRecords');if(box)box.innerHTML='<div class="muted">Não foi possível carregar os registros: '+safe(e.message)+'</div>';
    const info=$('#hubLoadInfo');if(info)info.textContent='Registros de carregamento indisponíveis no momento.'
  }finally{window.__loadingRecordsBusy=false}
}
function setupLoadingForm(){
  const photo=$('#loadPhoto'),form=$('#loadFinalForm'),refresh=$('#loadRefresh'),search=$('#loadSearch'),clear=$('#loadClear');
  if(!photo||!form)return;
  if(refresh)refresh.onclick=()=>refreshLoadingRecords(true);
  if(search)search.onclick=()=>refreshLoadingRecords(true);
  if(clear)clear.onclick=()=>{
    if($('#loadFilterDriver'))$('#loadFilterDriver').value='';
    if($('#loadFilterDate'))$('#loadFilterDate').value='';
    refreshLoadingRecords(true)
  };
  if($('#loadFilterDriver'))$('#loadFilterDriver').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();refreshLoadingRecords(true)}});
  if($('#loadFilterDate'))$('#loadFilterDate').addEventListener('change',()=>refreshLoadingRecords(true));
  photo.onchange=async()=>{
    const file=photo.files&&photo.files[0];
    const msg=$('#loadMsg');
    if(!file){window.__loadPhotoData='';return}
    try{
      if(msg){msg.style.color='#475569';msg.textContent='Preparando foto…'}
      const captured=new Date(file.lastModified||Date.now());
      window.__loadCapturedAt=captured.toISOString();
      window.__loadPhotoData=await compressLoadingPhoto(file);
      $('#loadPreviewImg').src=window.__loadPhotoData;
      $('#loadPhotoTime').textContent='Foto registrada em '+captured.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'medium'});
      $('#loadPreview').style.display='block';
      if(msg)msg.textContent='Foto pronta para salvar.'
    }catch(e){
      window.__loadPhotoData='';
      if(msg){msg.style.color='#b91c1c';msg.textContent=e.message}
    }
  };
  form.onsubmit=async ev=>{
    ev.preventDefault();
    const msg=$('#loadMsg'),btn=$('#loadSave');
    const conferente=$('#loadChecker').value.trim(),motorista=$('#loadDriver').value.trim(),quantidade=Number($('#loadQty').value);
    if(!window.__loadPhotoData){if(msg){msg.style.color='#b91c1c';msg.textContent='Tire a foto do final do carregamento antes de salvar.'}return}
    btn.disabled=true;
    if(msg){msg.style.color='#475569';msg.textContent='Salvando registro…'}
    try{
      const r=await fetch('/api/carregamentos-finais',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({conferente,motorista,quantidade_entregas:quantidade,capturada_em:window.__loadCapturedAt||new Date().toISOString(),foto:window.__loadPhotoData})
      });
      const j=await r.json();
      if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível salvar.');
      if(msg){msg.style.color='#15803d';msg.textContent='✓ Final do carregamento salvo com sucesso.'}
      form.reset();window.__loadPhotoData='';window.__loadCapturedAt='';
      $('#loadPreview').style.display='none';$('#loadPreviewImg').removeAttribute('src');
      await refreshLoadingRecords(true)
    }catch(e){
      if(msg){msg.style.color='#b91c1c';msg.textContent=e.message}
    }finally{btn.disabled=false}
  }
}


let ROUTE_MANIFESTS=[],ROUTE_PLAN=null,ROUTE_MANUAL_ORDER=[],ROUTE_EXTRA_STOPS=[],ROUTE_MAP=null,ROUTE_LAYER=null;
function routeFmtKm(m){return Number.isFinite(Number(m))?(Number(m)/1000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' km':'—'}
function routeDistance(order,m){
  if(!order?.length||!m?.length)return 0;
  let d=Number(m[0]?.[order[0]]||0);
  for(let i=1;i<order.length;i++)d+=Number(m[order[i-1]]?.[order[i]]||0);
  d+=Number(m[order[order.length-1]]?.[0]||0);
  return d
}
function routeLegs(order){
  if(!ROUTE_PLAN)return[];
  const seq=[0,...order,0],out=[];
  for(let i=1;i<seq.length;i++){
    const a=seq[i-1],b=seq[i],p=ROUTE_PLAN.points[b]||{},from=ROUTE_PLAN.points[a]||{};
    out.push({fromIndex:a,toIndex:b,from:from.label||'',to:p.label||'',meters:Number(ROUTE_PLAN.matrix[a]?.[b]||0),point:p})
  }
  return out
}
function routePopulateManifest(){
  const driver=$('#routeDriver')?.value||'',sel=$('#routeManifest');if(!sel)return;
  const rows=ROUTE_MANIFESTS.filter(x=>!driver||x.motorista===driver);
  sel.innerHTML='<option value="">Selecione o romaneio</option>'+rows.map(x=>'<option value="'+safe(x.romaneio)+'">'+safe(x.romaneio)+' • '+nf(x.entregas)+' entrega(s)'+(x.veiculo?' • '+safe(x.veiculo):'')+'</option>').join('');
}
function routePopulateDrivers(){
  const sel=$('#routeDriver');if(!sel)return;
  const cur=sel.value,drivers=[...new Set(ROUTE_MANIFESTS.map(x=>x.motorista).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sel.innerHTML='<option value="">Selecione o motorista</option>'+drivers.map(x=>'<option>'+safe(x)+'</option>').join('');
  if(drivers.includes(cur))sel.value=cur;
  routePopulateManifest()
}
async function loadRouteManifests(force=false){
  if(!hasPerm('roteirizador'))return;
  const date=$('#routeDate')?.value||iso(new Date()),status=$('#routeStatus');
  if(status)status.textContent='Carregando romaneios do SSW…';
  try{
    const r=await fetch('/api/roteirizador/lista?date='+encodeURIComponent(date)+(force?'&t='+Date.now():''),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível carregar os romaneios.');
    ROUTE_MANIFESTS=j.rows||[];
    routePopulateDrivers();
    if(status)status.textContent=ROUTE_MANIFESTS.length?nf(ROUTE_MANIFESTS.length)+' romaneio(s) disponível(is) para '+date.split('-').reverse().join('/')+'.':'Nenhum romaneio encontrado para esta data.'
  }catch(e){if(status)status.textContent='Erro ao carregar romaneios: '+e.message}
}
function routeRenderMap(){
  const box=$('#routeMap');if(!box||!ROUTE_PLAN)return;
  if(typeof L==='undefined'){box.innerHTML='<div style="padding:24px" class="muted">Mapa indisponível. A sequência e as distâncias continuam disponíveis abaixo.</div>';return}
  if(!ROUTE_MAP){
    ROUTE_MAP=L.map(box,{zoomControl:true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(ROUTE_MAP)
  }
  if(ROUTE_LAYER)ROUTE_LAYER.remove();
  ROUTE_LAYER=L.layerGroup().addTo(ROUTE_MAP);
  const order=ROUTE_PLAN.optimizedOrder||[],points=ROUTE_PLAN.points||[];
  const base=points[0];
  L.marker([base.lat,base.lon]).addTo(ROUTE_LAYER).bindTooltip('Base • Av. do Algodão, 316',{permanent:false});
  order.forEach((idx,pos)=>{
    const p=points[idx],icon=L.divIcon({className:'',html:'<div style="background:#0f766e;color:#fff;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:800;border:2px solid #fff;box-shadow:0 1px 5px #0005">'+(pos+1)+'</div>',iconSize:[28,28],iconAnchor:[14,14]});
    L.marker([p.lat,p.lon],{icon}).addTo(ROUTE_LAYER).bindPopup('<b>'+safe(p.destinatario||p.label)+'</b><br>'+safe((p.cidade||'')+(p.uf?' / '+p.uf:''))+'<br>'+safe(p.endereco||p.cep||'Localização aproximada'))
  });
  const coords=(ROUTE_PLAN.geometry?.coordinates||[]).map(x=>[x[1],x[0]]);
  if(coords.length)L.polyline(coords,{weight:5,opacity:.8}).addTo(ROUTE_LAYER);
  const bounds=L.latLngBounds([[base.lat,base.lon],...order.map(i=>[points[i].lat,points[i].lon])]);
  if(bounds.isValid())ROUTE_MAP.fitBounds(bounds.pad(.12));
  setTimeout(()=>ROUTE_MAP.invalidateSize(),80)
}
function routePrecision(p){
  const approx=p.precision==='cidade'||p.precision==='cliente';
  const label=p.precision==='endereco'?'endereço':p.precision==='cep'?'CEP':p.precision==='cliente'?'cliente/cidade':'cidade';
  return '<span class="precision-badge '+(approx?'approx':'')+'">'+label+'</span>'
}
function routeRenderBest(){
  if(!ROUTE_PLAN)return;
  const legs=routeLegs(ROUTE_PLAN.optimizedOrder||[]),table=$('#routeBestTable');if(!table)return;
  let html='<thead><tr><th>Ordem</th><th>Destino</th><th>Cidade</th><th>CT-e</th><th>NF</th><th>Precisão</th><th>Distância do trecho</th></tr></thead><tbody>';
  let seq=0;
  for(const leg of legs){
    if(leg.toIndex===0){
      html+='<tr><td>↩</td><td><b>Retorno à Base Americana</b></td><td>Americana/SP</td><td>—</td><td>—</td><td><span class="precision-badge">base</span></td><td><b>'+routeFmtKm(leg.meters)+'</b></td></tr>';
      continue
    }
    seq++;const p=leg.point||{};
    html+='<tr><td><b>'+seq+'</b></td><td>'+safe(p.destinatario||p.label||'')+'</td><td>'+safe((p.cidade||'')+(p.uf?' / '+p.uf:''))+'</td><td>'+safe(p.ctrc||'')+'</td><td>'+safe(p.nf||'')+'</td><td>'+routePrecision(p)+'</td><td><b>'+routeFmtKm(leg.meters)+'</b></td></tr>'
  }
  table.innerHTML=html+'</tbody>'
}
function routeMove(pos,dir){
  const n=pos+dir;if(n<0||n>=ROUTE_MANUAL_ORDER.length)return;
  [ROUTE_MANUAL_ORDER[pos],ROUTE_MANUAL_ORDER[n]]=[ROUTE_MANUAL_ORDER[n],ROUTE_MANUAL_ORDER[pos]];
  routeRenderManual()
}
function routeRenderManual(){
  if(!ROUTE_PLAN)return;
  const box=$('#routeManualList'),m=ROUTE_PLAN.matrix||[],points=ROUTE_PLAN.points||[],order=ROUTE_MANUAL_ORDER;
  const legs=routeLegs(order),manual=routeDistance(order,m),best=Number(ROUTE_PLAN.optimizedDistanceMeters||0),diff=manual-best;
  if($('#routeManualKm'))$('#routeManualKm').textContent=routeFmtKm(manual);
  if($('#routeDifferenceKm'))$('#routeDifferenceKm').textContent=(diff>=0?'+':'')+routeFmtKm(diff);
  if($('#routeCompare'))$('#routeCompare').innerHTML=diff>50?'A ordem atual acrescenta <strong>'+routeFmtKm(diff)+'</strong> em relação à menor rota. A menor distância continua sendo a referência recomendada.':'A ordem atual está praticamente igual à menor rota encontrada.';
  if(!box)return;
  box.innerHTML=order.map((idx,pos)=>{
    const p=points[idx]||{},leg=legs[pos]||{};
    return '<div class="route-stop"><div class="seq">'+(pos+1)+'</div><div><b>'+safe(p.destinatario||p.label||'')+'</b><div class="meta">'+safe((p.cidade||'')+(p.uf?' / '+p.uf:''))+' • '+routePrecision(p)+'</div><div class="meta">CT-e '+safe(p.ctrc||'—')+' • NF '+safe(p.nf||'—')+'</div></div><div><div class="km">'+routeFmtKm(leg.meters)+'</div><div class="move"><button type="button" data-route-up="'+pos+'" '+(pos===0?'disabled':'')+'>↑</button><button type="button" data-route-down="'+pos+'" '+(pos===order.length-1?'disabled':'')+'>↓</button></div></div></div>'
  }).join('')+'<div class="route-stop"><div class="seq">↩</div><div><b>Retorno à Base Americana</b><div class="meta">Av. do Algodão, 316, Americana/SP</div></div><div class="km">'+routeFmtKm(legs[legs.length-1]?.meters||0)+'</div></div>';
  box.querySelectorAll('[data-route-up]').forEach(b=>b.onclick=()=>routeMove(Number(b.dataset.routeUp),-1));
  box.querySelectorAll('[data-route-down]').forEach(b=>b.onclick=()=>routeMove(Number(b.dataset.routeDown),1))
}
function routeGoogleMaps(){
  if(!ROUTE_PLAN)return;
  const pts=ROUTE_PLAN.points||[],order=ROUTE_PLAN.optimizedOrder||[],base=pts[0];
  const origin=base.lat+','+base.lon,dest=origin,ways=order.map(i=>pts[i].lat+','+pts[i].lon).join('|');
  const url='https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(origin)+'&destination='+encodeURIComponent(dest)+'&waypoints='+encodeURIComponent(ways)+'&travelmode=driving';
  window.open(url,'_blank','noopener')
}
function routeRenderPlan(){
  if(!ROUTE_PLAN)return;
  if($('#routeDeliveries'))$('#routeDeliveries').textContent=nf(ROUTE_PLAN.deliveries||0);
  if($('#routeOptimizedKm'))$('#routeOptimizedKm').textContent=routeFmtKm(ROUTE_PLAN.optimizedDistanceMeters||0);
  if($('#routeApprox'))$('#routeApprox').textContent=nf(ROUTE_PLAN.approximateStops||0);
  if($('#routeMethod'))$('#routeMethod').textContent=(ROUTE_PLAN.method||'otimizada').toUpperCase()+' • '+(ROUTE_PLAN.matrixSource||'');
  const w=$('#routeWarning');
  if(w){
    const n=Number(ROUTE_PLAN.approximateStops||0),rej=(ROUTE_PLAN.rejectedStops||[]);
    const msgs=[];
    if(n)msgs.push(n+' parada(s) estão aproximadas por cidade/endereço incompleto.');
    if(rej.length)msgs.push(rej.length+' parada(s) foram rejeitadas por falta de localização ou por ultrapassarem o raio máximo de 300 km.');
    w.style.display=msgs.length?'':'none';
    w.textContent=msgs.join(' ')
  }
  routeRenderBest();routeRenderManual();routeRenderMap()
}

async function routeRecalculateWithStops(stops){
  const status=$('#routeStatus');
  const meta={
    date:$('#routeDate')?.value||'',romaneio:ROUTE_PLAN?.romaneio||$('#routeManifest')?.value||'',
    motorista:ROUTE_PLAN?.motorista||$('#routeDriver')?.value||'',veiculo:ROUTE_PLAN?.veiculo||''
  };
  const r=await fetch('/api/roteirizador/recalcular',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...meta,stops})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível recalcular a rota.');
  ROUTE_PLAN=j;ROUTE_MANUAL_ORDER=(j.originalOrder||[]).slice();
  if(status)status.textContent=(j.motorista||'Rota manual')+' • '+nf(j.deliveries||0)+' parada(s) válidas • limite de 300 km aplicado.';
  routeRenderPlan();
  return j
}
function routeMergedStops(){
  const base=(ROUTE_PLAN?.stops||[]).filter(x=>x.source!=='manual'&&x.source!=='cte');
  const seen=new Set(),out=[];
  for(const s of [...base,...ROUTE_EXTRA_STOPS]){
    const key=(s.barcode?'B'+s.barcode:'')||(s.ctrc?'C'+s.ctrc:'')||('A'+String(s.endereco||s.label||'').toLowerCase());
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    out.push(s)
  }
  return out
}
async function routeAddManualAddress(){
  const input=$('#routeManualAddress'),msg=$('#routeManualMsg'),raw=input?.value.trim()||'';
  if(!raw){if(msg)msg.textContent='Digite o endereço da entrega.';return}
  const btn=$('#routeAddAddress');if(btn?.disabled)return;if(btn){btn.disabled=true;btn.textContent='Localizando…'}
  try{
    const r=await fetch('/api/roteirizador/endereco?endereco='+encodeURIComponent(raw),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Endereço não localizado.');
    ROUTE_EXTRA_STOPS.push(j.stop);
    if(input)input.value='';
    if(msg)msg.textContent='✓ Endereço aceito ('+Number(j.stop.radiusKm||0).toFixed(1).replace('.',',')+' km da base).';
    await routeRecalculateWithStops(routeMergedStops());
  }catch(e){if(msg)msg.textContent='Erro: '+e.message}
  finally{if(btn){btn.disabled=false;btn.textContent='Adicionar'}}
}
async function routeAddCteBarcode(){
  const input=$('#routeCteBarcode'),msg=$('#routeCteMsg'),raw=input?.value.trim()||'';
  if(!raw){if(msg)msg.textContent='Leia ou digite o código do CT-e.';return}
  const btn=$('#routeAddCte');if(btn?.disabled)return;if(btn){btn.disabled=true;btn.textContent='Consultando…'}
  try{
    const date=$('#routeDate')?.value||'';
    const r=await fetch('/api/roteirizador/cte?codigo='+encodeURIComponent(raw)+'&date='+encodeURIComponent(date),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'CT-e não localizado.');
    const exists=ROUTE_EXTRA_STOPS.some(x=>x.barcode&&x.barcode===j.stop.barcode);
    if(!exists)ROUTE_EXTRA_STOPS.push(j.stop);
    if(input)input.value='';
    if(msg)msg.textContent='✓ CT-e '+(j.stop.ctrc||'')+' • '+(j.stop.destinatario||'destinatário')+' adicionado.';
    await routeRecalculateWithStops(routeMergedStops());
  }catch(e){
    if(msg)msg.textContent='Erro: '+e.message;
  }finally{if(btn){btn.disabled=false;btn.textContent='Consultar';if(input)input.focus()}}
}

async function calculateRoute(){
  const date=$('#routeDate')?.value||'',rom=$('#routeManifest')?.value||'',status=$('#routeStatus');
  if(!rom){
    if(ROUTE_EXTRA_STOPS.length){
      try{await routeRecalculateWithStops(routeMergedStops())}catch(e){if(status)status.textContent='Erro ao calcular rota: '+e.message}
      return
    }
    if(status)status.textContent='Selecione um romaneio ou adicione endereços/CT-es manualmente.';
    return
  }
  const btn=$('#routeCalculate');if(btn){btn.disabled=true;btn.textContent='Calculando…'}
  if(status)status.textContent='Localizando clientes e calculando a menor sequência. Na primeira consulta isso pode levar alguns segundos…';
  try{
    const r=await fetch('/api/roteirizador/rota?date='+encodeURIComponent(date)+'&romaneio='+encodeURIComponent(rom),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível calcular a rota.');
    ROUTE_PLAN=j;ROUTE_MANUAL_ORDER=(j.originalOrder||[]).slice();
    if(ROUTE_EXTRA_STOPS.length){
      await routeRecalculateWithStops(routeMergedStops());
    }else{
      if(status)status.textContent=(j.motorista||'Motorista')+' • '+(j.romaneio||'')+' • '+nf(j.deliveries||0)+' entrega(s) • base fixa em Americana • raio máximo 300 km.';
      routeRenderPlan()
    }
  }catch(e){if(status)status.textContent='Erro ao calcular rota: '+e.message}
  finally{if(btn){btn.disabled=false;btn.textContent='Otimizar rota'}}
}
function setupRoteirizador(){
  const d=$('#routeDate');if(d&&!d.value)d.value=iso(new Date());
  if(d)d.onchange=()=>{ROUTE_PLAN=null;ROUTE_MANUAL_ORDER=[];ROUTE_EXTRA_STOPS=[];loadRouteManifests(true)};
  if($('#routeDriver'))$('#routeDriver').onchange=routePopulateManifest;
  if($('#routeCalculate'))$('#routeCalculate').onclick=calculateRoute;
  if($('#routeAddAddress'))$('#routeAddAddress').onclick=routeAddManualAddress;
  if($('#routeAddCte'))$('#routeAddCte').onclick=routeAddCteBarcode;
  if($('#routeManualAddress'))$('#routeManualAddress').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();routeAddManualAddress()}};
  if($('#routeCteBarcode')){
    const el=$('#routeCteBarcode');
    el.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();routeAddCteBarcode()}};
    let scanTimer=null;
    el.oninput=()=>{
      clearTimeout(scanTimer);
      const digits=el.value.replace(/\D/g,'');
      if(digits.length===44)scanTimer=setTimeout(()=>routeAddCteBarcode(),180)
    }
  }
  if($('#routeUseBest'))$('#routeUseBest').onclick=()=>{if(ROUTE_PLAN){ROUTE_MANUAL_ORDER=(ROUTE_PLAN.optimizedOrder||[]).slice();routeRenderManual()}};
  if($('#routeOpenGoogle'))$('#routeOpenGoogle').onclick=routeGoogleMaps
}

function loadHeavyForTab(tab){
  if(tab==='dashboard'){
    if(hasAnyPerm(['dashboard','agendamentos','agendamentos_copia']))setTimeout(()=>refreshAgCopy(false),80);
  }else if(tab==='dashboards'){
    if(hasAnyPerm(['ssw_saidas','evolucao','cidade_destino']))setTimeout(()=>refreshSswMotoristas(),100);
    if(hasPerm('ssw_atrasos'))setTimeout(()=>refreshSswAtrasos(),450);
    if(hasPerm('receita_ssw'))setTimeout(()=>refreshSswReceita(),700);
    if(hasAnyPerm(['remetentes','remetentes_comparativo']))setTimeout(()=>refreshSswRemetentes(),1000);
    if(hasPerm('final_carregamento'))setTimeout(()=>refreshLoadingRecords(false),1250);
    if(hasAnyPerm(['dashboard','agendamentos','agendamentos_copia']))setTimeout(()=>refreshAgCopy(false),1450);
  }else if(tab==='conferencia'&&hasPerm('final_carregamento')){
    loadingDriverOptions();
    setTimeout(()=>refreshLoadingRecords(true),50);
  }else if(tab==='agendamentos-copia'&&hasAnyPerm(['dashboard','agendamentos','agendamentos_copia'])){
    setTimeout(()=>refreshAgCopy(false),50);
  }else if(tab==='roteirizador'&&hasPerm('roteirizador')){
    setTimeout(()=>loadRouteManifests(false),50);
  }else if((tab==='ssw-motoristas'||tab==='motoristas-evolucao')&&tabAllowed(tab)){
    setTimeout(()=>refreshSswMotoristas(),80);
  }else if(tab==='receita-ssw'&&hasPerm('receita_ssw')){
    setTimeout(()=>refreshSswReceita(),50);
  }else if(tab==='ssw-atrasos'&&hasPerm('ssw_atrasos')){
    setTimeout(()=>refreshSswAtrasos(),80);
  }else if((tab==='ssw-remetentes'||tab==='ssw-remetentes-comparativo')&&tabAllowed(tab)){
    setTimeout(()=>refreshSswRemetentes(),80);
  }else if(tab==='usuarios'&&AUTH?.is_admin){
    setTimeout(()=>loadDashboardUsers(),50);
  }
}
async function start(){
  init();
  $('#err').style.display='none';
  if(hasAnyPerm(['bi2','ssw_saidas','evolucao','cidade_destino','ssw_atrasos','remetentes','remetentes_comparativo','receita_ssw']))checkSsw();
  if(DASH_EMBEDDED){
    document.querySelector('#loading')?.classList.add('hide');
    refreshData(false);
  }else{
    await refreshData(true);
  }

  const view=new URLSearchParams(location.search).get('view');
  const target=view&&tabAllowed(view)?view:firstAllowedTab();
  if(target){
    const b=$('.nav button[data-tab="'+target+'"]');
    if(b)b.click();else openTab(target)
  }else{
    $('#err').style.display='block';
    $('#err').textContent='Este usuário ainda não possui nenhum card liberado.'
  }

  loadHeavyForTab($('.section.active')?.id||target||'');
  setInterval(()=>{if(!document.hidden)refreshData(false)},5000);
  setInterval(()=>{if(!document.hidden&&hasAnyPerm(['bi2','ssw_saidas','evolucao','cidade_destino','ssw_atrasos','remetentes','remetentes_comparativo','receita_ssw']))checkSsw()},60000);
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&hasPerm('ssw_atrasos')&&['ssw-atrasos','dashboards'].includes(t))refreshSswAtrasos()},120000);
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&hasPerm('receita_ssw')&&['receita-ssw','dashboards'].includes(t))refreshSswReceita()},120000);
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&hasAnyPerm(['remetentes','remetentes_comparativo'])&&['ssw-remetentes','ssw-remetentes-comparativo','dashboards'].includes(t))refreshSswRemetentes()},120000);
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&hasAnyPerm(['ssw_saidas','evolucao','cidade_destino'])&&['ssw-motoristas','motoristas-evolucao','dashboards'].includes(t))refreshSswMotoristas()},120000);
  window.addEventListener('focus',()=>refreshData(false));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshData(false)})
}
function openTab(tab){
  if(!tabAllowed(tab))return;
  const b=$('.nav button[data-tab="'+tab+'"]');
  if(b)return b.click();
  $$('.nav button').forEach(x=>x.classList.remove('active'));
  $$('.section').forEach(x=>x.classList.remove('active'));
  const s=$('#'+tab);
  if(!s)return;
  s.classList.add('active');
  const titles={
    'receita-ssw':'Receita SSW',
    'ssw-atrasos':'SSW • CT-es Atrasados',
    'ssw-remetentes':'Entregas por Cliente Remetente',
    'ssw-remetentes-comparativo':'Comparativo de Clientes Remetentes',
    'ssw-motoristas':'SSW • Saídas x Baixas',
    'motoristas-evolucao':'Evolução por Motorista',
    'conferencia':'Final do Carregamento',
    'roteirizador':'Roteirizador SSW',
    'agendamentos-copia':'Consulta de Agendamentos',
    'usuarios':'Usuários e Acessos'
  };
  $('#pageTitle').textContent=titles[tab]||'Dashboards';
  if(tab==='receita-ssw')setTimeout(renderSswReceita,30);
  if(tab==='ssw-atrasos')setTimeout(renderSswAtrasos,30);
  if(tab==='ssw-remetentes'||tab==='ssw-remetentes-comparativo')setTimeout(renderRemetentes,30);
  if(tab==='ssw-motoristas')setTimeout(renderSswMotoristas,30);
  if(tab==='motoristas-evolucao')setTimeout(renderDriverProgress,30);
  loadHeavyForTab(tab);
}
$$('.dash-open').forEach(b=>b.onclick=()=>{if(tabAllowed(b.dataset.open))openTab(b.dataset.open)});
$$('.nav button').forEach(b=>b.onclick=()=>{
  if(!tabAllowed(b.dataset.tab))return;
  $$('.nav button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  $$('.section').forEach(x=>x.classList.remove('active'));
  $('#'+b.dataset.tab).classList.add('active');
  $('#pageTitle').textContent=b.textContent;
  setTimeout(()=>{
    if(b.dataset.tab==='dashboards'){
      setDashboardToday();
      refreshData(false);
    }
    update();
    if(b.dataset.tab==='operacoes')refreshData(false);
    if(b.dataset.tab==='usuarios'&&AUTH?.is_admin)loadDashboardUsers();
    if(b.dataset.tab==='dashboards'){
      renderSswAtrasos();
      renderSswReceita();
      renderRemetentes();
      renderSswMotoristas();
      renderDriverProgress();
      renderForecast();
    }
    loadHeavyForTab(b.dataset.tab);
  },30)
});
['#driver','#branch'].forEach(x=>$(x).onchange=update);
['#from','#to'].forEach(x=>$(x).onchange=()=>{
  refreshData(false);
  loadHeavyForTab($('.section.active')?.id||'dashboard')
});
if($('#remClientA'))$('#remClientA').onchange=renderRemCompare;
if($('#remClientB'))$('#remClientB').onchange=renderRemCompare;
window.onresize=()=>{clearTimeout(window.rz);window.rz=setTimeout(update,150)};
$('#mobile').onclick=()=>alert(/iphone|ipad|ipod/i.test(navigator.userAgent)?'No Safari: toque em Compartilhar e depois em Adicionar à Tela de Início.':'No Chrome: toque no menu ⋮ e escolha Adicionar à tela inicial.');
if($('#shareWhatsapp'))$('#shareWhatsapp').onclick=()=>whatsappShare();
if($('#routeTopBtn'))$('#routeTopBtn').onclick=()=>{if(hasPerm('roteirizador'))openTab('roteirizador')};
if($('#usersTopBtn'))$('#usersTopBtn').onclick=()=>{if(AUTH?.is_admin)openTab('usuarios')};
if($('#logoutBtn'))$('#logoutBtn').onclick=async()=>{try{await fetch('/api/auth/logout',{method:'POST'})}catch{}setDashboardSessionToken('');location.reload()};
if(DASH_EMBEDDED)bootstrapEmbeddedAuth();else bootstrapAuth();
