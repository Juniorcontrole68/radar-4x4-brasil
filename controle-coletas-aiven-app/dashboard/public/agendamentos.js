// Agendamento de entregas: central das notas pendentes no SSW (com e sem agendamento), coletas programadas e histórico.
// O usuário digita só a NF, a data e a observação; o resto vem do SSW. A varredura das 02h00 (e o botão manual)
// tira das listas as notas entregues ou devolvidas, sem apagar nada.
// Servidor: agendamento.js (/api/painel/agendamentos*) e dashboard/server.js (/api/agendamentos/nf, leitura do SSW).
(()=>{
const q=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const kg=v=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
const nfmt=v=>Number(v||0).toLocaleString('pt-BR');
const br=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'';
const dh=v=>{if(!v)return'';const d=new Date(v);return isNaN(d)?'':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})};
const ROT={pendente:'Pendente',em_rota:'Em rota',verificar:'Verificação necessária',entregue:'Entregue',devolvida:'Devolvida'};
const PER=50;
let pronto=false,aba='agendadas',card='',page=1,painel=null,atual=null,timerSync=null,ultimaLista=null;

async function api(url,opts){
  const o=Object.assign({cache:'no-store',credentials:'same-origin'},opts||{});
  if(o.body&&typeof o.body!=='string'){o.headers={'Content-Type':'application/json'};o.body=JSON.stringify(o.body)}
  const r=await fetch(url,o);const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false){const e=new Error(j.error||('Não consegui falar com o sistema (erro '+r.status+').'));e.status=r.status;e.json=j;throw e}
  return j
}
function msg(t,tipo=''){const e=q('#agMsg');e.textContent=t;e.className='ag-msg'+(tipo?' '+tipo:'')}
const st=s=>'<span class="ag-st '+esc(s)+'">'+esc(ROT[s]||s||'—')+'</span>';

