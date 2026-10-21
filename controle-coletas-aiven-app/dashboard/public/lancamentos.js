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
let rom=null,romSeq=0,editando=null,timerLista=null,autoMotorista='',mexeuTipo=false;
const abrindoPorKm=new Set(); // flag marcado, esperando o valor por km

function msg(texto,tipo=''){const el=q('#lcMsg');if(!el)return;el.textContent=texto;el.className='lc-msg'+(tipo?' '+tipo:'')}
async function api(url,opts){
  const r=await fetch(url,{cache:'no-store',...(opts||{}),headers:opts&&opts.body?{'Content-Type':'application/json'}:undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false){const e=new Error(j.error||('Não consegui falar com o sistema (erro '+r.status+').'));e.status=r.status;e.dados=j;throw e}
  return j
}

// ---------------------------------------------------------------- formulário
// os tipos de carro da casa primeiro; depois os que já apareceram nos lançamentos
const tiposLista=()=>[...new Set(['FIORINO','VAN','VAN COM TUBO','3/4',...tipos].map(t=>String(t||'').toUpperCase().replace(/\s+/g,' ').trim()).filter(Boolean))];
function preencherListas(){
  q('#lcDriverList').innerHTML=motoristas.map(m=>'<option value="'+esc(m.motorista)+'">'+esc([m.veiculo_tipo,m.ultimo?'último em '+br(m.ultimo):m.origem==='ssw'?'no SSW hoje':''].filter(Boolean).join(' • '))+'</option>').join('');
  const sel=q('#lcTipo'),atual=sel.value,lista=tiposLista();
  sel.innerHTML='<option value="">Escolha</option>'+lista.map(t=>'<option>'+esc(t)+'</option>').join('');
  if(lista.includes(atual))sel.value=atual;
  const op=q('#lcOper'),oa=op.value;
  op.innerHTML='<option value="">Escolha</option>'+operacoes.map(t=>'<option>'+esc(t)+'</option>').join('');
  if(operacoes.includes(oa))op.value=oa
}
function padroesDoMotorista(){
  const m=motoristas.find(x=>norm(x.motorista)===norm(q('#lcDriver').value));
  if(!m)return;
  // sugere só o tipo de carro do último lançamento do motorista; a operação é sempre escolhida pelo usuário
  if(!mexeuTipo&&m.veiculo_tipo&&[...q('#lcTipo').options].some(o=>o.value===m.veiculo_tipo))q('#lcTipo').value=m.veiculo_tipo
}
function mostrarRomaneio(){
  const el=q('#lcRomInfo');
  if(!rom){el.hidden=true;el.textContent='';return}
  el.hidden=false;
  if(rom.buscando){el.className='lc-rom';el.textContent='Procurando o romaneio no SSW…';return}
  if(rom.erro){el.className='lc-rom bad';el.textContent=rom.erro;return}
  if(!rom.encontrado){el.className='lc-rom warn';el.textContent='Romaneio não encontrado no SSW em '+br(rom.data)+'. Confira o número e a data. Se estiver certo, pode lançar mesmo assim e completar depois.';return}
  el.className='lc-rom ok';
  el.innerHTML='<b>'+esc(rom.romaneio_ssw)+'</b> • '+esc(rom.motorista_ssw||'sem motorista no SSW')+(rom.placa?' • placa '+esc(rom.placa):'')+' • '+int(rom.entregas)+' entrega(s). Km, frete Construlog e cidades o sistema completa depois de lançar.'
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
      if(!mexeuTipo&&j.veiculo_tipo&&[...q('#lcTipo').options].some(o=>o.value===j.veiculo_tipo))q('#lcTipo').value=j.veiculo_tipo
    }
  }catch(e){if(meu!==romSeq)return;rom={erro:e.message,digitado:numero,data}}
  mostrarRomaneio()
}
function limparFormulario(manterData=true){
  const d=q('#lcData').value;
  q('#lcForm').reset();
  q('#lcData').value=manterData&&d?d:hoje();
  rom=null;editando=null;autoMotorista='';mexeuTipo=false;romSeq++;q('#lcRom').readOnly=false;
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
    ?api('/api/lancamentos/'+editando.id,{method:'PATCH',body:JSON.stringify({...corpo,...(editando.partes||norm(corpo.romaneio)===norm(editando.romaneio)?{romaneio:undefined}:{}),grupo:!!editando.partes,forcar})})
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
  mexeuTipo=true;autoMotorista='';rom=null;mostrarRomaneio();
  q('#lcRom').readOnly=!!r.partes;   // vários romaneios no mesmo lançamento: o número não se altera por aqui
  q('#lcSave').textContent='Salvar alteração';q('#lcCancel').hidden=false;q('#lcFormTitle').textContent='Alterando o romaneio '+r.romaneio;
  msg('Altere o que precisar e clique em Salvar alteração.');
  q('#lcForm').scrollIntoView({behavior:'smooth',block:'nearest'});q('#lcValor').focus()
}
async function excluir(id){
  const r=linhas.find(x=>x.id===id);if(!r)return;
  if(!confirm('Excluir o lançamento do romaneio '+r.romaneio+' ('+r.motorista+(r.valor===null?'':', '+reais(r.valor))+')?'+(r.romaneio_ssw?'\n\nEle não volta sozinho para a lista. Para lançar de novo, use o formulário de cima.':'')))return;
  try{for(const i of (r.ids||[id]))await api('/api/lancamentos/'+i,{method:'DELETE'});msg('Lançamento do romaneio '+r.romaneio+' excluído.','ok');if(editando?.id===id)limparFormulario();await carregarLista()}
  catch(e){msg('✗ '+e.message,'bad')}
}
async function recalcular(id){
  const r=linhas.find(x=>x.id===id);
  try{for(const i of (r?.ids||[id])){await api('/api/lancamentos/'+i+'/recalcular',{method:'POST'});naFila.push(i)}msg('Buscando de novo os dados do romaneio no SSW…','ok');renderLista();agendar(4000)}
  catch(e){msg('✗ '+e.message,'bad')}
}

