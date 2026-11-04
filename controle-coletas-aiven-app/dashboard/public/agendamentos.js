// Agendamento de entregas: central das notas pendentes no SSW (com e sem agendamento), coletas programadas e histórico.
// O usuário digita só a NF, a data e a observação; o resto vem do SSW. A varredura das 02h00 (e o botão manual)
// tira das listas as notas entregues ou devolvidas, sem apagar nada.
// Servidor: agendamento.js (/api/painel/agendamentos*) e dashboard/server.js (/api/agendamentos/nf, leitura do SSW).
(()=>{
const q=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const kg=v=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
const hr=v=>{if(!v)return'';const d=new Date(v);return isNaN(d)?'':d.toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'})};
const nfmt=v=>Number(v||0).toLocaleString('pt-BR');
const br=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'';
const dh=v=>{if(!v)return'';const d=new Date(v);return isNaN(d)?'':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})};
const ROT={pendente:'Aguardando',agendado:'Agendado',em_rota:'Em rota',verificar:'Verificação necessária',entregue:'Entregue',devolvida:'Devolvida'};
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
// nota ainda não saiu (aguardando) mas já tem data marcada aparece como Agendado
const stDe=(s,r)=>(s==='pendente'&&r&&(r.agendamento_id||r.data_agendada))?'agendado':s;
const st=(s,r)=>{s=stDe(s,r);return'<span class="ag-st '+esc(s)+'">'+esc(ROT[s]||s||'—')+'</span>'};

// ------------------------------------------------------------------ painel: sincronização e indicadores
// Sem a permissão SAC: só consulta (o formulário e os botões de agendar ficam travados)
function podeAgendar(){return!painel||painel.pode_agendar!==false}
function modoSac(){
  const ok=podeAgendar(),f=q('#agForm');
  f.querySelectorAll('input:not([readonly]),button').forEach(x=>{if(x.id!=='agSalvar')x.disabled=!ok});
  if(!ok){q('#agSalvar').disabled=true;msg('Somente consulta: só usuários do SAC agendam. Peça ao administrador para marcar "Agendamentos • SAC" no seu usuário.','err')}
  const imp=q('#agImpForm');if(imp)imp.querySelectorAll('input,button').forEach(x=>x.disabled=!ok);
}
// reserva do cliente: livre, minha ou de outro usuário
function reservaDe(r){const v=r&&r.reserva;if(!v)return'';return painel&&String(v.usuario).toLowerCase()===String(painel.eu||'').toLowerCase()?'minha':'outro'}
function botaoReserva(r){
  if(!r.nota_id||!podeAgendar())return'';
  const t=reservaDe(r),ate=r.reserva?' até '+hr(r.reserva.expira):'';
  if(t==='minha')return'<button type="button" class="ag-mini minha" data-ac="liberar" data-nota="'+esc(r.nota_id)+'" title="Reservado para você'+esc(ate)+'. Clique para liberar.">🚩 Minha</button>';
  if(t==='outro')return'<button type="button" class="ag-mini outro'+(painel.pode_configurar?' pode':'')+'" '+(painel.pode_configurar?'data-ac="liberar" ':'')+'data-nota="'+esc(r.nota_id)+'" title="Reservado para '+esc(r.reserva.usuario)+' desde '+esc(hr(r.reserva.em))+(painel.pode_configurar?'. Clique para liberar (administrador).':'')+'">🔒 '+esc(String(r.reserva.usuario).split(/[\s._@]/)[0])+'</button>';
  return'<button type="button" class="ag-mini reserva" data-ac="reservar" data-nota="'+esc(r.nota_id)+'" title="Reservar este cliente para você agendar (os outros não conseguem agendar até você liberar ou o dia acabar)">🚩 Reservar</button>';
}
async function carregarPainel(){
  try{painel=await api('/api/painel/agendamentos/painel')}catch(e){q('#agSyncInfo').textContent=e.message;return}
  const ind=painel.indicadores,s=ind.sync||{},ok=s.ultimaOk,ul=s.ultima;
  q('#agCfgBtn').style.display=painel.pode_configurar?'':'none';q('#agAudBtn').style.display=painel.pode_configurar?'':'none';q('#agWaRelBtn').style.display='';
  modoSac();
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
  const de=q('#agImpDe').value.trim(),ate=q('#agImpAte').value.trim()||de,pagador=q('#agImpPag').value.trim();
  if(!de){msg('Informe o CT-e inicial (com o dígito).','err');q('#agImpDe').focus();return}
  const b=q('#agImpBtn');b.disabled=true;
  try{
    const ini=await api('/api/painel/agendamentos/importar',{method:'POST',body:{de,ate,pagador}});
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
    if(j.fora_parceiros.length)p.push(j.fora_parceiros.length+' de outros clientes (fora dos parceiros'+(j.fora_nomes&&j.fora_nomes.length?': '+j.fora_nomes.slice(0,3).join('; '):'')+')');
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
// Produtos: digitado pelo operador ou lidos da NF-e (XML na SEFAZ) / relação do SSW.
const FONTES_PROD=['operador','nfe','ssw'],ORIGEM_PROD={nfe:'XML da NF-e (SEFAZ)',ssw:'relação de produtos do SSW',operador:'digitado pelo operador'};
let prodAuto=null,prodSeq=0;
// Busca os itens da nota quando o campo Produto veio vazio (alguns segundos; o operador pode digitar antes)
async function carregarProdutos(r){
  if(!r||q('#agProd').value.trim())return;
  const seq=++prodSeq,campo=q('#agProd'),ph=campo.placeholder;
  campo.placeholder='Buscando produtos da NF…';
  try{
    const j=await api('/api/painel/agendamentos/produtos?nf='+encodeURIComponent(r.nf)+(r.ctrc?'&ctrc='+encodeURIComponent(r.ctrc):'')+(r.nota_id?'&nota_id='+encodeURIComponent(r.nota_id):''));
    if(seq!==prodSeq||atual!==r)return;
    if(j.produto&&!campo.value.trim()){campo.value=j.produto;campo.title='Produtos: '+(j.origem||'');prodAuto={texto:j.produto,fonte:j.fonte}}
    else if(!j.produto&&j.motivo)campo.title='Produtos não encontrados automaticamente: '+j.motivo;
  }catch(e){if(seq===prodSeq)campo.title='Falha ao buscar os produtos: '+e.message}
  finally{if(seq===prodSeq)campo.placeholder=ph}
}
function preencher(r){
  atual=r;
  q('#agRem').value=r?.remetente||'';q('#agDest').value=r?.destinatario||'';
  q('#agCid').value=r?[r.cidade,r.uf].filter(Boolean).join('/'):'';q('#agPeso').value=r&&r.peso?kg(r.peso):'';
  q('#agProd').value=r&&FONTES_PROD.includes(r.produto_fonte)?r.produto||'':'';q('#agProd').title=r&&ORIGEM_PROD[r.produto_fonte]?'Produtos: '+ORIGEM_PROD[r.produto_fonte]:'';prodAuto=r&&r.produto_fonte!=='operador'&&FONTES_PROD.includes(r.produto_fonte)?{texto:r.produto||'',fonte:r.produto_fonte}:null;q('#agCte').value=r?.ctrc||'';
  q('#agRem').title=r?.endereco?'Entrega: '+r.endereco:'';q('#agDest').title=r?.endereco?'Entrega: '+r.endereco:'';
  q('#agSalvar').disabled=!r||!podeAgendar();
  const lc=q('#agLocal');lc.value='';lc.placeholder=r&&r.localizacao?'Já tem: cole outro para trocar':'Cole o link do WhatsApp';lc.title=r&&r.localizacao?'Localização guardada: '+r.localizacao.link:'';
}
function limparForm(){preencher(null);q('#agNf').value='';q('#agData').value='';q('#agObs').value='';q('#agLocal').value='';q('#agOpcoes').style.display='none';q('#agOpcoes').innerHTML='';msg('Digite a NF e pressione Enter: os dados vêm do SSW.');q('#agNf').focus()}
function escolher(lista,origem){
  const box=q('#agOpcoes');box.style.display='block';
  box.innerHTML='<div style="font-weight:700;margin-bottom:3px">Há '+lista.length+' notas com este número. Escolha a correta:</div><table><thead><tr><th>CT-e</th><th>Remetente</th><th>Destinatário</th><th>Cidade</th><th>Situação</th><th></th></tr></thead><tbody>'+
    lista.map((r,i)=>'<tr><td>'+esc(r.ctrc||'—')+'</td><td>'+esc(r.remetente)+'</td><td>'+esc(r.destinatario)+'</td><td>'+esc([r.cidade,r.uf].filter(Boolean).join('/'))+'</td><td>'+(r.situacao?st(r.situacao,r):esc(r.status_ssw||''))+'</td><td><button type="button" class="ag-mini primary" data-op="'+i+'">Usar esta</button></td></tr>').join('')+'</tbody></table>';
  box.onclick=e=>{const b=e.target.closest('[data-op]');if(!b)return;const r=lista[Number(b.dataset.op)];box.style.display='none';
    if(origem==='ssw')buscarSsw(r.nf,r.ctrc);else usarLocal(r)};
}
function usarLocal(r){
  if(r.agendamento_id){preencher(null);msg('A NF '+r.nf+' já está agendada para '+br(r.data_agendada)+'. Use "Alterar" na lista Agendadas para reagendar.','err');return}
  if(r.situacao==='entregue'||r.situacao==='devolvida'){preencher(null);msg('A NF '+r.nf+' já está '+ROT[r.situacao].toLowerCase()+' no SSW e não entra no agendamento.','err');return}
  if(reservaDe(r)==='outro'&&!painel?.pode_configurar){preencher(null);msg('O cliente '+(r.destinatario||'')+' (NF '+r.nf+') está reservado para '+r.reserva.usuario+' desde '+hr(r.reserva.em)+'. Só ele agenda até liberar.','err');return}
  preencher(r);carregarProdutos(r);msg('NF '+r.nf+' carregada ('+(ROT[r.situacao]||'')+' no SSW, consultada em '+dh(r.ultima_consulta)+'). Informe a data e clique em Agendar.','ok');q('#agData').focus()
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
    preencher(r);q('#agNf').value=r.nf;carregarProdutos(r);
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
    if(prodAuto&&body.produto.trim()===prodAuto.texto.trim())body.produto_fonte=prodAuto.fonte;
    if(atual.nota_id)body.nota_id=atual.nota_id;else body.nota={...atual,produto:'',mercadoria:''};
    const ag=await api('/api/painel/agendamentos',{method:'POST',body});
    const nf=atual.nf,local=q('#agLocal').value.trim();let aviso='';
    if(local&&ag.nota_id){try{await api('/api/painel/agendamentos/notas/'+ag.nota_id+'/localizacao',{method:'PUT',body:{texto:local}});aviso=' Localização guardada.'}catch(e){aviso=' A localização não foi guardada: '+e.message}}
    limparForm();msg('NF '+nf+' agendada para '+br(data)+'.'+aviso,aviso.includes('não foi')?'err':'ok');
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
  v('de','#agFDe');v('ate','#agFAte');v('remetente','#agFRem');v('destinatario','#agFDest');v('cidade','#agFCid');v('nf','#agFNf');v('status','#agFSt');v('dias_min','#agFDias');v('link','#agFLink');v('q','#agFQ');
  if(card==='hoje'||card==='amanha')f.card=card;
  return f
}
function limparFiltros(recarregar=true){['#agFDe','#agFAte','#agFRem','#agFDest','#agFCid','#agFNf','#agFSt','#agFDias','#agFLink','#agFQ'].forEach(id=>q(id).value='');card='';if(recarregar){page=1;marcarAba();carregarLista();carregarPainel()}}
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
  if(k==='situacao'){const s=stDe(r.situacao,r);return ROT[s]||s||''}
  if(k==='remetente'&&aba!=='coletas')return String(r.remetente||'').trim().split(/\s+/)[0]||'';   // só o primeiro nome
  return r[k]??''
}
function classe(r){return(classeCor(r)+(reservaDe(r)==='outro'?' reservado-outro':'')).trim()}
function classeCor(r){
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
    const rs=(aba==='pendentes'||aba==='sem')&&!r.agendamento_id?botaoReserva(r):'';
    const sac=podeAgendar();
    if(!sac)return'<td class="acoes"><button type="button" class="ag-mini" data-ac="hist" data-nota="'+esc(r.nota_id)+'">Histórico</button></td>';
    return celulaAcoes(r).replace('<td class="acoes">','<td class="acoes">'+rs);
  }
  return celulaDado(r,k,num);
}
function celulaAcoes(r){
  {
    if((aba==='agendadas'&&r.status_agendamento!=='concluido')||(aba==='pendentes'&&r.agendamento_id))return'<td class="acoes"><button type="button" class="ag-mini" data-ac="alterar" data-id="'+esc(r.agendamento_id)+'">Alterar</button><button type="button" class="ag-mini perigo" data-ac="cancelar" data-id="'+esc(r.agendamento_id)+'">Cancelar</button><button type="button" class="ag-mini" data-ac="hist" data-nota="'+esc(r.nota_id)+'">Histórico</button></td>';
    if(aba==='sem'||aba==='pendentes')return'<td class="acoes"><button type="button" class="ag-mini primary" data-ac="agendar" data-nota="'+esc(r.nota_id)+'">Agendar</button>'+botaoWa(r)+'<button type="button" class="ag-mini" data-ac="hist" data-nota="'+esc(r.nota_id)+'">Histórico</button></td>';
    return'<td class="acoes"><button type="button" class="ag-mini" data-ac="hist" data-nota="'+esc(r.nota_id)+'">Histórico</button></td>'
  }
}
function celulaDado(r,k,num){
  if(k==='situacao')return'<td>'+st(r.situacao,r)+(r.erro_integracao&&r.situacao==='verificar'?'<div style="font-size:10px;color:#92400e">'+esc(r.erro_integracao)+'</div>':'')+'</td>';
  const v=valor(r,k);
  // destinatário: o aviso com nome, cidade e telefone aparece ao passar o mouse (ver mostrarCliente)
  if(k==='destinatario'&&r.nota_id)return'<td class="ag-dest" data-nota="'+esc(r.nota_id)+'">'+esc(v)+(r.localizacao?'<button type="button" class="ag-pin" data-ac="local" data-nota="'+esc(r.nota_id)+'" title="Localização do cliente">📍</button>':'')+seloLink(r)+'</td>';
  return'<td class="'+(num?'n':'')+(k==='produto'?' prod':k==='observacao'?' obs':'')+'" title="'+esc(k==='produto'&&v&&ORIGEM_PROD[r.produto_fonte]?v+' ('+ORIGEM_PROD[r.produto_fonte]+')':k==='produto'||k==='observacao'||k==='remetente'||k==='destinatario'?v:'')+'">'+(k==='nf'?'<b>'+esc(v)+'</b>':k==='produto'?'<div class="ag-prod">'+esc(v)+'</div>':esc(v))+'</td>'
}
// Aviso sobre o destinatário: nome do cliente, cidade e telefone (do XML do CT-e/NF-e).
function textoFone(r){
  if(r.telefone)return String(r.telefone).split(/\s*\/\s*/).filter(Boolean).map(f=>'<a href="tel:'+esc(f.replace(/\D/g,''))+'">'+esc(f)+'</a>').join(' &nbsp;·&nbsp; ');
  return'<span class="muted">'+(r.telefone===''?'não informado na nota':'buscando no SSW…')+'</span>'
}
let popTimer=null;
function mostrarCliente(td){
  const id=td.dataset.nota,r=(ultimaLista&&ultimaLista.rows||[]).find(x=>String(x.nota_id)===id);
  if(!r)return;
  let pop=q('#agPop');
  if(!pop){pop=document.createElement('div');pop.id='agPop';pop.className='ag-pop';document.body.appendChild(pop);
    pop.addEventListener('mouseenter',()=>clearTimeout(popTimer));
    pop.addEventListener('click',e=>{const b=e.target.closest('[data-pop-local]');if(!b)return;pop.style.display='none';abrirLocal(b.dataset.popLocal)});pop.addEventListener('mouseleave',esconderCliente)}
  clearTimeout(popTimer);
  pop.innerHTML='<div class="ag-pop-nome">'+esc(r.destinatario||'—')+'</div>'+
    '<div><span class="ag-pop-rot">Cidade</span>'+esc([r.cidade,r.uf].filter(Boolean).join('/')||'—')+'</div>'+
    '<div><span class="ag-pop-rot">Telefone</span>'+textoFone(r)+'</div>'+
    '<div><span class="ag-pop-rot">Local</span>'+(r.localizacao?'<a href="'+esc(r.localizacao.link)+'" target="_blank" rel="noopener">Abrir mapa</a><button type="button" class="ag-mini" data-pop-local="'+esc(r.nota_id)+'">Ver / enviar ao motorista</button>':'<span class="muted">sem link</span><button type="button" class="ag-mini" data-pop-local="'+esc(r.nota_id)+'">+ Colar link</button>')+'</div>';
  pop.style.display='block';
  const b=td.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight;
  let top=b.bottom+6,left=Math.min(b.left,window.innerWidth-w-8);
  if(top+h>window.innerHeight-8)top=b.top-h-6;
  pop.style.top=Math.max(8,top)+'px';pop.style.left=Math.max(8,left)+'px';
}
function esconderCliente(){clearTimeout(popTimer);popTimer=setTimeout(()=>{const p=q('#agPop');if(p)p.style.display='none'},150)}

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
    if(reservaDe(r)==='outro'&&!painel.pode_configurar){msg('O cliente '+(r.destinatario||'')+' está reservado para '+r.reserva.usuario+'. Só ele agenda até liberar.','err');return}
    q('#agNf').value=r.nf;usarLocal(r);window.scrollTo({top:0,behavior:'smooth'});q('#agForm').scrollIntoView({block:'nearest'});q('#agData').focus();return
  }
  if(ac==='hist')return historico(b.dataset.nota);
  if(ac==='walink')return linkWhatsapp(b);
  if(ac==='local')return abrirLocal(b.dataset.nota);
  if(ac==='reservar'||ac==='liberar'){
    const r=(ultimaLista?.rows||[]).find(x=>String(x.nota_id)===String(b.dataset.nota));
    if(ac==='liberar'&&reservaDe(r)==='outro'&&!confirm('Liberar a reserva de '+r.reserva.usuario+' para '+(r.destinatario||'este cliente')+'?'))return;
    b.disabled=true;
    try{await api('/api/painel/agendamentos/notas/'+b.dataset.nota+'/reserva',{method:ac==='reservar'?'POST':'DELETE'});msg(ac==='reservar'?'Cliente '+(r?.destinatario||'')+' reservado para você até o fim do dia.':'Reserva liberada.','ok')}
    catch(e){msg(e.message,'err')}
    return carregarLista();
  }
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
  if(d.open)return;if(d.showModal)d.showModal();else d.setAttribute('open','')
}
// ------------------------------------------------------------------ histórico de ações (administrador)
const ROT_EV={agendado:'Agendou',reagendado:'Reagendou',observacao:'Alterou observação',cancelado:'Cancelou',entregue:'Entregue',produto:'Alterou produto',importada:'Importou do SSW',devolvida:'Devolvida (SSW)',status:'Situação no SSW',localizacao:'Localização',reservado:'Reservou cliente',reserva_liberada:'Liberou reserva'};
async function auditoria(){
  const hoje=painel?.hoje||'';
  dialogo('<h3>📜 Histórico de ações dos usuários</h3><div class="muted">Tudo o que cada usuário fez no agendamento: agendar, reagendar, cancelar, reservar, produto e localização.</div>'+
    '<div class="ag-aud-filtros" id="agAudF"><label>Usuário<select name="usuario"><option value="">Todos</option></select></label><label>De<input type="date" name="de" value="'+esc(hoje)+'"></label><label>Até<input type="date" name="ate" value="'+esc(hoje)+'"></label>'+
    '<label>Ação<select name="tipo"><option value="">Todas</option>'+Object.entries(ROT_EV).map(([k,v])=>'<option value="'+k+'">'+esc(v)+'</option>').join('')+'</select></label><label>NF<input name="nf" inputmode="numeric"></label><div style="display:flex;gap:4px"><button class="ag-btn primary" type="button" id="agAudOk">Filtrar</button><button class="ag-btn" type="button" id="agAudCsv">Excel (CSV)</button></div></div>'+
    '<div id="agAudRes" class="muted">Carregando…</div>');
  const d=q('#agDlg');d.classList.add('largo');d.addEventListener('close',()=>d.classList.remove('largo'),{once:true});
  let ult=null;
  const filtrar=async()=>{
    const f=new URLSearchParams();q('#agAudF').querySelectorAll('[name]').forEach(x=>{if(x.value)f.set(x.name,x.value)});
    q('#agAudRes').innerHTML='Carregando…';
    try{
      const j=await api('/api/painel/agendamentos/auditoria?'+f);ult=j;
      const sel=q('#agAudF [name=usuario]'),v=sel.value;sel.innerHTML='<option value="">Todos</option>'+j.usuarios.map(x=>'<option'+(x===v?' selected':'')+'>'+esc(x)+'</option>').join('');
      q('#agAudRes').innerHTML='<b>Por usuário</b><div class="ag-aud-box" style="max-height:20vh;margin:4px 0 8px"><table><thead><tr><th>Usuário</th><th>Ações</th><th>Agendou</th><th>Reagendou</th><th>Cancelou</th><th>Reservas</th><th>Última</th></tr></thead><tbody>'+
        (j.por_usuario.map(x=>'<tr><td><b>'+esc(x.usuario)+'</b></td><td>'+nfmt(x.acoes)+'</td><td>'+nfmt(x.agendados)+'</td><td>'+nfmt(x.reagendados)+'</td><td>'+nfmt(x.cancelados)+'</td><td>'+nfmt(x.reservas)+'</td><td>'+esc(dh(x.ultima))+'</td></tr>').join('')||'<tr><td colspan="7">Nenhuma ação no período.</td></tr>')+'</tbody></table></div>'+
        '<b>Ações ('+nfmt(j.rows.length)+(j.rows.length>=1000?', as 1.000 mais recentes':'')+')</b><div class="ag-aud-box"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>NF</th><th>Cliente</th><th>De</th><th>Para</th><th>Detalhe</th></tr></thead><tbody>'+
        (j.rows.map(e=>'<tr><td>'+esc(dh(e.criado_em))+'</td><td>'+esc(e.usuario||'(sistema)')+'</td><td>'+esc(ROT_EV[e.tipo]||e.tipo)+'</td><td>'+esc(e.nf||'')+'</td><td>'+esc(e.destinatario||'')+(e.cidade?' <span class="muted">'+esc(e.cidade)+'</span>':'')+'</td><td>'+esc(e.de||'')+'</td><td>'+esc(e.para||'')+'</td><td>'+esc(e.detalhe||'')+'</td></tr>').join('')||'<tr><td colspan="8">Nenhuma ação.</td></tr>')+'</tbody></table></div>';
    }catch(e){q('#agAudRes').textContent=e.message}
  };
  q('#agAudOk').onclick=filtrar;
  q('#agAudCsv').onclick=()=>{if(!ult)return;const c=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const csv='\ufeff'+[['Quando','Usuário','Ação','NF','CT-e','Cliente','Cidade','De','Para','Detalhe'].map(c).join(';'),...ult.rows.map(e=>[dh(e.criado_em),e.usuario||'(sistema)',ROT_EV[e.tipo]||e.tipo,e.nf,e.ctrc,e.destinatario,e.cidade,e.de,e.para,e.detalhe].map(c).join(';'))].join('\r\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='historico-acoes-agendamento.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
  filtrar();
}

// ------------------------------------------------------------------ relatório dos links do WhatsApp (SAC)
async function relatorioWhatsapp(){
  const hoje=painel?.hoje||'';
  dialogo('<h3>📊 Relatório WhatsApp</h3><div class="muted">Links de agendamento enviados pelo botão 📲 WhatsApp: quem do SAC enviou, se o cliente abriu o link e se escolheu a data.</div>'+
    '<div class="ag-aud-filtros" id="agWrF"><label>Atendente<select name="usuario"><option value="">Todos</option></select></label><label>De<input type="date" name="de" value="'+esc(hoje)+'"></label><label>Até<input type="date" name="ate" value="'+esc(hoje)+'"></label>'+
    '<div style="display:flex;gap:4px"><button class="ag-btn primary" type="button" id="agWrOk">Filtrar</button><button class="ag-btn" type="button" id="agWrCsv">Excel (CSV)</button></div></div>'+
    '<div id="agWrRes" class="muted">Carregando…</div>');
  const d=q('#agDlg');d.classList.add('largo');d.addEventListener('close',()=>d.classList.remove('largo'),{once:true});
  let ult=null;const sim=(v,h)=>v?'✅ '+esc(h?dh(h):''):'—';
  const filtrar=async()=>{
    const f=new URLSearchParams();q('#agWrF').querySelectorAll('[name]').forEach(x=>{if(x.value)f.set(x.name,x.value)});q('#agWrRes').innerHTML='Carregando…';
    try{
      const j=await api('/api/painel/agendamento-whatsapp/relatorio?'+f);ult=j;const t=j.total;
      const sel=q('#agWrF [name=usuario]'),v=sel.value;sel.innerHTML='<option value="">Todos</option>'+j.usuarios.map(x=>'<option'+(x===v?' selected':'')+'>'+esc(x)+'</option>').join('');
      q('#agWrRes').innerHTML='<div style="display:flex;gap:16px;flex-wrap:wrap;margin:6px 0 10px"><span>📤 Enviados <b>'+nfmt(t.enviados)+'</b></span><span>👀 Abriram o link <b>'+nfmt(t.abriram)+'</b></span><span>✅ Escolheram a data <b>'+nfmt(t.responderam)+'</b> ('+t.pct_resposta+'%)</span><span>⏳ Sem resposta <b>'+nfmt(t.sem_resposta)+'</b></span></div>'+
        '<b>Por atendente</b><div class="ag-aud-box" style="max-height:20vh;margin:4px 0 8px"><table><thead><tr><th>Atendente</th><th>Enviados</th><th>Abriram</th><th>Escolheram a data</th><th>% resposta</th><th>Sem resposta</th><th>Último envio</th></tr></thead><tbody>'+
        (j.por_usuario.map(x=>'<tr><td><b>'+esc(x.usuario)+'</b></td><td>'+nfmt(x.enviados)+'</td><td>'+nfmt(x.abriram)+'</td><td>'+nfmt(x.responderam)+'</td><td>'+x.pct_resposta+'%</td><td>'+nfmt(x.sem_resposta)+'</td><td>'+esc(dh(x.ultimo))+'</td></tr>').join('')||'<tr><td colspan="7">Nenhum envio no período.</td></tr>')+'</tbody></table></div>'+
        '<b>Envios ('+nfmt(j.rows.length)+')</b><div class="ag-aud-box"><table><thead><tr><th>Enviado</th><th>Atendente</th><th>Cliente</th><th>NF</th><th>Abriu o link</th><th>Escolheu a data</th><th>Situação</th></tr></thead><tbody>'+
        (j.rows.map(r=>'<tr><td>'+esc(dh(r.enviado_em))+'</td><td>'+esc(r.usuario||'')+'</td><td>'+esc(r.destinatario||'')+' <span class="muted">'+esc([r.cidade,r.uf].filter(Boolean).join('/'))+'</span></td><td>'+esc(r.nfs||'')+'</td><td>'+sim(r.abriu,r.aberto_em)+'</td><td>'+(r.respondeu?'✅ '+esc(br(r.data_escolhida))+' <span class="muted">('+esc(dh(r.escolhido_em))+')</span>':'—')+'</td><td>'+esc(r.situacao)+(r.agendada_para&&!r.respondeu?' <span class="muted">'+esc(br(r.agendada_para))+'</span>':'')+'</td></tr>').join('')||'<tr><td colspan="7">Nenhum envio.</td></tr>')+'</tbody></table></div>';
    }catch(e){q('#agWrRes').textContent=e.message}
  };
  q('#agWrOk').onclick=filtrar;
  q('#agWrCsv').onclick=()=>{if(!ult)return;const c=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const csv='\ufeff'+[['Enviado','Atendente','Cliente','Cidade','NF','Abriu o link','Escolheu a data','Data escolhida','Situação','Agendada para'].map(c).join(';'),...ult.rows.map(r=>[dh(r.enviado_em),r.usuario,r.destinatario,[r.cidade,r.uf].filter(Boolean).join('/'),r.nfs,r.abriu?dh(r.aberto_em):'',r.respondeu?dh(r.escolhido_em):'',r.data_escolhida?br(r.data_escolhida):'',r.situacao,r.agendada_para?br(r.agendada_para):''].map(c).join(';'))].join('\r\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='relatorio-whatsapp-agendamento.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
  filtrar();
}

// ------------------------------------------------------------------ localização do cliente
// Link recebido no WhatsApp: abre o mapa num pop-up, guarda para as próximas notas do cliente e encaminha ao motorista.
let motoristas=null;
const urlGoogle=l=>l.lat!=null?'https://www.google.com/maps/search/?api=1&query='+l.lat+','+l.lon:l.link;
const urlWaze=l=>l.lat!=null?'https://waze.com/ul?ll='+l.lat+','+l.lon+'&navigate=yes':'';
function textoMotorista(r,l){
  const dados=['📦 Entrega NF '+r.nf+(r.ctrc?' (CT-e '+r.ctrc+')':''),'Cliente: '+(r.destinatario||''),'Cidade: '+[r.cidade,r.uf].filter(Boolean).join('/'),
    r.endereco?'Endereço: '+r.endereco:'',r.telefone?'Telefone do cliente: '+r.telefone:'',r.data_agendada?'Agendada para: '+br(r.data_agendada):'',r.volumes?'Volumes: '+nfmt(r.volumes):''].filter(Boolean);
  return dados.join('\n')+'\n\n📍 Localização: '+urlGoogle(l)+(urlWaze(l)?'\nWaze: '+urlWaze(l):'')
}
function foneWa(f){let d=String(f||'').replace(/\D/g,'').replace(/^0+/,'');if(d.length===10||d.length===11)d='55'+d;return d.length>=12?d:''}
async function abrirLocal(notaId){
  const r=(ultimaLista?.rows||[]).find(x=>String(x.nota_id)===String(notaId));if(!r)return;
  const l=r.localizacao;
  dialogo('<h3>📍 Localização • '+esc(r.destinatario||'')+'</h3><div class="muted">'+esc([r.cidade,r.uf].filter(Boolean).join('/'))+' • NF '+esc(r.nf)+(r.endereco?' • '+esc(r.endereco):'')+'</div>'+
    (l?(l.lat!=null?'<div id="agLocMapa" class="ag-loc-mapa"></div>':'<div class="ag-msg">Link sem coordenadas (o mapa não aparece aqui): abra pelo botão.</div>')+
      '<div class="ag-loc-link">'+esc(l.link)+(l.por?' • colado por '+esc(l.por)+' em '+esc(dh(l.em)):'')+'</div>'+
      '<div class="ag-loc-acoes"><a class="ag-btn primary" href="'+esc(urlGoogle(l))+'" target="_blank" rel="noopener">Abrir no Google Maps</a>'+(urlWaze(l)?'<a class="ag-btn" href="'+esc(urlWaze(l))+'" target="_blank" rel="noopener">Abrir no Waze</a>':'')+'<button type="button" class="ag-btn" id="agLocCopia">Copiar link</button></div>'+
      '<div class="ag-loc-sec"><b>Encaminhar ao motorista</b><div class="muted">Abre o WhatsApp com os dados da entrega e a localização.</div>'+
      '<label>Motorista<select id="agLocMot"><option value="">carregando…</option></select></label><label>Ou o celular do motorista<input id="agLocFone" inputmode="tel" placeholder="(11) 99999-9999"></label>'+
      '<label>Mensagem<textarea id="agLocTexto" rows="7" maxlength="1500">'+esc(textoMotorista(r,l))+'</textarea></label>'+
      '<div class="ag-loc-acoes"><button type="button" class="ag-btn primary" id="agLocWa">Enviar pelo WhatsApp</button><button type="button" class="ag-btn" id="agLocCopiaTxt">Copiar mensagem</button></div></div>'
    :'<div class="ag-msg">Ainda não tem a localização deste cliente.</div>')+
    '<div class="ag-loc-sec"><b>'+(l?'Trocar a localização':'Colar a localização')+'</b><div class="muted">Cole o link ou a mensagem de localização que o cliente mandou no WhatsApp (Google Maps, Waze ou coordenadas). Vale para as próximas notas deste cliente.</div>'+
    '<label>Link<textarea id="agLocNovo" rows="2" maxlength="2000" placeholder="https://maps.app.goo.gl/…"></textarea></label>'+
    '<div class="ag-loc-acoes"><button type="button" class="ag-btn primary" id="agLocSalvar">Guardar localização</button>'+(l?'<button type="button" class="ag-btn perigo" id="agLocApagar">Remover</button>':'')+'</div></div>');
  const d=q('#agDlg'),m=d.querySelector('[data-dlg-msg]'),aviso=(t,ok)=>{m.textContent=t;m.className='ag-msg '+(ok?'ok':'err')};
  const copiar=async t=>{try{await navigator.clipboard.writeText(t);aviso('Copiado.',true)}catch{aviso('Não consegui copiar: selecione e copie.')}};
  const recarregar=async()=>{await carregarLista();abrirLocal(notaId)};
  q('#agLocSalvar').onclick=async()=>{const t=q('#agLocNovo').value.trim();if(!t)return aviso('Cole o link.');const b=q('#agLocSalvar');b.disabled=true;b.textContent='Lendo o link…';
    try{const j=await api('/api/painel/agendamentos/notas/'+notaId+'/localizacao',{method:'PUT',body:{texto:t}});r.localizacao=j.localizacao;await recarregar()}catch(e){aviso(e.message);b.disabled=false;b.textContent='Guardar localização'}};
  if(!l)return;
  if(q('#agLocApagar'))q('#agLocApagar').onclick=async()=>{if(!confirm('Remover a localização deste cliente?'))return;try{await api('/api/painel/agendamentos/notas/'+notaId+'/localizacao',{method:'DELETE'});r.localizacao=null;await recarregar()}catch(e){aviso(e.message)}};
  q('#agLocCopia').onclick=()=>copiar(urlGoogle(l));
  q('#agLocCopiaTxt').onclick=()=>copiar(q('#agLocTexto').value);
  q('#agLocWa').onclick=()=>{
    const f=foneWa(q('#agLocFone').value||q('#agLocMot').value);
    if((q('#agLocFone').value||q('#agLocMot').value)&&!f)return aviso('Celular do motorista inválido.');
    window.open('https://wa.me/'+(f||'')+'?text='+encodeURIComponent(q('#agLocTexto').value),'_blank','noopener')};
  if(l.lat!=null&&window.L)setTimeout(()=>{const el=q('#agLocMapa');if(!el)return;const mp=L.map(el).setView([l.lat,l.lon],16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(mp);L.marker([l.lat,l.lon]).addTo(mp).bindPopup(esc(r.destinatario||'')).openPopup();
    d.addEventListener('close',()=>mp.remove(),{once:true})},60);
  try{motoristas=motoristas||(await api('/api/painel/agendamentos/motoristas')).rows||[]}catch{motoristas=[]}
  const sel=q('#agLocMot');if(sel)sel.innerHTML='<option value="">'+(motoristas.length?'Escolha o motorista':'Nenhum motorista com celular cadastrado')+'</option>'+motoristas.map(x=>'<option value="'+esc(x.telefone)+'">'+esc(x.nome)+' • '+esc(x.telefone)+'</option>').join('');
}
async function historico(notaId){
  dialogo('<h3>Histórico</h3><div class="ag-hist">Carregando…</div>');
  {const d=q('#agDlg');d.classList.add('largo');d.addEventListener('close',()=>d.classList.remove('largo'),{once:true})}
  try{
    const j=await api('/api/painel/agendamentos/historico/'+encodeURIComponent(notaId)),n=j.nota;
    const T={agendado:'Agendado',reagendado:'Reagendado',observacao:'Observação alterada',cancelado:'Agendamento cancelado',entregue:'Entregue',produto:'Produto alterado',importada:'Importada do SSW',devolvida:'Devolvida (SSW)',status:'Situação no SSW',localizacao:'Localização',reservado:'Cliente reservado',reserva_liberada:'Reserva liberada'};
    q('#agDlg h3').textContent='Histórico • NF '+n.nf+(n.ctrc?' • CT-e '+n.ctrc:'');
    q('#agDlg .ag-hist').innerHTML='<div style="margin-bottom:6px">'+esc(n.remetente||'')+' → '+esc(n.destinatario||'')+' • '+esc([n.cidade,n.uf].filter(Boolean).join('/'))+' • '+kg(n.peso)+' kg • '+st(n.situacao,n)+(n.status_ssw?' <span class="muted">'+esc(n.status_ssw)+'</span>':'')+'</div>'+
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
// Botão do link: travado (✅ Enviado) quando o link do cliente já foi mandado hoje; amanhã libera de novo
// Cliente que recebeu o link e ainda não escolheu a data: ⏳ até 1 dia; 📞 ligar a partir de 2 dias
function seloLink(r){
  const l=r.link;if(!l||l.escolhido||r.agendamento_id)return'';
  const d=new Date(l.em).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit'});
  return l.dias>=2?'<div class="ag-link ligar" title="Link enviado em '+esc(d)+(l.por?' por '+esc(l.por):'')+' e o cliente não escolheu a data">📞 Ligar: sem resposta há '+l.dias+' dias</div>'
    :'<div class="ag-link" title="Link enviado'+(l.por?' por '+esc(l.por):'')+'">⏳ Link enviado '+esc(d)+', sem resposta</div>'
}
function botaoWa(r){
  const l=r.link;
  if(l&&l.hoje){const h=new Date(l.em).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
    return'<button type="button" class="ag-mini wa-ok" disabled title="Link enviado hoje às '+esc(h)+(l.por?' por '+esc(l.por):'')+'. Libera de novo amanhã.">✅ Enviado '+esc(h)+'</button>'}
  return'<button type="button" class="ag-mini wa" data-ac="walink" data-nota="'+esc(r.nota_id)+'" title="Abre o seu WhatsApp com a mensagem da Ana e o link para o cliente escolher a data'+(l?' (último envio: '+esc(new Date(l.em).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}))+')':'')+'">📲 WhatsApp</button>'
}
// Link de agendamento: abre o WhatsApp do SAC com a mensagem da Ana pronta; o cliente escolhe a data no link
async function linkWhatsapp(b){
  const w=window.open('','_blank');   // abre já no clique (senão o navegador bloqueia o pop-up)
  b.disabled=true;
  try{
    const j=await api('/api/painel/agendamento-whatsapp/link',{method:'POST',body:{nota_id:b.dataset.nota}});
    if(j.telefone&&w){w.location.href=j.whatsapp;msg('WhatsApp aberto com o link da '+(j.notas.length>1?'NFs '+j.notas.join(', '):'NF '+j.notas[0])+'. É só tocar em enviar.','ok')}
    else{if(w)w.close();
      try{await navigator.clipboard.writeText(j.texto)}catch(e){}
      dialogo('<h3>Sem celular na nota</h3><div class="muted">A mensagem com o link foi copiada. Cole no WhatsApp do cliente.</div><textarea rows="9" readonly style="width:100%">'+esc(j.texto)+'</textarea>',null)}
    const h=new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
    // trava o botão desta nota e das outras notas do mesmo cliente na tela, sem recarregar a lista
    document.querySelectorAll('[data-ac="walink"]').forEach(x=>{const rr=(ultimaLista&&ultimaLista.rows||[]).find(y=>String(y.nota_id)===x.dataset.nota);
      if(x===b||(rr&&j.notas.includes(rr.nf))){x.outerHTML='<button type="button" class="ag-mini wa-ok" disabled title="Link enviado hoje às '+h+'. Libera de novo amanhã.">✅ Enviado '+h+'</button>'}});
    return;
  }catch(e){if(w)w.close();msg(e.message,'err')}
  finally{if(b.isConnected)b.disabled=false}
}
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
  {const box=q('.ag-tabela-box');if(box){
    box.addEventListener('mouseover',e=>{const td=e.target.closest('td.ag-dest');if(td)mostrarCliente(td)});
    box.addEventListener('mouseout',e=>{const td=e.target.closest('td.ag-dest');if(td&&!td.contains(e.relatedTarget))esconderCliente()});
    box.addEventListener('scroll',()=>{const p=q('#agPop');if(p)p.style.display='none'},{passive:true});
  }}
  q('#agSyncBtn').onclick=sincronizar;q('#agBaixasBtn').onclick=atualizarBaixas;q('#agImpForm').onsubmit=importarFaixa;
  api('/api/painel/agendamentos/parceiros').then(j=>{q('#agImpParc').innerHTML=(j.parceiros||[]).map(t=>'<option value="'+esc(t)+'">').join('')}).catch(()=>{});
  q('#agLogBtn').onclick=logSync;
  q('#agCfgBtn').onclick=configurar;q('#agAudBtn').onclick=auditoria;q('#agWaRelBtn').onclick=relatorioWhatsapp;
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