// ------------------------------------------------------------------ painel: sincronização e indicadores
async function carregarPainel(){
  try{painel=await api('/api/painel/agendamentos/painel')}catch(e){q('#agSyncInfo').textContent=e.message;return}
  const ind=painel.indicadores,s=ind.sync||{},ok=s.ultimaOk,ul=s.ultima;
  q('#agCfgBtn').style.display=painel.pode_configurar?'':'none';
  let info=ok?'Última sincronização válida com o SSW: <b>'+esc(dh(ok.finalizado_em||ok.iniciado_em))+'</b> ('+esc(ok.origem==='automatica'?'automática':'manual'+(ok.usuario?' por '+ok.usuario:''))+') • '+nfmt(ok.pendentes_ssw)+' notas pendentes no SSW':'Ainda não houve sincronização com o SSW.';
  info+=' • varredura automática às <b>'+esc(painel.config.hora_sync)+'</b>'+(painel.config.sync_ativa?'':' (desligada)');
  if(ind.rodando)info+=' • <b>sincronizando agora…</b> (pode continuar usando a tela)';
  q('#agSyncInfo').innerHTML=info;
  const btn=q('#agSyncBtn');btn.disabled=!!ind.rodando;btn.textContent=ind.rodando?'⏳ Sincronizando…':'🔄 Sincronizar SSW agora';
  const al=q('#agAlerta');
  if(ul&&ul.status==='erro'){al.className='ag-alerta';al.style.display='block';al.textContent='A última sincronização com o SSW falhou ('+dh(ul.iniciado_em)+'): '+(ul.erro||'erro')+'. As listas mostram o último estado válido; nenhuma nota foi retirada. Tente "Sincronizar SSW agora".'}
  else if(ind.desatualizado&&ok){al.className='ag-alerta aviso';al.style.display='block';al.textContent='Os dados estão desatualizados: a última sincronização válida foi há '+Math.round(ind.idade_horas)+' horas.'}
  else if(!ok){al.className='ag-alerta aviso';al.style.display='block';al.textContent='Os indicadores e a lista "Sem Agendamento" aparecem depois da primeira sincronização com o SSW. Clique em "Sincronizar SSW agora".'}
  else al.style.display='none';
  const C=[['pendentes','Entregas pendentes',ind.pendentes,'sem_filtro'],['com','Com agendamento',ind.com_agendamento,'agendadas'],['sem','Sem agendamento',ind.sem_agendamento,'sem'],
    ['hoje','Agendadas hoje',ind.hoje,'hoje'],['amanha','Agendadas amanhã',ind.amanha,'amanha'],['entregues','Entregues na última sinc.',ind.entregues_ultima,'entregue'],
    ['devolvidas','Devolvidas na última sinc.',ind.devolvidas_ultima,'devolvida'],['peso','Peso pendente (kg)',kg(ind.peso_pendente),'sem_filtro']];
  q('#agCards').innerHTML=C.map(([k,t,v,a])=>'<button type="button" class="ag-card'+(ind.desatualizado?' velho':'')+(card===k?' sel':'')+'" data-card="'+k+'" data-alvo="'+a+'" title="'+(ind.desatualizado?'Dados da última sincronização válida (desatualizados)':'Clique para filtrar')+'"><span>'+esc(t)+'</span><b>'+esc(typeof v==='number'?nfmt(v):v)+'</b></button>').join('');
  q('#agNAg').textContent='('+nfmt(ind.com_agendamento)+')';q('#agNSem').textContent='('+nfmt(ind.sem_agendamento)+')';
  ajustarAltura();
  clearTimeout(timerSync);
  if(ind.rodando)timerSync=setTimeout(async()=>{await carregarPainel();if(!painel.indicadores.rodando)carregarLista()},5000);
}
function clicarCard(b){
  const k=b.dataset.card,a=b.dataset.alvo;
  limparFiltros(false);card=k;
  if(a==='sem_filtro')aba='pendentes';
  else if(a==='agendadas'||a==='sem')aba=a;
  else if(a==='hoje'||a==='amanha')aba='agendadas';
  else if(a==='entregue'||a==='devolvida'){aba='historico';q('#agFSt').value=a;const u=painel?.indicadores?.sync?.ultimaOk;if(u){const d=new Date(u.iniciado_em).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});q('#agFDe').value=d;q('#agFAte').value=d}}
  marcarAba();page=1;carregarLista();carregarPainel()
}
async function atualizarBaixas(){
  const b=q('#agBaixasBtn');b.disabled=true;
  try{const j=await api('/api/painel/agendamentos/baixas',{method:'POST'});msg(j.entregues?j.entregues+' nota(s) baixada(s) como entregue pelo app dos motoristas.':'Nenhuma baixa nova dos motoristas.','ok');carregarLista();carregarPainel()}
  catch(e){msg(e.message,'err')}
  b.disabled=false
}
// Importa uma faixa de CT-es / subcontratos do SSW: as notas entram em "Sem Agendamento" para agendar depois.
async function importarFaixa(e){
  e.preventDefault();
  const de=q('#agImpDe').value.trim(),ate=q('#agImpAte').value.trim()||de;
  if(!de){msg('Informe o CT-e inicial (com o dígito).','err');q('#agImpDe').focus();return}
  const b=q('#agImpBtn');b.disabled=true;
  try{
    const ini=await api('/api/painel/agendamentos/importar',{method:'POST',body:{de,ate}});
    msg('Lendo os CT-es no SSW, um por vez: 0 de '+ini.total+'…');
    let st;
    for(;;){
      await new Promise(r=>setTimeout(r,3000));
      st=await api('/api/painel/agendamentos/importar/'+ini.id);
      if(st.status!=='rodando')break;
      msg('Lendo os CT-es no SSW, um por vez: '+st.lidos+' de '+st.total+(st.resultado?' • '+st.resultado.novas+' importada(s) até agora':'')+'…');
    }
    if(st.status==='erro')throw new Error('Importação parou: '+st.erro+(st.resultado?' ('+st.resultado.novas+' nota(s) já importada(s))':''));
    const j=st.resultado;
    const p=[j.novas+' nota(s) importada(s)'];
    if(j.ja_existiam)p.push(j.ja_existiam+' já estavam no agendamento');
    if(j.finalizados.length)p.push(j.finalizados.length+' já entregue(s)/devolvida(s): '+j.finalizados.slice(0,5).join(', '));
    if(j.fora_parceiros.length)p.push(j.fora_parceiros.length+' de outros clientes (fora dos parceiros)');
    if(j.nao_encontrados.length)p.push(j.nao_encontrados.length+' não encontrado(s) no SSW: '+j.nao_encontrados.slice(0,5).join(', '));
    if(j.erros.length)p.push(j.erros.length+' com erro de leitura (tente de novo)');
    msg(p.join(' • ')+'.',j.novas||j.ja_existiam?'ok':'err');
    aba='sem';card='';page=1;marcarAba();carregarLista();carregarPainel()
  }catch(err){msg(err.message,'err')}
  b.disabled=false
}
async function sincronizar(){
  const b=q('#agSyncBtn');b.disabled=true;
  try{await api('/api/painel/agendamentos/sincronizar',{method:'POST'});msg('Sincronização com o SSW iniciada. A tela continua liberada; as listas se atualizam ao terminar.','ok')}
  catch(e){msg(e.message,'err')}
  carregarPainel()
}

