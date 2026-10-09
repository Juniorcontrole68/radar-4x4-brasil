const DASH_SESSION_KEY='construlog_dashboard_session';
const DASH_EMBEDDED=new URLSearchParams(location.search).get('embed')==='1';
const PORTAL_ORIGIN=location.origin;
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


function ensureFleetNav(){
  try{
    const nav=document.querySelector('.nav');
    if(!nav)return;
    let btn=nav.querySelector('button[data-tab="frota"]');
    if(!btn){
      btn=document.createElement('button');
      btn.type='button';
      btn.dataset.tab='frota';
      btn.textContent='Frota';
      const lot=nav.querySelector('button[data-tab="lotacao"]');
      if(lot&&lot.nextSibling)nav.insertBefore(btn,lot.nextSibling);else nav.appendChild(btn);
    }
    btn.style.display='';
    btn.onclick=()=>{
      document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      const sec=document.querySelector('#frota');
      if(sec)sec.classList.add('active');
      const t=document.querySelector('#pageTitle'); if(t)t.textContent='Frota';
    };
  }catch(e){console.error('Falha ao garantir menu Frota',e)}
}

const PERMISSION_OPTIONS=[
  ['coletas','Controle de Coletas'],
  ['lotacao','Lotação • Coletas e Financeiro'],
  ['frota','Frota • Veículos, manutenção e combustível'],
  ['contas_pagar','Contas a Pagar'],
  ['pdf_notas','PDF • Separador de Notas'],
  ['dashboard','Dashboard principal'],
  ['ssw_saidas','SSW • Saídas x Baixas'],
  ['evolucao','Evolução e previsão por motorista'],
  ['cidade_destino','Entregas por cidade destino'],
  ['roteirizador','Roteirizador de romaneios'],
  ['programacao','Programação de Entregas'],
  ['tracking','Rastreio de Carga'],
  ['final_carregamento','Registro de Carga e Descarga'],
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
let CITY_BUBBLE_DATA=null,CITY_BUBBLE_MAP=null,CITY_BUBBLE_LAYER=null;
let AUTH=null;
function hasPerm(p){return !!(AUTH&&(AUTH.is_admin||AUTH.permissions?.includes('*')||AUTH.permissions?.includes(p)))}
function hasAnyPerm(list){return list.some(hasPerm)}
function tabAllowed(tab){
  const map={
    dashboard:'dashboard',operacoes:'operacional',conferencia:'final_carregamento',programacao:'programacao','roteirizador-teste':'roteirizador','roteirizador-v02':'roteirizador',rastreamento:'tracking',lotacao:'lotacao',frota:'frota','pdf-notas':'pdf_notas',
    agendamentos:'agendamentos','agendamento-teste':'agendamentos',ajudantes:'ajudantes',
    'ssw-motoristas':'ssw_saidas','motoristas-evolucao':'evolucao',
    'ssw-atrasos':'ssw_atrasos','ssw-remetentes':'remetentes',
    'ssw-remetentes-comparativo':'remetentes_comparativo','receita-ssw':'receita_ssw','mapa-cidades':'cidade_destino'
  };
  if(tab==='usuarios')return !!AUTH?.is_admin;
  if(tab==='lotacao')return hasAnyPerm(['lotacao','coletas','financeiro']);
  if(tab==='frota')return !!AUTH;
  if(tab==='roteirizador')return hasPerm('roteirizador');
  if(tab==='agendamentos-copia')return hasAnyPerm(['dashboard','agendamentos','agendamentos_copia']);
  if(tab==='dashboards')return AUTH?.is_admin||PERMISSION_OPTIONS.some(([p])=>hasPerm(p)&&p!=='dashboard');
  return map[tab]?hasPerm(map[tab]):false
}
function applyPermissions(){
  const navMap={dashboard:'dashboard',operacoes:'operacional',conferencia:'final_carregamento',programacao:'programacao','roteirizador-teste':'roteirizador','roteirizador-v02':'roteirizador',rastreamento:'tracking',lotacao:'lotacao',frota:'frota',agendamentos:'agendamentos','agendamento-teste':'agendamentos',ajudantes:'ajudantes'};
  document.querySelectorAll('.nav button').forEach(b=>{
    let show=true;
    if(b.dataset.adminOnly==='1')show=!!AUTH?.is_admin;
    else if(b.dataset.tab==='dashboards')show=tabAllowed('dashboards');
    else if(b.dataset.tab==='agendamentos')show=hasPerm('agendamentos')&&!hasPerm('dashboard');
    else if(b.dataset.tab==='lotacao')show=tabAllowed('lotacao');
    else if(b.dataset.tab==='frota')show=!!AUTH;
    else if(navMap[b.dataset.tab])show=hasPerm(navMap[b.dataset.tab]);
    b.style.display=show?'':'none';
  });

  const cardMap={
    'SSW • Saídas x Baixas':'ssw_saidas',
    'Evolução e Previsão por Motorista':'evolucao',
    'Entregas por Cidade Destino':'cidade_destino',
    'Mapa de Cidades • SSW':'cidade_destino',
    'Registro de Carga e Descarga':'final_carregamento',
    'Programação de Entregas':'programacao',
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
    'SSW / BI2':'bi2',
    'PDF • Separador de Notas':'pdf_notas'
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
    const r=await fetch('/api/painel/auth/users',{cache:'no-store'}),j=await r.json();
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
      const r=await fetch(id?('/api/painel/auth/users/'+id):'/api/painel/auth/users',{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
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
  ensureFleetNav();
  setupUserAdmin();
  setupLoadingForm();
  setupAgCopy();
  setupDeliveryProgram();
  setupTracking();
  setupRoteirizador();
  setupRoteirizadorTeste();
  setupRoteirizadorV02();
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

const S={ops:[],sch:[],help:[],agCopy:[],ssw:null,remetentes:null,receita:null,coletas:null,lotacao:[],sswMotoristas:null},$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const gd=o=>{
  for(const k of ['ENTREGUE','Entregue','DATA ENTREGA','Data Entrega','Data da Entrega','Data','  Data','DATA','DATA LANÇAMENTO','Data Lançamento','Data do Lançamento']){
    const v=o?.[k];
    if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;
  }
  return'';
},g=(o,...k)=>{for(const x of k)if(o[x]!==undefined)return o[x];return''};
const pd=s=>{
  // Lê uma data da planilha (padrão brasileiro: dia/mês/ano). Devolve null quando não reconhece,
  // em vez de adivinhar: uma data lida errado some do período sem ninguém perceber.
  if(s==null||s==='')return null;
  if(s instanceof Date)return isNaN(s)?null:s;
  const serial=n=>{
    // Datas seriais de Excel/Google Sheets (dias desde 30/12/1899).
    const d=new Date(Date.UTC(1899,11,30)+n*86400000);
    return isNaN(d)?null:new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
  };
  const build=(y,m,d)=>{
    y=+y;m=+m;d=+d;
    if(y<100)y+=2000;
    const dt=new Date(y,m-1,d);
    // rejeita datas impossíveis (ex.: 31/02), que o JavaScript "corrigiria" para outro dia
    return(dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d)?dt:null;
  };
  if(typeof s==='number'&&Number.isFinite(s))return serial(s);
  const raw=String(s).trim();
  // dia/mês/ano com barra, ponto ou hífen; ano com 2 ou 4 dígitos; hora opcional depois
  let m=raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?:\s+.*)?$/);
  if(m)return build(m[3],m[2],m[1]);
  // ano-mês-dia (formato ISO), com hora opcional
  m=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if(m)return build(m[1],m[2],m[3]);
  // número puro de 5 dígitos: data serial exportada sem formatação (1954 a 2119)
  if(/^\d{5}$/.test(raw)&&+raw>=20000&&+raw<=80000)return serial(+raw);
  // textos com nome de mês (ex.: "5 out 2026"); formatos só numéricos não reconhecidos ficam sem data
  if(/[a-zA-Z]{3}/.test(raw)){const d=new Date(raw);return isNaN(d)?null:d}
  return null
};
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const num=v=>{
  // Lê um valor da planilha no padrão brasileiro: ponto é milhar, vírgula é decimal.
  if(v==null||v==='')return 0;
  if(typeof v==='number')return Number.isFinite(v)?v:0;
  let s=String(v).replace(/R\$/gi,'').replace(/\s/g,'');
  // negativo: sinal de menos (antes ou depois) ou valor entre parênteses, como nas planilhas contábeis
  const neg=/^\(.*\)$/.test(s)||s.startsWith('-')||s.endsWith('-');
  s=s.replace(/^[(\-]+|[)\-]+$/g,'');
  if(s.includes('-'))return 0; // hífen no meio (ex.: "10-20") não é um valor
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  // sem vírgula: "1.500" e "1.234.567" são milhares (antes viravam 1,5 e 0)
  else if(/^[1-9]\d{0,2}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  s=s.replace(/[^0-9.]/g,'');
  const n=Number(s);
  return Number.isFinite(n)?(neg?-n:n):0
};
const brl=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),nf=v=>Math.round(v).toLocaleString('pt-BR'),safe=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
function driverDisplayName(v){
  const raw=String(v||'').trim().toLocaleLowerCase('pt-BR');
  if(!raw)return'';
  const small=new Set(['da','das','de','do','dos','e']);
  return raw.split(/\s+/).filter(Boolean).map((w,i)=>i>0&&small.has(w)?w:(w.charAt(0).toLocaleUpperCase('pt-BR')+w.slice(1))).join(' ')
}
function normalizeDriverNames(value){
  if(Array.isArray(value))return value.map(normalizeDriverNames);
  if(!value||typeof value!=='object')return value;
  const out={};
  for(const [k,v] of Object.entries(value)){
    const nk=String(k).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const isDriverName=nk==='motorista'||nk==='nomemotorista'||nk==='drivernam'||nk==='drivername';
    out[k]=isDriverName&&typeof v==='string'?driverDisplayName(v):normalizeDriverNames(v)
  }
  return out
}
async function load(n){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),18000);
  try{
    const r=await fetch('/api/sheet/'+n+'?t='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'},signal:ctrl.signal}),j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'Falha ao carregar '+n);
    S.sheetWarnings=S.sheetWarnings||{};S.sheetWarnings[n]=String(j.warning||'');
    return normalizeDriverNames(j.rows||[])
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
    const body=reportRows.length?reportRows.map((r,i)=>{
      const cliente=r.observacao
        ?'<button type="button" class="ag-observation-link" data-ag-observation="'+i+'" title="Ver observação">'+safe(r.cliente||'Cliente sem nome')+'</button>'
        :safe(r.cliente||'—');
      return '<tr><td>'+safe(r.ultimaMovimentacao||'—')+'</td><td>'+safe(r.status||'Sem status')+'</td><td>'+safe(r.notaFiscal||'—')+'</td><td>'+cliente+'</td><td>'+safe(r.cidade||'—')+'</td><td>'+safe(r.mercadoria||'—')+'</td></tr>'
    }).join(''):'<tr><td colspan="6" class="muted">Nenhum registro encontrado para os filtros atuais.</td></tr>';
    reportTable.innerHTML='<thead><tr><th>Última movimentação</th><th>Status</th><th>Nota Fiscal</th><th>Nome do cliente</th><th>Cidade</th><th>Mercadoria</th></tr></thead><tbody>'+body+'</tbody>';
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
  if(!force&&S.agCopy.length&&Date.now()-(window.__agCopyLoadedAt||0)<60000){agCopyPopulateFilters();renderAgCopy();renderAgCopyHub();renderAgStatusCards('#agStatusCards',(S.agCopy||[]).filter(o=>!agCopyOldDelivered(o)));return}
  window.__agCopyLoading=true;
  const info=$('#agcInfo');if(info)info.textContent='Atualizando dados da Cópia de AGENDAMENTOS…';
  try{
    const r=await fetch('/api/sheet/agendamentos_copia?t='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
    const j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível carregar a Cópia de AGENDAMENTOS.');
    S.agCopy=j.rows||[];window.__agCopyLoadedAt=Date.now();
    agCopyPopulateFilters();renderAgCopy();renderAgCopyHub();renderAgStatusCards('#agStatusCards',(S.agCopy||[]).filter(o=>!agCopyOldDelivered(o)))
  }catch(e){
    if(info)info.textContent='Não foi possível carregar os agendamentos: '+e.message;
    const h=$('#hubAgCopyInfo');if(h)h.textContent='Consulta de agendamentos indisponível: '+e.message;
    const table=$('#agcTable');
    if(table)table.innerHTML='<thead><tr><th>Última movimentação</th><th>Status</th><th>Nota Fiscal</th><th>Nome do cliente</th><th>Cidade</th><th>Mercadoria</th></tr></thead><tbody><tr><td colspan="6" class="muted">Relatório de status indisponível: '+safe(e.message)+'</td></tr></tbody>';
    renderAgStatusCards('#agcStatusSummary',[])
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
function inper(d){const f=$('#from').value?new Date($('#from').value+'T00:00:00'):null,t=$('#to').value?new Date($('#to').value+'T23:59:59'):null;if((f||t)&&!d)return false;return(!f||d>=f)&&(!t||d<=t)}
function ops(){const d=$('#driver')?.value||'',b=$('#branch')?.value||'',rows=Array.isArray(S.ops)?S.ops:[];return rows.filter(o=>inper(pd(gd(o)))&&(!d||g(o,'Motorista')===d)&&(!b||g(o,'Filial')===b))}
function help(){const rows=Array.isArray(S.help)?S.help:[];return rows.filter(o=>inper(pd(g(o,'Data'))))}
function sch(){const rows=Array.isArray(S.sch)?S.sch:[];return rows.filter(o=>inper(pd(g(o,'DATA AGENDADA'))||pd(g(o,'DATA CONTATO'))))}
function filters(){const driver=$('#driver'),branch=$('#branch'),rows=Array.isArray(S.ops)?S.ops:[];if(!driver||!branch)return;const curD=driver.value,curB=branch.value,ds=[...new Set(rows.map(o=>g(o,'Motorista')).filter(Boolean))].sort(),bs=[...new Set(rows.map(o=>g(o,'Filial')).filter(Boolean))].sort();driver.innerHTML='<option value="">Todos motoristas</option>'+ds.map(x=>'<option>'+safe(x)+'</option>').join('');branch.innerHTML='<option value="">Todas filiais</option>'+bs.map(x=>'<option>'+safe(x)+'</option>').join('');if(ds.includes(curD))driver.value=curD;if(bs.includes(curB))branch.value=curB}
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

function financeDateOfRow(o){return pd(gd(o))}
function financePaid(o){return num(g(o,'Frete Mot Liq',' Frete Mot Liq','Frete Pago','FRETE PAGO'))}
function financeReceive(o){return num(g(o,'Frete Vialog Liq',' Frete Vialog Liq','Frete a Receber','Frete A Receber','FRETE A RECEBER'))}
function financeRowsBetween(fromIso,toIso){
  const from=fromIso?new Date(fromIso+'T00:00:00'):null,to=toIso?new Date(toIso+'T23:59:59'):null;
  return (S.ops||[]).filter(o=>{
    const d=financeDateOfRow(o);if(!d)return false;
    return(!from||d>=from)&&(!to||d<=to)
  })
}
function financeAgg(rows){
  const receive=(rows||[]).reduce((s,o)=>s+financeReceive(o),0),paid=(rows||[]).reduce((s,o)=>s+financePaid(o),0),profit=receive-paid;
  return{receive,paid,profit,profitPct:receive?profit/receive*100:0,costPct:receive?paid/receive*100:0}
}
function financeDriverRows(rows){
  const map=new Map();
  for(const o of rows||[]){
    const name=String(g(o,'Motorista')||'Sem motorista').trim()||'Sem motorista';
    if(!map.has(name))map.set(name,{motorista:name,receive:0,paid:0,registros:0});
    const x=map.get(name);x.receive+=financeReceive(o);x.paid+=financePaid(o);x.registros++
  }
  return[...map.values()].map(x=>{
    const profit=x.receive-x.paid;
    return{...x,profit,profitPct:x.receive?profit/x.receive*100:0,costPct:x.receive?x.paid/x.receive*100:0}
  }).sort((x,y)=>x.motorista.localeCompare(y.motorista,'pt-BR',{sensitivity:'base'}))
}
function financeWeekIndex(d){return Math.min(5,Math.floor((d.getDate()-1)/7)+1)}
function financeMonthLabel(d){return d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}).replace('.','')}
function financeMonthRows(year,month){
  return(S.ops||[]).filter(o=>{const d=financeDateOfRow(o);return d&&d.getFullYear()===year&&d.getMonth()===month})
}
function financeWeeksForMonth(year,month,maxDateIso=''){
  const rows=financeMonthRows(year,month),weeks=Array.from({length:5},()=>[]);
  const maxDate=maxDateIso?new Date(maxDateIso+'T23:59:59'):null;
  for(const o of rows){
    const d=financeDateOfRow(o);if(!d||maxDate&&d>maxDate)continue;
    weeks[financeWeekIndex(d)-1].push(o)
  }
  return weeks.map(financeAgg)
}
function financeMoneyLabel(v){
  const n=Number(v||0),a=Math.abs(n);
  if(a>=1000000)return'R$ '+(n/1000000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mi';
  if(a>=1000)return'R$ '+(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil';
  return'R$ '+n.toLocaleString('pt-BR',{maximumFractionDigits:0})
}
function financeDualBars(id,labels,A,B,legendA='A receber',legendB='Pago'){
  if(!labels.length)return empty(id);
  const{x,w,h}=cv(id),p={l:52,r:12,t:52,b:72},cw=w-p.l-p.r,ch=h-p.t-p.b,m=Math.max(...A,...B,1),groupW=cw/Math.max(labels.length,1),gap=Math.max(3,Math.min(8,groupW*.08)),bw=Math.max(10,Math.min(34,(groupW-gap*3)/2));
  x.strokeStyle='#e2e8f0';x.strokeRect(p.l,p.t,cw,ch);
  x.font='700 11px Segoe UI';x.textAlign='left';x.textBaseline='middle';
  x.fillStyle='#0f766e';x.fillRect(p.l,16,12,12);x.fillStyle='#475569';x.fillText(legendA,p.l+18,22);
  x.fillStyle='#0284c7';x.fillRect(p.l+120,16,12,12);x.fillStyle='#475569';x.fillText(legendB,p.l+138,22);
  labels.forEach((label,i)=>{
    const cx=p.l+(i+.5)*groupW,va=Number(A[i]||0),vb=Number(B[i]||0),ha=va/m*ch,hb=vb/m*ch;
    const ax=cx-gap/2-bw,bx=cx+gap/2,baseY=h-p.b;
    x.fillStyle='#0f766e';x.fillRect(ax,baseY-ha,bw,ha);
    x.fillStyle='#0284c7';x.fillRect(bx,baseY-hb,bw,hb);
    const drawValue=(v,barX,barH)=>{
      if(!(v>0))return;
      const txt=financeMoneyLabel(v);
      x.save();x.font='700 9px Segoe UI';x.textAlign='center';x.textBaseline='middle';
      x.fillStyle=barH>=18?'#fff':'#172033';
      x.translate(barX+bw/2,baseY-barH/2);x.rotate(-Math.PI/2);x.fillText(txt,0,0);
      x.restore()
    };
    drawValue(va,ax,ha);drawValue(vb,bx,hb);
    x.save();x.translate(cx,baseY+10);x.rotate(-Math.PI/4);x.textAlign='right';x.fillStyle='#64748b';x.font='11px Segoe UI';x.fillText(String(label).slice(0,18),0,0);x.restore()
  })
}
function financeMultiLines(id,labels,series){
  if(!labels.length||!series.length)return empty(id);
  const{x,w,h}=cv(id),p={l:48,r:14,t:62,b:42},cw=w-p.l-p.r,ch=h-p.t-p.b;
  const vals=series.flatMap(s=>(s.values||[]).filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))).map(Number));
  if(!vals.length)return empty(id);
  const min=Math.min(0,...vals),max=Math.max(10,...vals),span=Math.max(1,max-min),colors=['#0f766e','#0284c7','#d97706','#7c3aed'];
  x.strokeStyle='#e2e8f0';x.strokeRect(p.l,p.t,cw,ch);
  x.font='700 10px Segoe UI';x.textBaseline='middle';
  let lx=p.l;
  series.forEach((s,i)=>{x.fillStyle=colors[i%colors.length];x.fillRect(lx,18,12,12);x.fillStyle='#475569';x.fillText(s.label,lx+17,24);lx+=Math.max(88,x.measureText(s.label).width+32)});
  const py=v=>p.t+ch-(Number(v)-min)/span*ch;
  series.forEach((s,si)=>{
    x.strokeStyle=colors[si%colors.length];x.fillStyle=colors[si%colors.length];x.lineWidth=2;x.beginPath();let started=false;
    (s.values||[]).forEach((v,i)=>{
      if(v===null||v===undefined||!Number.isFinite(Number(v)))return;
      const px=p.l+(labels.length===1?cw/2:i*cw/(labels.length-1)),yy=py(v);
      if(!started){x.moveTo(px,yy);started=true}else x.lineTo(px,yy)
    });x.stroke();
    (s.values||[]).forEach((v,i)=>{
      if(v===null||v===undefined||!Number.isFinite(Number(v)))return;
      const px=p.l+(labels.length===1?cw/2:i*cw/(labels.length-1)),yy=py(v);
      x.beginPath();x.arc(px,yy,3,0,Math.PI*2);x.fill()
    })
  });
  labels.forEach((label,i)=>{const px=p.l+(labels.length===1?cw/2:i*cw/(labels.length-1));x.fillStyle='#64748b';x.textAlign='center';x.font='11px Segoe UI';x.fillText(label,px,h-16)});
  x.textAlign='right';x.fillStyle='#64748b';x.font='10px Segoe UI';x.fillText(max.toFixed(0)+'%',p.l-5,p.t+4);x.fillText(min.toFixed(0)+'%',p.l-5,p.t+ch)
}
function financeSet(id,v){const e=$(id);if(e)e.textContent=v}
function financeRender(){
  if(!$('#financeDriverPanel'))return;
  const from=$('#financeFrom')?.value||'',to=$('#financeTo')?.value||'';
  const rows=financeRowsBetween(from,to),tot=financeAgg(rows),drivers=financeDriverRows(rows);
  financeSet('#financeReceive',brl(tot.receive));financeSet('#financePaid',brl(tot.paid));financeSet('#financeProfit',brl(tot.profit));
  financeSet('#financeProfitPct',tot.profitPct.toFixed(1).replace('.',',')+'%');financeSet('#financeDriverPct',tot.costPct.toFixed(1).replace('.',',')+'%');
  const profitPctEl=$('#financeProfitPct'),driverPctEl=$('#financeDriverPct');
  if(profitPctEl)profitPctEl.classList.toggle('finance-target-bad',tot.profitPct<55);
  if(driverPctEl)driverPctEl.classList.toggle('finance-target-bad',tot.costPct>45);
  const info=$('#financeInfo');
  if(info){const at=S.opsUpdatedAt?new Date(S.opsUpdatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
    // Linhas com algo escrito na data, mas que não foi possível ler: ficam fora de qualquer período.
    const semData=(S.ops||[]).filter(o=>{const v=gd(o);return String(v??'').trim()!==''&&!pd(v)});
    if(semData.length&&window.__opsSemDataAviso!==semData.length){window.__opsSemDataAviso=semData.length;console.warn('Lançamentos com data não reconhecida:',semData.slice(0,10).map(o=>gd(o)))}
    info.textContent=nf(rows.length)+' lançamento(s) • '+nf(drivers.length)+' motorista(s) • período '+(from?from.split('-').reverse().join('/'):'início')+' a '+(to?to.split('-').reverse().join('/'):'hoje')+' • fonte atualizada às '+at+' • base: ENTREGUE / Frete Mot Liq / Frete Vialog Liq'+(semData.length?' • ATENÇÃO: '+nf(semData.length)+' lançamento(s) com data não reconhecida ficaram fora (ex.: "'+String(gd(semData[0])).slice(0,20)+'")':'')};
  const tableRows=drivers.map(x=>({
    motorista:x.motorista,pago:brl(x.paid),receber:brl(x.receive),lucro:brl(x.profit),
    lucroPct:x.profitPct.toFixed(1).replace('.',',')+'%',custoPct:x.costPct.toFixed(1).replace('.',',')+'%'
  }));
  if($('#financeDriverTable')){
    const previous={};
    $$('#financeDriverTable [data-fin-pdf-col]').forEach(c=>previous[c.dataset.finPdfCol]=c.checked);
    const cols=[
      ['motorista','Motorista','motorista'],
      ['pago','Frete pago','pago'],
      ['receber','Frete a receber','receber'],
      ['lucro','Lucro','lucro'],
      ['lucroPct','% lucro','lucroPct'],
      ['custoPct','% custo motorista','custoPct']
    ];
    const head=cols.map(c=>'<th>'+safe(c[1])+' <input type="checkbox" data-fin-pdf-col="'+c[0]+'" '+(previous[c[0]]===false?'':'checked')+' title="Incluir esta coluna no PDF" aria-label="Incluir '+safe(c[1])+' no PDF"></th>').join('');
    const body=tableRows.map(r=>'<tr>'+cols.map(c=>'<td>'+safe(r[c[2]])+'</td>').join('')+'</tr>').join('');
    $('#financeDriverTable').innerHTML='<thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody>'
  }

  const top=drivers.slice(0,12);
  financeDualBars('#financeDriverChart',top.map(x=>x.motorista),top.map(x=>x.receive),top.map(x=>x.paid),'A receber','Pago');

  const anchor=to?new Date(to+'T12:00:00'):new Date(),ay=anchor.getFullYear(),am=anchor.getMonth();
  const monthWeeks=financeWeeksForMonth(ay,am,to);
  financeDualBars('#financeWeeksChart',['Semana 1','Semana 2','Semana 3','Semana 4','Semana 5'],monthWeeks.map(x=>x.receive),monthWeeks.map(x=>x.paid),'A receber','Pago');

  const compare=[];
  for(let back=0;back<4;back++){
    const d=new Date(ay,am-back,1),isCurrent=back===0;
    const weeks=financeWeeksForMonth(d.getFullYear(),d.getMonth(),isCurrent?to:'');
    compare.push({label:financeMonthLabel(d),values:weeks.map((x,i)=>{
      if(isCurrent&&i+1>financeWeekIndex(anchor))return null;
      return x.receive?x.profitPct:null
    })})
  }
  financeMultiLines('#financeCompareChart',['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5'],compare);
  const ci=$('#financeCompareInfo');
  if(ci)ci.textContent='Comparação da margem de lucro semanal de '+financeMonthLabel(anchor)+' com os 3 meses anteriores. Cada ponto usa (frete a receber − frete pago) ÷ frete a receber.'
}
function financeExportPdf(){
  const from=$('#financeFrom')?.value||'',to=$('#financeTo')?.value||'';
  const rows=financeRowsBetween(from,to),agg=financeAgg(rows),drivers=financeDriverRows(rows);
  const fmtDate=v=>v?v.split('-').reverse().join('/'):'—';
  const pct=v=>Number(v||0).toFixed(1).replace('.',',')+'%';
  const defs=[
    {key:'motorista',label:'Motorista',value:x=>x.motorista},
    {key:'pago',label:'Frete pago',value:x=>brl(x.paid)},
    {key:'receber',label:'Frete a receber',value:x=>brl(x.receive)},
    {key:'lucro',label:'Lucro',value:x=>brl(x.profit)},
    {key:'lucroPct',label:'% lucro',value:x=>pct(x.profitPct)},
    {key:'custoPct',label:'% custo motorista',value:x=>pct(x.costPct)}
  ];
  const selected=new Set($$('#financeDriverTable [data-fin-pdf-col]:checked').map(x=>x.dataset.finPdfCol));
  const cols=defs.filter(c=>selected.has(c.key));
  if(!cols.length){alert('Marque pelo menos uma coluna para exportar no PDF.');return}
  if(!window.jspdf?.jsPDF){alert('O gerador de PDF ainda não carregou. Atualize a página e tente novamente.');return}
  const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const fileName='Relatorio de Pagamento de Motoristas Periodo '+fmtDate(from).replaceAll('/','-')+' a '+fmtDate(to).replaceAll('/','-')+'.pdf';
  try{doc.addImage('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABlASwDASIAAhEBAxEB/8QAHAAAAgMBAQEBAAAAAAAAAAAAAAYEBQcDAgEI/8QARxAAAQMDAgMEBQcICgEFAAAAAQIDBAAFEQYSEyExIkFRYQcUcYGRFjJVk6Gx0RcjNUJSdLLBFTM0NlRicnOSlMIkQ1N14v/EABoBAQADAQEBAAAAAAAAAAAAAAABAgMGBAX/xAAsEQACAgEDAgQFBQEAAAAAAAAAAQIRAwQSIRMxMkFRYQUicZHwFIHB0eGh/9oADAMBAAIRAxEAPwDZqKKKAKKKKAKKKKAKKKKAKKKKAKwrVUyRN1LPVIdUvhvrQgE8kpBwAK3WsXuVhn3DUVwMeFIcSZLhKyA2gDceZUeWPOtcXcyy3SFuim9rTdut6FuT3RKebQ8SxHJ2hTSQpSVLPtA5Cp7pt8jMF60xRFD2xIaRtcQPVw5kL6k58c1ruMdog0y6BmSI2rYjLTqktvlSHEZ5KG0nmPaK5TtKu8JUm0uGayEIWtrGHmgpO4Ap/W5d6fA150Ry1nbgeRDiv4VUbTiwk1JD/rqU8gxYyHFJbWFKUAcbiMYzShxFftn40068/tUP/Qr7xVX6xJiWuD6q2n84lZWeClZJ3EdSDXKatbs87fb/AA7bQvZpYUu9/wA/0VXEV+2fjRxFftn41bRZtxkyUtKU20kgqUtUVHZSBkn5vhXu4PJctSlKeQ6l1SFMKLCW1jG4LB2ju5fEV51jTi2n+fc9bytSUWl9/wDCnS862sLQ4tKknIIUQRTjqi5S2vR8ZbTpQ+620FLTyPaIBxSXWkxLfFuemocWYwl5lTTZKFEgHGCOlfQ+Fups+V8ainjjXcwonnkn40VrenLHAmRpivVIzSmrg82FpjoKtiTgAZBA+FdLzoC03ItvKcEJ4clrYQlKXPDKemfZXRdRXRyvTdWZBRT/AHT0YLj251+3zVS3m+0looAKx3gc+vhSEtCm1qQtJStJIUkjBBHdVlJPsUcWu5rPozmyJenXG33FOCO+UNlRyQnAOPtNONI/oq/QUv8Aef8AxFPFeafiZ6YeFBRRRVS4UUUUAUUUUAUUUUAUUUUAUUUUAUUUUAUUUUAUUUUAUUUUAUk6jlIk6fuSm0FIBWg5GCSl5Ap2pOvkRt62zocRTfEc3nYp0DtF1Cj1PkatHuUn2F2UoNyFLUlBT65OyHPmkdgHPuzQJrDhKmm4Tu0FxSkuEEdnaScLH6vL2V2u1vlCPIdbQ0+EyJS0oS4lRWFlG3kDk5waXrTZrol6UpVsfOY6wlKmlYUo4wmtlVGLtMu48ptUyKYwbQUvIJUy8VY2tLSkcycYFSY+HNW6WlKSnjyI255wDBcVs6nxPPrVdpjTt1akKXJhPx0JUF7nGV8wEqHLAPPJFWbLJiav0vCWcrjsFCjtIBO0jlnn3VDolWXes5SI8mKFRI7+5CuboJxzHTBFVdqvDjz3qaGWmGi24RwVLTghJOR2vEVaaznSIcmKlhaUhSFE5QlXePEVWm8qjW6Mt1lLy5CF7lDCMDJTgYHhXO5pJaiTuq9vodXp4N6WC23d1z9fLsd5z0mYmfGYbLrjTgZSlKlKUEHmonJP7IHLxqt9Rls2iS1NjrYS2Q60pwY7WQCke0H7KkJuTd5kNx34u1I3OKKXOatqScZxmol2cbmMR7glnhLfUsLSFlQ7O0DGfbWGSUZJzTv8+nlaPTijOLWNquz9f586fkVlalZf0JC/2EfdWW083NzhaCacJlAIZaJ9UxxOo6Zr0fDOckjzfGXWKP1O2j/7Hcv/ALOR/FVRfLU1Jak2ybdo7AcAcbedX+vxFK5gnPzVbfd7qYG32bchuPFMFpS08R1DzwbWVHqSADzPea4XrURtFoenSojLzadqQlp/fuJOO9PLxr7qu+DmWlXInu6Het1mflK1E0mOkpXxm0rIT3fqk+NK96jscf1mLLEpKkjir2rBK8do9oDqa0y5ab/pIKftsxqFHlxil2LwgErKgSFHB68x3d1USPR1KRtVKlxBGCgXDxFdM8+4ffWkZ+rMpQ9EWHoq/QUv95/8RTxSR6LU7bLNSDnbLIz49kU71lPxM1h4UFFFFVLhRRRQBRRRQBRRRQBRRRQBRRRQBRRRQBRRRQBRRRQBRRRQBRRRQBSPdrRrZi7PPWi58WK4srQhxY/N5/VwodB5U8UVKdENWILjPpKWnaHoyPNPDB+6oL1k9Ir/z57nP9mUE/ditMoq2/wBiuz3Mle0RrKQcvuqd/wBczP3mrTSOg7pbr6zcbiWmkR8lKUL3KWSCPcOdaNRUvI6ohY0nYv6osL93Qy7FUnitZG1RwFA+fuqoasV9bjtsKgQXktZ2F3CiMnJ55p3orwT0mOc3PlNn0sWuy48ax0ml6iSLHfUuIcbt8BpSDnLeBkYwQefQg1ylaavUlLbaYcdlpoHY225yGep5nNPdFUehxtU2/wA/Y0XxLKnaS/7/AGZ6jRt3UsJUhpAPVRczj4U2XGy+tacNrbLalobSGy7naVJxjOCD3VbUVtg00MDbiYanWZNSkp9kZHJ9H2oX1lXqERJ/aTIJz/yJrzH9H+pY7m/1OK4kjCkOPApUPPFa9RXs6jPn9KJk9y0Vq66z3JslmPxV4GEPBISAMAAeGK9K0hrZdrFrU4kwgchkvp29c+3GeeK1ainUZPTQv6N087pyzGNIcSt91wuObPmp5AYHj0pgooqjduy6VKgoooqCQooooAooooAooooAooooCuvN8gWGH6zPe2A8kISMqWfACkeT6WHOIRFtKdncXXeZ9wFK2rL05fL/ACJClkstqLbCe5KAf59aZNI+j5i525Fxuq3A28MtMtnaSnxJ8/CtlGMVcjBzlJ1E+flXn/Rcf6xVWVr9KcR94N3KEqKlRxxW1b0j2jAP31YH0aacII4ckefHNIWqtJSNPT0oZ4kiK8CWlhOSMdQcd9StkuA98eWbE5PiNQTOXIbEUI38Xd2dvjmke4+lWO08UW63qfQP/cdXsB9gwTVbo1D15s1x0zObcDam+LGUtJGxWe734Pxqs0ho9zUUt4yVqZixlbXSn5ylfsj+ZqFGKuyXOTqi2/KvP+i4/wBYqpEX0sK4gEy1AI71Mu5I9xH86u/ya6c/+KR9eaV9ZaDassI3K2OOKjoIDrThyUA8sg+GaLY+CH1FyOMrV7Qswu9siKuMVP8AXcNzatn/AFJIqHYvSJbrxPEN5hUJa+TSnFgpWfDPcaRNEXhdq1Ey0TmNMUGXkHoc8gfcT99c9XWNVmv0ttlpQiBaVIUBySFDITn3Ee6p2K6G91Zt1V99uybHZ37itkvJZ25QFYJyoDr76StFa8zw7VeXefJLMlR+CVfj8aYtf/3Ln+xH8aaz21KmabrjaKm3+k5ifcY0MWt1BkOpbCi6DtycZ6Vbam1pA02tMdba5MpSdwaQQNo8Se6so07/AHltn721/EKk6zW45q+5FwnIewM+AAx9ladNbqMupLbYyr9LEo52WhoeG54n+VePyrz/AKLj/WKqv0VY7BeEyP6Wl7H0KAbZ4obynHXz502/IDSX7S/+1R7E6olb2rsgXf0kTLbMSwi3MLCmGnMlZHNSArH21B/KvP8AouP9YqmWZo3TM99Lz6yVhtDY2ycckgJH2Cq+96BsEGxTZkdp7iMsLcQS8SMgZFVTh6EtT9Sq/KvP+i4/1iqPyrz/AKLj/WKpIhtpemsNLztcdSlWPAkCnbVVm0zpd+M0q1yZPHSpWRLKduCPI+NXcYp1RRSk1dli16Rpbmn5FzNvZC2ZKGQjecEKSTn7KgflXnfRUf6xX4VK0tC05f7NMiGG5DYD6FqSuXuKlBJwQcDxqy+QOkv21f8AaqvyJ8ov87XDKRHpYlhY32lkp7wl0g/dTOrW8JWllX1hhbiW1htxgqAUhRIGM+/NZJdY7ES7S48ZziMNPKQ2vOdyQeXPvq4tqHBoK9OFJ4SpDASe4kHn94qzhEopy7DpaPSQxdrtGgJtjjRkL2BZdBA92Kdaw3R/97rZ/vj7jW5Vnkik+DXHJyXJDu1wTarVJnqbLgjtlZQDgnHnSdH9KceRKZYFpdSXXEozxhyyceFMmr/7pXP93VWK239Kw/3hv+IVMIprkrOTT4Nen6zagznophLWWVFO4OAZ+yiZrJuHLXHMBxZRjtBY55GfDzpU1B+nZ3+6a0qOhJjNEpB7Ce7yr42HJmzTnFSqn6fU6DUYdPp4Y5uF2vV+ws/Ltr6Od+sH4UfLtv6Nd+sH4V11PqE21wQoSUccjK1lOdgPTHnS/GRqK5JL0dUpxJPz9+0H2c6zyZ8sZ7Izt+yRth0uCePqSxqKfrJl38u2/o136wfhR8u2vo536wfhVHJ+UNr2uyFymhnkor3J/mKZdM6gF0Co0tKBJQncFAABY/GmLPlnPZKdP3SIzabBjx9SONSXtJkb5dtfRzv1g/Cj5dt/Rrv/ADH4VXXrVMmTJWzb18FhJwFIHaX557hXFu36ndQFpTLweY3O4PwJqj1OZyahJyr0ijSOj06ipZIKN+smW/y7b+jnfrB+FHy7a+jnfrB+FUQul7s8oJfcdSocy2/2goe/+VPFpukW6wESUhCCeytBx2VDqK1wZcuVuO+n7pGOpwYcEVPpWn5qTMKmR3Isx+M6CFtOKQrPiDitq0fco9y0zCUwpO5lpLTiB1SpIx/LPvpa13oqRNkqu9qb4jih+fYT1UR+snxPiKQI0242eSoxn5EN7ooJJSfYRX3nU0cyrxyP0BSrqnXMfTktqIiOJbyk7nEhzbwx3Z5HmazdesdRLSUm8SMHwIB+IFQ4VtuV7l7IrD0p5ZypfM+9Sj099VWOu5Z5b7GpaY1udRzH2Tb/AFZphouLdLu4Dn06Dz+FQfRvd4z4uUPclLy5S5CEk/OSrw9mPtqTF0bKtmjZdugyEJuMtOXnT0V/kB7hjIz5mswkRLjZJgD7T8OQ2cpVzSR5g/hRRjK0g5SjTZ+gKWtfXGPB0rKadUOJKTwmkd5J6n3DnWZDWWokp2i8SMeZB/lUB6RcbzLCnXJE2QrkM5Wr2AUWOnbDy2qR0sUdcq/QGGwdy5COndzBJ+FbChES63u8wn2kPNJZYbcSoZBJCz/MUmWO1fIyIq9XSOt24OIKYkRCSpSc9SrHT+Q86tfRs5MkO3iVNQ4Hn3ULUVoKcntdM1M+eRDjhinq7R0jTr5fY3PW9Z7LnUtn9lX499eEavku6VlWKbueCkpEd3PNOFA7T4jA5Vsr7DUlhbD7aXGnBtUhQyCKybV+hn7M8ZdubW/BWfmpBUpk+B8R50jJS4YnBx5RRad/vLbP3tr+IU86vt+lbrcnHHb03Ant9h3slQUR4jx880l6fhyk6jtqlRXkpEpsklsgDtDyq+9IWm5ke9O3VhhbsWThSlITnhqxg58uWc1Z+LuVXh7Hm3ej9i8JcVb9QxpKWiAspZV2c9O+pn5JpX0sz9SfxpLgXW4Wl1TkCW7GUsYVsOM+0VYfLPUf0u/9n4Uan5MhOHmj7qfSsnTDzCX3230PglC0AjpjIIPtFd9O3qY3CudrW8tyK9BeIQo5CFBJOR4VTTblPuryXJsp6S4kYSVqzgeVMendNTha7pdpEZxttMF1DCVJIU4pScZA64xn41L7ckLvwLdu/ScT/fR/EKefSyB6xbD37HfvTSZb4UsXKKTFfADyMktK/aHlTv6VWHnn7ZwmXHMJczsQTjmnwqH4kSvAxf0po75UR5Dvrvq/AWE44e7ORnxFX/5Jj9MD/r//AKqX6K2XWYFwDrS2yXk43pIzy86fKzlOSdI0hCLjbMVvrczTV4VBdbt7+1KVpV6k3hST5Y8qY3bmdSejKaW4rTDsNad7bCdqCAQcgd3LPwqs9JMaQ7qvc2w6tPq6BlKCR1NX3ovjLFpuLUlhSUrdAKXEEbht59as/CmVS+ZxM/sM5u2X6FNdBLbLwUvHh0P2VvDLzUllDzDiXG1jclaTkEVlOpvR9Pt0hb9qZXLhqOQhHNbfljvHmKoIz1/toLUVVxjDvQgLSPhUySnymItw4aNS1/dY8DTMmOtY48tPDbbzzOep9gFZVYIq5moIEdsEqXIR07gDkn4CvSLbfLxKz6pNlPK5Fa0qJ95PStJ0Too2EmfPKVTlp2pSk5DQPXn3k04hEczkUGoP07O/3TWlxv7K1/oT91Z3fIMty+TFoivKSp0kENkg14S7f0Y2quA29B265rDn6GSbcW7Z12o0y1OHGlJKl/CPGoCs36bxM54p+Hd9laPBDIgMCPjhcNOzHTGKTrhb37+0mfHjrampQBIYWgp34/WST1qBFmX+1oMdhMltIPzFNEgezIq2LJ+nySk02peZTPh/VYYQjJKUe6f59h7u4ZNoliRjh8JWc+zl9tZxay6Jn5nO/hOdP9BqXKk3+7AMPIkupz8wNEAnzwKZNMacXbt0uakcdadqW+uwHrnzNWm3q80XFNJeZXGo6HTyU5Jt+SFjTQZN/iB/G3cduem7HL7afbwq4pg5taUqkbxyVjp39aTr1peZBkqdhNLejk7k8PmpHkR/OvDd71I0gIC5BCeXaYyfiRVcOR6eMsWRNe6L6jEtXOObFJOvJkm5S9Qs8P8ApCNFUVZ2BbSFnkMnHuquRqOa2MIaiJHXCY6RVvZLdc7rcjPufF2IbUlJdGMkgjAHhzqhNjuoJH9HyDjl/VmscnW4nG6f3N8PQt457bVdu3malXNxhl05caQsjvUkGulVT96TGcufFZJRAQhfZPNe4E48vCuiRybJ/qcX/DNf8BXRCENp2oSEjwAxVLJvcu1JSu6RWkocQtSPV3CohSU7tpyB1APPyqLP1BMisymZAjNPpjrcSGHsrQpKd20hSefLPMZ9lTTItDNXlbaHE7XEJWPBQzVLHvMpdyMHgsoxlKA84UuLATkLHLCgT4HIrynUEhmMmTMYZS0ZDrKuGokgNhZJ5j/J9tRTJtFx6nF/wzX/AAFem2Wms8NpCM9dqQKgwpd0eUy4/DYTHfTu/NvZU1yyN2QAfdXizXsXZ2Qgs8LhkKZO7PFaJISvyyUnl7KUxaLWik13Xa401DciEngeuPsOLQSShDeO3j35Psr05q66LhszIsOG4y9NMRJU6oEq3EJPIdCBmp2sjehwopPOsJ6LpNguR4aVQ0KKk8Re5ZDe47ezjGfEipT+rVRYtokvR08OdGcfd2k5Rtb34Hj4U2sbkM1FJyNazEb/AFqDGbK4ipDKEydyxhG9IUMDqPDNcvl3IZt8Sa9Fjutvv8NaY6llSE7dx5EDJHly86bGRvQ4qix1HKmGifEoFfPU4v8Ahmv+ApUe1jPXBkz4MWI9GYm+rBSnVArBKQlQwP8ANzqQ1qa4/KZNlkMQm1pDfEIcWSrcMkJ7Pd54ptY3IZER2GzlDLaT4hIFdaqF3lwX5y2hLSQ2hCsqKty8gnlgYGMd5qGjVqHLLEmJjH1iQ8lpTG7+ryRlWfDBB948aimWtDHRS/dtTi06mg2x5pIjym8qeKsbDkgeWM4+NV7GujIt10mIiJ/9M+hmKjccvlZwnPhnrU7WRuQ4UUqP6rnnTka7xIkZQK+FJbccUC25uCcDA58/soOqLk3qEWd6PBQ4hCFL/OLO4kZIT2e7zxTaxuQ10UiRfSDLehPvmBHWpuKuQOE6o8MpONq+XLPdVnJ1h6ve4UEx0ll1DfrL27+pW4DsH2fbTaxvQ0UUoT9ZTIqXi3AbKW5rsYvLUoNoCACCogHBOfZU+4X+YzEtK4UWO6/clhASp7KE9kq5KA59OtNrG5DBRSZK1zIZDLXqkdiRx3WJAfcUUIUgA8ikEkHPhVvcr5MYmQrbBiNSJ0poune4UNoSMZOcZPM8qbWNyLyiltzUV1L8S3s2hCLk82t1xt58cNCUnGdwznJ6VBGvwiXDbkQeE24pxEtW7dwFIUEk+ackc/Om1jchyopKc1zMTFiPpt7CW3+IS866pLWUrKQkKwQCQM8+VWC79eBfjb0w4Ra9X9aC+MonhZx3DG77POm1jchlopEY9IUty3yJBgR3FNxQ+Cy6pQR2gNq+XI86s7nq5y3XF+GIYdWltnggLxvccOACe4edNrG9DRRS5LvNziWO5PXSIILkdvLTsd0OJcJ5ADIyDnA5ioNt1TKbsMfe2uVdX5iohadWlIQ515kDkAMHpTaxuQ40VUWW8SJ0qZAnRUx5kIp4gbXvQoKGQQcD4Vb1DVEp2FV7tmivTH5Ky6fWUBDzW/sOAAjmPYaKKgk8t2GECS8XpI4am0pkOlYQk8iBnxHLPWvB07CW0tt5ch9KmlNJ4rylcNKhghOenLv60UVNsikdU2aKmYmTueUULLiW1OkoSsjG4DxwT8a9/wBExNjaCglLby3gCcgqXu3Z8R2zyoopbFI4IsERA28WSUJQpDSFPqIaBGOz7jgdcV1iWS3wJDb8SMlhaGy1+bGApPLr49PvoopbFIjNaXtbUsSg0tS+I84QpZKSXRheR4YoZ0ta49vYgtNuJYjyRJbTxDyWDkc/DyoopbG1HlrR1nZCwG3lpLSmkJceUoNJUMEIBPZ5Veq0fZS2+2mMW0PrS5tbWUhC0jAUnHzT7KKKtJuysUnFE212aFZ23ExUL3PK3OOOLK1rPmo8zU+iiqFz/9k=','JPEG',12,8,55,18)}catch(e){console.warn('Logo PDF:',e)}
  doc.setFont('helvetica','bold');doc.setFontSize(17);doc.text('Relação de Pagamento de Motoristas',74,14);
  doc.setFont('helvetica','normal');doc.setFontSize(11);doc.text('Período: '+fmtDate(from)+' a '+fmtDate(to),74,21);
  doc.setFontSize(9);doc.text('Motoristas: '+drivers.length+'   •   Lançamentos: '+rows.length,74,27);
  doc.setDrawColor(249,115,22);doc.setLineWidth(.7);doc.line(12,31,285,31);
  doc.setFontSize(9);
  const kpis=[
    'Frete a receber: '+brl(agg.receive),
    'Frete pago: '+brl(agg.paid),
    'Lucro bruto: '+brl(agg.profit),
    '% lucro: '+pct(agg.profitPct),
    '% custo motorista: '+pct(agg.costPct)
  ];
  doc.text(kpis.join('     '),12,38);
  const body=drivers.map(x=>cols.map(c=>String(c.value(x))));
  if(typeof doc.autoTable!=='function'){alert('O componente de tabela do PDF ainda não carregou. Atualize a página e tente novamente.');return}
  doc.autoTable({
    head:[cols.map(c=>c.label)],
    body,
    startY:43,
    theme:'grid',
    styles:{font:'helvetica',fontSize:8,cellPadding:2},
    headStyles:{fillColor:[241,245,249],textColor:[15,23,42],fontStyle:'bold'},
    margin:{left:12,right:12,bottom:10}
  });
  doc.save(fileName)
}

function financeSetMonthCurrent(){
  const t=new Date(),f=new Date(t.getFullYear(),t.getMonth(),1);
  if($('#financeFrom'))$('#financeFrom').value=iso(f);if($('#financeTo'))$('#financeTo').value=iso(t);financeRender()
}
function financeSetToday(){
  const d=iso(new Date());if($('#financeFrom'))$('#financeFrom').value=d;if($('#financeTo'))$('#financeTo').value=d;financeRender()
}
async function financeLoadFresh(){
  // Atualização independente da rotina global. Evita perder o clique quando refreshData já está em andamento.
  const rows=await load('lancamentos');
  S.ops=Array.isArray(rows)?rows:[];
  S.opsUpdatedAt=Date.now();
  try{filters()}catch(e){}
  financeRender();
  return S.ops
}
async function financeRefreshNow(){
  const btn=$('#financeRefreshNow'),info=$('#financeInfo');
  if(btn){btn.disabled=true;btn.textContent='Atualizando…'}
  if(info)info.textContent='Buscando os lançamentos mais recentes no Google Sheets…';
  try{
    await financeLoadFresh();
  }catch(e){
    if(info)info.textContent='Falha ao atualizar: '+(e.message||e)
  }finally{
    if(btn){btn.disabled=false;btn.textContent='↻ Atualizar agora'}
  }
}
function setupFinanceDashboard(){
  if(!$('#financeDriverPanel'))return;
  const t=new Date();
  if($('#financeFrom')&&!$('#financeFrom').value)$('#financeFrom').value=iso(t);
  if($('#financeTo')&&!$('#financeTo').value)$('#financeTo').value=iso(t);
  if($('#financeApply'))$('#financeApply').onclick=async()=>{await financeLoadFresh()};
  if($('#financeRefreshNow'))$('#financeRefreshNow').onclick=financeRefreshNow;
  if($('#financeMonth'))$('#financeMonth').onclick=async()=>{financeSetMonthCurrent();await financeLoadFresh()};
  if($('#financeToday'))$('#financeToday').onclick=async()=>{financeSetToday();await financeLoadFresh()};
  if($('#financeExportPdf'))$('#financeExportPdf').onclick=financeExportPdf;
  if($('#financeFrom'))$('#financeFrom').onchange=financeRender;
  if($('#financeTo'))$('#financeTo').onchange=financeRender;

  // Mantém Resultado por Motorista fresco mesmo se a atualização geral estiver ocupada.
  setInterval(()=>{
    if(document.hidden)return;
    const active=$('.section.active')?.id;
    if(active==='dashboard' || active==='dashboards')financeLoadFresh().catch(e=>console.warn('Resultado por motorista:',e))
  },15000)
}


function driverPerfRowsBetween(fromIso,toIso){
  const from=fromIso?new Date(fromIso+'T00:00:00'):null,to=toIso?new Date(toIso+'T23:59:59'):null;
  return(S.ops||[]).filter(o=>{
    const d=financeDateOfRow(o);if(!d)return false;
    return(!from||d>=from)&&(!to||d<=to)
  })
}
function driverPerfAggregate(rows){
  const map=new Map();
  for(const o of rows||[]){
    const motorista=String(g(o,'Motorista')||'Sem motorista').trim()||'Sem motorista';
    if(!map.has(motorista))map.set(motorista,{motorista,veiculos:new Set(),entregas:0,realizadas:0,receive:0,paid:0});
    const x=map.get(motorista),ent=num(g(o,'Entregas')),rawReal=String(g(o,'Realizadas')??'').trim(),ret=num(g(o,'Retorno'));
    const real=rawReal!==''?num(rawReal):Math.max(0,ent-ret);
    const veic=String(g(o,'Veiculo','Veículo')||'').trim();if(veic)x.veiculos.add(veic);
    x.entregas+=ent;x.realizadas+=Math.min(ent,Math.max(0,real));x.receive+=financeReceive(o);x.paid+=financePaid(o)
  }
  return[...map.values()].map(x=>({
    motorista:x.motorista,veiculo:[...x.veiculos].join('/')||'—',entregas:x.entregas,realizadas:x.realizadas,
    performance:x.entregas?x.realizadas/x.entregas*100:0,receive:x.receive,paid:x.paid,profit:x.receive-x.paid
  }))
}
function driverPerformanceBars(id,rows){
  if(!rows.length)return empty(id);
  const sorted=rows.slice().sort((a,b)=>b.performance-a.performance||b.realizadas-a.realizadas).slice(0,14);
  const{x,w,h}=cv(id),p={l:42,r:12,t:28,b:82},cw=w-p.l-p.r,ch=h-p.t-p.b,m=100,bw=Math.max(13,Math.min(38,cw/sorted.length*.62));
  x.strokeStyle='#e2e8f0';x.strokeRect(p.l,p.t,cw,ch);
  sorted.forEach((r,i)=>{
    const px=p.l+(i+.5)*cw/sorted.length,bh=Math.max(0,Math.min(100,r.performance))/m*ch,barY=h-p.b-bh;
    x.fillStyle='#0f766e';x.fillRect(px-bw/2,barY,bw,bh);
    if(bh>0){
      x.save();x.fillStyle=bh>=18?'#fff':'#172033';x.textAlign='center';x.textBaseline='middle';x.font='700 10px Segoe UI';
      x.translate(px,barY+bh/2);x.rotate(-Math.PI/2);x.fillText(r.performance.toFixed(1).replace('.',',')+'%',0,0);x.restore()
    }
    x.save();x.translate(px,h-p.b+9);x.rotate(-Math.PI/4);x.textAlign='right';x.fillStyle='#64748b';x.font='11px Segoe UI';x.fillText(r.motorista.slice(0,20),0,0);x.restore()
  })
}
function driverFinancialBars(id,rows){
  if(!rows.length)return empty(id);
  const sorted=rows.slice().sort((a,b)=>b.profit-a.profit).slice(0,14),vals=sorted.map(x=>x.profit),min=Math.min(0,...vals),max=Math.max(0,...vals),span=Math.max(1,max-min);
  const{x,w,h}=cv(id),p={l:48,r:12,t:28,b:96},cw=w-p.l-p.r,ch=h-p.t-p.b,bw=Math.max(13,Math.min(38,cw/sorted.length*.62));
  const zeroY=p.t+ch-(0-min)/span*ch;
  x.strokeStyle='#e2e8f0';x.strokeRect(p.l,p.t,cw,ch);
  x.strokeStyle='#94a3b8';x.beginPath();x.moveTo(p.l,zeroY);x.lineTo(p.l+cw,zeroY);x.stroke();
  sorted.forEach((r,i)=>{
    const px=p.l+(i+.5)*cw/sorted.length,v=Number(r.profit||0),y=p.t+ch-(v-min)/span*ch,top=Math.min(y,zeroY),bh=Math.abs(zeroY-y);
    x.fillStyle=v>=0?'#0f766e':'#b91c1c';x.fillRect(px-bw/2,top,bw,Math.max(1,bh));
    if(Math.abs(v)>0){
      x.save();x.fillStyle=bh>=18?'#fff':'#172033';x.textAlign='center';x.textBaseline='middle';x.font='700 9px Segoe UI';
      x.translate(px,top+Math.max(1,bh)/2);x.rotate(-Math.PI/2);x.fillText(financeMoneyLabel(v),0,0);x.restore()
    }
    const label=r.motorista+' • '+r.veiculo;
    x.save();x.translate(px,h-p.b+9);x.rotate(-Math.PI/4);x.textAlign='right';x.fillStyle='#64748b';x.font='10px Segoe UI';x.fillText(label.slice(0,27),0,0);x.restore()
  })
}
function renderDriverPerformanceDashboard(){
  if(!$('#driverPerformanceChart'))return;
  const from=$('#driverPerfFrom')?.value||'',to=$('#driverPerfTo')?.value||'',rows=driverPerfRowsBetween(from,to),agg=driverPerfAggregate(rows);
  driverPerformanceBars('#driverPerformanceChart',agg.filter(x=>x.entregas>0));
  driverFinancialBars('#driverFinancialResultChart',agg.filter(x=>x.receive!==0||x.paid!==0));
  const info=$('#driverPerfInfo');
  if(info){
    const best=agg.filter(x=>x.entregas>0).sort((a,b)=>b.performance-a.performance)[0];
    info.textContent=nf(rows.length)+' lançamento(s) • '+nf(agg.length)+' motorista(s) • '+(from?from.split('-').reverse().join('/'):'início')+' a '+(to?to.split('-').reverse().join('/'):'hoje')+(best?' • melhor performance: '+best.motorista+' '+best.performance.toFixed(1).replace('.',',')+'%':'')
  }
}
function driverPerfSetToday(){
  const d=iso(new Date());if($('#driverPerfFrom'))$('#driverPerfFrom').value=d;if($('#driverPerfTo'))$('#driverPerfTo').value=d;renderDriverPerformanceDashboard()
}
function setupDriverPerformanceDashboard(){
  if(!$('#driverPerformanceChart'))return;
  const d=iso(new Date());
  if($('#driverPerfFrom')&&!$('#driverPerfFrom').value)$('#driverPerfFrom').value=d;
  if($('#driverPerfTo')&&!$('#driverPerfTo').value)$('#driverPerfTo').value=d;
  if($('#driverPerfApply'))$('#driverPerfApply').onclick=renderDriverPerformanceDashboard;
  if($('#driverPerfToday'))$('#driverPerfToday').onclick=driverPerfSetToday;
  if($('#driverPerfFrom'))$('#driverPerfFrom').onchange=renderDriverPerformanceDashboard;
  if($('#driverPerfTo'))$('#driverPerfTo').onchange=renderDriverPerformanceDashboard
}

function checkerRoleNorm(o){
  return String(g(o,'FUNÇÃO','FUNCAO','Função','Funcao')||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
}
function checkerRoleLabel(o){
  const r=checkerRoleNorm(o);
  if(r.includes('CONFER'))return'Conferente';
  if(r.includes('AJUD'))return'Ajudante';
  return''
}
function checkerValueRowsBetween(fromIso,toIso){
  const from=fromIso?new Date(fromIso+'T00:00:00'):null,to=toIso?new Date(toIso+'T23:59:59'):null;
  return(S.help||[]).filter(o=>{
    if(!checkerRoleLabel(o))return false;
    const d=pd(g(o,'Data','DATA'));if(!d)return false;
    return(!from||d>=from)&&(!to||d<=to)
  })
}
function checkerValueAggregate(rows){
  const map=new Map();
  for(const o of rows||[]){
    const funcao=checkerRoleLabel(o);if(!funcao)continue;
    const nome=String(g(o,'NOME','Nome','nome')||'Sem nome').trim()||'Sem nome';
    const key=funcao+'|'+nome.toLocaleUpperCase('pt-BR');
    if(!map.has(key))map.set(key,{funcao,nome,valor:0,lancamentos:0,dias:new Set()});
    const x=map.get(key);
    x.valor+=num(g(o,'Valor','VALOR'));
    x.lancamentos++;
    const d=g(o,'Data','DATA');if(d)x.dias.add(String(d))
  }
  const rank={Conferente:0,Ajudante:1};
  return[...map.values()].map(x=>({
    funcao:x.funcao,nome:x.nome,valor:x.valor,lancamentos:x.lancamentos,dias:x.dias.size,
    media:x.lancamentos?x.valor/x.lancamentos:0
  })).sort((a,b)=>(rank[a.funcao]??9)-(rank[b.funcao]??9)||b.valor-a.valor||a.nome.localeCompare(b.nome,'pt-BR'))
}
async function refreshCheckerCarsLoaded(){
  const el=$('#checkerCarsLoaded');if(!el)return;
  const date=$('#checkerValueTo')?.value||iso(new Date());
  el.textContent='…';
  try{
    const r=await fetch('/api/carregamentos-count?data='+encodeURIComponent(date)+'&t='+Date.now(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao consultar carregamentos.');
    el.textContent=nf(Number(j.total||0))
  }catch(e){
    el.textContent='—';
    console.warn('Total de carros carregados:',e)
  }
}
function renderCheckerValueReport(){
  if(!$('#checkerValueTable'))return;
  refreshCheckerCarsLoaded().catch(()=>{});
  const from=$('#checkerValueFrom')?.value||'',to=$('#checkerValueTo')?.value||'';
  const rows=checkerValueRowsBetween(from,to),agg=checkerValueAggregate(rows);
  const conferentes=agg.filter(x=>x.funcao==='Conferente'),ajudantes=agg.filter(x=>x.funcao==='Ajudante');
  const totalConferentes=conferentes.reduce((s,x)=>s+x.valor,0),totalAjudantes=ajudantes.reduce((s,x)=>s+x.valor,0),total=totalConferentes+totalAjudantes;
  const people=new Set(agg.map(x=>x.nome.toLocaleUpperCase('pt-BR')));
  $('#checkerValueTotal').textContent=brl(total);
  $('#checkerValueConferenceTotal').textContent=brl(totalConferentes);
  $('#checkerValueHelperTotal').textContent=brl(totalAjudantes);
  $('#checkerValuePeople').textContent=nf(people.size);
  $('#checkerValueEntries').textContent=nf(rows.length);
  const info=$('#checkerValueInfo');
  if(info)info.textContent=nf(rows.length)+' lançamento(s) • '+nf(conferentes.length)+' conferente(s) • '+nf(ajudantes.length)+' ajudante(s) • '+(from?from.split('-').reverse().join('/'):'início')+' a '+(to?to.split('-').reverse().join('/'):'hoje');
  $('#checkerValueTable').innerHTML='<thead><tr><th>Função</th><th>Nome</th><th>Lançamentos</th><th>Dias</th><th>Valor total</th><th>Média / lançamento</th></tr></thead><tbody>'+
    (agg.length?agg.map(x=>'<tr><td><b>'+safe(x.funcao)+'</b></td><td><b>'+safe(x.nome)+'</b></td><td>'+nf(x.lancamentos)+'</td><td>'+nf(x.dias)+'</td><td><b>'+brl(x.valor)+'</b></td><td>'+brl(x.media)+'</td></tr>').join(''):'<tr><td colspan="6" class="muted">Sem registros de conferentes ou ajudantes no período selecionado.</td></tr>')+
    '</tbody>'
}
function checkerValueSetToday(){
  const d=iso(new Date());
  if($('#checkerValueFrom'))$('#checkerValueFrom').value=d;
  if($('#checkerValueTo'))$('#checkerValueTo').value=d;
  renderCheckerValueReport()
}
function setupCheckerValueReport(){
  if(!$('#checkerValuePanel'))return;
  const d=iso(new Date());
  if($('#checkerValueFrom')&&!$('#checkerValueFrom').value)$('#checkerValueFrom').value=d;
  if($('#checkerValueTo')&&!$('#checkerValueTo').value)$('#checkerValueTo').value=d;
  if($('#checkerValueApply'))$('#checkerValueApply').onclick=renderCheckerValueReport;
  if($('#checkerValueToday'))$('#checkerValueToday').onclick=checkerValueSetToday;
  if($('#checkerValueFrom'))$('#checkerValueFrom').onchange=renderCheckerValueReport;
  if($('#checkerValueTo'))$('#checkerValueTo').onchange=renderCheckerValueReport
}

function update(){const O=ops(),H=help(),A=sch(),roleNorm=o=>String(g(o,'FUNÇÃO','FUNCAO','Função','Funcao')||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(),HCf=H.filter(o=>roleNorm(o).includes('CONFER')),HA=H.filter(o=>!roleNorm(o).includes('CONFER')),delSheet=O.reduce((a,o)=>a+num(g(o,'Entregas')),0),doneSheet=O.reduce((a,o)=>a+num(g(o,'Realizadas')),0),co=S.coletas&&S.coletas.ok?S.coletas:null,del=co?num(co.ativas):delSheet,done=co?num(co.entregues):doneSheet,km=O.reduce((a,o)=>a+num(g(o,'KM')),0),rev=O.reduce((a,o)=>a+num(g(o,'Frete Vialog Liq',' Frete Vialog Liq')),0),dc=O.reduce((a,o)=>a+num(g(o,'Frete Mot Liq',' Frete Mot Liq')),0),helperCost=HA.reduce((a,o)=>a+num(g(o,'Valor')),0),checkerCost=HCf.reduce((a,o)=>a+num(g(o,'Valor')),0),hc=helperCost+checkerCost,gross=rev-dc,margin=rev?gross/rev*100:0,net=gross-hc,ret=O.reduce((a,o)=>a+num(g(o,'Retorno')),0),pending=co?num(co.pendentes):Math.max(del-done,0);
$('#del').textContent=nf(del);$('#done').textContent=nf(done);$('#rate').textContent=(del?done/del*100:0).toFixed(1).replace('.',',')+'%';$('#km').textContent=nf(km);$('#revenue').textContent=brl(rev);$('#driverCost').textContent=brl(dc);$('#gross').textContent=brl(gross);$('#margin').textContent=margin.toFixed(1).replace('.',',')+'%';$('#helpersCost').textContent=brl(helperCost);$('#checkersCost').textContent=brl(checkerCost);$('#net').textContent=brl(net);mood($('#gross'),gross);mood($('#margin'),margin);mood($('#net'),net);
const sla=del?done/del*100:0;
const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
set('#hubExecDel',nf(done)+' / '+nf(del));set('#hubExecSla',sla.toFixed(1).replace('.',',')+'%');set('#hubExecRev',brl(rev));set('#hubExecNet',brl(net));
set('#hubOpPlan',nf(del));set('#hubOpDone',nf(done));set('#hubOpPend',nf(pending));set('#hubOpKm',nf(km));
set('#hubFinRev',brl(rev));set('#hubFinDriver',brl(dc));set('#hubFinHelp',brl(helperCost));set('#hubFinChecker',brl(checkerCost));set('#hubFinMargin',margin.toFixed(1).replace('.',',')+'%');
set('#hubHelpCost',brl(helperCost));set('#hubHelpPeople',nf(new Set(HA.map(o=>g(o,'NOME')).filter(Boolean)).size));set('#hubCheckerCost',brl(checkerCost));set('#hubCheckerPeople',nf(new Set(HCf.map(o=>g(o,'NOME')).filter(Boolean)).size));
set('#hubSchN',nf(A.length));
set('#schDelivered',nf(A.filter(o=>agCopyNorm(g(o,'STATUS')).includes('entregue')).length));
const hs={};A.forEach(o=>{const k=(g(o,'STATUS')||'SEM STATUS').trim();hs[k]=(hs[k]||0)+1});set('#hubSchStatus',nf(Object.keys(hs).length));const hsTop=Object.entries(hs).sort((a,b)=>b[1]-a[1]).slice(0,4);set('#hubSchList',hsTop.length?hsTop.map(x=>x[0]+': '+nf(x[1])).join(' • '):'Sem agendamentos no período');
const hdm={};O.forEach(o=>{const k=g(o,'Motorista')||'Sem motorista';hdm[k]=(hdm[k]||0)+num(g(o,'Realizadas'))});const hdTop=Object.entries(hdm).sort((a,b)=>b[1]-a[1]).slice(0,5);set('#hubDrivers',hdTop.length?hdTop.map((x,i)=>(i+1)+'. '+x[0]+' — '+nf(x[1])).join(' | '):'Sem dados de motoristas');
const hbm={};O.forEach(o=>{const k=g(o,'Filial')||'Sem filial';hbm[k]??={p:0,d:0};hbm[k].p+=num(g(o,'Entregas'));hbm[k].d+=num(g(o,'Realizadas'))});const hbTop=Object.entries(hbm).sort((a,b)=>b[1].d-a[1].d).slice(0,5);set('#hubBranches',hbTop.length?hbTop.map(x=>x[0]+': '+nf(x[1].d)+'/'+nf(x[1].p)).join(' | '):'Sem dados de filiais');
const hrm={};O.forEach(o=>{const k=g(o,'Rota')||'Sem rota';hrm[k]=(hrm[k]||0)+num(g(o,'Realizadas'))});const hrTop=Object.entries(hrm).sort((a,b)=>b[1]-a[1]).slice(0,4);set('#hubRoutes',hrTop.length?hrTop.map(x=>x[0]+': '+nf(x[1])).join(' • '):'Sem dados de rotas');set('#hubKmDel',done?(km/done).toFixed(1).replace('.',','):'0');set('#hubRouteN',nf(Object.keys(hrm).filter(x=>x!=='Sem rota').length));
set('#hubIssue',nf(ret));set('#hubIssueRate',(del?ret/del*100:0).toFixed(1).replace('.',',')+'%');set('#hubIssueSla',sla.toFixed(1).replace('.',',')+'%');set('#hubIssuePend',nf(pending));$('#sswPlanned').textContent=nf(del);$('#sswRoute').textContent=nf(pending);$('#sswDone').textContent=nf(done);$('#sswIssue').textContent=nf(ret);$('#sswSla').textContent=sla.toFixed(1).replace('.',',')+'%';$('#sswSlaBar').style.width=Math.min(100,Math.max(0,sla))+'%';
const active=$('.section.active')?.id||'dashboard';
if(active==='dashboard'){
  const safeWidget=(name,fn)=>{try{fn()}catch(e){console.error('Widget '+name+' falhou:',e)}};
  safeWidget('performance motorista',()=>renderDriverPerformanceDashboard());
  safeWidget('conferentes e ajudantes',()=>renderCheckerValueReport());
  safeWidget('status agendamentos',()=>renderAgStatusCards('#agStatusCards',(Array.isArray(S.agCopy)?S.agCopy:[]).filter(o=>!agCopyOldDelivered(o))));
  safeWidget('resultado financeiro motorista',()=>financeRender());
  safeWidget('grafico ajudantes/conferentes',()=>{
    const hdA={},hdC={};
    (Array.isArray(HA)?HA:[]).forEach(o=>{const k=g(o,'Data')||'Sem data';hdA[k]??={valor:0,nomes:new Set()};hdA[k].valor+=num(g(o,'Valor'));const nome=String(g(o,'NOME')||'').trim();if(nome)hdA[k].nomes.add(nome)});
    (Array.isArray(HCf)?HCf:[]).forEach(o=>{const k=g(o,'Data')||'Sem data';hdC[k]??={valor:0,nomes:new Set()};hdC[k].valor+=num(g(o,'Valor'));const nome=String(g(o,'NOME')||'').trim();if(nome)hdC[k].nomes.add(nome)});
    const HK=[...new Set([...Object.keys(hdA),...Object.keys(hdC)])].sort((a,b)=>(pd(a)||0)-(pd(b)||0));
    groupedBars('#helpersChart',HK,HK.map(k=>hdA[k]?.valor||0),HK.map(k=>hdC[k]?.valor||0),HK.map(k=>nf(hdA[k]?.nomes.size||0)),HK.map(k=>nf(hdC[k]?.nomes.size||0)))
  });
}
$('#hc').textContent=brl(helperCost);$('#hcc').textContent=brl(checkerCost);$('#hn').textContent=nf(H.length);$('#hp').textContent=new Set(HA.map(o=>g(o,'NOME')).filter(Boolean)).size;$('#hcp').textContent=new Set(HCf.map(o=>g(o,'NOME')).filter(Boolean)).size;
if(active==='operacoes')table('#ops',[['Data','ENTREGUE','Entregue','Data','  Data','DATA'],['Motorista','Motorista'],['Veículo','Veiculo'],['Filial','Filial'],['Entregas','Entregas'],['Realizadas','Realizadas'],['KM','KM'],['Frete Motorista','Frete Mot Liq',' Frete Mot Liq'],['Receita Líq.','Frete Vialog Liq',' Frete Vialog Liq'],['Rota','Rota']],O.slice().reverse().slice(0,500));
if(active==='agendamentos')table('#sch',[['NF','NF'],['Cidade','CIDADE'],['Cliente','NOME CLIENTE'],['Data','DATA AGENDADA'],['Status','STATUS'],['Motorista','MOTORISTA'],['Observação','OBSERVAÇÃO']],A.slice().reverse().slice(0,500));
if(active==='ajudantes'){table('#helpHelpers',[['Data','Data'],['Nome','NOME'],['Valor','Valor'],['Função','FUNÇÃO']],HA.slice().reverse().slice(0,500));table('#helpCheckers',[['Data','Data'],['Nome','NOME'],['Valor','Valor'],['Função','FUNÇÃO']],HCf.slice().reverse().slice(0,500));}
const now=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('#status').textContent='Atualização automática a cada 5 s • última: '+now+' • '+S.ops.length.toLocaleString('pt-BR')+' operações • '+S.sch.length.toLocaleString('pt-BR')+' agendamentos • '+S.help.length.toLocaleString('pt-BR')+' registros de ajudantes/conferentes'+(S.sheetWarnings?.lancamentos?' • ⚠ '+S.sheetWarnings.lancamentos:'')}
function cityBubbleSetDefaults(){
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const month=today.slice(0,8)+'01';
  const f=$('#cityBubbleFrom'),t=$('#cityBubbleTo');
  if(f&&!f.value)f.value=month;
  if(t&&!t.value)t.value=today
}
function cityBubbleMetric(){
  return $('#cityBubbleMetric')?.value||'deliveries'
}
function cityBubbleMetricValue(x,metric){
  if(metric==='freight')return Number(x.frete||0);
  if(metric==='value')return Number(x.valor||0);
  return Number(x.entregas||0)
}
function cityBubbleMetricLabel(metric){
  if(metric==='freight')return'Frete';
  if(metric==='value')return'Valor da mercadoria';
  return'Quantidade de entregas'
}
function cityBubbleRadius(v,max,minR=7,maxR=34){
  const n=Math.max(0,Number(v)||0),m=Math.max(1,Number(max)||1);
  return n<=0?0:minR+(maxR-minR)*Math.sqrt(n/m)
}
function cityBubbleEnsureMap(){
  const box=$('#cityBubbleMap');if(!box||typeof L==='undefined')return null;
  if(!CITY_BUBBLE_MAP){
    CITY_BUBBLE_MAP=L.map(box,{zoomControl:true}).setView([-22.75,-47.15],8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(CITY_BUBBLE_MAP)
  }
  if(CITY_BUBBLE_LAYER)CITY_BUBBLE_LAYER.remove();
  CITY_BUBBLE_LAYER=L.layerGroup().addTo(CITY_BUBBLE_MAP);
  return CITY_BUBBLE_MAP
}
function renderCityBubbleMap(){
  const d=CITY_BUBBLE_DATA;if(!d?.ok)return;
  const map=cityBubbleEnsureMap();if(!map)return;
  const metric=cityBubbleMetric(),all=(d.cities||[]).filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lon)));
  const top=Number($('#cityBubbleTop')?.value||40);
  const rows=all.slice().sort((a,b)=>cityBubbleMetricValue(b,metric)-cityBubbleMetricValue(a,metric)||b.entregas-a.entregas);
  const visible=top>0?rows.slice(0,top):rows;
  const maxMetric=Math.max(1,...visible.map(x=>cityBubbleMetricValue(x,metric)));
  const bounds=[];
  const popup=x=>'<b>'+safe(x.cidade)+' / '+safe(x.uf)+'</b>'+
    '<br>Frete: <b>'+brl(x.frete||0)+'</b>'+
    '<br>Valor mercadoria: <b>'+brl(x.valor||0)+'</b>'+
    '<br>Entregas: <b>'+nf(x.entregas||0)+'</b>'+
    (x.retornos?'<br>Retornos: <b>'+nf(x.retornos)+'</b>':'');
  for(const x of visible){
    const v=cityBubbleMetricValue(x,metric);if(v<=0)continue;
    const lat=Number(x.lat),lon=Number(x.lon);bounds.push([lat,lon]);
    L.circleMarker([lat,lon],{
      radius:cityBubbleRadius(v,maxMetric),
      color:metric==='freight'?'#0f766e':(metric==='value'?'#1d4ed8':'#d97706'),
      weight:2,
      fillOpacity:.32
    }).addTo(CITY_BUBBLE_LAYER).bindPopup(popup(x))
  }
  if(bounds.length){const bb=L.latLngBounds(bounds);if(bb.isValid())map.fitBounds(bb.pad(.10),{maxZoom:10})}
  setTimeout(()=>map.invalidateSize(),80);
  const ranking=$('#cityBubbleRanking');
  if(ranking){
    ranking.innerHTML=visible.slice(0,25).map((x,i)=>{
      const main=metric==='freight'?brl(x.frete||0):(metric==='value'?brl(x.valor||0):nf(x.entregas||0)+' entregas');
      return '<div class="city-bubble-row"><b>'+(i+1)+'. '+safe(x.cidade)+' / '+safe(x.uf)+'</b><div class="meta"><b>'+safe(cityBubbleMetricLabel(metric))+': '+main+'</b><br>Frete '+brl(x.frete||0)+' • Mercadoria '+brl(x.valor||0)+' • '+nf(x.entregas||0)+' entregas</div></div>'
    }).join('')||'<div class="muted">Nenhuma cidade localizada no mapa.</div>'
  }
  const ml=$('#cityBubbleMetricLabel');if(ml)ml.textContent='Visão atual: '+cityBubbleMetricLabel(metric)
}
function renderCityBubbles(){
  const d=CITY_BUBBLE_DATA;if(!d?.ok)return;
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  set('#cityBubbleTotalFreight',brl(d.totalFreight||0));
  set('#cityBubbleTotalValue',brl(d.totalValue||0));
  set('#cityBubbleTotalDeliveries',nf(d.totalDeliveries||0));
  set('#cityBubbleTotalReturns',nf(d.totalReturns||0));
  set('#cityBubbleTotalCities',nf(d.totalCities||0));
  set('#hubCityBubbleCities',nf(d.totalCities||0));
  set('#hubCityBubbleFreight',brl(d.totalFreight||0));
  set('#hubCityBubbleValue',brl(d.totalValue||0));
  set('#hubCityBubbleDeliveries',nf(d.totalDeliveries||0));
  set('#hubCityBubbleInfo','Fonte SSW • '+nf(d.totalDeliveries||0)+' entregas distribuídas em '+nf(d.totalCities||0)+' cidades.');
  set('#cityBubbleInfo','Fonte: '+(d.source||'SSW')+' • período '+d.from+' a '+d.to+' • total oficial dos romaneios: '+nf(d.officialDeliveries||d.totalDeliveries||0)+'.');
  const rows=(d.cities||[]).map(x=>({
    cidade:x.cidade+' / '+x.uf,
    frete:brl(x.frete||0),
    valor:brl(x.valor||0),
    entregas:nf(x.entregas||0),
    retornos:nf(x.retornos||0),
    mapa:Number.isFinite(Number(x.lat))?'Sim':'Não'
  }));
  table('#cityBubbleTable',[['Cidade','cidade'],['Frete','frete'],['Valor mercadoria','valor'],['Entregas','entregas'],['Retornos','retornos'],['No mapa','mapa']],rows);
  renderCityBubbleMap()
}
async function refreshCityBubbles(force=false){
  if(window.__cityBubbleBusy)return;
  window.__cityBubbleBusy=true;
  cityBubbleSetDefaults();
  const info=$('#cityBubbleInfo'),btn=$('#cityBubbleApply');
  if(info)info.textContent=force?'Atualizando SSW e recalculando valores…':'Consultando romaneios e CT-es no SSW…';
  if(btn){btn.disabled=true;btn.textContent='Atualizando SSW…'}
  try{
    const from=$('#cityBubbleFrom')?.value||'',to=$('#cityBubbleTo')?.value||'';
    const q=new URLSearchParams({from,to,t:String(Date.now()),force:force?'1':'0'});
    const r=await fetch('/api/ssw/cidades-mapa?'+q.toString(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao carregar mapa de cidades.');
    CITY_BUBBLE_DATA=j;renderCityBubbles()
  }catch(e){
    if(info)info.textContent='Não foi possível carregar o mapa de cidades: '+e.message
  }finally{
    window.__cityBubbleBusy=false;
    if(btn){btn.disabled=false;btn.textContent='Atualizar SSW'}
  }
}

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
  const d=S.driverProgress||S.sswMotoristas;if(!d||!d.ok)return;
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
async function refreshDriverProgress(){
  if(window.__driverProgressLoading)return;
  window.__driverProgressLoading=true;
  const meta=$('#driverProgressMeta');
  if(meta)meta.textContent='Atualizando evolução diretamente pela opção 38 do SSW…';
  try{
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    TRACKING_CURRENT_DATE=today;
    const r=await fetch('/api/evolucao-motoristas?date='+encodeURIComponent(today)+'&t='+Date.now(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao carregar evolução dos motoristas.');
    S.driverProgress=normalizeDriverNames(j);
    renderDriverProgress();
    if(j.refreshing){
      clearTimeout(window.__driverProgressRetry);
      window.__driverProgressRetry=setTimeout(refreshDriverProgress,8000)
    }
  }catch(e){
    if(meta)meta.textContent='Não foi possível carregar a evolução: '+e.message;
    clearTimeout(window.__driverProgressRetry);
    window.__driverProgressRetry=setTimeout(refreshDriverProgress,15000)
  }finally{
    window.__driverProgressLoading=false
  }
}

async function refreshSswMotoristas(){
  if(window.__sswMotoristasLoading)return;
  window.__sswMotoristasLoading=true;
  try{
    const q=sswRangeQuery(),sep=q?'&':'?';
    const r=await fetch('/api/bi2/saidas-baixas'+q+sep+'t='+Date.now(),{cache:'no-store'}),j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'Falha ao carregar saídas e baixas do SSW');
    S.sswMotoristas=normalizeDriverNames(j);renderSswMotoristas();loadingDriverOptions();
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

function renderRemetentes(){const d=S.remetentes;if(!d||!d.ok)return;const set=(id,v)=>{const e=$(id);if(e)e.textContent=v},C=d.clientes||[];set('#hubRemClients',nf(d.totalClientes||0));set('#hubRemCtrcs',nf(d.totalCtrcs||0));set('#hubRemFreight',brl(d.totalFrete||0));set('#hubRemVolumes',nf(d.totalVolumes||0));set('#hubRemNote',d.note||'Dados SSW / BI2');set('#remClients',nf(d.totalClientes||0));set('#remCtrcs',nf(d.totalCtrcs||0));set('#remFreight',brl(d.totalFrete||0));set('#remGoods',brl(d.totalMercadoria||0));set('#remVolumes',nf(d.totalVolumes||0));const p=d.period,pt=p?('Período '+p.from+' a '+p.to+' • '+p.daysAvailable+'/'+p.daysRequested+' dia(s) com arquivo BI2'):'';const meta=(d.meta&&d.meta.data?d.meta.data+' '+(d.meta.hora||''):'')+(pt?' • '+pt:'')+' • '+(d.note||'');set('#remMeta',meta);const top=C.slice(0,10),topF=C.slice().sort((a,b)=>b.frete-a.frete).slice(0,10);bars('#remCtrcChart',top.map(x=>x.remetente),top.map(x=>x.ctrcs));bars('#remFreightChart',topF.map(x=>x.remetente),topF.map(x=>x.frete));const rows=C.map((x,i)=>({pos:String(i+1),remetente:x.remetente,ctrcs:nf(x.ctrcs),frete:brl(x.frete),mercadoria:brl(x.valorMercadoria),volumes:nf(x.volumes),peso:nf(x.peso),m3:(x.m3||0).toLocaleString('pt-BR',{maximumFractionDigits:2}),atraso:(x.atrasoMedio||0).toFixed(1).replace('.',',')+' d',cidades:nf(x.cidades),destinatarios:nf(x.destinatarios)}));table('#remTable',[['#','pos'],['Cliente remetente','remetente'],['CT-es','ctrcs'],['Frete','frete'],['Valor mercadoria','mercadoria'],['Volumes','volumes'],['Peso','peso'],['Atraso médio','atraso'],['Cidades','cidades'],['Destinatários','destinatarios']],rows);table('#remCompareTable',[['#','pos'],['Cliente remetente','remetente'],['CT-es','ctrcs'],['Frete','frete'],['Volumes','volumes'],['Atraso médio','atraso'],['Cidades','cidades'],['Destinatários','destinatarios']],rows);const a=$('#remClientA'),b=$('#remClientB');if(a&&b){const va=a.value,vb=b.value,opts=C.map(x=>'<option value="'+safe(x.remetente)+'">'+safe(x.remetente)+'</option>').join('');a.innerHTML=opts;b.innerHTML=opts;if(C.some(x=>x.remetente===va))a.value=va;else if(C[0])a.value=C[0].remetente;if(C.some(x=>x.remetente===vb))b.value=vb;else if(C[1])b.value=C[1].remetente;else if(C[0])b.value=C[0].remetente;renderRemCompare()}}
function renderRemCompare(){const d=S.remetentes;if(!d||!d.ok)return;const C=d.clientes||[],a=$('#remClientA'),b=$('#remClientB');if(!a||!b)return;const A=C.find(x=>x.remetente===a.value),B=C.find(x=>x.remetente===b.value),set=(id,v)=>{const e=$(id);if(e)e.textContent=v};const fill=(p,x)=>{set('#rem'+p+'Name',x?x.remetente:'—');set('#rem'+p+'Ctrcs',x?nf(x.ctrcs):'—');set('#rem'+p+'Freight',x?brl(x.frete):'—');set('#rem'+p+'Goods',x?brl(x.valorMercadoria):'—');set('#rem'+p+'Volumes',x?nf(x.volumes):'—');set('#rem'+p+'Weight',x?nf(x.peso):'—');set('#rem'+p+'Delay',x?(x.atrasoMedio||0).toFixed(1).replace('.',',')+' d':'—');set('#rem'+p+'Cities',x?nf(x.cidades):'—');set('#rem'+p+'Recipients',x?nf(x.destinatarios):'—')};fill('A',A);fill('B',B);set('#remCompareMeta',(d.note||'')+(d.meta&&d.meta.data?' • '+d.meta.data+' '+(d.meta.hora||''):''))}
async function refreshSswRemetentes(){try{const q=sswRangeQuery(),sep=q?'&':'?';const r=await fetch('/api/bi2/remetentes'+q+sep+'t='+Date.now(),{cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Falha ao carregar clientes remetentes');S.remetentes=j;renderRemetentes()}catch(e){const ids=['#remMeta','#hubRemNote','#remCompareMeta'];ids.forEach(id=>{const el=$(id);if(el)el.textContent='Não foi possível carregar os clientes remetentes: '+e.message})}}
async function checkSsw(){try{const [rs,rb,ra]=await Promise.all([fetch('/api/ssw/status?t='+Date.now(),{cache:'no-store'}),fetch('/api/bi2/status?t='+Date.now(),{cache:'no-store'}),fetch('/api/bi2/api-status?t='+Date.now(),{cache:'no-store'})]),s=await rs.json(),b2=await rb.json(),api=await ra.json(),b=$('#sswSource');if(!b)return;if(api.connected){b.textContent='BI2 WebAPI conectada • consulta a cada 1 min • usando Google Sheets';const tag=$('#hubBi2Tag'),txt=$('#hubBi2Text');if(tag){tag.textContent='WEBAPI BI2 CONECTADA';tag.classList.remove('wait');tag.classList.add('live')}if(txt)txt.textContent='WebAPI BI2 conectada. Relatórios monitorados a cada 1 minuto; SFTP mantido como contingência.';b.style.background='#dcfce7';b.style.color='#166534';b.style.borderColor='#86efac'}else if(b2.connected){b.textContent=(b2.fileCount>0?'BI2 SFTP conectado • '+b2.fileCount+' arquivo(s) disponível(is) • usando Google Sheets':'BI2 SFTP conectado • aguardando arquivos do SSW • usando Google Sheets');const tag=$('#hubBi2Tag'),txt=$('#hubBi2Text');if(tag){tag.textContent=b2.fileCount>0?'ARQUIVOS DISPONÍVEIS':'BI2 CONECTADO';tag.classList.remove('wait');tag.classList.add('live')}if(txt)txt.textContent=b2.fileCount>0?'BI2 conectado com '+b2.fileCount+' arquivo(s) disponível(is) para processamento.':'BI2 conectado com sucesso. Aguardando o SSW publicar os primeiros arquivos.';b.style.background='#dcfce7';b.style.color='#166534';b.style.borderColor='#86efac'}else if(b2.configured){b.textContent='BI2 configurado • conexão indisponível • usando Google Sheets';const tag=$('#hubBi2Tag'),txt=$('#hubBi2Text');if(tag){tag.textContent='BI2 INDISPONÍVEL';tag.classList.remove('live');tag.classList.add('wait')}if(txt)txt.textContent='Credenciais configuradas, mas a conexão BI2 não está disponível neste momento.';b.style.background='#fee2e2';b.style.color='#991b1b';b.style.borderColor='#fecaca'}else if(s.connected){b.textContent='SSW WebAPI conectado • usando Google Sheets';b.style.background='#dcfce7';b.style.color='#166534';b.style.borderColor='#86efac'}else if(s.configured){b.textContent='SSW WebAPI: falha de autenticação • usando Google Sheets';b.style.background='#fee2e2';b.style.color='#991b1b';b.style.borderColor='#fecaca'}else{b.textContent='SSW/BI2 aguardando configuração • usando Google Sheets';b.style.background='#ecfeff';b.style.color='#0f766e';b.style.borderColor='#99f6e4'}}catch(e){const b=$('#sswSource');if(b)b.textContent='Fontes SSW indisponíveis • usando Google Sheets'}}
function lotacaoIsoDate(v){
  const s=String(v||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''
}
function renderLotacao(){
  const q=($('#lotacaoSearch')?.value||'').trim().toLowerCase();
  const rows=(S.lotacao||[]).filter(r=>{
    if(!q)return true;
    return [r.os,r.cliente,r.destinatario,r.origem,r.destino,r.motorista,r.placa,r.status].some(v=>String(v||'').toLowerCase().includes(q))
  });
  const receber=rows.reduce((s,r)=>s+Number(r.frete_receber||0),0);
  const pago=rows.reduce((s,r)=>s+Number(r.frete_pago||0),0);
  const pedagio=rows.reduce((s,r)=>s+Number(r.pedagio||0),0);
  const lucro=rows.reduce((s,r)=>s+Number(r.lucro||0),0);
  const margem=receber>0?lucro/receber*100:0;
  const setv=(id,v)=>{const el=$(id);if(el)el.textContent=v};
  setv('#lotacaoTotal',nf(rows.length));setv('#lotacaoReceber',brl(receber));setv('#lotacaoPago',brl(pago));
  setv('#lotacaoPedagio',brl(pedagio));setv('#lotacaoLucro',brl(lucro));setv('#lotacaoMargem',margem.toFixed(1).replace('.',',')+'%');
  const t=$('#lotacaoTable');
  if(t)t.innerHTML='<thead><tr><th>Data</th><th>OS/Coleta</th><th>Cliente</th><th>Origem → Destino</th><th>Motorista / Placa</th><th>Status</th><th>Frete receber</th><th>Frete pago</th><th>Pedágio</th><th>Lucro</th><th>Margem</th><th>Recebido</th></tr></thead><tbody>'+
    (rows.length?rows.map(r=>'<tr><td>'+safe(lotacaoIsoDate(r.data)?.split('-').reverse().join('/')||'—')+'</td><td><b>'+safe(r.os||r.id||'—')+'</b></td><td>'+safe(r.cliente||'—')+'</td><td>'+safe(r.origem||'—')+' → '+safe(r.destino||'—')+'</td><td>'+safe(r.motorista||'—')+(r.placa?' • '+safe(r.placa):'')+'</td><td>'+safe(r.status||'—')+'</td><td>'+brl(Number(r.frete_receber||0))+'</td><td>'+brl(Number(r.frete_pago||0))+'</td><td>'+brl(Number(r.pedagio||0))+'</td><td><b>'+brl(Number(r.lucro||0))+'</b></td><td>'+Number(r.margem||0).toFixed(1).replace('.',',')+'%</td><td>'+(r.recebido?'Sim':'Não')+'</td></tr>').join(''):'<tr><td colspan="12" class="muted">Nenhuma lotação encontrada para os filtros atuais.</td></tr>')+'</tbody>';
  const info=$('#lotacaoInfo');
  if(info)info.textContent=nf(rows.length)+' lotação(ões) • '+brl(receber)+' a receber • '+brl(lucro)+' de lucro';
}
async function refreshLotacao(){
  if(window.__lotacaoBusy)return;
  window.__lotacaoBusy=true;
  try{
    const q=new URLSearchParams();
    const from=$('#lotacaoFrom')?.value||'',to=$('#lotacaoTo')?.value||'';
    if(from)q.set('from',from);if(to)q.set('to',to);
    const r=await fetch('/api/lotacao?'+q.toString(),{cache:'no-store'});
    const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível carregar lotações.');
    S.lotacao=normalizeDriverNames(Array.isArray(j.rows)?j.rows:[]);
    renderLotacao()
  }catch(e){
    const info=$('#lotacaoInfo');if(info)info.textContent='Lotação indisponível: '+e.message;
    S.lotacao=[];renderLotacao()
  }finally{window.__lotacaoBusy=false}
}
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
      if(ro.status==='fulfilled'){S.ops=Array.isArray(ro.value)?ro.value:[];S.opsUpdatedAt=Date.now();updated=true;try{financeRender()}catch(e){console.warn('Resultado por motorista:',e)}}else errors.push('Operações: '+(ro.reason?.message||ro.reason))
    }else S.ops=[];
    if(needSch){
      if(ra.status==='fulfilled'){S.sch=Array.isArray(ra.value)?ra.value:[];S.agCopy=S.sch;window.__agCopyLoadedAt=Date.now();updated=true}else errors.push('Agendamentos: '+(ra.reason?.message||ra.reason))
    }else S.sch=[];
    if(needHelp){
      if(rh.status==='fulfilled'){S.help=Array.isArray(rh.value)?rh.value:[];updated=true}else errors.push('Ajudantes: '+(rh.reason?.message||rh.reason))
    }else S.help=[];
    filters();update();
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
async function compressLoadingPhoto(file,capturedAt=null,label=''){
  const dataUrl=await new Promise((resolve,reject)=>{
    const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=()=>reject(new Error('Não foi possível ler a foto.'));fr.readAsDataURL(file)
  });
  const img=await new Promise((resolve,reject)=>{
    const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Foto inválida.'));im.src=dataUrl
  });
  const stampDate=capturedAt instanceof Date?capturedAt:new Date(capturedAt||file.lastModified||Date.now());
  const stamp=stampDate.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  let max=1280,quality=.72,result='';
  for(let attempt=0;attempt<4;attempt++){
    const scale=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
    const w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
    const h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);

    // Grava data/hora diretamente na imagem para ficar registrada no arquivo.
    const fontSize=Math.max(18,Math.round(w*.022));
    ctx.font='700 '+fontSize+'px Arial';
    ctx.textBaseline='middle';
    const text=(label?label+' • ':'')+stamp;
    const pad=Math.max(10,Math.round(fontSize*.55));
    const textW=Math.min(w-pad*2,ctx.measureText(text).width);
    const barH=fontSize+pad*1.4;
    const y=h-barH;
    ctx.fillStyle='rgba(0,0,0,.68)';
    ctx.fillRect(0,y,w,barH);
    ctx.fillStyle='#fff';
    ctx.shadowColor='rgba(0,0,0,.65)';
    ctx.shadowBlur=2;
    ctx.fillText(text,pad,y+barH/2,Math.max(10,w-pad*2));
    ctx.shadowBlur=0;

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
    const id=img.dataset.loadingPhotoId;if(!id)return;
    const wrap=img.closest('a');
    try{
      const r=await fetch('/api/carregamentos-finais/'+encodeURIComponent(id)+'/foto?t='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const blob=await r.blob();if(!blob.size)throw new Error('Foto vazia');
      const url=URL.createObjectURL(blob);
      if(!Array.isArray(window.__loadingPhotoObjectUrls))window.__loadingPhotoObjectUrls=[];
      window.__loadingPhotoObjectUrls.push(url);
      img.src=url;img.classList.remove('load-photo-pending','load-photo-error');
      if(wrap){wrap.href=url;wrap.target='_blank';wrap.rel='noopener'}
    }catch(e){
      img.classList.remove('load-photo-pending');img.classList.add('load-photo-error');
      img.alt='Não foi possível carregar a foto';
      if(wrap){wrap.removeAttribute('href');wrap.removeAttribute('target');wrap.title='Não foi possível carregar esta foto.'}
    }
  }))
}
async function renderOverviewLoadingPhotos(rows){
  const box=$('#overviewLoadPhotos');if(!box)return;
  const recent=(rows||[]).slice(0,6);
  if(!recent.length){box.innerHTML='<div class="muted">Nenhuma foto de carregamento ou descarga registrada.</div>';return}
  box.innerHTML=recent.map(r=>'<div style="min-width:150px;max-width:190px;flex:1;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff"><a data-overview-photo-id="'+safe(r.id)+'" title="Abrir foto"><div style="height:115px;background:#f1f5f9;display:flex;align-items:center;justify-content:center"><img data-overview-photo-id="'+safe(r.id)+'" alt="Foto do registro" style="width:100%;height:100%;object-fit:cover"></div></a><div style="padding:8px;font-size:12px"><b>'+safe(cargoTypeLabel(r.tipo))+'</b><br>'+safe(r.motorista||'Motorista não informado')+'<br><span class="muted">'+safe(loadingDateTime(r.capturada_em))+'</span></div></div>').join('');
  await Promise.all([...box.querySelectorAll('img[data-overview-photo-id]')].map(async img=>{
    const id=img.dataset.overviewPhotoId,wrap=img.closest('a');
    try{
      const r=await fetch('/api/carregamentos-finais/'+encodeURIComponent(id)+'/foto?t='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const blob=await r.blob(),url=URL.createObjectURL(blob);
      if(!Array.isArray(window.__loadingPhotoObjectUrls))window.__loadingPhotoObjectUrls=[];
      window.__loadingPhotoObjectUrls.push(url);img.src=url;
      if(wrap){wrap.href=url;wrap.target='_blank';wrap.rel='noopener'}
    }catch(e){img.alt='Foto indisponível'}
  }))
}

function cargoTypeLabel(v){return String(v||'carregamento').toLowerCase()==='descarga'?'Descarga':'Carregamento'}
function renderLoadingRecords(rows){
  const box=$('#loadRecords');clearLoadingPhotoUrls();
  if(box){
    if(!rows.length)box.innerHTML='<div class="muted">Nenhum registro de carga ou descarga encontrado.</div>';
    else{
      box.innerHTML=rows.map(r=>{
        const dt=loadingDateTime(r.capturada_em),tipo=cargoTypeLabel(r.tipo);
        const extras=[];
        if(Number(r.foto2_bytes||0)>0)extras.push('<a href="/api/carregamentos-finais/'+encodeURIComponent(r.id)+'/foto/2" target="_blank" class="secondary" style="padding:4px 7px;font-size:10px">Foto 2</a>');
        if(Number(r.foto3_bytes||0)>0)extras.push('<a href="/api/carregamentos-finais/'+encodeURIComponent(r.id)+'/foto/3" target="_blank" class="secondary" style="padding:4px 7px;font-size:10px">'+(String(r.tipo||'').toLowerCase()==='descarga'?'Coletas e Devoluções':'Foto 3')+'</a>');
        if(Number(r.foto4_bytes||0)>0)extras.push('<a href="/api/carregamentos-finais/'+encodeURIComponent(r.id)+'/foto/4" target="_blank" class="secondary" style="padding:4px 7px;font-size:10px">'+(String(r.tipo||'').toLowerCase()==='descarga'?'Lacre':'Coleta e Devolução')+'</a>');
        if(String(r.tipo||'').toLowerCase()==='descarga'){
          const damageCount=Math.max(0,Math.min(10,Number(r.avaria_count||0)));
          for(let n=1;n<=damageCount;n++)extras.push('<a href="/api/carregamentos-finais/'+encodeURIComponent(r.id)+'/avaria/'+n+'" target="_blank" class="secondary" style="padding:4px 7px;font-size:10px">Avaria '+n+'</a>')
        }
        const returnChecker=(String(r.tipo||'').toLowerCase()==='carregamento'&&r.conferente_coleta_devolucao)?'<br>Conferente coleta/devolução: <b>'+safe(r.conferente_coleta_devolucao)+'</b>':'';
        const editColeta=String(r.tipo||'').toLowerCase()==='carregamento'
          ?'<button type="button" class="secondary" data-edit-coleta-dev="'+safe(r.id)+'" data-checker="'+safe(r.conferente_coleta_devolucao||'')+'" style="padding:4px 7px;font-size:10px">✏️ Coleta e Devolução</button>'
          :'';
        return '<div class="load-record"><a class="load-photo-link" data-loading-photo-id="'+safe(r.id)+'" title="Abrir foto"><img class="load-photo-pending" data-loading-photo-id="'+safe(r.id)+'" alt="Carregando foto do registro"></a><div><b>'+safe(tipo)+' • '+safe(r.motorista||'Motorista não informado')+'</b><div class="meta">Conferente: '+safe(r.conferente||'—')+returnChecker+'<br>Quantidade: <b>'+nf(Number(r.quantidade_entregas||0))+'</b><br>Registro: '+safe(dt)+'</div><div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap">'+extras.join(' ')+editColeta+'</div></div></div>'
      }).join('');
      hydrateLoadingPhotos().catch(()=>{});
      box.querySelectorAll('[data-edit-coleta-dev]').forEach(btn=>btn.onclick=()=>editLoadingCollectReturn(btn.dataset.editColetaDev,btn.dataset.checker||''))
    }
  }
  const today=iso(new Date()),todayRows=rows.filter(r=>{const d=new Date(r.capturada_em);return !isNaN(d)&&iso(d)===today});
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  const todayLoads=todayRows.filter(r=>String(r.tipo||'carregamento').toLowerCase()!=='descarga');
  const todayUnloads=todayRows.filter(r=>String(r.tipo||'').toLowerCase()==='descarga');
  const todayQty=todayRows.reduce((a,r)=>a+Number(r.quantidade_entregas||0),0);
  set('#hubLoadCount',nf(todayRows.length));
  set('#hubLoadLast',rows.length?new Date(rows[0].capturada_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—');
  set('#overviewLoadCount',nf(todayLoads.length));
  set('#overviewUnloadCount',nf(todayUnloads.length));
  set('#overviewLoadQty',nf(todayQty));
  set('#overviewLoadLast',rows.length?new Date(rows[0].capturada_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—');
  const info=$('#hubLoadInfo');
  if(info)info.textContent=rows.length?('Último: '+cargoTypeLabel(rows[0].tipo)+' • '+(rows[0].motorista||'—')+' • '+nf(Number(rows[0].quantidade_entregas||0))+' • '+loadingDateTime(rows[0].capturada_em)):'Nenhum registro realizado ainda.';
  const overviewInfo=$('#overviewLoadInfo');
  if(overviewInfo)overviewInfo.textContent=rows.length?('Último registro: '+cargoTypeLabel(rows[0].tipo)+' • '+(rows[0].motorista||'—')+' • '+loadingDateTime(rows[0].capturada_em)):'Nenhum carregamento ou descarga registrado ainda.';
  renderOverviewLoadingPhotos(rows).catch(()=>{})
}
async function editLoadingCollectReturn(id,currentChecker=''){
  const nome=prompt('Nome do conferente:',currentChecker||'');
  if(nome===null)return;
  const conferente=String(nome||'').trim();
  if(!conferente){alert('Informe o nome do conferente.');return}
  const input=document.createElement('input');
  input.type='file';input.accept='image/*';input.capture='environment';
  input.onchange=async()=>{
    const file=input.files&&input.files[0];if(!file)return;
    try{
      const captured=new Date(file.lastModified||Date.now());
      const foto=await compressLoadingPhoto(file,captured,'Coleta e Devolução');
      const r=await fetch('/api/carregamentos-finais/'+encodeURIComponent(id)+'/coleta-devolucao',{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({conferente_coleta_devolucao:conferente,capturada_em:captured.toISOString(),foto})
      });
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível atualizar.');
      alert('Coleta e Devolução atualizada com sucesso.');
      await refreshLoadingRecords(true)
    }catch(e){alert('Erro ao atualizar: '+e.message)}
  };
  input.click()
}

async function refreshLoadingRecords(useFilters=true){
  if(window.__loadingRecordsBusy)return;
  window.__loadingRecordsBusy=true;
  try{
    const q=new URLSearchParams({limit:'50',t:String(Date.now())});
    const tipo=useFilters?($('#loadFilterType')?.value||'').trim():'';
    const motorista=useFilters?($('#loadFilterDriver')?.value||'').trim():'';
    const data=useFilters?($('#loadFilterDate')?.value||'').trim():'';
    if(tipo)q.set('tipo',tipo);
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
      if(tipo)parts.push('tipo: '+cargoTypeLabel(tipo));
      if(motorista)parts.push('motorista: '+motorista);
      if(data){const p=data.split('-');parts.push('data: '+(p.length===3?p[2]+'/'+p[1]+'/'+p[0]:data))}
      fi.textContent=parts.length?nf(rows.length)+' registro(s) encontrado(s) • '+parts.join(' • '):'Mostrando os últimos registros de carga e descarga.'
    }
  }catch(e){
    const box=$('#loadRecords');if(box)box.innerHTML='<div class="muted">Não foi possível carregar os registros: '+safe(e.message)+'</div>';
    const info=$('#hubLoadInfo');if(info)info.textContent='Registros de carga e descarga indisponíveis no momento.'
  }finally{window.__loadingRecordsBusy=false}
}
function setupCargoOperationForm(cfg){
  const form=$(cfg.form),msg=$(cfg.msg),btn=$(cfg.save);
  const photoEls=(cfg.photos||[]).map(x=>$(x)).filter(Boolean);
  if(!form||!photoEls.length)return;
  if(!window.__cargoFormState)window.__cargoFormState={};
  const state=window.__cargoFormState[cfg.tipo]={photos:['','','',''],damages:[],captured:''};
  const renderPreviews=()=>{
    const box=$(cfg.previewImgs);if(!box)return;
    box.innerHTML=state.photos.map((src,i)=>src?'<div style="width:105px"><img src="'+src+'" style="width:105px;height:85px;object-fit:cover;border-radius:8px"><div class="muted" style="font-size:10px;text-align:center">'+safe(cfg.photoLabels?.[i]||('Foto '+(i+1)))+'</div></div>':'').join('');
    $(cfg.preview).style.display=state.photos.some(Boolean)?'block':'none'
  };
  photoEls.forEach((photo,idx)=>{
    photo.onchange=async()=>{
      const file=photo.files&&photo.files[0];
      if(!file){state.photos[idx]='';renderPreviews();return}
      try{
        if(msg){msg.style.color='#475569';msg.textContent='Preparando '+String(cfg.photoLabels?.[idx]||('foto '+(idx+1))).toLowerCase()+'…'}
        const captured=new Date(file.lastModified||Date.now());
        if(!state.captured)state.captured=captured.toISOString();
        state.photos[idx]=await compressLoadingPhoto(file,captured,cfg.photoLabels?.[idx]||('Foto '+(idx+1)));
        $(cfg.photoTime).textContent='Fotos registradas em '+captured.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'medium'});
        renderPreviews();
        if(msg)msg.textContent='Foto pronta para salvar.'
      }catch(e){
        state.photos[idx]='';
        renderPreviews();
        if(msg){msg.style.color='#b91c1c';msg.textContent=e.message}
      }
    }
  });
  const renderDamagePreviews=()=>{
    if(!cfg.damagePreviewImgs)return;
    const box=$(cfg.damagePreviewImgs);if(!box)return;
    box.innerHTML=(state.damages||[]).map((src,i)=>src?'<div style="width:105px"><img src="'+src+'" style="width:105px;height:85px;object-fit:cover;border-radius:8px"><div class="muted" style="font-size:10px;text-align:center">Avaria '+(i+1)+'</div></div>':'').join('');
    const wrap=$(cfg.damagePreview);if(wrap)wrap.style.display=(state.damages||[]).some(Boolean)?'block':'none'
  };
  const bindDamageInput=(input,idx)=>{
    if(!input)return;
    input.onchange=async()=>{
      const file=input.files&&input.files[0];
      if(!file){state.damages[idx]='';renderDamagePreviews();return}
      try{
        if(msg){msg.style.color='#475569';msg.textContent='Preparando foto de avaria '+(idx+1)+'…'}
        const captured=new Date(file.lastModified||Date.now());
        state.damages[idx]=await compressLoadingPhoto(file,captured,'Avaria '+(idx+1));
        renderDamagePreviews();
        if(msg)msg.textContent='Foto de avaria pronta para salvar.'
      }catch(e){
        state.damages[idx]='';renderDamagePreviews();
        if(msg){msg.style.color='#b91c1c';msg.textContent=e.message}
      }
    }
  };
  if(cfg.damageBox){
    const box=$(cfg.damageBox),add=$(cfg.damageAdd);
    if(box){
      [...box.querySelectorAll('input[type=file]')].forEach((el,i)=>bindDamageInput(el,i));
      if(add)add.onclick=()=>{
        const count=box.querySelectorAll('input[type=file]').length;
        if(count>=10){if(msg){msg.style.color='#b45309';msg.textContent='Limite de 10 fotos de avaria atingido.'}return}
        const n=count+1,label=document.createElement('label');
        label.className='load-photo-btn';label.dataset.damageSlot=String(n);label.htmlFor='unloadDamagePhoto'+n;
        label.innerHTML='📷 Avaria '+n+'<input id="unloadDamagePhoto'+n+'" type="file" accept="image/*" capture="environment">';
        box.appendChild(label);bindDamageInput(label.querySelector('input'),n-1)
      }
    }
  }
  form.onsubmit=async ev=>{
    ev.preventDefault();
    const conferente=$(cfg.checker).value.trim(),motorista=$(cfg.driver).value.trim(),quantidade=Number($(cfg.qty).value);
    if(!state.photos[0]){if(msg){msg.style.color='#b91c1c';msg.textContent='Tire a Foto 1 da operação antes de salvar.'}return}
    btn.disabled=true;
    if(msg){msg.style.color='#475569';msg.textContent='Salvando '+cfg.label.toLowerCase()+'…'}
    try{
      const payload={tipo:cfg.tipo,conferente,motorista,quantidade_entregas:quantidade,capturada_em:state.captured||new Date().toISOString(),foto:state.photos[0]};
      if(cfg.returnChecker){
        const rc=$(cfg.returnChecker)?.value?.trim()||'';
        if(rc)payload.conferente_coleta_devolucao=rc
      }
      if(state.photos[1])payload.foto2=state.photos[1];
      if(state.photos[2])payload.foto3=state.photos[2];
      if(state.photos[3])payload.foto4=state.photos[3];
      if(cfg.damageBox)payload.avarias=(state.damages||[]).filter(Boolean).slice(0,10);
      const r=await fetch('/api/carregamentos-finais',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível salvar.');
      if(msg){msg.style.color='#15803d';msg.textContent='✓ '+cfg.label+' salvo com sucesso.'}
      form.reset();state.photos=['','','',''];state.damages=[];state.captured='';
      renderPreviews();renderDamagePreviews();
      if(cfg.damageBox){
        const box=$(cfg.damageBox);
        if(box)box.innerHTML='<label class="load-photo-btn" data-damage-slot="1" for="unloadDamagePhoto1">📷 Avaria 1<input id="unloadDamagePhoto1" type="file" accept="image/*" capture="environment"></label>';
        bindDamageInput($('#unloadDamagePhoto1'),0)
      }
      await refreshLoadingRecords(true)
    }catch(e){if(msg){msg.style.color='#b91c1c';msg.textContent=e.message}}
    finally{btn.disabled=false}
  }
}
function setupLoadingForm(){
  const refresh=$('#loadRefresh'),search=$('#loadSearch'),clear=$('#loadClear');
  setupCargoOperationForm({tipo:'carregamento',label:'Carregamento',form:'#loadFinalForm',photos:['#loadPhoto','#loadPhoto2','#loadPhoto3','#loadPhoto4'],photoLabels:['Carregamento','Carregamento','Carregamento','Coleta e Devolução'],returnChecker:'#loadReturnChecker',msg:'#loadMsg',save:'#loadSave',checker:'#loadChecker',driver:'#loadDriver',qty:'#loadQty',preview:'#loadPreview',previewImgs:'#loadPreviewImgs',photoTime:'#loadPhotoTime'});
  setupCargoOperationForm({tipo:'descarga',label:'Descarga',form:'#unloadFinalForm',photos:['#unloadPhoto','#unloadPhoto2','#unloadPhoto3','#unloadPhoto4'],photoLabels:['Descarga','Descarga','Coletas e Devoluções','Lacre'],damageBox:'#unloadDamagePhotos',damageAdd:'#unloadAddDamagePhoto',damagePreview:'#unloadDamagePreview',damagePreviewImgs:'#unloadDamagePreviewImgs',msg:'#unloadMsg',save:'#unloadSave',checker:'#unloadChecker',driver:'#unloadDriver',qty:'#unloadQty',preview:'#unloadPreview',previewImgs:'#unloadPreviewImgs',photoTime:'#unloadPhotoTime'});
  if(refresh)refresh.onclick=()=>refreshLoadingRecords(true);
  if(search)search.onclick=()=>refreshLoadingRecords(true);
  if(clear)clear.onclick=()=>{
    if($('#loadFilterType'))$('#loadFilterType').value='';
    if($('#loadFilterDriver'))$('#loadFilterDriver').value='';
    if($('#loadFilterDate'))$('#loadFilterDate').value='';
    refreshLoadingRecords(true)
  };
  if($('#loadFilterDriver'))$('#loadFilterDriver').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();refreshLoadingRecords(true)}});
  if($('#loadFilterDate'))$('#loadFilterDate').addEventListener('change',()=>refreshLoadingRecords(true))
}



let DELIVERY_PROGRAM=null;
function programTomorrowLocal(){
  const d=new Date();d.setDate(d.getDate()+1);return iso(d)
}
function programFmtNumber(v,d=0){
  return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})
}
function programSet(id,v){const e=$(id);if(e)e.textContent=v}

let PROGRAM_MATERIALS=[];
function programNfKey(v){return String(v||'').replace(/\D/g,'').replace(/^0+/,'')||'0'}
function programTextNorm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()}
function programMaterialClass(products){
  const items=(products||[]).map(programTextNorm).filter(Boolean);
  const tubos=items.some(s=>/\bTUBOS?\b|\bTUBULACAO\b|\bCANO(?:S)?\b/.test(s));
  const caixa=items.some(s=>/\bCAIXAS?\s*(?:D[AE]\s*)?AGUA\b|\bRESERVATORIOS?\b|\bTANQUE[S]?\b[^|]{0,60}\bAGUA\b/.test(s));
  return tubos&&caixa?'tubos_caixa_agua':(tubos?'tubos':(caixa?'caixa_agua':'normal'))
}
function programMaterialLabel(v){
  if(v==='tubos_caixa_agua')return'Tubos + Caixa d’água';
  if(v==='tubos')return'Tubos';
  if(v==='caixa_agua')return'Caixa d’água';
  return'Carga normal'
}
function programXmlFirst(node,name){
  if(!node)return null;
  return node.getElementsByTagNameNS?.('*',name)?.[0]||node.getElementsByTagName?.(name)?.[0]||null
}
function programXmlText(node,name){return programXmlFirst(node,name)?.textContent?.trim()||''}
function programParseNfeXml(text){
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw new Error('XML inválido');
  const inf=programXmlFirst(doc,'infNFe'),ide=programXmlFirst(doc,'ide'),emit=programXmlFirst(doc,'emit'),dest=programXmlFirst(doc,'dest');
  if(!inf||!ide||!dest)throw new Error('Arquivo não parece ser um XML de NF-e');
  let chave=String(inf.getAttribute('Id')||'').replace(/^NFe/i,'').replace(/\D/g,'');
  if(chave.length!==44)chave=programXmlText(doc,'chNFe').replace(/\D/g,'');
  const nf=programXmlText(ide,'nNF'),emitente_cnpj=programXmlText(emit,'CNPJ'),emitente_nome=programXmlText(emit,'xNome');
  const cliente=programXmlText(dest,'xNome'),ender=programXmlFirst(dest,'enderDest');
  const cidade=programXmlText(ender,'xMun'),uf=programXmlText(ender,'UF');
  const dets=[...(doc.getElementsByTagNameNS?.('*','det')||doc.getElementsByTagName('det')||[])];
  const produtos=dets.map(d=>programXmlText(d,'xProd')).filter(Boolean);
  if(chave.length!==44)throw new Error('Chave de acesso de 44 dígitos não encontrada');
  if(!nf)throw new Error('Número da NF não encontrado');
  return{chave,nf,emitente_cnpj,emitente_nome,cliente,cidade,uf,produtos,classificacao:programMaterialClass(produtos)}
}
async function programImportXmlFiles(){
  const input=$('#programXmlFiles'),status=$('#programMaterialsStatus'),btn=$('#programImportXml');
  const files=[...(input?.files||[])];
  if(!files.length){if(status)status.textContent='Selecione um ou mais arquivos XML de NF-e.';return}
  if(btn)btn.disabled=true;
  if(status)status.textContent='Lendo '+nf(files.length)+' XML(s)…';
  try{
    const rows=[],errors=[];
    for(const file of files){
      try{rows.push(programParseNfeXml(await file.text()))}catch(e){errors.push(file.name+': '+e.message)}
    }
    if(!rows.length)throw new Error(errors[0]||'Nenhum XML de NF-e válido foi encontrado.');
    const resp=await fetch('/api/nf-materiais/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})});
    const j=await resp.json().catch(()=>({}));
    if(!resp.ok||!j.ok)throw new Error(j.error||'Falha ao salvar as classificações.');
    const especiais=rows.filter(x=>x.classificacao!=='normal').length;
    if(status)status.textContent='✓ '+nf(j.imported||0)+' NF(s) importada(s) • '+nf(especiais)+' com tubos/caixa d’água'+(errors.length?' • '+nf(errors.length)+' arquivo(s) ignorado(s)':'');
    if(input)input.value='';
    await loadProgramMaterials()
  }catch(e){
    if(status)status.textContent='Erro na importação: '+e.message
  }finally{if(btn)btn.disabled=false}
}
function programMergeMaterialClass(a,b){
  const vals=[a,b];
  const tube=vals.some(x=>x==='tubos'||x==='tubos_caixa_agua');
  const water=vals.some(x=>x==='caixa_agua'||x==='tubos_caixa_agua');
  return tube&&water?'tubos_caixa_agua':(tube?'tubos':(water?'caixa_agua':'normal'))
}
function renderProgramMaterials(){
  const open=Array.isArray(DELIVERY_PROGRAM?.openRows)?DELIVERY_PROGRAM.openRows:[];
  const byNf=new Map();
  for(const r of open){
    const k=programNfKey(r.nf);
    if(!byNf.has(k))byNf.set(k,[]);
    byNf.get(k).push(r)
  }
  const combined=new Map();
  for(const ssw of open){
    const cls=String(ssw.specialClass||'normal');
    if(cls==='normal')continue;
    const key='cte:'+(ssw.ctrc||programNfKey(ssw.nf));
    combined.set(key,{classificacao:cls,produtos:Array.isArray(ssw.specialProducts)?ssw.specialProducts:[],ssw,fonte:'SSW'})
  }
  for(const m of PROGRAM_MATERIALS){
    const hits=byNf.get(programNfKey(m.nf))||[];
    for(const ssw of hits){
      const key='cte:'+(ssw.ctrc||programNfKey(ssw.nf));
      const prev=combined.get(key);
      combined.set(key,{
        classificacao:programMergeMaterialClass(prev?.classificacao||'normal',m.classificacao||'normal'),
        produtos:[...new Set([...(prev?.produtos||[]),...(Array.isArray(m.produtos)?m.produtos:[])])].slice(0,30),
        ssw,fonte:prev?'SSW + XML':'XML',cliente:m.cliente||'',cidade:m.cidade||''
      })
    }
  }
  const matched=[...combined.values()].filter(x=>x.classificacao!=='normal');
  const tubes=matched.filter(x=>x.classificacao==='tubos'||x.classificacao==='tubos_caixa_agua').length;
  const water=matched.filter(x=>x.classificacao==='caixa_agua'||x.classificacao==='tubos_caixa_agua').length;
  programSet('#programTubes',nf(tubes));
  programSet('#programWaterTanks',nf(water));
  programSet('#programSpecialOpen',nf(matched.length));
  const tableEl=$('#programMaterialsTable');
  if(tableEl){
    tableEl.innerHTML='<thead><tr><th>Tipo</th><th>NF</th><th>CT-e</th><th>Cliente</th><th>Cidade</th><th>Peso</th><th>Produtos identificados</th><th>Fonte</th></tr></thead><tbody>'+
      (matched.length?matched.map(x=>{
        const s=x.ssw||{},products=(x.produtos||[]).filter(Boolean).slice(0,10);
        return '<tr><td><span class="materials-type">'+safe(programMaterialLabel(x.classificacao))+'</span></td><td><b>'+safe(s.nf||'—')+'</b></td><td>'+safe(s.ctrc||'—')+'</td><td>'+safe(s.cliente||x.cliente||'—')+'</td><td>'+safe(s.cidade||x.cidade||'—')+'</td><td>'+programFmtNumber(s.peso||0,0)+' kg</td><td class="materials-products">'+safe(products.join(' • ')||s.tipoMercadoria||'Produto especial identificado')+'</td><td>'+safe(x.fonte||'SSW')+'</td></tr>'
      }).join(''):'<tr><td colspan="8" class="muted">Nenhum tubo ou caixa d’água foi identificado nas entregas consultadas para esta programação.</td></tr>')+
      '</tbody>'
  }
  const status=$('#programMaterialsStatus');
  if(status){
    const auto=open.filter(x=>x.specialClass&&x.specialClass!=='normal').length;
    status.textContent='Leitura automática SSW: '+nf(auto)+' especial(is) • XMLs especiais cadastrados: '+nf(PROGRAM_MATERIALS.length)+' • resultado cruzado: '+nf(matched.length)+'.'
  }
}
async function loadProgramMaterials(){
  try{
    const r=await fetch('/api/nf-materiais?special=1&limit=3000&t='+Date.now(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao consultar materiais.');
    PROGRAM_MATERIALS=Array.isArray(j.rows)?j.rows:[];
    renderProgramMaterials()
  }catch(e){
    const status=$('#programMaterialsStatus');if(status)status.textContent='Não foi possível consultar os materiais classificados: '+e.message
  }
}

function renderDeliveryProgram(data){
  DELIVERY_PROGRAM=data;
  programSet('#programOpen',nf(data.totalOpen||0));
  programSet('#programDeliveries',nf(data.programmed||0));
  programSet('#programVehicles',nf(data.vehicles||0));
  programSet('#programCost',brl(Number(data.totalCost||0)));
  programSet('#programKg',programFmtNumber(data.totalKg||0,0));
  programSet('#programReview',nf(data.reviewCount||0));
  programSet('#programFreight',data.totalFreight>0?brl(Number(data.totalFreight||0)):'—');
  programSet('#programCostFreight',data.costFreightPct!==null&&data.costFreightPct!==undefined?programFmtNumber(data.costFreightPct,1)+'%':'—');
  programSet('#programEconomicRoutes',nf(data.economicRoutes||0)+' / '+nf(data.routesWithFreight||0));
  programSet('#hubProgVehicles',nf(data.vehicles||0));
  programSet('#hubProgDeliveries',nf(data.programmed||0));
  programSet('#hubProgCost',brl(Number(data.totalCost||0)));
  const hub=$('#hubProgInfo');
  if(hub)hub.textContent=(data.weekday||'')+' • '+nf(data.programmed||0)+' entrega(s) • '+nf(data.vehicles||0)+' veículo(s) • '+brl(Number(data.totalCost||0))+(data.costFreightPct!==null&&data.costFreightPct!==undefined?' • custo/frete '+programFmtNumber(data.costFreightPct,1)+'%':'');
  const status=$('#programStatus');
  if(status)status.textContent='Programação de '+String(data.date||'').split('-').reverse().join('/')+' ('+(data.weekday||'')+') • '+nf(data.programmed||0)+' de '+nf(data.totalOpen||0)+' entrega(s) em aberto • '+nf(data.vehicles||0)+' veículo(s) • '+nf(data.notScheduledToday||0)+' pertencem a outros dias.';
  const box=$('#programLoads');
  const loads=Array.isArray(data.loads)?data.loads:[];
  if(box){
    if(!loads.length)box.innerHTML='<div class="card program-empty">Nenhuma carga pôde ser programada automaticamente para esta data.</div>';
    else box.innerHTML=loads.map((load,idx)=>{
      const rows=(load.items||[]).map((r,i)=>'<tr><td>'+(i+1)+'</td><td>'+safe(r.nf||'—')+'</td><td>'+safe(r.ctrc||'—')+'</td><td>'+safe(r.cliente||'—')+'</td><td>'+safe(r.cidade||'—')+'</td><td>'+safe(r.previsao||'—')+'</td><td>'+programFmtNumber(r.peso||0,0)+' kg</td><td>'+(Number(r.frete||0)>0?brl(Number(r.frete||0)):'—')+'</td><td>'+programFmtNumber(r.distanceKm||0,0)+' km</td></tr>').join('');
      const kg=Math.max(0,Math.min(100,Number(load.kgUtil||0)));
      const econClass=load.costFreightPct===null||load.costFreightPct===undefined?'':(load.economicOk?' economic-ok':' economic-warn');
      const econText=load.costFreightPct===null||load.costFreightPct===undefined?'Frete não identificado':(programFmtNumber(load.costFreightPct,1)+'% '+(load.economicOk?'✓ dentro da meta':'acima da meta'));
      return '<div class="card program-load'+econClass+'"><div class="program-load-head"><div><div class="program-load-title">Veículo '+(idx+1)+' • '+safe(load.vehicle)+'</div><div class="program-load-tags"><span>'+safe(load.region||'')+'</span><span>Setor '+safe(load.sector||'—')+'</span><span>'+safe(load.distanceBand||'')+'</span><span>'+nf(load.deliveries||0)+' entrega(s)</span></div></div><div class="program-load-title">'+brl(Number(load.cost||0))+'</div></div>'+
        '<div class="program-load-kpis">'+
        '<div class="program-load-mini"><span>Peso</span><b>'+programFmtNumber(load.kg||0,0)+' / '+programFmtNumber(load.kgCapacity||0,0)+' kg</b><div class="program-bar"><span style="width:'+kg+'%"></span></div></div>'+

        '<div class="program-load-mini"><span>Ocupação peso</span><b>'+programFmtNumber(load.kgUtil||0,1)+'%</b></div>'+
        '<div class="program-load-mini"><span>Frete da rota</span><b>'+(Number(load.freight||0)>0?brl(Number(load.freight||0)):'—')+'</b></div>'+
        '<div class="program-load-mini"><span>Custo ÷ frete</span><b class="'+(load.economicOk?'program-economic-ok':(load.costFreightPct===null||load.costFreightPct===undefined?'program-economic-na':'program-economic-warn'))+'">'+safe(econText)+'</b></div>'+

        '<div class="program-load-mini"><span>Limite entregas</span><b>'+nf(load.deliveries||0)+' / '+nf(load.maxStops||0)+'</b></div>'+
        '<div class="program-load-mini"><span>Destino mais distante</span><b>'+programFmtNumber(load.maxDistanceKm||0,0)+' km</b></div></div>'+
        '<div class="scroll"><table><thead><tr><th>Ordem</th><th>NF</th><th>CT-e</th><th>Cliente</th><th>Cidade</th><th>Previsão SSW</th><th>Peso</th><th>Frete</th><th>Distância</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'
    }).join('')
  }
  const review=(data.review||[]).map(r=>({
    motivo:r.reviewReason||'Revisar',
    nf:r.nf||'',ctrc:r.ctrc||'',cliente:r.cliente||'',cidade:r.cidade||'',
    previsao:r.previsao||'',peso:r.peso?programFmtNumber(r.peso,0)+' kg':'—',
    status:r.status||''
  }));
  if($('#programReviewTable'))table('#programReviewTable',[['Motivo','motivo'],['NF','nf'],['CT-e','ctrc'],['Cliente','cliente'],['Cidade','cidade'],['Previsão SSW','previsao'],['Peso','peso'],['Status','status']],review)
}
async function refreshDeliveryProgram(force=false){
  if(!hasAnyPerm(['programacao','roteirizador','dashboard','ssw_saidas']))return;
  if(window.__programBusy)return;
  window.__programBusy=true;
  const date=$('#programDate')?.value||programTomorrowLocal(),status=$('#programStatus');
  if(status)status.textContent='Consultando entregas em aberto no SSW, peso e distância das cidades…';
  const btn=$('#programGenerate'),rf=$('#programRefresh');
  if(btn)btn.disabled=true;if(rf)rf.disabled=true;
  try{
    const q=new URLSearchParams({date});if(force)q.set('force','1');q.set('t',Date.now());
    const r=await fetch('/api/programacao-entregas?'+q.toString(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível gerar a programação.');
    renderDeliveryProgram(j);
    await loadProgramMaterials()
  }catch(e){
    if(status)status.textContent='Erro ao gerar programação: '+e.message;
    const hub=$('#hubProgInfo');if(hub)hub.textContent='Programação indisponível: '+e.message
  }finally{
    window.__programBusy=false;if(btn)btn.disabled=false;if(rf)rf.disabled=false
  }
}
function printDeliveryProgram(){
  const d=DELIVERY_PROGRAM;if(!d){alert('Gere a programação antes de imprimir.');return}
  const loads=(d.loads||[]).map((l,idx)=>{
    const rows=(l.items||[]).map((r,i)=>'<tr><td>'+(i+1)+'</td><td>'+safe(r.nf||'')+'</td><td>'+safe(r.ctrc||'')+'</td><td>'+safe(r.cliente||'')+'</td><td>'+safe(r.cidade||'')+'</td><td>'+programFmtNumber(r.peso||0,0)+'</td><td>'+(Number(r.frete||0)>0?brl(Number(r.frete||0)):'—')+'</td></tr>').join('');
    return '<h2>Veículo '+(idx+1)+' • '+safe(l.vehicle)+' • '+brl(Number(l.cost||0))+'</h2><div class="meta">'+safe(l.region||'')+' • '+safe(l.distanceBand||'')+' • '+nf(l.deliveries||0)+' entregas • '+programFmtNumber(l.kg||0,0)+' kg • frete '+(Number(l.freight||0)>0?brl(Number(l.freight||0)):'não identificado')+' • custo/frete '+(l.costFreightPct!==null&&l.costFreightPct!==undefined?programFmtNumber(l.costFreightPct,1)+'%':'—')+'</div><table><thead><tr><th>#</th><th>NF</th><th>CT-e</th><th>Cliente</th><th>Cidade</th><th>kg</th><th>Frete</th></tr></thead><tbody>'+rows+'</tbody></table>'
  }).join('');
  const w=window.open('','_blank','noopener,noreferrer');
  if(!w){alert('Libere pop-ups para imprimir o relatório.');return}
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Programação de Entregas</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#111827}h1{font-size:22px}h2{font-size:16px;margin:22px 0 5px}.meta{font-size:11px;color:#475569;margin-bottom:7px}table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:15px}th,td{border:1px solid #cbd5e1;padding:5px;text-align:left}th{background:#f1f5f9}@media print{body{margin:8mm}}</style></head><body><h1>Programação de Entregas • '+safe(String(d.date||'').split('-').reverse().join('/'))+'</h1><div class="meta">'+safe(d.weekday||'')+' • '+nf(d.programmed||0)+' entregas • '+nf(d.vehicles||0)+' veículos • custo previsto '+brl(Number(d.totalCost||0))+'</div>'+loads+'<script>window.onload=()=>window.print()<\/script></body></html>');
  w.document.close()
}

let PROGRAM_SIMULATION=null,PROGRAM_SIM_MAP=null,PROGRAM_SIM_LAYER=null,PROGRAM_SIM_MODE='actual';
const PROGRAM_SIM_COLORS=['#2563eb','#dc2626','#16a34a','#9333ea','#ea580c','#0891b2','#ca8a04','#db2777','#4f46e5','#059669','#7c3aed','#c2410c','#0284c7','#be123c','#65a30d','#0f766e'];
function simSet(id,v){const e=$(id);if(e)e.textContent=v}
function simPct(v){return v===null||v===undefined?'—':programFmtNumber(v,1)+'%'}
function simRouteName(r,mode){
  if(mode==='actual')return (r.romaneio||'Romaneio')+(r.motorista?' • '+r.motorista:'');
  return 'Simulado '+r.id+' • '+(r.vehicleType||'Veículo')
}
function simRenderMap(mode='actual'){
  PROGRAM_SIM_MODE=mode;
  const data=PROGRAM_SIMULATION,box=$('#programSimulationMap'),legend=$('#simMapLegend');
  const b1=$('#simMapActual'),b2=$('#simMapOptimized');
  if(b1)b1.classList.toggle('active',mode==='actual');
  if(b2)b2.classList.toggle('active',mode==='simulated');
  if(!data||!box)return;
  if(typeof L==='undefined'){box.innerHTML='<div style="padding:24px" class="muted">Mapa indisponível. O comparativo de rotas continua disponível nas tabelas.</div>';return}
  if(!PROGRAM_SIM_MAP){
    PROGRAM_SIM_MAP=L.map(box,{zoomControl:true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(PROGRAM_SIM_MAP)
  }
  if(PROGRAM_SIM_LAYER)PROGRAM_SIM_LAYER.remove();
  PROGRAM_SIM_LAYER=L.layerGroup().addTo(PROGRAM_SIM_MAP);
  const routes=mode==='actual'?(data.actual?.routes||[]):(data.simulated?.routes||[]);
  const bounds=[];
  const leg=[];
  routes.forEach((route,idx)=>{
    const color=PROGRAM_SIM_COLORS[idx%PROGRAM_SIM_COLORS.length],name=simRouteName(route,mode);
    const coords=(route.geometry?.coordinates||[]).map(x=>[Number(x[1]),Number(x[0])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
    if(coords.length){
      L.polyline(coords,{color,weight:5,opacity:.82}).addTo(PROGRAM_SIM_LAYER).bindTooltip(name);
      coords.forEach(x=>bounds.push(x))
    }
    const pts=route.points||[];
    pts.forEach((p,pos)=>{
      const lat=Number(p.lat),lon=Number(p.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      bounds.push([lat,lon]);
      if(pos===0)return;
      const icon=L.divIcon({className:'',html:'<div style="background:'+color+';color:#fff;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:800;border:2px solid #fff;box-shadow:0 1px 4px #0005">'+pos+'</div>',iconSize:[22,22],iconAnchor:[11,11]});
      L.marker([lat,lon],{icon}).addTo(PROGRAM_SIM_LAYER).bindPopup('<b>'+safe(name)+'</b><br>'+safe(p.label||'Parada'))
    });
    leg.push('<span><i class="simulation-dot" style="background:'+color+'"></i>'+safe(name)+'</span>')
  });
  if(legend)legend.innerHTML=leg.join('');
  if(bounds.length){
    const bb=L.latLngBounds(bounds);
    if(bb.isValid())PROGRAM_SIM_MAP.fitBounds(bb.pad(.10))
  }else PROGRAM_SIM_MAP.setView([-22.739,-47.331],9);
  setTimeout(()=>PROGRAM_SIM_MAP.invalidateSize(),100)
}
function simActualRows(routes){
  return (routes||[]).map(r=>({
    romaneio:r.romaneio||'—',motorista:r.motorista||'—',veiculo:r.veiculo||'—',
    tipo:(r.vehicleType||'—')+(r.vehicleTypeInferred?' *':''),
    entregas:nf(r.deliveries||0),peso:programFmtNumber(r.kg||0,0)+' kg',
    ocupacao:programFmtNumber(r.kgUtil||0,1)+'%',
    cidades:(r.cities||[]).join(', '),km:r.distanceKm!==null&&r.distanceKm!==undefined?programFmtNumber(r.distanceKm,1)+' km':'—',
    frete:Number(r.freight||0)>0?brl(Number(r.freight||0)):'—',custo:brl(Number(r.cost||0)),pct:simPct(r.costFreightPct)
  }))
}
function simOptimizedRows(routes){
  return (routes||[]).map(r=>({
    rota:'Simulado '+r.id,tipo:r.vehicleType||'—',origem:(r.sourceRomaneios||[]).join(' + ')||'—',
    entregas:nf(r.deliveries||0),peso:programFmtNumber(r.kg||0,0)+' kg',
    ocupacao:programFmtNumber(r.kgUtil||0,1)+'%',cidades:(r.cities||[]).join(', '),
    km:r.distanceKm!==null&&r.distanceKm!==undefined?programFmtNumber(r.distanceKm,1)+' km':'—',
    frete:Number(r.freight||0)>0?brl(Number(r.freight||0)):'—',custo:brl(Number(r.cost||0)),pct:simPct(r.costFreightPct),
    meta:r.costFreightPct===null||r.costFreightPct===undefined?'Sem frete':(r.economicOk?'Dentro de 40%':'Acima de 40%')
  }))
}
function renderProgramSimulation(data){
  PROGRAM_SIMULATION=data;
  simSet('#simActualVehicles',nf(data.actual?.vehicles||0));
  simSet('#simNewVehicles',nf(data.simulated?.vehicles||0));
  simSet('#simSavedVehicles',nf(data.savings?.vehicles||0));
  simSet('#simActualCost',brl(Number(data.actual?.cost||0)));
  simSet('#simNewCost',brl(Number(data.simulated?.cost||0)));
  simSet('#simSavings',brl(Number(data.savings?.cost||0))+(Number(data.savings?.costPct||0)>0?' • '+programFmtNumber(data.savings.costPct,1)+'%':''));
  simSet('#simActualKm',data.actual?.distanceKm?programFmtNumber(data.actual.distanceKm,1)+' km':'—');
  simSet('#simNewKm',data.simulated?.distanceKm?programFmtNumber(data.simulated.distanceKm,1)+' km':'—');
  const status=$('#programSimulationStatus');
  if(status){
    const diff=Number(data.savings?.vehicles||0);
    status.textContent='Análise de '+String(data.date||'').split('-').reverse().join('/')+' • '+nf(data.deliveries||0)+' entrega(s) • '+nf(data.actual?.vehicles||0)+' carro(s) emitidos → '+nf(data.simulated?.vehicles||0)+' carro(s) simulados'+(diff>0?' • potencial de eliminar '+nf(diff)+' carro(s)':' • quantidade de carros já próxima do mínimo encontrado')+(data.reviewCount?' • '+nf(data.reviewCount)+' entrega(s) ficaram fora por falta de dados':'');
  }
  if($('#simActualTable'))table('#simActualTable',
    [['Romaneio','romaneio'],['Motorista','motorista'],['Placa','veiculo'],['Tipo','tipo'],['Entregas','entregas'],['Peso','peso'],['Ocupação','ocupacao'],['Cidades','cidades'],['KM','km'],['Frete','frete'],['Custo','custo'],['Custo/Frete','pct']],
    simActualRows(data.actual?.routes||[]));
  if($('#simOptimizedTable'))table('#simOptimizedTable',
    [['Rota','rota'],['Veículo','tipo'],['Romaneios de origem','origem'],['Entregas','entregas'],['Peso','peso'],['Ocupação','ocupacao'],['Cidades','cidades'],['KM','km'],['Frete','frete'],['Custo','custo'],['Custo/Frete','pct'],['Meta','meta']],
    simOptimizedRows(data.simulated?.routes||[]));
  const rec=$('#programSimulationRecommendations'),recs=data.recommendations||[];
  if(rec){
    const headline=Number(data.savings?.vehicles||0)>0
      ?'<div class="simulation-rec"><b>Potencial encontrado</b>É possível reduzir de '+nf(data.actual?.vehicles||0)+' para '+nf(data.simulated?.vehicles||0)+' veículos, com economia estimada de <strong>'+brl(Number(data.savings?.cost||0))+'</strong>.</div>'
      :'<div class="simulation-rec"><b>Quantidade de veículos</b>A simulação não encontrou redução segura na quantidade de carros com as regras atuais de peso, limite de entregas e coerência geográfica.</div>';
    rec.innerHTML=headline+recs.slice(0,12).map(x=>'<div class="simulation-rec"><b>'+safe(x.title||'Sugestão')+'</b>'+safe(x.detail||'')+'</div>').join('');
  }
  simRenderMap('simulated')
}
async function refreshProgramSimulation(force=true){
  if(window.__programSimulationBusy)return;
  window.__programSimulationBusy=true;
  const btn=$('#programSimulate'),status=$('#programSimulationStatus');
  if(btn)btn.disabled=true;
  if(status)status.textContent='Lendo os romaneios emitidos hoje, cruzando peso/frete e recalculando a frota e as rotas…';
  try{
    const q=new URLSearchParams({t:String(Date.now())});if(force)q.set('force','1');
    const r=await fetch('/api/programacao-simulacao?'+q.toString(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível simular os romaneios.');
    renderProgramSimulation(j)
  }catch(e){
    if(status)status.textContent='Erro na simulação: '+e.message
  }finally{
    window.__programSimulationBusy=false;if(btn)btn.disabled=false
  }
}

function setupDeliveryProgram(){
  const date=$('#programDate'),gen=$('#programGenerate'),rf=$('#programRefresh'),pr=$('#programPrint');
  const xml=$('#programXmlFiles'),imp=$('#programImportXml'),rm=$('#programRefreshMaterials');
  const sim=$('#programSimulate'),mapActual=$('#simMapActual'),mapOptimized=$('#simMapOptimized');
  if(date&&!date.value)date.value=programTomorrowLocal();
  if(gen)gen.onclick=()=>refreshDeliveryProgram(false);
  if(rf)rf.onclick=()=>refreshDeliveryProgram(true);
  if(pr)pr.onclick=printDeliveryProgram;
  if(imp)imp.onclick=programImportXmlFiles;
  if(rm)rm.onclick=loadProgramMaterials;
  if(sim)sim.onclick=()=>refreshProgramSimulation(true);
  if(mapActual)mapActual.onclick=()=>simRenderMap('actual');
  if(mapOptimized)mapOptimized.onclick=()=>simRenderMap('simulated');
  if(xml)xml.onchange=()=>{const n=xml.files?.length||0;const s=$('#programMaterialsStatus');if(s)s.textContent=n?nf(n)+' XML(s) selecionado(s). Clique em Importar e classificar.':'Nenhum XML selecionado.'}
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

let TRACKING_MAP=null,TRACKING_LAYER=null,TRACKING_DATA=null,TRACKING_ROUTE_DATA=null,TRACKING_DRIVER_ROWS=[];
let TRACKING_MAP_VIEW_READY=false;
let TRACKING_HISTORY_MAP_UI=null,TRACKING_HISTORY_LAYER_UI=null,TRACKING_HISTORY_RESULT=null,TRACKING_HISTORY_AT=0;
const TRACKING_LOGICAL_ROUTES=new Map();
const TRACKING_PLAN_CACHE=new Map();
const TRACKING_HISTORY_CACHE=new Map();
const TRACKING_DAY_HISTORY_INFLIGHT=new Map();
const TRACKING_MARKERS=new Map();
let TRACKING_BASE_POSITION={lat:-22.69552,lon:-47.307,address:'Avenida do Algodão, 316, Distrito Industrial Salto Grande, Americana/SP'};
let TRACKING_ANALYSIS_ROWS=[];
let TRACKING_ANALYSIS_AT=0;
let TRACKING_CURRENT_DATE=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
let TRACKING_MAP_DRIVER_FILTER=localStorage.getItem('construlog_tracking_map_driver')||'';
let TRACKING_MAP_ONLY_DRIVERS=localStorage.getItem('construlog_tracking_map_only_drivers')==='1';
let TRACKING_AUTO_SECONDS=Math.max(5,Math.min(300,Number(localStorage.getItem('construlog_tracking_refresh_seconds')||30)));
let TRACKING_NEXT_REFRESH=0;
const TRACKING_COLORS=['#2563eb','#dc2626','#16a34a','#9333ea','#ea580c','#0891b2','#ca8a04','#db2777','#4f46e5','#059669'];
const TRACKING_PLANNED_COLOR='#2563eb';
const TRACKING_ACTUAL_COLORS=['#f97316','#06b6d4','#eab308','#22c55e','#ec4899','#8b5cf6','#14b8a6','#ef4444','#84cc16','#6366f1'];
function trackingActualColor(row){
  const key=trackingDriverKey(row?.driver_name,row?.vehicle_plate)||'MOTORISTA';
  const rows=Array.isArray(TRACKING_DRIVER_ROWS)?TRACKING_DRIVER_ROWS:[];
  const driver=trackingNorm(row?.driver_name),plate=trackingNorm(row?.vehicle_plate);
  const idx=rows.findIndex(x=>{
    const xd=trackingNorm(x?.motorista||x?.driver_name),xp=trackingNorm(x?.veiculo||x?.vehicle_plate);
    return (plate&&xp===plate)||(driver&&xd===driver)
  });
  if(idx>=0)return TRACKING_ACTUAL_COLORS[idx%TRACKING_ACTUAL_COLORS.length];
  let h=0;for(let i=0;i<key.length;i++)h=((h<<5)-h+key.charCodeAt(i))|0;
  return TRACKING_ACTUAL_COLORS[Math.abs(h)%TRACKING_ACTUAL_COLORS.length]
}
function trackingMapPopulateControls(rows){
  const select=$('#trackingMapDriver'),check=$('#trackingMapOnlyDrivers');
  const active=(rows||[]).filter(r=>r&&(r.operation_active||r.session_id||r.map_active||trackingHasPosition(r)));
  const unique=new Map();
  active.forEach(r=>{
    const key=trackingDriverKey(r.driver_name,r.vehicle_plate);
    if(key&&!unique.has(key))unique.set(key,r)
  });
  if(select){
    const exists=TRACKING_MAP_DRIVER_FILTER&&unique.has(TRACKING_MAP_DRIVER_FILTER);
    if(TRACKING_MAP_DRIVER_FILTER&&!exists){
      TRACKING_MAP_DRIVER_FILTER='';
      localStorage.removeItem('construlog_tracking_map_driver')
    }
    select.innerHTML='<option value="">Todos os motoristas</option>'+
      [...unique.entries()].map(([key,r])=>'<option value="'+safe(key)+'">'+safe(trackingDisplayName(r.driver_name))+(r.vehicle_plate?' • '+safe(r.vehicle_plate):'')+'</option>').join('');
    select.value=TRACKING_MAP_DRIVER_FILTER
  }
  if(check)check.checked=TRACKING_MAP_ONLY_DRIVERS
}
function trackingMapApplyFilters(){
  const select=$('#trackingMapDriver'),check=$('#trackingMapOnlyDrivers');
  TRACKING_MAP_DRIVER_FILTER=String(select?.value||'');
  TRACKING_MAP_ONLY_DRIVERS=!!check?.checked;
  if(TRACKING_MAP_DRIVER_FILTER)localStorage.setItem('construlog_tracking_map_driver',TRACKING_MAP_DRIVER_FILTER);
  else localStorage.removeItem('construlog_tracking_map_driver');
  localStorage.setItem('construlog_tracking_map_only_drivers',TRACKING_MAP_ONLY_DRIVERS?'1':'0');
  TRACKING_MAP_VIEW_READY=false;
  if(TRACKING_DATA)renderTrackingMap(TRACKING_DATA)
}
function trackingMapSelectDriver(){
  const select=$('#trackingMapDriver'),check=$('#trackingMapOnlyDrivers');
  TRACKING_MAP_DRIVER_FILTER=String(select?.value||'');
  // Ao escolher um motorista, sempre abre a visão completa dele:
  // base + rota planejada + percurso executado + todas as entregas + visitados.
  if(TRACKING_MAP_DRIVER_FILTER){
    TRACKING_MAP_ONLY_DRIVERS=false;
    if(check)check.checked=false;
    localStorage.setItem('construlog_tracking_map_only_drivers','0')
  }else{
    TRACKING_MAP_ONLY_DRIVERS=!!check?.checked
  }
  if(TRACKING_MAP_DRIVER_FILTER)localStorage.setItem('construlog_tracking_map_driver',TRACKING_MAP_DRIVER_FILTER);
  else localStorage.removeItem('construlog_tracking_map_driver');
  TRACKING_MAP_VIEW_READY=false;
  if(TRACKING_DATA)renderTrackingMap(TRACKING_DATA)
}
const TRACKING_DEVIATION_KM=3;
function trackingNorm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim()}
function trackingDisplayName(v){return driverDisplayName(v)||'Motorista'}
function trackingAgeLabel(sec){
  if(sec===null||sec===undefined||sec==='')return'—';
  const s=Number(sec);if(!Number.isFinite(s))return'—';
  if(s<60)return Math.max(0,Math.round(s))+' s';
  if(s<3600)return Math.round(s/60)+' min';
  return (s/3600).toFixed(1).replace('.',',')+' h'
}
function trackingPointSegmentKm(lat,lon,lat1,lon1,lat2,lon2){
  const rad=Math.PI/180,mean=((lat+lat1+lat2)/3)*rad,kx=111.32*Math.cos(mean),ky=110.574;
  const px=lon*kx,py=lat*ky,x1=lon1*kx,y1=lat1*ky,x2=lon2*kx,y2=lat2*ky,dx=x2-x1,dy=y2-y1;
  const den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/den)):0;
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy))
}
function trackingDistanceToGeometry(lat,lon,geometry){
  const coords=geometry?.coordinates||[];if(coords.length<2)return null;
  let best=Infinity;
  for(let i=1;i<coords.length;i++){
    const a=coords[i-1],b=coords[i];
    if(!Array.isArray(a)||!Array.isArray(b))continue;
    const d=trackingPointSegmentKm(Number(lat),Number(lon),Number(a[1]),Number(a[0]),Number(b[1]),Number(b[0]));
    if(Number.isFinite(d)&&d<best)best=d
  }
  return Number.isFinite(best)?best:null
}
function trackingPlannedCoords(route){
  const geometry=route?.outboundGeometry||route?.geometry;
  const gc=(geometry?.coordinates||[]).map(x=>[Number(x[1]),Number(x[0])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
  if(gc.length>1)return gc;
  const points=Array.isArray(route?.points)?route.points:[];
  if(points.length<2)return[];
  const order=Array.isArray(route?.optimizedOrder)&&route.optimizedOrder.length
    ?route.optimizedOrder
    :Array.from({length:Math.max(0,points.length-1)},(_,i)=>i+1);
  const seq=[0,...order];
  return seq.map(i=>[Number(points[i]?.lat),Number(points[i]?.lon)]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]))
}
function trackingHasPosition(row){
  const lat=row?.latitude,lon=row?.longitude;
  if(lat===null||lat===undefined||lat===''||lon===null||lon===undefined||lon==='')return false;
  const a=Number(lat),b=Number(lon);
  return Number.isFinite(a)&&Number.isFinite(b)&&a>=-90&&a<=90&&b>=-180&&b<=180
}
function trackingDriverKey(driver,plate){return trackingNorm(driver)+'|'+trackingNorm(plate)}
// Um motorista, uma linha: quando dois celulares ativos caem no mesmo motorista do dia (troca
// de aparelho, cadastro digitado diferente), fica o que está dando sinal; no empate, o que
// deu sinal por último.
function trackingOnePhonePerDriver(rows){
  const t=v=>{const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0};
  const score=r=>{const dev=Number(r.device_age_seconds);return[(r.device_age_seconds!==null&&Number.isFinite(dev)&&dev<=300)?1:0,r.never_connected?0:1,t(r.last_seen_at),t(r.enrolled_at)]};
  const better=(a,b)=>{const x=score(a),y=score(b);for(let i=0;i<x.length;i++){if(x[i]!==y[i])return x[i]>y[i]}return false};
  const best=new Map(),out=[];
  for(const r of (Array.isArray(rows)?rows:[])){
    if(r.test_only||!r.operation_active||!r.device_id){out.push(r);continue}
    const k=trackingDriverKey(r.driver_name,r.vehicle_plate),cur=best.get(k);
    if(!cur){best.set(k,r);out.push(r)}
    else if(better(r,cur)){out[out.indexOf(cur)]=r;best.set(k,r)}
  }
  return out
}
function trackingMatchOperationRow(row){
  const rows=Array.isArray(TRACKING_DRIVER_ROWS)?TRACKING_DRIVER_ROWS:[];
  const p=trackingNorm(row?.vehicle_plate||row?.veiculo||''),d=trackingNorm(row?.driver_name||row?.motorista||'');
  if(p){
    const byPlate=rows.find(x=>trackingNorm(x.veiculo||x.vehicle_plate||'')===p);
    if(byPlate)return byPlate
  }
  if(d){
    const exact=rows.find(x=>trackingNorm(x.motorista||x.driver_name||'')===d);
    if(exact)return exact;
    const near=rows.filter(x=>{
      const xd=trackingNorm(x.motorista||x.driver_name||'');
      return xd&&(xd.includes(d)||d.includes(xd))
    });
    if(near.length===1)return near[0];
    const first=d.split(' ')[0];
    const firstHits=rows.filter(x=>trackingNorm(x.motorista||x.driver_name||'').split(' ')[0]===first);
    if(first&&firstHits.length===1)return firstHits[0]
  }
  return null
}
function trackingPopulateDriverList(){
  const sel=$('#trackingDriverName'),info=$('#trackingDriverDayInfo');if(!sel)return;
  const source=(Array.isArray(TRACKING_DRIVER_ROWS)&&TRACKING_DRIVER_ROWS.length)
    ?TRACKING_DRIVER_ROWS
    :(TRACKING_ROUTE_DATA?.actual?.routes||[]).map(r=>({motorista:r.motorista,veiculo:r.veiculo,romaneio:r.romaneio}));
  const byKey=new Map();
  source.forEach(r=>{
    const driver=String(r.motorista||'').trim(),plate=String(r.veiculo||'').trim();if(!driver)return;
    const key=trackingDriverKey(driver,plate);
    if(!byKey.has(key))byKey.set(key,{key,driver,plate,romaneios:[],manifesto:false});
    const item=byKey.get(key),roms=Array.isArray(r.romaneios)?r.romaneios:[r.romaneio].filter(Boolean);
    roms.forEach(v=>{const rom=String(v||'').trim();if(rom&&!item.romaneios.includes(rom))item.romaneios.push(rom)});
    if(r.manifesto||String(r.origem||'').includes('manifesto'))item.manifesto=true
  });
  const rows=[...byKey.values()].sort((a,b)=>a.driver.localeCompare(b.driver,'pt-BR')||a.plate.localeCompare(b.plate,'pt-BR'));
  const previous=sel.value;
  sel.innerHTML='';
  const first=document.createElement('option');first.value='';first.textContent=rows.length?'Selecione o motorista...':'Nenhum motorista com romaneio hoje';sel.appendChild(first);
  rows.forEach(x=>{
    const o=document.createElement('option');o.value=x.key;o.dataset.driver=x.driver;o.dataset.plate=x.plate;
    const sourceLabel=x.romaneios.length
      ?(' • Rom. '+x.romaneios.join(', ')+(x.manifesto?' • Manifesto':''))
      :(x.manifesto?' • Manifesto':'');
    o.textContent=trackingDisplayName(x.driver)+(x.plate?' • '+x.plate:' • placa não informada')+sourceLabel;
    sel.appendChild(o)
  });
  if(previous&&rows.some(x=>x.key===previous))sel.value=previous;
  if(info){
    const manifestCount=rows.filter(x=>x.manifesto).length,romCount=rows.filter(x=>x.romaneios.length).length;
    info.textContent=rows.length
      ?nf(rows.length)+' motorista(s)/veículo(s) trabalhando hoje • '+nf(romCount)+' com romaneio • '+nf(manifestCount)+' com manifesto/saída.'
      :'A operação do dia não retornou motoristas com romaneio ou manifesto. Para testar o GPS, use o botão “Usar teste”.';
  }
  trackingDriverSelectionChanged(false)
}
function trackingUseTest(){
  const sel=$('#trackingDriverName'),plate=$('#trackingVehiclePlate'),msg=$('#trackingEnrollMsg'),codeBox=$('#trackingActivationCode');if(!sel)return;
  let opt=[...sel.options].find(o=>o.dataset?.test==='1');
  if(!opt){
    opt=document.createElement('option');opt.value='TESTE JUNIOR|TESTE001';opt.dataset.driver='TESTE - JUNIOR';opt.dataset.plate='TESTE001';opt.dataset.test='1';
    opt.textContent='🧪 TESTE - JUNIOR • TESTE001';sel.appendChild(opt)
  }
  sel.value=opt.value;if(plate)plate.value='TESTE001';
  if(codeBox){codeBox.style.display='none';codeBox.textContent=''}
  if(msg)msg.textContent='Modo teste selecionado. Clique em Gerar código de ativação e use o código no app TESTE.'
}
function trackingDriverSelectionChanged(resetCode=true){
  const sel=$('#trackingDriverName'),plateEl=$('#trackingVehiclePlate'),msg=$('#trackingEnrollMsg'),codeBox=$('#trackingActivationCode');
  const opt=sel?.selectedOptions?.[0],plate=opt?.dataset?.plate||'';
  if(plateEl)plateEl.value=plate;
  if(resetCode&&codeBox){codeBox.style.display='none';codeBox.textContent=''}
  if(resetCode&&msg)msg.textContent=opt?.dataset?.driver
    ?'Motorista selecionado: '+opt.dataset.driver+(plate?' • placa '+plate:' • placa não identificada no SSW')+'. Gere o código para ativar o celular.'
    :'Selecione um motorista que esteja trabalhando hoje.'
}
function trackingBaseIdentity(rowOrDriver,plate=''){
  if(rowOrDriver&&typeof rowOrDriver==='object'){
    return {
      driver:String(rowOrDriver.original_driver_name||rowOrDriver.driver_name||'').replace(/^TESTE\s*-\s*/i,'').trim(),
      plate:String(rowOrDriver.original_vehicle_plate||rowOrDriver.vehicle_plate||'').replace(/\s+T$/i,'').trim()
    }
  }
  return {driver:String(rowOrDriver||'').replace(/^TESTE\s*-\s*/i,'').trim(),plate:String(plate||'').replace(/\s+T$/i,'').trim()}
}
function trackingFindRoute(driver,plate){
  const base=trackingBaseIdentity(driver,plate),n=trackingNorm(base.driver),p=trackingNorm(base.plate);
  const logical=TRACKING_LOGICAL_ROUTES.get(trackingDriverKey(driver,plate));
  if(logical?.geometry||logical?.outboundGeometry||(Array.isArray(logical?.points)&&logical.points.length>1))return logical;
  if(p){
    for(const [key,plan] of TRACKING_LOGICAL_ROUTES){
      const kp=key.split('|')[1]||'';
      if(kp===p&&(plan?.geometry||plan?.outboundGeometry||(Array.isArray(plan?.points)&&plan.points.length>1)))return plan
    }
  }
  if(n){
    for(const [key,plan] of TRACKING_LOGICAL_ROUTES){
      const kd=key.split('|')[0]||'';
      if((kd===n||kd.includes(n)||n.includes(kd))&&(plan?.geometry||plan?.outboundGeometry||(Array.isArray(plan?.points)&&plan.points.length>1)))return plan
    }
  }
  const routes=TRACKING_ROUTE_DATA?.actual?.routes||[];
  if(p){
    const exactPlate=routes.find(r=>trackingNorm(r.veiculo)===p);
    if(exactPlate)return exactPlate
  }
  if(n){
    const exactName=routes.find(r=>trackingNorm(r.motorista)===n);
    if(exactName)return exactName;
    const nearName=routes.find(r=>{
      const rn=trackingNorm(r.motorista);
      return rn&&n&&(rn.includes(n)||n.includes(rn))
    });
    if(nearName)return nearName
  }
  return null
}
function trackingStatus(row){
  if(row.test_only&&!trackingHasPosition(row))return{key:'warn',label:'TESTE • aguardando GPS',distance:null};
  if(row.operation_active&&!row.session_id&&!row.map_active&&!trackingHasPosition(row)){
    return row.device_approved
      ?{key:'warn',label:'Aparelho aprovado • aguardando sinal/GPS',distance:null}
      :{key:'bad',label:'Sem sinal / sem GPS hoje',distance:null}
  }
  if(!row.session_id&&!row.map_active&&!trackingHasPosition(row))return{key:'off',label:'Inativo',distance:null};
  if(String(row.session_status||'').toLowerCase()==='ended')return{key:'off',label:'Rota finalizada • permanece no mapa até o fim do dia',distance:null};
  const age=Number(row.age_seconds),deviceAge=Number(row.device_age_seconds);
  if(Number.isFinite(deviceAge)&&deviceAge>300)return{key:'bad',label:'Sem sinal do app • '+trackingAgeLabel(deviceAge),distance:null};
  if(!trackingHasPosition(row)){
    return Number.isFinite(deviceAge)&&deviceAge<=120
      ?{key:'warn',label:'App conectado • aguardando GPS',distance:null}
      :{key:'warn',label:'Aguardando GPS',distance:null}
  }
  if(Number.isFinite(age)&&age>300){
    return Number.isFinite(deviceAge)&&deviceAge<=120
      ?{key:'warn',label:'App conectado • GPS atrasado '+trackingAgeLabel(age),distance:null}
      :{key:'bad',label:'Sem sinal • '+trackingAgeLabel(age),distance:null}
  }
  if(Number.isFinite(age)&&age>120)return{key:'warn',label:'GPS atrasado • '+trackingAgeLabel(age),distance:null};
  const route=trackingFindRoute(row.driver_name,row.vehicle_plate);
  if(trackingPlannedCoords(route).length<2){
    const roms=trackingRomaneiosFor(row.driver_name,row.vehicle_plate);
    return roms.length
      ?{key:'warn',label:'Ativo • Rom. '+roms.join(', ')+' • preparando rota',distance:null}
      :{key:'warn',label:'Ativo • aguardando romaneio',distance:null}
  }
  const routeGeometry=(route?.outboundGeometry||route?.geometry)||{type:'LineString',coordinates:trackingPlannedCoords(route).map(x=>[x[1],x[0]])};
  const d=trackingDistanceToGeometry(Number(row.latitude),Number(row.longitude),routeGeometry);
  if(d===null)return{key:'warn',label:'Ativo • rota indisponível',distance:null};
  return d<=TRACKING_DEVIATION_KM
    ?{key:'ok',label:'Na rota',distance:d}
    :{key:'bad',label:'Desvio de '+d.toFixed(1).replace('.',',')+' km',distance:d}
}
function trackingLoadMapView(){
  try{
    const x=JSON.parse(localStorage.getItem('construlog_tracking_map_view')||'null');
    const lat=Number(x?.lat),lng=Number(x?.lng),zoom=Number(x?.zoom);
    if(Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lng)&&lng>=-180&&lng<=180&&Number.isFinite(zoom)&&zoom>=3&&zoom<=19){
      return{lat,lng,zoom}
    }
  }catch{}
  return null
}
function trackingSaveMapView(){
  if(!TRACKING_MAP)return;
  const p=TRACKING_MAP.getCenter(),z=TRACKING_MAP.getZoom();
  if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||!Number.isFinite(z))return;
  localStorage.setItem('construlog_tracking_map_view',JSON.stringify({lat:p.lat,lng:p.lng,zoom:z}));
  TRACKING_MAP_VIEW_READY=true
}
function trackingFirstName(v){
  return trackingDisplayName(v).split(/\s+/).filter(Boolean)[0]||'Motorista'
}
function trackingDriverOperationRow(driver,plate){
  const n=trackingNorm(driver),p=trackingNorm(plate),rows=TRACKING_DRIVER_ROWS||[];
  if(p){
    const exactPlate=rows.find(r=>trackingNorm(r.veiculo)===p);
    if(exactPlate)return exactPlate
  }
  const exactName=rows.find(r=>trackingNorm(r.motorista)===n);
  if(exactName)return exactName;
  return rows.find(r=>{
    const rn=trackingNorm(r.motorista);
    return rn&&n&&(rn.includes(n)||n.includes(rn))
  })||null
}
function trackingRomaneiosFor(driver,plate){
  const r=trackingDriverOperationRow(driver,plate);if(!r)return[];
  const arr=Array.isArray(r.romaneios)?r.romaneios:[r.romaneio].filter(Boolean);
  return [...new Set(arr.map(x=>String(x||'').trim()).filter(Boolean))]
}
function trackingHaversineKm(a,b){
  const lat1=Number(a?.latitude??a?.lat),lon1=Number(a?.longitude??a?.lon),lat2=Number(b?.latitude??b?.lat),lon2=Number(b?.longitude??b?.lon);
  if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return Infinity;
  const R=6371,rad=Math.PI/180,dLat=(lat2-lat1)*rad,dLon=(lon2-lon1)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h))
}
function trackingNearestClient(row,route){
  const lat=Number(row?.latitude),lon=Number(row?.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
  let stops=[];
  if(Array.isArray(route?.stops)&&route.stops.length)stops=route.stops;
  else if(Array.isArray(route?.points)&&route.points.length>1)stops=route.points.slice(1);
  if(!stops.length){
    const key=trackingDriverKey(row?.driver_name,row?.vehicle_plate);
    stops=(TRACKING_ANALYSIS_ROWS||[]).filter(x=>trackingDriverKey(x.driver,x.plate)===key).map(x=>({
      destinatario:x.client,cidade:x.city,lat:x.lat,lon:x.lon
    }))
  }
  let best=null;
  for(const s of stops){
    const d=trackingHaversineKm({lat,lon},s);
    if(!Number.isFinite(d))continue;
    if(!best||d<best.distanceKm)best={
      client:String(s.destinatario||s.client||s.label||'Cliente').trim(),
      city:String(s.cidade||s.city||'').trim(),
      distanceKm:d
    }
  }
  return best
}
function trackingFocusDriver(key){
  const marker=TRACKING_MARKERS.get(String(key||''));
  if(!marker||!TRACKING_MAP)return;
  const p=marker.getLatLng();
  if(p)TRACKING_MAP.setView(p,Math.max(TRACKING_MAP.getZoom(),14),{animate:true});
  marker.openPopup()
}
function trackingParseDateTime(v){
  const raw=String(v||'').trim();if(!raw)return null;
  let m=raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if(m){
    const z=/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)?raw:(m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+(m[6]||'00')+'-03:00');
    const d=new Date(z);return Number.isFinite(d.getTime())?d:null
  }
  m=raw.match(/^(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if(m&&m[4]){
    const y=m[3].length===2?String(2000+Number(m[3])):m[3];
    const d=new Date(y+'-'+m[2]+'-'+m[1]+'T'+m[4]+':'+m[5]+':'+(m[6]||'00')+'-03:00');
    return Number.isFinite(d.getTime())?d:null
  }
  const d=new Date(raw);return Number.isFinite(d.getTime())?d:null
}
function trackingTimeLabel(v){
  const d=v instanceof Date?v:trackingParseDateTime(v);
  return d?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'
}
function trackingHistoryDuration(sec){
  const s=Math.max(0,Math.round(Number(sec)||0));
  if(s<60)return s+' s';
  const h=Math.floor(s/3600),m=Math.round((s%3600)/60);
  return h?(h+' h '+m+' min'):(m+' min')
}
async function trackingHistoryLoadDrivers(preserve=true){
  const date=$('#trackingHistoryDate')?.value||'',sel=$('#trackingHistoryDriver');if(!date||!sel)return;
  const previous=preserve?sel.value:'';
  sel.disabled=true;
  try{
    const r=await fetch('/api/tracking/history-drivers?date='+encodeURIComponent(date)+'&t='+Date.now(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao listar motoristas.');
    const grouped=new Map();
    (j.rows||[]).forEach(x=>{
      const name=String(x.driver_name||'').trim();if(!name)return;
      const key=trackingNorm(name);
      if(!grouped.has(key))grouped.set(key,{name,plates:new Set(),points:0});
      const g=grouped.get(key);if(x.vehicle_plate)g.plates.add(String(x.vehicle_plate));g.points+=Number(x.points||0)
    });
    const rows=[...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    sel.innerHTML='<option value="">Todos os motoristas (coletivo)</option>'+rows.map(x=>'<option value="'+safe(x.name)+'">'+safe(x.name)+(x.plates.size?' • '+safe([...x.plates].join(', ')):'')+'</option>').join('');
    if(previous&&rows.some(x=>x.name===previous))sel.value=previous;
    const info=$('#trackingHistoryInfo');
    if(info&&!TRACKING_HISTORY_RESULT)info.textContent=rows.length?nf(rows.length)+' motorista(s) com pontos GPS nesta data. Selecione um ou mantenha a visão coletiva.':'Nenhum ponto GPS encontrado nesta data.'
  }catch(e){
    sel.innerHTML='<option value="">Todos os motoristas (coletivo)</option>';
    const info=$('#trackingHistoryInfo');if(info)info.textContent='Não foi possível carregar os motoristas do histórico: '+e.message
  }finally{sel.disabled=false}
}
function trackingHistoryRenderMap(data){
  const box=$('#trackingHistoryMap');if(!box)return;
  if(typeof L==='undefined'){box.innerHTML='<div class="muted" style="padding:22px">Mapa indisponível.</div>';return}
  if(!TRACKING_HISTORY_MAP_UI){
    TRACKING_HISTORY_MAP_UI=L.map(box,{zoomControl:true}).setView([-22.739,-47.331],9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(TRACKING_HISTORY_MAP_UI)
  }
  if(TRACKING_HISTORY_LAYER_UI)TRACKING_HISTORY_LAYER_UI.remove();
  TRACKING_HISTORY_LAYER_UI=L.layerGroup().addTo(TRACKING_HISTORY_MAP_UI);
  const sessions=data?.sessions||[],drivers=[...new Set(sessions.map(x=>String(x.driver_name||'').trim()).filter(Boolean))];
  const colorByDriver=new Map(drivers.map((d,i)=>[d,TRACKING_COLORS[i%TRACKING_COLORS.length]]));
  const bounds=[],legend=$('#trackingHistoryLegend');
  if(legend)legend.innerHTML=drivers.map(d=>'<span><i class="tracking-history-dot" style="background:'+colorByDriver.get(d)+'"></i>'+safe(d)+'</span>').join('');
  const stopCounters=new Map();
  sessions.forEach(session=>{
    const color=colorByDriver.get(String(session.driver_name||'').trim())||TRACKING_COLORS[0];
    const coords=(session.points||[]).map(p=>[Number(p.latitude),Number(p.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if(coords.length){
      L.polyline(coords,{color,weight:4,opacity:.8}).addTo(TRACKING_HISTORY_LAYER_UI)
        .bindTooltip(safe(trackingDisplayName(session.driver_name||'Motorista'))+(session.vehicle_plate?' • '+safe(session.vehicle_plate):''));
      coords.forEach(p=>bounds.push(p))
    }
    (session.stops||[]).forEach(stop=>{
      const driver=String(session.driver_name||'Motorista'),n=(stopCounters.get(driver)||0)+1;stopCounters.set(driver,n);
      const lat=Number(stop.latitude),lon=Number(stop.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      const icon=L.divIcon({className:'',html:'<div style="min-width:30px;height:30px;padding:0 5px;border-radius:15px;background:#fff;border:3px solid '+color+';box-shadow:0 2px 7px #0005;display:grid;place-items:center;font-size:11px;font-weight:900">'+n+'</div>',iconSize:[34,34],iconAnchor:[17,17]});
      const popup='<b>'+safe(trackingDisplayName(driver))+' • Parada '+n+'</b><br>'+safe(session.vehicle_plate||'')+
        '<br>Chegada: '+safe(trackingTimeLabel(stop.arrived_at))+
        '<br>Saída: '+safe(trackingTimeLabel(stop.left_at))+
        '<br>Tempo parado: <b>'+safe(trackingHistoryDuration(stop.duration_seconds))+'</b>'+
        '<br>GPS: '+lat.toFixed(5)+', '+lon.toFixed(5);
      L.marker([lat,lon],{icon}).addTo(TRACKING_HISTORY_LAYER_UI).bindPopup(popup).bindTooltip(safe(trackingFirstName(driver))+' • '+n);
      bounds.push([lat,lon])
    })
  });
  if(bounds.length){
    const bb=L.latLngBounds(bounds);if(bb.isValid())TRACKING_HISTORY_MAP_UI.fitBounds(bb.pad(.10))
  }else TRACKING_HISTORY_MAP_UI.setView([-22.739,-47.331],9);
  setTimeout(()=>TRACKING_HISTORY_MAP_UI.invalidateSize(),80)
}
function trackingHistoryRender(data){
  TRACKING_HISTORY_RESULT=data;TRACKING_HISTORY_AT=Date.now();
  const sum=data?.summary||{},sessions=data?.sessions||[];
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  set('#trackingHistoryDrivers',nf(sum.drivers||0));
  set('#trackingHistorySessions',nf(sum.sessions||0));
  set('#trackingHistoryDistance',(Number(sum.distance_km||0)).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' km');
  set('#trackingHistoryStops',nf(sum.stops||0));
  const chosen=$('#trackingHistoryDriver')?.value||'';
  const info=$('#trackingHistoryInfo');
  if(info)info.textContent=(chosen?chosen:'Todos os motoristas')+' • '+String(data.date||'').split('-').reverse().join('/')+' • '+nf(sum.points||0)+' ponto(s) GPS • '+nf(sum.stops||0)+' parada(s) detectada(s).';
  const flat=[];
  sessions.forEach(s=>(s.stops||[]).forEach((stop,i)=>flat.push({session:s,stop,index:i+1})));
  flat.sort((a,b)=>new Date(a.stop.arrived_at)-new Date(b.stop.arrived_at));
  const table=$('#trackingHistoryStopsTable');
  if(table){
    const body=flat.length?flat.map(x=>{
      const s=x.session,p=x.stop,lat=Number(p.latitude),lon=Number(p.longitude);
      return '<tr>'+
        '<td><b>'+safe(trackingDisplayName(s.driver_name||'Motorista'))+'</b><div class="muted">'+safe(s.vehicle_plate||'')+'</div></td>'+
        '<td>'+x.index+'º</td>'+
        '<td>'+safe(trackingTimeLabel(p.arrived_at))+'</td>'+
        '<td>'+safe(trackingTimeLabel(p.left_at))+'</td>'+
        '<td><span class="tracking-stop-time">'+safe(trackingHistoryDuration(p.duration_seconds))+'</span></td>'+
        '<td>'+safe(Number.isFinite(lat)&&Number.isFinite(lon)?lat.toFixed(5)+', '+lon.toFixed(5):'—')+'</td>'+
        '<td>'+nf(p.point_count||0)+'</td>'+
        '</tr>'
    }).join(''):'<tr><td colspan="7" class="muted">Nenhuma parada de 5 minutos ou mais foi detectada neste período.</td></tr>';
    table.innerHTML='<thead><tr><th>Motorista</th><th>Parada</th><th>Chegada</th><th>Saída</th><th>Tempo parado</th><th>Ponto GPS</th><th>Amostras</th></tr></thead><tbody>'+body+'</tbody>'
  }
  trackingHistoryRenderMap(data)
}
async function refreshTrackingHistory(){
  const date=$('#trackingHistoryDate')?.value||'',driver=$('#trackingHistoryDriver')?.value||'',info=$('#trackingHistoryInfo'),btn=$('#trackingHistorySearch');
  if(!date){if(info)info.textContent='Selecione uma data.';return}
  if(btn){btn.disabled=true;btn.textContent='Consultando…'}
  if(info)info.textContent='Carregando percurso e identificando pontos de parada…';
  try{
    const q=new URLSearchParams({date});if(driver)q.set('driver',driver);q.set('t',String(Date.now()));
    const r=await fetch('/api/tracking/history?'+q.toString(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível consultar o histórico.');
    trackingHistoryRender(j)
  }catch(e){
    TRACKING_HISTORY_RESULT=null;TRACKING_HISTORY_AT=0;
    if(info)info.textContent='Erro ao consultar histórico: '+e.message;
    const table=$('#trackingHistoryStopsTable');if(table)table.innerHTML='<tbody><tr><td class="muted">Histórico indisponível.</td></tr></tbody>'
  }finally{if(btn){btn.disabled=false;btn.textContent='Consultar histórico'}}
}
async function trackingHistoryToday(){
  const d=iso(new Date());if($('#trackingHistoryDate'))$('#trackingHistoryDate').value=d;
  await trackingHistoryLoadDrivers(false);await refreshTrackingHistory()
}
function printTrackingHistory(){
  const data=TRACKING_HISTORY_RESULT;if(!data){alert('Consulte um histórico antes de imprimir.');return}
  const table=$('#trackingHistoryStopsTable'),driver=$('#trackingHistoryDriver')?.value||'Todos os motoristas';
  const w=window.open('','_blank');if(!w)return alert('O navegador bloqueou a janela de impressão.');
  const title='Histórico de Rastreio de Carga • '+String(data.date||'').split('-').reverse().join('/');
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+safe(title)+'</title><style>body{font-family:Segoe UI,Arial;padding:22px;color:#172033}h1{font-size:20px;margin:0 0 5px}.meta{color:#64748b;font-size:12px;margin-bottom:16px}.sum{display:flex;gap:20px;flex-wrap:wrap;margin:12px 0 18px}.sum b{font-size:18px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#f1f5f9}@page{size:landscape;margin:10mm}</style></head><body>');
  w.document.write('<h1>'+safe(title)+'</h1><div class="meta">'+safe(driver)+'</div>');
  w.document.write('<div class="sum"><span>Motoristas: <b>'+nf(data.summary?.drivers||0)+'</b></span><span>Rotas: <b>'+nf(data.summary?.sessions||0)+'</b></span><span>Distância: <b>'+Number(data.summary?.distance_km||0).toLocaleString('pt-BR',{maximumFractionDigits:1})+' km</b></span><span>Paradas: <b>'+nf(data.summary?.stops||0)+'</b></span></div>');
  w.document.write(table?table.outerHTML:'');
  w.document.write('</body></html>');w.document.close();setTimeout(()=>{w.focus();w.print()},250)
}
async function trackingFetchPlan(romaneio,date){
  const key=date+'|'+romaneio,hit=TRACKING_PLAN_CACHE.get(key);
  if(hit&&Date.now()-hit.at<30*1000)return hit.value;
  const r=await fetch('/api/roteirizador/rota?date='+encodeURIComponent(date)+'&romaneio='+encodeURIComponent(romaneio)+'&t='+Date.now(),{cache:'no-store'});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||('Falha ao montar rota '+romaneio));
  TRACKING_PLAN_CACHE.set(key,{at:Date.now(),value:j});
  return j
}
async function trackingBuildLogicalPlan(row,date){
  const driver=String(row?.driver_name||'').trim(),plate=String(row?.vehicle_plate||'').trim();
  if(!driver&&!plate)return null;
  const key='manifestos|'+date+'|'+trackingDriverKey(driver,plate),hit=TRACKING_PLAN_CACHE.get(key);
  if(hit&&Date.now()-hit.at<20*1000)return hit.value;
  try{
    const q=new URLSearchParams({date,driver,plate,t:String(Date.now())});
    const r=await fetch('/api/tracking/planned-route?'+q.toString(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(r.ok&&j.ok){
      const plan={...j,logical:true,plannedSource:'romaneios',motorista:driver||j.motorista||'',veiculo:plate||j.veiculo||''};
      TRACKING_PLAN_CACHE.set(key,{at:Date.now(),value:plan});
      return plan
    }
  }catch{}
  const roms=trackingRomaneiosFor(driver,plate);
  if(!roms.length)return null;
  const plans=[];
  for(const rom of roms.slice(0,8)){
    try{
      const p=await trackingFetchPlan(rom,date);
      if(p?.stops?.length)plans.push(p)
    }catch(e){console.warn('Rota '+rom,e)}
  }
  if(!plans.length)return null;
  let plan=plans[0];
  if(plans.length>1){
    const seen=new Set(),stops=[];
    plans.forEach(p=>(p.stops||[]).forEach(s=>{
      const k=trackingNorm(s.ctrc||'')+'|'+String(s.nf||'')+'|'+Number(s.lat).toFixed(5)+'|'+Number(s.lon).toFixed(5);
      if(seen.has(k))return;seen.add(k);stops.push(s)
    }));
    if(stops.length){
      try{
        const rr=await fetch('/api/roteirizador/recalcular',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          date,romaneio:roms.join(' + '),motorista:driver,veiculo:plate,stops
        })});
        const jj=await rr.json().catch(()=>({}));
        if(rr.ok&&jj.ok)plan=jj
      }catch{}
    }
  }
  plan={...plan,logical:true,plannedSource:'romaneios',romaneios:roms,motorista:driver||plan.motorista||'',veiculo:plate||plan.veiculo||''};
  TRACKING_PLAN_CACHE.set(key,{at:Date.now(),value:plan});
  return plan
}
async function trackingHistory(sessionId){
  if(!sessionId)return[];
  const hit=TRACKING_HISTORY_CACHE.get(sessionId);
  if(hit&&Date.now()-hit.at<12000)return hit.rows;
  const r=await fetch('/api/tracking/history?session_id='+encodeURIComponent(sessionId)+'&t='+Date.now(),{cache:'no-store'});
  const j=await r.json().catch(()=>({}));
  const rows=r.ok&&j.ok&&Array.isArray(j.rows)?j.rows:[];
  TRACKING_HISTORY_CACHE.set(sessionId,{at:Date.now(),rows});
  return rows
}
function trackingDayHistoryKey(date,driver,plate=''){
  return 'day|'+String(date||'')+'|'+trackingDriverKey(driver,plate)
}
function trackingMergeGpsRows(...groups){
  const map=new Map();
  for(const rows of groups)for(const p of (Array.isArray(rows)?rows:[])){
    const lat=Number(p?.latitude),lon=Number(p?.longitude),at=String(p?.captured_at||'');
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||!at)continue;
    const key=at+'|'+lat.toFixed(6)+'|'+lon.toFixed(6);
    if(!map.has(key))map.set(key,p)
  }
  return[...map.values()].sort((a,b)=>{
    const ta=trackingParseDateTime(a.captured_at)?.getTime?.()||0;
    const tb=trackingParseDateTime(b.captured_at)?.getTime?.()||0;
    return ta-tb
  })
}
async function trackingDayHistory(date,driver,plate=''){
  if(!date||!driver)return[];
  const key=trackingDayHistoryKey(date,driver,plate),hit=TRACKING_HISTORY_CACHE.get(key);
  if(hit&&Date.now()-hit.at<120000)return hit.rows;
  if(TRACKING_DAY_HISTORY_INFLIGHT.has(key))return TRACKING_DAY_HISTORY_INFLIGHT.get(key);
  const job=(async()=>{
    const q=new URLSearchParams({date,driver,plate:String(plate||''),raw:'1',t:String(Date.now())});
    const r=await fetch('/api/tracking/history?'+q.toString(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao consultar histórico GPS do dia.');
    let merged=[];
    if(j.raw&&Array.isArray(j.rows)){
      merged=trackingMergeGpsRows(j.rows.map(p=>({...p,_session_id:String(p.session_id||'')})))
    }else{
      const rows=[];
      for(const s of (Array.isArray(j.sessions)?j.sessions:[])){
        const sid=String(s.session_id||'');
        rows.push(...(s.points||[]).map(p=>({...p,_session_id:sid})))
      }
      merged=trackingMergeGpsRows(rows)
    }
    TRACKING_HISTORY_CACHE.set(key,{at:Date.now(),rows:merged,summary:j.summary||{points:merged.length}});
    return merged
  })().finally(()=>TRACKING_DAY_HISTORY_INFLIGHT.delete(key));
  TRACKING_DAY_HISTORY_INFLIGHT.set(key,job);
  return job
}
function trackingPrepareHistory(history){
  return (history||[]).map(p=>({
    ...p,
    _date:trackingParseDateTime(p.captured_at),
    _acc:Math.max(0,Number(p.accuracy_m)||0),
    _speed:Number.isFinite(Number(p.speed_mps))?Number(p.speed_mps):null,
    _lat:Number(p.latitude),_lon:Number(p.longitude)
  })).filter(p=>p._date&&Number.isFinite(p._lat)&&Number.isFinite(p._lon))
    .sort((a,b)=>a._date-b._date)
}
function trackingInterpolateDate(a,b,t){
  const ta=a?._date?.getTime?.(),tb=b?._date?.getTime?.();
  if(!Number.isFinite(ta)||!Number.isFinite(tb))return null;
  return new Date(ta+(tb-ta)*Math.max(0,Math.min(1,t)))
}
function trackingSegmentCircleRoots(a,b,stop,radiusMeters=100){
  const slat=Number(stop?.lat),slon=Number(stop?.lon);
  const aLat=Number(a?.latitude),aLon=Number(a?.longitude),bLat=Number(b?.latitude),bLon=Number(b?.longitude);
  if(![slat,slon,aLat,aLon,bLat,bLon].every(Number.isFinite))return[];
  const rad=Math.PI/180,kx=111320*Math.cos(slat*rad),ky=110574;
  const ax=(aLon-slon)*kx,ay=(aLat-slat)*ky,bx=(bLon-slon)*kx,by=(bLat-slat)*ky;
  const dx=bx-ax,dy=by-ay,A=dx*dx+dy*dy;
  if(A<1e-9)return[];
  const B=2*(ax*dx+ay*dy),C=ax*ax+ay*ay-radiusMeters*radiusMeters;
  const D=B*B-4*A*C;if(D<0)return[];
  const q=Math.sqrt(D),r1=(-B-q)/(2*A),r2=(-B+q)/(2*A);
  return[r1,r2].filter(t=>t>=0&&t<=1).sort((x,y)=>x-y)
}
function trackingVisitWindow(stop,history,allowCepApprox=false,baixaAt=null){
  const precision=String(stop?.precision||'').toLowerCase();
  const source=String(stop?.coordinateSource||'').toLowerCase();
  if(precision==='cidade'||source.includes('cidade-aproximada')||source.includes('simulacao')||source.includes('simulação')){
    return{arrival:null,departure:null,approx:false}
  }
  const prepared=Array.isArray(history)&&history.length&&history[0]?._date?history:trackingPrepareHistory(history);
  // Para confirmação exata usa apenas pontos GPS com precisão de até 80 m.
  const valid=prepared.filter(p=>p._acc<=80).map(p=>({
    ...p,_distanceKm:trackingHaversineKm({latitude:p._lat,longitude:p._lon},stop)
  })).filter(p=>Number.isFinite(p._distanceKm));

  const isCep=precision==='cep'||source.includes('cep');
  if(!isCep){
    let arrival=null,departure=null,inside=false;
    if(valid.length){
      if(valid[0]._distanceKm<=0.10){
        arrival={date:valid[0]._date,raw:valid[0].captured_at,distanceKm:valid[0]._distanceKm,accuracyM:valid[0]._acc};
        inside=true
      }
      for(let i=1;i<valid.length&&!departure;i++){
        const a=valid[i-1],b=valid[i],aIn=a._distanceKm<=0.10,bIn=b._distanceKm<=0.10;
        const gapMs=b._date-a._date;
        const sameSession=!a._session_id||!b._session_id||a._session_id===b._session_id;
        const continuous=sameSession&&gapMs>=0&&gapMs<=15*60*1000;
        const roots=continuous?trackingSegmentCircleRoots(a,b,stop,100):[];
        if(!arrival){
          if(!aIn&&bIn){
            const d=roots.length?trackingInterpolateDate(a,b,roots[0]):b._date;
            arrival={date:d||b._date,raw:b.captured_at,distanceKm:Math.min(a._distanceKm,b._distanceKm),accuracyM:Math.min(a._acc,b._acc)};
            inside=true
          }else if(!aIn&&!bIn&&roots.length>=2){
            const ad=trackingInterpolateDate(a,b,roots[0]),dd=trackingInterpolateDate(a,b,roots[roots.length-1]);
            arrival={date:ad||a._date,raw:a.captured_at,distanceKm:0.10,accuracyM:Math.min(a._acc,b._acc)};
            departure={date:dd||b._date,raw:b.captured_at,distanceKm:0.10,accuracyM:Math.min(a._acc,b._acc)}
          }else if(bIn){
            arrival={date:b._date,raw:b.captured_at,distanceKm:b._distanceKm,accuracyM:b._acc};inside=true
          }
        }else if(inside&&!bIn&&continuous){
          const root=roots.length?roots[roots.length-1]:null,d=root!==null?trackingInterpolateDate(a,b,root):b._date;
          departure={date:d||b._date,raw:b.captured_at,distanceKm:b._distanceKm,accuracyM:b._acc};inside=false
        }
      }
    }
    if(arrival)return{arrival,departure,approx:false}
    return{arrival:null,departure:null,approx:false}
  }

  // CEP não representa a porta do cliente. Com baixa SSW confirmada, usamos o
  // horário da baixa como âncora para encontrar a parada GPS real mais plausível.
  if(allowCepApprox&&valid.length){
    const baixa=baixaAt instanceof Date?baixaAt:trackingParseDateTime(baixaAt);
    const nearCep=valid.filter(p=>p._distanceKm<=0.60&&(p._speed===null||p._speed<=3))
      .filter(p=>!baixa||Math.abs(p._date-baixa)<=120*60*1000);
    let candidates=nearCep;

    // Se o centro do CEP ficou longe da rua real, procura uma parada do veículo
    // próxima no tempo da baixa. Limita a 45 min para não atribuir outra entrega.
    if(!candidates.length&&baixa){
      candidates=valid.filter(p=>(p._speed===null||p._speed<=2.2)&&Math.abs(p._date-baixa)<=45*60*1000)
    }
    if(candidates.length){
      let best=candidates[0];
      for(const p of candidates){
        const timeMin=baixa?Math.abs(p._date-baixa)/60000:0;
        const distancePenalty=nearCep.length?p._distanceKm*1000:0;
        const score=timeMin*5+distancePenalty;
        const bt=baixa?Math.abs(best._date-baixa)/60000:0;
        const bs=bt*5+(nearCep.length?best._distanceKm*1000:0);
        if(score<bs)best=p
      }
      const idx=valid.indexOf(best);
      let a=idx,b=idx;
      // Agrupa a parada real pelo deslocamento entre pontos, não pelo centro do CEP.
      const clusterDistance=(p,q)=>trackingHaversineKm({latitude:p._lat,longitude:p._lon},{lat:q._lat,lon:q._lon});
      while(a>0&&(valid[a]._date-valid[a-1]._date)<=7*60*1000&&clusterDistance(valid[a-1],best)<=0.18)a--;
      while(b+1<valid.length&&(valid[b+1]._date-valid[b]._date)<=7*60*1000&&clusterDistance(valid[b+1],best)<=0.18)b++;
      const duration=valid[b]._date-valid[a]._date;
      if(duration>=30000||best._speed===null||best._speed<=1.5){
        const dep=(b+1<valid.length&&valid[b+1]._date-valid[b]._date<=7*60*1000)?valid[b+1]:valid[b];
        return{
          arrival:{date:valid[a]._date,raw:valid[a].captured_at,distanceKm:best._distanceKm,accuracyM:valid[a]._acc},
          departure:dep?{date:dep._date,raw:dep.captured_at,distanceKm:dep._distanceKm,accuracyM:dep._acc}:null,
          approx:true,approxDistanceKm:best._distanceKm,approxByTime:!nearCep.length
        }
      }
    }
  }
  return{arrival:null,departure:null,approx:false}
}
function xTime(v){const t=v?.getTime?.();return Number.isFinite(t)?t:Number.MAX_SAFE_INTEGER}
function trackingAnalyzePlan(row,plan,history){
  const preparedHistory=trackingPrepareHistory(history);
  const order=(plan.optimizedOrder&&plan.optimizedOrder.length)?plan.optimizedOrder:Array.from({length:(plan.stops||[]).length},(_,i)=>i+1);
  const points=plan.points||[{label:'Base'},...(plan.stops||[])],out=[];
  order.forEach((pointIndex,pos)=>{
    const s=points[pointIndex]||plan.stops?.[pointIndex-1];if(!s)return;
    const baixa=trackingParseDateTime(s.baixaAt);
    const sswDelivered=s.baixaConfirmed===true||(s.baixaConfirmed===undefined&&!!s.entregue&&!!baixa);
    const visit=trackingVisitWindow(s,preparedHistory,sswDelivered,baixa),arrival=visit.arrival,departure=visit.departure;
    const visited=!!(arrival||sswDelivered);
    let diffMin=null;if(arrival?.date&&baixa)diffMin=Math.round((baixa-arrival.date)/60000);
    let statusKey='warn',statusLabel='Pendente';
    if(arrival&&baixa){
      if(diffMin<-5){statusKey='bad';statusLabel='Baixa antes da chegada GPS'}
      else{statusKey='ok';statusLabel=diffMin>=0?'Baixa '+diffMin+' min após chegada':'Baixa quase simultânea'}
    }else if(arrival&&!sswDelivered){statusKey='warn';statusLabel='Visita GPS • aguardando baixa'}
    else if(!arrival&&sswDelivered){statusKey='ok';statusLabel='Visita confirmada pela baixa SSW'}
    const coordSource=String(s.coordinateSource||'').trim()||(String(s.precision||'').toLowerCase()==='cep'?'CEP':(String(s.precision||'').toLowerCase()==='cidade'?'Cidade aproximada':'Endereço'));
    out.push({
      driver:row.driver_name||'',plate:row.vehicle_plate||'',romaneios:plan.romaneios||[plan.romaneio].filter(Boolean),
      plannedPos:pos+1,pointIndex,ctrc:s.ctrc||'',nf:s.nf||'',client:s.destinatario||s.label||('Entrega '+(pos+1)),
      city:s.cidade||'',lat:Number(s.lat),lon:Number(s.lon),coordinateSource:coordSource,
      arrivalAt:arrival?.date||null,departureAt:departure?.date||null,arrivalDistanceKm:arrival?.distanceKm??null,
      baixaAt:baixa,baixaRaw:s.baixaAt||'',visited,
      visitSource:visited?(visit.approx?(visit.approxByTime?'GPS aproximado pelo horário da baixa SSW':'GPS aproximado por CEP + baixa SSW'):(arrival&&sswDelivered?'GPS + baixa SSW':(arrival?'GPS':'Baixa SSW'))):'',
      gpsApprox:!!visit.approx,gpsApproxDistanceKm:visit.approxDistanceKm??null,
      delivered:sswDelivered,diffMin,statusKey,statusLabel,sequenceKey:'warn',sequenceLabel:visited?'Visitado':'Ainda não visitado'
    })
  });
  const visited=out.filter(x=>x.visited).sort((a,b)=>{
    const ta=xTime(a.arrivalAt||a.baixaAt),tb=xTime(b.arrivalAt||b.baixaAt);
    return ta-tb||a.plannedPos-b.plannedPos
  });
  visited.forEach((x,i)=>{
    x.actualPos=i+1;
    if(x.plannedPos===i+1){x.sequenceKey='ok';x.sequenceLabel='Na ordem prevista'}
    else{x.sequenceKey='bad';x.sequenceLabel='Entrega realizada como '+(i+1)+'ª • prevista '+x.plannedPos+'ª'}
  });
  return out
}
function trackingRenderVisitedReport(){
  const table=$('#trackingVisitedTable'),summary=$('#trackingVisitedSummary');
  if(!table)return;
  const visited=(TRACKING_ANALYSIS_ROWS||[]).filter(x=>x.visited)
    .slice().sort((a,b)=>(a.actualPos||9999)-(b.actualPos||9999)||a.plannedPos-b.plannedPos);
  if(summary){
    const drivers=new Set(visited.map(x=>trackingNorm(x.driver)).filter(Boolean));
    summary.textContent=visited.length
      ?nf(visited.length)+' cliente(s) visitado(s) • '+nf(drivers.size)+' motorista(s)'
      :'Nenhum cliente visitado identificado ainda.'
  }
  if(!visited.length){
    table.innerHTML='<tbody><tr><td class="muted">Nenhuma entrega identificada como visitada ainda.</td></tr></tbody>';
    return
  }
  const body=visited.map(x=>'<tr>'+
      '<td><b>'+(x.actualPos||'—')+'ª</b></td>'+
      '<td><b>'+safe(trackingFirstName(x.driver))+'</b><div class="muted">'+safe(x.plate||'')+'</div></td>'+
      '<td><b>'+safe(x.client||'Cliente')+'</b><div class="muted">'+safe(x.ctrc||('NF '+(x.nf||'')))+'</div></td>'+
      '<td>'+safe(x.city||'—')+'</td>'+
      '<td>'+safe(trackingTimeLabel(x.arrivalAt))+(x.gpsApprox?' <span class="muted">(aprox.)</span>':'')+'</td>'+
      '<td>'+safe(trackingTimeLabel(x.departureAt))+(x.gpsApprox?' <span class="muted">(aprox.)</span>':'')+'</td>'+
      '<td>'+safe(trackingTimeLabel(x.baixaAt))+'</td>'+
      '<td>'+safe(x.visitSource||'—')+'</td>'+
      '<td>'+safe(x.plannedPos+'ª')+'</td>'+
      '</tr>').join('');
  table.innerHTML='<thead><tr><th>Entrega realizada</th><th>Motorista</th><th>Cliente</th><th>Cidade</th><th>Chegada</th><th>Saída</th><th>Baixa SSW</th><th>Confirmação</th><th>Ordem programada</th></tr></thead><tbody>'+body+'</tbody>'
}
function trackingRenderAnalysis(){
  const table=$('#trackingRouteCompareTable'),info=$('#trackingRouteCompareInfo'),summary=$('#trackingRouteCompareSummary'),filter=$('#trackingRouteCompareDriver');
  if(!table)return;
  const allRows=TRACKING_ANALYSIS_ROWS||[];
  if(filter){
    const previous=filter.value;
    const drivers=new Map();
    allRows.forEach(x=>{
      const key=trackingDriverKey(x.driver,x.plate);
      if(key&&!drivers.has(key))drivers.set(key,{driver:x.driver,plate:x.plate})
    });
    filter.innerHTML='<option value="">Todos os motoristas</option>'+
      [...drivers.entries()].map(([key,x])=>'<option value="'+safe(key)+'">'+safe(x.driver||'Motorista')+(x.plate?' • '+safe(x.plate):'')+'</option>').join('');
    if(previous&&drivers.has(previous))filter.value=previous;
  }
  const selected=filter?.value||'';
  const rows=selected?allRows.filter(x=>trackingDriverKey(x.driver,x.plate)===selected):allRows;
  if(!rows.length){
    table.innerHTML='<tbody><tr><td class="muted">Aguardando motorista ativo e rota do romaneio para iniciar a comparação.</td></tr></tbody>';
    if(info)info.textContent='O sistema cruza percurso lógico, passagem GPS pelo cliente e horário da baixa no SSW.';
    if(summary)summary.textContent='—';
    trackingRenderVisitedReport();
    return
  }
  const visited=rows.filter(x=>x.visited).length,
    withGps=rows.filter(x=>x.arrivalAt).length,withBaixa=rows.filter(x=>x.baixaAt).length,
    outSeq=rows.filter(x=>x.visited&&x.sequenceKey==='bad').length;
  if(summary)summary.textContent=visited+' visitada(s) • '+withGps+' por GPS • '+withBaixa+' com baixa SSW • '+outSeq+' fora da sequência';
  if(info)info.textContent='Chegada/saída exatas usam endereço/coordenada do SSW e GPS com precisão de até 80 m. Quando existe apenas CEP, a baixa SSW é usada como âncora para localizar a parada GPS mais provável do motorista e o horário é marcado como aproximado.';
  const body=rows.map(x=>{
    const diff=x.diffMin===null?'—':(x.diffMin>=0?'+':'')+x.diffMin+' min';
    return '<tr>'+
      '<td><b>'+safe(trackingFirstName(x.driver))+'</b><div class="muted">'+safe(x.plate||'')+'</div></td>'+
      '<td><b>'+x.plannedPos+'º</b></td>'+
      '<td><b>'+safe(x.client)+'</b><div class="muted">'+safe(x.ctrc||('NF '+x.nf))+'</div></td>'+
      '<td>'+safe(x.city||'—')+'</td>'+
      '<td>'+safe(x.coordinateSource)+'</td>'+
      '<td>'+safe(trackingTimeLabel(x.arrivalAt))+'</td>'+
      '<td>'+safe(trackingTimeLabel(x.departureAt))+'</td>'+
      '<td>'+safe(trackingTimeLabel(x.baixaAt))+'</td>'+
      '<td>'+safe(x.visitSource||'—')+'</td>'+
      '<td>'+safe(diff)+'</td>'+
      '<td><span class="tracking-status '+safe(x.sequenceKey)+'">'+safe(x.sequenceLabel)+'</span><br><span class="tracking-status '+safe(x.statusKey)+'" style="margin-top:4px">'+safe(x.statusLabel)+'</span></td>'+
      '</tr>'
  }).join('');
  table.innerHTML='<thead><tr><th>Motorista</th><th>Ordem</th><th>Cliente</th><th>Cidade</th><th>Localização</th><th>Chegada</th><th>Saída</th><th>Baixa SSW</th><th>Confirmação</th><th>Diferença</th><th>Comparação</th></tr></thead><tbody>'+body+'</tbody>';
  trackingRenderVisitedReport()
}
async function trackingRefreshLogicalAnalysis(liveRows,date,force=false){
  if(window.__trackingAnalysisBusy)return;
  const active=(liveRows||[]).filter(r=>r&&(r.operation_active||r.session_id||r.map_active||trackingHasPosition(r)));
  if(!active.length){TRACKING_ANALYSIS_ROWS=[];trackingRenderAnalysis();return}
  if(!force&&TRACKING_ANALYSIS_ROWS.length&&Date.now()-TRACKING_ANALYSIS_AT<90000)return;
  window.__trackingAnalysisBusy=true;
  try{
    // Histórico completo roda em segundo plano e fica reaproveitado por 2 minutos.
    await Promise.all(active.map(async row=>{
      try{await trackingDayHistory(date,row.driver_name,row.vehicle_plate)}
      catch(e){
        console.warn('Histórico GPS do dia',row.driver_name,e);
        try{await trackingHistory(row.session_id)}catch{}
      }
    }));

    const pieces=await Promise.all(active.map(async row=>{
      try{
        const baseRow=row?.test_only?{...row,driver_name:row.original_driver_name||String(row.driver_name||'').replace(/^TESTE\s*-\s*/i,''),vehicle_plate:row.original_vehicle_plate||String(row.vehicle_plate||'').replace(/\s+T$/i,'')}:row;
        const plan=await trackingBuildLogicalPlan(baseRow,date);
        if(!plan)return[];
        TRACKING_LOGICAL_ROUTES.set(trackingDriverKey(row.driver_name,row.vehicle_plate),plan);
        const dayKey=trackingDayHistoryKey(date,row.driver_name,row.vehicle_plate);
        const dayRows=TRACKING_HISTORY_CACHE.get(dayKey)?.rows||[];
        const sessionRows=TRACKING_HISTORY_CACHE.get(String(row.session_id||''))?.rows||[];
        const history=trackingMergeGpsRows(dayRows,sessionRows);
        const rows=trackingAnalyzePlan(row,plan,history);
        plan.analysisRows=rows;
        return rows
      }catch(e){
        console.warn('Rota planejada',row.driver_name,e);
        return[]
      }
    }));
    TRACKING_ANALYSIS_ROWS=pieces.flat();
    TRACKING_ANALYSIS_AT=Date.now();
    trackingRenderAnalysis();

    // O relatório de paradas usa o mesmo dia do percurso lógico e se atualiza
    // automaticamente. Evita mostrar "Nenhum histórico consultado" enquanto
    // o sistema já possui pontos GPS e visitas processadas.
    const histDate=$('#trackingHistoryDate');
    if(histDate&&histDate.value!==date)histDate.value=date;
    const histDriver=$('#trackingHistoryDriver');
    if(histDriver&&histDriver.value)histDriver.value='';
    const historyStale=!TRACKING_HISTORY_RESULT||TRACKING_HISTORY_RESULT.date!==date||Date.now()-TRACKING_HISTORY_AT>120000;
    if(historyStale)refreshTrackingHistory().catch(e=>console.warn('Relatório automático de paradas',e));

    if(TRACKING_DATA)renderTrackingMap(TRACKING_DATA)
  }finally{
    window.__trackingAnalysisBusy=false
  }
}
function renderTrackingMap(rows){
  const box=$('#trackingMap');if(!box)return;
  if(typeof L==='undefined'){box.innerHTML='<div class="muted" style="padding:22px">Mapa indisponível.</div>';return}
  if(!TRACKING_MAP){
    TRACKING_MAP=L.map(box,{zoomControl:true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(TRACKING_MAP);
    const savedView=trackingLoadMapView();
    if(savedView){
      TRACKING_MAP.setView([savedView.lat,savedView.lng],savedView.zoom);
      TRACKING_MAP_VIEW_READY=true
    }else{
      TRACKING_MAP.setView([-22.739,-47.331],9)
    }
    TRACKING_MAP.on('moveend zoomend',trackingSaveMapView)
    if(!TRACKING_MAP.getPane('tracking-planned')){
      const p=TRACKING_MAP.createPane('tracking-planned');p.style.zIndex='445';p.style.pointerEvents='none'
    }
    if(!TRACKING_MAP.getPane('tracking-actual')){
      const p=TRACKING_MAP.createPane('tracking-actual');p.style.zIndex='420';p.style.pointerEvents='none'
    }
  }
  const plannedPane=TRACKING_MAP.getPane('tracking-planned'),actualPane=TRACKING_MAP.getPane('tracking-actual');
  if(plannedPane)plannedPane.style.zIndex='445';
  if(actualPane)actualPane.style.zIndex='420';
  if(TRACKING_LAYER)TRACKING_LAYER.remove();
  TRACKING_LAYER=L.layerGroup().addTo(TRACKING_MAP);
  TRACKING_MARKERS.clear();
  const bounds=[];
  const activeRows=(rows||[]).filter(row=>row&&(row.operation_active||row.session_id||row.map_active||Number.isFinite(Number(row.latitude))&&Number.isFinite(Number(row.longitude)))).filter(row=>{
    if(!TRACKING_MAP_DRIVER_FILTER)return true;
    return trackingDriverKey(row.driver_name,row.vehicle_plate)===TRACKING_MAP_DRIVER_FILTER
  });
  const legend=$('#trackingLiveLegend');
  if(legend){
    const actualLegend=activeRows.map(row=>{
      const actual=trackingActualColor(row);
      return '<span><i class="tracking-history-dot" style="background:'+actual+'"></i>'+safe(trackingFirstName(row.driver_name))+(TRACKING_MAP_ONLY_DRIVERS?' • motorista':' • percurso real')+'</span>'
    }).join('<span class="dotSep">•</span>');
    legend.innerHTML=(TRACKING_MAP_ONLY_DRIVERS?'':('<span><b>Rota planejada</b> • tracejada na cor de cada motorista</span>'))+
      ((!TRACKING_MAP_ONLY_DRIVERS&&actualLegend)?'<span class="dotSep">•</span>':'')+
      actualLegend
  }
  let baseMarked=false;
  const markerCoordUse=new Map(),visitedRendered=new Set();
  const baseLat=Number(TRACKING_BASE_POSITION?.lat),baseLon=Number(TRACKING_BASE_POSITION?.lon);
  if(!TRACKING_MAP_ONLY_DRIVERS&&Number.isFinite(baseLat)&&Number.isFinite(baseLon)){
    const baseIcon=L.divIcon({className:'',html:'<div style="min-width:48px;height:32px;padding:0 8px;border-radius:8px;background:#0f172a;color:#fff;border:3px solid #fff;box-shadow:0 2px 8px #0006;display:grid;place-items:center;font-size:10px;font-weight:900">BASE</div>',iconSize:[52,36],iconAnchor:[26,18]});
    L.marker([baseLat,baseLon],{icon:baseIcon}).addTo(TRACKING_LAYER)
      .bindPopup('<b>Base CONSTRULOG</b><br>'+safe(TRACKING_BASE_POSITION.address||'Av. do Algodão, 316 • Americana/SP'))
      .bindTooltip('BASE • Av. do Algodão, 316',{permanent:false});
    bounds.push([baseLat,baseLon]);baseMarked=true
  }
  activeRows.forEach((row,i)=>{
    const actualColor=trackingActualColor(row),plannedColor=actualColor;
    const route=trackingFindRoute(row.driver_name,row.vehicle_plate),status=trackingStatus(row);
    const coords=trackingPlannedCoords(route);
    if(!TRACKING_MAP_ONLY_DRIVERS&&coords.length>1){
      L.polyline(coords,{pane:'tracking-planned',color:'#ffffff',weight:8,opacity:.88,dashArray:'14 7'}).addTo(TRACKING_LAYER);
      L.polyline(coords,{pane:'tracking-planned',color:plannedColor,weight:5,opacity:1,dashArray:'14 7'})
        .addTo(TRACKING_LAYER)
        .bindTooltip('Rota programada • '+safe(trackingDisplayName(row.driver_name))+' • '+nf(route?.stops?.length||0)+' no mapa de '+nf(route?.expectedDeliveries||route?.stops?.length||0)+' entrega(s)');
      coords.forEach(x=>bounds.push(x));
      const base=route?.points?.[0];
      if(!baseMarked&&Number.isFinite(Number(base?.lat))&&Number.isFinite(Number(base?.lon))){
        const baseIcon=L.divIcon({className:'',html:'<div style="min-width:34px;height:30px;padding:0 7px;border-radius:7px;background:#0f172a;color:#fff;border:2px solid #fff;box-shadow:0 2px 7px #0005;display:grid;place-items:center;font-size:10px;font-weight:900">BASE</div>',iconSize:[38,34],iconAnchor:[19,17]});
        L.marker([Number(base.lat),Number(base.lon)],{icon:baseIcon}).addTo(TRACKING_LAYER).bindPopup('<b>Base CONSTRULOG</b><br>Americana/SP');
        bounds.push([Number(base.lat),Number(base.lon)]);baseMarked=true
      }
      if(route&&Array.isArray(route.points)&&route.points.length>1){
        const points=route.points||[];
        const stopOrder=(Array.isArray(route.optimizedOrder)&&route.optimizedOrder.length)
          ?route.optimizedOrder
          :Array.from({length:points.length-1},(_,i)=>i+1);
        stopOrder.forEach((pointIndex,pos)=>{
          const s=points[pointIndex];if(!s)return;
          const lat=Number(s.lat),lon=Number(s.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
          const analysis=(route.analysisRows||[]).find(x=>x.pointIndex===pointIndex);
          const done=!!analysis?.visited;
          const displayNo=done?(analysis?.actualPos||pos+1):(pos+1);
          const bg=done?'#16a34a':actualColor,fg='#fff',border=done?'#15803d':actualColor;
          const markerHtml='<div style="min-width:28px;height:28px;padding:0 5px;border-radius:14px;background:'+bg+';border:3px solid '+border+';box-shadow:0 1px 5px #0004;display:grid;place-items:center;font-size:11px;font-weight:900;color:'+fg+'">'+displayNo+(done?'✓':'')+'</div>';
          const stopIcon=L.divIcon({className:'',html:markerHtml,iconSize:[32,32],iconAnchor:[16,16]});
          const popup='<b>'+(done?'Cliente visitado nº '+displayNo:'Programada nº '+(pos+1))+' • '+safe(s.destinatario||s.label||'Cliente')+'</b><br>'+
            safe(s.cidade||'')+
            '<br>Localização: '+safe(s.coordinateSource||s.precision||'Endereço/geocodificação')+
            '<br>Confirmação: '+safe(analysis?.visitSource||'—')+
            '<br>Chegada GPS: '+safe(trackingTimeLabel(analysis?.arrivalAt))+(analysis?.gpsApprox?' (aprox. por CEP)':'')+
            '<br>Saída GPS: '+safe(trackingTimeLabel(analysis?.departureAt))+(analysis?.gpsApprox?' (aprox. por CEP)':'')+
            '<br>Baixa SSW: '+safe(trackingTimeLabel(analysis?.baixaAt))+
            (analysis?.diffMin!==null&&analysis?.diffMin!==undefined?'<br>Diferença: '+safe((analysis.diffMin>=0?'+':'')+analysis.diffMin+' min'):'');
          // Se dois ou mais clientes tiverem a mesma coordenada (ex.: mesmo CEP),
          // desloca apenas o marcador visualmente para todos ficarem clicáveis.
          const ck=lat.toFixed(5)+'|'+lon.toFixed(5),dup=markerCoordUse.get(ck)||0;
          markerCoordUse.set(ck,dup+1);
          let ml=lat,mn=lon;
          if(dup>0){
            const ring=1+Math.floor((dup-1)/8),slot=(dup-1)%8,ang=slot*Math.PI/4;
            const meters=18*ring;
            ml=lat+(meters*Math.sin(ang))/111320;
            mn=lon+(meters*Math.cos(ang))/(111320*Math.max(.2,Math.cos(lat*Math.PI/180)))
          }
          L.marker([ml,mn],{icon:stopIcon}).addTo(TRACKING_LAYER).bindPopup(popup).bindTooltip((pos+1)+'º '+safe(s.destinatario||s.label||'Cliente'));
          if(done)visitedRendered.add(trackingDriverKey(row.driver_name,row.vehicle_plate)+'|'+pointIndex);
          bounds.push([lat,lon])
        })
      }
    }

    let liveTrail=row.trail;
    if(typeof liveTrail==='string'){try{liveTrail=JSON.parse(liveTrail)}catch{liveTrail=[]}}
    liveTrail=Array.isArray(liveTrail)?liveTrail:[];
    const cachedHistory=TRACKING_HISTORY_CACHE.get(String(row.session_id||''))?.rows||[];
    const dayHistory=TRACKING_HISTORY_CACHE.get(trackingDayHistoryKey(TRACKING_CURRENT_DATE,row.driver_name,row.vehicle_plate))?.rows||[];
    const history=trackingMergeGpsRows(dayHistory,cachedHistory,liveTrail);
    if(liveTrail.length)TRACKING_HISTORY_CACHE.set(String(row.session_id||''),{at:Date.now(),rows:trackingMergeGpsRows(cachedHistory,liveTrail)});
    const realCoords=history.map(p=>[Number(p.latitude),Number(p.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if(!TRACKING_MAP_ONLY_DRIVERS&&realCoords.length>1){
      L.polyline(realCoords,{pane:'tracking-actual',color:'#ffffff',weight:9,opacity:.94}).addTo(TRACKING_LAYER);
      L.polyline(realCoords,{pane:'tracking-actual',color:actualColor,weight:5,opacity:.98})
        .addTo(TRACKING_LAYER)
        .bindTooltip('Percurso executado • '+safe(trackingDisplayName(row.driver_name))+' • '+nf(realCoords.length)+' ponto(s) GPS');
      realCoords.forEach(x=>bounds.push(x))
    }

    const lat=Number(row.latitude),lon=Number(row.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lon)){
      const firstName=(row.test_only?'TESTE • ':'')+trackingFirstName(row.driver_name);
      const iconHtml='<div style="width:100px;height:54px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;pointer-events:none">'+
        '<div style="max-width:96px;padding:2px 6px;margin-bottom:2px;border-radius:7px;background:rgba(255,255,255,.96);border:1px solid #cbd5e1;box-shadow:0 1px 4px #0003;color:#0f172a;font-size:11px;font-weight:800;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+safe(firstName)+'</div>'+
        '<div style="width:30px;height:30px;border-radius:50%;background:'+actualColor+';border:3px solid #fff;box-shadow:0 2px 7px #0006;display:grid;place-items:center;color:#fff;font-size:15px">🚚</div>'+
        '</div>';
      const icon=L.divIcon({className:'',html:iconHtml,iconSize:[100,54],iconAnchor:[50,49]});
      const nearest=trackingNearestClient(row,route);
      const clientLine=nearest
        ?'<br><b>Cliente atual/mais próximo:</b> '+safe(nearest.client)+(nearest.city?' • '+safe(nearest.city):'')+
          '<br>Distância do cliente: '+safe(nearest.distanceKm<1?Math.round(nearest.distanceKm*1000)+' m':nearest.distanceKm.toFixed(1).replace('.',',')+' km')
        :'<br><b>Cliente:</b> aguardando rota planejada';
      const marker=L.marker([lat,lon],{icon}).addTo(TRACKING_LAYER).bindPopup(
        '<b>'+safe(trackingDisplayName(row.driver_name))+'</b><br>'+safe(row.vehicle_plate||'')+
        '<br>'+safe(status.label)+clientLine+
        '<br>Última posição: '+safe(trackingAgeLabel(row.age_seconds))+
        '<br>Pontos do percurso: '+nf(realCoords.length)
      );
      TRACKING_MARKERS.set(trackingDriverKey(row.driver_name,row.vehicle_plate),marker);
      bounds.push([lat,lon])
    }
  });

  // Visitas confirmadas por GPS continuam visíveis mesmo se a rota planejada
  // de um motorista ainda estiver sendo calculada ou não tiver desenhado o marcador.
  for(const x of (TRACKING_MAP_ONLY_DRIVERS?[]:(TRACKING_ANALYSIS_ROWS||[]))){
    if(!x?.visited||!Number.isFinite(Number(x.lat))||!Number.isFinite(Number(x.lon)))continue;
    if(TRACKING_MAP_DRIVER_FILTER&&trackingDriverKey(x.driver,x.plate)!==TRACKING_MAP_DRIVER_FILTER)continue;
    const key=trackingDriverKey(x.driver,x.plate)+'|'+x.pointIndex;
    if(visitedRendered.has(key))continue;
    const no=x.actualPos||x.plannedPos||'✓';
    const html='<div style="min-width:30px;height:30px;padding:0 5px;border-radius:15px;background:#16a34a;border:3px solid #15803d;box-shadow:0 1px 6px #0005;display:grid;place-items:center;font-size:11px;font-weight:900;color:#fff">'+no+'✓</div>';
    const icon=L.divIcon({className:'',html,iconSize:[34,34],iconAnchor:[17,17]});
    L.marker([Number(x.lat),Number(x.lon)],{icon}).addTo(TRACKING_LAYER)
      .bindPopup('<b>Cliente visitado nº '+safe(no)+'</b><br>'+safe(x.client||'Cliente')+'<br>'+safe(x.city||'')+'<br>Confirmação: '+safe(x.visitSource||'—')+'<br>Chegada: '+safe(trackingTimeLabel(x.arrivalAt))+'<br>Saída: '+safe(trackingTimeLabel(x.departureAt))+'<br>Baixa SSW: '+safe(trackingTimeLabel(x.baixaAt)));
    bounds.push([Number(x.lat),Number(x.lon)])
  }

  if(!TRACKING_MAP_VIEW_READY&&bounds.length){
    const bb=L.latLngBounds(bounds);
    if(bb.isValid()){
      TRACKING_MAP.fitBounds(bb.pad(.12));
      TRACKING_MAP_VIEW_READY=true
    }
  }
  setTimeout(()=>TRACKING_MAP.invalidateSize(),100)
}
// ===== Quadro "Motoristas de hoje": situação em linguagem simples + uma ação por linha =====
let TRACKING_CONTACTS=new Map(),TRACKING_CONTACTS_AT=0,TRACKING_REQUEST_ROWS=[],TRACKING_CONTACT_EDIT=null,TRACKING_BOARD_ITEMS=[],TRACKING_BOARD_NOTE='';
// Pedidos de aparelho: motorista do dia escolhido pela central para cada pedido (id do pedido -> chave).
const TRACKING_REQUEST_CHOICE=new Map();
function trackingPhoneLabel(d){
  const m=String(d||'').match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m?'('+m[1]+') '+m[2]+'-'+m[3]:String(d||'')
}
async function trackingLoadContacts(force=false){
  if(!force&&TRACKING_CONTACTS_AT&&Date.now()-TRACKING_CONTACTS_AT<120000)return;
  try{
    const r=await fetch('/api/tracking/contacts?t='+Date.now(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(r.ok&&j.ok&&Array.isArray(j.rows)){
      TRACKING_CONTACTS=new Map(j.rows.map(x=>[String(x.driver_key||''),String(x.phone||'')]));
      TRACKING_CONTACTS_AT=Date.now()
    }
  }catch(e){}
}
let TRACKING_APP_VERSIONS={normal:null,teste:null,at:0};
async function trackingLoadAppVersions(){
  if(TRACKING_APP_VERSIONS.at&&Date.now()-TRACKING_APP_VERSIONS.at<300000)return;
  try{
    const get=async canal=>{
      const r=await fetch('/api/tracking/app-update?channel='+canal+'&version_code=0&t='+Date.now(),{cache:'no-store'});
      const j=await r.json().catch(()=>({}));
      return r.ok&&j.ok&&Number(j.latestVersionCode)>0?{code:Number(j.latestVersionCode),name:String(j.latestVersionName||'').replace(/-teste$/,'')}:null
    };
    const [normal,teste]=await Promise.all([get('normal'),get('teste')]);
    TRACKING_APP_VERSIONS={normal,teste,at:Date.now()}
  }catch(e){}
}
// Há uma versão mais nova publicada só para teste?
function trackingTestVersion(){
  const v=TRACKING_APP_VERSIONS;
  return v.teste&&(!v.normal||v.teste.code>v.normal.code)?v.teste:null
}
function trackingInstallMessage(item,canal){
  const name=trackingFirstName(item.r.driver_name),base=location.origin+'/motorista-instalar';
  if(canal==='teste'){
    const v=trackingTestVersion();
    return 'Olá, '+name+'! Aqui é da CONSTRULOG.\n\nSaiu uma versão nova do aplicativo *CONSTRULOG Motorista*'+(v?' ('+v.name+')':'')+'.\n\n1. Desinstale o aplicativo CONSTRULOG Motorista que está no celular.\n2. Abra este link, baixe e instale:\n'+base+'?canal=teste\n3. Abra o aplicativo, informe seu nome e a placa e toque em *Permitir* nas perguntas. Na de localização, escolha *Permitir o tempo todo*.\n\nDepois disso não precisa mais abrir o aplicativo. Obrigado!'
  }
  return 'Olá, '+name+'! Aqui é da CONSTRULOG.\n\nInstale o aplicativo *CONSTRULOG Motorista* por este link:\n'+base+'\n\nDepois de instalar, abra o aplicativo e informe seu nome e a placa do veículo. É só na primeira vez. Se o aplicativo já estiver instalado, basta abri-lo.\n\nObrigado!'
}
function trackingWhen(v){
  const d=new Date(v);if(!v||!Number.isFinite(d.getTime()))return'';
  const day=x=>x.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const hm=d.toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
  if(day(d)===day(new Date()))return'hoje às '+hm;
  if(day(d)===day(new Date(Date.now()-86400000)))return'ontem às '+hm;
  return'em '+d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit'})+' às '+hm
}
function trackingNotifiedStore(){
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  try{
    const x=JSON.parse(localStorage.getItem('construlog_tracking_notified')||'null');
    if(x&&x.date===today&&x.items&&typeof x.items==='object')return x
  }catch(e){}
  return{date:today,items:{}}
}
function trackingMarkNotified(key){
  const x=trackingNotifiedStore();
  x.items[key]=new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
  try{localStorage.setItem('construlog_tracking_notified',JSON.stringify(x))}catch(e){}
}
function trackingDiagnose(row){
  const st=trackingStatus(row);
  const h=(row.health&&typeof row.health==='object')?row.health:null;
  const devAge=Number(row.device_age_seconds),age=Number(row.age_seconds);
  const inOp=row.operation_active!==false||!!row.test_only;
  const bat=h&&h.battery_pct!==null&&h.battery_pct!==undefined&&Number.isFinite(Number(h.battery_pct))?Math.round(Number(h.battery_pct)):null;
  const hasPos=trackingHasPosition(row);
  if(row.test_only)return{level:hasPos?'ok':'warn',group:hasPos?'ok':'warn',title:st.label,detail:'Celular de teste (não é um motorista da operação).',action:hasPos?'map':''};
  if(!row.device_id)return{level:'bad',group:'noapp',title:'Sem aplicativo',detail:'Nenhum celular cadastrado para este motorista/placa. Envie o link: ele instala, informa nome e placa uma única vez e o pedido aparece aqui para você aprovar.',action:'invite'};
  if(row.never_connected)return{level:'bad',group:'stopped',title:'Aprovado, mas o celular ainda não conectou',detail:'O aparelho'+(row.device_name?' ('+row.device_name+')':'')+' foi liberado '+(trackingWhen(row.enrolled_at)||'')+' e não enviou nenhum sinal. O motorista só precisa abrir o aplicativo uma vez.',action:'notify',kind:'abrir'};
  if(String(row.session_status||'').toLowerCase()==='ended')return{level:'off',group:'off',title:'Rota finalizada',detail:'Entregas do romaneio concluídas'+(row.ended_at?' '+trackingWhen(row.ended_at):'')+'. O rastreio volta sozinho quando sair um novo romaneio.',action:hasPos?'map':''};
  const newApp=!!(h&&row.app_version);
  // Aplicativo novo, em repouso (sem romaneio na última checagem): com a tela apagada ele só
  // confere a cada 5 a 10 minutos, então 15 minutos sem sinal ainda não é "parado".
  if(newApp&&h.tracking===false&&Number.isFinite(devAge)&&devAge>300&&devAge<=900&&inOp)
    return{level:'warn',group:'warn',title:'Celular em repouso • o rastreio começa em instantes',detail:'O aplicativo está instalado e respondeu há '+trackingAgeLabel(devAge)+'. Com a tela apagada ele confere novos romaneios a cada 5 a 10 minutos.',action:''};
  if(!Number.isFinite(devAge)||devAge>300){
    let cause='Aplicativo fechado, celular desligado ou sem internet.';
    if(bat!==null&&bat<=5&&h.charging!==true)cause='A bateria estava em '+bat+'% no último sinal: o celular provavelmente desligou.';
    else if(h&&h.battery_unrestricted===false)cause='A economia de bateria do celular não está liberada para o aplicativo, então o Android o fecha com a tela apagada.';
    const base={title:'Aplicativo parado'+(Number.isFinite(devAge)?' há '+trackingAgeLabel(devAge):''),detail:(row.last_seen_at?'Último sinal '+trackingWhen(row.last_seen_at)+'. ':'')+cause,action:'notify',kind:'abrir'};
    return inOp?{level:'bad',group:'stopped',...base}:{level:'off',group:'off',...base,title:'Sem romaneio hoje • '+base.title.toLowerCase()}
  }
  // Daqui para baixo o aplicativo está vivo (deu sinal nos últimos 5 minutos).
  if(h&&h.perm_location===false)return{level:'warn',group:'warn',title:'Aplicativo ligado, sem permissão de localização',detail:'O motorista precisa permitir a localização para o aplicativo ("Permitir o tempo todo").',action:'notify',kind:'perm'};
  if(h&&h.gps_on===false)return{level:'warn',group:'warn',title:'Aplicativo ligado, GPS do celular desligado',detail:'O celular está conectado, mas com a Localização (GPS) desligada.',action:'notify',kind:'gps'};
  if(h&&h.service_running===false)return{level:'warn',group:'warn',title:'Aplicativo em modo reduzido',detail:'O Android bloqueou o rastreio em segundo plano neste celular'+(h.perm_background===false?' (a localização não está em "Permitir o tempo todo")':'')+'. Basta o motorista abrir o aplicativo uma vez.',action:'notify',kind:h.perm_background===false?'perm':'abrir'};
  const roms=trackingRomaneiosFor(row.driver_name,row.vehicle_plate);
  const hasRom=roms.length||(Array.isArray(row.romaneios)&&row.romaneios.length);
  if(!hasPos||(Number.isFinite(age)&&age>300)){
    if(!hasRom)return{level:'ok',group:'ok',title:'Aplicativo ligado • aguardando romaneio',detail:'Celular conectado. O GPS começa sozinho quando o romaneio do motorista aparecer.',action:''};
    const fresh=!hasPos&&row.started_at&&(Date.now()-new Date(row.started_at).getTime()<4*60000);
    if(fresh)return{level:'warn',group:'warn',title:'Conectado • aguardando a primeira posição',detail:'O aplicativo acabou de conectar. A primeira posição costuma chegar em 1 a 2 minutos.',action:''};
    if(h&&h.perm_background===false)return{level:'warn',group:'warn',title:'Aplicativo ligado, sem posição do GPS',detail:'A localização está permitida só com o aplicativo aberto. Precisa ser "Permitir o tempo todo".',action:'notify',kind:'perm'};
    // O aplicativo antigo só envia posição quando o caminhão anda: parado numa entrega, a última
    // posição fica velha sem que haja problema. Só o aplicativo novo envia mesmo parado.
    if(hasPos&&!newApp){
      const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
      if(row.captured_at&&new Date(row.captured_at).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})===today)
        return{level:'ok',group:'ok',title:'Rastreando • parado no mesmo lugar há '+trackingAgeLabel(age),detail:'Aplicativo ligado (sinal há '+trackingAgeLabel(devAge)+'). A versão atual do aplicativo só envia nova posição quando o veículo anda.',action:'map'}
    }
    return{level:'warn',group:'warn',title:'Aplicativo ligado, sem posição do GPS'+(hasPos&&Number.isFinite(age)?' há '+trackingAgeLabel(age):''),detail:'O celular está conectado, mas não envia localização. Quase sempre é o GPS desligado ou a permissão de localização.',action:'notify',kind:'gps'}
  }
  const speed=Number(row.speed_mps),bits=['Posição há '+trackingAgeLabel(age)];
  if(Number.isFinite(speed)&&speed>=0)bits.push(Math.round(speed*3.6)+' km/h');
  if(bat!==null)bits.push('bateria '+bat+'%'+(h.charging===true?' (carregando)':''));
  const alerts=[];
  if(h&&h.perm_background===false)alerts.push('localização só com o app aberto');
  if(h&&h.battery_unrestricted===false)alerts.push('economia de bateria ativa (pode parar com a tela apagada)');
  if(bat!==null&&bat<15&&h.charging!==true)alerts.push('bateria baixa');
  if(row.app_version)bits.push('app '+row.app_version);
  const detail=bits.join(' • ')+(alerts.length?' • Atenção: '+alerts.join('; ')+'.':'');
  if(st.key==='bad'&&st.distance!==null)return{level:'warn',group:'warn',title:'Rastreando • fora da rota ('+st.label.toLowerCase()+')',detail,action:'map'};
  if(Number.isFinite(age)&&age>120)return{level:'warn',group:'warn',title:'Rastreando • GPS atrasado',detail,action:'map'};
  return{level:'ok',group:'ok',title:st.key==='ok'?'Rastreando • na rota':'Rastreando',detail,action:'map'}
}
function trackingNotifyMessage(item){
  const name=trackingFirstName(item.r.driver_name),kind=item.d.kind||'abrir';
  const head='Olá, '+name+'! Aqui é da CONSTRULOG.\n\n';
  if(kind==='gps')return head+'O aplicativo *CONSTRULOG Motorista* está ligado, mas sem localização.\n\nPor favor:\n1. Ligue a *Localização (GPS)* do celular.\n2. Abra o aplicativo CONSTRULOG Motorista.\n\nNão precisa preencher nada. Obrigado!';
  if(kind==='perm')return head+'O aplicativo *CONSTRULOG Motorista* está sem permissão de localização.\n\nPor favor, abra o aplicativo, toque em *ABRIR CONFIGURAÇÕES DO APP* → Permissões → Localização → *Permitir o tempo todo*.\n\nObrigado!';
  const since=item.r.last_seen_at&&!item.r.never_connected?' desde '+trackingWhen(item.r.last_seen_at).replace(/^(hoje|ontem|em) /,m=>m==='em '?'':m):'';
  return head+'O rastreamento do seu celular está parado'+since+'.\n\nPor favor, abra o aplicativo *CONSTRULOG Motorista* e deixe o celular com internet. É só abrir, não precisa preencher nada.\n\nObrigado!'
}
function trackingBoardMsg(text,isErr=false){
  const el=$('#trackingBoardMsg');if(!el)return;
  el.textContent=text;el.classList.toggle('err',!!isErr);el.style.display=text?'block':'none';
  clearTimeout(window.__trackingBoardMsgTimer);
  if(text)window.__trackingBoardMsgTimer=setTimeout(()=>{el.style.display='none'},9000)
}
function trackingBoardRows(){
  return Array.isArray(TRACKING_DATA)?TRACKING_DATA:[]
}
// Motoristas com romaneio hoje, para a central escolher a quem pertence o celular que pediu acesso.
function trackingRequestOptions(){
  const seen=new Set(),out=[];
  for(const x of (Array.isArray(TRACKING_DRIVER_ROWS)?TRACKING_DRIVER_ROWS:[])){
    const name=driverDisplayName(x.motorista||x.driver_name||''),plate=String(x.veiculo||x.vehicle_plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!name||plate.length<7)continue;
    const key=trackingDriverKey(name,plate);if(seen.has(key))continue;seen.add(key);
    out.push({key,name,plate})
  }
  return out.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))
}
// Escolha em vigor para um pedido: a que a central marcou; senão, o motorista do dia que bate
// com o que foi digitado (placa ou nome, sem acento); senão, o que o motorista digitou ('').
function trackingRequestChoice(req,options){
  const id=String(req.id);
  if(TRACKING_REQUEST_CHOICE.has(id)){const k=TRACKING_REQUEST_CHOICE.get(id);if(k===''||options.some(o=>o.key===k))return k}
  const op=trackingMatchOperationRow({driver_name:req.driver_name,vehicle_plate:req.vehicle_plate});
  if(!op)return'';
  const key=trackingDriverKey(driverDisplayName(op.motorista||op.driver_name||''),String(op.veiculo||op.vehicle_plate||'').toUpperCase().replace(/[^A-Z0-9]/g,''));
  return options.some(o=>o.key===key)?key:''
}
function renderTrackingBoard(rows,extraRows){
  const table=$('#trackingBoardTable');if(!table)return;
  // Não redesenha o quadro com a lista de motoristas de um pedido aberta: a escolha se perderia.
  if(document.activeElement?.matches?.('[data-tb-req-choice]')&&table.contains(document.activeElement))return;
  const list=[...(Array.isArray(rows)?rows:[]),...(Array.isArray(extraRows)?extraRows:[])];
  const pending=(TRACKING_REQUEST_ROWS||[]).filter(x=>String(x.status||'')==='pending');
  const order={stopped:0,noapp:1,warn:2,ok:3,off:4};
  const items=list.map(r=>({r,d:trackingDiagnose(r),key:trackingDriverKey(r.driver_name,r.vehicle_plate)}))
    .sort((a,b)=>(order[a.d.group]??9)-(order[b.d.group]??9)||String(a.r.driver_name||'').localeCompare(String(b.r.driver_name||''),'pt-BR'));
  TRACKING_BOARD_ITEMS=items;
  const count=g=>items.filter(x=>x.d.group===g).length;
  const chips=[];
  if(pending.length)chips.push('<span class="tracking-chip new">📲 '+nf(pending.length)+' pedido(s) de acesso</span>');
  chips.push('<span class="tracking-chip ok">🟢 '+nf(count('ok'))+' rastreando</span>');
  if(count('warn'))chips.push('<span class="tracking-chip warn">🟡 '+nf(count('warn'))+' com atenção</span>');
  if(count('stopped'))chips.push('<span class="tracking-chip bad">🔴 '+nf(count('stopped'))+' parado(s)</span>');
  if(count('noapp'))chips.push('<span class="tracking-chip bad">⚪ '+nf(count('noapp'))+' sem aplicativo</span>');
  if(count('off'))chips.push('<span class="tracking-chip">✔ '+nf(count('off'))+' finalizado(s)</span>');
  const chipsEl=$('#trackingBoardChips');if(chipsEl)chipsEl.innerHTML=chips.join('');
  const info=$('#trackingBoardInfo');
  if(info)info.textContent=(TRACKING_BOARD_NOTE?TRACKING_BOARD_NOTE+' ':nf(items.length)+' motorista(s) com romaneio hoje. ')+'Atualizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+' • atualiza sozinho a cada '+TRACKING_AUTO_SECONDS+' s.';
  const notified=trackingNotifiedStore().items;
  const reqOptions=trackingRequestOptions();
  const reqHtml=pending.map(x=>{
    const when=trackingWhen(x.created_at);
    const chosen=trackingRequestChoice(x,reqOptions),pick=reqOptions.find(o=>o.key===chosen);
    const typed=(driverDisplayName(x.driver_name||'')||'Motorista')+' • '+(x.vehicle_plate||'sem placa');
    const differs=pick&&(trackingNorm(pick.name)!==trackingNorm(x.driver_name)||trackingNorm(pick.plate)!==trackingNorm(x.vehicle_plate));
    const choiceHtml=reqOptions.length
      ?'<div class="tb-req-choice"><label>De quem é este celular?<select data-tb-req-choice="'+safe(x.id)+'">'+
        reqOptions.map(o=>'<option value="'+safe(o.key)+'"'+(o.key===chosen?' selected':'')+'>'+safe(o.name+' • '+o.plate)+'</option>').join('')+
        '<option value=""'+(chosen===''?' selected':'')+'>Não está na lista — usar o que ele digitou</option></select></label></div>'
      :'';
    const warn=(x.has_live_device?'<div class="tb-detail"><b>Atenção:</b> este motorista já tem um celular funcionando agora. Aprove só se ele trocou de aparelho.</div>':'')+
      (pick
        ?'<div class="tb-detail">'+(differs?'O motorista digitou diferente do romaneio. O cadastro vai ficar como <b>'+safe(pick.name+' • '+pick.plate)+'</b>.':'Confere com o romaneio de hoje.')+' Depois de aprovado, o celular começa a rastrear sozinho.</div>'
        :'<div class="tb-detail">'+(reqOptions.length?'<b>Não achei este nome nem esta placa nos romaneios de hoje.</b> Escolha o motorista na lista, se ele estiver nela.':'Confira nome e placa.')+' Depois de aprovado, o celular começa a rastrear sozinho.</div>');
    return '<tr class="tb-new"><td><div class="tb-name">'+safe(pick?pick.name:(driverDisplayName(x.driver_name||'')||'Motorista'))+'</div><div class="tb-sub">'+safe(pick?pick.plate:(x.vehicle_plate||'placa não informada'))+' • '+safe(x.device_name||'Android')+'</div>'+
      '<div class="tb-sub">Digitado no celular: '+safe(typed)+'</div></td>'+
      '<td><div class="tb-title new">📲 Novo aparelho pedindo acesso'+(when?' ('+safe(when)+')':'')+'</div>'+choiceHtml+warn+'</td>'+
      '<td><div class="tb-actions"><button type="button" class="tb-btn primary" data-tb-req="'+safe(x.id)+'" data-tb-decide="approve">Aprovar</button><button type="button" class="tb-btn" data-tb-req="'+safe(x.id)+'" data-tb-decide="reject">Recusar</button></div></td></tr>'
  }).join('');
  const rowHtml=items.map((it,i)=>{
    const r=it.r,d=it.d;
    const roms=trackingRomaneiosFor(r.driver_name,r.vehicle_plate);
    const romList=roms.length?roms:(Array.isArray(r.romaneios)?r.romaneios.map(String):[]);
    const op=trackingDriverOperationRow(r.driver_name,r.vehicle_plate);
    const entregas=Number(op?.entregas||op?.total||0);
    const sub=[r.vehicle_plate||'sem placa',romList.length?'Rom. '+romList.join(', '):'',entregas?nf(entregas)+' entrega(s)':''].filter(Boolean).join(' • ');
    const ckey=trackingNorm(r.driver_name),phone=TRACKING_CONTACTS.get(ckey)||'';
    let phoneHtml;
    if(TRACKING_CONTACT_EDIT&&TRACKING_CONTACT_EDIT.key===ckey){
      phoneHtml='<div class="tb-phone-edit"><input type="tel" data-tb-phone-input="'+i+'" placeholder="DDD + número" value="'+safe(TRACKING_CONTACT_EDIT.value||'')+'"><button type="button" class="tb-btn primary" data-tb-act="phone-save" data-tb-i="'+i+'">Salvar</button><button type="button" class="tb-btn" data-tb-act="phone-cancel" data-tb-i="'+i+'">Cancelar</button></div>'
    }else if(r.test_only){
      phoneHtml=''
    }else{
      phoneHtml='<div class="tb-sub">'+(phone?'📱 '+safe(trackingPhoneLabel(phone))+' · ':'')+'<button type="button" class="tb-link" data-tb-act="phone-edit" data-tb-i="'+i+'">'+(phone?'alterar':'＋ informar WhatsApp do motorista')+'</button></div>'
    }
    const actions=[];
    if(d.action==='notify')actions.push('<button type="button" class="tb-btn wa" data-tb-act="notify" data-tb-i="'+i+'">💬 Avisar no WhatsApp</button>');
    if(d.action==='invite')actions.push('<button type="button" class="tb-btn wa" data-tb-act="invite" data-tb-i="'+i+'">💬 Enviar link do aplicativo</button>');
    if(d.action==='map'||(trackingHasPosition(r)&&d.action!=='map'))actions.push('<button type="button" class="tb-btn" data-tb-act="map" data-tb-i="'+i+'">🗺️ Ver no mapa</button>');
    const told=notified[it.key]?'<div class="tb-sub">Avisado às '+safe(notified[it.key])+'</div>':'';
    const tv=trackingTestVersion();
    const linkBtns=r.test_only?'':'<button type="button" class="tb-btn tb-mini" title="Enviar o link de instalação do aplicativo pelo WhatsApp" data-tb-act="link" data-tb-i="'+i+'">🔗 Enviar link</button>'+
      (tv?'<button type="button" class="tb-btn tb-mini" title="Enviar o link da versão nova, ainda em teste" data-tb-act="link-teste" data-tb-i="'+i+'">🧪 Link da versão nova'+(tv.name?' '+safe(tv.name):'')+'</button>':'');
    return '<tr class="tb-'+safe(d.level)+'"><td><div class="tb-namerow"><span class="tb-name">'+safe(r.driver_name||'—')+'</span>'+linkBtns+'</div><div class="tb-sub">'+safe(sub)+'</div>'+phoneHtml+'</td>'+
      '<td><div class="tb-title '+safe(d.level)+'">'+safe(d.title)+'</div><div class="tb-detail">'+safe(d.detail||'')+'</div></td>'+
      '<td><div class="tb-actions">'+(actions.join('')||'<span class="muted">Nada a fazer</span>')+'</div>'+told+'</td></tr>'
  }).join('');
  const empty=!reqHtml&&!rowHtml?'<tr><td colspan="3" class="muted">Nenhum motorista com romaneio identificado hoje ainda. Assim que o romaneio sair no SSW, o motorista aparece aqui sozinho.</td></tr>':'';
  table.innerHTML='<thead><tr><th>Motorista</th><th>Situação</th><th>O que fazer</th></tr></thead><tbody>'+reqHtml+rowHtml+empty+'</tbody>';
  if(TRACKING_CONTACT_EDIT){
    const input=table.querySelector('[data-tb-phone-input]');
    if(input&&document.activeElement!==input){input.focus();const n=input.value.length;try{input.setSelectionRange(n,n)}catch(e){}}
  }
}
function trackingBoardRerender(){
  renderTrackingBoard(window.__trackingBoardRows||[],[])
}
async function trackingBoardSavePhone(item,value){
  try{
    const r=await fetch('/api/tracking/contacts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({driver_name:item.r.driver_name,phone:value})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao salvar telefone.');
    const key=trackingNorm(item.r.driver_name);
    if(j.phone)TRACKING_CONTACTS.set(key,j.phone);else TRACKING_CONTACTS.delete(key);
    TRACKING_CONTACT_EDIT=null;
    trackingBoardMsg(j.phone?'WhatsApp de '+item.r.driver_name+' salvo: '+trackingPhoneLabel(j.phone)+'.':'Telefone removido.');
  }catch(e){trackingBoardMsg(e.message,true)}
  trackingBoardRerender()
}
async function trackingBoardClick(e){
  const dec=e.target?.closest?.('[data-tb-decide]');
  if(dec){trackingDecideRequest(String(dec.dataset.tbReq||''),String(dec.dataset.tbDecide||''),dec);return}
  const b=e.target?.closest?.('[data-tb-act]');if(!b)return;
  const item=TRACKING_BOARD_ITEMS[Number(b.dataset.tbI)];if(!item)return;
  const act=b.dataset.tbAct,ckey=trackingNorm(item.r.driver_name),phone=TRACKING_CONTACTS.get(ckey)||'';
  if(act==='map'){
    const el=$('#trackingMap');if(el)el.scrollIntoView({behavior:'smooth',block:'center'});
    trackingFocusDriver(item.key);return
  }
  if(act==='phone-edit'){TRACKING_CONTACT_EDIT={key:ckey,value:phone?trackingPhoneLabel(phone):''};trackingBoardRerender();return}
  if(act==='phone-cancel'){TRACKING_CONTACT_EDIT=null;trackingBoardRerender();return}
  if(act==='phone-save'){b.disabled=true;await trackingBoardSavePhone(item,String(TRACKING_CONTACT_EDIT?.value||''));return}
  if(act==='link'||act==='link-teste'){
    const canal=act==='link-teste'?'teste':'normal';
    window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(trackingInstallMessage(item,canal)),'_blank','noopener');
    trackingBoardMsg((canal==='teste'?'Link da versão nova':'Link do aplicativo')+(phone?' pronto no WhatsApp de '+item.r.driver_name+'. É só enviar.':' pronto. Escolha o contato do motorista no WhatsApp.'));
    return
  }
  if(act==='notify'){
    window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(trackingNotifyMessage(item)),'_blank','noopener');
    trackingMarkNotified(item.key);
    trackingBoardMsg(phone?'Mensagem pronta no WhatsApp de '+item.r.driver_name+'. É só enviar.':'Mensagem pronta. Escolha o contato do motorista no WhatsApp. Dica: informe o WhatsApp dele aqui no quadro para ir direto na próxima vez.');
    trackingBoardRerender();return
  }
  if(act==='invite'){
    const op=trackingDriverOperationRow(item.r.driver_name,item.r.vehicle_plate);
    if(!op){trackingBoardMsg('Não encontrei o romaneio deste motorista para gerar o link.',true);return}
    await trackingSendAssignment(op,b,phone||'-');
    trackingMarkNotified(item.key);trackingBoardRerender()
  }
}
function renderTracking(rows){
  TRACKING_DATA=rows||[];
  const statuses=TRACKING_DATA.map(r=>({r,s:trackingStatus(r)}));
  const active=statuses.filter(x=>x.r.operation_active||x.r.session_id||x.r.map_active||trackingHasPosition(x.r)).length,on=statuses.filter(x=>x.s.key==='ok').length,dev=statuses.filter(x=>(x.r.operation_active||x.r.session_id||x.r.map_active)&&x.s.key==='bad'&&x.s.distance!==null).length,offline=statuses.filter(x=>(x.r.operation_active||x.r.session_id||x.r.map_active)&&x.s.key==='bad'&&x.s.distance===null).length;
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
  set('#trackingActive',nf(active));set('#trackingOnRoute',nf(on));set('#trackingDeviation',nf(dev));set('#trackingOffline',nf(offline));
  const tableEl=$('#trackingTable');
  if(tableEl){
    const body=statuses.map(({r,s})=>{
      const speed=Number(r.speed_mps);const kmh=Number.isFinite(speed)?speed*3.6:null;
      const key=trackingDriverKey(r.driver_name,r.vehicle_plate);
      return '<tr><td><button type="button" class="tracking-driver-link" data-tracking-key="'+safe(key)+'"><b>'+safe(r.driver_name||'—')+'</b></button></td><td>'+safe(r.vehicle_plate||'—')+'</td><td><span class="tracking-status '+safe(s.key)+'">'+safe(s.label)+'</span></td><td>'+safe(r.session_id?(String(r.session_status||'').toLowerCase()==='ended'?'Finalizada':'Em rota'):'—')+'</td><td>'+safe(trackingAgeLabel(r.age_seconds))+'</td><td>'+(kmh!==null?kmh.toFixed(0)+' km/h':'—')+'</td><td>'+(r.battery_pct!==null&&r.battery_pct!==undefined?Math.round(Number(r.battery_pct))+'%':'—')+'</td><td>'+safe(r.device_name||'—')+'</td></tr>'
    }).join('');
    tableEl.innerHTML='<thead><tr><th>Motorista</th><th>Placa</th><th>Status</th><th>Sessão</th><th>Última posição</th><th>Velocidade</th><th>Bateria</th><th>Celular</th></tr></thead><tbody>'+body+'</tbody>';
    tableEl.querySelectorAll('[data-tracking-key]').forEach(btn=>btn.onclick=()=>trackingFocusDriver(btn.dataset.trackingKey))
  }
  const info=$('#trackingInfo');if(info)info.textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+' • atualização automática a cada '+TRACKING_AUTO_SECONDS+' s • desvio configurado em '+String(TRACKING_DEVIATION_KM).replace('.',',')+' km.';
  trackingMapPopulateControls(TRACKING_DATA);
  renderTrackingMap(TRACKING_DATA)
}
async function refreshTracking(){
  if(window.__trackingBusy)return;window.__trackingBusy=true;
  const info=$('#trackingInfo');if(info)info.textContent='Atualizando motoristas e posições GPS…';
  try{
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    const [liveRes,testLiveRes,driverRes,requestRes]=await Promise.all([
      fetch('/api/tracking/live?light=1&t='+Date.now(),{cache:'no-store'}),
      fetch('/api/tracking/test-live?t='+Date.now(),{cache:'no-store'}),
      fetch('/api/roteirizador/lista?date='+encodeURIComponent(today)+'&t='+Date.now(),{cache:'no-store'}),
      fetch('/api/tracking/requests?t='+Date.now(),{cache:'no-store'})
    ]);
    const live=await liveRes.json().catch(()=>({})),testLive=await testLiveRes.json().catch(()=>({})),drivers=await driverRes.json().catch(()=>({})),requests=await requestRes.json().catch(()=>({}));
    if(!liveRes.ok||!live.ok)throw new Error(live.error||'Falha ao consultar GPS.');
    if(driverRes.ok&&drivers.ok&&Array.isArray(drivers.rows)){
      TRACKING_DRIVER_ROWS=drivers.rows.filter(x=>{
        const roms=Array.isArray(x.romaneios)?x.romaneios:[x.romaneio].filter(Boolean);
        return roms.some(v=>String(v||'').trim());
      });
      const bl=Number(drivers.baseLat),bo=Number(drivers.baseLon);
      if(Number.isFinite(bl)&&Number.isFinite(bo)){
        TRACKING_BASE_POSITION={lat:bl,lon:bo,address:drivers.baseAddress||TRACKING_BASE_POSITION.address}
      }
      trackingPopulateDriverList();
      renderTrackingAssignments();
    }else{
      TRACKING_DRIVER_ROWS=[];
      trackingPopulateDriverList();
      renderTrackingAssignments();
      const driverInfo=$('#trackingDriverDayInfo');
      if(driverInfo)driverInfo.textContent='Não foi possível carregar a relação de motoristas agora. Tentando novamente automaticamente.';
    }
    const liveRows=normalizeDriverNames([
      ...(Array.isArray(live.rows)?live.rows:[]),
      ...((testLiveRes.ok&&testLive.ok&&Array.isArray(testLive.rows))?testLive.rows:[])
    ]);
    // Rotas planejadas enviadas pelo MOVIT têm prioridade no teste/romaneio.
    liveRows.forEach(r=>{
      const mr=r?.movit_route?.route_data;
      if(!mr||!Array.isArray(mr.stops)||!mr.stops.length)return;
      const start=mr.start&&Number.isFinite(Number(mr.start.lat))&&Number.isFinite(Number(mr.start.lon))
        ?mr.start
        :mr.stops[0];
      const points=[start,...mr.stops].map((p,i)=>({
        lat:Number(p.lat),lon:Number(p.lon),
        label:p.resolved||p.label||('Parada '+i),
        destinatario:p.destinatario||p.resolved||p.label||('Parada '+i),
        cidade:p.city||p.cidade||''
      })).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
      if(points.length<2)return;
      const plan={
        points,
        optimizedOrder:Array.from({length:points.length-1},(_,i)=>i+1),
        geometry:mr.geometry||null,
        stops:mr.stops,
        expectedDeliveries:mr.stops.length,
        romaneio:r.movit_route.romaneio||''
      };
      const base=trackingBaseIdentity(r);
      TRACKING_LOGICAL_ROUTES.set(trackingDriverKey(base.driver,base.plate),plan);
      TRACKING_LOGICAL_ROUTES.set(trackingDriverKey(r.driver_name,r.vehicle_plate),plan);
    });
    const operationRows=Array.isArray(TRACKING_DRIVER_ROWS)?TRACKING_DRIVER_ROWS:[];
    TRACKING_REQUEST_ROWS=(requestRes.ok&&requests.ok&&Array.isArray(requests.rows))?requests.rows:[];
    const approvedDevices=(requestRes.ok&&requests.ok&&Array.isArray(requests.rows)?requests.rows:[])
      .filter(x=>String(x.status||'').toLowerCase()==='approved');
    const findApprovedDevice=(driver,plate)=>{
      const p=trackingNorm(plate||''),d=trackingNorm(driver||'');
      if(p){
        const byPlate=approvedDevices.find(x=>trackingNorm(x.vehicle_plate||x.veiculo||'')===p);
        if(byPlate)return byPlate
      }
      if(d){
        const exact=approvedDevices.find(x=>trackingNorm(x.driver_name||x.motorista||'')===d);
        if(exact)return exact;
        const near=approvedDevices.filter(x=>{
          const xd=trackingNorm(x.driver_name||x.motorista||'');
          return xd&&(xd.includes(d)||d.includes(xd))
        });
        if(near.length===1)return near[0]
      }
      return null
    };
    const todayKeys=new Set();
    for(const x of operationRows){
      const plate=trackingNorm(x.veiculo||x.vehicle_plate||'');
      const driver=trackingNorm(x.motorista||x.driver_name||'');
      if(plate)todayKeys.add('P|'+plate);
      if(driver)todayKeys.add('D|'+driver);
    }
    const currentRowsAll=liveRows.map(r=>{
      const op=trackingMatchOperationRow(r);
      return op?{
        ...r,
        driver_name:driverDisplayName(op.motorista||op.driver_name||r.driver_name||''),
        vehicle_plate:String(op.veiculo||op.vehicle_plate||r.vehicle_plate||'').trim().toUpperCase(),
        operation_active:true
      }:{...r,operation_active:false}
    }).filter(r=>{
      const plate=trackingNorm(r.vehicle_plate||''),driver=trackingNorm(r.driver_name||'');
      const inOperation=r.operation_active||(plate&&todayKeys.has('P|'+plate))||(driver&&todayKeys.has('D|'+driver));
      const pointToday=r.captured_at&&new Date(r.captured_at).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})===today;
      const heartbeatFresh=Number.isFinite(Number(r.device_age_seconds))&&Number(r.device_age_seconds)<=300;
      const hasLastPosition=trackingHasPosition(r);
      // Todo aparelho ativo vinculado a um motorista da operação do dia permanece
      // associado ao motorista, mesmo sem GPS/heartbeat recente. Assim a tela mostra
      // o celular aprovado e a sessão, em vez de substituir por um placeholder vazio.
      return !!(r.test_only||inOperation);
    }).map(r=>({...r,operation_active:r.test_only?true:true}));
    const currentRows=trackingOnePhonePerDriver(currentRowsAll);
    // Mantém todos os motoristas da operação do dia no mapa. Quem ainda não tiver
    // GPS/aparelho ativo aparece com a rota planejada e status "Sem sinal", sem
    // criar posição fictícia no mapa.
    const liveKeys=new Set();
    currentRows.forEach(r=>{
      const p=trackingNorm(r.vehicle_plate||''),d=trackingNorm(r.driver_name||'');
      if(p)liveKeys.add('P|'+p);
      if(d)liveKeys.add('D|'+d);
    });
    const operationPlaceholders=operationRows.filter(x=>{
      const p=trackingNorm(x.veiculo||x.vehicle_plate||''),d=trackingNorm(x.motorista||x.driver_name||'');
      return !((p&&liveKeys.has('P|'+p))||(d&&liveKeys.has('D|'+d)))
    }).map(x=>{
      const driver=driverDisplayName(x.motorista||x.driver_name||''),plate=String(x.veiculo||x.vehicle_plate||'').trim().toUpperCase();
      const approved=findApprovedDevice(driver,plate);
      return{
        driver_name:driver,
        vehicle_plate:plate,
        operation_active:true,
        map_active:false,
        session_id:null,
        session_status:'',
        latitude:null,
        longitude:null,
        age_seconds:null,
        device_age_seconds:null,
        device_approved:!!approved,
        device_name:approved?.device_name||approved?.device||'',
        approved_at:approved?.updated_at||approved?.approved_at||approved?.created_at||''
      }
    });
    const mergedRows=[...currentRows,...operationPlaceholders];
    renderTracking(mergedRows);
    // Quadro "Motoristas de hoje". Sem a lista de romaneios (SSW fora do ar ou ainda cedo),
    // mostra os celulares que deram sinal hoje para a tela nunca ficar vazia.
    let boardRows=mergedRows;
    TRACKING_BOARD_NOTE='';
    if(!operationRows.length){
      boardRows=liveRows.filter(r=>{
        if(r.test_only)return true;
        const seen=r.last_seen_at&&new Date(r.last_seen_at).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})===today;
        return !!(r.session_id||seen)
      }).map(r=>({...r,operation_active:false}));
      TRACKING_BOARD_NOTE=(driverRes.ok&&drivers.ok)
        ?'Nenhum romaneio do dia no SSW ainda. Mostrando os celulares que deram sinal hoje.'
        :'Não consegui ler os romaneios do dia agora (tentando de novo sozinho). Mostrando os celulares que deram sinal hoje.'
    }
    window.__trackingBoardRows=boardRows;
    await Promise.all([trackingLoadContacts(),trackingLoadAppVersions()]);
    renderTrackingBoard(boardRows,[]);
    trackingRefreshLogicalAnalysis(mergedRows,today).catch(()=>{});

    // A geometria das rotas é mais pesada. Ela é atualizada em separado para
    // nunca segurar a lista de Motorista + Placa.
    const now=Date.now();
    if(!window.__trackingRouteBusy&&(!window.__trackingRouteAt||now-window.__trackingRouteAt>60000)){
      window.__trackingRouteBusy=true;
      fetch('/api/programacao-simulacao?t='+now,{cache:'no-store'})
        .then(async r=>({ok:r.ok,j:await r.json().catch(()=>({}))}))
        .then(x=>{
          if(x.ok&&x.j?.ok){
            TRACKING_ROUTE_DATA=x.j;
            window.__trackingRouteAt=Date.now();
            if(TRACKING_DATA)renderTracking(TRACKING_DATA)
          }
        })
        .catch(()=>{})
        .finally(()=>{window.__trackingRouteBusy=false})
    }
  }catch(e){if(info)info.textContent='Erro no rastreamento: '+e.message}
  finally{
    window.__trackingBusy=false;
    TRACKING_NEXT_REFRESH=Date.now()+TRACKING_AUTO_SECONDS*1000;
  }
}
function trackingApplyRefreshSeconds(){
  const input=$('#trackingRefreshSeconds'),msg=$('#trackingRefreshSettingMsg');
  let seconds=Math.round(Number(input?.value||30));
  if(!Number.isFinite(seconds))seconds=30;
  seconds=Math.max(5,Math.min(300,seconds));
  TRACKING_AUTO_SECONDS=seconds;
  if(input)input.value=String(seconds);
  localStorage.setItem('construlog_tracking_refresh_seconds',String(seconds));
  TRACKING_NEXT_REFRESH=Date.now()+seconds*1000;
  if(msg)msg.textContent='Atualização automática configurada para '+seconds+' segundo(s).';
}
function trackingAutoTick(){
  const t=$('.section.active')?.id;
  if(document.hidden||t!=='rastreamento'||!hasPerm('tracking'))return;
  if(!TRACKING_NEXT_REFRESH)TRACKING_NEXT_REFRESH=Date.now()+TRACKING_AUTO_SECONDS*1000;
  const remaining=Math.max(0,Math.ceil((TRACKING_NEXT_REFRESH-Date.now())/1000));
  const countdown=$('#trackingRefreshCountdown');
  if(countdown)countdown.textContent='Próxima atualização em '+remaining+' s';
  if(Date.now()>=TRACKING_NEXT_REFRESH&&!window.__trackingBusy){
    TRACKING_NEXT_REFRESH=Date.now()+TRACKING_AUTO_SECONDS*1000;
    refreshTracking();
  }
}
async function refreshTrackingRequests(){
  const info=$('#trackingRequestsInfo'),tableEl=$('#trackingRequestsTable');
  if(!tableEl)return;
  if(info)info.textContent='Buscando solicitações de aparelhos…';
  try{
    const r=await fetch('/api/tracking/requests?t='+Date.now(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao carregar solicitações.');
    const rows=Array.isArray(j.rows)?j.rows:[],pending=rows.filter(x=>x.status==='pending');
    if(info)info.textContent=pending.length
      ?nf(pending.length)+' aparelho(s) aguardando sua aprovação.'
      :'Nenhum aparelho aguardando aprovação.';
    const shown=rows.slice(0,30);
    const body=shown.length?shown.map(x=>{
      const when=x.created_at?new Date(x.created_at).toLocaleString('pt-BR'):'—';
      const status=x.status==='pending'
        ?'<span class="tracking-status warn">Aguardando</span>'
        :(x.status==='approved'?'<span class="tracking-status ok">Aprovado</span>':'<span class="tracking-status bad">Recusado</span>');
      const actions=x.status==='pending'
        ?'<button class="primary tracking-request-action" type="button" data-request-id="'+safe(x.id)+'" data-action="approve">Aprovar</button> <button class="secondary tracking-request-action" type="button" data-request-id="'+safe(x.id)+'" data-action="reject">Recusar</button>'
        :'—';
      return '<tr><td><b>'+safe(x.driver_name||'Motorista')+'</b></td><td>'+safe(x.vehicle_plate||'—')+'</td><td>'+safe(x.device_name||'Android')+'</td><td>'+safe(when)+'</td><td>'+status+'</td><td>'+actions+'</td></tr>'
    }).join(''):'<tr><td colspan="6" class="muted">Nenhuma solicitação encontrada.</td></tr>';
    tableEl.innerHTML='<thead><tr><th>Motorista</th><th>Placa</th><th>Aparelho</th><th>Solicitado em</th><th>Status</th><th>Ação</th></tr></thead><tbody>'+body+'</tbody>'
  }catch(e){
    if(info)info.textContent='Erro ao carregar solicitações: '+e.message;
    tableEl.innerHTML='<tbody><tr><td class="muted">Não foi possível carregar as solicitações.</td></tr></tbody>'
  }
}
async function trackingDecideRequest(id,action,button=null){
  if(!id||!['approve','reject'].includes(action))return;
  const verb=action==='approve'?'aprovar':'recusar',info=$('#trackingRequestsInfo');
  if(button){button.disabled=true;button.textContent=action==='approve'?'Aprovando…':'Recusando…'}
  if(info)info.textContent=(action==='approve'?'Aprovando':'Recusando')+' aparelho…';
  try{
    // Na aprovação vai o motorista do dia escolhido no quadro (se houver); o servidor grava o
    // cadastro do celular com esse nome e essa placa.
    const payload={};
    if(action==='approve'){
      const reqRow=(TRACKING_REQUEST_ROWS||[]).find(x=>String(x.id)===String(id));
      const options=trackingRequestOptions(),pick=reqRow?options.find(o=>o.key===trackingRequestChoice(reqRow,options)):null;
      if(pick){payload.driver_name=pick.name;payload.vehicle_plate=pick.plate}
    }
    const r=await fetch('/api/tracking/requests/'+encodeURIComponent(id)+'/'+action,{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||('Falha ao '+verb+' aparelho.'));
    if(info)info.textContent=action==='approve'?'Aparelho aprovado. O celular será liberado automaticamente.':'Solicitação recusada.';
    TRACKING_REQUEST_CHOICE.delete(String(id));
    trackingBoardMsg(action==='approve'?'Aparelho aprovado'+(j.driver_name?' para '+j.driver_name+(j.vehicle_plate?' • '+j.vehicle_plate:''):'')+'. O celular começa a rastrear sozinho em até 1 minuto.':'Pedido recusado.');
    await refreshTrackingRequests();
    TRACKING_NEXT_REFRESH=0;
    refreshTracking().catch(()=>{})
  }catch(e){
    if(info)info.textContent='Erro ao '+verb+' aparelho: '+e.message;
    trackingBoardMsg('Erro ao '+verb+' aparelho: '+e.message,true);
    if(button){button.disabled=false;button.textContent=action==='approve'?'Aprovar':'Recusar'}
  }
}
window.trackingDecideRequest=trackingDecideRequest;

function renderTrackingAssignments(){
  const tableEl=$('#trackingAssignmentsTable'),info=$('#trackingAssignmentsInfo');if(!tableEl)return;
  const rows=(Array.isArray(TRACKING_DRIVER_ROWS)?TRACKING_DRIVER_ROWS:[]).filter(x=>{
    const roms=Array.isArray(x.romaneios)?x.romaneios:[x.romaneio].filter(Boolean);
    return String(x.motorista||'').trim()&&String(x.veiculo||'').trim()&&roms.some(v=>String(v||'').trim())
  });
  if(info)info.textContent=rows.length
    ?nf(rows.length)+' motorista(s) com romaneio e placa identificados hoje. Associação automática ativada: novos romaneios são vinculados ao rastreio sem ação do motorista.'
    :'Nenhum romaneio com motorista e placa identificado agora.';
  const body=rows.length?rows.map((x,i)=>{
    const driver=driverDisplayName(x.motorista||''),plate=String(x.veiculo||'').trim().toUpperCase();
    const roms=(Array.isArray(x.romaneios)?x.romaneios:[x.romaneio]).map(v=>String(v||'').trim()).filter(Boolean);
    return '<tr>'+
      '<td><b>'+safe(driver)+'</b></td>'+
      '<td><b>'+safe(plate)+'</b></td>'+
      '<td>'+safe(roms.join(', '))+'</td>'+
      '<td>'+nf(Number(x.entregas||x.total||0))+'</td>'+
      '<td><span class="tracking-status ok">Automático</span> <button class="secondary tracking-send-assignment" type="button" data-index="'+i+'">💬 Reenviar link</button> <button class="secondary tracking-test-assignment" type="button" data-index="'+i+'">🧪 Testar</button></td>'+
      '</tr>'
  }).join(''):'<tr><td colspan="5" class="muted">Nenhum romaneio disponível para envio.</td></tr>';
  tableEl.innerHTML='<thead><tr><th>Motorista</th><th>Placa</th><th>Romaneio(s)</th><th>Entregas</th><th>Ação</th></tr></thead><tbody>'+body+'</tbody>';
  const eligible=rows;
  tableEl.querySelectorAll('.tracking-send-assignment').forEach(btn=>{
    btn.onclick=()=>trackingSendAssignment(eligible[Number(btn.dataset.index)||0],btn)
  })
  tableEl.querySelectorAll('.tracking-test-assignment').forEach(btn=>{
    btn.onclick=()=>trackingSendTestAssignment(eligible[Number(btn.dataset.index)||0],btn)
  })
}

async function trackingSendAssignment(row,button=null,phone=''){
  if(!row)return;
  const driver=driverDisplayName(row.motorista||''),plate=String(row.veiculo||'').trim().toUpperCase();
  const roms=(Array.isArray(row.romaneios)?row.romaneios:[row.romaneio]).map(v=>String(v||'').trim()).filter(Boolean);
  const info=$('#trackingAssignmentsInfo');
  if(!driver||!plate||!roms.length){if(info)info.textContent='Motorista, placa ou romaneio incompletos.';return}
  const buttonLabel=button?button.textContent:'';
  if(button){button.disabled=true;button.textContent='Gerando link…'}
  try{
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    const r=await fetch('/api/tracking/assignment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      driver_name:driver,vehicle_plate:plate,romaneios:roms,work_date:today
    })});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao associar romaneio.');
    const message='CONSTRULOG Motorista\n\nMotorista: '+driver+'\nPlaca: '+plate+'\nRomaneio(s): '+roms.join(', ')+'\n\nInstale ou abra o aplicativo por este link:\n'+j.install_url+'\n\nNo primeiro acesso, informe seu nome e a placa apenas uma vez. Depois, os próximos romaneios serão identificados automaticamente pela placa.';
    if(info)info.textContent='Romaneio '+roms.join(', ')+' associado à placa '+plate+'. Link pronto para envio.';
    if(phone){
      // Chamado pelo quadro: abre direto o WhatsApp (do motorista, quando o telefone está salvo).
      const digits=String(phone).replace(/\D/g,'');
      window.open('https://wa.me/'+digits+'?text='+encodeURIComponent(message),'_blank','noopener');
      trackingBoardMsg(digits?'Link pronto no WhatsApp de '+driver+'. É só enviar.':'Link pronto. Escolha o contato do motorista no WhatsApp.');
      return
    }
    if(navigator.share){
      try{await navigator.share({title:'CONSTRULOG Motorista',text:message});return}catch(e){if(e?.name==='AbortError')return}
    }
    window.open('https://wa.me/?text='+encodeURIComponent(message),'_blank','noopener')
  }catch(e){
    if(info)info.textContent='Erro ao preparar envio: '+e.message;
    if(phone)trackingBoardMsg('Erro ao preparar o link: '+e.message,true)
  }finally{
    if(button){button.disabled=false;button.textContent=buttonLabel||'💬 Reenviar link'}
  }
}
window.trackingSendAssignment=trackingSendAssignment;

async function trackingSendTestAssignment(row,button=null){
  if(!row)return;
  const driver=driverDisplayName(row.motorista||''),plate=String(row.veiculo||'').trim().toUpperCase();
  const roms=(Array.isArray(row.romaneios)?row.romaneios:[row.romaneio]).map(v=>String(v||'').trim()).filter(Boolean);
  const info=$('#trackingAssignmentsInfo');
  if(!driver||!plate||!roms.length){if(info)info.textContent='Motorista, placa ou romaneio incompletos para o teste.';return}
  if(button){button.disabled=true;button.textContent='Gerando teste…'}
  try{
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    const r=await fetch('/api/tracking/test-assignment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      driver_name:driver,vehicle_plate:plate,romaneios:roms,work_date:today
    })});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao gerar ambiente de teste.');
    const message='CONSTRULOG Motorista — TESTE\n\nMotorista: '+driver+'\nPlaca: '+plate+'\nRomaneio(s): '+roms.join(', ')+'\n\nAbra no seu celular:\n'+j.install_url+'\n\nAMBIENTE ISOLADO: não interfere no aplicativo nem no GPS real do motorista.';
    if(info)info.textContent='Link de teste criado para '+driver+' • '+plate+'.';
    if(navigator.share){
      try{await navigator.share({title:'CONSTRULOG Motorista — Teste',text:message});return}catch(e){if(e?.name==='AbortError')return}
    }
    window.open('https://wa.me/?text='+encodeURIComponent(message),'_blank','noopener')
  }catch(e){
    if(info)info.textContent='Erro ao preparar teste: '+e.message
  }finally{
    if(button){button.disabled=false;button.textContent='🧪 Testar no meu celular'}
  }
}
window.trackingSendTestAssignment=trackingSendTestAssignment;

async function generateTrackingCode(){
  const driverEl=$('#trackingDriverName'),opt=driverEl?.selectedOptions?.[0];
  const driver=String(opt?.dataset?.driver||driverEl?.value||'').trim(),plate=String($('#trackingVehiclePlate')?.value||opt?.dataset?.plate||'').trim().toUpperCase(),msg=$('#trackingEnrollMsg'),codeBox=$('#trackingActivationCode'),btn=$('#trackingGenerateCode');
  if(!driver){if(msg)msg.textContent='Selecione um motorista que esteja trabalhando hoje.';return}
  if(btn)btn.disabled=true;
  try{
    const r=await fetch('/api/tracking/enrollment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({driver_name:driver,vehicle_plate:plate,expires_hours:24})});
    const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao gerar código.');
    if(codeBox){codeBox.style.display='block';codeBox.textContent=j.code}
    if(msg)msg.textContent='Código válido por 24 horas e usado apenas uma vez. Informe este código ao motorista no primeiro acesso ao app.'
  }catch(e){if(msg)msg.textContent='Erro: '+e.message}
  finally{if(btn)btn.disabled=false}
}
function setupTracking(){
  if($('#trackingHistoryDate')&&!$('#trackingHistoryDate').value)$('#trackingHistoryDate').value=iso(new Date());
  if($('#trackingHistorySearch'))$('#trackingHistorySearch').onclick=refreshTrackingHistory;
  if($('#trackingHistoryToday'))$('#trackingHistoryToday').onclick=trackingHistoryToday;
  if($('#trackingHistoryPrint'))$('#trackingHistoryPrint').onclick=printTrackingHistory;
  if($('#trackingHistoryDate'))$('#trackingHistoryDate').onchange=async()=>{TRACKING_HISTORY_RESULT=null;TRACKING_HISTORY_AT=0;await trackingHistoryLoadDrivers(false)};
  if($('#trackingHistoryDriver'))$('#trackingHistoryDriver').onchange=()=>{};
  if($('#trackingRouteCompareDriver'))$('#trackingRouteCompareDriver').onchange=trackingRenderAnalysis;
  if($('#trackingGenerateCode'))$('#trackingGenerateCode').onclick=generateTrackingCode;
  if($('#trackingRequestsRefresh'))$('#trackingRequestsRefresh').onclick=refreshTrackingRequests;
  if($('#trackingBoardRefresh'))$('#trackingBoardRefresh').onclick=()=>{TRACKING_NEXT_REFRESH=0;refreshTracking()};
  const boardTable=$('#trackingBoardTable');
  if(boardTable){
    boardTable.onclick=trackingBoardClick;
    boardTable.onchange=e=>{
      const sel=e.target?.closest?.('[data-tb-req-choice]');if(!sel)return;
      TRACKING_REQUEST_CHOICE.set(String(sel.dataset.tbReqChoice||''),String(sel.value||''));
      sel.blur();trackingBoardRerender()
    };
    boardTable.oninput=e=>{if(e.target?.matches?.('[data-tb-phone-input]')&&TRACKING_CONTACT_EDIT)TRACKING_CONTACT_EDIT.value=e.target.value};
    boardTable.onkeydown=e=>{
      if(!e.target?.matches?.('[data-tb-phone-input]'))return;
      const item=TRACKING_BOARD_ITEMS[Number(e.target.dataset.tbPhoneInput)];
      if(e.key==='Enter'&&item){e.preventDefault();trackingBoardSavePhone(item,e.target.value)}
      if(e.key==='Escape'){TRACKING_CONTACT_EDIT=null;trackingBoardRerender()}
    }
  }
  if($('#trackingAssignmentsRefresh'))$('#trackingAssignmentsRefresh').onclick=()=>{TRACKING_NEXT_REFRESH=0;refreshTracking()};
  const reqTable=$('#trackingRequestsTable');
  if(reqTable)reqTable.onclick=e=>{
    const b=e.target?.closest?.('.tracking-request-action');if(!b)return;
    trackingDecideRequest(String(b.dataset.requestId||''),String(b.dataset.action||''),b)
  };
  refreshTrackingRequests().catch(()=>{});
  if($('#trackingUseTest'))$('#trackingUseTest').onclick=trackingUseTest;
  if($('#trackingRefresh'))$('#trackingRefresh').onclick=()=>{TRACKING_NEXT_REFRESH=0;refreshTracking()};
  if($('#trackingMapDriver'))$('#trackingMapDriver').onchange=trackingMapSelectDriver;
  if($('#trackingMapOnlyDrivers'))$('#trackingMapOnlyDrivers').onchange=trackingMapApplyFilters;
  trackingMapPopulateControls(TRACKING_DATA||[]);
  if($('#trackingDriverName'))$('#trackingDriverName').onchange=()=>trackingDriverSelectionChanged(true);
  if($('#trackingVehiclePlate'))$('#trackingVehiclePlate').oninput=e=>{e.target.value=String(e.target.value||'').toUpperCase()}
  const refreshInput=$('#trackingRefreshSeconds');
  if(refreshInput){
    refreshInput.value=String(TRACKING_AUTO_SECONDS);
    refreshInput.onchange=trackingApplyRefreshSeconds;
    refreshInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();trackingApplyRefreshSeconds()}};
  }
  const msg=$('#trackingRefreshSettingMsg');if(msg)msg.textContent='Atualização automática configurada para '+TRACKING_AUTO_SECONDS+' segundo(s).';
  TRACKING_NEXT_REFRESH=Date.now()+TRACKING_AUTO_SECONDS*1000;
}


let RT_MANIFESTS=[],RT_PLAN=null,RT_ORDER=[],RT_MAP=null,RT_LAYER=null;
function rtPopulateManifest(){
  const driver=$('#rtDriver')?.value||'',sel=$('#rtManifest');if(!sel)return;
  const rows=RT_MANIFESTS.filter(x=>!driver||x.motorista===driver);
  sel.innerHTML='<option value="">Selecione o romaneio</option>'+rows.map(x=>'<option value="'+safe(x.romaneio)+'">'+safe(x.romaneio)+' • '+nf(x.entregas)+' entrega(s)'+(x.veiculo?' • '+safe(x.veiculo):'')+'</option>').join('')
}
function rtPopulateDrivers(){
  const sel=$('#rtDriver');if(!sel)return;
  const cur=sel.value,drivers=[...new Set(RT_MANIFESTS.map(x=>x.motorista).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sel.innerHTML='<option value="">Selecione o motorista</option>'+drivers.map(x=>'<option>'+safe(x)+'</option>').join('');
  if(drivers.includes(cur))sel.value=cur;
  rtPopulateManifest()
}
async function rtLoadManifests(force=true){
  const date=$('#rtDate')?.value||iso(new Date()),status=$('#rtStatus');
  if(status)status.textContent='Carregando romaneios do SSW no ambiente de teste…';
  try{
    const r=await fetch('/api/roteirizador/lista?date='+encodeURIComponent(date)+(force?'&t='+Date.now():''),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível carregar os romaneios.');
    RT_MANIFESTS=j.rows||[];
    rtPopulateDrivers();
    if(status)status.textContent=RT_MANIFESTS.length?nf(RT_MANIFESTS.length)+' romaneio(s) carregado(s). Escolha motorista e romaneio para comparar.':'Nenhum romaneio encontrado para esta data.'
  }catch(e){if(status)status.textContent='Erro no teste: '+e.message}
}
function rtLegs(order){
  if(!RT_PLAN)return[];
  const seq=[0,...order,0],out=[];
  for(let i=1;i<seq.length;i++){
    const a=seq[i-1],b=seq[i],p=RT_PLAN.points?.[b]||{};
    out.push({fromIndex:a,toIndex:b,meters:Number(RT_PLAN.matrix?.[a]?.[b]||0),point:p})
  }
  return out
}
function rtMove(pos,dir){
  const n=pos+dir;if(n<0||n>=RT_ORDER.length)return;
  [RT_ORDER[pos],RT_ORDER[n]]=[RT_ORDER[n],RT_ORDER[pos]];
  rtRender()
}
function rtUrgent(pos){
  if(pos<=0||pos>=RT_ORDER.length)return;
  const [idx]=RT_ORDER.splice(pos,1);RT_ORDER.unshift(idx);rtRender()
}
async function rtRenderMap(){
  const box=$('#rtMap');if(!box||!RT_PLAN)return;
  if(typeof L==='undefined'){box.innerHTML='<div class="muted" style="padding:24px">Mapa indisponível.</div>';return}
  if(!RT_MAP){
    RT_MAP=L.map(box,{zoomControl:true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(RT_MAP)
  }
  if(RT_LAYER)RT_LAYER.remove();
  RT_LAYER=L.layerGroup().addTo(RT_MAP);
  const points=RT_PLAN.points||[],base=points[0],order=RT_ORDER.slice();
  if(!base)return;
  L.marker([base.lat,base.lon]).addTo(RT_LAYER).bindTooltip('BASE • Americana');
  order.forEach((idx,pos)=>{
    const p=points[idx];if(!p)return;
    const icon=L.divIcon({className:'',html:'<div style="background:#0f766e;color:#fff;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:800;border:2px solid #fff;box-shadow:0 1px 5px #0005">'+(pos+1)+'</div>',iconSize:[28,28],iconAnchor:[14,14]});
    L.marker([p.lat,p.lon],{icon}).addTo(RT_LAYER).bindPopup('<b>'+safe(p.destinatario||p.label||'Parada')+'</b><br>'+safe((p.cidade||'')+(p.uf?' / '+p.uf:'')))
  });

  let routeCoords=[];
  try{
    const sameAsOptimized=JSON.stringify(order)===JSON.stringify(RT_PLAN.optimizedOrder||[]);
    if(sameAsOptimized && Array.isArray(RT_PLAN.geometry?.coordinates)){
      routeCoords=RT_PLAN.geometry.coordinates.map(x=>[Number(x[1]),Number(x[0])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]))
    }else{
      const r=await fetch('/api/roteirizador/geometria-order',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({points:points.map(p=>({lat:p.lat,lon:p.lon})),order})
      });
      const j=await r.json().catch(()=>({}));
      if(r.ok&&j.ok&&Array.isArray(j.geometry?.coordinates)){
        routeCoords=j.geometry.coordinates.map(x=>[Number(x[1]),Number(x[0])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]))
      }
    }
  }catch(e){}

  if(!routeCoords.length){
    routeCoords=[base,...order.map(i=>points[i]).filter(Boolean),base].map(p=>[p.lat,p.lon])
  }
  if(routeCoords.length>2)L.polyline(routeCoords,{weight:5,opacity:.88,dashArray:'10 6',lineCap:'round',lineJoin:'round'}).addTo(RT_LAYER);

  const markerCoords=[[base.lat,base.lon],...order.map(i=>[points[i]?.lat,points[i]?.lon]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]))];
  const bounds=L.latLngBounds(routeCoords.length?routeCoords:markerCoords);if(bounds.isValid())RT_MAP.fitBounds(bounds.pad(.12));
  setTimeout(()=>RT_MAP.invalidateSize(),80)
}
function rtRender(){
  if(!RT_PLAN)return;
  const points=RT_PLAN.points||[],matrix=RT_PLAN.matrix||[],best=Number(RT_PLAN.optimizedDistanceMeters||0);
  const original=routeDistance(RT_PLAN.originalOrder||[],matrix),current=routeDistance(RT_ORDER,matrix),saving=Math.max(0,original-current);
  if($('#rtStops'))$('#rtStops').textContent=nf(RT_PLAN.deliveries||RT_ORDER.length);
  if($('#rtBestKm'))$('#rtBestKm').textContent=routeFmtKm(current);
  if($('#rtOriginalKm'))$('#rtOriginalKm').textContent=routeFmtKm(original);
  if($('#rtSavingKm'))$('#rtSavingKm').textContent=routeFmtKm(saving);
  if($('#rtApprox'))$('#rtApprox').textContent=nf(RT_PLAN.approximateStops||0);
  if($('#rtMethod'))$('#rtMethod').textContent=(RT_PLAN.method||'otimizada').toUpperCase()+' • TESTE';
  const list=$('#rtList');
  if(list){
    const legs=rtLegs(RT_ORDER);
    list.innerHTML=RT_ORDER.map((idx,pos)=>{
      const p=points[idx]||{},leg=legs[pos]||{};
      return '<div class="route-stop"><div class="seq">'+(pos+1)+'</div><div><b>'+safe(p.destinatario||p.label||'')+'</b><div class="meta">'+safe((p.cidade||'')+(p.uf?' / '+p.uf:''))+'</div><div class="meta">CT-e '+safe(p.ctrc||'—')+' • NF '+safe(p.nf||'—')+'</div></div><div><div class="km">'+routeFmtKm(leg.meters)+'</div><div class="move"><button type="button" data-rt-urgent="'+pos+'" title="Tornar próxima parada">⚡</button><button type="button" data-rt-up="'+pos+'" '+(pos===0?'disabled':'')+'>↑</button><button type="button" data-rt-down="'+pos+'" '+(pos===RT_ORDER.length-1?'disabled':'')+'>↓</button></div></div></div>'
    }).join('');
    list.querySelectorAll('[data-rt-urgent]').forEach(b=>b.onclick=()=>rtUrgent(Number(b.dataset.rtUrgent)));
    list.querySelectorAll('[data-rt-up]').forEach(b=>b.onclick=()=>rtMove(Number(b.dataset.rtUp),-1));
    list.querySelectorAll('[data-rt-down]').forEach(b=>b.onclick=()=>rtMove(Number(b.dataset.rtDown),1))
  }
  const table=$('#rtTable');
  if(table){
    const originalOrder=RT_PLAN.originalOrder||[],bestOrder=RT_PLAN.optimizedOrder||[];
    const max=Math.max(originalOrder.length,bestOrder.length);
    let body='';
    for(let i=0;i<max;i++){
      const a=points[originalOrder[i]]||{},b=points[bestOrder[i]]||{};
      body+='<tr><td>'+(i+1)+'</td><td>'+safe(a.destinatario||a.label||'—')+'<div class="muted">'+safe(a.cidade||'')+'</div></td><td>'+safe(b.destinatario||b.label||'—')+'<div class="muted">'+safe(b.cidade||'')+'</div></td></tr>'
    }
    table.innerHTML='<thead><tr><th>#</th><th>Ordem original</th><th>Ordem otimizada</th></tr></thead><tbody>'+body+'</tbody>'
  }
  rtRenderMap()
}
async function rtOptimize(){
  const date=$('#rtDate')?.value||'',rom=$('#rtManifest')?.value||'',status=$('#rtStatus'),btn=$('#rtOptimize');
  if(!rom){if(status)status.textContent='Escolha um romaneio para o teste.';return}
  if(btn){btn.disabled=true;btn.textContent='Otimizando…'}
  if(status)status.textContent='Calculando sequência de teste com a mesma base de dados do SSW…';
  try{
    const r=await fetch('/api/roteirizador/rota?date='+encodeURIComponent(date)+'&romaneio='+encodeURIComponent(rom)+'&test=1&t='+Date.now(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível calcular a rota.');
    RT_PLAN=j;RT_ORDER=(j.optimizedOrder||[]).slice();
    if(status)status.textContent='TESTE • '+(j.motorista||'Motorista')+' • '+(j.romaneio||rom)+' • '+nf(j.deliveries||0)+' parada(s). Nada foi alterado na Programação.';
    rtRender()
  }catch(e){if(status)status.textContent='Erro no roteirizador de teste: '+e.message}
  finally{if(btn){btn.disabled=false;btn.textContent='Otimizar como Spoke'}}
}

let RV2_STOPS=[],RV2_PLAN=null,RV2_ORDER=[],RV2_MAP=null,RV2_LAYER=null,RV2_START=null,RV2_ROUTE_START_KEY='',RV2_ROUTE_END_KEY='',RV2_RUNNING=false,RV2_DONE=[],RV2_SKIPPED=[];
function rv2FmtTime(sec){
  const s=Number(sec);if(!Number.isFinite(s)||s<=0)return'—';
  const m=Math.round(s/60),h=Math.floor(m/60),mm=m%60;
  return h?((h+'h '+(mm?mm+'min':'' )).trim()):(m+' min')
}
function rv2StopKey(s){return [s?.lat,s?.lon,s?.label||s?.endereco||''].join('|')}
function rv2SetRouteStart(pos){
  const s=RV2_STOPS[pos];if(!s)return;
  RV2_START=null;RV2_ROUTE_START_KEY=rv2StopKey(s);
  if(RV2_ROUTE_END_KEY===RV2_ROUTE_START_KEY)RV2_ROUTE_END_KEY='';
  RV2_PLAN=null;rv2RenderList();rv2RenderMap();
  const st=$('#rv2Status');if(st)st.textContent='Ponto inicial definido: '+(s.label||s.endereco||'Parada')+'.'
}
function rv2SetRouteEnd(pos){
  const s=RV2_STOPS[pos];if(!s)return;
  RV2_ROUTE_END_KEY=rv2StopKey(s);
  if(RV2_ROUTE_START_KEY===RV2_ROUTE_END_KEY)RV2_ROUTE_START_KEY='';
  RV2_PLAN=null;rv2RenderList();rv2RenderMap();
  const st=$('#rv2Status');if(st)st.textContent='Destino final definido: '+(s.label||s.endereco||'Parada')+'.'
}

function rv2StatusBadge(s){
  const k=rv2StopKey(s);
  if(RV2_DONE.includes(k))return '<span class="tracking-status ok">Concluída</span>';
  if(RV2_SKIPPED.includes(k))return '<span class="tracking-status warn">Pulada</span>';
  return ''
}
function rv2RemainingStops(){return RV2_STOPS.filter(s=>!RV2_DONE.includes(rv2StopKey(s))&&!RV2_SKIPPED.includes(rv2StopKey(s)))}
function rv2RenderTrip(){
  const box=$('#rv2ActiveTrip');if(!box)return;
  if(!RV2_RUNNING){box.style.display='none';box.textContent='';return}
  const remaining=rv2RemainingStops(),next=remaining[0];
  box.style.display='block';
  box.innerHTML='<b>Rota em andamento</b> • '+nf(RV2_DONE.length)+' concluída(s) • '+nf(RV2_SKIPPED.length)+' pulada(s) • '+nf(remaining.length)+' restante(s)'+
    (next?'<div style="margin-top:6px">Próxima: <b>'+safe(next.label||next.endereco||'Parada')+'</b></div>':'<div style="margin-top:6px"><b>Rota concluída.</b></div>')
}
function rv2RenderList(){
  const box=$('#rv2List'),k=$('#rv2StopsKpi');if(k)k.textContent=nf(RV2_STOPS.length);if(!box)return;
  if(!RV2_STOPS.length){box.innerHTML='<div class="muted">Nenhuma parada adicionada.</div>';rv2RenderTrip();return}
  box.innerHTML=RV2_STOPS.map((s,pos)=>{
    const done=RV2_DONE.includes(rv2StopKey(s)),skipped=RV2_SKIPPED.includes(rv2StopKey(s));
    const tripActions=RV2_RUNNING&&!done&&!skipped
      ?'<button type="button" data-rv2-nav="'+pos+'" title="Navegar">🧭</button><button type="button" data-rv2-done="'+pos+'" title="Concluir">✓</button><button type="button" data-rv2-skip="'+pos+'" title="Pular">↷</button>'
      :'';
    const key=rv2StopKey(s),isStart=key===RV2_ROUTE_START_KEY,isEnd=key===RV2_ROUTE_END_KEY;
    const routeRole=(isStart?'<span class="tracking-status ok">INÍCIO</span> ':'')+(isEnd?'<span class="tracking-status warn">FIM</span> ':'');
    return '<div class="route-stop" style="'+((done||skipped)?'opacity:.62':'')+'"><div class="seq">'+(pos+1)+'</div><div><b>'+safe(s.label||s.endereco||'Parada')+'</b><div class="meta">'+safe((s.cidade||'')+(s.uf?' / '+s.uf:''))+'</div><div class="meta">'+routeRole+rv2StatusBadge(s)+'</div></div><div class="move">'+tripActions+'<button type="button" data-rv2-start="'+pos+'" title="Definir como início">🟢</button><button type="button" data-rv2-end="'+pos+'" title="Definir como destino final">🏁</button><button type="button" data-rv2-urgent="'+pos+'" title="Tornar próxima parada">⚡</button><button type="button" data-rv2-up="'+pos+'" '+(pos===0?'disabled':'')+'>↑</button><button type="button" data-rv2-down="'+pos+'" '+(pos===RV2_STOPS.length-1?'disabled':'')+'>↓</button><button type="button" data-rv2-del="'+pos+'" title="Excluir">✕</button></div></div>'
  }).join('');
  box.querySelectorAll('[data-rv2-start]').forEach(b=>b.onclick=()=>rv2SetRouteStart(Number(b.dataset.rv2Start)));
  box.querySelectorAll('[data-rv2-end]').forEach(b=>b.onclick=()=>rv2SetRouteEnd(Number(b.dataset.rv2End)));
  box.querySelectorAll('[data-rv2-up]').forEach(b=>b.onclick=()=>rv2Move(Number(b.dataset.rv2Up),-1));
  box.querySelectorAll('[data-rv2-down]').forEach(b=>b.onclick=()=>rv2Move(Number(b.dataset.rv2Down),1));
  box.querySelectorAll('[data-rv2-urgent]').forEach(b=>b.onclick=()=>rv2Urgent(Number(b.dataset.rv2Urgent)));
  box.querySelectorAll('[data-rv2-del]').forEach(b=>b.onclick=()=>rv2Delete(Number(b.dataset.rv2Del)));
  box.querySelectorAll('[data-rv2-nav]').forEach(b=>b.onclick=()=>rv2Navigate(Number(b.dataset.rv2Nav)));
  box.querySelectorAll('[data-rv2-done]').forEach(b=>b.onclick=()=>rv2Complete(Number(b.dataset.rv2Done)));
  box.querySelectorAll('[data-rv2-skip]').forEach(b=>b.onclick=()=>rv2Skip(Number(b.dataset.rv2Skip)));
  rv2RenderTrip()
}
function rv2Move(pos,dir){const n=pos+dir;if(n<0||n>=RV2_STOPS.length)return;[RV2_STOPS[pos],RV2_STOPS[n]]=[RV2_STOPS[n],RV2_STOPS[pos]];RV2_PLAN=null;rv2RenderList();rv2RenderMap()}
function rv2Urgent(pos){if(pos<=0)return;const [x]=RV2_STOPS.splice(pos,1);RV2_STOPS.unshift(x);RV2_PLAN=null;rv2RenderList();rv2RenderMap()}
function rv2Delete(pos){const s=RV2_STOPS[pos],k=rv2StopKey(s);RV2_STOPS.splice(pos,1);if(RV2_ROUTE_START_KEY===k)RV2_ROUTE_START_KEY='';if(RV2_ROUTE_END_KEY===k)RV2_ROUTE_END_KEY='';RV2_DONE=RV2_DONE.filter(x=>x!==k);RV2_SKIPPED=RV2_SKIPPED.filter(x=>x!==k);RV2_PLAN=null;rv2RenderList();rv2RenderMap();const st=$('#rv2Status');if(st)st.textContent=RV2_STOPS.length?'Parada removida. Otimize novamente quando quiser.':'Adicione duas ou mais paradas para começar.'}
function rv2Clear(){RV2_STOPS=[];RV2_PLAN=null;RV2_ORDER=[];RV2_START=null;RV2_ROUTE_START_KEY='';RV2_ROUTE_END_KEY='';RV2_RUNNING=false;RV2_DONE=[];RV2_SKIPPED=[];if(RV2_LAYER){RV2_LAYER.remove();RV2_LAYER=null}rv2RenderList();['#rv2Km','#rv2Time','#rv2Method'].forEach(x=>{const el=$(x);if(el)el.textContent='—'});const s=$('#rv2Status');if(s)s.textContent='Adicione duas ou mais paradas para começar.'}
async function rv2RenderMap(){
  const box=$('#rv2Map');if(!box||typeof L==='undefined')return;
  if(!RV2_MAP){RV2_MAP=L.map(box,{zoomControl:true});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(RV2_MAP)}
  if(RV2_LAYER)RV2_LAYER.remove();RV2_LAYER=L.layerGroup().addTo(RV2_MAP);
  const pts=RV2_PLAN?.points||[];
  if(RV2_PLAN&&pts.length>1){
    const base=pts[0],order=RV2_PLAN.optimizedOrder||[];
    L.marker([base.lat,base.lon]).addTo(RV2_LAYER).bindTooltip(RV2_PLAN.fixedEnd?'INÍCIO':(RV2_START?'Minha localização':'Base'));
    order.forEach((idx,pos)=>{const p=pts[idx];if(!p)return;const icon=L.divIcon({className:'',html:'<div style="background:#111827;color:white;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-weight:800;border:2px solid #fff;box-shadow:0 2px 6px #0005">'+(pos+1)+'</div>',iconSize:[30,30],iconAnchor:[15,15]});L.marker([p.lat,p.lon],{icon}).addTo(RV2_LAYER).bindPopup('<b>'+safe(p.destinatario||p.label||'Parada')+'</b><br>'+safe(p.endereco||p.cidade||''))});
    if(RV2_PLAN.fixedEnd&&Number.isInteger(RV2_PLAN.endIndex)){
      const p=pts[RV2_PLAN.endIndex];if(p)L.marker([p.lat,p.lon]).addTo(RV2_LAYER).bindTooltip('FIM • '+safe(p.label||'Destino final'));
    }
    const coords=(RV2_PLAN.geometry?.coordinates||[]).map(x=>[Number(x[1]),Number(x[0])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
    if(coords.length>1)L.polyline(coords,{weight:6,opacity:.9,lineCap:'round',lineJoin:'round'}).addTo(RV2_LAYER);
    const bounds=L.latLngBounds(coords.length?coords:[[base.lat,base.lon]]);if(bounds.isValid())RV2_MAP.fitBounds(bounds.pad(.12));
  }else if(RV2_STOPS.length||RV2_START){
    const coords=[];
    if(RV2_START){L.marker([RV2_START.lat,RV2_START.lon]).addTo(RV2_LAYER).bindTooltip('Minha localização');coords.push([RV2_START.lat,RV2_START.lon])}
    RV2_STOPS.filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lon))).forEach((p,pos)=>{L.marker([p.lat,p.lon]).addTo(RV2_LAYER).bindTooltip(String(pos+1));coords.push([p.lat,p.lon])});
    if(coords.length){const bounds=L.latLngBounds(coords);if(bounds.isValid())RV2_MAP.fitBounds(bounds.pad(.2))}
  }else RV2_MAP.setView([-22.74,-47.33],10);
  setTimeout(()=>RV2_MAP.invalidateSize(),80)
}
async function rv2AddAddress(rawText=''){
  const input=$('#rv2Address'),status=$('#rv2Status'),btn=$('#rv2Add'),raw=(rawText||input?.value||'').trim();
  if(!raw){if(status)status.textContent='Digite ou fale um endereço.';return}
  if(btn){btn.disabled=true;btn.textContent='Localizando…'}
  try{
    const r=await fetch('/api/roteirizador/endereco?endereco='+encodeURIComponent(raw),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Endereço não localizado.');
    RV2_STOPS.push(j.stop);RV2_PLAN=null;
    if(input)input.value='';
    rv2RenderList();await rv2RenderMap();
    if(status)status.textContent='Parada adicionada: '+(j.stop.label||j.stop.endereco||raw)+'.'
  }catch(e){if(status)status.textContent='Erro: '+e.message}
  finally{if(btn){btn.disabled=false;btn.textContent='Adicionar parada'}}
}
function rv2UseMyLocation(){
  const status=$('#rv2Status'),btn=$('#rv2MyLocation');
  if(!navigator.geolocation){if(status)status.textContent='Este aparelho não disponibiliza localização pelo navegador.';return}
  if(btn){btn.disabled=true;btn.textContent='📍 Localizando…'}
  if(status)status.textContent='Obtendo sua localização atual…';
  navigator.geolocation.getCurrentPosition(async p=>{
    RV2_START={lat:Number(p.coords.latitude),lon:Number(p.coords.longitude),label:'Minha localização atual'};RV2_ROUTE_START_KEY='';
    if(status)status.textContent='Origem definida pela sua localização atual.';
    if(btn){btn.disabled=false;btn.textContent='📍 Minha localização'}
    RV2_PLAN=null;await rv2RenderMap()
  },e=>{
    if(status)status.textContent='Não foi possível obter sua localização. Verifique a permissão de GPS.';
    if(btn){btn.disabled=false;btn.textContent='📍 Minha localização'}
  },{enableHighAccuracy:true,timeout:15000,maximumAge:30000})
}
async function rv2Optimize(stopsOverride=null){
  const status=$('#rv2Status'),btn=$('#rv2Optimize'),sourceStops=Array.isArray(stopsOverride)?stopsOverride:RV2_STOPS;
  if(sourceStops.length<2){if(status)status.textContent='Adicione pelo menos duas paradas para otimizar.';return}

  let startStop=null,endStop=null,middle=sourceStops.slice();
  if(!stopsOverride){
    startStop=RV2_ROUTE_START_KEY?sourceStops.find(s=>rv2StopKey(s)===RV2_ROUTE_START_KEY):null;
    endStop=RV2_ROUTE_END_KEY?sourceStops.find(s=>rv2StopKey(s)===RV2_ROUTE_END_KEY):null;

    // Sem GPS e sem marcação manual, a primeira parada vira início e a última vira fim.
    if(!RV2_START&&!startStop&&sourceStops.length>=2){
      startStop=sourceStops[0];RV2_ROUTE_START_KEY=rv2StopKey(startStop)
    }
    if(!endStop&&sourceStops.length>=2){
      endStop=sourceStops[sourceStops.length-1];
      if(startStop&&rv2StopKey(endStop)===rv2StopKey(startStop)&&sourceStops.length>1)endStop=sourceStops[sourceStops.length-2];
      RV2_ROUTE_END_KEY=rv2StopKey(endStop)
    }

    middle=sourceStops.filter(s=>(!startStop||rv2StopKey(s)!==rv2StopKey(startStop))&&(!endStop||rv2StopKey(s)!==rv2StopKey(endStop)))
  }

  const requestStart=RV2_START||(startStop?{...startStop,label:startStop.label||startStop.endereco||'Início'}:null);
  const requestEnd=endStop?{...endStop,label:endStop.label||endStop.endereco||'Fim'}:null;

  if(btn&&!stopsOverride){btn.disabled=true;btn.textContent='Otimizando…'}
  if(status)status.textContent=requestEnd?'Calculando rota do início ao destino final, sem retorno…':'Calculando a melhor sequência pelas vias reais…';

  try{
    const r=await fetch('/api/roteirizador/recalcular',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stops:middle,motorista:'Roteirizador V02',romaneio:'V02',start:requestStart,end:requestEnd})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível otimizar a rota.');
    RV2_PLAN=j;RV2_ORDER=(j.optimizedOrder||[]).slice();

    const optimizedMiddle=RV2_ORDER.map(i=>j.points?.[i]).filter(Boolean).map(p=>({...p,source:p.source||'manual'}));
    let optimizedStops=[];
    if(j.fixedEnd){
      const startObj=startStop||requestStart;
      const endObj=endStop||j.points?.[j.endIndex];
      optimizedStops=[...(startObj?[startObj]:[]),...optimizedMiddle,...(endObj?[endObj]:[])]
    }else optimizedStops=optimizedMiddle;

    if(stopsOverride){
      const completed=RV2_STOPS.filter(s=>RV2_DONE.includes(rv2StopKey(s))||RV2_SKIPPED.includes(rv2StopKey(s)));
      RV2_STOPS=[...completed,...optimizedStops]
    }else RV2_STOPS=optimizedStops;

    if($('#rv2Km'))$('#rv2Km').textContent=routeFmtKm(j.geometryDistanceMeters||j.optimizedDistanceMeters||0);
    if($('#rv2Time'))$('#rv2Time').textContent=rv2FmtTime(j.durationSeconds||0);
    if($('#rv2Method'))$('#rv2Method').textContent=j.fixedEnd?'PONTO A → B':'OTIMIZADA';
    if(status)status.textContent=j.fixedEnd?'Rota otimizada do ponto inicial ao destino final, sem voltar ao início.':'Rota otimizada. O traçado acompanha ruas e rodovias.';
    rv2RenderList();await rv2RenderMap()
  }catch(e){if(status)status.textContent='Erro: '+e.message}
  finally{if(btn&&!stopsOverride){btn.disabled=false;btn.textContent='Otimizar rota'}}
}
function rv2StartTrip(){
  const status=$('#rv2Status');
  if(RV2_STOPS.length<1){if(status)status.textContent='Adicione paradas antes de iniciar a rota.';return}
  RV2_RUNNING=true;RV2_DONE=[];RV2_SKIPPED=[];rv2RenderList();
  if(status)status.textContent='Rota iniciada. Use 🧭 para navegar até a próxima parada e ✓ ao concluir.'
}
function rv2Navigate(pos){
  const s=RV2_STOPS[pos];if(!s)return;
  const lat=Number(s.lat),lon=Number(s.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
  const url='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(lat+','+lon)+'&travelmode=driving';
  window.open(url,'_blank','noopener')
}
function rv2Complete(pos){
  const s=RV2_STOPS[pos];if(!s)return;const k=rv2StopKey(s);
  if(!RV2_DONE.includes(k))RV2_DONE.push(k);RV2_SKIPPED=RV2_SKIPPED.filter(x=>x!==k);
  rv2RenderList();
  const status=$('#rv2Status'),rem=rv2RemainingStops();
  if(status)status.textContent=rem.length?'Parada concluída. Próxima parada pronta.':'Todas as paradas foram concluídas.';
}
function rv2Skip(pos){
  const s=RV2_STOPS[pos];if(!s)return;const k=rv2StopKey(s);
  if(!RV2_SKIPPED.includes(k))RV2_SKIPPED.push(k);RV2_DONE=RV2_DONE.filter(x=>x!==k);
  rv2RenderList();
  const status=$('#rv2Status');if(status)status.textContent='Parada pulada. Você pode reotimizar o restante.'
}
async function rv2Reoptimize(){
  const remaining=rv2RemainingStops(),status=$('#rv2Status');
  if(remaining.length<2){if(status)status.textContent=remaining.length===1?'Resta apenas uma parada.':'Não há paradas suficientes para reotimizar.';return}
  if(status)status.textContent='Reotimizando somente as paradas restantes…';
  await rv2Optimize(remaining)
}
function rv2Voice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition,status=$('#rv2Status'),voice=$('#rv2Voice');
  if(!SR){if(status)status.textContent='Reconhecimento de voz não disponível neste navegador. No app Android V02 ele será nativo.';return}
  const rec=new SR();rec.lang='pt-BR';rec.interimResults=false;rec.maxAlternatives=1;
  if(voice){voice.disabled=true;voice.textContent='🎙️ Ouvindo…'};if(status)status.textContent='Fale o endereço completo.';
  rec.onresult=e=>{const txt=e.results?.[0]?.[0]?.transcript||'';const input=$('#rv2Address');if(input)input.value=txt;if(status)status.textContent='Ouvi: '+txt+'. Confira e toque em Adicionar parada.'};
  rec.onerror=e=>{if(status)status.textContent='Não consegui ouvir o endereço: '+(e.error||'erro de voz')};
  rec.onend=()=>{if(voice){voice.disabled=false;voice.textContent='🎙️ Falar'}};
  rec.start()
}

const RV2_STORAGE_KEY='construlog_rv2_saved_routes_v1';
function rv2SavedRead(){
  try{const x=JSON.parse(localStorage.getItem(RV2_STORAGE_KEY)||'[]');return Array.isArray(x)?x:[]}catch{return[]}
}
function rv2SavedWrite(rows){localStorage.setItem(RV2_STORAGE_KEY,JSON.stringify(rows.slice(0,50)))}
function rv2RouteName(){
  const el=$('#rv2RouteName'),v=String(el?.value||'').trim();
  if(v)return v;
  const d=new Date(),date=d.toLocaleDateString('pt-BR');
  return 'Rota '+date
}
function rv2RenderSaved(){
  const box=$('#rv2SavedRoutes');if(!box)return;
  const rows=rv2SavedRead();
  if(!rows.length){box.innerHTML='<div class="muted">Nenhuma rota salva ainda.</div>';return}
  box.innerHTML=rows.map((r,i)=>{
    const when=r.savedAt?new Date(r.savedAt).toLocaleString('pt-BR'):'';
    const count=Array.isArray(r.stops)?r.stops.length:0;
    return '<div class="route-stop"><div class="seq">💾</div><div><b>'+safe(r.name||'Rota sem nome')+'</b><div class="meta">'+nf(count)+' parada(s)'+(when?' • '+safe(when):'')+'</div></div><div class="move"><button type="button" data-rv2-open="'+i+'">Abrir</button><button type="button" data-rv2-share-saved="'+i+'">💬</button><button type="button" data-rv2-delete-saved="'+i+'">✕</button></div></div>'
  }).join('');
  box.querySelectorAll('[data-rv2-open]').forEach(b=>b.onclick=()=>rv2OpenSaved(Number(b.dataset.rv2Open)));
  box.querySelectorAll('[data-rv2-share-saved]').forEach(b=>b.onclick=()=>rv2ShareSaved(Number(b.dataset.rv2ShareSaved)));
  box.querySelectorAll('[data-rv2-delete-saved]').forEach(b=>b.onclick=()=>rv2DeleteSaved(Number(b.dataset.rv2DeleteSaved)))
}
function rv2CurrentSnapshot(){
  return{
    id:'r'+Date.now(),
    name:rv2RouteName(),
    savedAt:new Date().toISOString(),
    start:RV2_START?{...RV2_START}:null,
    routeStartKey:RV2_ROUTE_START_KEY,routeEndKey:RV2_ROUTE_END_KEY,
    stops:RV2_STOPS.map(s=>({...s})),
    running:RV2_RUNNING,
    done:[...RV2_DONE],
    skipped:[...RV2_SKIPPED]
  }
}
function rv2SaveRoute(){
  const status=$('#rv2Status');
  if(!RV2_STOPS.length){if(status)status.textContent='Adicione pelo menos uma parada antes de salvar.';return}
  const snap=rv2CurrentSnapshot(),rows=rv2SavedRead();
  rows.unshift(snap);rv2SavedWrite(rows);rv2RenderSaved();
  if(status)status.textContent='Rota “‘'+snap.name+'” salva neste aparelho.'
}
function rv2OpenSaved(i){
  const r=rv2SavedRead()[i],status=$('#rv2Status');if(!r)return;
  RV2_START=r.start||null;RV2_ROUTE_START_KEY=r.routeStartKey||'';RV2_ROUTE_END_KEY=r.routeEndKey||'';RV2_STOPS=(r.stops||[]).map(x=>({...x}));RV2_PLAN=null;RV2_ORDER=[];RV2_RUNNING=!!r.running;RV2_DONE=Array.isArray(r.done)?r.done.slice():[];RV2_SKIPPED=Array.isArray(r.skipped)?r.skipped.slice():[];
  const name=$('#rv2RouteName');if(name)name.value=r.name||'';
  rv2RenderList();rv2RenderMap();
  if(status)status.textContent='Rota salva carregada. Toque em Otimizar rota para recalcular pelas vias atuais.'
}
function rv2DeleteSaved(i){
  const rows=rv2SavedRead();if(!rows[i])return;
  rows.splice(i,1);rv2SavedWrite(rows);rv2RenderSaved()
}
function rv2NewRoute(){
  rv2Clear();const name=$('#rv2RouteName');if(name)name.value='';const st=$('#rv2Status');if(st)st.textContent='Nova rota. Digite ou fale o primeiro endereço.'
}
function rv2ShareText(snapshot=rv2CurrentSnapshot()){
  const lines=[snapshot.name||'Minha rota',''];
  (snapshot.stops||[]).forEach((s,i)=>lines.push((i+1)+'. '+(s.label||s.endereco||'Parada')+((s.cidade)?' • '+s.cidade:'') ));
  lines.push('','Criado no Roteirizador V02');
  return lines.join('\n')
}
async function rv2Share(){
  const status=$('#rv2Status');
  if(!RV2_STOPS.length){if(status)status.textContent='Adicione pelo menos uma parada antes de compartilhar.';return}
  const text=rv2ShareText();
  if(navigator.share){
    try{await navigator.share({title:rv2RouteName(),text});return}catch(e){if(e?.name==='AbortError')return}
  }
  window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener')
}
async function rv2ShareSaved(i){
  const r=rv2SavedRead()[i];if(!r)return;
  const text=rv2ShareText(r);
  if(navigator.share){try{await navigator.share({title:r.name||'Rota',text});return}catch(e){if(e?.name==='AbortError')return}}
  window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener')
}
function setupRoteirizadorV02(){
  if($('#rv2Add'))$('#rv2Add').onclick=()=>rv2AddAddress();
  if($('#rv2Address'))$('#rv2Address').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();rv2AddAddress()}};
  if($('#rv2Voice'))$('#rv2Voice').onclick=rv2Voice;
  if($('#rv2MyLocation'))$('#rv2MyLocation').onclick=rv2UseMyLocation;
  if($('#rv2Optimize'))$('#rv2Optimize').onclick=()=>rv2Optimize();
  if($('#rv2Start'))$('#rv2Start').onclick=rv2StartTrip;
  if($('#rv2Reoptimize'))$('#rv2Reoptimize').onclick=rv2Reoptimize;
  if($('#rv2Clear'))$('#rv2Clear').onclick=rv2Clear;
  if($('#rv2Save'))$('#rv2Save').onclick=rv2SaveRoute;
  if($('#rv2Share'))$('#rv2Share').onclick=rv2Share;
  if($('#rv2New'))$('#rv2New').onclick=rv2NewRoute;
  rv2RenderList();
  rv2RenderSaved()
}

function setupRoteirizadorTeste(){
  const d=$('#rtDate');if(d&&!d.value)d.value=iso(new Date());
  if(d)d.onchange=()=>{RT_PLAN=null;RT_ORDER=[];rtLoadManifests(true)};
  if($('#rtDriver'))$('#rtDriver').onchange=rtPopulateManifest;
  if($('#rtLoad'))$('#rtLoad').onclick=()=>rtLoadManifests(true);
  if($('#rtOptimize'))$('#rtOptimize').onclick=rtOptimize
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
  if(tab==='lotacao'){setTimeout(()=>refreshLotacao(),30);return}
  if(tab==='dashboard'){
    if(hasAnyPerm(['dashboard','agendamentos','agendamentos_copia']))setTimeout(()=>refreshAgCopy(false),80);
    if(hasPerm('final_carregamento'))setTimeout(()=>refreshLoadingRecords(false),140);
  }else if(tab==='dashboards'){
    if(hasAnyPerm(['ssw_saidas','evolucao','cidade_destino']))setTimeout(()=>refreshSswMotoristas(),100);
    if(hasPerm('evolucao'))setTimeout(()=>refreshDriverProgress(),180);
    if(hasPerm('ssw_atrasos'))setTimeout(()=>refreshSswAtrasos(),450);
    if(hasPerm('receita_ssw'))setTimeout(()=>refreshSswReceita(),700);
    if(hasAnyPerm(['remetentes','remetentes_comparativo']))setTimeout(()=>refreshSswRemetentes(),1000);
    if(hasPerm('final_carregamento'))setTimeout(()=>refreshLoadingRecords(false),1250);
    if(hasAnyPerm(['dashboard','agendamentos','agendamentos_copia']))setTimeout(()=>refreshAgCopy(false),1450);
  }else if(tab==='conferencia'&&hasPerm('final_carregamento')){
    loadingDriverOptions();
    setTimeout(()=>refreshLoadingRecords(true),50);
  }else if(tab==='programacao'&&hasAnyPerm(['programacao','roteirizador','dashboard','ssw_saidas'])){
    setTimeout(()=>refreshDeliveryProgram(false),60);
  }else if(tab==='rastreamento'&&hasPerm('tracking')){
    setTimeout(()=>refreshTracking(),60);
    setTimeout(()=>trackingHistoryLoadDrivers(true),120);
  }else if(tab==='agendamentos-copia'&&hasAnyPerm(['dashboard','agendamentos','agendamentos_copia'])){
    renderAgCopy();
    setTimeout(()=>refreshAgCopy(true),50);
  }else if(tab==='roteirizador-v02'&&hasPerm('roteirizador')){
    setTimeout(()=>{rv2RenderList();rv2RenderMap()},50);
  }else if(tab==='roteirizador-teste'&&hasPerm('roteirizador')){
    setTimeout(()=>rtLoadManifests(false),50);
  }else if(tab==='roteirizador'&&hasPerm('roteirizador')){
    setTimeout(()=>loadRouteManifests(false),50);
  }else if(tab==='motoristas-evolucao'&&tabAllowed(tab)){
    setTimeout(()=>refreshDriverProgress(),50);
    setTimeout(()=>refreshSswMotoristas(),450);
  }else if(tab==='ssw-motoristas'&&tabAllowed(tab)){
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
  setupFinanceDashboard();
  setupDriverPerformanceDashboard();
  setupCheckerValueReport();
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
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&hasPerm('evolucao')&&['motoristas-evolucao','dashboards'].includes(t))refreshDriverProgress()},120000);
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&hasPerm('cidade_destino')&&['mapa-cidades','dashboards'].includes(t))refreshCityBubbles()},60000);
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&t==='rastreamento')refreshTrackingRequests().catch(()=>{})},30000);
  setInterval(trackingAutoTick,1000);
  window.addEventListener('focus',()=>refreshData(false));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshData(false)})
}
let AGT_CURRENT=null;
function agtVal(id,v){const e=$(id);if(e)e.value=v??''}
function agtReset(){
  AGT_CURRENT=null;
  agtVal('#agtNf','');['#agtF_Nf','#agtF_Ctrc','#agtF_Cliente','#agtF_Cidade','#agtF_Uf','#agtF_Rota','#agtF_Status','#agtF_Mercadoria','#agtF_Peso','#agtF_Volumes','#agtF_Previsao','#agtF_Data'].forEach(id=>agtVal(id,''));
  if($('#agtF_Agendado'))$('#agtF_Agendado').value='nao';
  if($('#agtF_Data'))$('#agtF_Data').disabled=true;
  if($('#agtForm'))$('#agtForm').style.display='none';
  if($('#agtMsg'))$('#agtMsg').textContent='Informe uma nota fiscal para começar.'
}
async function agtBuscar(){
  const nf=String($('#agtNf')?.value||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');
  const msg=$('#agtMsg'),btn=$('#agtBuscar');
  if(!nf){if(msg)msg.textContent='Informe o número da nota fiscal.';return}
  if(btn){btn.disabled=true;btn.textContent='Buscando…'};if(msg)msg.textContent='Consultando nota no SSW…';
  try{
    const r=await fetch('/api/agendamento-teste/nf?nf='+encodeURIComponent(nf)+'&t='+Date.now(),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Nota não localizada.');
    AGT_CURRENT=j.row;
    agtVal('#agtF_Nf',j.row.nf);agtVal('#agtF_Ctrc',j.row.ctrc);agtVal('#agtF_Cliente',j.row.cliente);agtVal('#agtF_Cidade',j.row.cidade);agtVal('#agtF_Uf',j.row.uf);
    agtVal('#agtF_Rota',j.row.dia_rota);agtVal('#agtF_Status',j.row.status_ssw);agtVal('#agtF_Mercadoria',j.row.mercadoria);agtVal('#agtF_Peso',Number(j.row.peso||0).toLocaleString('pt-BR',{maximumFractionDigits:3}));
    agtVal('#agtF_Volumes',Number(j.row.volumes||0).toLocaleString('pt-BR',{maximumFractionDigits:0}));agtVal('#agtF_Previsao',j.row.previsao_ssw);
    if($('#agtF_Agendado'))$('#agtF_Agendado').value='nao';if($('#agtF_Data')){$('#agtF_Data').value='';$('#agtF_Data').disabled=true}
    if($('#agtForm'))$('#agtForm').style.display='block';
    if(msg)msg.textContent='✓ Dados preenchidos pelo SSW. O operador precisa informar apenas se houve agendamento e a data.';
  }catch(e){
    AGT_CURRENT=null;if($('#agtForm'))$('#agtForm').style.display='none';if(msg)msg.textContent='Erro: '+e.message
  }finally{if(btn){btn.disabled=false;btn.textContent='Buscar no SSW'}}
}
async function agtSalvar(e){
  e?.preventDefault();if(!AGT_CURRENT)return;
  const agendado=$('#agtF_Agendado')?.value==='sim',data=$('#agtF_Data')?.value||'',msg=$('#agtMsg'),btn=$('#agtSalvar');
  if(agendado&&!data){if(msg)msg.textContent='Informe a data do agendamento.';return}
  if(btn){btn.disabled=true;btn.textContent='Salvando…'}
  try{
    const body={...AGT_CURRENT,agendado,data_agendamento:agendado?data:null};
    const r=await fetch('/api/agendamento-teste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível salvar.');
    if(msg)msg.textContent='✓ Registro salvo no ambiente de teste.';
    await agtLista();
  }catch(e){if(msg)msg.textContent='Erro ao salvar: '+e.message}
  finally{if(btn){btn.disabled=false;btn.textContent='Salvar teste'}}
}
async function agtLista(){
  const table=$('#agtTabela');if(!table)return;
  try{
    const r=await fetch('/api/agendamento-teste?limit=100&t='+Date.now(),{cache:'no-store'}),j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao carregar.');
    const rows=j.rows||[];
    const body=rows.length?rows.map(x=>'<tr><td><b>'+safe(x.nf||'')+'</b></td><td>'+safe(x.cliente||'')+'</td><td>'+safe(x.cidade||'')+'</td><td>'+safe(x.dia_rota||'')+'</td><td>'+safe(x.status_ssw||'')+'</td><td>'+programFmtNumber(Number(x.peso||0),0)+' kg</td><td>'+(x.agendado?'SIM':'NÃO')+'</td><td>'+safe(x.data_agendamento?String(x.data_agendamento).slice(0,10).split('-').reverse().join('/'):'—')+'</td></tr>').join(''):'<tr><td colspan="8" class="muted">Nenhum registro de teste salvo.</td></tr>';
    table.innerHTML='<thead><tr><th>NF</th><th>Cliente</th><th>Cidade</th><th>Dia rota</th><th>Status SSW</th><th>Peso</th><th>Agendado</th><th>Data</th></tr></thead><tbody>'+body+'</tbody>'
  }catch(e){table.innerHTML='<tbody><tr><td class="muted">Erro: '+safe(e.message)+'</td></tr></tbody>'}
}
function setupAgendamentoTeste(){
  if($('#agtBuscar'))$('#agtBuscar').onclick=agtBuscar;
  if($('#agtNf'))$('#agtNf').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();agtBuscar()}};
  if($('#agtF_Agendado'))$('#agtF_Agendado').onchange=()=>{const yes=$('#agtF_Agendado').value==='sim';$('#agtF_Data').disabled=!yes;if(!yes)$('#agtF_Data').value=''};
  if($('#agtForm'))$('#agtForm').onsubmit=agtSalvar;
  if($('#agtNovo'))$('#agtNovo').onclick=agtReset;
  if($('#agtAtualizar'))$('#agtAtualizar').onclick=agtLista;
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
    'conferencia':'Registro de Carga e Descarga',
    'programacao':'Programação de Entregas',
    'rastreamento':'Rastreio de Carga',
    'lotacao':'Lotação',
    'frota':'Frota',
    'roteirizador':'Roteirizador SSW',
    'agendamentos-copia':'Consulta de Agendamentos','agendamento-teste':'Agendamento Teste',
    'usuarios':'Usuários e Acessos',
    'mapa-cidades':'Mapa de Cidades • SSW'
  };
  $('#pageTitle').textContent=titles[tab]||'Dashboards';
  if(tab==='receita-ssw')setTimeout(renderSswReceita,30);
  if(tab==='ssw-atrasos')setTimeout(renderSswAtrasos,30);
  if(tab==='ssw-remetentes'||tab==='ssw-remetentes-comparativo')setTimeout(renderRemetentes,30);
  if(tab==='ssw-motoristas')setTimeout(renderSswMotoristas,30);
  if(tab==='motoristas-evolucao'){setTimeout(renderDriverProgress,30);setTimeout(refreshDriverProgress,60)}
  if(tab==='mapa-cidades'){cityBubbleSetDefaults();setTimeout(refreshCityBubbles,40)}
  loadHeavyForTab(tab);
}
$$('.dash-open').forEach(b=>b.onclick=()=>{if(tabAllowed(b.dataset.open))openTab(b.dataset.open)});
if($('#cityBubbleApply'))$('#cityBubbleApply').onclick=()=>refreshCityBubbles(true);
['#cityBubbleMetric','#cityBubbleTop'].forEach(id=>{const e=$(id);if(e)e.onchange=renderCityBubbleMap});

if($('#lotacaoRefresh'))$('#lotacaoRefresh').onclick=()=>refreshLotacao();
if($('#lotacaoSearch'))$('#lotacaoSearch').oninput=()=>renderLotacao();
setupAgendamentoTeste();
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
      refreshDriverProgress();
      cityBubbleSetDefaults();
      refreshCityBubbles();
    }
    if(b.dataset.tab==='motoristas-evolucao')refreshDriverProgress();
    if(b.dataset.tab==='agendamento-teste')agtLista();
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


/* PDF • Separador de Notas */
function pdfNotasParseWeight(txt){
  const s=String(txt||'').replace(/\s+/g,' ');
  const m=s.match(/PESO\s*BRUTO\s*([0-9.]+,[0-9]{2,3}|[0-9]+(?:[.,][0-9]+)?)/i);
  if(!m)return null;
  const v=Number(m[1].replace(/\./g,'').replace(',','.'));
  return Number.isFinite(v)?v:null;
}
function pdfNotasNfe(txt){
  const s=String(txt||'').replace(/\s+/g,' ');
  const m=s.match(/N[º°]?\s*[:\-]?\s*(\d{1,3}(?:\.\d{3}){1,3})/i);
  return m?m[1]:'';
}
function pdfNotasPesoBruto(txt){
  const raw=String(txt||'').replace(/\s+/g,' ');
  const toNum=v=>{
    const s=String(v||'').trim();
    const normalized=s.includes(',')?s.replace(/\./g,'').replace(',','.'):(/\.\d{3}$/.test(s)?s:s.replace(/,/g,''));
    const n=Number(normalized);
    return Number.isFinite(n)?n:null
  };

  // Regra principal: no DANFE, o bloco QUANTIDADE/ESPÉCIE/MARCA/NUMERAÇÃO
  // termina com PESO BRUTO e PESO LÍQUIDO. Pegamos os dois últimos valores
  // decimais antes de DADOS DOS PRODUTOS e usamos o primeiro deles (bruto).
  const start=raw.search(/QUANTIDADE\s+ESP[EÉ]CIE/i);
  const end=raw.search(/DADOS\s+DOS\s+PRODUTOS|DADOS\s+DO\s+PRODUTO/i);
  if(start>=0&&end>start){
    const seg=raw.slice(start,end);
    const vals=[...seg.matchAll(/\b(\d{1,3}(?:\.\d{3})*,\d{2,3}|\d+,\d{2,3}|\d+\.\d{2,3})\b/g)]
      .map(m=>toNum(m[1])).filter(v=>v!==null);
    if(vals.length>=2)return vals[vals.length-2];
    if(vals.length===1)return vals[0];
  }

  // Fallback para layouts em que o valor vem logo após o rótulo.
  const direct=raw.match(/PESO\s*BRUTO\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})*,\d{2,3}|\d+,\d{2,3}|\d+\.\d{2,3})/i);
  if(direct)return toNum(direct[1]);

  return null
}
async function setupPdfNotas(){
  const input=document.querySelector('#pdfNotasFile');
  if(!input||input.dataset.ready==='1')return;
  input.dataset.ready='1';
  const info=document.querySelector('#pdfNotasInfo');
  const tbody=document.querySelector('#pdfNotasBody');
  const stat=document.querySelector('#pdfNotasStats');
  const downloads=document.querySelector('#pdfNotasDownloads');
  let sources=[],pages=[],downloadUrls=[];
  const setInfo=t=>{if(info)info.textContent=t};
  const normTxt=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toUpperCase().trim();
  const hasTube=txt=>/\bTUBO(?:S)?\b/.test(normTxt(txt));
  const parseNfe=txt=>{const s=String(txt||'').replace(/\s+/g,' ');for(const re of [/NF-?E\s*(?:N[º°O.]*)?\s*[:\-]?\s*(\d{1,3}(?:\.\d{3}){1,3}|\d{5,12})/i,/N[º°]\s*[:\-]?\s*(\d{1,3}(?:\.\d{3}){1,3}|\d{5,12})/i]){const m=s.match(re);if(m)return m[1]}return''};
  const parseCity=txt=>{
    const s=String(txt||'').replace(/\s+/g,' ');
    const m=s.match(/MUNIC[IÍ]PIO\s+([A-ZÀ-Ý0-9 .'-]+?)\s+(?:FONE\s*\/\s*FAX|UF\b|INSCRI[CÇ][AÃ]O\s+ESTADUAL|HORA\s+SA[IÍ]DA)/i);
    if(m)return m[1].trim();
    const n=s.match(/DESTINAT[AÁ]RIO\s*\/\s*REMETENTE[\s\S]{0,500}?MUNIC[IÍ]PIO\s+([A-ZÀ-Ý0-9 .'-]{2,80})/i);
    return n?n[1].trim():'SEM CIDADE';
  };
  const render=()=>{
    const notes=pages.filter(p=>p.isNote),withTube=notes.filter(p=>p.hasTube),withoutTube=notes.filter(p=>!p.hasTube);
    const cities=new Set(notes.map(p=>p.city).filter(Boolean));
    if(stat)stat.innerHTML='<b>'+notes.length+'</b> nota(s) fiscal(is) • <b>'+withTube.length+'</b> com TUBO • <b>'+withoutTube.length+'</b> sem TUBO • <b>'+cities.size+'</b> cidade(s)';
    if(tbody)tbody.innerHTML=notes.length?notes.map(p=>'<tr><td>'+safe(p.fileName)+'</td><td>'+p.page+'</td><td>'+safe(p.nfe||'—')+'</td><td>'+safe(p.city||'—')+'</td><td>'+(p.hasTube?'Sim':'Não')+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">Nenhuma nota fiscal identificada.</td></tr>';
  };
  const clearDownloads=()=>{downloadUrls.forEach(u=>URL.revokeObjectURL(u));downloadUrls=[];if(downloads){downloads.innerHTML='';downloads.style.display='none'}};
  async function analyze(files){
    if(!window.pdfjsLib)throw new Error('Leitor de PDF não carregou.');
    clearDownloads();sources=[];pages=[];
    for(let fi=0;fi<files.length;fi++){
      const file=files[fi],bytes=new Uint8Array(await file.arrayBuffer()),pdf=await window.pdfjsLib.getDocument({data:bytes.slice()}).promise;
      sources.push({name:file.name,bytes,numPages:pdf.numPages});
      for(let n=1;n<=pdf.numPages;n++){
        setInfo('Lendo '+file.name+' • página '+n+' de '+pdf.numPages+'…');
        const page=await pdf.getPage(n),tc=await page.getTextContent(),txt=tc.items.map(x=>x.str).join(' ').replace(/\s+/g,' ').trim(),s=normTxt(txt);
        const isNote=/NOTA\s+FISCAL/.test(s)||/DANFE/.test(s)||/NF-?E/.test(s);
        pages.push({sourceIndex:fi,fileName:file.name,page:n,text:txt,isNote,hasTube:hasTube(txt),nfe:parseNfe(txt),city:parseCity(txt)})
      }
    }
    render();setInfo('Análise concluída. Escolha como deseja ordenar o PDF.');
  }
  input.addEventListener('change',async()=>{
    const files=[...(input.files||[])].filter(f=>/\.pdf$/i.test(f.name)||f.type==='application/pdf');
    if(!files.length)return;
    try{setInfo('Abrindo '+files.length+' PDF(s)…');await analyze(files)}catch(e){setInfo('Erro: '+(e.message||e))}
  });
  async function buildPdf(selected,name,sorter){
    if(!selected.length)return null;
    const out=await window.PDFLib.PDFDocument.create();
    const ordered=[...selected].sort(sorter);
    for(const p of ordered){
      const src=await window.PDFLib.PDFDocument.load(sources[p.sourceIndex].bytes.slice());
      const [copied]=await out.copyPages(src,[p.page-1]);
      out.addPage(copied);
    }
    return{name,bytes:await out.save(),count:selected.length}
  }
  function makeDownloadLink(item,label){
    if(!item)return '';
    const blob=new Blob([item.bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob);
    downloadUrls.push(url);
    return '<a class="primary" style="display:inline-block;text-decoration:none;margin:4px 8px 4px 0" href="'+url+'" download="'+safe(item.name)+'">'+safe(label)+' • '+nf(item.count)+' nota(s)</a>';
  }
  async function ensureAnalyzed(){
    const currentFiles=[...(input.files||[])].filter(f=>/\.pdf$/i.test(f.name)||f.type==='application/pdf');
    if(!currentFiles.length)throw new Error('Selecione os PDFs dos e-mails primeiro.');
    if(!window.PDFLib)throw new Error('Gerador de PDF não carregou.');
    await analyze(currentFiles);
    const notes=pages.filter(p=>p.isNote);
    if(!notes.length)throw new Error('Nenhuma nota fiscal foi identificada nos PDFs selecionados.');
    return notes;
  }
  async function generateByTube(){
    try{
      const notes=await ensureAnalyzed();
      const withTube=notes.filter(p=>p.hasTube).length,withoutTube=notes.length-withTube;
      setInfo('Ordenando o PDF: notas com tubos primeiro e notas sem tubos depois…');
      clearDownloads();
      const output=await buildPdf(notes,'notas_por_tubos.pdf',(a,b)=>Number(b.hasTube)-Number(a.hasTube)||a.sourceIndex-b.sourceIndex||a.page-b.page);
      if(downloads){downloads.style.display='block';downloads.innerHTML='<div style="font-weight:700;margin-bottom:6px">PDF por tubos pronto:</div>'+makeDownloadLink(output,'Baixar Notas por Tubos')}
      setInfo('Ordenação por tubos concluída: '+withTube+' com tubos primeiro • '+withoutTube+' sem tubos depois.');
    }catch(e){setInfo('Erro: '+(e.message||e))}
  }
  async function generateByCity(){
    try{
      const notes=await ensureAnalyzed();
      setInfo('Agrupando as notas por cidade destino…');
      clearDownloads();
      const output=await buildPdf(notes,'notas_por_cidade.pdf',(a,b)=>{
        const ca=normTxt(a.city||'SEM CIDADE'),cb=normTxt(b.city||'SEM CIDADE');
        return ca.localeCompare(cb,'pt-BR')||a.sourceIndex-b.sourceIndex||a.page-b.page
      });
      const cityCount=new Set(notes.map(p=>normTxt(p.city||'SEM CIDADE'))).size;
      if(downloads){downloads.style.display='block';downloads.innerHTML='<div style="font-weight:700;margin-bottom:6px">PDF por cidade pronto:</div>'+makeDownloadLink(output,'Baixar Notas por Cidade')}
      setInfo('Agrupamento por cidade concluído: '+cityCount+' cidade(s). Notas da mesma cidade ficaram juntas.');
    }catch(e){setInfo('Erro: '+(e.message||e))}
  }
  const tubeBtn=document.querySelector('#pdfNotasMerge3');
  const cityBtn=document.querySelector('#pdfNotasByCity');
  if(tubeBtn)tubeBtn.addEventListener('click',generateByTube);
  if(cityBtn)cityBtn.addEventListener('click',generateByCity);
}
document.addEventListener('DOMContentLoaded',()=>setupPdfNotas());
