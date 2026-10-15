// Despesas (DRE) do Financeiro: demonstrativo do ano, lançamentos do mês, holerites em PDF da conta Salários
// e despesas lidas da opção 475 do SSW.
// Servidor: dre.js (rotas /api/dre*).
(()=>{
const q=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const reais=v=>v===null||v===undefined||v===''?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const num=v=>v===null||v===undefined?'':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const MESES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MESES_LONGOS=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const hoje=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
let pronto=false,dre=null,mesSel=null;

function msg(t,tipo=''){const e=q('#dreMsg');if(e){e.textContent=t;e.className='dre-msg'+(tipo?' '+tipo:'')}}
async function api(url,opts){
  const r=await fetch(url,{cache:'no-store',...(opts||{}),headers:opts&&opts.body?{'Content-Type':'application/json'}:undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false)throw new Error(j.error||('Não consegui falar com o sistema (erro '+r.status+').'));
  return j
}
const competencia=()=>q('#dreAno').value+'-'+q('#dreMes').value;
function nomeMes(){const m=Number(q('#dreMes').value);document.querySelectorAll('#despesas .dre-mes-nome').forEach(e=>e.textContent=MESES_LONGOS[m-1]+' de '+q('#dreAno').value)}

// ---------------------------------------------------------------- demonstrativo
function valor(v,sinal){
  if(!v)return'<span class="zero">—</span>';
  const neg=sinal<0||v<0;
  return'<span class="'+(neg?'neg':'')+'">'+(sinal<0&&v>0?'('+num(v)+')':num(v))+'</span>'
}
function renderTabela(){
  const t=q('#dreTabela');if(!dre){t.innerHTML='';return}
  const m=Number(q('#dreMes').value)-1;
  let h='<thead><tr><th>Conta</th>'+MESES.map((x,i)=>'<th class="n dre-m'+(i===m?' sel':'')+'" data-dre-mes="'+(i+1)+'">'+x+'</th>').join('')+'<th class="n">Total</th></tr></thead><tbody>';
  for(const l of dre.linhas){
    const s=l.tipo==='conta'?l.sinal:(l.tipo==='grupo'?(dre.plano.find(g=>g.id===l.id)?.contas?.[0]?.sinal||1):1);
    let nome=esc(l.nome);
    if(l.holerite){const n=dre.holerites?.[competencia()]||0;nome+=' <button class="dre-mini" type="button" data-dre-hol title="Enviar os PDFs dos holerites de '+esc(MESES_LONGOS[m])+'">📎 Holerites</button>'+(n?'<span class="dre-orig">'+n+' no mês</span>':'')}
    if(l.ssw)nome+='<span class="dre-orig">SSW</span>';
    const cel=(v,i)=>'<td class="n'+(i===m?' sel':'')+'">'+(l.tipo==='subtotal'?valor(v,v<0?-1:1).replace('class=""',''):valor(v,s))+'</td>';
    h+='<tr class="'+l.tipo+'"'+(l.tipo==='conta'?' data-dre-conta="'+esc(l.id)+'"':'')+'><td>'+nome+'</td>'+l.meses.map(cel).join('')+'<td class="n"><b>'+(l.tipo==='subtotal'?valor(l.total,l.total<0?-1:1):valor(l.total,s))+'</b></td></tr>'
  }
  t.innerHTML=h+'</tbody>'
}
async function carregarAno(){
  try{dre=await api('/api/dre?ano='+encodeURIComponent(q('#dreAno').value));renderTabela();preencherContas()}
  catch(e){msg(e.message,'err')}
}
function preencherContas(){
  const sel=q('#dreConta');if(!dre||sel.options.length)return;
  sel.innerHTML='<option value="">Escolha a conta</option>'+dre.plano.filter(g=>g.contas).map(g=>'<optgroup label="'+esc(g.nome)+'">'+g.contas.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.nome)+'</option>').join('')+'</optgroup>').join('')
}

// ---------------------------------------------------------------- mês: lançamentos e holerites
const nomeConta=id=>{for(const g of dre?.plano||[])for(const c of g.contas||[])if(c.id===id)return c.nome;return id};
const ORIGEM={manual:'lançado',ssw:'SSW'};
async function carregarMes(){
  nomeMes();
  let j;try{j=await api('/api/dre/mes?competencia='+competencia())}catch(e){msg(e.message,'err');return}
  mesSel=j;
  q('#dreLanc').innerHTML=j.lancamentos.length?'<table><thead><tr><th>Conta</th><th>Descrição</th><th class="n">Valor</th><th></th></tr></thead><tbody>'+j.lancamentos.map(l=>'<tr><td>'+esc(nomeConta(l.conta))+'</td><td>'+esc(l.descricao||'—')+' <span class="muted">'+esc(ORIGEM[l.origem]||l.origem)+(l.criado_por?' • '+esc(l.criado_por):'')+'</span></td><td class="n">'+reais(l.valor)+'</td><td class="acoes"><button class="dre-mini" type="button" data-dre-apagar="'+esc(l.id)+'">Apagar</button></td></tr>').join('')+'</tbody></table>':'<div class="muted">Nenhum lançamento neste mês.</div>';
  const H=j.holerites;
  const tot=k=>H.reduce((a,h)=>a+Number(h[k]||0),0);
  renderSswDespesas(j.sswDespesas||[]);
  q('#dreHol').innerHTML=H.length?'<table><thead><tr><th>Funcionário</th><th class="n">Vencimentos</th><th class="n">Descontos</th><th class="n">Líquido</th><th class="n">FGTS</th><th></th></tr></thead><tbody>'+H.map(h=>'<tr data-dre-holerite="'+esc(h.id)+'"><td><input class="nome" data-no-titlecase="true" data-campo="funcionario" value="'+esc(h.funcionario)+'" placeholder="Nome"><div class="muted">'+esc(h.cargo||'')+(h.competencia_pdf&&h.competencia_pdf!==h.competencia?' • <b style="color:#b45309">PDF de '+esc(h.competencia_pdf.split('-').reverse().join('/'))+'</b>':'')+'</div></td>'+['vencimentos','descontos','liquido','fgts'].map(k=>'<td class="n"><input data-no-titlecase="true" data-campo="'+k+'" inputmode="decimal" value="'+esc(num(h[k]))+'"></td>').join('')+'<td class="acoes"><a href="/api/dre/holerites/'+encodeURIComponent(h.id)+'/pdf" target="_blank" rel="noopener">PDF</a><button class="dre-mini" type="button" data-dre-hol-apagar="'+esc(h.id)+'">Apagar</button></td></tr>').join('')+'</tbody><tfoot><tr><th>'+H.length+' holerite(s)</th><th class="n">'+reais(tot('vencimentos'))+'</th><th class="n">'+reais(tot('descontos'))+'</th><th class="n">'+reais(tot('liquido'))+'</th><th class="n">'+reais(tot('fgts'))+'</th><th></th></tr></tfoot></table>':'<div class="muted">Nenhum holerite enviado neste mês.</div>'
}
async function recarregar(){await Promise.all([carregarAno(),carregarMes()])}

async function lancar(e){
  e.preventDefault();
  const b=e.submitter||q('#dreForm button');b.disabled=true;
  try{
    await api('/api/dre/lancamentos',{method:'POST',body:JSON.stringify({competencia:competencia(),conta:q('#dreConta').value,descricao:q('#dreDesc').value,valor:q('#dreValor').value})});
    q('#dreDesc').value='';q('#dreValor').value='';msg('Lançado em '+nomeConta(q('#dreConta').value)+'.','ok');await recarregar();q('#dreValor').focus()
  }catch(err){msg(err.message,'err')}finally{b.disabled=false}
}
async function puxarSsw(){
  const b=q('#dreSsw'),c=competencia(),[y,m]=c.split('-').map(Number);
  const fim=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),ate=fim>hoje()?hoje():fim;
  if(c+'-01'>hoje())return msg('Esse mês ainda não começou.','err');
  b.disabled=true;msg('Lendo os CT-es de '+MESES_LONGOS[m-1]+' no SSW… (pode levar alguns segundos)');
  try{
    const r=await fetch('/api/bi2/receita?from='+c+'-01&to='+ate,{cache:'no-store'}),j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||'O SSW não devolveu a receita do mês.');
    const v=Number(j.totalFaturamento||0);
    await api('/api/dre/ssw',{method:'POST',body:JSON.stringify({competencia:c,valor:v,descricao:'CT-es emitidos no SSW ('+(j.totalRegistros||0)+')'})});
    msg('Receita de fretes de '+MESES_LONGOS[m-1]+' lida do SSW: '+reais(v)+'.','ok');await recarregar()
  }catch(e){msg(e.message,'err')}finally{b.disabled=false}
}
// despesas da opção 475: o painel lê do SSW (só consulta) e a DRE guarda por mês e evento
function opcoesConta(sel){
  return'<option value="ignorar"'+(sel==='ignorar'?' selected':'')+'>Não entra na DRE</option>'+(dre?.plano||[]).filter(g=>g.contas).map(g=>'<optgroup label="'+esc(g.nome)+'">'+g.contas.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===sel?' selected':'')+'>'+esc(c.nome)+'</option>').join('')+'</optgroup>').join('')
}
function renderSswDespesas(ev){
  const el=q('#dreSswLista');
  if(!ev.length){el.innerHTML='<div class="muted">Nenhuma despesa do SSW neste mês. Use "Puxar despesas do SSW (475)".</div>';return}
  const tot=ev.reduce((a,x)=>a+(x.conta==='ignorar'?0:x.valor),0);
  el.innerHTML='<table><thead><tr><th>Evento no SSW</th><th class="n">Lançamentos</th><th class="n">Valor</th><th>Conta na DRE</th></tr></thead><tbody>'+ev.map(x=>'<tr class="'+(x.conta==='ignorar'?'ign':'')+'"><td>'+esc(x.evento||'(sem evento)')+'</td><td class="n">'+x.n+'</td><td class="n">'+reais(x.valor)+'</td><td><select data-dre-evento="'+esc(x.evento_chave)+'">'+opcoesConta(x.conta)+'</select>'+(x.escolhida?'':' <span class="dre-orig" title="Conta sugerida pelo nome do evento">sugerida</span>')+'</td></tr>').join('')+'</tbody><tfoot><tr><td><b>Entra na DRE</b></td><td></td><td class="n"><b>'+reais(tot)+'</b></td><td></td></tr></tfoot></table>'
}
function mostrarDiag(d){const det=q('#dreSswDiag');if(!d){det.hidden=true;return}det.hidden=false;det.querySelector('textarea').value=JSON.stringify(d,null,1)}
async function puxarDespesasSsw(){
  const b=q('#dreSswDesp'),c=competencia(),[y,m]=c.split('-').map(Number);
  const fim=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
  b.disabled=true;mostrarDiag(null);msg('Lendo as despesas de '+MESES_LONGOS[m-1]+' na opção 475 do SSW… (pode levar alguns segundos)');
  try{
    const r=await fetch('/api/ssw/despesas475?from='+c+'-01&to='+fim,{cache:'no-store'}),j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok){mostrarDiag(j.diag||null);throw new Error(j.error||'O SSW não devolveu as despesas do mês.')}
    if(!j.despesas.length){mostrarDiag(j.diag);throw new Error('A opção 475 não trouxe despesas com pagamento em '+MESES_LONGOS[m-1]+'. Se no SSW tem, abra "Detalhes da leitura do SSW" abaixo e mande para o suporte.')}
    const s=await api('/api/dre/ssw-despesas',{method:'POST',body:JSON.stringify({competencia:c,despesas:j.despesas})});
    msg(s.despesas+' despesa(s) de '+MESES_LONGOS[m-1]+' lidas do SSW: '+reais(s.total)+'. Confira a conta de cada evento abaixo.','ok');await recarregar()
  }catch(e){msg(e.message,'err')}finally{b.disabled=false}
}
async function mudarContaEvento(sel){
  try{await api('/api/dre/ssw-eventos',{method:'PUT',body:JSON.stringify({evento_chave:sel.dataset.dreEvento,conta:sel.value})});msg('Conta do evento salva. Vale também para os próximos meses.','ok');await recarregar()}
  catch(e){msg(e.message,'err')}
}
const lerArquivo=f=>new Promise((ok,erro)=>{const r=new FileReader();r.onload=()=>ok(String(r.result));r.onerror=()=>erro(new Error('Não consegui abrir '+f.name));r.readAsDataURL(f)});
async function enviarHolerites(files){
  files=[...files].filter(Boolean);if(!files.length)return;
  const bts=document.querySelectorAll('#despesas [data-dre-hol],#dreHolBtn');bts.forEach(b=>b.disabled=true);
  const res=[];let lidos=0;
  try{
    for(let i=0;i<files.length;i++){
      const f=files[i];msg('Lendo holerite '+(i+1)+' de '+files.length+': '+f.name+'…');
      try{
        if(f.size>8*1024*1024){res.push(f.name+': maior que 8 MB');continue}
        const j=await api('/api/dre/holerites',{method:'POST',body:JSON.stringify({competencia:competencia(),arquivos:[{nome:f.name,base64:await lerArquivo(f)}]})});
        for(const a of j.arquivos){if(a.erro)res.push(a.nome+': '+a.erro);else{lidos+=a.holerites;if(a.outroMes)res.push(a.nome+': o PDF parece ser de outro mês, confira')}}
      }catch(e){res.push(f.name+': '+e.message)}
    }
    msg((lidos?lidos+' holerite(s) lido(s) em '+MESES_LONGOS[Number(q('#dreMes').value)-1]+'.':'Nenhum holerite lido.')+(res.length?' '+res.join(' • '):''),res.length&&!lidos?'err':'ok');
    await recarregar()
  }finally{bts.forEach(b=>b.disabled=false);q('#dreHolFile').value=''}
}
async function salvarHolerite(inp){
  const id=inp.closest('[data-dre-holerite]').dataset.dreHolerite;
  try{await api('/api/dre/holerites/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({[inp.dataset.campo]:inp.value})});msg('Holerite corrigido.','ok');await recarregar()}
  catch(e){msg(e.message,'err')}
}

function setup(){
  if(pronto)return;pronto=true;
  const ano=Number(hoje().slice(0,4)),mes=Number(hoje().slice(5,7));
  q('#dreAno').innerHTML=Array.from({length:6},(_,i)=>ano-4+i).map(y=>'<option'+(y===ano?' selected':'')+'>'+y+'</option>').join('');
  q('#dreMes').innerHTML=MESES_LONGOS.map((x,i)=>'<option value="'+String(i+1).padStart(2,'0')+'"'+(i+1===mes?' selected':'')+'>'+x[0].toUpperCase()+x.slice(1)+'</option>').join('');
  q('#dreAno').onchange=recarregar;
  q('#dreMes').onchange=()=>{renderTabela();carregarMes()};
  q('#dreForm').onsubmit=lancar;
  q('#dreSsw').onclick=puxarSsw;
  q('#dreSswDesp').onclick=puxarDespesasSsw;
  q('#dreSswLista').onchange=e=>{if(e.target.dataset.dreEvento)mudarContaEvento(e.target)};
  q('#dreHolBtn').onclick=()=>q('#dreHolFile').click();
  q('#dreHolFile').onchange=e=>enviarHolerites(e.target.files);
  q('#dreTabela').onclick=e=>{
    if(e.target.closest('[data-dre-hol]'))return q('#dreHolFile').click();
    const th=e.target.closest('[data-dre-mes]');
    if(th){q('#dreMes').value=String(th.dataset.dreMes).padStart(2,'0');renderTabela();carregarMes();return}
    const tr=e.target.closest('[data-dre-conta]');
    if(tr){q('#dreConta').value=tr.dataset.dreConta;q('#dreValor').focus()}
  };
  q('#dreLanc').onclick=async e=>{const b=e.target.closest('[data-dre-apagar]');if(!b||!confirm('Apagar este lançamento?'))return;try{await api('/api/dre/lancamentos/'+encodeURIComponent(b.dataset.dreApagar),{method:'DELETE'});await recarregar()}catch(err){msg(err.message,'err')}};
  q('#dreHol').onclick=async e=>{const b=e.target.closest('[data-dre-hol-apagar]');if(!b||!confirm('Apagar este holerite?'))return;try{await api('/api/dre/holerites/'+encodeURIComponent(b.dataset.dreHolApagar),{method:'DELETE'});await recarregar()}catch(err){msg(err.message,'err')}};
  q('#dreHol').onchange=e=>{if(e.target.dataset.campo)salvarHolerite(e.target)};
}
// Chamado pelo painel quando a aba "Despesas (DRE)" é aberta.
window.dreAbrir=()=>{setup();recarregar()};
})();