// ------------------------------------------------------------------ formulário: NF + data + observação
function preencher(r){
  atual=r;
  q('#agRem').value=r?.remetente||'';q('#agDest').value=r?.destinatario||'';
  q('#agCid').value=r?[r.cidade,r.uf].filter(Boolean).join('/'):'';q('#agPeso').value=r&&r.peso?kg(r.peso):'';
  q('#agProd').value=r&&r.produto_fonte==='operador'?r.produto||'':'';q('#agCte').value=r?.ctrc||'';
  q('#agRem').title=r?.endereco?'Entrega: '+r.endereco:'';q('#agDest').title=r?.endereco?'Entrega: '+r.endereco:'';
  q('#agSalvar').disabled=!r;
}
function limparForm(){preencher(null);q('#agNf').value='';q('#agData').value='';q('#agObs').value='';q('#agOpcoes').style.display='none';q('#agOpcoes').innerHTML='';msg('Digite a NF e pressione Enter: os dados vêm do SSW.');q('#agNf').focus()}
function escolher(lista,origem){
  const box=q('#agOpcoes');box.style.display='block';
  box.innerHTML='<div style="font-weight:700;margin-bottom:3px">Há '+lista.length+' notas com este número. Escolha a correta:</div><table><thead><tr><th>CT-e</th><th>Remetente</th><th>Destinatário</th><th>Cidade</th><th>Situação</th><th></th></tr></thead><tbody>'+
    lista.map((r,i)=>'<tr><td>'+esc(r.ctrc||'—')+'</td><td>'+esc(r.remetente)+'</td><td>'+esc(r.destinatario)+'</td><td>'+esc([r.cidade,r.uf].filter(Boolean).join('/'))+'</td><td>'+(r.situacao?st(r.situacao):esc(r.status_ssw||''))+'</td><td><button type="button" class="ag-mini primary" data-op="'+i+'">Usar esta</button></td></tr>').join('')+'</tbody></table>';
  box.onclick=e=>{const b=e.target.closest('[data-op]');if(!b)return;const r=lista[Number(b.dataset.op)];box.style.display='none';
    if(origem==='ssw')buscarSsw(r.nf,r.ctrc);else usarLocal(r)};
}
function usarLocal(r){
  if(r.agendamento_id){preencher(null);msg('A NF '+r.nf+' já está agendada para '+br(r.data_agendada)+'. Use "Alterar" na lista Agendadas para reagendar.','err');return}
  if(r.situacao==='entregue'||r.situacao==='devolvida'){preencher(null);msg('A NF '+r.nf+' já está '+ROT[r.situacao].toLowerCase()+' no SSW e não entra no agendamento.','err');return}
  preencher(r);msg('NF '+r.nf+' carregada ('+(ROT[r.situacao]||'')+' no SSW, consultada em '+dh(r.ultima_consulta)+'). Informe a data e clique em Agendar.','ok');q('#agData').focus()
}
async function buscarNf(){
  const nf=String(q('#agNf').value||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');
  q('#agOpcoes').style.display='none';preencher(null);
  if(!nf){msg('Informe o número da nota fiscal.','err');return}
  msg('Procurando a NF '+nf+'…');
  try{
    // primeiro o que a varredura já trouxe do SSW (instantâneo); se não tiver, consulta o SSW agora
    const loc=await api('/api/painel/agendamentos/buscar-nf?nf='+encodeURIComponent(nf));
    const ativos=(loc.rows||[]).filter(r=>r.situacao!=='entregue'&&r.situacao!=='devolvida');
    if(ativos.length>1)return escolher(ativos,'local');
    if(ativos.length===1)return usarLocal(ativos[0]);
    await buscarSsw(nf,'',loc.rows||[]);
  }catch(e){msg(e.message,'err')}
}
async function buscarSsw(nf,ctrc,conhecidas=[]){
  msg('Consultando a NF '+nf+' no SSW… (alguns segundos)');
  try{
    const j=await api('/api/agendamentos/nf?nf='+encodeURIComponent(nf)+(ctrc?'&ctrc='+encodeURIComponent(ctrc):''));
    if(j.varias)return escolher(j.opcoes,'ssw');
    const r=j.row;r.nf=r.nf||nf;r.destinatario=r.destinatario||r.cliente||'';
    preencher(r);q('#agNf').value=r.nf;
    msg('NF '+r.nf+' encontrada no SSW'+(r.status_ssw?' ('+r.status_ssw+')':'')+'. Informe a data e clique em Agendar.','ok');q('#agData').focus()
  }catch(e){
    const fin=conhecidas.find(r=>r.situacao==='entregue'||r.situacao==='devolvida');
    msg(fin&&e.status===404?'A NF '+nf+' está '+ROT[fin.situacao].toLowerCase()+' no SSW (histórico) e não entra no agendamento.':e.message,'err')
  }
}
async function salvar(ev){
  ev.preventDefault();
  if(!atual){msg('Busque a NF primeiro (digite e pressione Enter).','err');q('#agNf').focus();return}
  const data=q('#agData').value;if(!data){msg('Informe a data do agendamento.','err');q('#agData').focus();return}
  const b=q('#agSalvar');b.disabled=true;
  try{
    const body={data_agendada:data,observacao:q('#agObs').value,produto:q('#agProd').value};
    if(atual.nota_id)body.nota_id=atual.nota_id;else body.nota={...atual,produto:'',mercadoria:''};
    await api('/api/painel/agendamentos',{method:'POST',body});
    const nf=atual.nf;limparForm();msg('NF '+nf+' agendada para '+br(data)+'.','ok');
    if(aba==='sem'||aba==='agendadas')carregarLista();carregarPainel()
  }catch(e){msg(e.message,'err');b.disabled=false}
}

// ------------------------------------------------------------------ abas, filtros e tabela
function marcarAba(){document.querySelectorAll('#agAbas .ag-aba').forEach(b=>b.classList.toggle('sel',b.dataset.aba===aba));
  q('#agFTipo').value=aba==='coletas'?'coleta':'entrega';q('#agFCom').value=aba==='agendadas'?'com':aba==='sem'?'sem':'';
  const L={agendadas:[['#dbeafe','Agendada para hoje'],['#fee2e2','Agendamento vencido']],sem:[['#fef9c3','Sem agendamento há mais de '+(painel?.config?.dias_amarelo??2)+' dias'],['#fee2e2','Há mais de '+(painel?.config?.dias_vermelho??5)+' dias']],historico:[['#dcfce7','Entregue'],['#f1f5f9','Devolvida']],coletas:[],pendentes:[['#dbeafe','Agendada para hoje'],['#fee2e2','Vencida ou sem agendamento há muito tempo'],['#fef9c3','Sem agendamento há mais de '+(painel?.config?.dias_amarelo??2)+' dias']]}[aba]||[];
  q('#agLegenda').innerHTML=L.map(([c,t])=>'<span><i style="background:'+c+'"></i>'+esc(t)+'</span>').join('')}
function filtros(){
  const f={aba,page,per:PER};
  const v=(k,id)=>{const x=String(q(id).value||'').trim();if(x)f[k]=x};
  v('de','#agFDe');v('ate','#agFAte');v('remetente','#agFRem');v('destinatario','#agFDest');v('cidade','#agFCid');v('nf','#agFNf');v('status','#agFSt');v('dias_min','#agFDias');v('q','#agFQ');
  if(card==='hoje'||card==='amanha')f.card=card;
  return f
}
function limparFiltros(recarregar=true){['#agFDe','#agFAte','#agFRem','#agFDest','#agFCid','#agFNf','#agFSt','#agFDias','#agFQ'].forEach(id=>q(id).value='');card='';if(recarregar){page=1;marcarAba();carregarLista();carregarPainel()}}
const COLS={
  pendentes:[['nf','NF'],['remetente','Remetente'],['destinatario','Destinatário'],['cidade','Cidade'],['peso','Peso',1],['produto','Produto'],['data_agendada','Data Agendada'],['dias_sem','Dias sem agend.',1],['situacao','Status'],['acoes','Ações']],
  agendadas:[['nf','NF'],['remetente','Remetente'],['destinatario','Destinatário'],['cidade','Cidade'],['peso','Peso',1],['produto','Produto'],['data_agendada','Data Agendada'],['observacao','Observação'],['situacao','Status'],['acoes','Ações']],
  sem:[['nf','NF'],['ctrc','CT-e'],['remetente','Remetente'],['destinatario','Destinatário'],['cidade','Cidade/UF'],['peso','Peso',1],['produto','Produto'],['data_emissao','Emissão'],['data_entrada','Entrada na operação'],['dias_sem','Dias sem agend.',1],['situacao','Status'],['acoes','']],
  historico:[['nf','NF'],['ctrc','CT-e'],['remetente','Remetente'],['destinatario','Destinatário'],['cidade','Cidade'],['peso','Peso',1],['situacao','Situação'],['concluido_em','Concluída em'],['data_agendada','Último agendamento'],['total_reagendamentos','Reagend.',1],['cancelamentos','Cancel.',1],['acoes','']],
  coletas:[['os','OS'],['data_coleta','Data da coleta'],['remetente','Cliente'],['destinatario','Destinatário'],['origem','Origem'],['destino','Destino'],['motorista','Motorista'],['placa','Placa'],['status','Status']]
};
function valor(r,k){
  if(k==='peso')return kg(r.peso);
  if(k==='cidade')return [r.cidade,r.uf].filter(Boolean).join('/');
  if(['data_agendada','data_emissao','data_entrada','concluido_em','data_coleta'].includes(k))return br(r[k]);
  if(k==='situacao')return ROT[r.situacao]||r.situacao||'';
  if(k==='remetente'&&aba!=='coletas')return String(r.remetente||'').trim().split(/\s+/)[0]||'';   // só o primeiro nome
  return r[k]??''
}
function classe(r){
  const hoje=painel?.hoje||new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),cfg=painel?.config||{dias_amarelo:2,dias_vermelho:5};
  if(aba==='pendentes'&&!r.data_agendada){if(r.dias_sem>cfg.dias_vermelho)return'vermelho';if(r.dias_sem>cfg.dias_amarelo)return'amarelo';return''}
  if(aba==='agendadas'&&r.situacao==='entregue')return'verde';
  if(aba==='agendadas'||aba==='pendentes'){if(r.data_agendada<hoje)return'vermelho';if(r.data_agendada===hoje)return'azul'}
  if(aba==='sem'){if(r.dias_sem>cfg.dias_vermelho)return'vermelho';if(r.dias_sem>cfg.dias_amarelo)return'amarelo'}
  if(aba==='historico'){if(r.situacao==='entregue')return'verde';if(r.situacao==='devolvida')return'cinza'}
  return''
}
function celula(r,k,num){
  if(k==='acoes'){
    if((aba==='agendadas'&&r.status_agendamento!=='concluido')||(aba==='pendentes'&&r.agendamento_id))return'<td class="acoes"><button type="button" class="ag-mini" data-ac="alterar" data-id="'+esc(r.agendamento_id)+'">Alterar</button><button type="button" class="ag-mini perigo" data-ac="cancelar" data-id="'+esc(r.agendamento_id)+'">Cancelar</button><button type="button" class="ag-mini" data-ac="hist" data-nota="'+esc(r.nota_id)+'">Histórico</button></td>';
    if(aba==='sem'||aba==='pendentes')return'<td class="acoes"><button type="button" class="ag-mini primary" data-ac="agendar" data-nota="'+esc(r.nota_id)+'">Agendar</button><button type="button" class="ag-mini" data-ac="hist" data-nota="'+esc(r.nota_id)+'">Histórico</button></td>';
    return'<td class="acoes"><button type="button" class="ag-mini" data-ac="hist" data-nota="'+esc(r.nota_id)+'">Histórico</button></td>'
  }
  if(k==='situacao')return'<td>'+st(r.situacao)+(r.erro_integracao&&r.situacao==='verificar'?'<div style="font-size:10px;color:#92400e">'+esc(r.erro_integracao)+'</div>':'')+'</td>';
  const v=valor(r,k);
  return'<td class="'+(num?'n':'')+(k==='produto'?' prod':k==='observacao'?' obs':'')+'" title="'+esc(k==='produto'||k==='observacao'||k==='remetente'||k==='destinatario'?v:'')+'">'+(k==='nf'?'<b>'+esc(v)+'</b>':k==='produto'?'<div class="ag-prod">'+esc(v)+'</div>':esc(v))+'</td>'
}
// A lista ocupa o resto da altura da janela (os indicadores e o formulário ficam em faixas finas acima).
function ajustarAltura(){
  const box=q('.ag-tabela-box');if(!box||!box.offsetParent)return;
  const topo=box.getBoundingClientRect().top+window.scrollY;
  const h=Math.max(340,window.innerHeight-topo-(q('#agPag').innerHTML?44:14))+'px';
  if(box.style.maxHeight!==h)box.style.maxHeight=h
}
async function carregarLista(){
  const t=q('#agTabela'),cols=COLS[aba];
  try{
    const p=new URLSearchParams(filtros());
    const j=await api('/api/painel/agendamentos/lista?'+p);
    ultimaLista=j;
    q('#agTotais').innerHTML='<b>'+nfmt(j.total)+'</b> '+(aba==='coletas'?'coleta(s)':'nota(s)')+(aba!=='coletas'?' • <b>'+kg(j.peso)+'</b> kg • '+nfmt(j.volumes)+' volume(s)':'');
    t.innerHTML='<thead><tr>'+cols.map(([k,l,n])=>'<th class="'+(n?'n':'')+'">'+esc(l)+'</th>').join('')+'</tr></thead><tbody>'+
      (j.rows.length?j.rows.map(r=>'<tr class="'+classe(r)+'">'+cols.map(([k,,n])=>celula(r,k,n)).join('')+'</tr>').join(''):'<tr><td class="ag-vazio" colspan="'+cols.length+'">'+(aba==='sem'&&!painel?.indicadores?.sync?.ultimaOk?'A lista aparece depois da primeira sincronização com o SSW.':'Nenhuma nota com estes filtros.')+'</td></tr>')+'</tbody>';
    const pags=Math.max(1,Math.ceil(j.total/PER));
    q('#agPag').innerHTML=pags>1?'<button type="button" class="ag-mini" data-pg="'+(page-1)+'"'+(page<=1?' disabled':'')+'>‹ Anterior</button><span>Página '+page+' de '+pags+'</span><button type="button" class="ag-mini" data-pg="'+(page+1)+'"'+(page>=pags?' disabled':'')+'>Próxima ›</button>':'';
    ajustarAltura();
  }catch(e){t.innerHTML='<tbody><tr><td class="ag-vazio">'+esc(e.message)+'</td></tr></tbody>'}
}
async function acao(b){
  const ac=b.dataset.ac;
  if(ac==='agendar'){
    const r=(ultimaLista?.rows||[]).find(x=>x.nota_id===b.dataset.nota);if(!r)return;
    q('#agNf').value=r.nf;usarLocal(r);window.scrollTo({top:0,behavior:'smooth'});q('#agForm').scrollIntoView({block:'nearest'});q('#agData').focus();return
  }
  if(ac==='hist')return historico(b.dataset.nota);
  const r=(ultimaLista?.rows||[]).find(x=>x.agendamento_id===b.dataset.id);if(!r)return;
  if(ac==='alterar')return dialogo('<h3>Alterar / reagendar • NF '+esc(r.nf)+'</h3><div class="muted">'+esc(r.destinatario||'')+' • '+esc(r.cidade||'')+'</div><label>Data do agendamento<input name="data" type="date" required value="'+esc(r.data_agendada)+'"></label><label>Produto<input name="prod" maxlength="600" value="'+esc(r.produto||'')+'"></label><label>Motivo do reagendamento (opcional)<input name="motivo" maxlength="300"></label><label>Observação<textarea name="obs" rows="3" maxlength="1000">'+esc(r.observacao||'')+'</textarea></label>',
    async fd=>{await api('/api/painel/agendamentos/'+r.agendamento_id,{method:'PATCH',body:{data_agendada:fd.get('data'),observacao:fd.get('obs'),produto:fd.get('prod'),motivo:fd.get('motivo')}})},'Salvar');
  if(ac==='cancelar')return dialogo('<h3>Cancelar agendamento • NF '+esc(r.nf)+'</h3><div class="muted">Agendada para '+esc(br(r.data_agendada))+'. O cancelamento vale só aqui: a entrega continua no SSW e a nota volta para "Sem Agendamento".</div><label>Motivo<input name="motivo" maxlength="300"></label>',
    async fd=>{await api('/api/painel/agendamentos/'+r.agendamento_id+'/cancelar',{method:'POST',body:{motivo:fd.get('motivo')}})},'Cancelar agendamento',true);
}
function dialogo(html,enviar,rotulo,perigo){
  const d=q('#agDlg');
  d.innerHTML='<form method="dialog">'+html+'<div class="ag-msg" data-dlg-msg></div><div class="ag-dlg-acoes"><button type="button" class="ag-btn" data-fechar>Voltar</button>'+(enviar?'<button type="submit" class="ag-btn '+(perigo?'perigo':'primary')+'">'+esc(rotulo||'Salvar')+'</button>':'')+'</div></form>';
  d.querySelector('[data-fechar]').onclick=()=>d.close();
  const f=d.querySelector('form');
  f.onsubmit=async e=>{
    if(!enviar)return;e.preventDefault();const bt=f.querySelector('[type=submit]');bt.disabled=true;
    try{await enviar(new FormData(f));d.close();carregarLista();carregarPainel()}
    catch(err){const m=f.querySelector('[data-dlg-msg]');m.textContent=err.message;m.className='ag-msg err';bt.disabled=false}
  };
  if(d.showModal)d.showModal();else d.setAttribute('open','')
}
async function historico(notaId){
  dialogo('<h3>Histórico</h3><div class="ag-hist">Carregando…</div>');
  try{
    const j=await api('/api/painel/agendamentos/historico/'+encodeURIComponent(notaId)),n=j.nota;
    const T={agendado:'Agendado',reagendado:'Reagendado',observacao:'Observação alterada',cancelado:'Agendamento cancelado',entregue:'Entregue',produto:'Produto alterado',importada:'Importada do SSW',devolvida:'Devolvida (SSW)',status:'Situação no SSW'};
    q('#agDlg h3').textContent='Histórico • NF '+n.nf+(n.ctrc?' • CT-e '+n.ctrc:'');
    q('#agDlg .ag-hist').innerHTML='<div style="margin-bottom:6px">'+esc(n.remetente||'')+' → '+esc(n.destinatario||'')+' • '+esc([n.cidade,n.uf].filter(Boolean).join('/'))+' • '+kg(n.peso)+' kg • '+st(n.situacao)+(n.status_ssw?' <span class="muted">'+esc(n.status_ssw)+'</span>':'')+'</div>'+
      (n.endereco?'<div class="muted" style="margin-bottom:6px">Entrega: '+esc(n.endereco)+'</div>':'')+
      '<table><thead><tr><th>Quando</th><th>O quê</th><th>De</th><th>Para</th><th>Detalhe</th><th>Quem</th></tr></thead><tbody>'+
      (j.eventos.length?j.eventos.map(e=>'<tr><td>'+esc(dh(e.criado_em))+'</td><td>'+esc(T[e.tipo]||e.tipo)+'</td><td>'+esc(e.de||'')+'</td><td>'+esc(e.para||'')+'</td><td>'+esc(e.detalhe||'')+'</td><td>'+esc(e.usuario||'')+'</td></tr>').join(''):'<tr><td colspan="6" class="muted">Sem eventos ainda.</td></tr>')+'</tbody></table>';
  }catch(e){q('#agDlg .ag-hist').textContent=e.message}
}
async function logSync(){
  dialogo('<h3>Log das sincronizações com o SSW</h3><div class="ag-hist">Carregando…</div>');
  try{
    const j=await api('/api/painel/agendamentos/sincronizacoes');
    q('#agDlg .ag-hist').innerHTML='<table><thead><tr><th>Início</th><th>Origem</th><th>Resultado</th><th>Pendentes SSW</th><th>Novas</th><th>Entregues</th><th>Devolvidas</th><th>Verificar</th></tr></thead><tbody>'+
      (j.rows.length?j.rows.map(s=>'<tr><td>'+esc(dh(s.iniciado_em))+'</td><td>'+esc(s.origem==='automatica'?'Automática':'Manual')+(s.usuario?'<div class="muted">'+esc(s.usuario)+'</div>':'')+'</td><td>'+(s.status==='ok'?'<b style="color:#15803d">OK</b>':s.status==='rodando'?'Rodando…':'<b style="color:#b91c1c">Falhou</b><div style="font-size:11px">'+esc(s.erro||'')+'</div>')+'</td><td>'+nfmt(s.pendentes_ssw)+'</td><td>'+nfmt(s.novas)+'</td><td>'+nfmt(s.entregues)+'</td><td>'+nfmt(s.devolvidas)+'</td><td>'+nfmt(s.verificar)+'</td></tr>').join(''):'<tr><td colspan="8" class="muted">Nenhuma sincronização ainda.</td></tr>')+'</tbody></table>';
  }catch(e){q('#agDlg .ag-hist').textContent=e.message}
}
function configurar(){
  const c=painel?.config||{};
  dialogo('<h3>Configuração do agendamento</h3><label>Horário da varredura automática no SSW (Brasília)<input name="hora" type="time" required value="'+esc(c.hora_sync||'02:00')+'"></label><label><span><input name="ativa" type="checkbox" style="width:auto;height:auto"'+(c.sync_ativa!==false?' checked':'')+'> Varredura automática ligada</span></label><label>Amarelo: sem agendamento há mais de (dias)<input name="am" type="number" min="0" max="60" required value="'+esc(c.dias_amarelo??2)+'"></label><label>Vermelho: sem agendamento há mais de (dias)<input name="vm" type="number" min="1" max="90" required value="'+esc(c.dias_vermelho??5)+'"></label><label>Parceiros que entram no agendamento (procurados no remetente e no pagador; separe por vírgula, vazio = todos)<textarea name="parc" rows="2" maxlength="1500">'+esc(c.parceiros||'')+'</textarea></label>',
    async fd=>{await api('/api/painel/agendamentos/config',{method:'PUT',body:{hora_sync:fd.get('hora'),sync_ativa:fd.get('ativa')==='on',dias_amarelo:Number(fd.get('am')),dias_vermelho:Number(fd.get('vm')),parceiros:String(fd.get('parc')||'')}})},'Salvar')
}

