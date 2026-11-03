// Conferência de carga (conferencia.js): reconhecimento das etiquetas, janela da descarga e o fluxo completo
// contra o servidor em TEST_MODE (carga esperada informada no teste, sem SSW).
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const conf=require('../conferencia.js');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra).slice(0,400))}}

(async()=>{
  console.log('Etiquetas (códigos reais lidos no coletor)');
  const fs=conf.compilar(conf.FORMATOS_PADRAO.map(f=>({...f,ativo:true})));
  const c=v=>conf.classificar(fs,v);
  check('Transbarbosa: 14 dígitos 465701…',c('46570145384634').parceiro==='Transbarbosa'&&c('46570145384634').por_volume===true);
  check('Conasid: 12 dígitos 001000…',c('001000257623').parceiro==='Conasid'&&c(' 001000257627\r\n').codigo==='001000257627');
  check('Leal Dutra: pedido de 6 dígitos, só conta',c('941221').parceiro==='Leal Dutra'&&c('941221').por_volume===false);
  check('código desconhecido',c('ABC-123').tipo==='desconhecido');
  const dacte='35261012345678000199570010000123451000012345';
  check('DACTE (modelo 57) e DANFE (modelo 55)',c(dacte).tipo==='dacte'&&c('35261012345678000199550010000113251000012345').tipo==='danfe'&&c('35261012345678000199550010000113251000012345').nf==='11325');
  check('parceiro do CT-e pelos nomes do relatório',conf.parceiroDoCte(fs,['QUADRI COMERCIO','TRANSBARBOSA LOGISTICA LTDA'])==='Transbarbosa'&&conf.parceiroDoCte(fs,['CONASID IND E COM'])==='Conasid'&&conf.parceiroDoCte(fs,['OUTRA'])==='');
  const j=conf.janelaDescarga('2026-11-04');
  check('janela da descarga: 19:00 da véspera até 04:00 do dia (Brasília)',j.inicio.toISOString()==='2026-11-03T22:00:00.000Z'&&j.fim.toISOString()==='2026-11-04T07:00:00.000Z',{i:j.inicio,f:j.fim});

  console.log('Fluxo da descarga (servidor em modo teste)');
  let r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:ADMIN_USER,password:ADMIN_PASS})});
  const cookie=((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];
  check('login',!!cookie);
  const api=async(method,url,body)=>{const x=await fetch(B+url,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let j=null;try{j=await x.json()}catch{}return{status:x.status,j}};
  check('sem login -> 401',(await fetch(B+'/api/painel/conferencia/sessoes')).status===401);
  r=await api('GET','/api/painel/conferencia/formatos');
  check('formatos padrão criados',r.status===200&&r.j.formatos.length===3,r.j);
  const rows=[
    {ctrc:'AMS001045-6',nf:'113025',volumes:2,chave:dacte,destinatario:'LEIRSON',nomes:['QUADRI COMERCIO','TRANSBARBOSA LOGISTICA']},
    {ctrc:'AMS001046-4',nf:'7610',volumes:1,nomes:['MOVEIS CARRARO','TRANSBARBOSA LOGISTICA']},
    {ctrc:'AMS000900-8',nf:'1',volumes:2,nomes:['CONASID IND E COM']},
    {ctrc:'AMR017000-1',nf:'2',volumes:3,nomes:['LEAL DUTRA DISTRIBUIDORA']},
    {ctrc:'AMR017001-0',nf:'3',volumes:4,nomes:['OUTRO REMETENTE']},
  ];
  r=await api('POST','/api/painel/conferencia/sessoes',{tipo:'descarga',data:'2026-11-04',rows});
  const id=r.j&&r.j.id;
  check('cria a descarga com a carga esperada',r.status===201&&!!id&&r.j.totais.esperado===8&&r.j.outros.ctes===1&&r.j.outros.volumes===4,r.j);
  const tb=()=>r.j.parceiros.find(p=>p.parceiro==='Transbarbosa');
  check('  ...Transbarbosa espera 3 volumes em 2 CT-es',!!tb()&&tb().esperado===3&&tb().ctes===2,r.j.parceiros);
  const ler=async(codigo,uuid)=>api('POST','/api/painel/conferencia/sessoes/'+id+'/leituras',{codigo,uuid});
  r=await ler('46570145384634');check('volume Transbarbosa: ok 1 de 3',r.j.situacao==='ok'&&r.j.sinal==='ok'&&r.j.progresso.lidos===1,r.j);
  r=await ler('46570145384634');check('mesmo volume de novo: repetido, não conta',r.j.situacao==='duplicado'&&r.j.progresso.lidos===1,r.j);
  await ler('46570145384771');r=await ler('46570145384809');
  check('Transbarbosa completo (3 de 3)',r.j.situacao==='ok'&&r.j.sinal==='ok_completo'&&r.j.progresso.completo===true,r.j);
  r=await ler('46570145399999');check('volume a mais da Transbarbosa',r.j.situacao==='excesso'&&r.j.sinal==='erro',r.j);
  r=await ler('941221');await ler('941221');r=await ler('941221');
  check('Leal Dutra: mesmo código conta 3 de 3 (sem repetido)',r.j.situacao==='ok'&&r.j.progresso.lidos===3&&r.j.progresso.repetidos===0,r.j);
  r=await ler('941221');check('  ...a 4ª leitura passa do total',r.j.situacao==='excesso',r.j);
  r=await ler('XYZ999');check('etiqueta não reconhecida',r.j.situacao==='nao_reconhecido'&&r.j.sinal==='erro',r.j);
  r=await ler(dacte);check('DACTE da Construlog marca o CT-e',r.j.situacao==='dacte'&&r.j.ctrc==='AMS001045-6',r.j);
  r=await ler('001000257623','u-1');const r2=await ler('001000257623','u-1');
  check('reenvio da mesma leitura (fila sem sinal) não conta duas vezes',r.j.situacao==='ok'&&r2.j.repetida_envio===true&&r2.j.progresso.lidos===1,r2.j);
  r=await api('GET','/api/painel/conferencia/sessoes/'+id);
  const con=r.j.parceiros.find(p=>p.parceiro==='Conasid');
  check('resumo: Conasid falta 1, totais e leituras',r.status===200&&con.faltam===1&&r.j.totais.lidos===7&&r.j.nao_reconhecidos===1&&r.j.leituras.length>=10&&r.j.esperado.find(e=>e.ctrc==='AMS001045-6').dacte_lido_em,{con,t:r.j.totais});
  const ultima=r.j.leituras.find(l=>l.codigo==='001000257623');
  r=await api('DELETE','/api/painel/conferencia/sessoes/'+id+'/leituras/'+ultima.id);
  check('desfazer leitura volta a contagem',r.status===200&&r.j.parceiros.find(p=>p.parceiro==='Conasid').lidos===0,r.j);
  r=await api('POST','/api/painel/conferencia/sessoes/'+id+'/recarregar',{rows:rows.concat([{ctrc:'AMS000901-6',nf:'4',volumes:1,nomes:['CONASID']}])});
  check('atualizar CT-es do SSW mantém leituras e DACTE lido',r.status===200&&r.j.parceiros.find(p=>p.parceiro==='Conasid').esperado===3&&r.j.totais.lidos===6&&r.j.esperado.find(e=>e.ctrc==='AMS001045-6').dacte_lido_em,r.j.totais);
  r=await api('POST','/api/painel/conferencia/sessoes/'+id+'/fechar',{observacao:'falta 1 Conasid'});
  check('fechar conferência',r.status===200&&r.j.sessao.status==='fechada'&&r.j.sessao.observacao==='falta 1 Conasid',r.j.sessao);
  r=await ler('001000257627');check('conferência fechada não aceita leitura',r.status===409);
  r=await api('GET','/api/painel/conferencia/sessoes?tipo=descarga');
  check('lista de conferências',r.status===200&&r.j.rows.some(s=>s.id===id&&s.status==='fechada'&&s.esperado===13),r.j.rows);
  r=await api('PUT','/api/painel/conferencia/formatos',{formatos:[{nome:'X',padrao:'([',termos:'X'}]});
  check('padrão inválido é recusado',r.status===400,r.j);
  const html=await (await fetch(B+'/conferencia',{headers:{Cookie:cookie}})).text();
  check('tela /conferencia abre com login',html.includes('Conferência de carga')&&html.includes('/api/painel/conferencia/sessoes'));
  check('tela /conferencia sem login vai para o login',(await fetch(B+'/conferencia',{redirect:'manual'})).status===302);

  console.log('\n'+pass+' ok, '+fail+' falha(s)');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
