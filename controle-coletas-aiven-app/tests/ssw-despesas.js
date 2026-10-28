// Despesas da opção 475 do SSW na DRE e no Contas a Pagar (dashboard/ssw-despesas.js + dre.js).
// Roda contra o SSW de mentira (tests/apoio/ssw-falso.js), sem rede externa; nunca toca no SSW real.
// Pré-requisitos: os mesmos de tests/ssw-sessao.js (servidor sem TEST_MODE, com sem-rede.js e ssw-desvio.js).
const B=process.env.BASE_URL||'http://127.0.0.1:10000',M='http://127.0.0.1:'+(process.env.MOCK_PORT||10555);
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const lib=require('../dashboard/ssw-despesas.js'),dre=require('../dre.js');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=SSW 475::'+name)}}

(async()=>{
  console.log('Leitura da tela e do resultado (sem servidor)');
  {const e=lib.envioDaListagem('<form><input name="f1" value="AMR"><input name="f2" value="151026"><input name="f3" value="151026"><a onclick="ajaxEnvia(\'P1\',1)">&#9658;</a></form>','2026-10-01','2026-10-31');
   check('sem o bloco Situação T / Listar em V a leitura recusa e não envia nada',e.ok===false&&!e.params,e)}
  {const x=lib.despesasDaListagem('<xml><rs><r><f0>2001</f0><f1>0420 COMBUSTIVEL</f1><f2>POSTO X</f2><f3>05/10/26</f3><f4>1.000,50</f4><f5>LIQUIDADA</f5></r><r><f0>Total</f0><f4>1.000,50</f4></r></rs></xml>').despesas;
   check('resultado em XML (sem cabeçalho): valor, data, evento, lançamento e situação; total fica fora',x.length===1&&x[0].valor===1000.5&&x[0].data==='2026-10-05'&&x[0].evento==='0420 COMBUSTIVEL'&&x[0].lancamento==='2001'&&lib.liquidada(x[0].situacao),x)}
  {const r=c=>'<r>'+c.map((v,i)=>'<f'+i+'>'+v+'</f'+i+'>').join('')+'</r>';
   const x=lib.despesasDaListagem('<xml><rs>'+r(['AMR','001379','01/01','5306','TELEFONIA E COMUNIC','GENYO TECNOLOGIA','GENYO CONSTRULOG','282','27/09/26','02/10/26','03/10/26','164,03'])+
     r(['AMR','001444','01/01','5403','PEDAGIOS','MAXIFROTA SERVICOS','PEDAGIO','5','05/10/26','05/10/26','06/10/26','600,00'])+r(['AMR','001435','01/01','5302','MANUTENCAO E CONS','INES REGINA','','5','05/10/26','09/10/26','09/10/26','300,00'])+'</rs></xml>').despesas;
   check('tela da 475 (Filial, Lançamento, Parcela, Evento, Descrição…): evento com código e nome, data de pagamento',x.length===3&&x[0].evento==='5306 - TELEFONIA E COMUNIC'&&x[0].lancamento==='001379'&&x[0].fornecedor==='GENYO TECNOLOGIA'&&x[0].descricao==='GENYO CONSTRULOG'&&x[0].data==='2026-10-03'&&x[0].valor===164.03,x);
   check('cada evento da 475 vai para a sua conta da DRE',x.map(d=>dre.contaSugerida(d.evento)).join()==='utilidades,pedagio,manutencao'&&dre.eventoChave(x[1].evento)==='5403',x.map(d=>dre.contaSugerida(d.evento)))}
  {const x=lib.despesasDaListagem('<pre>2002   0310 PEDAGIO     SEM PARAR      10/10/2026     412,75   A VENCER\n           Total geral                                 412,75</pre>').despesas;
   check('resultado em texto (<pre>)',x.length===1&&x[0].valor===412.75&&x[0].data==='2026-10-10'&&!lib.liquidada(x[0].situacao),x)}
  check('conta sugerida pelo nome do evento; salário fica fora (já vem dos holerites)',dre.contaSugerida('0420 - COMBUSTIVEL')==='combustivel'&&dre.contaSugerida('PEDAGIO')==='pedagio'&&dre.contaSugerida('0101 - SALARIOS')==='ignorar'&&dre.contaSugerida('INSS FOLHA')==='encargos'&&dre.contaSugerida('MATERIAL DE ESCRITORIO')==='adm_outras');

  console.log('Servidor contra o SSW de mentira');
  let r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:ADMIN_USER,password:ADMIN_PASS})});
  const H={Cookie:((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0]};
  check('login',!!H.Cookie);
  const api=async(method,url,body)=>{const x=await fetch(B+url,{method,headers:{...H,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:x.status,j:await x.json().catch(()=>({}))}};
  const {Client}=require('pg');const pg=new Client({connectionString:process.env.DATABASE_URL||'postgresql://teste:teste@127.0.0.1:5432/construlog_teste'});await pg.connect();
  const LANCS=['104512','104513','104520','104530','104541'];
  const limpar=async()=>{await pg.query("DELETE FROM bills WHERE ssw_lancamento = ANY($1) OR description='Combustível Lançado À Mão'",[LANCS]);await pg.query("DELETE FROM dre_ssw_despesas WHERE competencia='2026-10-01'");await pg.query("DELETE FROM dre_ssw_eventos")};
  await limpar();
  await fetch(M+'/__mock/despesa?lanc=104513&sit=A VENCER');

  let x=await fetch(B+'/api/ssw/despesas475?from=2026-10-01&to=2026-10-31');
  check('sem login a leitura da 475 é recusada',x.status===401||x.status===403,x.status);
  x=await api('GET','/api/ssw/despesas475?from=2026-10-01&to=2026-12-31');
  check('período maior que 62 dias é recusado',x.status===400,x);
  x=await api('GET','/api/ssw/despesas475?from=2026-10-01&to=2026-10-31');
  const st=await (await fetch(M+'/__mock/stats')).json();
  check('lê as 5 despesas da listagem da 475 (total geral fora)',x.status===200&&x.j.despesas?.length===5&&Math.abs(x.j.total-27733.05)<0.01,x.j);
  check('  ...usou só a listagem (P3), com o período de pagamento do mês, Situação T e Listar em V',st.despesasProibidas===0&&st.ultimaListagem?.act==='P3'&&st.ultimaListagem.f7==='011026'&&st.ultimaListagem.f8==='311026'&&st.ultimaListagem.f12==='T'&&st.ultimaListagem.f13==='V',st.ultimaListagem);
  const d=x.j.despesas.find(y=>y.lancamento==='104512');
  check('  ...com lançamento, evento, fornecedor, data de pagamento e situação',d&&d.evento==='0420 - COMBUSTIVEL'&&d.fornecedor==='POSTO ESTRELA LTDA'&&d.data==='2026-10-05'&&d.valor===1250.4&&d.situacao==='LIQUIDADA',d);

  // conta da empresa já lançada à mão no Contas a Pagar: deve ser ligada ao lançamento 104513 (980,00, venc. 12/10)
  await pg.query("INSERT INTO bills(id,description,supplier,area,category,amount,due_date,status) VALUES(gen_random_uuid(),'Combustível Lançado À Mão','Posto','Empresa','Combustível',980,'2026-10-13','pending')");
  let g=await api('POST','/api/dre/ssw-despesas',{competencia:'2026-10',despesas:x.j.despesas});
  check('grava as despesas do mês na DRE',g.status===200&&g.j.despesas===5,g.j);
  check('  ...Contas a Pagar: 4 contas novas, 1 ligada à que já existia, 3 já liquidadas',g.j.contasPagar?.criadas===4&&g.j.contasPagar.ligadas===1&&g.j.contasPagar.liquidadas===3,g.j.contasPagar);
  let b=(await pg.query("SELECT ssw_lancamento,status,to_char(payment_date,'YYYY-MM-DD') AS pg,area,amount::float8 FROM bills WHERE ssw_lancamento = ANY($1) OR description='Combustível Lançado À Mão' ORDER BY ssw_lancamento",[LANCS])).rows;
  const por=k=>b.find(y=>y.ssw_lancamento===k)||{};
  check('  ...a liquidada na 476 entra paga, na data de pagamento; a lançada à mão continua pendente',b.length===5&&por('104512').status==='paid'&&por('104512').pg==='2026-10-05'&&por('104512').area==='Empresa'&&por('104513').status==='pending',b);
  g=await api('POST','/api/dre/ssw-despesas',{competencia:'2026-10',despesas:x.j.despesas});
  check('ler de novo não duplica nada',g.j.contasPagar?.criadas===0&&g.j.contasPagar.ligadas===0&&g.j.contasPagar.liquidadas===0&&(await pg.query('SELECT COUNT(*)::int n FROM bills WHERE ssw_lancamento = ANY($1)',[LANCS])).rows[0].n===5,g.j.contasPagar);
  await fetch(M+'/__mock/despesa?lanc=104513&sit=LIQUIDADA');
  x=await api('GET','/api/ssw/despesas475?from=2026-10-01&to=2026-10-31');
  g=await api('POST','/api/dre/ssw-despesas',{competencia:'2026-10',despesas:x.j.despesas});
  b=(await pg.query("SELECT status,to_char(payment_date,'YYYY-MM-DD') AS pg FROM bills WHERE ssw_lancamento='104513'")).rows[0];
  check('liquidada na 476 depois: a conta fica paga no Contas a Pagar',g.j.contasPagar?.liquidadas===1&&b?.status==='paid'&&b.pg==='2026-10-12',{cp:g.j.contasPagar,b});

  let a=await api('GET','/api/dre?ano=2026');
  const val=id=>(a.j.linhas||[]).find(l=>l.id===id)?.meses?.[9]||0;
  check('DRE de outubro: combustível, pedágio e outras adm. pelo evento; salário do SSW fica fora',Math.abs(val('combustivel')-2230.4)<0.01&&Math.abs(val('pedagio')-412.75)<0.01&&Math.abs(val('adm_outras')-89.9)<0.01&&val('salarios')===0,{c:val('combustivel'),p:val('pedagio'),a:val('adm_outras'),s:val('salarios')});
  let m=await api('GET','/api/dre/mes?competencia=2026-10');
  check('mês mostra os eventos com a conta sugerida',m.j.sswDespesas?.length===4&&m.j.sswDespesas.every(e=>!e.escolhida)&&m.j.sswDespesas.find(e=>e.evento_chave==='101')?.conta==='ignorar',m.j.sswDespesas);
  x=await api('PUT','/api/dre/ssw-eventos',{evento_chave:'777',conta:'nao-existe'});
  check('conta inexistente é recusada',x.status===400,x);
  x=await api('PUT','/api/dre/ssw-eventos',{evento_chave:'777',conta:'sistemas'});
  a=await api('GET','/api/dre?ano=2026');
  check('escolher a conta de um evento move o valor na DRE',x.status===200&&Math.abs(val('sistemas')-89.9)<0.01&&val('adm_outras')===0,{s:val('sistemas'),a:val('adm_outras')});
  m=await api('GET','/api/dre/mes?competencia=2026-10');
  check('  ...e fica marcada como escolhida',m.j.sswDespesas.find(e=>e.evento_chave==='777')?.escolhida===true);

  await limpar();await pg.end();
  console.log('\n'+pass+' OK, '+fail+' falha(s)');
  process.exit(fail?1:0)
})().catch(e=>{console.error(e);process.exit(1)});