// ------------------------------------------------------------------ exportações (todas as linhas do filtro)
async function linhasExport(){
  const p=new URLSearchParams({...filtros(),page:1,per:5000});
  const j=await api('/api/painel/agendamentos/lista?'+p);
  const cols=COLS[aba].filter(([k])=>k!=='acoes');
  return{cols,rows:j.rows.map(r=>cols.map(([k])=>{const v=valor(r,k);return k==='peso'||k==='dias_sem'||k==='total_reagendamentos'||k==='cancelamentos'?Number(r[k]||0):String(v)})),total:j.total,peso:j.peso}
}
const TITULO={pendentes:'Entregas pendentes',agendadas:'Entregas agendadas',sem:'Notas sem agendamento',coletas:'Coletas agendadas',historico:'Histórico de entregas'};
function resumoFiltros(){const f=filtros();delete f.aba;delete f.page;delete f.per;const s=Object.entries(f).map(([k,v])=>k+': '+v).join(' • ');return s||'sem filtros'}
async function exportarPdf(){
  if(!window.jspdf?.jsPDF){msg('O gerador de PDF ainda não carregou. Atualize a página.','err');return}
  try{
    const x=await linhasExport(),{jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    doc.setFontSize(13);doc.text(TITULO[aba]+' • '+x.total+' registro(s)'+(aba!=='coletas'?' • '+kg(x.peso)+' kg':''),10,12);
    doc.setFontSize(8);doc.text('Gerado em '+new Date().toLocaleString('pt-BR')+' • '+resumoFiltros(),10,17);
    doc.autoTable({startY:20,head:[x.cols.map(c=>c[1])],body:x.rows.map(r=>r.map(v=>typeof v==='number'?v.toLocaleString('pt-BR'):v)),styles:{fontSize:7,cellPadding:1.2},headStyles:{fillColor:[15,118,110]}});
    doc.save(TITULO[aba].toLowerCase().replace(/\s+/g,'-')+'-'+new Date().toISOString().slice(0,10)+'.pdf')
  }catch(e){msg(e.message,'err')}
}
let xlsxCarregando=null;
function carregarXlsx(){
  if(window.XLSX)return Promise.resolve(window.XLSX);
  return xlsxCarregando||(xlsxCarregando=new Promise((ok,falha)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';s.onload=()=>ok(window.XLSX);s.onerror=()=>{xlsxCarregando=null;falha(new Error('Não consegui carregar o gerador de Excel.'))};document.head.appendChild(s)}))
}
async function exportarExcel(){
  try{
    const x=await linhasExport(),nome=TITULO[aba].toLowerCase().replace(/\s+/g,'-')+'-'+new Date().toISOString().slice(0,10);
    try{
      const X=await carregarXlsx(),ws=X.utils.aoa_to_sheet([x.cols.map(c=>c[1]),...x.rows]),wb=X.utils.book_new();
      X.utils.book_append_sheet(wb,ws,TITULO[aba].slice(0,30));X.writeFile(wb,nome+'.xlsx')
    }catch{
      // sem a biblioteca: CSV que o Excel abre (separador ;)
      const csv='﻿'+[x.cols.map(c=>c[1]),...x.rows].map(l=>l.map(v=>'"'+String(typeof v==='number'?v.toLocaleString('pt-BR'):v).replace(/"/g,'""')+'"').join(';')).join('\r\n');
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=nome+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)
    }
  }catch(e){msg(e.message,'err')}
}
async function imprimir(){
  try{
    const x=await linhasExport(),w=window.open('','_blank');
    if(!w){msg('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.','err');return}
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+esc(TITULO[aba])+'</title><style>body{font-family:Arial,sans-serif;margin:16px;color:#111827}h1{font-size:17px;margin:0 0 4px}.m{font-size:11px;color:#475569;margin-bottom:10px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd5e1;padding:4px;text-align:left}th{background:#f1f5f9}@media print{body{margin:8mm}}</style></head><body><h1>'+esc(TITULO[aba])+'</h1><div class="m">'+x.total+' registro(s)'+(aba!=='coletas'?' • '+kg(x.peso)+' kg':'')+' • '+esc(resumoFiltros())+' • '+new Date().toLocaleString('pt-BR')+'</div><table><thead><tr>'+x.cols.map(c=>'<th>'+esc(c[1])+'</th>').join('')+'</tr></thead><tbody>'+x.rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(typeof v==='number'?v.toLocaleString('pt-BR'):v)+'</td>').join('')+'</tr>').join('')+'</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>');
    w.document.close()
  }catch(e){msg(e.message,'err')}
}

function setup(){
  if(pronto)return;pronto=true;
  q('#agNf').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();buscarNf()}});
  q('#agNf').addEventListener('input',()=>{if(atual)preencher(null)});
  q('#agForm').onsubmit=salvar;
  q('#agLimpar').onclick=limparForm;
  q('#agSyncBtn').onclick=sincronizar;q('#agBaixasBtn').onclick=atualizarBaixas;q('#agImpForm').onsubmit=importarFaixa;
  q('#agLogBtn').onclick=logSync;
  q('#agCfgBtn').onclick=configurar;
  q('#agCards').onclick=e=>{const b=e.target.closest('[data-card]');if(b)clicarCard(b)};
  q('#agAbas').onclick=e=>{const b=e.target.closest('[data-aba]');if(!b)return;aba=b.dataset.aba;card='';page=1;marcarAba();carregarLista();carregarPainel()};
  q('#agFiltros').onsubmit=e=>{e.preventDefault();page=1;card='';carregarLista();carregarPainel()};
  q('#agFLimpar').onclick=()=>limparFiltros(true);
  q('#agFTipo').onchange=()=>{aba=q('#agFTipo').value==='coleta'?'coletas':'agendadas';page=1;marcarAba();carregarLista()};
  q('#agFCom').onchange=()=>{const v=q('#agFCom').value;if(v){aba=v==='com'?'agendadas':'sem';page=1;marcarAba();carregarLista()}};
  q('#agPdf').onclick=exportarPdf;q('#agXls').onclick=exportarExcel;q('#agPrint').onclick=imprimir;
  q('#agTabela').onclick=e=>{const b=e.target.closest('[data-ac]');if(b)acao(b)};
  q('#agPag').onclick=e=>{const b=e.target.closest('[data-pg]');if(!b||b.disabled)return;page=Number(b.dataset.pg);carregarLista()};
  // a lista e os indicadores se atualizam sozinhos enquanto a tela está aberta
  // avisos que entram ou saem acima da tela mudam o espaço livre: a lista acompanha
  window.addEventListener('resize',ajustarAltura);
  if(window.ResizeObserver)new ResizeObserver(()=>requestAnimationFrame(ajustarAltura)).observe(document.body);
  setInterval(()=>{if(!document.hidden&&q('#agendamento-entregas')?.classList.contains('active')&&!q('#agDlg').open){carregarPainel()}},120000);
}
// Chamado pelo painel quando a aba "Agendamento de entregas" é aberta.
window.agendamentoAbrir=async()=>{setup();marcarAba();await carregarPainel();marcarAba();carregarLista();setTimeout(()=>q('#agNf').focus(),80)};
})();
