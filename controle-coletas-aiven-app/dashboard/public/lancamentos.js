// Lançamentos (Operação): em cima o usuário informa data, motorista, romaneio e o valor negociado;
// o sistema busca o resto no SSW. Embaixo, tudo o que foi lançado, em ordem de romaneio.
(()=>{
const q=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const hoje=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const br=iso=>String(iso||'').split('-').reverse().join('/');
const int=v=>v===null||v===undefined||v===''?'—':Number(v).toLocaleString('pt-BR');
const reais=v=>v===null||v===undefined||v===''?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const norm=v=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
// "850", "850,00", "1.200,00", "1.200" -> número; NaN quando não dá para entender
function valorDigitado(v){
  let s=String(v||'').replace(/R\$/gi,'').replace(/\s/g,'');
  if(!s)return NaN;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  return/^\d+(\.\d{1,2})?$/.test(s)?Number(s):NaN
}

let pronto=false,motoristas=[],tipos=[],operacoes=['MATCOM','ECOM','MATCOM/ECOM'],linhas=[],naFila=[],config=null;
let rom=null,romSeq=0,editando=null,timerLista=null,autoMotorista='',mexeuTipo=false,mexeuOper=false;

function msg(texto,tipo=''){const el=q('#lcMsg');if(!el)return;el.textContent=texto;el.className='lc-msg'+(tipo?' '+tipo:'')}
async function api(url,opts){
  const r=await fetch(url,{cache:'no-store',...(opts||{}),headers:opts&&opts.body?{'Content-Type':'application/json'}:undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false){const e=new Error(j.error||('Não consegui falar com o sistema (erro '+r.status+').'));e.status=r.status;e.dados=j;throw e}
  return j
}

// ---------------------------------------------------------------- formulário
function preencherListas(){
  q('#lcDriverList').innerHTML=motoristas.map(m=>'<option value="'+esc(m.motorista)+'">'+esc([m.veiculo_tipo,m.ultimo?'último em '+br(m.ultimo):m.origem==='ssw'?'no SSW hoje':''].filter(Boolean).join(' • '))+'</option>').join('');
  const sel=q('#lcTipo'),atual=sel.value;
  const lista=[...new Set([...tipos,'FIORINO','VAN'].map(t=>String(t||'').toUpperCase()).filter(Boolean))];
  sel.innerHTML='<option value="">Escolha</option>'+lista.map(t=>'<option>'+esc(t)+'</option>').join('');
  if(lista.includes(atual))sel.value=atual;
  const op=q('#lcOper'),oa=op.value;
  op.innerHTML='<option value="">Escolha</option>'+operacoes.map(t=>'<option>'+esc(t)+'</option>').join('');
  if(operacoes.includes(oa))op.value=oa
}
function padroesDoMotorista(){
  const m=motoristas.find(x=>norm(x.motorista)===norm(q('#lcDriver').value));
  if(!m)return;
  if(!mexeuTipo&&m.veiculo_tipo&&[...q('#lcTipo').options].some(o=>o.value===m.veiculo_tipo))q('#lcTipo').value=m.veiculo_tipo;
  if(!mexeuOper&&m.operacao&&operacoes.includes(m.operacao))q('#lcOper').value=m.operacao
}
function mostrarRomaneio(){
  const el=q('#lcRomInfo');
  if(!rom){el.hidden=true;el.textContent='';return}
  el.hidden=false;
  if(rom.buscando){el.className='lc-rom';el.textContent='Procurando o romaneio no SSW…';return}
  if(rom.erro){el.className='lc-rom bad';el.textContent=rom.erro;return}
  if(!rom.encontrado){el.className='lc-rom warn';el.textContent='Romaneio não encontrado no SSW em '+br(rom.data)+'. Confira o número e a data. Se estiver certo, pode lançar mesmo assim e completar depois.';return}
  el.className='lc-rom ok';
  el.innerHTML='<b>'+esc(rom.romaneio_ssw)+'</b> • '+esc(rom.motorista_ssw||'sem motorista no SSW')+(rom.placa?' • placa '+esc(rom.placa):'')+' • '+int(rom.entregas)+' entrega(s). Km, frete e cidades o sistema completa depois de lançar.'
}
async function buscarRomaneio(){
  const numero=q('#lcRom').value.trim(),data=q('#lcData').value||hoje();
  if(!numero){rom=null;mostrarRomaneio();return}
  if(rom&&!rom.buscando&&rom.digitado===numero&&rom.data===data)return;
  const meu=++romSeq;
  rom={buscando:true,digitado:numero,data};mostrarRomaneio();
  try{
    const j=await api('/api/lancamentos/romaneio?numero='+encodeURIComponent(numero)+'&data='+encodeURIComponent(data));
    if(meu!==romSeq)return;
    rom={...j,digitado:numero,data};
    if(j.encontrado){
      const campo=q('#lcDriver');
      // só preenche o motorista se o usuário ainda não escolheu um (ou se foi o sistema que preencheu)
      if(j.motorista&&(!campo.value.trim()||norm(campo.value)===norm(autoMotorista))){campo.value=j.motorista;autoMotorista=j.motorista;padroesDoMotorista()}
      if(!mexeuTipo&&j.veiculo_tipo&&[...q('#lcTipo').options].some(o=>o.value===j.veiculo_tipo))q('#lcTipo').value=j.veiculo_tipo;
      if(!mexeuOper&&j.operacao&&operacoes.includes(j.operacao))q('#lcOper').value=j.operacao
    }
  }catch(e){if(meu!==romSeq)return;rom={erro:e.message,digitado:numero,data}}
  mostrarRomaneio()
}
function limparFormulario(manterData=true){
  const d=q('#lcData').value;
  q('#lcForm').reset();
  q('#lcData').value=manterData&&d?d:hoje();
  rom=null;editando=null;autoMotorista='';mexeuTipo=false;mexeuOper=false;romSeq++;
  mostrarRomaneio();
  q('#lcSave').textContent='Lançar';q('#lcCancel').hidden=true;q('#lcFormTitle').textContent='Novo lançamento'
}
async function salvar(e){
  e.preventDefault();
  const corpo={data:q('#lcData').value||hoje(),motorista:q('#lcDriver').value.trim(),romaneio:q('#lcRom').value.trim(),valor:valorDigitado(q('#lcValor').value),
    operacao:q('#lcOper').value,veiculo_tipo:q('#lcTipo').value,conferente:q('#lcConf').value.trim(),erros:q('#lcErros').value.trim()};
  if(corpo.motorista.length<2){msg('Informe o motorista.','warn');q('#lcDriver').focus();return}
  if(!corpo.romaneio){msg('Informe o número do romaneio.','warn');q('#lcRom').focus();return}
  if(!Number.isFinite(corpo.valor)){msg('Informe o valor negociado com o motorista (ex.: 850,00).','warn');q('#lcValor').focus();return}
  if(!corpo.operacao){msg('Escolha a operação.','warn');q('#lcOper').focus();return}
  if(!corpo.veiculo_tipo){msg('Escolha o tipo de carro.','warn');q('#lcTipo').focus();return}
  const btn=q('#lcSave');btn.disabled=true;
  const enviar=async forcar=>editando
    ?api('/api/lancamentos/'+editando.id,{method:'PATCH',body:JSON.stringify({...corpo,...(norm(corpo.romaneio)===norm(editando.romaneio)?{romaneio:undefined}:{}),forcar})})
    :api('/api/lancamentos',{method:'POST',body:JSON.stringify({...corpo,forcar})});
  try{
    let j;
    try{j=await enviar(false)}
    catch(err){
      if(!err.dados?.naoEncontrado)throw err;
      if(!confirm(err.message+'\n\nLançar mesmo assim? Km, frete e entregas ficam em branco até o romaneio aparecer no SSW.')){msg('Lançamento não gravado: confira o número do romaneio.','warn');return}
      j=await enviar(true)
    }
    const r=j.row;
    msg((editando?'Alteração gravada: ':'Lançado: ')+'romaneio '+r.romaneio+' • '+r.motorista+' • '+reais(r.valor)+(r.calculo?.status==='pendente'?'. Buscando km, frete e cidades no SSW…':'.'),'ok');
    q('#lcDe').value=r.data;if(q('#lcAte').value<r.data||!editando)q('#lcAte').value=r.data;
    limparFormulario(true);
    await carregarLista();
    carregarMotoristas();
    q('#lcDriver').focus()
  }catch(err){
    msg('✗ '+err.message,'bad')
  }finally{btn.disabled=false}
}
function editar(id){
  const r=linhas.find(x=>x.id===id);if(!r)return;
  editando=r;
  q('#lcData').value=r.data;q('#lcDriver').value=r.motorista;q('#lcRom').value=r.romaneio;q('#lcValor').value=r.valor===null?'':Number(r.valor).toLocaleString('pt-BR',{minimumFractionDigits:2});
  preencherListas();
  if(r.veiculo_tipo&&![...q('#lcTipo').options].some(o=>o.value===r.veiculo_tipo))q('#lcTipo').insertAdjacentHTML('beforeend','<option>'+esc(r.veiculo_tipo)+'</option>');
  q('#lcTipo').value=r.veiculo_tipo||'';q('#lcOper').value=operacoes.includes(r.operacao)?r.operacao:'';
  q('#lcConf').value=r.conferente||'';q('#lcErros').value=r.erros||'';
  mexeuTipo=mexeuOper=true;autoMotorista='';rom=null;mostrarRomaneio();
  q('#lcSave').textContent='Salvar alteração';q('#lcCancel').hidden=false;q('#lcFormTitle').textContent='Alterando o romaneio '+r.romaneio;
  msg('Altere o que precisar e clique em Salvar alteração.');
  q('#lcForm').scrollIntoView({behavior:'smooth',block:'nearest'});q('#lcValor').focus()
}
async function excluir(id){
  const r=linhas.find(x=>x.id===id);if(!r)return;
  if(!confirm('Excluir o lançamento do romaneio '+r.romaneio+' ('+r.motorista+', '+reais(r.valor)+')?'))return;
  try{await api('/api/lancamentos/'+id,{method:'DELETE'});msg('Lançamento do romaneio '+r.romaneio+' excluído.','ok');if(editando?.id===id)limparFormulario();await carregarLista()}
  catch(e){msg('✗ '+e.message,'bad')}
}
async function recalcular(id){
  try{await api('/api/lancamentos/'+id+'/recalcular',{method:'POST'});msg('Buscando de novo os dados do romaneio no SSW…','ok');naFila.push(id);renderLista();agendar(4000)}
  catch(e){msg('✗ '+e.message,'bad')}
}

// ---------------------------------------------------------------- lista
function situacao(r){
  if(naFila.includes(r.id)||r.calculo?.status==='pendente')return'<span class="lc-tag wait" title="Buscando km, frete e cidades no SSW">buscando no SSW…</span>';
  if(!r.romaneio_ssw)return'<span class="lc-tag warn" title="O romaneio não foi encontrado no SSW na data do lançamento">sem SSW</span>';
  if(r.calculo?.status==='erro')return'<span class="lc-tag bad" title="'+esc(r.calculo.msg||'')+'">não completou</span>';
  if(r.calculo?.status==='parcial'||r.calculo?.msg)return'<span class="lc-tag warn" title="'+esc(r.calculo.msg||'')+'">conferir</span>';
  return'<span class="lc-tag ok">completo</span>'
}
function renderLista(){
  const box=q('#lcTable'),tot=q('#lcTotais'),de=q('#lcDe').value,ate=q('#lcAte').value,varios=de!==ate;
  q('#lcListTitle').textContent='Lançamentos '+(varios?'de '+br(de)+' a '+br(ate):'de '+br(de));
  if(!linhas.length){box.innerHTML='<div class="lc-empty">Nenhum lançamento '+(varios?'neste período':'nesta data')+'.</div>';tot.innerHTML='';return}
  const s={ent:0,real:0,km:0,valor:0,frete:0,valorComFrete:0};
  const corpo=linhas.map(r=>{
    const feitas=r.realizadas??r.ao_vivo;
    s.ent+=Number(r.entregas||0);s.real+=Number(feitas||0);s.km+=Number(r.km||0);s.valor+=Number(r.frete_mot_liq??r.valor??0);s.frete+=Number(r.frete_vialog||0);if(r.frete_vialog>0)s.valorComFrete+=Number(r.frete_mot_liq??r.valor??0);
    const pct=r.frete_vialog>0&&r.valor!==null?Math.round((r.frete_mot_liq??r.valor)/r.frete_vialog*100)+'%':'—';
    return'<tr data-lc-row="'+esc(r.id)+'"'+(editando?.id===r.id?' class="editing"':'')+'>'+(varios?'<td>'+br(r.data).slice(0,5)+'</td>':'')+
      '<td><b>'+esc(r.romaneio)+'</b></td><td>'+esc(r.motorista)+'</td><td>'+esc(r.veiculo_tipo||'—')+(r.placa?'<small>'+esc(r.placa)+'</small>':'')+'</td><td>'+esc(r.operacao||'—')+'</td>'+
      '<td class="n">'+int(r.entregas)+'</td><td class="n">'+(feitas===null||feitas===undefined?'—':int(feitas)+(r.realizadas===null&&r.ao_vivo!==null?'<small>até agora</small>':''))+'</td><td class="n">'+(r.km?int(r.km):'—')+'</td>'+
      '<td class="n"><b>'+reais(r.valor)+'</b></td><td class="n">'+reais(r.frete_vialog)+'</td><td class="n">'+pct+'</td>'+
      '<td class="rota" title="'+esc(r.rota||'')+'">'+esc(r.rota||'—')+'</td><td>'+esc(r.conferente||'—')+(r.erros?'<small>'+int(r.erros)+' erro(s)</small>':'')+'</td><td>'+situacao(r)+'</td>'+
      '<td class="acts"><button type="button" data-lc-edit="'+esc(r.id)+'" title="Alterar" aria-label="Alterar o romaneio '+esc(r.romaneio)+'">✎</button><button type="button" data-lc-calc="'+esc(r.id)+'" title="Buscar de novo no SSW" aria-label="Buscar de novo no SSW">↻</button><button type="button" class="rm" data-lc-del="'+esc(r.id)+'" title="Excluir" aria-label="Excluir o romaneio '+esc(r.romaneio)+'">✕</button></td></tr>'
  }).join('');
  box.innerHTML='<table><thead><tr>'+(varios?'<th>Data</th>':'')+'<th>Romaneio</th><th>Motorista</th><th>Carro</th><th>Operação</th><th class="n">Entregas</th><th class="n">Realizadas</th><th class="n">Km</th><th class="n">Valor negociado</th><th class="n">Frete</th><th class="n">% do frete</th><th>Cidades</th><th>Conferente</th><th>Situação</th><th></th></tr></thead><tbody>'+corpo+'</tbody></table>';
  tot.innerHTML='<span><b>'+int(linhas.length)+'</b> romaneio(s)</span><span><b>'+int(s.ent)+'</b> entregas</span><span><b>'+int(s.real)+'</b> realizadas</span><span><b>'+int(s.km)+'</b> km</span><span>Motoristas <b>'+reais(s.valor)+'</b></span><span>Frete <b>'+reais(s.frete)+'</b></span>'+(s.frete>0?'<span title="Só os romaneios que já têm o frete">Motoristas = <b>'+Math.round(s.valorComFrete/s.frete*100)+'%</b> do frete</span>':'')
}
function agendar(ms){clearTimeout(timerLista);timerLista=setTimeout(()=>{if(q('#lancamentos')?.classList.contains('active'))carregarLista(true)},ms)}
async function carregarLista(silencioso=false){
  const de=q('#lcDe').value||hoje(),ate=q('#lcAte').value>=de?q('#lcAte').value:de;
  q('#lcAte').value=ate;
  try{
    const j=await api('/api/lancamentos?de='+encodeURIComponent(de)+'&ate='+encodeURIComponent(ate));
    linhas=j.rows||[];naFila=j.naFila||[];
    renderLista();
    // enquanto o sistema busca no SSW, olha de novo a cada 6 s; depois, a cada minuto (baixas)
    agendar(linhas.some(r=>naFila.includes(r.id)||r.calculo?.status==='pendente')?6000:60000)
  }catch(e){if(!silencioso)msg('✗ '+e.message,'bad')}
}
async function carregarMotoristas(){
  try{
    const j=await api('/api/lancamentos/motoristas');
    motoristas=[...(j.rows||[]),...(j.novosNoSsw||[]).map(n=>({motorista:n,origem:'ssw'}))];tipos=j.tipos||[];operacoes=j.operacoes||operacoes;
    preencherListas()
  }catch{}
}

// ---------------------------------------------------------------- histórico da planilha (administrador)
function renderConfig(){
  const box=q('#lcAdmin');if(!box)return;
  if(!config||!config.is_admin){box.hidden=true;return}
  box.hidden=false;
  const noSistema=config.fonte==='sistema';
  box.innerHTML='<div><b>Painéis (Visão Geral e Dashboards) lendo de: '+(noSistema?'sistema':'planilha')+'</b><div class="muted">'+
    (noSistema?'Histórico trazido da planilha em '+new Date(config.importado_em).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})+' ('+int(config.planilha?.linhas)+' linhas) + '+int(config.sistema?.linhas)+' lançamento(s) feitos aqui. A planilha não é mais lida para os lançamentos.'
      :'Os painéis continuam usando a planilha. Quando você trouxer o histórico, eles passam a ler só o que está no sistema ('+int(config.sistema?.linhas)+' lançamento(s) feitos aqui até agora).')+'</div></div>'+
    '<div class="lc-admin-btns">'+(config.planilhaLigada?'<button type="button" class="lc-btn" data-lc-admin="importar">'+(noSistema?'Trazer o histórico de novo':'Trazer o histórico da planilha')+'</button>':'')+
      (config.importado_em?'<button type="button" class="lc-btn ghost" data-lc-admin="'+(noSistema?'planilha':'sistema')+'">'+(noSistema?'Voltar os painéis para a planilha':'Passar os painéis para o sistema')+'</button>':'')+'</div>'
}
async function carregarConfig(){try{config=await api('/api/lancamentos/config');renderConfig()}catch{}}
async function acaoAdmin(acao){
  try{
    if(acao==='importar'){
      if(!confirm('Trazer o histórico da planilha para o sistema?\n\nOs lançamentos antigos são copiados e, a partir de agora, os painéis leem só do sistema. O que for digitado na planilha depois disso não aparece mais (dá para trazer de novo ou voltar atrás por este mesmo quadro).'))return;
      msg('Copiando o histórico da planilha…');
      const j=await api('/api/lancamentos/importar-planilha',{method:'POST',body:'{}'});
      msg('Histórico trazido: '+int(j.gravadas)+' linha(s) da planilha'+(j.repetidas_no_sistema?' ('+int(j.repetidas_no_sistema)+' já estavam lançadas no sistema e ficou a do sistema)':'')+'. Os painéis agora leem do sistema.','ok')
    }else{
      if(!confirm(acao==='planilha'?'Voltar os painéis para a planilha? Nada é apagado; os lançamentos do sistema continuam guardados.':'Passar os painéis para o sistema?'))return;
      await api('/api/lancamentos/fonte',{method:'POST',body:JSON.stringify({fonte:acao})});
      msg(acao==='planilha'?'Painéis lendo da planilha de novo.':'Painéis lendo do sistema.','ok')
    }
    await carregarConfig()
  }catch(e){msg('✗ '+e.message,'bad')}
}

function setup(){
  if(pronto||!q('#lancamentos'))return;
  pronto=true;
  q('#lcData').value=hoje();q('#lcDe').value=hoje();q('#lcAte').value=hoje();
  preencherListas();
  q('#lcForm').onsubmit=salvar;
  q('#lcCancel').onclick=()=>{limparFormulario();msg('Alteração cancelada.');renderLista()};
  q('#lcRom').onblur=buscarRomaneio;
  q('#lcRom').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();buscarRomaneio();q('#lcValor').focus()}};
  q('#lcData').onchange=()=>{if(!editando){q('#lcDe').value=q('#lcData').value;q('#lcAte').value=q('#lcData').value;carregarLista()}if(q('#lcRom').value.trim()){rom=null;buscarRomaneio()}};
  q('#lcDriver').onchange=()=>{if(norm(q('#lcDriver').value)!==norm(autoMotorista))autoMotorista='';padroesDoMotorista()};
  q('#lcTipo').onchange=()=>{mexeuTipo=true};q('#lcOper').onchange=()=>{mexeuOper=true};
  q('#lcDe').onchange=()=>{if(q('#lcAte').value<q('#lcDe').value)q('#lcAte').value=q('#lcDe').value;carregarLista()};
  q('#lcAte').onchange=()=>carregarLista();
  q('#lcHoje').onclick=()=>{q('#lcDe').value=hoje();q('#lcAte').value=hoje();carregarLista()};
  q('#lcTable').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.lcEdit){editar(b.dataset.lcEdit);renderLista()}else if(b.dataset.lcDel)excluir(b.dataset.lcDel);else if(b.dataset.lcCalc)recalcular(b.dataset.lcCalc)};
  q('#lcAdmin').onclick=e=>{const b=e.target.closest('[data-lc-admin]');if(b)acaoAdmin(b.dataset.lcAdmin)}
}
// Chamado pelo painel quando a aba "Lançamentos" é aberta.
window.lancamentosAbrir=()=>{
  setup();
  carregarMotoristas();carregarLista();carregarConfig();
  setTimeout(()=>q('#lcDriver')?.focus(),60)
};
})();
