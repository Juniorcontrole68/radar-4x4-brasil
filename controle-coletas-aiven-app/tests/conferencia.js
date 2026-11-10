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
  check('lista de conferências',r.status===200&&r.j.rows.some(s=>s.id===id&&s.status==='fechada'&&s.esperado===13)&&r.j.rows.every(s=>s.tipo==='descarga'),r.j.rows);
  console.log('Carregamento');
  r=await api('POST','/api/painel/conferencia/sessoes',{tipo:'carregamento',modo:'romaneio',romaneio:'AMR001186-0',placa:'ABC1D23',rows:[rows[0],rows[2]]});
  const cr=r.j&&r.j.id;
  check('carregamento pelo romaneio: CT-es do romaneio',r.status===201&&r.j.sessao.tipo==='carregamento'&&r.j.sessao.referencia==='AMR001186-0'&&r.j.totais.esperado===4&&/AMR001186-0/.test(r.j.sessao.titulo),r.j.sessao);
  const lc=async(codigo,extra={})=>api('POST','/api/painel/conferencia/sessoes/'+cr+'/leituras',{codigo,...extra});
  r=await lc('46570145384634');check('volume do romaneio: ok',r.j.situacao==='ok',r.j);
  r=await lc('941221');check('volume de parceiro fora do romaneio: NÃO CARREGAR',r.j.situacao==='sobra'&&r.j.sinal==='erro'&&/NÃO CARREGAR/.test(r.j.mensagem),r.j);
  r=await api('POST','/api/painel/conferencia/sessoes/'+cr+'/fechar',{});
  check('fecha o carregamento',r.status===200&&r.j.sessao.status==='fechada');
  r=await api('POST','/api/painel/conferencia/sessoes',{tipo:'carregamento',modo:'romaneio',romaneio:'xx'});
  check('romaneio inválido é recusado',r.status===400,r.j);
  r=await api('POST','/api/painel/conferencia/sessoes',{tipo:'carregamento',modo:'ctes',placa:'ABC1D23'});
  const cc=r.j&&r.j.id;
  check('carregamento bipando os DACTEs: começa vazio',r.status===201&&r.j.sessao.modo==='ctes'&&r.j.esperado.length===0,r.j);
  const dacte2='35261012345678000199570010000123461000012346';
  const lt=async(codigo,extra={})=>api('POST','/api/painel/conferencia/sessoes/'+cc+'/leituras',{codigo,...extra});
  r=await lt(dacte2,{cte_teste:{ctrc:'AMS001050-2',nf:'112899',volumes:2,nomes:['CONASID IND']}});
  check('DACTE bipado coloca o CT-e na carga',r.j.situacao==='cte_adicionado'&&r.j.ctrc==='AMS001050-2'&&/2 volume/.test(r.j.mensagem)&&/Conasid/.test(r.j.mensagem),r.j);
  r=await lt(dacte2);check('  ...o mesmo DACTE de novo não duplica o CT-e',r.j.situacao==='dacte',r.j);
  r=await lt('001000257623');r=await lt('001000257627');
  check('volumes do CT-e bipado: 2 de 2 completo',r.j.situacao==='ok'&&r.j.sinal==='ok_completo',r.j);
  r=await lt('46570145384634');check('volume de parceiro sem CT-e na carga: NÃO CARREGAR',r.j.situacao==='sobra'&&/NÃO CARREGAR/.test(r.j.mensagem),r.j);
  r=await lt('35261012345678000199570010000999991000099999');check('DACTE que o SSW não acha',r.j.situacao==='cte_nao_achado'&&r.j.sinal==='erro',r.j);
  r=await api('DELETE','/api/painel/conferencia/sessoes/'+cc+'/ctes/AMS001050-2');
  check('tirar CT-e bipado por engano',r.status===200&&r.j.esperado.length===0,r.j.esperado);
  // Transbarbosa: bipamos o DACTE dele (chave de outra transportadora), que aponta para o nosso CT-e
  const dacteTb='35261099888777000166570010000456781000045678',nossoTb='35261012345678000199570010000123471000012347';
  r=await lt(dacteTb,{cte_teste:{ctrc:'AMS001051-0',nf:'556677',volumes:3,chave:nossoTb,nomes:['TRANSBARBOSA TRANSPORTES']}});
  check('DACTE da Transbarbosa coloca o nosso CT-e na carga',r.j.situacao==='cte_adicionado'&&r.j.ctrc==='AMS001051-0'&&r.j.parceiro==='Transbarbosa',r.j);
  r=await lt(dacteTb);check('  ...bipar de novo o DACTE dele reconhece o CT-e',r.j.situacao==='dacte'&&r.j.ctrc==='AMS001051-0',r.j);
  r=await lt(nossoTb);check('  ...o nosso DACTE também reconhece',r.j.situacao==='dacte'&&r.j.ctrc==='AMS001051-0',r.j);
  r=await api('DELETE','/api/painel/conferencia/sessoes/'+cc+'/ctes/AMS001051-0');
  // link do motorista: só bipa e acompanha
  r=await lt(dacte2,{cte_teste:{ctrc:'AMS001050-2',nf:'112899',volumes:2,nomes:['CONASID IND']}});
  r=await api('POST','/api/painel/conferencia/sessoes/'+id+'/link-motorista',{});
  check('link do motorista não vale para descarga/fechada',r.status===400||r.status===409,r.j);
  r=await api('POST','/api/painel/conferencia/sessoes/'+cc+'/link-motorista',{});
  const tok=r.j&&((r.j.link||'').match(/\/conferencia\/m\/([A-Za-z0-9_-]+)$/)||[])[1];
  check('gera link do motorista com WhatsApp',r.status===200&&!!tok&&/^https:\/\/wa\.me\/\?text=/.test(r.j.whatsapp),r.j);
  const mot=async(m,suf,body)=>{const x=await fetch(B+'/api/conferencia-motorista/'+tok+suf,{method:m,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let j=null;try{j=await x.json()}catch{}return{status:x.status,j}};
  r=await mot('GET','');
  check('motorista vê a carga sem login',r.status===200&&r.j.ctes===1&&r.j.totais.esperado===2&&r.j.sessao.status==='aberta',r.j);
  check('  ...sem dados de leitura do conferente (id/usuário)',r.j&&r.j.leituras.every(l=>!('id' in l)&&!('usuario' in l)),r.j&&r.j.leituras);
  r=await mot('POST','/leituras',{codigo:'001000257623',uuid:'m-1'});
  check('motorista bipa volume da carga (já lido antes pelo conferente: repetido)',r.status===200&&['ok','duplicado'].includes(r.j.situacao)&&r.j.parceiro==='Conasid',r.j);
  r=await mot('POST','/leituras',{codigo:'35261012345678000199570010000999991000099999',uuid:'m-2'});
  check('DACTE fora da carga: NÃO CARREGAR e não entra',r.j.situacao==='dacte_fora'&&/NÃO CARREGAR/.test(r.j.mensagem),r.j);
  r=await api('GET','/api/painel/conferencia/sessoes/'+cc);
  check('  ...a carga continua com 1 CT-e',r.j.esperado.length===1,r.j.esperado);
  check('conferente vê o horário do link',!!r.j.sessao.motorista_link_em);
  for(const [m,suf] of [['DELETE','/leituras/1'],['POST','/fechar'],['POST','/recarregar'],['DELETE',''],['PUT','']]){
    const x=await mot(m,suf,m==='DELETE'?undefined:{});check('motorista não pode '+m+' '+(suf||'/'),[401,404,405].includes(x.status),x);
  }
  r=await fetch(B+'/api/painel/conferencia/sessoes/'+cc);check('token não abre o painel',r.status===401);
  r=await mot('POST','/terminei',{});check('motorista avisa que terminou',r.status===200);
  r=await api('GET','/api/painel/conferencia/sessoes/'+cc);check('  ...conferente vê que terminou',!!r.j.sessao.motorista_terminou_em);
  const pg=await (await fetch(B+'/conferencia/m/'+tok)).text();
  check('página do motorista abre sem login, sem botão de desfazer',pg.includes('Terminei de carregar')&&!/data-desf|\/fechar|\/recarregar/.test(pg));
  r=await api('POST','/api/painel/conferencia/sessoes/'+cc+'/link-motorista',{});
  const tok2=((r.j.link||'').match(/\/conferencia\/m\/([A-Za-z0-9_-]+)$/)||[])[1];
  r=await mot('GET','');check('link trocado: o anterior para de funcionar',r.status===404,r);
  r=await (await fetch(B+'/api/conferencia-motorista/'+tok2)).json();check('  ...o novo funciona',r.ok===true);
  r=await fetch(B+'/api/conferencia-motorista/xxxxxxxxxxxxxxxxxxxxxxxx');check('token inventado: 404',r.status===404);
  await api('DELETE','/api/painel/conferencia/sessoes/'+cc+'/link-motorista');
  r=await fetch(B+'/api/conferencia-motorista/'+tok2);check('link cancelado: 404',r.status===404);
  r=await api('POST','/api/painel/conferencia/sessoes/'+cc+'/link-motorista',{});
  const tok3=((r.j.link||'').match(/\/conferencia\/m\/([A-Za-z0-9_-]+)$/)||[])[1];
  await api('POST','/api/painel/conferencia/sessoes/'+cc+'/fechar',{});
  r=await fetch(B+'/api/conferencia-motorista/'+tok3+'/leituras',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigo:'001000257627'})});
  check('conferência fechada: link encerra (410)',r.status===410);

  r=await api('GET','/api/painel/conferencia/sessoes?tipo=carregamento');
  check('lista de carregamentos',r.status===200&&r.j.rows.length===2&&r.j.rows.every(x=>x.tipo==='carregamento'),r.j.rows);
  r=await api('GET','/api/painel/conferencia/romaneios');
  check('romaneios do SSW (sem SSW no teste: lista vazia)',r.status===200&&Array.isArray(r.j.rows));

  console.log('Conferência do galpão');
  r=await api('POST','/api/painel/conferencia/sessoes',{tipo:'contagem',rows:[rows[1],rows[2]]});
  const gid=r.j&&r.j.id;
  check('cria a conferência do galpão com os CT-es disponíveis no SSW',r.status===201&&!!gid&&r.j.sessao.tipo==='contagem'&&/^Galpão /.test(r.j.sessao.titulo)&&r.j.totais.esperado===3,r.j);
  const lerG=codigo=>api('POST','/api/painel/conferencia/sessoes/'+gid+'/leituras',{codigo});
  r=await lerG('46570145384634');check('  ...volume no galpão conta',r.j.situacao==='ok'&&r.j.progresso.lidos===1,r.j);
  r=await lerG('941221');check('  ...parceiro sem CT-e no galpão aparece como sobra',r.j.situacao==='sobra'&&/galpão/.test(r.j.mensagem)&&!/NÃO CARREGAR/.test(r.j.mensagem),r.j);
  r=await api('GET','/api/painel/conferencia/sessoes/'+gid);
  check('  ...resumo mostra o que falta por parceiro',r.j.parceiros.find(p=>p.parceiro==='Conasid').faltam===2&&r.j.totais.excesso===1,r.j.totais);
  r=await api('GET','/api/painel/conferencia/sessoes?tipo=contagem');
  check('  ...lista das conferências do galpão',r.status===200&&r.j.rows.length>=1&&r.j.rows.every(x=>x.tipo==='contagem'),r.j.rows);

  r=await api('PUT','/api/painel/conferencia/formatos',{formatos:[{nome:'X',padrao:'([',termos:'X'}]});
  check('padrão inválido é recusado',r.status===400,r.j);
  const html=await (await fetch(B+'/conferencia',{headers:{Cookie:cookie}})).text();
  check('tela /conferencia abre com login',html.includes('Conferência de carga')&&html.includes('/api/painel/conferencia/sessoes'));
  check('tela /conferencia sem login vai para o login',(await fetch(B+'/conferencia',{redirect:'manual'})).status===302);

  console.log('\n'+pass+' ok, '+fail+' falha(s)');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
