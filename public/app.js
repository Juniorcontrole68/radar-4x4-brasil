const S={ops:[],sch:[],help:[],ssw:null,remetentes:null,coletas:null,sswMotoristas:null},$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
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
function bars(id,L,D){if(!D.length)return empty(id);const{x,w,h}=cv(id),p={l:42,r:12,t:16,b:58},cw=w-p.l-p.r,ch=h-p.t-p.b,m=Math.max(...D,1),bw=Math.max(5,Math.min(38,cw/D.length*.65));x.strokeStyle='#e2e8f0';x.strokeRect(p.l,p.t,cw,ch);D.forEach((v,i)=>{const px=p.l+(i+.5)*cw/D.length,bh=v/m*ch;x.fillStyle='#0f766e';x.fillRect(px-bw/2,h-p.b-bh,bw,bh);x.save();x.translate(px,h-p.b+8);x.rotate(-Math.PI/4);x.textAlign='right';x.fillStyle='#64748b';x.fillText(String(L[i]).slice(0,18),0,0);x.restore()})}
function lines(id,L,A,B){if(!L.length)return empty(id);const{x,w,h}=cv(id),p={l:42,r:12,t:20,b:42},cw=w-p.l-p.r,ch=h-p.t-p.b,m=Math.max(...A,...B,1);x.strokeStyle='#e2e8f0';x.strokeRect(p.l,p.t,cw,ch);const d=(V,c)=>{x.strokeStyle=c;x.lineWidth=2;x.beginPath();V.forEach((v,i)=>{const px=p.l+(L.length===1?cw/2:i*cw/(L.length-1)),py=p.t+ch-v/m*ch;i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke()};d(A,'#0f766e');d(B,'#b45309')}
function donut(id,L,D){if(!D.length)return empty(id);const{x,w,h}=cv(id),sum=D.reduce((a,b)=>a+b,0),cx=Math.min(w*.33,150),cy=h/2,r=Math.min(75,h*.28),C=['#0f766e','#0284c7','#d97706','#dc2626','#7c3aed','#64748b'];let a=-Math.PI/2;D.forEach((v,i)=>{const z=v/sum*Math.PI*2;x.strokeStyle=C[i%C.length];x.lineWidth=25;x.beginPath();x.arc(cx,cy,r,a,a+z);x.stroke();a+=z});x.fillStyle='#172033';x.textAlign='center';x.font='700 18px Segoe UI';x.fillText(nf(sum),cx,cy+5);x.font='11px Segoe UI';x.textAlign='left';L.slice(0,7).forEach((l,i)=>{const y=24+i*25,xx=Math.max(cx+r+30,w*.53);x.fillStyle=C[i%C.length];x.fillRect(xx,y-9,9,9);x.fillStyle='#475569';x.fillText(String(l).slice(0,24)+' ('+D[i]+')',xx+14,y)})}
function mood(el,v){el.classList.remove('positive','negative');el.classList.add(v>=0?'positive':'negative')}
function table(id,cols,rows){$(id).innerHTML='<thead><tr>'+cols.map(c=>'<th>'+c[0]+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+cols.map(c=>'<td>'+safe(g(r,...c.slice(1)))+'</td>').join('')+'</tr>').join('')+'</tbody>'}
function update(){const O=ops(),H=help(),A=sch(),delSheet=O.reduce((a,o)=>a+num(g(o,'Entregas')),0),doneSheet=O.reduce((a,o)=>a+num(g(o,'Realizadas')),0),co=S.coletas&&S.coletas.ok?S.coletas:null,del=co?num(co.ativas):delSheet,done=co?num(co.entregues):doneSheet,km=O.reduce((a,o)=>a+num(g(o,'KM')),0),rev=O.reduce((a,o)=>a+num(g(o,'Frete Vialog Liq',' Frete Vialog Liq')),0),dc=O.reduce((a,o)=>a+num(g(o,'Frete Mot Liq',' Frete Mot Liq')),0),hc=H.reduce((a,o)=>a+num(g(o,'Valor')),0),gross=rev-dc,margin=rev?gross/rev*100:0,net=gross-hc,ret=O.reduce((a,o)=>a+num(g(o,'Retorno')),0),pending=co?num(co.pendentes):Math.max(del-done,0);
$('#del').textContent=nf(del);$('#done').textContent=nf(done);$('#rate').textContent=(del?done/del*100:0).toFixed(1).replace('.',',')+'%';$('#km').textContent=nf(km);$('#revenue').textContent=brl(rev);$('#driverCost').textContent=brl(dc);$('#gross').textContent=brl(gross);$('#margin').textContent=margin.toFixed(1).replace('.',',')+'%';$('#helpersCost').textContent=brl(hc);$('#net').textContent=brl(net);mood($('#gross'),gross);mood($('#margin'),margin);mood($('#net'),net);
const sla=del?done/del*100:0;
const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
set('#hubExecDel',nf(done)+' / '+nf(del));set('#hubExecSla',sla.toFixed(1).replace('.',',')+'%');set('#hubExecRev',brl(rev));set('#hubExecNet',brl(net));
set('#hubOpPlan',nf(del));set('#hubOpDone',nf(done));set('#hubOpPend',nf(pending));set('#hubOpKm',nf(km));
set('#hubFinRev',brl(rev));set('#hubFinDriver',brl(dc));set('#hubFinHelp',brl(hc));set('#hubFinMargin',margin.toFixed(1).replace('.',',')+'%');
set('#hubHelpCost',brl(hc));set('#hubHelpPeople',nf(new Set(H.map(o=>g(o,'NOME')).filter(Boolean)).size));
set('#hubSchN',nf(A.length));
const hs={};A.forEach(o=>{const k=(g(o,'STATUS')||'SEM STATUS').trim();hs[k]=(hs[k]||0)+1});set('#hubSchStatus',nf(Object.keys(hs).length));const hsTop=Object.entries(hs).sort((a,b)=>b[1]-a[1]).slice(0,4);set('#hubSchList',hsTop.length?hsTop.map(x=>x[0]+': '+nf(x[1])).join(' • '):'Sem agendamentos no período');
const hdm={};O.forEach(o=>{const k=g(o,'Motorista')||'Sem motorista';hdm[k]=(hdm[k]||0)+num(g(o,'Realizadas'))});const hdTop=Object.entries(hdm).sort((a,b)=>b[1]-a[1]).slice(0,5);set('#hubDrivers',hdTop.length?hdTop.map((x,i)=>(i+1)+'. '+x[0]+' — '+nf(x[1])).join(' | '):'Sem dados de motoristas');
const hbm={};O.forEach(o=>{const k=g(o,'Filial')||'Sem filial';hbm[k]??={p:0,d:0};hbm[k].p+=num(g(o,'Entregas'));hbm[k].d+=num(g(o,'Realizadas'))});const hbTop=Object.entries(hbm).sort((a,b)=>b[1].d-a[1].d).slice(0,5);set('#hubBranches',hbTop.length?hbTop.map(x=>x[0]+': '+nf(x[1].d)+'/'+nf(x[1].p)).join(' | '):'Sem dados de filiais');
const hrm={};O.forEach(o=>{const k=g(o,'Rota')||'Sem rota';hrm[k]=(hrm[k]||0)+num(g(o,'Realizadas'))});const hrTop=Object.entries(hrm).sort((a,b)=>b[1]-a[1]).slice(0,4);set('#hubRoutes',hrTop.length?hrTop.map(x=>x[0]+': '+nf(x[1])).join(' • '):'Sem dados de rotas');set('#hubKmDel',done?(km/done).toFixed(1).replace('.',','):'0');set('#hubRouteN',nf(Object.keys(hrm).filter(x=>x!=='Sem rota').length));
set('#hubIssue',nf(ret));set('#hubIssueRate',(del?ret/del*100:0).toFixed(1).replace('.',',')+'%');set('#hubIssueSla',sla.toFixed(1).replace('.',',')+'%');set('#hubIssuePend',nf(pending));$('#sswPlanned').textContent=nf(del);$('#sswRoute').textContent=nf(pending);$('#sswDone').textContent=nf(done);$('#sswIssue').textContent=nf(ret);$('#sswSla').textContent=sla.toFixed(1).replace('.',',')+'%';$('#sswSlaBar').style.width=Math.min(100,Math.max(0,sla))+'%';
const active=$('.section.active')?.id||'dashboard';
if(active==='dashboard'){
  const bd={};O.forEach(o=>{const k=gd(o)||'Sem data';bd[k]??={d:0,r:0};bd[k].d+=num(g(o,'Realizadas'));bd[k].r+=num(g(o,'Retorno'))});const K=Object.keys(bd).sort((a,b)=>(pd(a)||0)-(pd(b)||0));lines('#trend',K,K.map(k=>bd[k].d),K.map(k=>bd[k].r));
  const dm={};O.forEach(o=>{const k=g(o,'Motorista')||'Sem motorista';dm[k]=(dm[k]||0)+num(g(o,'Entregas'))});const T=Object.entries(dm).sort((a,b)=>b[1]-a[1]).slice(0,10);bars('#drivers',T.map(x=>x[0]),T.map(x=>x[1]));
  const st={};A.forEach(o=>{const k=(g(o,'STATUS')||'SEM STATUS').trim();st[k]=(st[k]||0)+1});donut('#statusChart',Object.keys(st),Object.values(st));
  const hd={};H.forEach(o=>{const k=g(o,'Data')||'Sem data';hd[k]=(hd[k]||0)+num(g(o,'Valor'))});const HK=Object.keys(hd).sort((a,b)=>(pd(a)||0)-(pd(b)||0));bars('#helpersChart',HK,HK.map(k=>hd[k]));
}
$('#hc').textContent=brl(hc);$('#hn').textContent=nf(H.length);$('#hp').textContent=new Set(H.map(o=>g(o,'NOME')).filter(Boolean)).size;
if(active==='operacoes')table('#ops',[['Data','Data','  Data'],['Motorista','Motorista'],['Veículo','Veiculo'],['Filial','Filial'],['Entregas','Entregas'],['Realizadas','Realizadas'],['KM','KM'],['Frete Motorista','Frete Mot Liq',' Frete Mot Liq'],['Receita Líq.','Frete Vialog Liq',' Frete Vialog Liq'],['Rota','Rota']],O.slice().reverse().slice(0,500));
if(active==='agendamentos')table('#sch',[['NF','NF'],['Cidade','CIDADE'],['Cliente','NOME CLIENTE'],['Data','DATA AGENDADA'],['Status','STATUS'],['Motorista','MOTORISTA'],['Observação','OBSERVAÇÃO']],A.slice().reverse().slice(0,500));
if(active==='ajudantes')table('#help',[['Data','Data'],['Nome','NOME'],['Valor','Valor'],['Função','FUNÇÃO']],H.slice().reverse().slice(0,500));
const now=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('#status').textContent='Atualização automática a cada 5 s • última: '+now+' • '+S.ops.length.toLocaleString('pt-BR')+' operações • '+S.sch.length.toLocaleString('pt-BR')+' agendamentos • '+S.help.length.toLocaleString('pt-BR')+' ajudantes'}
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
function renderRemetentes(){const d=S.remetentes;if(!d||!d.ok)return;const set=(id,v)=>{const e=$(id);if(e)e.textContent=v},C=d.clientes||[];set('#hubRemClients',nf(d.totalClientes||0));set('#hubRemCtrcs',nf(d.totalCtrcs||0));set('#hubRemFreight',brl(d.totalFrete||0));set('#hubRemVolumes',nf(d.totalVolumes||0));set('#hubRemNote',d.note||'Dados SSW / BI2');set('#remClients',nf(d.totalClientes||0));set('#remCtrcs',nf(d.totalCtrcs||0));set('#remFreight',brl(d.totalFrete||0));set('#remGoods',brl(d.totalMercadoria||0));set('#remVolumes',nf(d.totalVolumes||0));const p=d.period,pt=p?('Período '+p.from+' a '+p.to+' • '+p.daysAvailable+'/'+p.daysRequested+' dia(s) com arquivo BI2'):'';const meta=(d.meta&&d.meta.data?d.meta.data+' '+(d.meta.hora||''):'')+(pt?' • '+pt:'')+' • '+(d.note||'');set('#remMeta',meta);const top=C.slice(0,10),topF=C.slice().sort((a,b)=>b.frete-a.frete).slice(0,10);bars('#remCtrcChart',top.map(x=>x.remetente),top.map(x=>x.ctrcs));bars('#remFreightChart',topF.map(x=>x.remetente),topF.map(x=>x.frete));const rows=C.map((x,i)=>({pos:String(i+1),remetente:x.remetente,ctrcs:nf(x.ctrcs),frete:brl(x.frete),mercadoria:brl(x.valorMercadoria),volumes:nf(x.volumes),peso:nf(x.peso),m3:(x.m3||0).toLocaleString('pt-BR',{maximumFractionDigits:2}),atraso:(x.atrasoMedio||0).toFixed(1).replace('.',',')+' d',cidades:nf(x.cidades),destinatarios:nf(x.destinatarios)}));table('#remTable',[['#','pos'],['Cliente remetente','remetente'],['CT-es','ctrcs'],['Frete','frete'],['Valor mercadoria','mercadoria'],['Volumes','volumes'],['Peso','peso'],['m³','m3'],['Atraso médio','atraso'],['Cidades','cidades'],['Destinatários','destinatarios']],rows);table('#remCompareTable',[['#','pos'],['Cliente remetente','remetente'],['CT-es','ctrcs'],['Frete','frete'],['Volumes','volumes'],['Atraso médio','atraso'],['Cidades','cidades'],['Destinatários','destinatarios']],rows);const a=$('#remClientA'),b=$('#remClientB');if(a&&b){const va=a.value,vb=b.value,opts=C.map(x=>'<option value="'+safe(x.remetente)+'">'+safe(x.remetente)+'</option>').join('');a.innerHTML=opts;b.innerHTML=opts;if(C.some(x=>x.remetente===va))a.value=va;else if(C[0])a.value=C[0].remetente;if(C.some(x=>x.remetente===vb))b.value=vb;else if(C[1])b.value=C[1].remetente;else if(C[0])b.value=C[0].remetente;renderRemCompare()}}
function renderRemCompare(){const d=S.remetentes;if(!d||!d.ok)return;const C=d.clientes||[],a=$('#remClientA'),b=$('#remClientB');if(!a||!b)return;const A=C.find(x=>x.remetente===a.value),B=C.find(x=>x.remetente===b.value),set=(id,v)=>{const e=$(id);if(e)e.textContent=v};const fill=(p,x)=>{set('#rem'+p+'Name',x?x.remetente:'—');set('#rem'+p+'Ctrcs',x?nf(x.ctrcs):'—');set('#rem'+p+'Freight',x?brl(x.frete):'—');set('#rem'+p+'Goods',x?brl(x.valorMercadoria):'—');set('#rem'+p+'Volumes',x?nf(x.volumes):'—');set('#rem'+p+'Weight',x?nf(x.peso):'—');set('#rem'+p+'Delay',x?(x.atrasoMedio||0).toFixed(1).replace('.',',')+' d':'—');set('#rem'+p+'Cities',x?nf(x.cidades):'—');set('#rem'+p+'Recipients',x?nf(x.destinatarios):'—')};fill('A',A);fill('B',B);set('#remCompareMeta',(d.note||'')+(d.meta&&d.meta.data?' • '+d.meta.data+' '+(d.meta.hora||''):''))}
async function refreshSswRemetentes(){try{const q=sswRangeQuery(),sep=q?'&':'?';const r=await fetch('/api/bi2/remetentes'+q+sep+'t='+Date.now(),{cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Falha ao carregar clientes remetentes');S.remetentes=j;renderRemetentes()}catch(e){const ids=['#remMeta','#hubRemNote','#remCompareMeta'];ids.forEach(id=>{const el=$(id);if(el)el.textContent='Não foi possível carregar os clientes remetentes: '+e.message})}}
async function checkSsw(){try{const [rs,rb,ra]=await Promise.all([fetch('/api/ssw/status?t='+Date.now(),{cache:'no-store'}),fetch('/api/bi2/status?t='+Date.now(),{cache:'no-store'}),fetch('/api/bi2/api-status?t='+Date.now(),{cache:'no-store'})]),s=await rs.json(),b2=await rb.json(),api=await ra.json(),b=$('#sswSource');if(!b)return;if(api.connected){b.textContent='BI2 WebAPI conectada • consulta a cada 1 min • usando Google Sheets';const tag=$('#hubBi2Tag'),txt=$('#hubBi2Text');if(tag){tag.textContent='WEBAPI BI2 CONECTADA';tag.classList.remove('wait');tag.classList.add('live')}if(txt)txt.textContent='WebAPI BI2 conectada. Relatórios monitorados a cada 1 minuto; SFTP mantido como contingência.';b.style.background='#dcfce7';b.style.color='#166534';b.style.borderColor='#86efac'}else if(b2.connected){b.textContent=(b2.fileCount>0?'BI2 SFTP conectado • '+b2.fileCount+' arquivo(s) disponível(is) • usando Google Sheets':'BI2 SFTP conectado • aguardando arquivos do SSW • usando Google Sheets');const tag=$('#hubBi2Tag'),txt=$('#hubBi2Text');if(tag){tag.textContent=b2.fileCount>0?'ARQUIVOS DISPONÍVEIS':'BI2 CONECTADO';tag.classList.remove('wait');tag.classList.add('live')}if(txt)txt.textContent=b2.fileCount>0?'BI2 conectado com '+b2.fileCount+' arquivo(s) disponível(is) para processamento.':'BI2 conectado com sucesso. Aguardando o SSW publicar os primeiros arquivos.';b.style.background='#dcfce7';b.style.color='#166534';b.style.borderColor='#86efac'}else if(b2.configured){b.textContent='BI2 configurado • conexão indisponível • usando Google Sheets';const tag=$('#hubBi2Tag'),txt=$('#hubBi2Text');if(tag){tag.textContent='BI2 INDISPONÍVEL';tag.classList.remove('live');tag.classList.add('wait')}if(txt)txt.textContent='Credenciais configuradas, mas a conexão BI2 não está disponível neste momento.';b.style.background='#fee2e2';b.style.color='#991b1b';b.style.borderColor='#fecaca'}else if(s.connected){b.textContent='SSW WebAPI conectado • usando Google Sheets';b.style.background='#dcfce7';b.style.color='#166534';b.style.borderColor='#86efac'}else if(s.configured){b.textContent='SSW WebAPI: falha de autenticação • usando Google Sheets';b.style.background='#fee2e2';b.style.color='#991b1b';b.style.borderColor='#fecaca'}else{b.textContent='SSW/BI2 aguardando configuração • usando Google Sheets';b.style.background='#ecfeff';b.style.color='#0f766e';b.style.borderColor='#99f6e4'}}catch(e){const b=$('#sswSource');if(b)b.textContent='Fontes SSW indisponíveis • usando Google Sheets'}}
async function refreshData(first=false){
  if(window.__refreshing)return;
  window.__refreshing=true;
  if(first)$('#loading').classList.remove('hide');
  try{
    const [ro,ra,rh]=await Promise.allSettled([load('lancamentos'),load('agendamentos'),load('ajudantes')]);
    let updated=false,errors=[];
    if(ro.status==='fulfilled'){S.ops=ro.value;S.opsUpdatedAt=Date.now();updated=true}else errors.push('Operações: '+(ro.reason?.message||ro.reason));
    if(ra.status==='fulfilled'){S.sch=ra.value;updated=true}else errors.push('Agendamentos: '+(ra.reason?.message||ra.reason));
    if(rh.status==='fulfilled'){S.help=rh.value;updated=true}else errors.push('Ajudantes: '+(rh.reason?.message||rh.reason));
    if(updated){filters();update()}
    const er=$('#err');
    if(errors.length){
      er.style.display='block';
      er.innerHTML='<b>Atualização parcial.</b><br>'+errors.map(safe).join('<br>')+'<br>Os módulos que responderam continuam atualizando normalmente.';
    }else er.style.display='none';
    refreshColetasStatus();
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
function renderLoadingRecords(rows){
  const box=$('#loadRecords');
  if(box){
    if(!rows.length)box.innerHTML='<div class="muted">Nenhum final de carregamento registrado ainda.</div>';
    else box.innerHTML=rows.map(r=>{
      const dt=loadingDateTime(r.capturada_em);
      return '<div class="load-record"><a href="/api/carregamentos-finais/'+encodeURIComponent(r.id)+'/foto" target="_blank" rel="noopener"><img loading="lazy" src="/api/carregamentos-finais/'+encodeURIComponent(r.id)+'/foto" alt="Foto final do carregamento"></a><div><b>'+safe(r.motorista||'Motorista não informado')+'</b><div class="meta">Conferente: '+safe(r.conferente||'—')+'<br>Entregas: <b>'+nf(Number(r.quantidade_entregas||0))+'</b><br>Foto: '+safe(dt)+'</div></div></div>'
    }).join('')
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
async function refreshLoadingRecords(){
  if(window.__loadingRecordsBusy)return;
  window.__loadingRecordsBusy=true;
  try{
    const r=await fetch('/api/carregamentos-finais?limit=30&t='+Date.now(),{cache:'no-store'});
    const j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||'Falha ao carregar registros.');
    renderLoadingRecords(Array.isArray(j.rows)?j.rows:[])
  }catch(e){
    const box=$('#loadRecords');if(box)box.innerHTML='<div class="muted">Não foi possível carregar os registros: '+safe(e.message)+'</div>';
    const info=$('#hubLoadInfo');if(info)info.textContent='Registros de carregamento indisponíveis no momento.'
  }finally{window.__loadingRecordsBusy=false}
}
function setupLoadingForm(){
  const photo=$('#loadPhoto'),form=$('#loadFinalForm'),refresh=$('#loadRefresh');
  if(!photo||!form)return;
  if(refresh)refresh.onclick=refreshLoadingRecords;
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
      await refreshLoadingRecords()
    }catch(e){
      if(msg){msg.style.color='#b91c1c';msg.textContent=e.message}
    }finally{btn.disabled=false}
  }
}

function loadHeavyForTab(tab){
  if(tab==='dashboards'){
    setTimeout(()=>refreshSswMotoristas(),100);
    setTimeout(()=>refreshSswAtrasos(),450);
    setTimeout(()=>refreshSswRemetentes(),900);
    setTimeout(()=>refreshLoadingRecords(),1200);
  }else if(tab==='conferencia'){
    loadingDriverOptions();
    setTimeout(()=>refreshLoadingRecords(),50);
  }else if(tab==='ssw-motoristas'||tab==='motoristas-evolucao'){
    setTimeout(()=>refreshSswMotoristas(),80);
  }else if(tab==='ssw-atrasos'){
    setTimeout(()=>refreshSswAtrasos(),80);
  }else if(tab==='ssw-remetentes'||tab==='ssw-remetentes-comparativo'){
    setTimeout(()=>refreshSswRemetentes(),80);
  }
}
async function start(){
  init();
  $('#err').style.display='none';
  checkSsw();
  await refreshData(true);
  const view=new URLSearchParams(location.search).get('view');
  if(view){
    const b=$('.nav button[data-tab="'+view+'"]');
    if(b)b.click();else openTab(view)
  }
  loadHeavyForTab($('.section.active')?.id||'dashboard');
  setInterval(()=>{if(!document.hidden)refreshData(false)},5000);
  setInterval(()=>{if(!document.hidden)checkSsw()},60000);
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&['ssw-atrasos','dashboards'].includes(t))refreshSswAtrasos()},120000);
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&['ssw-remetentes','ssw-remetentes-comparativo','dashboards'].includes(t))refreshSswRemetentes()},120000);
  setInterval(()=>{const t=$('.section.active')?.id;if(!document.hidden&&['ssw-motoristas','motoristas-evolucao','dashboards'].includes(t))refreshSswMotoristas()},120000);
  window.addEventListener('focus',()=>refreshData(false));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshData(false)})
}
function openTab(tab){
  const b=$('.nav button[data-tab="'+tab+'"]');
  if(b)return b.click();
  $$('.nav button').forEach(x=>x.classList.remove('active'));
  $$('.section').forEach(x=>x.classList.remove('active'));
  const s=$('#'+tab);
  if(!s)return;
  s.classList.add('active');
  const titles={
    'ssw-atrasos':'SSW • CT-es Atrasados',
    'ssw-remetentes':'Entregas por Cliente Remetente',
    'ssw-remetentes-comparativo':'Comparativo de Clientes Remetentes',
    'ssw-motoristas':'SSW • Saídas x Baixas',
    'motoristas-evolucao':'Evolução por Motorista',
    'conferencia':'Final do Carregamento'
  };
  $('#pageTitle').textContent=titles[tab]||'Dashboards';
  if(tab==='ssw-atrasos')setTimeout(renderSswAtrasos,30);
  if(tab==='ssw-remetentes'||tab==='ssw-remetentes-comparativo')setTimeout(renderRemetentes,30);
  if(tab==='ssw-motoristas')setTimeout(renderSswMotoristas,30);
  if(tab==='motoristas-evolucao')setTimeout(renderDriverProgress,30);
  loadHeavyForTab(tab);
}
$$('.dash-open').forEach(b=>b.onclick=()=>openTab(b.dataset.open));
$$('.nav button').forEach(b=>b.onclick=()=>{
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
    if(b.dataset.tab==='dashboards'){
      renderSswAtrasos();
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
setupLoadingForm();
start();
