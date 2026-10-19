// Despesas (DRE) do Financeiro e holerites em PDF da conta Salários (dre.js).
// Roda contra o servidor em TEST_MODE (o mesmo de tests/e2e.js), sem rede externa.
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const lib=require('../dre.js');
const {PDFDocument,StandardFonts}=require('pdf-lib');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=DRE::'+name)}}

// Holerite no layout mais comum (rótulos do rodapé numa linha, valores na de baixo), com as duas vias na página
const HOL_JOAO=[
  'Recibo de Pagamento de Salário            Referente ao Mês: Outubro/2026',
  'Código  Nome do Funcionário            CBO   Departamento',
  '12      JOAO DA SILVA                  782510   1',
  'Cargo: MOTORISTA DE CAMINHAO',
  'Cód.  Descrição            Referência   Vencimentos   Descontos',
  '8781  DIAS NORMAIS         30,00        3.500,00',
  '150   HORAS EXTRAS 50%     10,00        227,27',
  '151   DSR S/ HORAS EXTRAS  4,00         45,45',
  '998   I.N.S.S.             9,00                       315,00',
  '999   IMPOSTO DE RENDA RETIDO  7,50                   105,00',
  'Total de Vencimentos    Total de Descontos',
  '3.500,00    420,00',
  'Valor Líquido 3.080,00',
  'Salário Base   Sal. Contr. INSS   Base Cálc. FGTS   F.G.T.S do Mês   Base Cálc. IRRF   Faixa IRRF',
  '3.500,00   3.500,00   3.500,00   280,00   2.765,00   7,50'
];
// Outro layout: rótulo e valor na mesma linha
const HOL_MARIA=[
  'DEMONSTRATIVO DE PAGAMENTO     Competência: 10/2026',
  'Funcionário: MARIA APARECIDA SOUZA     Admissão: 01/02/2024',
  'Função: AUXILIAR ADMINISTRATIVO',
  'SALARIO 2.200,00',
  'HORAS EXTRAS 250,00',
  'INSS 165,00',
  'Total Proventos: 2.450,00     Total Descontos: 190,00',
  'Líquido a Receber: 2.260,00',
  'FGTS do mês: 196,00'
];
async function pdfHolerites(paginas){
  const doc=await PDFDocument.create(),f=await doc.embedFont(StandardFonts.Helvetica);
  for(const vias of paginas){
    const pg=doc.addPage([595,842]);let y=800;
    for(const linhas of vias){for(const l of linhas){pg.drawText(l,{x:30,y,size:8,font:f});y-=13}y-=40}
  }
  return Buffer.from(await doc.save())
}