// ---------------------------------------------------------------- lista
// Cobrança por km sem valor: o valor depende da busca no SSW, então a situação é a da busca
// (fila, erro, sem SSW); "aguardando o km" só enquanto ela não terminou.
function situacao(r){
  if(r.valor===null&&!r.por_km)return'<span class="lc-tag bad" title="Informe o valor negociado com o motorista">falta o valor</span>';
  if(!r.operacao)return'<span class="lc-tag warn" title="Escolha a operação">falta a operação</span>';
  if(!r.veiculo_tipo)return'<span class="lc-tag warn" title="Escolha o tipo de carro">falta o carro</span>';
  // naFila vem na ordem da fila do servidor: o primeiro é o que está sendo buscado agora
  const pos=Math.min(...(r.ids||[r.id]).map(i=>naFila.indexOf(String(i))).filter(i=>i>=0));
  if(pos===0)return'<span class="lc-tag wait" title="Buscando km, frete e cidades no SSW">buscando no SSW…</span>';
  if(Number.isFinite(pos))return'<span class="lc-tag wait" title="Os romaneios são buscados no SSW um por vez">na fila do SSW ('+int(pos)+' na frente)</span>';
  if(r.calculo?.status==='pendente')return r.romaneio_ssw?'<span class="lc-tag wait" title="O sistema busca km, frete e cidades alguns minutos depois de o romaneio parar de mudar no SSW">'+(r.por_km&&r.valor===null?'aguardando o km':'aguardando o SSW')+'</span>':'<span class="lc-tag warn" title="O romaneio não foi encontrado no SSW na data do lançamento">sem SSW</span>';
  if(!r.romaneio_ssw)return'<span class="lc-tag warn" title="O romaneio não foi encontrado no SSW na data do lançamento">sem SSW</span>';
  if(r.calculo?.status==='erro')return'<span class="lc-tag bad longo" title="'+esc(r.calculo.msg||'')+'">não completou'+(r.calculo.msg?': '+esc(r.calculo.msg.length>40?r.calculo.msg.slice(0,40)+'…':r.calculo.msg):'')+'</span>';
  if(r.valor===null&&r.por_km)return r.calculo?'<span class="lc-tag bad" title="'+esc(r.calculo.msg||'A busca terminou sem o km da rota. Use ↻ para buscar de novo ou desligue a cobrança por km e informe o valor.')+'">sem o km da rota</span>':'<span class="lc-tag wait" title="O valor sai do km da rota vezes o valor do km">aguardando o km</span>';
  if(r.calculo?.status==='parcial'||r.calculo?.msg)return'<span class="lc-tag warn" title="'+esc(r.calculo.msg||'')+'">conferir</span>';
  return'<span class="lc-tag ok">completo</span>'
}
const kmTexto=v=>v===null||v===undefined?'':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:1});
// diferença Circuit − sistema; acima de 5% fica em destaque
function difKm(circ,km){
  const d=Math.round((circ-km)*10)/10,pct=km>0?Math.abs(d)/km:0;
  return'<small class="'+(pct>0.05?'lc-dif alto':'lc-dif')+'" title="Circuit '+kmTexto(circ)+' km • sistema '+int(km)+' km">'+(d>0?'+':d<0?'−':'')+kmTexto(Math.abs(d))+' km</small>'
}
const valorTexto=v=>v===null||v===undefined?'':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const opcoes=(lista,atual)=>'<option value="">—</option>'+[...new Set([...lista,atual].filter(Boolean))].map(t=>'<option'+(t===atual?' selected':'')+'>'+esc(t)+'</option>').join('');
// Enquanto o usuário está digitando numa linha, a lista não é redesenhada (perderia o que foi digitado).
let renderPendente=false;
function tabelaOcupada(){const a=document.activeElement;return!!(a&&a.closest&&a.closest('#lcTable')&&/^(INPUT|SELECT)$/.test(a.tagName)&&a.type!=='checkbox')}
function renderLista(){
  if(tabelaOcupada()){renderPendente=true;return}
  renderPendente=false;
  const box=q('#lcTable'),de=q('#lcDe').value,ate=q('#lcAte').value,varios=de!==ate;
  const semValor=linhas.filter(r=>r.valor===null).length;
  q('#lcListTitle').innerHTML='Lançamentos '+(varios?'de '+br(de)+' a '+br(ate):'de '+br(de))+(semValor?' <span class="lc-tag bad">'+int(semValor)+' sem valor</span>':'');
  if(!linhas.length){box.innerHTML='<div class="lc-empty">Nenhum lançamento '+(varios?'neste período':'nesta data')+'.</div>';return}
  // a coluna do conferente só aparece quando alguém usou
  const tp=tiposLista(),comConf=linhas.some(r=>r.conferente||r.erros);
  const corpo=linhas.map(r=>{
    const feitas=r.realizadas??r.ao_vivo,id=esc(r.id);
    const liq=r.frete_vialog_liq??r.frete_vialog,pct=liq>0&&r.valor!==null?Math.round((r.frete_mot_liq??r.valor)/liq*100)+'%':'—';
    return'<tr data-lc-row="'+id+'"'+(editando?.id===r.id?' class="editing"':'')+'>'+(varios?'<td>'+br(r.data).slice(0,5)+'</td>':'')+
      '<td><b>'+esc(r.romaneio)+'</b>'+(r.partes?'<small>'+r.partes.length+' romaneios, um valor</small>':'')+'</td><td>'+esc(r.motorista)+'</td>'+
      '<td><select data-lc-campo="veiculo_tipo" data-id="'+id+'" aria-label="Tipo de carro do romaneio '+esc(r.romaneio)+'"'+(r.veiculo_tipo?'':' class="falta"')+'>'+opcoes(tp,r.veiculo_tipo)+'</select>'+(r.placa?'<small>'+esc(r.placa)+'</small>':'')+'</td>'+
      '<td><select data-lc-campo="operacao" data-id="'+id+'" aria-label="Operação do romaneio '+esc(r.romaneio)+'"'+(r.operacao?'':' class="falta"')+'>'+opcoes(operacoes,r.operacao)+'</select></td>'+
      '<td class="n" title="Entregas feitas / entregas do romaneio">'+(feitas===null||feitas===undefined?int(r.entregas):'<b>'+int(feitas)+'</b> / '+int(r.entregas)+(r.realizadas===null&&r.ao_vivo!==null?'<small>até agora</small>':''))+'</td><td class="n"'+(r.km_soma?' title="Soma das rotas de cada romaneio. O km da rota única ainda está sendo calculado."':'')+'>'+(r.km?int(r.km)+(r.km_soma?'<small>soma</small>':''):'—')+
        (()=>{const on=!!r.por_km||abrindoPorKm.has(r.id);
          return '<label class="lc-pk" title="Este motorista, neste dia, recebe por km rodado"><input type="checkbox" data-lc-porkm="'+id+'"'+(on?' checked':'')+'> por km</label>'+
            (on?'<input class="lc-vkm" data-lc-vkm="'+id+'" data-no-titlecase="true" type="text" inputmode="decimal" autocomplete="off" maxlength="8" placeholder="R$/km" value="'+(r.por_km?valorTexto(r.por_km.valor_km):'')+'" aria-label="Valor por km do romaneio '+esc(r.romaneio)+'">':'')+
''})()+'</td>'+
      // km do Circuit (digitado) ao lado do km do sistema, com a diferença entre os dois
      '<td class="n lc-circ"><input data-lc-campo="km_circuit" data-id="'+id+'" data-no-titlecase="true" type="text" inputmode="decimal" autocomplete="off" maxlength="8" placeholder="km" value="'+kmTexto(r.km_circuit)+'"'+(r.km_planilha&&r.km_circuit===r.km_planilha?' title="KM do Circuit trazido da planilha"':'')+' aria-label="Km do Circuit do romaneio '+esc(r.romaneio)+'">'+(r.km_circuit!==null&&r.km_circuit!==undefined&&r.km?difKm(r.km_circuit,r.km):'')+'</td>'+
      (r.por_km?'<td class="n" title="Valor com todas as entregas: km da rota × valor do km"><b>'+reais(r.valor)+'</b><small>'+(r.km?int(r.km)+' km × '+reais(r.por_km.valor_km):'aguardando o km')+'</small></td>':'')+(r.por_km?'':'<td class="n"><input data-lc-campo="valor" data-id="'+id+'" data-no-titlecase="true" type="text" inputmode="decimal" autocomplete="off" maxlength="12" placeholder="0,00" value="'+valorTexto(r.valor)+'"'+(r.valor_planilha!==null&&r.valor_planilha!==undefined&&r.valor===r.valor_planilha?' title="Valor acordado, trazido da planilha"':'')+' aria-label="Valor negociado do romaneio '+esc(r.romaneio)+'"'+(r.valor===null?' class="falta"':'')+'></td>')+
      // líquido do motorista: o negociado menos o km das entregas que ele não fez
      '<td class="n lc-liq" title="'+(r.km_nao>0?'Descontado o km das entregas não feitas ('+int(r.km_nao)+' km de '+int(r.km)+' km)':r.desconto>0?'Desconto informado à mão':'Sem desconto')+'">'+(r.valor===null?'—':'<b>'+reais(r.frete_mot_liq??r.valor)+'</b>'+(r.desconto>0?'<small class="lc-kmnao">− '+reais(r.desconto)+(r.km_nao>0&&!r.desconto_manual?' • '+int(r.km_nao)+' km não feitos':'')+'</small>':r.km_nao===0?'<small>todas feitas</small>':''))+'</td>'+
      '<td class="n">'+reais(r.frete_vialog)+'</td><td class="n"'+(r.desconto_vialog>0?' title="Descontado o frete das entregas não feitas: '+reais(r.desconto_vialog)+'"':'')+'>'+(r.frete_vialog===null?'—':r.ctes&&r.ctes.length?'<button type="button" class="lc-link n" data-lc-frete="'+id+'" title="Ver as entregas descontadas">'+reais(liq)+'</button>':reais(liq))+(r.desconto_vialog>0?'<small>− '+reais(r.desconto_vialog)+'</small>':'')+'</td><td class="n">'+pct+'</td>'+
      '<td class="rota">'+(r.rota?'<button type="button" class="lc-link" data-lc-cidades="'+id+'" title="Ver as cidades do romaneio">'+esc(r.rota)+'</button>':'—')+'</td>'+(comConf?'<td>'+esc(r.conferente||'—')+(r.erros?'<small>'+int(r.erros)+' erro(s)</small>':'')+'</td>':'')+'<td>'+situacao(r)+'</td>'+
      '<td class="acts"><button type="button" data-lc-edit="'+id+'" title="Alterar data, motorista, conferente" aria-label="Alterar o romaneio '+esc(r.romaneio)+'">✎</button><button type="button" data-lc-calc="'+id+'" title="Buscar de novo no SSW" aria-label="Buscar de novo no SSW">↻</button><button type="button" class="rm" data-lc-del="'+id+'" title="Excluir" aria-label="Excluir o romaneio '+esc(r.romaneio)+'">✕</button></td></tr>'
  }).join('');
  box.innerHTML='<table><thead><tr>'+(varios?'<th>Data</th>':'')+'<th>Romaneio</th><th>Motorista</th><th>Carro</th><th>Operação</th><th class="n" title="Entregas feitas / entregas do romaneio">Entregas</th><th class="n">Km</th><th class="n" title="Km apontado no Circuit, para comparar com o km do sistema">Circuit</th><th class="n" title="Valor se o motorista fizer todas as entregas">Valor negociado</th><th class="n" title="Valor negociado menos o km das entregas que ele não fez">Líquido motorista</th><th class="n">Frete Construlog</th><th class="n" title="Frete do romaneio menos o frete das entregas não feitas">Frete líquido</th><th class="n" title="Valor do motorista sobre o frete líquido">% do frete</th><th>Cidades</th>'+(comConf?'<th>Conferente</th>':'')+'<th>Situação</th><th></th></tr></thead><tbody>'+corpo+'</tbody></table>'
}
// Valor, operação e carro são gravados direto na linha.
async function salvarCampo(el){
  const id=el.dataset.id,campo=el.dataset.lcCampo,r=linhas.find(x=>x.id===id);
  if(!r)return;
  const volta=()=>{el.value=campo==='valor'?valorTexto(r.valor):campo==='km_circuit'?kmTexto(r.km_circuit):(r[campo]||'')};
  let v=el.value;
  if(campo==='km_circuit'){
    v=v.trim()?valorDigitado(v.replace(/km/i,'')):null;
    if(Number.isNaN(v)){msg('Não entendi o km do Circuit do romaneio '+r.romaneio+'. Digite assim: 212 ou 212,5','warn');volta();return}
    if(v===(r.km_circuit??null)){volta();return}
  }else if(campo==='valor'){
    if(!v.trim()){volta();return}
    v=valorDigitado(v);
    if(!Number.isFinite(v)){msg('Não entendi o valor do romaneio '+r.romaneio+'. Digite assim: 850,00','warn');volta();return}
    if(v===r.valor){volta();return}
  }else if(v===(r[campo]||''))return;
  try{
    const j=await api('/api/lancamentos/'+id,{method:'PATCH',body:JSON.stringify({[campo]:v})});
    const i=linhas.findIndex(x=>(x.ids||[x.id]).includes(id));if(i>=0)linhas[i]=j.row;
    msg('Gravado: romaneio '+j.row.romaneio+' • '+j.row.motorista+' • '+(campo==='valor'?reais(j.row.valor):campo==='km_circuit'?(j.row.km_circuit===null?'km do Circuit apagado':'Circuit '+kmTexto(j.row.km_circuit)+' km'):campo==='operacao'?'operação '+(j.row.operacao||'em branco'):'carro '+(j.row.veiculo_tipo||'em branco'))+'.','ok');
    if(campo==='valor')el.value=valorTexto(j.row.valor);
    if(campo!=='km_circuit')el.classList.toggle('falta',campo==='valor'?j.row.valor===null:!v);
    renderLista()
  }catch(e){msg('✗ '+e.message,'bad');volta()}
}
// Cobrança por km: o flag abre o campo do valor por km; o sistema calcula o valor e desconta o km das entregas não feitas.
async function mudarPorKm(id,on){
  const r=linhas.find(x=>x.id===id);if(!r)return;
  if(on){abrindoPorKm.add(id);renderLista();setTimeout(()=>{const i=q('[data-lc-vkm="'+id+'"]');if(i)i.focus()},30);return}
  abrindoPorKm.delete(id);
  if(!r.por_km){renderLista();return}
  try{const j=await api('/api/lancamentos/'+id,{method:'PATCH',body:JSON.stringify({por_km:false})});const i=linhas.findIndex(x=>(x.ids||[x.id]).includes(id));if(i>=0)linhas[i]=j.row;msg('Romaneio '+j.row.romaneio+': cobrança por km desligada. Informe o valor negociado.','ok');renderLista()}
  catch(e){msg('✗ '+e.message,'bad');renderLista()}
}
async function salvarValorKm(el){
  const id=el.dataset.lcVkm,r=linhas.find(x=>x.id===id);if(!r)return;
  const v=valorDigitado(el.value);
  if(!Number.isFinite(v)||v<=0){msg('Digite o valor por km assim: 2,50','warn');return}
  if(r.por_km&&v===r.por_km.valor_km)return;
  try{
    const j=await api('/api/lancamentos/'+id,{method:'PATCH',body:JSON.stringify({por_km:true,valor_km:v})});
    abrindoPorKm.delete(id);
    const i=linhas.findIndex(x=>(x.ids||[x.id]).includes(id));if(i>=0)linhas[i]=j.row;
    msg('Romaneio '+j.row.romaneio+' • '+j.row.motorista+': cobrança por km, '+reais(v)+' o km'+(j.row.km?' → '+reais(j.row.valor):'')+'. Entrega não feita desconta o km dela.','ok');
    renderLista();agendar(15000)
  }catch(e){msg('✗ '+e.message,'bad')}
}
function abrirCidades(id){
  const r=linhas.find(x=>x.id===id),d=q('#lcCidades');
  if(!r||!d)return;
  const lista=r.cidades&&r.cidades.length?r.cidades:String(r.rota||'').split(',').map(c=>({c:c.trim(),n:0})).filter(x=>x.c);
  d.innerHTML='<div class="lc-pop-head"><div><b>Cidades do romaneio '+esc(r.romaneio)+'</b><div class="muted">'+esc(r.motorista)+' • '+br(r.data)+' • na ordem da rota</div></div><button type="button" class="lc-pop-x" data-lc-fechar aria-label="Fechar">✕</button></div>'+
    '<ol class="lc-pop-list">'+lista.map(x=>'<li><span>'+esc(x.c)+'</span>'+(x.n?'<b>'+int(x.n)+' entrega'+(x.n>1?'s':'')+'</b>':'')+'</li>').join('')+'</ol>'+
    '<div class="lc-pop-foot">'+int(lista.length)+' cidade'+(lista.length>1?'s':'')+(r.entregas?' • '+int(r.entregas)+' entregas':'')+(r.km?' • '+int(r.km)+' km':'')+'</div>';
  if(d.showModal){if(!d.open)d.showModal()}else d.setAttribute('open','')
}
// Frete líquido: o frete do romaneio menos o frete de cada entrega que não está como "01 - mercadoria entregue".
function abrirFrete(id){
  const r=linhas.find(x=>x.id===id),d=q('#lcCidades');
  if(!r||!d||!r.ctes)return;
  const fora=r.ctes.filter(x=>x.s==='o'||x.s==='p'),sem=r.ctes.filter(x=>x.s==='?'),feitas=r.ctes.filter(x=>x.s==='e').length;
  d.innerHTML='<div class="lc-pop-head"><div><b>Frete líquido • romaneio '+esc(r.romaneio)+'</b><div class="muted">'+esc(r.motorista)+' • '+br(r.data)+' • só conta a entrega com ocorrência 01 (mercadoria entregue)</div></div><button type="button" class="lc-pop-x" data-lc-fechar aria-label="Fechar">✕</button></div>'+
    '<div class="lc-pop-contas"><div><span>Frete do romaneio ('+int(r.ctes.length)+' entregas)</span><b>'+reais(r.frete_vialog)+'</b></div><div><span>Entregues ('+int(feitas)+')</span><b>'+reais(freteLiq(r))+'</b></div><div><span>Descontado ('+int(fora.length)+')</span><b>− '+reais(r.desconto_vialog||0)+'</b></div></div>'+
    (fora.length?'<div class="lc-pop-sub">Entregas descontadas</div><ul class="lc-pop-ctes">'+fora.map(x=>'<li><div><b>'+esc(x.c)+'</b> '+esc(x.d||'')+(x.ci?' • '+esc(x.ci):'')+'<small>'+esc(x.o||'sem ocorrência no SSW')+'</small></div><b>'+(x.f===null||x.f===undefined?'—':reais(x.f))+'</b></li>').join('')+'</ul>':'<div class="lc-pop-sub">Nenhuma entrega descontada.</div>')+
    (sem.length?'<div class="lc-pop-sub">Sem a situação lida no SSW (não descontadas): '+sem.map(x=>esc(x.c)).join(', ')+'</div>':'')+
    '<div class="lc-pop-foot">Frete líquido '+reais(freteLiq(r))+'</div>';
  if(d.showModal){if(!d.open)d.showModal()}else d.setAttribute('open','')
}
const freteLiq=r=>r.frete_vialog_liq??r.frete_vialog;
function fecharCidades(){const d=q('#lcCidades');if(!d)return;if(d.close&&d.open)d.close();else d.removeAttribute('open')}
function agendar(ms){clearTimeout(timerLista);timerLista=setTimeout(()=>{if(q('#lancamentos')?.classList.contains('active'))carregarLista(true)},ms)}
async function carregarLista(silencioso=false){
  const de=q('#lcDe').value||hoje(),ate=q('#lcAte').value>=de?q('#lcAte').value:de;
  q('#lcAte').value=ate;
  try{
    const j=await api('/api/lancamentos?de='+encodeURIComponent(de)+'&ate='+encodeURIComponent(ate));
    // a resposta chegou depois de o usuário gravar algo numa linha? fica o que ele gravou mais a novidade
    linhas=j.rows||[];naFila=j.naFila||[];
    renderLista();
    // buscando no SSW: olha de novo em 6 s; esperando o romaneio: 20 s; senão a cada minuto (baixas e romaneios novos)
    agendar(naFila.length?6000:linhas.some(r=>r.calculo?.status==='pendente'&&r.romaneio_ssw)?20000:60000)
  }catch(e){if(!silencioso)msg('✗ '+e.message,'bad');agendar(60000)}
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
    (noSistema?'Histórico trazido da planilha em '+new Date(config.importado_em).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})+' ('+int(config.planilha?.linhas)+' linhas) + '+int(config.sistema?.linhas)+' lançamento(s) feitos aqui. Da planilha, o sistema ainda traz o valor acordado (Frete Comb) e o KM do Circuit de cada romaneio já lançado aqui.'
      :'Os painéis continuam usando a planilha. Quando você trouxer o histórico, eles passam a ler só o que está no sistema ('+int(config.sistema?.linhas)+' lançamento(s) feitos aqui até agora).')+'</div></div>'+
    '<div class="lc-admin-btns">'+(config.planilhaLigada?'<button type="button" class="lc-btn" data-lc-admin="importar">'+(noSistema?'Trazer o histórico de novo':'Trazer o histórico da planilha')+'</button>':'')+
      (config.importado_em?'<button type="button" class="lc-btn ghost" data-lc-admin="'+(noSistema?'planilha':'sistema')+'">'+(noSistema?'Voltar os painéis para a planilha':'Passar os painéis para o sistema')+'</button>':'')+'</div>'
}
async function carregarConfig(){try{config=await api('/api/lancamentos/config');renderConfig()}catch{}}
async function acaoAdmin(acao){
  try{
    if(acao==='importar'){
      if(!confirm('Trazer o histórico da planilha para o sistema?\n\nOs lançamentos antigos são copiados e, a partir de agora, os painéis leem só do sistema. Depois disso, da planilha só vêm o valor acordado e o KM do Circuit dos romaneios lançados aqui (dá para trazer de novo ou voltar atrás por este mesmo quadro).'))return;
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
  q('#lcTipo').onchange=()=>{mexeuTipo=true};
  q('#lcDe').onchange=()=>{if(q('#lcAte').value<q('#lcDe').value)q('#lcAte').value=q('#lcDe').value;carregarLista()};
  q('#lcAte').onchange=()=>carregarLista();
  q('#lcHoje').onclick=()=>{q('#lcDe').value=hoje();q('#lcAte').value=hoje();carregarLista()};
  const tab=q('#lcTable');
  tab.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.lcEdit){editar(b.dataset.lcEdit);renderLista()}else if(b.dataset.lcDel)excluir(b.dataset.lcDel);else if(b.dataset.lcCalc)recalcular(b.dataset.lcCalc);else if(b.dataset.lcCidades)abrirCidades(b.dataset.lcCidades);else if(b.dataset.lcFrete)abrirFrete(b.dataset.lcFrete)};
  tab.onchange=e=>{
    if(e.target.dataset.lcCampo)return salvarCampo(e.target);
    if(e.target.dataset.lcPorkm)return mudarPorKm(e.target.dataset.lcPorkm,e.target.checked);
    if(e.target.dataset.lcVkm)return salvarValorKm(e.target);
  };
  // Enter no valor: grava e desce para o valor do próximo romaneio
  tab.onkeydown=e=>{
    if(e.key!=='Enter'||e.target.dataset.lcCampo!=='valor')return;
    e.preventDefault();
    const todos=[...tab.querySelectorAll('input[data-lc-campo="valor"]')],prox=todos[todos.indexOf(e.target)+1];
    if(prox){prox.focus();prox.select()}else e.target.blur()
  };
  tab.addEventListener('focusout',()=>setTimeout(()=>{if(renderPendente&&!tabelaOcupada())renderLista()},0));
  tab.addEventListener('focusin',e=>{if(e.target.dataset.lcCampo==='valor')e.target.select()});
  const pop=q('#lcCidades');
  if(pop)pop.onclick=e=>{if(e.target===pop||e.target.closest('[data-lc-fechar]'))fecharCidades()};
  q('#lcAdmin').onclick=e=>{const b=e.target.closest('[data-lc-admin]');if(b)acaoAdmin(b.dataset.lcAdmin)}
}
// Chamado pelo painel quando a aba "Lançamentos" é aberta.
window.lancamentosAbrir=()=>{
  setup();
  carregarMotoristas();carregarLista();carregarConfig();
  setTimeout(()=>q('#lcDriver')?.focus(),60)
};
})();
