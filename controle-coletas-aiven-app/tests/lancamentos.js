// Lançamentos da operação: o card que substitui a aba de lançamentos da planilha.
// Roda contra o SSW de mentira (tests/apoio/ssw-falso.js), sem rede externa; nunca toca no SSW real.
// Pré-requisitos: os mesmos de tests/ssw-sessao.js (servidor sem TEST_MODE, com sem-rede.js e ssw-desvio.js),
// LANC_ESTAVEL_SEGUNDOS=3 no servidor e banco sem lançamentos (os romaneios do SSW de mentira entram sozinhos).
const B=process.env.BASE_URL||'http://127.0.0.1:10000',M='http://127.0.0.1:'+(process.env.MOCK_PORT||10555);
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const lib=require('../lancamentos.js');
const fs=require('fs'),path=require('path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name).replace(/[\r\n]+/g,' '))}}
const hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const br=iso=>iso.split('-').reverse().join('/');
// o romaneio só é lido por inteiro (PDF) onde existe o pdftotext, como no servidor de produção
const temPdf=!require('child_process').spawnSync('pdftotext',['-v']).error;

(async()=>{
  console.log('Contas e formatos (lancamentos.js)');
  check('número: "1.704,05", " 550,00 ", "1.200", 850 e texto',lib.numero('1.704,05')===1704.05&&lib.numero(' 550,00 ')===550&&lib.numero('1.200')===1200&&lib.numero(850)===850&&Number.isNaN(lib.numero('abc'))&&Number.isNaN(lib.numero('')));
  check('data: "09/10/2026", "9/10/26", ISO e data que não existe',lib.dataIso('09/10/2026')==='2026-10-09'&&lib.dataIso('9/10/26')==='2026-10-09'&&lib.dataIso('2026-10-09T03:00:00Z')==='2026-10-09'&&lib.dataIso('31/02/2026')===''&&lib.dataIso('ontem')==='');
  check('mesmo romaneio escrito de jeitos diferentes vira a mesma chave',lib.romaneioKey('AMR001061-8')==='10618'&&lib.romaneioKey('1061-8')==='10618'&&lib.romaneioKey(' 1061 - 8 ')==='10618'&&lib.romaneioKey('10618')==='10618'&&lib.romaneioKey('')==='');
  check('romaneio gravado como a operação escreve',lib.romaneioCurto('AMR001061-8')==='1061-8'&&lib.romaneioCurto('TBT000321-1')==='321-1');
  const d=lib.montarDados({data:'2026-10-09',motorista:'gilmar souza',veiculo_tipo:'van',filial:'amr',romaneio:'1060-0',operacao:'matcom/ecom',entregas:12,km:414,valor:1100,desconto:100,frete_vialog:4000});
  check('linha no formato da planilha: todas as colunas, valores em reais e valor por km',lib.COLUNAS.every(k=>k in d)&&d.Data==='09/10/2026'&&d.Motorista==='GILMAR SOUZA'&&d.Veiculo==='VAN'&&d['Operação']==='MATCOM/ECOM'&&d.Entregas==='12'&&d.KM==='414'&&d['Frete Comb']==='1.100,00'&&d['Desc.']==='100,00'&&d['Frete Mot Liq']==='1.000,00'&&d['Valor KM']==='2,42'&&d['Frete Vialog']==='4.000,00'&&d['Frete Vialog Liq']==='4.000,00',d);
  check('  ...Realizadas, Ajudante e VAlor ficam em branco',d.Realizadas===''&&d.Ajudante===''&&d.VAlor==='');
  const fr={'AMR15326':79.03,'AMR15327':120.5,'AMR15328':300.47};
  check('frete das entregas não feitas: soma só os CT-es que não foram entregues',lib.freteNaoEntregue(fr,new Set(['AMR15327']))===379.5&&lib.freteNaoEntregue(fr,['AMR15326','AMR15327','AMR15328'])===0&&lib.freteNaoEntregue(fr,new Set())===500&&lib.freteNaoEntregue({},new Set())===0);
  const dl=lib.montarDados({data:'2026-10-09',motorista:'x y',romaneio:'1-1',valor:1000,frete_vialog:4000,desconto_vialog:379.5});
  check('frete líquido = frete do romaneio menos o frete das entregas não feitas',dl['Frete Vialog']==='4.000,00'&&dl.Desc==='379,50'&&dl['Frete Vialog Liq']==='3.620,50',dl);

  let r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:ADMIN_USER,password:ADMIN_PASS})});
  const cookie=((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];
  check('login',!!cookie);
  const H={Cookie:cookie},HJ={...H,'Content-Type':'application/json'};
  const api=async(method,url,body,h=HJ)=>{const x=await fetch(B+url,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});return{status:x.status,j:await x.json().catch(()=>({}))}};
  const lista=async(q='')=>(await api('GET','/api/lancamentos'+q)).j;

  const mock=async q=>(await fetch(M+'/__mock/romaneio?'+q)).json();
  const espera=async(cond,limite=60000,passo=1500)=>{const t=Date.now();for(;;){const rs=(await lista()).rows||[];if(cond(rs)||Date.now()-t>limite)return rs;await sleep(passo)}};
  await api('POST','/api/lancamentos/fonte',{fonte:'planilha'});

  console.log('Acesso');
  r=await fetch(B+'/api/lancamentos');check('sem login -> 401',r.status===401,'veio '+r.status);
  r=await fetch(B+'/api/painel/lancamentos/planilha');check('linhas para os painéis: sem login -> 401',r.status===401,'veio '+r.status);
  let a=await api('GET','/api/lancamentos/config');
  check('começa com os painéis lendo a planilha e as três operações',a.status===200&&a.j.fonte==='planilha'&&a.j.is_admin===true&&a.j.operacoes.join()==='MATCOM,ECOM,MATCOM/ECOM',a);
  a=await api('POST','/api/lancamentos/fonte',{fonte:'sistema'});
  check('não deixa passar os painéis para o sistema antes de trazer o histórico',a.status===400&&/histórico/.test(a.j.error),a);

  console.log('Romaneios feitos hoje no SSW entram sozinhos na lista');
  let autos=await espera(rs=>rs.length>=3,40000);
  check('os três romaneios de hoje aparecem sem ninguém lançar, em ordem de romaneio',autos.map(x=>x.romaneio).join()==='321-1,1056-1,1057-1',autos.map(x=>x.romaneio));
  check('  ...com motorista, placa, filial e entregas do SSW, na data de hoje',autos.map(x=>[x.motorista,x.placa,x.filial,x.entregas,x.data].join('|')).join(';')===['ROGER TESTE|TBT9Z99|TBT|6|'+hoje,'JAILSON MOREIRA DE SOUZA|EYV3626|AMR|12|'+hoje,'FABIANO TESTE|FAB1A23|AMR|5|'+hoje].join(';'),autos);
  check('  ...sem valor e sem operação (ficam para o usuário), marcados como vindos do SSW',autos.every(x=>x.auto===true&&x.valor===null&&x.operacao===''&&x.criado_por==='SSW (automático)'&&x.romaneio_ssw),autos);
  a=await api('POST','/api/painel/lancamentos',{auto:true,data:hoje,motorista:'Intruso',romaneio:'4444-4'});
  check('só o próprio sistema cria linha sem valor (o administrador, pela tela, não)',a.status===400&&/valor/.test(a.j.error),a);
  autos=await espera(rs=>rs.length>=3&&rs.every(x=>x.calculo?.status!=='pendente'),150000,2500);
  const a57=autos.find(x=>x.romaneio==='1057-1')||{},a56=autos.find(x=>x.romaneio==='1056-1')||{},a321=autos.find(x=>x.romaneio==='321-1')||{};
  if(temPdf){
    check('depois que o romaneio para de mudar, o sistema busca km, frete e cidades',a57.calculo?.status==='ok'&&a57.km>100&&a57.frete_vialog===395.15&&a57.valor===null,a57);
    check('  ...com as entregas de cada cidade (para o quadro de cidades)',Array.isArray(a57.cidades)&&a57.cidades.length===5&&a57.cidades.every(c=>c.n===1)&&a57.cidades[4].c==='RIO DE JANEIRO'&&a57.rota.split(',').length===5,a57.cidades)
  }else check('sem ler o romaneio: fica "não completou"',a57.calculo?.status==='erro',a57.calculo);
  a=await api('PATCH','/api/lancamentos/'+a57.id,{valor:'850,00'});
  check('o usuário informa só o valor, na linha',a.status===200&&a.j.row.valor===850&&a.j.row.frete_mot_liq===850&&a.j.row.km===a57.km&&a.j.row.motorista==='FABIANO TESTE',a);
  a=await api('PATCH','/api/lancamentos/'+a57.id,{operacao:'MATCOM'});const b57=await api('PATCH','/api/lancamentos/'+a57.id,{veiculo_tipo:'van com tubo'});
  check('  ...e escolhe a operação e o carro (Van com tubo)',a.j.row?.operacao==='MATCOM'&&b57.j.row?.veiculo_tipo==='VAN COM TUBO'&&b57.j.row.valor===850,b57);
  a=await api('POST','/api/lancamentos',{data:hoje,motorista:'Jailson Souza',romaneio:'1056',valor:1200,operacao:'ECOM',veiculo_tipo:'VAN'});
  check('lançar pelo formulário um romaneio que já está na lista sem valor: completa a mesma linha',a.status===200&&a.j.atualizado===true&&a.j.row.id===a56.id&&a.j.row.valor===1200&&a.j.row.motorista==='JAILSON SOUZA'&&a.j.row.operacao==='ECOM'&&a.j.row.veiculo_tipo==='VAN'&&a.j.row.entregas===12,a);
  a=await api('POST','/api/lancamentos',{data:hoje,motorista:'Jailson Souza',romaneio:'1056',valor:1300,operacao:'ECOM',veiculo_tipo:'VAN'});
  check('  ...mas depois que tem valor, lançar de novo é recusado',a.status===409,a);
  a=await api('DELETE','/api/lancamentos/'+a321.id);
  await sleep(4500);await lista();await sleep(4500);
  autos=(await lista()).rows||[];
  check('linha excluída pelo usuário não volta sozinha',a.status===200&&autos.length===2&&!autos.some(x=>x.romaneio==='321-1'),autos.map(x=>x.romaneio));
  // daqui em diante o teste lança tudo pelo formulário: tira o que entrou sozinho
  for(const x of autos)await api('DELETE','/api/lancamentos/'+x.id);
  check('lista vazia depois de excluir tudo (e continua vazia)',((await lista()).rows||[]).length===0);

  console.log('Romaneio no SSW');
  a=await api('GET','/api/lancamentos/romaneio?numero=1057-1');
  check('"1057-1" acha o romaneio de hoje, com motorista, placa e entregas',a.status===200&&a.j.encontrado&&a.j.romaneio_ssw==='AMR001057-1'&&a.j.romaneio==='1057-1'&&a.j.motorista_ssw==='FABIANO TESTE'&&a.j.placa==='FAB1A23'&&a.j.entregas===5&&a.j.filial==='AMR',a);
  a=await api('GET','/api/lancamentos/romaneio?numero=1057');check('sem o dígito ("1057") também acha',a.j.encontrado&&a.j.romaneio_ssw==='AMR001057-1',a);
  a=await api('GET','/api/lancamentos/romaneio?numero=amr001057-1');check('escrito por inteiro ("AMR001057-1") também',a.j.encontrado&&a.j.romaneio==='1057-1',a);
  a=await api('GET','/api/lancamentos/romaneio?numero=321-1');check('romaneio de outra filial (TBT)',a.j.encontrado&&a.j.romaneio_ssw==='TBT000321-1'&&a.j.filial==='TBT'&&a.j.motorista_ssw==='ROGER TESTE',a);
  a=await api('GET','/api/lancamentos/romaneio?numero=9999-1');check('romaneio que não existe: avisa, sem erro',a.status===200&&a.j.encontrado===false,a);
  a=await api('GET','/api/lancamentos/romaneio?numero=');check('sem número: 400',a.status===400,a);

  console.log('Lançar');
  const novo={data:hoje,motorista:'Fabiano Teste',romaneio:'1057',valor:'850,00',operacao:'MATCOM',veiculo_tipo:'fiorino',conferente:'ze',erros:''};
  a=await api('POST','/api/lancamentos',{...novo,motorista:''});check('sem motorista: 400',a.status===400&&/motorista/.test(a.j.error),a);
  a=await api('POST','/api/lancamentos',{...novo,valor:''});check('sem valor: 400',a.status===400&&/valor/.test(a.j.error),a);
  a=await api('POST','/api/lancamentos',{...novo,valor:'abc'});check('valor que não é número: 400',a.status===400,a);
  a=await api('POST','/api/lancamentos',{...novo,romaneio:'9999-1'});
  check('romaneio que não está no SSW: 404 pedindo para conferir',a.status===404&&a.j.naoEncontrado===true&&/9999-1 não encontrado no SSW em /.test(a.j.error),a);
  a=await api('POST','/api/lancamentos',novo);
  const l1=a.j.row||{};
  check('lança: grava o que o usuário informou e o que o romaneio já diz',a.status===201&&l1.romaneio==='1057-1'&&l1.romaneio_ssw==='AMR001057-1'&&l1.motorista==='FABIANO TESTE'&&l1.valor===850&&l1.frete_mot_liq===850&&l1.operacao==='MATCOM'&&l1.veiculo_tipo==='FIORINO'&&l1.placa==='FAB1A23'&&l1.filial==='AMR'&&l1.entregas===5&&l1.conferente==='ZE'&&l1.data===hoje&&l1.criado_por===ADMIN_USER,a);
  check('  ...e fica "buscando no SSW"',l1.calculo?.status==='pendente'&&l1.km===null&&l1.realizadas===null,l1);
  a=await api('POST','/api/lancamentos',{...novo,romaneio:'AMR001057-1',valor:900});
  check('mesmo romaneio de novo: 409, dizendo quem já lançou',a.status===409&&/romaneio 1057-1 já foi lançado em .* para FABIANO TESTE/.test(a.j.error),a);
  a=await api('POST','/api/lancamentos',{data:hoje,motorista:'Jailson Souza',romaneio:'1056-1',valor:1200,operacao:'ECOM',veiculo_tipo:'VAN'});
  const l2=a.j.row||{};
  check('segundo lançamento (outro romaneio)',a.status===201&&l2.romaneio==='1056-1'&&l2.entregas===12&&l2.motorista==='JAILSON SOUZA',a);
  a=await api('POST','/api/lancamentos',{data:hoje,motorista:'Motorista Avulso',romaneio:'999-9',valor:'1.200',operacao:'MATCOM/ECOM',veiculo_tipo:'TRUCK',forcar:true});
  const l3=a.j.row||{};
  check('"lançar mesmo assim": grava sem SSW ("1.200" = mil e duzentos)',a.status===201&&l3.romaneio==='999-9'&&l3.romaneio_ssw===''&&l3.valor===1200&&l3.entregas===null,a);

  console.log('O sistema completa com o SSW');
  let t0=Date.now(),rows=[];
  for(;;){
    const j=await lista();rows=j.rows||[];
    if(!rows.some(x=>x.calculo?.status==='pendente'&&x.romaneio_ssw)&&!(j.naFila||[]).length)break;
    if(Date.now()-t0>150000)break;
    await sleep(3000)
  }
  console.log('  (completou em '+Math.round((Date.now()-t0)/1000)+' s; pdftotext '+(temPdf?'presente':'AUSENTE: leitura do romaneio não é testada aqui')+')');
  check('lista do dia em ordem de romaneio',rows.map(x=>x.romaneio).join()==='999-9,1056-1,1057-1',rows.map(x=>x.romaneio));
  const c1=rows.find(x=>x.id===l1.id)||{};
  if(temPdf){
    check('km da rota (saindo e voltando para a base)',c1.km>100&&c1.km<600,c1.km);
    check('frete do romaneio: soma do "Valor frete" dos 5 CT-es lidos no SSW',c1.frete_vialog===395.15&&c1.calculo?.ctes===5&&c1.calculo?.lidos===5,c1);
    check('  ...dia aberto: frete líquido ainda igual ao do romaneio (nada descontado)',c1.frete_vialog_liq===395.15&&!c1.desconto_vialog,c1);
    const comFretes=((await api('GET','/api/painel/lancamentos?fretes=1&de='+hoje+'&ate='+hoje)).j.rows||[]).find(x=>x.id===l1.id)||{};
    check('  ...e o frete de cada CT-e fica guardado para descontar as entregas não feitas',Object.keys(comFretes.fretes||{}).length===5&&Object.values(comFretes.fretes).every(v=>v===79.03),comFretes.fretes);
    check('cidades na ordem da rota, sem repetir (a que ficou sem localização vai no fim)',c1.rota.split(',').slice(0,4).sort().join()==='MOGI GUACU,MOGI MIRIM,PEDREIRA,SAO JOAO DA BOA VISTA'&&c1.rota.split(',')[4]==='RIO DE JANEIRO',c1.rota);
    check('entregas do romaneio e baixas até agora (dia aberto: Realizadas ainda em branco)',c1.entregas===5&&c1.ao_vivo===0&&c1.realizadas===null,c1);
    check('avisa a entrega sem localização e as aproximadas',c1.calculo?.status==='ok'&&/1 entrega\(s\) sem localização/.test(c1.calculo.msg)&&/aproximado/.test(c1.calculo.msg),c1.calculo)
  }else{
    check('sem ler o romaneio: fica marcado como "não completou", com o motivo',c1.calculo?.status==='erro'&&!!c1.calculo.msg,c1.calculo)
  }
  const c2=rows.find(x=>x.id===l2.id)||{};
  check('romaneio que o SSW não detalha: "não completou", mas o lançamento continua valendo',c2.calculo?.status==='erro'&&!!c2.calculo.msg&&c2.calculo.tentativas>=1&&c2.valor===1200&&c2.entregas===12,c2);
  check('lançado sem SSW continua esperando',(rows.find(x=>x.id===l3.id)||{}).calculo?.status==='pendente');

  console.log('Alterar');
  a=await api('PATCH','/api/lancamentos/'+l1.id,{valor:'900,50',operacao:'ECOM',erros:'2',calculo:{km:1,frete_vialog:1,status:'ok'}});
  const e1=a.j.row||{};
  check('muda valor, operação e erros',a.status===200&&e1.valor===900.5&&e1.frete_mot_liq===900.5&&e1.operacao==='ECOM'&&e1.erros===2,a);
  check('  ...sem perder o que veio do SSW, e sem aceitar km/frete mandados pela tela',e1.km===c1.km&&e1.frete_vialog===c1.frete_vialog&&e1.rota===c1.rota&&e1.romaneio==='1057-1',e1);
  a=await api('PATCH','/api/lancamentos/'+l1.id,{valor:-5});check('valor negativo: 400',a.status===400,a);
  a=await api('PATCH','/api/lancamentos/'+l3.id,{romaneio:'1056-1'});check('trocar para um romaneio que já tem lançamento: 409',a.status===409,a);
  a=await api('PATCH','/api/lancamentos/'+l3.id,{romaneio:'8888-8',data:hoje});check('trocar para um romaneio que não está no SSW: 404 pedindo para conferir',a.status===404&&a.j.naoEncontrado===true,a);
  a=await api('PATCH','/api/lancamentos/'+l3.id,{romaneio:'321-1',data:hoje});
  check('trocar o romaneio: pega os dados do novo e busca de novo',a.status===200&&a.j.row.romaneio==='321-1'&&a.j.row.romaneio_ssw==='TBT000321-1'&&a.j.row.entregas===6&&a.j.row.filial==='TBT'&&a.j.row.placa==='TBT9Z99'&&a.j.row.calculo.status==='pendente',a);
  a=await api('PATCH','/api/lancamentos/999999',{valor:10});check('lançamento que não existe: 404',a.status===404,a);

  console.log('Baixas: a coluna Realizadas só é gravada com o dia fechado');
  // o próprio sistema grava assim (dashboard -> servidor principal); aqui o administrador faz o mesmo caminho
  const antes=c2.calculo?.tentativas||0;
  a=await api('PATCH','/api/painel/lancamentos/'+l2.id,{calculo:{status:'erro',msg:'SSW fora do ar'}});
  check('cada tentativa sem sucesso é contada (o sistema para de insistir sozinho na terceira)',a.j.row?.calculo?.tentativas===antes+1&&a.j.row.calculo.msg==='SSW fora do ar'&&a.j.row.valor===1200,a);
  a=await api('PATCH','/api/painel/lancamentos/'+l2.id,{calculo:{status:'ok',entregas:12,realizadas:7,km:210,frete_vialog:'3.500,40',rota:'LIMEIRA,PIRACICABA',placa:'eyv3626'}});
  let p2=a.j.row||{};
  check('dia aberto com entregas faltando: mostra "7 até agora" e deixa Realizadas em branco',a.status===200&&p2.calculo.tentativas===0&&p2.ao_vivo===7&&p2.realizadas===null&&p2.km===210&&p2.frete_vialog===3500.4&&p2.rota==='LIMEIRA,PIRACICABA'&&p2.placa==='EYV3626'&&p2.valor===1200,a);
  a=await api('PATCH','/api/painel/lancamentos/'+l2.id,{calculo:{status:'ok',realizadas:12}});p2=a.j.row||{};
  check('todas entregues: Realizadas gravada',p2.realizadas===12&&p2.ao_vivo===12&&p2.km===210,p2);
  const ontem=new Date(Date.now()-864e5).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  a=await api('PATCH','/api/lancamentos/'+l2.id,{data:ontem});
  a=await api('PATCH','/api/painel/lancamentos/'+l2.id,{calculo:{status:'ok',realizadas:10,pend:2,desconto_vialog:500.4,fretes:{'amr15326':79.03,'AMR15327':'421,37',ruim:'abc'}}});p2=a.j.row||{};
  check('dia já fechado: grava as realizadas e as pendentes mesmo incompleto',p2.data===ontem&&p2.realizadas===10&&p2.pend===2,p2);
  check('  ...e o frete líquido desconta o frete das entregas não feitas',p2.frete_vialog===3500.4&&p2.desconto_vialog===500.4&&p2.frete_vialog_liq===3000,p2);
  a=await api('GET','/api/painel/lancamentos?fretes=1&de='+ontem+'&ate='+ontem);
  check('  ...frete por CT-e guardado só com valores válidos',JSON.stringify((a.j.rows||[])[0]?.fretes)===JSON.stringify({AMR15326:79.03,AMR15327:421.37}),a.j.rows);
  a=await api('GET','/api/lancamentos?de='+ontem+'&ate='+ontem);check('  ...a tela não recebe a lista de fretes por CT-e',a.j.rows.length===1&&!('fretes' in a.j.rows[0]),a.j.rows);
  a=await api('PATCH','/api/lancamentos/'+l2.id,{valor:1300});
  check('  ...e alterar o valor do motorista não mexe no frete nem no desconto',a.j.row.valor===1300&&a.j.row.frete_vialog_liq===3000&&a.j.row.desconto_vialog===500.4,a);
  a=await api('PATCH','/api/painel/lancamentos/'+l2.id,{calculo:{status:'ok',realizadas:12,pend:0,desconto_vialog:0}});
  check('todas feitas depois: o desconto some e o líquido volta ao frete do romaneio',a.j.row.frete_vialog_liq===3500.4&&!a.j.row.desconto_vialog&&a.j.row.realizadas===12,a);
  a=await api('PATCH','/api/painel/lancamentos/'+l2.id,{calculo:{status:'ok',realizadas:10,pend:2,desconto_vialog:500.4}});a=await api('PATCH','/api/lancamentos/'+l2.id,{valor:1200});p2=a.j.row||{};
  rows=(await lista('?de='+ontem+'&ate='+hoje)).rows||[];
  check('período de dois dias: primeiro a data, depois o romaneio',rows.map(x=>x.data+' '+x.romaneio).join()===[ontem+' 1056-1',hoje+' 321-1',hoje+' 1057-1'].join(),rows.map(x=>x.data+' '+x.romaneio));

  console.log('Lista de motoristas');
  a=await api('GET','/api/lancamentos/motoristas');
  const fab=(a.j.rows||[]).find(x=>x.motorista==='FABIANO TESTE')||{};
  check('quem teve lançamento nos últimos 30 dias, com o carro e a operação do último',a.status===200&&fab.veiculo_tipo==='FIORINO'&&fab.operacao==='ECOM'&&fab.ultimo===hoje&&(a.j.rows||[]).some(x=>x.motorista==='JAILSON SOUZA'),a);
  check('motoristas com romaneio hoje no SSW que ainda não estão na lista (sem repetir quem já está com o nome curto)',a.j.novosNoSsw.includes('ROGER TESTE')&&!a.j.novosNoSsw.includes('FABIANO TESTE')&&!a.j.novosNoSsw.includes('JAILSON MOREIRA DE SOUZA'),a.j.novosNoSsw);
  check('tipos de carro já usados entram na lista',a.j.tipos.includes('FIORINO')&&a.j.tipos.includes('VAN'),a.j.tipos);
  a=await api('GET','/api/lancamentos/romaneio?numero=1056-1');
  check('ao digitar o romaneio, sugere o motorista como a operação escreve e o carro dele; a operação fica para o usuário escolher',a.j.motorista==='JAILSON SOUZA'&&a.j.veiculo_tipo==='VAN'&&!('operacao' in a.j),a);

  console.log('Permissão própria: liberada usuário a usuário');
  const sufixo=Date.now().toString(36);
  const cria=async(nome,permissions)=>{
    const x=await api('POST','/api/painel/auth/users',{username:nome,password:'senha-teste-1',permissions});
    const l=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:nome,password:'senha-teste-1'})});
    return{criou:x.status,H:{Cookie:((l.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0],'Content-Type':'application/json'}}
  };
  const com=await cria('lanc_sim_'+sufixo,['lancamentos']),sem=await cria('lanc_nao_'+sufixo,['dashboard','operacional','financeiro','roteirizador','montar_carga','programacao']);
  check('usuários de teste criados',com.criou<300&&sem.criou<300&&!!com.H.Cookie&&!!sem.H.Cookie,{com:com.criou,sem:sem.criou});
  a=await api('GET','/api/lancamentos',undefined,com.H);check('com a permissão: vê a lista',a.status===200&&a.j.rows.length===2,a);
  a=await api('GET','/api/lancamentos/config',undefined,com.H);check('  ...sem ser administrador',a.j.is_admin===false,a);
  a=await api('PATCH','/api/lancamentos/'+l1.id,{conferente:'maria'},com.H);check('  ...e altera',a.status===200&&a.j.row.conferente==='MARIA',a);
  for(const[nome,m,u,b]of[['lista','GET','/api/lancamentos'],['motoristas','GET','/api/lancamentos/motoristas'],['romaneio','GET','/api/lancamentos/romaneio?numero=1057'],['lançar','POST','/api/lancamentos',novo],['alterar','PATCH','/api/lancamentos/'+l1.id,{valor:1}],['excluir','DELETE','/api/lancamentos/'+l1.id],['direto no servidor principal','PATCH','/api/painel/lancamentos/'+l1.id,{valor:1}]]){
    a=await api(m,u,b,sem.H);check('sem a permissão ('+nome+'): 403',a.status===403,a)
  }
  a=await api('POST','/api/lancamentos/importar-planilha',{},com.H);check('trazer o histórico: só administrador',a.status===403,a);
  a=await api('POST','/api/painel/lancamentos/importar',{rows:[{Data:'01/10/2026',Motorista:'X'}]},com.H);check('  ...também direto no servidor principal',a.status===403,a);
  a=await api('POST','/api/lancamentos/fonte',{fonte:'sistema'},com.H);check('trocar a fonte dos painéis: só administrador',a.status===403,a);
  a=await api('GET','/api/painel/lancamentos/planilha',undefined,com.H);check('linhas para os painéis: só o sistema e o administrador',a.status===403,a);
  const telaApp=fs.readFileSync(path.join(__dirname,'..','dashboard','public','app.js'),'utf8'),portal=fs.readFileSync(path.join(__dirname,'..','painel.html'),'utf8');
  check('a permissão aparece na lista de acessos dos usuários',/\['lancamentos','Lançamentos/.test(telaApp));
  check('o card está na barra de Operação do portal, só para quem tem a permissão',/data-module="lancamentos" data-src="\/dashboard\/\?embed=1&view=lancamentos"/.test(portal)&&/mod==='lancamentos'\)return licensed\('operacao'\)&&\(hasPerm\('lancamentos'\)\|\|AUTH\.is_admin\)/.test(portal));
  check('ter só essa permissão não abre a Central de Dashboards',/'montar_carga','lancamentos'\]\.includes\(p\)/.test(portal)&&/p!=='montar_carga'&&p!=='lancamentos'/.test(telaApp));

  console.log('Histórico da planilha e fonte dos painéis');
  // o que o dashboard manda depois de ler a planilha: linhas com os títulos das colunas
  const planilha=[
    {Data:'01/10/2026',Motorista:'GILMAR SOUZA',Veiculo:'VAN',Filial:'AMR',Romaneio:'1001-1','Operação':'MATCOM',Entregas:'12',Realizadas:'12',KM:'414','Frete Comb':'1.100,00','Frete Mot Liq':'1.100,00','Frete Vialog':'4.000,00','Frete Vialog Liq':'4.000,00',Rota:'LIMEIRA'},
    {Data:'02/10/2026',Motorista:'AROLDO ALMEIDA',Veiculo:'FIORINO',Filial:'AMR',Romaneio:'1002-2','Operação':'ECOM',Entregas:'30',Realizadas:'29','Frete Comb':'550,00','Frete Mot Liq':'550,00'},
    {Data:br(hoje),Motorista:'FABIANO TESTE',Veiculo:'FIORINO',Filial:'AMR',Romaneio:'1057-1','Operação':'MATCOM',Entregas:'5','Frete Comb':'1,00'},   // já lançado no sistema: vale o do sistema
    {Data:'',Motorista:'',Romaneio:'','Frete Mot Liq':'0,00'},                                                                                            // linha-modelo, só com fórmula
    {Data:'03/10/2026',Motorista:'',Romaneio:'1003-3'}                                                                                                     // sem motorista
  ];
  a=await api('POST','/api/painel/lancamentos/importar',{rows:[]});check('planilha vazia: não altera nada',a.status===400,a);
  a=await api('POST','/api/painel/lancamentos/importar',{rows:planilha,por:ADMIN_USER});
  check('traz o histórico: grava as linhas de verdade, pula as vazias e a que já está no sistema',a.status===200&&a.j.gravadas===2&&a.j.repetidas_no_sistema===1&&a.j.ignoradas===2&&a.j.fonte==='sistema',a);
  a=await api('POST','/api/lancamentos/fonte',{fonte:'sistema'});check('painéis passam a ler do sistema',a.status===200&&a.j.fonte==='sistema',a);
  a=await api('GET','/api/lancamentos/config');
  check('o quadro do administrador mostra a fonte e as contagens',a.j.fonte==='sistema'&&a.j.planilha.linhas===2&&a.j.sistema.linhas===3&&!!a.j.importado_em,a);
  a=await api('GET','/api/sheet/lancamentos');
  const linhas=a.j.rows||[],gil=linhas.find(x=>x.Motorista==='GILMAR SOUZA')||{},fabs=linhas.filter(x=>x.Motorista==='FABIANO TESTE');
  check('os painéis recebem do sistema: histórico + lançamentos novos, no formato da planilha',a.status===200&&a.j.fonte==='sistema'&&linhas.length===5&&gil.Data==='01/10/2026'&&gil['Frete Comb']==='1.100,00'&&gil.KM==='414',{status:a.status,n:linhas.length,gil});
  check('  ...o romaneio lançado no sistema aparece uma vez só, com o valor do sistema',fabs.length===1&&fabs[0]['Frete Comb']==='900,50'&&fabs[0].Romaneio==='1057-1'&&fabs[0].Conferente==='MARIA',fabs);
  const jai=linhas.find(x=>x.Motorista==='JAILSON SOUZA')||{};
  check('  ...com o frete do romaneio, o desconto das entregas não feitas e o frete líquido',jai['Frete Vialog']==='3.500,40'&&jai.Desc==='500,40'&&jai['Frete Vialog Liq']==='3.000,00'&&jai.Realizadas==='10'&&jai.Pend==='2',jai);
  check('  ...em ordem de data',linhas.map(x=>lib.dataIso(x.Data)).join()===[...linhas.map(x=>lib.dataIso(x.Data))].sort().join(),linhas.map(x=>x.Data));
  check('  ...dia aberto sem todas as baixas segue com Realizadas em branco (os painéis tratam como "sem fechamento")',temPdf?fabs[0].Realizadas==='':true,fabs[0]);
  a=await api('POST','/api/painel/lancamentos/importar',{rows:planilha.slice(0,1),por:ADMIN_USER});
  check('trazer de novo substitui o histórico (não duplica) e não mexe nos lançamentos do sistema',a.j.gravadas===1&&(await api('GET','/api/lancamentos/config')).j.sistema.linhas===3,a);
  a=await api('GET','/api/lancamentos?de=2026-10-01&ate=2026-10-02');check('o card lista só o que foi lançado no sistema',a.j.rows.length===0,a.j.rows);
  a=await api('GET','/api/lancamentos?de=2026-10-01&ate=2026-10-02&origem=todas');const hist=(a.j.rows||[])[0]||{};
  check('linha do histórico é lida como as outras',a.j.rows.length===1&&hist.origem==='planilha'&&hist.valor===1100&&hist.km===414&&hist.frete_vialog===4000,a.j.rows);
  a=await api('PATCH','/api/lancamentos/'+hist.id,{valor:1});check('linha do histórico não é alterada pelo card',a.status===400,a);
  a=await api('DELETE','/api/lancamentos/'+hist.id);check('  ...nem excluída',a.status===404,a);
  a=await api('POST','/api/lancamentos/fonte',{fonte:'planilha'});check('dá para voltar os painéis para a planilha',a.status===200&&a.j.fonte==='planilha',a);
  a=await api('GET','/api/sheet/lancamentos');check('  ...e aí os painéis não leem mais do sistema',a.j.fonte!=='sistema',{status:a.status,fonte:a.j.fonte});
  check('  ...sem apagar nada',(await api('GET','/api/lancamentos/config')).j.sistema.linhas===3);

  console.log('Excluir');
  a=await api('DELETE','/api/lancamentos/'+l3.id);check('exclui o lançamento',a.status===200,a);
  a=await api('DELETE','/api/lancamentos/'+l3.id);check('  ...que some',a.status===404,a);
  a=await api('POST','/api/lancamentos',{data:hoje,motorista:'Roger Teste',romaneio:'321-1',valor:700,operacao:'MATCOM',veiculo_tipo:'VAN'});
  check('  ...e o romaneio fica livre para lançar de novo pelo formulário',a.status===201,a);

  console.log('O romaneio muda ao longo do dia');
  await mock('rom=AMR001057-1&qtde=6');
  let r57=(await espera(rs=>rs.some(x=>x.romaneio==='1057-1'&&x.entregas===6),90000,2500)).find(x=>x.romaneio==='1057-1')||{};
  check('romaneio ganhou uma entrega no SSW: o lançamento acompanha, sem perder valor e conferente',r57.entregas===6&&r57.valor===900.5&&r57.conferente==='MARIA'&&r57.calculo?.status!=='pendente',r57);
  check('  ...ainda aberto: nada descontado do frete',!r57.calculo?.fechado&&!r57.desconto_vialog&&r57.realizadas===null,r57);
  await mock('rom=AMR001057-1&falta=0');
  r57=(await espera(rs=>rs.some(x=>x.romaneio==='1057-1'&&x.calculo?.fechado),90000,2500)).find(x=>x.romaneio==='1057-1')||{};
  check('todas as entregas com baixa no SSW: o romaneio fecha (realizadas e pendentes gravadas)',r57.calculo?.fechado===true&&r57.realizadas!==null&&r57.pend===r57.entregas-r57.realizadas,r57);
  if(temPdf)check('  ...e, sem nenhuma entrega feita à vista, não inventa desconto: avisa para conferir',r57.realizadas===0&&!r57.desconto_vialog&&/frete líquido não calculado/.test(r57.calculo.msg),r57.calculo);
  await mock('rom=AMR001057-1&qtde=5&falta=5');

  console.log('\n'+pass+' passaram, '+fail+' falharam');
  process.exit(fail?1:0)
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(1)});