(async()=>{
  console.log('Contas e leitura (dre.js)');
  check('mês: "2026-10", "2026-10-15", "10/2026" e mês que não existe',lib.competencia('2026-10')==='2026-10'&&lib.competencia('2026-10-15')==='2026-10'&&lib.competencia('10/2026')==='2026-10'&&lib.competencia('2026-13')==='');
  {const d=lib.montarDre(2026,[{conta:'receita_fretes',mes:'2026-10',valor:100000},{conta:'impostos_venda',mes:'2026-10',valor:10000},{conta:'combustivel',mes:'2026-10',valor:30000},
    {conta:'salarios',mes:'2026-10',valor:20000},{conta:'salarios',mes:'2026-10',valor:5000},{conta:'receitas_fin',mes:'2026-10',valor:500},{conta:'irpj_csll',mes:'2026-10',valor:3000},
    {conta:'aluguel',mes:'2025-10',valor:999},{conta:'inexistente',mes:'2026-10',valor:1}]);
   const L=id=>d.linhas.find(l=>l.id===id),out=9;
   check('DRE: receita líquida, lucro bruto, EBITDA e lucro líquido na ordem das contas',L('receita_liquida').meses[out]===90000&&L('lucro_bruto').meses[out]===60000&&L('ebitda').meses[out]===35000&&L('antes_ir').meses[out]===35500&&L('lucro_liquido').meses[out]===32500,d.linhas.filter(l=>l.tipo==='subtotal').map(l=>[l.id,l.meses[out]]));
   check('  ...cada conta no seu grupo, somando os lançamentos do mês, e o total do ano',L('salarios').meses[out]===25000&&L('pessoal').meses[out]===25000&&L('salarios').total===25000&&L('lucro_liquido').total===32500);
   check('  ...ignora outro ano e conta que não existe',L('aluguel').total===0&&!d.linhas.some(l=>l.id==='inexistente'))}
  {const h=lib.lerHolerite(HOL_JOAO.join('\n'));
   check('holerite (valores na linha de baixo): funcionário, cargo, mês, vencimentos, descontos e líquido',h.funcionario==='JOAO DA SILVA'&&h.cargo==='MOTORISTA DE CAMINHAO'&&h.competencia==='2026-10'&&h.vencimentos===3500&&h.descontos===420&&h.liquido===3080,h);
   check('  ...salário base, FGTS do mês, INSS e IRRF descontados',h.salario_base===3500&&h.fgts===280&&h.inss===315&&h.irrf===105,h)}
  {const h=lib.lerHolerite(['Cód. Descrição Ref. Vencimentos Descontos','001 SALARIO 220:00 2.000,00','150 HORA EXTRA 50% 08:30 115,91','160 H.EXTRA 100% 2,00 36,36','170 REFLEXO HORA EXTRA DSR 30,45','Total de Vencimentos Total de Descontos','2.182,72 0,00'].join('\n'));
   check('hora extra: soma 50% e 100% (horas em 08:30 ou 2,00); reflexo/DSR fica fora; vencimentos não mudam',h.hora_extra===152.27&&h.horas_extras===10.5&&h.vencimentos===2182.72,h)}
  {const h=lib.lerHolerite(HOL_MARIA.join('\n'));
   check('hora extra só com o valor (sem horas na linha)',h.hora_extra===250&&h.horas_extras===null,h)}
  {const h=lib.lerHolerite(HOL_MARIA.filter(l=>!/EXTRA/.test(l)).join('\n'));
   check('holerite sem hora extra: campo vazio',h.hora_extra===null,h)}
  {const h=lib.lerHolerite(HOL_MARIA.join('\n'));
   check('holerite (rótulo e valor na mesma linha)',h.funcionario==='MARIA APARECIDA SOUZA'&&h.cargo==='AUXILIAR ADMINISTRATIVO'&&h.competencia==='2026-10'&&h.vencimentos===2450&&h.descontos===190&&h.liquido===2260&&h.fgts===196&&h.inss===165,h)}
  const pdf=await pdfHolerites([[HOL_JOAO,HOL_JOAO],[HOL_MARIA]]);
  {const x=await lib.holeritesDoPdf(pdf);
   check('PDF com dois funcionários (um com as duas vias na mesma página) vira dois holerites',x.paginas===2&&x.holerites.length===2&&x.holerites[0].funcionario==='JOAO DA SILVA'&&x.holerites[0].liquido===3080&&x.holerites[1].funcionario==='MARIA APARECIDA SOUZA'&&x.holerites[1].vencimentos===2450,x)}

  let r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:ADMIN_USER,password:ADMIN_PASS})});
  const cookie=((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];
  check('login',!!cookie);
  const H={Cookie:cookie};
  const api=async(method,url,body,h=H)=>{const x=await fetch(B+url,{method,headers:{...h,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:x.status,j:await x.json().catch(()=>({})),x}};
  const ano=2031,mes=ano+'-10';

  console.log('Acesso');
  r=await fetch(B+'/api/dre?ano='+ano);check('sem login -> 401',r.status===401,'veio '+r.status);
  const sufixo=Date.now().toString(36);
  const cria=async(nome,permissions)=>{
    const x=await api('POST','/api/painel/auth/users',{username:nome,password:'senha-teste-1',permissions});
    const l=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:nome,password:'senha-teste-1'})});
    return{criou:x.status,id:x.j.user?.id||x.j.id,H:{Cookie:((l.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0]}}
  };
  const sem=await cria('dre_nao_'+sufixo,['coletas','dashboard']),com=await cria('dre_sim_'+sufixo,['financeiro']);
  check('usuários de teste criados',sem.criou===201&&com.criou===201&&!!sem.H.Cookie&&!!com.H.Cookie,{sem:sem.criou,com:com.criou});
  check('sem a permissão Financeiro -> 403',(await api('GET','/api/dre?ano='+ano,undefined,sem.H)).status===403);
  check('com a permissão Financeiro abre o DRE',(await api('GET','/api/dre?ano='+ano,undefined,com.H)).status===200);

  console.log('Lançamentos manuais');
  let a=await api('POST','/api/dre/lancamentos',{competencia:mes,conta:'aluguel',descricao:'Aluguel do galpão',valor:'8.500,00'});
  check('lança o aluguel do mês',a.status===201&&a.j.id,a.j);
  const idAluguel=a.j.id;
  a=await api('POST','/api/dre/lancamentos',{competencia:mes,conta:'combustivel',descricao:'Diesel',valor:'12.000,50'});check('lança combustível',a.status===201);
  check('recusa conta que não existe, valor zero e mês inválido',(await api('POST','/api/dre/lancamentos',{competencia:mes,conta:'xyz',valor:10})).status===400&&(await api('POST','/api/dre/lancamentos',{competencia:mes,conta:'aluguel',valor:'0'})).status===400&&(await api('POST','/api/dre/lancamentos',{competencia:'2031-13',conta:'aluguel',valor:5})).status===400);

  console.log('Receita do SSW');
  a=await api('POST','/api/dre/ssw',{competencia:mes,valor:150000});check('grava a receita de fretes lida do SSW',a.status===200);
  a=await api('POST','/api/dre/ssw',{competencia:mes,valor:160000.25});check('ler de novo troca o valor do mês (não soma)',a.status===200);

  console.log('Holerites em PDF (conta Salários)');
  a=await api('POST','/api/dre/holerites',{competencia:mes,arquivos:[{nome:'holerites-outubro.pdf',base64:pdf.toString('base64')},{nome:'foto.pdf',base64:Buffer.from('não é pdf').toString('base64')}]});
  check('envia o PDF: dois holerites lidos; arquivo que não é PDF é recusado sem travar os outros',a.status===200&&a.j.arquivos[0].holerites===2&&/PDF/.test(a.j.arquivos[1].erro||''),a.j);
  check('  ...avisa que o PDF é de outro mês',a.j.arquivos[0].outroMes===true,a.j);
  a=await api('POST','/api/dre/holerites',{competencia:mes,arquivos:[{nome:'de-novo.pdf',base64:pdf.toString('base64')}]});
  check('o mesmo PDF de novo no mesmo mês não duplica',a.status===200&&/já foi enviado/.test(a.j.arquivos[0].erro||''),a.j);
  let m=await api('GET','/api/dre/mes?competencia='+mes);
  check('lista do mês: lançamentos (manual e SSW) e holerites',m.status===200&&m.j.lancamentos.length===3&&m.j.lancamentos.some(l=>l.origem==='ssw'&&l.valor===160000.25)&&m.j.holerites.length===2,m.j);
  const joao=m.j.holerites.find(h=>h.funcionario==='JOAO DA SILVA');
  check('hora extra separada no holerite (as duas vias contam uma vez; DSR fica fora)',joao&&joao.hora_extra===227.27&&joao.horas_extras===10,joao);
  let d=await api('GET','/api/dre?ano='+ano);
  const L=id=>d.j.linhas.find(l=>l.id===id),i=9;
  check('Salários do mês = soma dos vencimentos dos holerites; FGTS entra em Encargos',L('salarios').meses[i]===5950&&L('encargos').meses[i]===476&&d.j.holerites[mes]===2,[L('salarios').meses[i],L('encargos').meses[i]]);
  check('DRE do mês com receita do SSW e despesas lançadas',L('receita_fretes').meses[i]===160000.25&&L('aluguel').meses[i]===8500&&L('lucro_liquido').meses[i]===r2(160000.25-12000.5-5950-476-8500),L('lucro_liquido').meses[i]);
  a=await api('PATCH','/api/dre/holerites/'+joao.id,{vencimentos:'3.600,00'});check('corrige um valor lido do holerite',a.status===200);
  d=await api('GET','/api/dre?ano='+ano);check('  ...e o DRE acompanha',d.j.linhas.find(l=>l.id==='salarios').meses[i]===6050);
  r=await fetch(B+'/api/dre/holerites/'+joao.id+'/pdf',{headers:H});
  check('abre o PDF original do holerite',r.status===200&&(r.headers.get('content-type')||'').includes('pdf')&&Buffer.from(await r.arrayBuffer()).slice(0,5).toString()==='%PDF-');

  console.log('Separado por empresa');
  {
    const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL||'postgresql://teste:teste@127.0.0.1:5432/construlog_teste'});await c.connect();
    const cl=await c.query("INSERT INTO movit_clients(name,slug,plan,monthly_fee,due_day,status) VALUES('Outra Transportadora DRE','dre-outra-'||$1,'Personalizado',0,10,'active') RETURNING id",[sufixo]);
    // (empresa nova ainda fica em modo de avaliação, que bloqueia as APIs: o usuário de teste entra como
    // administrador MOVIT só para passar desse bloqueio; os dados continuam presos à empresa dele)
    await c.query('UPDATE dashboard_users SET client_id=$1,is_platform_admin=TRUE WHERE lower(username)=lower($2)',[cl.rows[0].id,'dre_sim_'+sufixo]);
    await c.end();
    const o=await api('GET','/api/dre?ano='+ano,undefined,com.H),om=await api('GET','/api/dre/mes?competencia='+mes,undefined,com.H);
    check('outra empresa não vê os valores, lançamentos nem holerites da CONSTRULOG',o.status===200&&o.j.linhas.every(l=>l.total===0)&&om.j.lancamentos.length===0&&om.j.holerites.length===0,{o:o.status,l:om.j.lancamentos?.length});
    check('  ...nem apaga, corrige ou abre o PDF deles',(await api('DELETE','/api/dre/lancamentos/'+idAluguel,undefined,com.H)).status===404&&(await api('PATCH','/api/dre/holerites/'+joao.id,{vencimentos:1},com.H)).status===404&&(await fetch(B+'/api/dre/holerites/'+joao.id+'/pdf',{headers:com.H})).status===404);
  }

  console.log('Apagar');
  check('apaga o lançamento',(await api('DELETE','/api/dre/lancamentos/'+idAluguel)).status===200);
  for(const h of m.j.holerites)await api('DELETE','/api/dre/holerites/'+h.id);
  m=await api('GET','/api/dre/mes?competencia='+mes);
  check('apaga os holerites (e o PDF sai junto)',m.j.holerites.length===0&&(await fetch(B+'/api/dre/holerites/'+joao.id+'/pdf',{headers:H})).status===404);
  for(const l of m.j.lancamentos)await api('DELETE','/api/dre/lancamentos/'+l.id);

  console.log('Dois por página, vale do dia 20 e total a depositar');
  {
    const rec=(nome,venc,desc,liq,titulo='Recibo de Pagamento de Salário   Referente ao Mês: Novembro/2031')=>[titulo,'Nome do Funcionário: '+nome,'Total de Vencimentos  Total de Descontos',venc+'   '+desc,'Valor Líquido '+liq,'F.G.T.S do Mês 100,00'];
    const ALEX=rec('ALEXANDRA LIMA','2.000,00','200,00','1.800,00'),THAIS=rec('THAIS COSTA','3.000,00','300,00','2.700,00');
    // página 1: as duas vias da Alexandra (a segunda sem a linha do FGTS); página 2: Thais
    const folha=await pdfHolerites([[ALEX,ALEX.slice(0,5)],[THAIS]]);
    const x=await lib.holeritesDoPdf(folha);
    check('vias repetidas da mesma funcionária viram um holerite só; cada um com a sua página',x.holerites.length===2&&x.holerites[0].funcionario==='ALEXANDRA LIMA'&&x.holerites[0].pagina===1&&x.holerites[0].fgts===100&&x.holerites[1].funcionario==='THAIS COSTA'&&x.holerites[1].pagina===2,x.holerites.map(h=>[h.funcionario,h.pagina,h.fgts]));
    const duas=await lib.holeritesDoPdf(await pdfHolerites([[ALEX,THAIS]]));
    check('dois funcionários diferentes na mesma página viram dois holerites',duas.holerites.length===2&&duas.holerites.map(h=>h.funcionario).join()==='ALEXANDRA LIMA,THAIS COSTA'&&duas.holerites[1].liquido===2700,duas.holerites.map(h=>[h.funcionario,h.liquido]));
    check('recibo de adiantamento é reconhecido como vale',lib.tipoHolerite('RECIBO DE ADIANTAMENTO SALARIAL\nNome do Funcionário: X')==='adiantamento'&&lib.tipoHolerite(ALEX.join('\n'))==='mensal');
    check('data padrão: vale dia 20; salário no 5º dia útil do mês seguinte',lib.dataPagamentoPadrao('2031-11','adiantamento')==='2031-11-20'&&lib.dataPagamentoPadrao('2026-10','mensal')==='2026-11-06');
    const mes2=ano+'-11';
    let up=await api('POST','/api/dre/holerites',{competencia:mes2,arquivos:[{nome:'folha.pdf',base64:folha.toString('base64')}]});
    check('envia a folha: 2 holerites (Alexandra não duplica)',up.status===200&&up.j.arquivos[0].holerites===2,up.j);
    const vale=await pdfHolerites([[rec('ALEXANDRA LIMA','800,00','0,00','800,00','RECIBO DE ADIANTAMENTO SALARIAL - Novembro/2031')],[rec('THAIS COSTA','1.200,00','0,00','1.200,00','RECIBO DE ADIANTAMENTO SALARIAL - Novembro/2031')]]);
    up=await api('POST','/api/dre/holerites',{competencia:mes2,arquivos:[{nome:'vale.pdf',base64:vale.toString('base64')}]});
    check('envia o vale do dia 20: 2 holerites de vale',up.status===200&&up.j.arquivos[0].holerites===2,up.j);
    const outra=await pdfHolerites([[THAIS],[ALEX]]);
    up=await api('POST','/api/dre/holerites',{competencia:mes2,arquivos:[{nome:'folha-de-novo.pdf',base64:outra.toString('base64')}]});
    check('outro PDF com a mesma folha não duplica os holerites',up.status===200&&up.j.arquivos[0].holerites===0&&up.j.arquivos[0].repetidos===2,up.j);
    let mm=await api('GET','/api/dre/mes?competencia='+mes2);
    const dep=mm.j.depositos||[];
    check('total a depositar por data: vale 2.000,00 no dia 20 e salário 4.500,00 no 5º dia útil',dep.length===2&&dep[0].tipo==='adiantamento'&&dep[0].data===mes2+'-20'&&dep[0].total===2000&&dep[1].tipo==='mensal'&&dep[1].total===4500&&dep[1].data===lib.dataPagamentoPadrao(mes2,'mensal'),dep);
    let dd=await api('GET','/api/dre?ano='+ano);
    check('DRE: Salários soma só a folha mensal (o vale já vem descontado nela)',dd.j.linhas.find(l=>l.id==='salarios').meses[10]===5000,dd.j.linhas.find(l=>l.id==='salarios').meses[10]);
    up=await api('PUT','/api/dre/holerites/data',{competencia:mes2,tipo:'mensal',data:'2031-12-05'});
    mm=await api('GET','/api/dre/mes?competencia='+mes2);
    check('muda a data do depósito do salário para o grupo todo',up.status===200&&up.j.alterados===2&&mm.j.depositos.find(g=>g.tipo==='mensal').data==='2031-12-05'&&mm.j.holerites.filter(h=>h.tipo==='mensal').every(h=>h.data_pagamento==='2031-12-05'),mm.j.depositos);
    const thais=mm.j.holerites.find(h=>h.funcionario==='THAIS COSTA'&&h.tipo==='mensal');
    r=await fetch(B+'/api/dre/holerites/'+thais.id+'/pdf',{headers:H});
    const pg=Buffer.from(await r.arrayBuffer());
    const txt=(await lib.paginasDoPdf(pg)).join('\n');
    check('PDF da Thais abre só a página dela (não o da Alexandra)',r.status===200&&(await lib.paginasDoPdf(pg)).length===1&&/THAIS COSTA/.test(txt)&&!/ALEXANDRA/.test(txt),txt.slice(0,200));
    const vA=mm.j.holerites.find(h=>h.funcionario==='ALEXANDRA LIMA'&&h.tipo==='adiantamento');
    up=await api('PATCH','/api/dre/holerites/'+vA.id,{tipo:'mensal'});
    mm=await api('GET','/api/dre/mes?competencia='+mes2);
    check('trocar o tipo de um holerite leva para a data do outro grupo',up.status===200&&mm.j.holerites.find(h=>h.id===vA.id).data_pagamento==='2031-12-05',mm.j.holerites.find(h=>h.id===vA.id));
    for(const h of mm.j.holerites)await api('DELETE','/api/dre/holerites/'+h.id);
  }

  console.log('\n'+pass+' ok, '+fail+' falha(s)');
  process.exit(fail?1:0)
})().catch(e=>{console.error(e);process.exit(1)});
function r2(n){return Math.round(n*100)/100}
