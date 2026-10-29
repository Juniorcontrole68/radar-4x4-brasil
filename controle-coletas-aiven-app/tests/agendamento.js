// Agendamento de entregas (agendamento.js): varredura do SSW, listas operacionais, histórico e rotas da tela.
// Roda contra o servidor em TEST_MODE (o mesmo de tests/e2e.js), com o banco de teste e sem rede externa:
// a leitura do SSW é simulada com leituras montadas aqui.
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const {Pool}=require('pg');
const ag=require('../agendamento.js');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=Agendamento::'+name)}}
const dia=n=>new Date(Date.now()+n*86400000).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL||'postgresql://teste:teste@127.0.0.1:5432/construlog_teste',ssl:false});
  console.log('Funções puras');
  check('CT-e no formato do SSW',ag.normCtrc('amr 123-4')==='AMR000123-4'&&ag.normCtrc('AMR000123-4')==='AMR000123-4');
  check('datas do SSW',ag.dataBr('21/10/26')==='2026-10-21'&&ag.dataBr('2026-10-21T10:00')==='2026-10-21'&&ag.dataBr('x')==='');

  let r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:ADMIN_USER,password:ADMIN_PASS})});
  const cookie=((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];
  check('login',!!cookie);
  const H={Cookie:cookie};
  const api=async(method,url,body,h=H)=>{const x=await fetch(B+url,{method,headers:{...h,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:x.status,j:await x.json().catch(()=>({}))}};
  const me=await api('GET','/api/painel/auth/me');
  const cli=me.j.user?.client_id?String(me.j.user.client_id):null;
  // começa limpo (só no banco de teste)
  await pool.query('DELETE FROM ag_eventos;DELETE FROM ag_agendamentos;DELETE FROM ag_notas;DELETE FROM ag_sincronizacoes;DELETE FROM ag_config');

  console.log('Acesso');
  check('sem login -> 401',(await fetch(B+'/api/painel/agendamentos/painel')).status===401);
  const sufixo=Date.now().toString(36);
  await api('POST','/api/painel/auth/users',{username:'ag_nao_'+sufixo,password:'senha-teste-1',permissions:['coletas']});
  const l=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'ag_nao_'+sufixo,password:'senha-teste-1'})});
  const semPerm={Cookie:((l.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0]};
  check('sem a permissão Agendamentos -> 403',(await api('GET','/api/painel/agendamentos/painel',undefined,semPerm)).status===403);
  let p=await api('GET','/api/painel/agendamentos/painel');
  check('painel antes da primeira sincronização: sem dados e marcado como desatualizado',p.status===200&&p.j.indicadores.pendentes===0&&p.j.indicadores.desatualizado===true&&!p.j.indicadores.sync.ultimaOk,p.j);
  check('configuração padrão: 02:00, amarelo 2 e vermelho 5 dias',p.j.config.hora_sync==='02:00'&&p.j.config.dias_amarelo===2&&p.j.config.dias_vermelho===5,p.j.config);
  check('parceiros padrão da Construlog (FCB, THM, Langbhen, JT Transportes e Transbarbosa)',['FCB','THM','LANGB','JT TRANSP','TRANSBARBOSA'].every(t=>p.j.config.parceiros.includes(t)),p.j.config);
  check('parceiro pelo remetente ou pelo pagador; os demais clientes ficam de fora',ag.ehParceiro(ag.termosParceiros(ag.PARCEIROS_PADRAO),'CONSTRUDECOR S.A - CUMBIC')&&ag.ehParceiro(ag.termosParceiros(ag.PARCEIROS_PADRAO),'FABRICA X','Langbhen Transportes')&&!ag.ehParceiro(ag.termosParceiros(ag.PARCEIROS_PADRAO),'COMERCIAL LEAL','LEAL DUTRA')&&!ag.ehParceiro(ag.termosParceiros(ag.PARCEIROS_PADRAO),'NAVAS E CIA LTDA')&&ag.ehParceiro([],'QUALQUER'));
  // o resto do teste usa clientes de mentira: sem filtro de parceiros (a seção "Parceiros" liga de novo)
  check('lista de parceiros vazia = todas as notas',(await api('PUT','/api/painel/agendamentos/config',{parceiros:''})).j.config?.parceiros==='');

  console.log('Varredura do SSW');
  const leitura1={pendentes:[
    {nf:'1001',ctrc:'AMR000101-1',remetente:'FABRICA ALFA',destinatario:'LOJA CENTRO',cidade:'CAMPINAS',uf:'SP',peso:120.5,volumes:4,status:'DISPONIVEL',mercadoria:'PISOS',emissao:'18/10/26'},
    {nf:'1002',ctrc:'AMR000102-2',remetente:'FABRICA ALFA',destinatario:'MERCADO BOM',cidade:'SUMARE',uf:'SP',peso:45,volumes:2,status:'DISPONIVEL'},
    {nf:'1003',ctrc:'AMR000103-3',remetente:'INDUSTRIA BETA',destinatario:'DEPOSITO NORTE',cidade:'PAULINIA',uf:'SP',peso:800,volumes:10},
    {nf:'1003',ctrc:'AMR000203-5',remetente:'OUTRA FABRICA',destinatario:'CLIENTE SUL',cidade:'AMERICANA',uf:'SP',peso:30,volumes:1},
    {nf:'0001001',ctrc:'AMR101-1',remetente:'FABRICA ALFA',destinatario:'LOJA CENTRO',cidade:'CAMPINAS',uf:'SP',peso:120.5,volumes:4}
  ],verificados:{}};
  let c=await ag.aplicarSnapshot(pool,cli,leitura1,null);
  check('primeira leitura: 4 notas novas (NF repetida no SSW conta uma vez; mesma NF com outro CT-e é outra nota)',c.novas===4&&c.pendentes_ssw===4,c);
  c=await ag.aplicarSnapshot(pool,cli,leitura1,null);
  check('repetir a mesma leitura não duplica nada (idempotente)',c.novas===0&&c.atualizadas===4&&(await pool.query('SELECT COUNT(*)::int n FROM ag_notas')).rows[0].n===4,c);
  let x=await api('GET','/api/painel/agendamentos/lista?aba=sem');
  check('Sem Agendamento: as 4 notas pendentes, com peso total',x.status===200&&x.j.total===4&&Math.round(x.j.peso*10)===9955,x.j);
  check('  ...com emissão, entrada na operação e dias sem agendamento',x.j.rows.some(r=>r.nf==='1001'&&r.data_emissao==='2026-10-18'&&r.data_entrada===dia(0)&&r.dias_sem===0),x.j.rows);
  x=await api('GET','/api/painel/agendamentos/buscar-nf?nf=1003');
  check('NF com número repetido devolve as duas para escolher (remetente, destinatário e CT-e)',x.j.rows.length===2&&new Set(x.j.rows.map(r=>r.ctrc)).size===2&&x.j.rows.every(r=>r.remetente&&r.destinatario),x.j);
  x=await api('GET','/api/painel/agendamentos/lista?aba=sem&remetente=alfa&cidade=camp');
  check('filtros juntos (remetente + cidade)',x.j.total===1&&x.j.rows[0].nf==='1001',x.j);

  console.log('Agendar, reagendar e cancelar');
  const n1001=(await api('GET','/api/painel/agendamentos/buscar-nf?nf=1001')).j.rows[0];
  x=await api('POST','/api/painel/agendamentos',{nota_id:n1001.nota_id,data_agendada:dia(1),observacao:'Ligar antes'});
  check('agenda só com a data e a observação',x.status===201&&x.j.id,x.j);
  const ag1001=x.j.id;
  check('a mesma nota não recebe um segundo agendamento ativo',(await api('POST','/api/painel/agendamentos',{nota_id:n1001.nota_id,data_agendada:dia(2)})).status===409);
  check('data anterior a hoje é recusada',(await api('POST','/api/painel/agendamentos',{nota_id:n1001.nota_id,data_agendada:dia(-1)})).status===400);
  x=await api('GET','/api/painel/agendamentos/lista?aba=sem');
  const y=await api('GET','/api/painel/agendamentos/lista?aba=agendadas');
  check('ao agendar: sai de Sem Agendamento e entra em Agendadas',x.j.total===3&&y.j.total===1&&y.j.rows[0].nf==='1001'&&y.j.rows[0].observacao==='Ligar antes'&&y.j.rows[0].data_agendada===dia(1),{sem:x.j.total,ag:y.j.rows});
  p=await api('GET','/api/painel/agendamentos/painel');
  check('indicadores: 4 pendentes, 1 com e 3 sem agendamento, 1 para amanhã',p.j.indicadores.pendentes===4&&p.j.indicadores.com_agendamento===1&&p.j.indicadores.sem_agendamento===3&&p.j.indicadores.amanha===1,p.j.indicadores);
  check('card "amanhã" filtra a lista',(await api('GET','/api/painel/agendamentos/lista?aba=agendadas&card=amanha')).j.total===1&&(await api('GET','/api/painel/agendamentos/lista?aba=agendadas&card=hoje')).j.total===0);
  // NF consultada no SSW na hora (ainda não veio em varredura)
  x=await api('POST','/api/painel/agendamentos',{nota:{nf:'5005',ctrc:'AMR000505-5',remetente:'FABRICA GAMA',destinatario:'CASA DO JOAO',cidade:'LIMEIRA',uf:'SP',peso:12,produto:'TINTA'},data_agendada:dia(0)});
  check('agenda uma NF consultada na hora no SSW (grava a nota junto)',x.status===201,x.j);
  const ag5005=x.j.id;
  check('NF agendada para hoje aparece no card "hoje"',(await api('GET','/api/painel/agendamentos/painel')).j.indicadores.hoje===1);
  x=await api('PATCH','/api/painel/agendamentos/'+ag1001,{data_agendada:dia(3),observacao:'Ligar antes; portão 2',motivo:'Cliente pediu'});
  check('reagenda e altera a observação',x.status===200,x.j);
  x=await api('POST','/api/painel/agendamentos/'+ag5005+'/cancelar',{motivo:'Cliente vai retirar'});
  check('cancela o agendamento',x.status===200,x.j);
  x=await api('GET','/api/painel/agendamentos/lista?aba=sem&nf=5005');
  check('agendamento cancelado: a nota volta para Sem Agendamento (continua pendente)',x.j.total===1,x.j);

  console.log('Entregue e devolvida saem das listas operacionais');
  const leitura2={pendentes:[leitura1.pendentes[2],leitura1.pendentes[3]],
    verificados:{'1001|AMR000101-1':{situacao:'entregue',texto:'21/10/26 10:15 01-MERCADORIA ENTREGUE',em:'21/10/26'},'1002|AMR000102-2':{situacao:'devolvida',texto:'DEVOLVIDA AO REMETENTE'}}};
  c=await ag.aplicarSnapshot(pool,cli,leitura2,null);
  check('segunda leitura: 1 entregue, 1 devolvida e 1 sem confirmação (verificação necessária)',c.entregues===1&&c.devolvidas===1&&c.verificar===1,c);
  x=await api('GET','/api/painel/agendamentos/lista?aba=agendadas');
  check('a entregue sai de Agendadas',x.j.total===0,x.j);
  x=await api('GET','/api/painel/agendamentos/lista?aba=sem');
  check('Sem Agendamento: as duas 1003 e a 5005 marcada "Verificação necessária" (não some sozinha)',x.j.total===3&&x.j.rows.find(r=>r.nf==='5005')?.situacao==='verificar'&&!x.j.rows.some(r=>['1001','1002'].includes(r.nf)),x.j.rows.map(r=>[r.nf,r.situacao]));
  check('nada foi apagado do banco',(await pool.query('SELECT COUNT(*)::int n FROM ag_notas')).rows[0].n===5);
  x=await api('GET','/api/painel/agendamentos/lista?aba=historico');
  check('Histórico: entregue, devolvida e a de agendamento cancelado',['1001','1002','5005'].every(n=>x.j.rows.some(r=>r.nf===n))&&x.j.rows.find(r=>r.nf==='1001').situacao==='entregue'&&x.j.rows.find(r=>r.nf==='1001').concluido_em==='2026-10-21'&&x.j.rows.find(r=>r.nf==='5005').cancelamentos===1,x.j.rows.map(r=>[r.nf,r.situacao,r.cancelamentos]));
  x=await api('GET','/api/painel/agendamentos/historico/'+n1001.nota_id);
  check('histórico da nota: agendado, reagendado (com motivo), observação e entregue pelo SSW',['agendado','reagendado','observacao','entregue'].every(t=>x.j.eventos.some(e=>e.tipo===t))&&x.j.eventos.find(e=>e.tipo==='reagendado').detalhe==='Cliente pediu'&&x.j.agendamentos[0].status==='concluido'&&x.j.agendamentos[0].reagendamentos===1,x.j);
  check('nota entregue não pode ser agendada',(await api('POST','/api/painel/agendamentos',{nota_id:n1001.nota_id,data_agendada:dia(1)})).status===409);
  // volta a constar pendente no SSW (ex.: reentrega): volta para a lista
  c=await ag.aplicarSnapshot(pool,cli,{pendentes:[leitura1.pendentes[1],leitura1.pendentes[2],leitura1.pendentes[3]],verificados:{'5005|AMR000505-5':{situacao:'em_rota',texto:'EM TRANSFERENCIA'}}},null);
  check('nota que volta para as pendências do SSW reaparece; a 5005 confirmada em rota sai da verificação',c.retornaram===1&&c.em_rota===1&&(await api('GET','/api/painel/agendamentos/lista?aba=sem&nf=1002')).j.total===1&&(await api('GET','/api/painel/agendamentos/lista?aba=sem&nf=5005')).j.rows[0]?.situacao==='em_rota',c);

  console.log('Sincronização: falha preserva os dados, log e idempotência');
  const antes=(await api('GET','/api/painel/agendamentos/painel')).j.indicadores;
  let s=await ag.sincronizar({pool,cli,origem:'automatica',usuario:'teste',lerSsw:async()=>{throw new Error('SSW fora do ar')}});
  let res=await s.promessa;
  check('SSW fora do ar: a sincronização falha e fica no log',res.status==='erro'&&/SSW fora do ar/.test(res.erro),res);
  p=await api('GET','/api/painel/agendamentos/painel');
  check('  ...as listas e os indicadores continuam como estavam, com alerta de falha',p.j.indicadores.pendentes===antes.pendentes&&p.j.indicadores.falhou===true&&p.j.indicadores.desatualizado===true,p.j.indicadores);
  s=await ag.sincronizar({pool,cli,origem:'automatica',usuario:'teste',lerSsw:async()=>({ok:true,pendentes:[]})});
  res=await s.promessa;
  check('leitura vazia do SSW não tira nenhuma nota (falha)',res.status==='erro'&&(await api('GET','/api/painel/agendamentos/painel')).j.indicadores.pendentes===antes.pendentes,res);
  let alvosVistos=null;
  s=await ag.sincronizar({pool,cli,origem:'automatica',usuario:'Varredura 02:00',lerSsw:async alvos=>{alvosVistos=alvos;await sleep(300);return{ok:true,pendentes:leitura1.pendentes.slice(1,4),verificados:{}}}});
  let dupla=null;try{await ag.sincronizar({pool,cli,origem:'manual',lerSsw:async()=>({})})}catch(e){dupla=e}
  check('não roda duas sincronizações ao mesmo tempo',dupla&&dupla.status===409);
  res=await s.promessa;
  check('sincronização ok: conferiu as notas que já conhecia',res.status==='ok'&&Array.isArray(alvosVistos)&&alvosVistos.some(a=>a.nf==='5005'),{res,alvos:alvosVistos});
  p=await api('GET','/api/painel/agendamentos/painel');
  check('painel com a última sincronização válida e sem alerta',p.j.indicadores.sync.ultimaOk?.id===String(res.id)&&p.j.indicadores.desatualizado===false&&p.j.indicadores.falhou===false,p.j.indicadores);
  x=await api('GET','/api/painel/agendamentos/sincronizacoes');
  check('log das sincronizações (falhas e sucesso)',x.j.rows.length===3&&x.j.rows.filter(r=>r.status==='erro').length===2,x.j.rows.map(r=>r.status));
  // botão manual pelo servidor: no modo teste não há SSW, então falha sem mexer em nada
  x=await api('POST','/api/painel/agendamentos/sincronizar');
  check('botão "Sincronizar SSW agora" responde na hora (roda em segundo plano)',x.status===202,x);
  for(let i=0;i<30;i++){await sleep(500);if(!(await api('GET','/api/painel/agendamentos/painel')).j.indicadores.rodando)break}
  x=await api('GET','/api/painel/agendamentos/sincronizacoes');
  check('  ...sem SSW no modo teste: falha registrada e notas preservadas',x.j.rows[0].origem==='manual'&&x.j.rows[0].status==='erro'&&(await api('GET','/api/painel/agendamentos/painel')).j.indicadores.pendentes===p.j.indicadores.pendentes,x.j.rows[0]);
  check('  ...e não aceita outra manual em menos de 2 minutos',(await api('POST','/api/painel/agendamentos/sincronizar')).status===429);

  console.log('Parceiros do agendamento e nome do produto');
  x=await api('PUT','/api/painel/agendamentos/config',{parceiros:'fcb; Construdec, LANGB'});
  check('administrador define os parceiros',x.status===200&&x.j.config.parceiros==='FCB, CONSTRUDEC, LANGB',x.j);
  const antesParc=(await pool.query("SELECT COUNT(*)::int n FROM ag_notas WHERE situacao='pendente'")).rows[0].n;
  c=await ag.aplicarSnapshot(pool,cli,{pendentes:[
    {nf:'7001',ctrc:'AMR000701-1',remetente:'CONSTRUDECOR S.A - CUMBIC',destinatario:'SILVANA',cidade:'SP',peso:28},
    {nf:'7002',ctrc:'AMR000702-2',remetente:'COMERCIAL LEAL',destinatario:'OBRA X',cidade:'CAMPINAS',peso:500},
    {nf:'7003',ctrc:'AMR000703-3',remetente:'FABRICA DELTA',pagador:'LANGBHEN TRANSPORTES',destinatario:'BEATRIZ',cidade:'SP',peso:75}
  ],verificados:{}},null);
  check('varredura grava só as notas dos parceiros (remetente ou pagador)',c.novas===2&&c.pendentes_ssw===2&&!(await pool.query("SELECT 1 FROM ag_notas WHERE nf='7002'")).rowCount,c);
  check('  ...e não mexe nas notas de outros clientes que já estavam gravadas',(await pool.query("SELECT COUNT(*)::int n FROM ag_notas WHERE situacao='pendente'")).rows[0].n===antesParc+2);
  x=await api('GET','/api/painel/agendamentos/lista?aba=sem');
  check('Sem Agendamento mostra só os parceiros',x.j.total===2&&x.j.rows.every(r=>['7001','7003'].includes(r.nf)),x.j.rows.map(r=>[r.nf,r.remetente]));
  p=await api('GET','/api/painel/agendamentos/painel');
  check('indicadores contam só os parceiros',p.j.indicadores.pendentes===2&&p.j.indicadores.sem_agendamento===2,p.j.indicadores);
  x=await api('POST','/api/painel/agendamentos',{nota:{nf:'7009',ctrc:'AMR000709-9',remetente:'LEAL DUTRA',destinatario:'Y',cidade:'SP'},data_agendada:dia(1)});
  check('NF de cliente que não é parceiro não pode ser agendada',x.status===422&&/parceiro/.test(x.j.error),x);
  x=await api('POST','/api/painel/agendamentos',{nota:{nf:'7010',ctrc:'AMR000710-0',remetente:'CONSTRUDECOR S.A - CUMBIC',destinatario:'DANIELLA',cidade:'SP',produto:'CONSTRULOG DIST COMERCIO E TRA PAG: 1; TUBO PVC 100MM; Emissao 28/10/26 10:15'},data_agendada:dia(1)});
  check('agenda NF de parceiro consultada na hora',x.status===201,x.j);
  x=await api('GET','/api/painel/agendamentos/lista?aba=agendadas&nf=7010');
  check('produto do SSW não aparece: o campo fica em branco para o operador',x.j.rows[0]&&x.j.rows[0].produto==='',x.j.rows);
  const n7001=(await api('GET','/api/painel/agendamentos/buscar-nf?nf=7001')).j.rows[0];
  x=await api('POST','/api/painel/agendamentos',{nota_id:n7001.nota_id,data_agendada:dia(2),produto:'  TUBO PVC 100MM  '});
  check('operador digita o produto ao agendar',x.status===201,x.j);
  x=await api('GET','/api/painel/agendamentos/lista?aba=agendadas&nf=7001');
  check('  ...e a lista mostra o que ele digitou',x.j.rows[0]?.produto==='TUBO PVC 100MM',x.j.rows);
  const ag7001=x.j.rows[0].agendamento_id;
  x=await api('PATCH','/api/painel/agendamentos/'+ag7001,{produto:'CAIXA D AGUA 1000L'});
  check('  ...pode trocar o produto em Alterar',x.status===200&&(await api('GET','/api/painel/agendamentos/lista?aba=agendadas&nf=7001')).j.rows[0]?.produto==='CAIXA D AGUA 1000L',x.j);
  c=await ag.aplicarSnapshot(pool,cli,{pendentes:[{nf:'7001',ctrc:'AMR000701-1',remetente:'CONSTRUDECOR S.A - CUMBIC',mercadoria:'PISOS'}],verificados:{}},null);
  check('  ...a varredura não troca o produto do operador',(await api('GET','/api/painel/agendamentos/lista?aba=agendadas&nf=7001')).j.rows[0]?.produto==='CAIXA D AGUA 1000L');
  check('  ...busca pelo produto digitado',(await api('GET','/api/painel/agendamentos/lista?aba=agendadas&q=caixa')).j.rows.some(r=>r.nf==='7001'));

  console.log('Baixa pelo app do motorista');
  {
    const comp=(nf,ctrc,resultado,minutos=0)=>pool.query(`INSERT INTO entregas_comprovantes(client_id,client_uuid,work_date,driver_name,chave,ctrc,nf,resultado,motivo_falha,registrado_em)
      VALUES($1,$2,CURRENT_DATE,'Motorista Agendamento',$3,$4,$5,$6,$7,NOW()+($8||' minutes')::interval)`,
      [cli,'ag-'+nf+'-'+resultado+'-'+Math.random().toString(36).slice(2),ctrc?'ctrc:'+ctrc:'nf:'+nf,ctrc,nf,resultado,resultado==='falhou'?'ausente':null,String(minutos)]);
    await comp('7003','','entregue');                 // sem CT-e no comprovante: vale a NF
    await comp('7010','AMR 999-9','entregue');        // mesma NF, outro CT-e: é outra nota
    await comp('7001','AMR000701-1','entregue',-10);
    await comp('7001','AMR000701-1','falhou');        // o mais recente é "não entregue"
    const bx=await ag.baixasDosMotoristas(pool);
    const sit=async nf=>(await pool.query('SELECT situacao,baixa_motorista_em FROM ag_notas WHERE nf=$1',[nf])).rows[0];
    check('entregue no app vira entregue no agendamento',(await sit('7003')).situacao==='entregue'&&!!(await sit('7003')).baixa_motorista_em,bx);
    check('  ...comprovante de outro CT-e com a mesma NF não baixa',(await sit('7010')).situacao!=='entregue');
    check('  ...o comprovante mais recente vale ("não entregue" depois do "entregue")',(await sit('7001')).situacao!=='entregue');
    x=await api('GET','/api/painel/agendamentos/lista?aba=historico&nf=7003');
    check('  ...a nota vai para o histórico',x.j.rows.some(r=>r.nf==='7003'&&r.situacao==='entregue'),x.j.rows);
    await comp('7010','AMR000710-0','entregue');
    await ag.baixasDosMotoristas(pool);
    check('  ...nota agendada: o agendamento é concluído',(await pool.query("SELECT a.status FROM ag_agendamentos a JOIN ag_notas n ON n.id=a.nota_id WHERE n.nf='7010'")).rows[0]?.status==='concluido');
    const h=(await pool.query("SELECT e.usuario,e.detalhe FROM ag_eventos e JOIN ag_notas n ON n.id=e.nota_id WHERE n.nf='7010' AND e.tipo='entregue'")).rows[0];
    check('  ...histórico da nota registra a baixa do motorista',h?.usuario==='App do motorista'&&/Motorista Agendamento/.test(h.detalhe||''),h);
    c=await ag.aplicarSnapshot(pool,cli,{pendentes:[{nf:'7003',ctrc:'AMR000703-3',remetente:'FABRICA DELTA',pagador:'LANGBHEN TRANSPORTES'}],verificados:{}},null);
    check('  ...a varredura do SSW (ainda sem a baixa) não reabre a nota',(await sit('7003')).situacao==='entregue'&&c.retornaram===0,c);
    check('  ...rodar de novo não duplica',(await ag.baixasDosMotoristas(pool)).entregues===0);
    x=await api('POST','/api/painel/agendamentos/baixas');
    check('  ...botão "Atualizar baixas" confere na hora',x.status===200&&x.j.ok&&x.j.entregues===0,x);
    check('  ...e exige login',(await fetch(B+'/api/painel/agendamentos/baixas',{method:'POST'})).status===401);
  }
  console.log('Baixa do motorista no rastreio do SSW');
  {
    await ag.aplicarSnapshot(pool,cli,{pendentes:[
      {nf:'7101',ctrc:'AMR017002-0',remetente:'CONSTRUDECOR S.A - CUMBIC'},
      {nf:'7102',ctrc:'AMR017003-8',remetente:'CONSTRUDECOR S.A - CUMBIC'},
      {nf:'7103',ctrc:'',remetente:'CONSTRUDECOR S.A - CUMBIC'}],verificados:{}},null);
    const sit=async nf=>(await pool.query('SELECT situacao,status_ssw,baixa_motorista_em FROM ag_notas WHERE nf=$1',[nf])).rows[0];
    let pedido=null;
    const lerBaixas=async o=>{pedido=o;return{ok:true,rows:[
      {ctrc:'017002-0',nf:'7101',motorista:'GILMAR DUARTE',baixaDataHora:dia(0)+'T08:38:38'},   // CT-e sem a série, como vem do rastreio
      {ctrc:'017999-1',nf:'7102',motorista:'OUTRO',baixaDataHora:dia(0)+'T09:00:00'},          // mesma NF, outro CT-e
      {ctrc:'',nf:'7103',motorista:'',baixaDataHora:dia(0)+'T10:15:00'}]}};
    const bx=await ag.baixasDosMotoristas(pool,{lerBaixas,ontem:true});
    check('entregue no rastreio do SSW vira entregue no agendamento',(await sit('7101')).situacao==='entregue'&&!!(await sit('7101')).baixa_motorista_em&&bx.entregues>=2,bx);
    check('  ...o texto traz o motorista e a hora da baixa',/GILMAR DUARTE em \d{2}\/\d{2}, 08:38/.test((await sit('7101')).status_ssw||''),(await sit('7101')).status_ssw);
    check('  ...pede também a véspera quando mandado',pedido&&pedido.ontem===true,pedido);
    check('  ...outro CT-e com a mesma NF não baixa',(await sit('7102')).situacao!=='entregue');
    check('  ...sem CT-e vale a NF',(await sit('7103')).situacao==='entregue');
    const h=(await pool.query("SELECT e.usuario FROM ag_eventos e JOIN ag_notas n ON n.id=e.nota_id WHERE n.nf='7101' AND e.tipo='entregue'")).rows[0];
    check('  ...histórico registra a baixa do SSW',h?.usuario==='Baixa do motorista (SSW)',h);
    check('  ...rodar de novo não duplica',(await ag.baixasDosMotoristas(pool,{lerBaixas})).entregues===0);
    let erro='';try{await ag.baixasDosMotoristas(pool,{lerBaixas:async()=>({ok:false,error:'SSW fora'})})}catch(e){erro=e.message}
    check('  ...SSW fora: erro, nada muda',erro==='SSW fora'&&(await sit('7102')).situacao!=='entregue',erro);
  }
  console.log('CT-e sem a série e cidade em branco');
  {
    const nota=async nf=>(await pool.query('SELECT id,ctrc,cidade,uf,destinatario,situacao FROM ag_notas WHERE nf=$1 ORDER BY id',[nf])).rows;
    await ag.aplicarSnapshot(pool,cli,{pendentes:[{nf:'7201',ctrc:'000885-1',remetente:'CONSTRUDECOR S.A - CUMBIC',destinatario:'LUIZ PEREIRA DA SILVA',cidade:'INDAIATUBA',uf:'SP'}],verificados:{}},null);
    await ag.aplicarSnapshot(pool,cli,{pendentes:[{nf:'7201',ctrc:'AMR000885-1',remetente:'CONSTRUDECOR S.A - CUMBIC',destinatario:'LUIZ PEREIRA DA SILVA',cidade:'INDAIATUBA',uf:'SP'}],verificados:{}},null);
    let n=await nota('7201');
    check('CT-e do BI2 sem a série e o mesmo CT-e da opção 38: uma nota só, com a série',n.length===1&&n[0].ctrc==='AMR000885-1',n);
    await ag.aplicarSnapshot(pool,cli,{pendentes:[{nf:'7201',ctrc:'AMS000885-1',remetente:'CONSTRUDECOR S.A - CUMBIC'}],verificados:{}},null);
    check('  ...série diferente com o mesmo número é outra nota',(await nota('7201')).length===2);
    await ag.aplicarSnapshot(pool,cli,{pendentes:[{nf:'7202',ctrc:'000886-0',remetente:'CONSTRUDECOR S.A - CUMBIC',destinatario:'PATRICIA BARBOSA ..',cidade:'',uf:'SP'}],verificados:{}},null);
    await ag.aplicarSnapshot(pool,cli,{pendentes:[{nf:'9999',ctrc:'AMR009999-9',remetente:'CONSTRUDECOR S.A - CUMBIC'}],
      verificados:{'7202|000886-0':{situacao:'em_rota',ctrc:'AMR000886-0',texto:'85-SAIDA PARA ENTREGA',cidade:'SOROCABA',uf:'SP',destinatario:'PATRICIA BARBOSA DE SOUZA'}}},null);
    n=(await nota('7202'))[0];
    check('  ...a conferência no SSW completa o CT-e com a série, a cidade e o nome cortado',n.situacao==='em_rota'&&n.ctrc==='AMR000886-0'&&n.cidade==='SOROCABA'&&n.destinatario==='PATRICIA BARBOSA DE SOUZA',n);
  }
  check('volta sem filtro de parceiros para o resto do teste',(await api('PUT','/api/painel/agendamentos/config',{parceiros:''})).status===200);

  console.log('Configuração, coletas e exportação');
  x=await api('PUT','/api/painel/agendamentos/config',{hora_sync:'03:30',dias_amarelo:3,dias_vermelho:6});
  check('administrador muda o horário e os limites de dias',x.status===200&&x.j.config.hora_sync==='03:30'&&x.j.config.dias_amarelo===3,x.j);
  check('vermelho precisa ser maior que amarelo',(await api('PUT','/api/painel/agendamentos/config',{dias_amarelo:5,dias_vermelho:4})).status===400);
  check('Coletas Agendadas responde',(await api('GET','/api/painel/agendamentos/lista?aba=coletas')).status===200);
  x=await api('GET','/api/painel/agendamentos/lista?aba=pendentes&per=5000');
  check('lista para exportar (todas as pendentes, com e sem agendamento)',x.status===200&&x.j.total===x.j.rows.length&&x.j.total>=3,x.j.total);
  check('aba inválida -> 400',(await api('GET','/api/painel/agendamentos/lista?aba=xyz')).status===400);
  // a tela nova está no painel e a antiga saiu
  const html=await (await fetch(B+'/dashboard/',{headers:H})).text();
  check('tela nova no painel (formulário, abas e filtros) e a antiga removida',html.includes('id="agendamento-entregas"')&&html.includes('id="agNf"')&&html.includes('data-aba="sem"')&&!html.includes('agendamento-teste'),'');
  check('rota antiga removida',(await api('GET','/api/painel/agendamento-teste')).status===404||(await api('GET','/api/painel/agendamento-teste')).status===405);

  await pool.end();
  console.log('\n'+pass+' ok, '+fail+' falha(s)');
  process.exit(fail?1:0)
})().catch(e=>{console.error(e);process.exit(1)});
