// Versão de demonstração (MOVIT_DEMO=1): entrada com o login do SSW de cada transportadora.
// Roda contra o SSW de mentira (tests/apoio/ssw-falso.js); nunca toca no SSW real.
// Pré-requisitos: servidor iniciado com MOVIT_DEMO=1, MOVIT_CHAVE_SSW, banco de teste vazio e
//   NODE_OPTIONS="--require tests/apoio/sem-rede.js --require tests/apoio/ssw-desvio.js"
const B=process.env.BASE_URL||'http://127.0.0.1:10000',M='http://127.0.0.1:'+(process.env.MOCK_PORT||10555);
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
if(/onrender\.com/i.test(B)&&!/teste/i.test(B)){console.error('Recusado: BASE_URL parece ser a produção.');process.exit(2)}
const path=require('path');
const {Pool}=require(path.join(__dirname,'..','node_modules','pg'));
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,extra);if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name+' '+extra).replace(/\r?\n/g,' ').slice(0,900))}}
async function call(method,p,{body,cookie,ip,auth}={}){
  const h={};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;if(ip)h['X-Forwarded-For']=ip;if(auth)h.Authorization=auth;   // ip: outro visitante (limite de entradas por IP)
  const r=await fetch(B+p,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});
  const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}
  return{status:r.status,json,text,location:r.headers.get('location')||'',cookie:((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0]};
}
const stats=async()=>(await fetch(M+'/__mock/stats')).json();
const EMPRESA_A={empresa:'Transportes Teste A',dominio:'tst',cpf:'123.456.789-01',usuario:'Joao',senha:'segredo-a-1',unidades:'mtz, cps',contato:'(19) 99999-0000'};
const EMPRESA_B={empresa:'Logística Teste B',dominio:'XYZ',cpf:'98765432100',usuario:'maria',senha:'segredo-b-2',unidades:'SAO'};
(async()=>{
  const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
  console.log('A. Entrada da demonstração');
  let r=await call('GET','/');check('sem sessão, a página inicial leva para /demo',r.status===302&&r.location==='/demo','veio '+r.status+' '+r.location);
  r=await call('GET','/?login=1');check('/?login=1 continua abrindo o login da administração',r.status===200);
  r=await call('GET','/demo');check('página /demo mostra o formulário do SSW',r.status===200&&r.text.includes('Entrar com o login do SSW'));
  r=await call('GET','/api/demo/info');check('módulos disponíveis na demo listados',r.status===200&&(r.json?.modulos||[]).some(m=>m.key==='roteirizador'),r.text.slice(0,200));
  r=await call('POST','/api/demo/entrar',{body:{...EMPRESA_A,cpf:'123'}});check('CPF incompleto -> 400',r.status===400&&/CPF/.test(r.json?.error||''),r.text.slice(0,160));
  const antes=(await db.query('SELECT count(*)::int n FROM movit_clients')).rows[0].n;
  r=await call('POST','/api/demo/entrar',{body:{...EMPRESA_A,senha:'senha-errada'}});
  check('senha recusada pelo SSW -> 401 e nada é criado',r.status===401&&!r.cookie&&(await db.query('SELECT count(*)::int n FROM movit_clients')).rows[0].n===antes,r.status+' '+r.text.slice(0,160));

  console.log('B. Empresa A entra com o SSW dela');
  r=await call('POST','/api/demo/entrar',{body:EMPRESA_A});
  const cookieA=r.cookie;
  check('login aceito, sessão criada',r.status===200&&!!cookieA,r.status+' '+r.text.slice(0,200));
  check('usuário marcado como cliente da demo, com todos os módulos contratados',r.json?.user?.demo===true&&JSON.stringify(r.json?.user?.client_modules)==='["lotacao","coletas","financeiro_lotacao","operacao","visao_geral","dashboards","agendamento","programacao","roteirizador","rastreio","financeiro_operacoes","frota","contas_pagar","usuarios","app_movit"]',JSON.stringify(r.json?.user||{}).slice(0,300));
  const row=(await db.query("SELECT s.*,c.name,c.status FROM movit_client_ssw s JOIN movit_clients c ON c.id=s.client_id WHERE dominio='TST'")).rows[0];
  check('empresa criada em teste grátis com domínio e unidades normalizados',row&&row.name==='Transportes Teste A'&&row.status==='trial'&&row.unidades==='MTZ,CPS'&&row.cpf==='12345678901'&&row.usuario==='joao',JSON.stringify(row||{}).slice(0,300));
  check('senha do SSW guardada criptografada (nunca em texto)',row&&/^v1:/.test(row.senha_cifrada)&&!row.senha_cifrada.includes('segredo')&&!JSON.stringify(row).includes('segredo-a-1'));
  r=await call('GET','/',{cookie:cookieA});check('com sessão, a página inicial abre o painel',r.status===200);
  r=await call('GET','/api/auth/me',{cookie:cookieA});check('sessão da empresa A ativa',r.status===200&&r.json?.user?.username==='tst.joao',r.text.slice(0,200));
  const s0=await stats();
  r=await call('GET','/api/ssw/conexao',{cookie:cookieA});
  const s1=await stats();
  check('leitura do SSW da empresa A entra com o login DELA',r.status===200&&r.json?.conectado===true&&r.json?.dominio==='TST'&&s1.ultimoLogin?.usuario==='joao'&&s1.logins===s0.logins+1,r.status+' '+r.text.slice(0,200)+' '+JSON.stringify(s1.ultimoLogin));
  r=await call('GET','/api/ssw/conexao',{cookie:cookieA});const s2=await stats();
  check('segunda consulta reaproveita o processo e a sessão do SSW (sem login novo)',r.json?.conectado===true&&s2.logins===s1.logins,JSON.stringify({antes:s1.logins,depois:s2.logins}));
  r=await call('GET','/api/programacao-entregas/disponiveis',{cookie:cookieA});
  const ctrcsA=(r.json?.rows||[]).map(x=>x.ctrc).sort();
  check('Roteirizador busca no SSW os CTRCs disponíveis das unidades da empresa (MTZ e CPS, sem repetir)',r.status===200&&JSON.stringify(ctrcsA)===JSON.stringify(['CPS000077-3','MTZ000501-1','MTZ000502-2']),r.status+' '+r.text.slice(0,240));
  check('...com cidade, peso e volumes de cada CTRC',(r.json?.rows||[]).some(x=>x.ctrc==='MTZ000501-1'&&x.cidade==='CAMPINAS'&&x.peso===120.5&&x.volumes===4),JSON.stringify((r.json?.rows||[])[0]||{}));
  r=await call('GET','/api/agendamentos/nf?nf=30101',{cookie:cookieA});
  check('Agendamento acha a NF no SSW da empresa (CT-e, destinatário e cidade)',r.status===200&&r.json?.row?.ctrc==='MTZ000501-1'&&r.json?.row?.cidade==='CAMPINAS'&&r.json?.row?.destinatario==='LOJA CENTRO',r.status+' '+r.text.slice(0,240));
  r=await call('POST','/api/painel/agendamentos/sincronizar',{cookie:cookieA});
  check('Sincronizar SSW agora (com o SSW da própria empresa) começa em segundo plano',r.status===202,r.status+' '+r.text.slice(0,200));
  for(let i=0;i<60;i++){await new Promise(ok=>setTimeout(ok,500));r=await call('GET','/api/painel/agendamentos/painel',{cookie:cookieA});if(!r.json?.indicadores?.rodando)break}
  check('...e termina com as pendências das unidades da empresa (MTZ e CPS, sem repetir)',r.json?.indicadores?.sync?.ultima?.status==='ok'&&r.json.indicadores.pendentes===3&&r.json.indicadores.sem_agendamento===3,r.text.slice(0,400));
  r=await call('GET','/api/painel/agendamentos/lista?aba=sem',{cookie:cookieA});
  const n30101=(r.json?.rows||[]).find(x=>x.nf==='30101');
  check('Sem Agendamento lista as notas pendentes da empresa',r.status===200&&JSON.stringify((r.json?.rows||[]).map(x=>x.nf).sort())===JSON.stringify(['30101','30102','40201'])&&n30101?.ctrc==='MTZ000501-1',r.status+' '+r.text.slice(0,240));
  const amanha=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  r=await call('POST','/api/painel/agendamentos',{cookie:cookieA,body:{nota_id:n30101?.nota_id,data_agendada:amanha,observacao:'teste'}});
  check('Agendamento grava o agendamento da empresa',r.status===201,r.status+' '+r.text.slice(0,200));
  r=await call('GET','/api/painel/agendamentos/lista?aba=agendadas',{cookie:cookieA});
  check('Agendadas lista o agendamento gravado',r.status===200&&(r.json?.rows||[]).length===1&&r.json.rows[0].nf==='30101',r.status+' '+r.text.slice(0,200));

  r=await call('GET','/api/auth/me',{cookie:cookieA});
  check('Dashboards liberado na demo com os cards do SSW da empresa (sem os do BI2)',(r.json?.user?.demo_telas||[]).includes('dashboards')&&['coletas','frota','evolucao','ssw_saidas','lancamentos','contas_pagar'].every(x=>(r.json?.user?.demo_perms||[]).includes(x))&&!(r.json?.user?.demo_perms||[]).includes('ssw_atrasos'),JSON.stringify(r.json?.user||{}).slice(0,400));
  r=await call('GET','/api/evolucao-motoristas',{cookie:cookieA});
  const motsA=(r.json?.motoristas38||[]).map(x=>x.motorista).sort();
  check('Evolução por Motorista lê a opção 38 nas unidades da empresa A (MTZ e CPS)',r.status===200&&JSON.stringify(motsA)===JSON.stringify(['CARLOS DEMO MTZ','PAULO DEMO CPS']),r.status+' '+r.text.slice(0,300));
  r=await call('GET','/api/bi2/saidas-baixas',{cookie:cookieA});
  check('Saídas x Baixas responde com os romaneios das unidades da empresa A',r.status===200&&/CARLOS DEMO MTZ/.test(r.text)&&/PAULO DEMO CPS/.test(r.text)&&!/JAILSON|ROGER TESTE/.test(r.text),r.status+' '+r.text.slice(0,300));

  console.log('C. Módulos da operação abrem para o cliente da demo; administração MOVIT, planilhas e BI2 (sem acesso) não');
  for(const p of ['/api/lancamentos','/coletas/api/coletas','/api/bills','/api/painel/carregamentos-finais','/api/painel/nf-materiais','/api/painel/frota-state'])
  {r=await call('GET',p,{cookie:cookieA});check('GET '+p+' -> 200',r.status===200,'veio '+r.status+' '+r.text.slice(0,120))}
  for(const p of ['/api/sheet/base','/api/sheet/agendamentos','/api/bi2/receita','/api/bi2/atrasos','/api/ssw/cidades-mapa','/api/movit-central/clients'])
  {r=await call('GET',p,{cookie:cookieA});check('GET '+p+' -> 403',r.status===403,'veio '+r.status+' '+r.text.slice(0,120))}
  r=await call('GET','/api/rc/eu',{cookie:cookieA});check('Roteirizador de Cargas abre (dados separados por empresa)',r.status===200,'veio '+r.status+' '+r.text.slice(0,160));
  r=await call('GET','/api/painel/auth/users',{cookie:cookieA});
  const lista=r.json?.users||r.json?.rows||[];
  check('Usuários: a empresa A vê só os usuários dela',r.status===200&&lista.length>0&&lista.every(u=>/^tst\./.test(u.username)),r.text.slice(0,200));

  console.log('D. Empresa B fica separada da empresa A');
  r=await call('POST','/api/demo/entrar',{body:EMPRESA_B});const cookieB=r.cookie;
  check('empresa B entra',r.status===200&&!!cookieB,r.text.slice(0,160));
  const ids=(await db.query("SELECT dominio,client_id::text id FROM movit_client_ssw ORDER BY dominio")).rows;
  check('cada empresa tem o seu cadastro',ids.length===2&&ids[0].id!==ids[1].id,JSON.stringify(ids));
  r=await call('GET','/api/ssw/conexao',{cookie:cookieB});const s3=await stats();
  check('leitura do SSW da empresa B usa o login de B',r.json?.dominio==='XYZ'&&s3.ultimoLogin?.dominio==='XYZ'&&s3.ultimoLogin?.usuario==='maria',r.text.slice(0,200));
  r=await call('GET','/api/ssw/conexao',{cookie:cookieA});
  check('...e a empresa A continua no SSW dela',r.json?.dominio==='TST',r.text.slice(0,200));
  r=await call('GET','/api/programacao-entregas/disponiveis',{cookie:cookieB});
  r=await call('GET','/api/evolucao-motoristas',{cookie:cookieB});
  check('Evolução da empresa B não mostra os motoristas da empresa A',r.status===200&&!/CARLOS DEMO|PAULO DEMO|JAILSON/.test(r.text),r.status+' '+r.text.slice(0,200));
  check('Roteirizador da empresa B não recebe os CTRCs da empresa A',!(r.json?.rows||[]).some(x=>/^(MTZ|CPS)/.test(x.ctrc)),r.status+' '+r.text.slice(0,200));
  r=await call('GET','/api/painel/agendamentos/lista?aba=agendadas',{cookie:cookieB});
  check('Agendamento da empresa B não mostra os agendamentos da empresa A',r.status===200&&!(r.json?.rows||[]).length,r.status+' '+r.text.slice(0,200));
  r=await call('GET','/api/painel/agendamentos/lista?aba=sem',{cookie:cookieB});
  check('...nem as notas pendentes da empresa A',r.status===200&&!(r.json?.rows||[]).length,r.status+' '+r.text.slice(0,200));
  r=await call('GET','/api/rc/doc?path='+encodeURIComponent('cad/main/ajustes'),{cookie:cookieB});
  check('Roteirizador da empresa B responde',r.status===200||r.status===404,'veio '+r.status);

  console.log('E. Novo login da mesma empresa');
  const nA=(await db.query('SELECT count(*)::int n FROM movit_clients')).rows[0].n;
  r=await call('POST','/api/demo/entrar',{body:{...EMPRESA_A,senha:'senha-nova-a',unidades:''}});
  const row2=(await db.query("SELECT * FROM movit_client_ssw WHERE dominio='TST'")).rows[0];
  check('mesma empresa: não duplica o cadastro e guarda a senha nova',r.status===200&&(await db.query('SELECT count(*)::int n FROM movit_clients')).rows[0].n===nA&&row2.senha_cifrada!==row.senha_cifrada&&row2.unidades==='MTZ,CPS',r.text.slice(0,160));
  const s4=await stats();
  r=await call('GET','/api/ssw/conexao',{cookie:r.cookie});const s5=await stats();
  check('processo da empresa reinicia com o login novo',r.json?.conectado===true&&s5.logins===s4.logins+1&&s5.ultimoLogin?.dominio==='TST',JSON.stringify(s5.ultimoLogin));

  console.log('F. Administração MOVIT');
  r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});const cookieAdm=r.cookie;
  check('login do administrador',r.status===200&&!!cookieAdm&&r.json?.user?.demo!==true,r.text.slice(0,160));
  r=await call('GET','/api/movit-central/clients',{cookie:cookieAdm});
  const nomes=(r.json?.clients||[]).map(c=>c.name);
  check('MOVIT Central lista as empresas que entraram pela demo',r.status===200&&nomes.includes('Transportes Teste A')&&nomes.includes('Logística Teste B'),r.text.slice(0,200));
  const usoA=(r.json?.clients||[]).find(c=>c.name==='Transportes Teste A')||{},usoB=(r.json?.clients||[]).find(c=>c.name==='Logística Teste B')||{},usoCl=(r.json?.clients||[]).find(c=>/construlog/i.test(c.slug||''))||{};
  check('MOVIT Central mostra entradas e último acesso de cada empresa da demo',usoA.demo_entradas===2&&usoB.demo_entradas===1&&!!usoA.demo_ultimo_acesso&&usoA.demo_dominio==='TST'&&usoCl.demo_entradas==null,JSON.stringify([usoA.demo_entradas,usoB.demo_entradas,usoA.demo_ultimo_acesso,usoA.demo_dominio,usoCl.demo_entradas]));
  r=await call('GET','/api/ssw/conexao',{cookie:cookieAdm});
  check('administrador não usa o SSW de nenhuma empresa da demo',r.json?.dominio!=='TST'&&r.json?.dominio!=='XYZ',r.text.slice(0,200));

  console.log('G. Passo a passo e vídeos');
  r=await call('POST','/api/demo/entrar',{body:EMPRESA_A});const cookieG=r.cookie;
  r=await call('GET','/api/guia',{cookie:cookieG});
  const passosIds=(r.json?.passos||[]).map(p=>p.id);
  check('passo a passo da demo: conexão SSW primeiro, depois os módulos liberados',r.status===200&&passosIds[0]==="ssw"&&["usuarios","roteirizador","coletas","frota"].every(x=>passosIds.includes(x)),JSON.stringify(passosIds));
  check('sem arquivo de vídeo, nenhum passo mostra vídeo',(r.json?.passos||[]).every(p=>!p.video));
  r=await call('POST','/api/guia/feito',{cookie:cookieG,body:{id:'usuarios'}});
  check('marca passo concluído',r.status===200,r.text.slice(0,120));
  r=await call('GET','/api/guia',{cookie:cookieG});
  check('passo concluído fica guardado',(r.json?.passos||[]).find(p=>p.id==='usuarios')?.feito===true);
  r=await call('POST','/api/guia/feito',{cookie:cookieG,body:{id:'usuarios',feito:false}});r=await call('GET','/api/guia',{cookie:cookieG});
  check('desmarcar volta o passo',(r.json?.passos||[]).find(p=>p.id==='usuarios')?.feito===false);
  r=await call('POST','/api/guia/feito',{cookie:cookieG,body:{id:'qualquer'}});check('passo inexistente -> 400',r.status===400);
  r=await call('GET','/api/guia');check('passo a passo exige login',r.status===401,'veio '+r.status);
  const fs=require('fs'),vdir=path.join(__dirname,'..','videos'),vfile=path.join(vdir,'roteirizador.mp4'),criouDir=!fs.existsSync(vdir),existia=fs.existsSync(vfile);
  if(!existia){fs.mkdirSync(vdir,{recursive:true});fs.writeFileSync(vfile,Buffer.alloc(5000,7))}
  try{
    r=await call('GET','/api/guia',{cookie:cookieG});
    check('com o arquivo, o passo do Roteirizador mostra o vídeo',(r.json?.passos||[]).find(p=>p.id==='roteirizador')?.video==='/videos/roteirizador.mp4',r.text.slice(0,300));
    let v=await fetch(B+'/videos/roteirizador.mp4',{headers:{Range:'bytes=100-199'}});const vb=Buffer.from(await v.arrayBuffer());
    check('vídeo responde por partes (Range) para o player avançar e voltar',v.status===206&&vb.length===100&&v.headers.get('content-range')==='bytes 100-199/'+(existia?fs.statSync(vfile).size:5000),v.status+' '+vb.length);
    v=await fetch(B+'/videos/..%2Fserver.js');check('nome de vídeo inválido -> 404',v.status===404,'veio '+v.status);
    const cid=(await db.query("SELECT client_id::text id FROM movit_client_ssw WHERE dominio='TST'")).rows[0].id;
    const cli=(await call('GET','/api/movit-central/clients',{cookie:cookieAdm})).json.clients.find(c=>c.id===cid);
    check('MOVIT Central mostra os vídeos ligados do cliente (todos, por padrão)',Array.isArray(cli?.videos)&&cli.videos.includes('roteirizador'),JSON.stringify(cli||{}).slice(0,300));
    r=await call('PATCH','/api/movit-central/clients/'+cid,{cookie:cookieAdm,body:{...cli,modules:cli.modules,videos:cli.modules.filter(m=>m!=='roteirizador')}});
    check('MOVIT Central desliga o vídeo do Roteirizador para este cliente',r.status===200,r.text.slice(0,200));
    r=await call('GET','/api/guia',{cookie:cookieG});
    check('...e o passo do Roteirizador deixa de mostrar o vídeo',(r.json?.passos||[]).find(p=>p.id==='roteirizador')?.video==='',r.text.slice(0,300));
  }finally{if(!existia){fs.unlinkSync(vfile);if(criouDir)fs.rmdirSync(vdir)}}

  console.log('H. Logo da empresa (sem logo, o da MOVIT)');
  const PNG1='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const logoDe=async cookie=>{const x=await fetch(B+'/api/empresa/logo',{headers:cookie?{Cookie:cookie}:{}});return{status:x.status,tipo:x.headers.get('content-type')||'',corpo:Buffer.from(await x.arrayBuffer())}};
  const LOGO_MOVIT=require('fs').readFileSync(path.join(__dirname,'..','movit-logo.png'));
  const ehMovit=lg=>lg.tipo==='image/png'&&Buffer.compare(lg.corpo,LOGO_MOVIT)===0;
  let lg=await logoDe('');check('sem sessão, o logo é o da MOVIT',lg.status===200&&ehMovit(lg),lg.status+' '+lg.tipo);
  const claro=await fetch(B+'/api/empresa/logo?padrao=1&fundo=escuro');const claroBuf=Buffer.from(await claro.arrayBuffer());
  check('cabeçalho escuro recebe a versão clara do logo da MOVIT',claro.status===200&&/png/.test(claro.headers.get('content-type')||'')&&claroBuf.length>1000&&Buffer.compare(claroBuf,LOGO_MOVIT)!==0,claro.status);
  r=await call('GET','/?login=1');
  check('tela de acesso da demo mostra a MOVIT, não a CONSTRULOG',r.status===200&&r.text.includes('src="/api/empresa/logo?padrao=1" alt="MOVIT"')&&!/alt="CONSTRULOG —/.test(r.text),r.status);
  r=await call('GET','/api/auth/me',{cookie:cookieG});check('empresa sem logo: painel sabe que é o da MOVIT',r.json?.user?.client?.has_logo===false,JSON.stringify(r.json?.user?.client||{}).slice(0,200));
  lg=await logoDe(cookieG);check('empresa sem logo recebe o logo da MOVIT',ehMovit(lg),lg.tipo);
  r=await call('POST','/api/empresa/logo',{cookie:cookieG,body:{logo:'data:image/svg+xml;base64,'+Buffer.from('<svg onload="alert(1)"/>').toString('base64')}});
  check('logo em SVG é recusado (pode ter script)',r.status===400,r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/empresa/logo',{cookie:cookieG,body:{logo:'data:image/png;base64,'+Buffer.from('não é imagem').toString('base64')}});
  check('arquivo que não é imagem é recusado',r.status===400,r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/empresa/logo',{cookie:cookieG,body:{logo:'data:image/png;base64,'+Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47]),Buffer.alloc(310*1024)]).toString('base64')}});
  check('logo acima de 300 KB é recusado',r.status===400||r.status===413,r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/empresa/logo',{body:{logo:PNG1}});check('subir logo exige login',r.status===401,'veio '+r.status);
  r=await call('POST','/api/empresa/logo',{cookie:cookieG,body:{logo:PNG1}});check('administrador da empresa sobe o logo',r.status===200,r.status+' '+r.text.slice(0,160));
  lg=await logoDe(cookieG);check('logo da empresa A aparece para ela (PNG enviado)',lg.tipo==='image/png'&&lg.corpo.equals(Buffer.from(PNG1.split(',')[1],'base64')),lg.tipo+' '+lg.corpo.length);
  r=await call('GET','/api/auth/me',{cookie:cookieG});check('painel sabe que a empresa tem logo',r.json?.user?.client?.has_logo===true&&r.json.user.client.logo_v!=='0',JSON.stringify(r.json?.user?.client||{}).slice(0,200));
  lg=await logoDe(cookieB);check('empresa B continua com o logo da MOVIT (não vê o logo da A)',ehMovit(lg),lg.tipo);
  r=await call('DELETE','/api/empresa/logo',{cookie:cookieG});lg=await logoDe(cookieG);
  check('remover volta ao logo da MOVIT',r.status===200&&ehMovit(lg),r.status+' '+lg.tipo);
  const EMPRESA_C={empresa:'Cargas Teste C',dominio:'LGC',cpf:'11122233344',usuario:'ana',senha:'segredo-c-3',unidades:'MTZ'};
  r=await call('POST','/api/demo/entrar',{body:{...EMPRESA_C,logo:'data:image/gif;base64,'+Buffer.from('nada').toString('base64')}});
  check('entrada da demo com logo inválido mostra o erro do logo',r.status===400&&/imagem/i.test(r.json?.error||''),r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/demo/entrar',{body:{...EMPRESA_C,logo:PNG1}});const cookieC=r.cookie;
  lg=await logoDe(cookieC);check('logo enviado junto com o login do SSW já aparece no painel',r.status===200&&lg.tipo==='image/png',r.status+' '+lg.tipo+' '+r.text.slice(0,160));

  console.log('I. Cards do BI2: só para a empresa que informou o acesso ao BI2');
  const BI2_A={bi2_sigla:'TSTA',bi2_senha:'bi2-a',bi2_pasta:'cliente'};
  r=await call('POST','/api/demo/entrar',{ip:'10.0.0.9',body:{...EMPRESA_A,bi2_sigla:'tsta'}});
  check('BI2 com sigla e sem senha -> 400',r.status===400&&/BI2/.test(r.json?.error||''),r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/demo/entrar',{ip:'10.0.0.9',body:{...EMPRESA_A,...BI2_A,bi2_senha:'outra'}});
  check('senha do BI2 recusada -> 401 e nada do BI2 é guardado',r.status===401&&/BI2/.test(r.json?.error||'')&&!(await db.query("SELECT bi2_sigla FROM movit_client_ssw WHERE dominio='TST'")).rows[0].bi2_sigla,r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/demo/entrar',{ip:'10.0.0.9',body:{...EMPRESA_A,...BI2_A}});const cookieBi2=r.cookie;
  check('empresa A entra com o BI2',r.status===200&&r.json?.user?.client?.bi2===true,r.status+' '+r.text.slice(0,200));
  const bi2Row=(await db.query("SELECT bi2_sigla,bi2_pasta,bi2_senha_cifrada FROM movit_client_ssw WHERE dominio='TST'")).rows[0];
  check('senha do BI2 guardada criptografada',bi2Row.bi2_sigla==='tsta'&&bi2Row.bi2_pasta==='cliente'&&/^v1:/.test(bi2Row.bi2_senha_cifrada||'')&&!bi2Row.bi2_senha_cifrada.includes('bi2-a')&&!r.text.includes('bi2-a'),JSON.stringify(bi2Row).slice(0,200));
  check('com BI2, a empresa A ganha os cards do BI2',['ssw_atrasos','remetentes','remetentes_comparativo','cidade_destino'].every(x=>(r.json?.user?.demo_perms||[]).includes(x)),JSON.stringify(r.json?.user?.demo_perms));
  r=await call('GET','/api/bi2/atrasos',{cookie:cookieBi2});
  check('CT-es atrasados vêm do BI2 da empresa A',r.status===200&&r.json?.total===2&&/CLIENTE ATRASADO UM/.test(r.text),r.status+' '+r.text.slice(0,300));
  r=await call('GET','/api/bi2/remetentes',{cookie:cookieBi2});
  check('Clientes remetentes vêm do BI2 da empresa A',r.status===200&&/REMETENTE DEMO A/.test(r.text)&&/OUTRO REMETENTE A/.test(r.text),r.status+' '+r.text.slice(0,300));
  r=await call('GET','/api/ssw/cidades-mapa',{cookie:cookieBi2});
  check('Mapa de cidades abre com o BI2 da empresa A',r.status===200,r.status+' '+r.text.slice(0,300));
  r=await call('GET','/api/bi2/receita',{cookie:cookieBi2});check('com BI2, a receita vem do BI2 da empresa A',r.status===200,'veio '+r.status+' '+r.text.slice(0,120));
  r=await call('GET','/api/sheet/lancamentos',{cookie:cookieBi2});check('com BI2, as planilhas da CONSTRULOG continuam fechadas',r.status===403,'veio '+r.status+' '+r.text.slice(0,120));
  const pedidos=await (await fetch(M+'/__mock/bi2')).json();
  check('cada empresa só consulta o BI2 da sua sigla',Object.keys(pedidos).every(k=>['tsta','tst','xyz','lgc'].includes(k)),JSON.stringify(pedidos));
  r=await call('GET','/api/auth/me',{cookie:cookieC});
  check('BI2 automático: a empresa C, que o BI2 aceita com o login do SSW, ganha os cards sem digitar nada',r.json?.user?.client?.bi2===true&&(r.json?.user?.demo_perms||[]).includes('ssw_atrasos'),JSON.stringify(r.json?.user?.client||{}).slice(0,200));
  const bi2C=(await db.query("SELECT bi2_sigla,bi2_senha_cifrada FROM movit_client_ssw WHERE dominio='LGC'")).rows[0];
  check('...com a senha do BI2 guardada criptografada',bi2C.bi2_sigla==='lgc'&&/^v1:/.test(bi2C.bi2_senha_cifrada||'')&&!bi2C.bi2_senha_cifrada.includes('segredo'),JSON.stringify(bi2C).slice(0,120));
  r=await call('GET','/api/bi2/atrasos',{cookie:cookieC});
  check('...e lê os CT-es atrasados do BI2 dela',r.status===200&&r.json?.total===2,r.status+' '+r.text.slice(0,160));
  r=await call('GET','/api/bi2/atrasos',{cookie:cookieB});
  check('empresa B (sem BI2) continua sem os cards do BI2',r.status===403,'veio '+r.status);
  r=await call('GET','/api/auth/me',{cookie:cookieB});
  check('...e sem as permissões do BI2',r.json?.user?.client?.bi2===false&&!(r.json?.user?.demo_perms||[]).includes('ssw_atrasos'),JSON.stringify(r.json?.user?.demo_perms));
  r=await call('POST','/api/demo/entrar',{ip:'10.0.0.9',body:EMPRESA_A});
  check('nova entrada sem os campos do BI2 mantém o BI2 guardado',r.status===200&&r.json?.user?.client?.bi2===true,r.status+' '+r.text.slice(0,160));

  console.log('J. Parceiros: cadastro com o login do SSW do parceiro e evolução das entregas dele');
  const PARC={nome:'Parceiro Sul',dominio:'tst',cpf:'222.333.444-55',usuario:'parc1',senha:'parc-senha-1',unidades:'prc'};
  r=await call('GET','/api/auth/me',{cookie:cookieBi2});
  check('tela Parceiros liberada com os Dashboards',(r.json?.user?.demo_telas||[]).includes('parceiros'),JSON.stringify(r.json?.user?.demo_telas));
  r=await call('POST','/api/painel/parceiros',{cookie:cookieBi2,body:{...PARC,unidades:''}});
  check('parceiro sem unidade -> 400',r.status===400&&/unidade/i.test(r.json?.error||''),r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/painel/parceiros',{cookie:cookieBi2,body:{...PARC,senha:'senha-errada'}});
  check('login do parceiro recusado pelo SSW -> 400 e nada é guardado',r.status===400&&/parceiro/.test(r.json?.error||'')&&!(await db.query('SELECT count(*)::int n FROM movit_parceiros')).rows[0].n,r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/painel/parceiros',{cookie:cookieBi2,body:PARC});
  const parcId=r.json?.parceiro?.id;
  check('parceiro cadastrado com o login conferido no SSW',r.status===201&&!!parcId&&r.json.parceiro.unidades==='PRC'&&!r.text.includes('parc-senha-1'),r.status+' '+r.text.slice(0,200));
  const parcRow=(await db.query('SELECT senha_cifrada FROM movit_parceiros WHERE id=$1',[parcId])).rows[0];
  check('senha do parceiro guardada criptografada',/^v1:/.test(parcRow?.senha_cifrada||'')&&!parcRow.senha_cifrada.includes('parc-senha'),JSON.stringify(parcRow).slice(0,80));
  r=await call('GET','/api/painel/parceiros',{cookie:cookieBi2});
  check('lista de parceiros da empresa A, sem senha nem CPF',r.status===200&&(r.json?.parceiros||[]).length===1&&!/senha|cpf/i.test(JSON.stringify(r.json.parceiros)),r.text.slice(0,200));
  r=await call('GET','/api/painel/parceiros/evolucao',{cookie:cookieBi2});
  const ev=(r.json?.parceiros||[])[0]||{};
  const motsP=(ev.motoristas||[]).map(x=>x.motorista);
  check('evolução do parceiro lê a opção 38 com o login dele, na unidade dele',r.status===200&&ev.ok===true&&JSON.stringify(motsP)==='["PEDRO PARCEIRO"]'&&ev.total===7&&ev.pendentes===3,r.status+' '+r.text.slice(0,300));
  r=await call('GET','/api/painel/parceiros',{cookie:cookieB});
  check('empresa B não vê os parceiros da empresa A',r.status===200&&(r.json?.parceiros||[]).length===0,r.text.slice(0,160));
  r=await call('DELETE','/api/painel/parceiros/'+parcId,{cookie:cookieB});
  check('empresa B não remove parceiro da empresa A',r.status===404,'veio '+r.status);
  r=await call('DELETE','/api/painel/parceiros/'+parcId,{cookie:cookieBi2});
  check('empresa A remove o parceiro',r.status===200&&!(await db.query('SELECT count(*)::int n FROM movit_parceiros')).rows[0].n,'veio '+r.status);

  console.log('K. Reinício do servidor não transforma cliente da demo em administrador MOVIT');
  // Simula o estado que a versão antiga deixava (empresa A promovida) e sobe outra instância do
  // servidor no mesmo banco: a inicialização tem de desfazer e não promover ninguém da demo.
  await db.query("UPDATE dashboard_users SET is_platform_admin=TRUE WHERE username='tst.joao'");
  const {spawn}=require('child_process');
  const P2=10200,env2={TEST_MODE:'1',PGSSLMODE:'disable',MOVIT_CHAVE_SSW:'chave-de-teste-com-mais-de-32-caracteres',DASHBOARD_INITIAL_ADMIN_USER:ADMIN_USER,DASHBOARD_INITIAL_ADMIN_PASSWORD:ADMIN_PASS,...process.env,MOVIT_DEMO:'1',PORT:String(P2),DASH_INTERNAL_PORT:String(P2+1),MOVIT_DEMO_PORTA_INICIAL:String(P2+10),
    NODE_OPTIONS:'--require '+path.join(__dirname,'apoio','sem-rede.js')+' --require '+path.join(__dirname,'apoio','ssw-desvio.js')};
  const srv2=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:env2,detached:true,stdio:'ignore'});
  try{
    let no_ar=false;for(let i=0;i<60&&!no_ar;i++){await new Promise(ok=>setTimeout(ok,1000));try{no_ar=(await fetch('http://127.0.0.1:'+P2+'/demo')).status===200}catch{}}
    check('segunda instância do servidor sobe',no_ar);
    const adms=(await db.query("SELECT username FROM dashboard_users WHERE is_platform_admin=TRUE AND client_id IN (SELECT client_id FROM movit_client_ssw)")).rows.map(x=>x.username);
    check('nenhum usuário de empresa da demo fica administrador MOVIT depois do reinício',adms.length===0,JSON.stringify(adms));
    const x=await fetch('http://127.0.0.1:'+P2+'/api/auth/me',{headers:{Cookie:cookieG}});const me=(await x.json()).user||{};
    check('...e continua cliente da demo, com os módulos contratados',me.demo===true&&me.is_platform_admin===false&&me.is_admin===true&&JSON.stringify(me.client_modules)==='["lotacao","coletas","financeiro_lotacao","operacao","visao_geral","dashboards","agendamento","programacao","roteirizador","rastreio","financeiro_operacoes","frota","contas_pagar","usuarios","app_movit"]',JSON.stringify(me).slice(0,300));
    const y=await fetch('http://127.0.0.1:'+P2+'/api/movit-central/clients',{headers:{Cookie:cookieG}});
    check('...e a administração MOVIT continua fechada para ele',y.status===403,'veio '+y.status);
    const adm=(await db.query('SELECT is_platform_admin FROM dashboard_users WHERE lower(username)=lower($1)',[ADMIN_USER])).rows[0];
    check('administrador MOVIT continua administrador MOVIT',adm?.is_platform_admin===true);
  }finally{try{process.kill(-srv2.pid,'SIGTERM')}catch{}}

  console.log('M. Dados dos módulos separados por empresa (esquema próprio de cada uma)');
  const venc=new Date(Date.now()+5*864e5).toISOString().slice(0,10);
  r=await call('POST','/api/bills',{cookie:cookieA,body:{description:'Conta da empresa A',supplier:'Fornecedor A',amount:123.45,dueDate:venc}});
  check('empresa A lança uma conta a pagar',r.status===200||r.status===201,r.status+' '+r.text.slice(0,200));
  r=await call('GET','/api/bills',{cookie:cookieA});check('...e vê a conta dela',r.status===200&&JSON.stringify(r.json).toLowerCase().includes('conta da empresa a'),r.text.slice(0,200));
  r=await call('GET','/api/bills',{cookie:cookieB});check('empresa B não vê a conta da empresa A',r.status===200&&!JSON.stringify(r.json).toLowerCase().includes('conta da empresa a'),r.text.slice(0,200));
  const idA=(await db.query("SELECT client_id::text AS id FROM movit_client_ssw WHERE dominio='TST'")).rows[0].id;
  check('a conta fica no esquema da empresa A, não no public',(await db.query('SELECT count(*)::int n FROM t'+idA+'.bills')).rows[0].n===1&&(await db.query("SELECT count(*)::int n FROM public.bills WHERE lower(description)='conta da empresa a'")).rows[0].n===0);
  r=await call('GET','/api/painel/frota-state',{cookie:cookieA});
  const frotaA=r.json?.data||{};frotaA.vehicles=[{id:'v1',placa:'AAA1A11',modelo:'Caminhão da A'}];
  r=await call('PUT','/api/painel/frota-state',{cookie:cookieA,body:{data:frotaA}});
  check('empresa A grava a frota dela',r.status===200,r.status+' '+r.text.slice(0,200));
  r=await call('GET','/api/painel/frota-state',{cookie:cookieB});
  check('empresa B continua com a frota vazia',r.status===200&&!JSON.stringify(r.json).includes('AAA1A11')&&Array.isArray(r.json?.data?.vehicles),r.text.slice(0,200));
  r=await call('GET','/api/painel/frota-state',{cookie:cookieA});check('...e a empresa A vê o caminhão dela',JSON.stringify(r.json).includes('AAA1A11'),r.text.slice(0,200));
  r=await call('POST','/coletas/api/coletas',{cookie:cookieA,body:{cliente:'REMETENTE DA EMPRESA A',endereco_entrega:'Rua de Teste, 100 - Campinas - SP',frete_cobrado:1500,frete_pago:900,data_carregamento:new Date().toISOString().slice(0,10),motorista:'MOTORISTA A',placa:'ABC1D23',tipo_caminhao:'Truck',implemento:'Baú'}});
  check('empresa A lança uma coleta na Lotação',r.status===200||r.status===201,r.status+' '+r.text.slice(0,200));
  r=await call('GET','/coletas/api/coletas',{cookie:cookieA});check('...e vê a coleta dela',(r.json||[]).some(c=>/REMETENTE DA EMPRESA A/i.test(c.cliente||'')),r.text.slice(0,200));
  const colA=(await db.query('SELECT client_id::text AS c FROM t'+idA+'.coletas')).rows;
  check('...gravada no esquema dela, com a empresa certa',colA.length===1&&colA[0].c===idA,JSON.stringify(colA));
  r=await call('GET','/coletas/api/coletas',{cookie:cookieB});check('empresa B não vê a coleta da empresa A',r.status===200&&Array.isArray(r.json)&&!r.json.length,r.text.slice(0,200));
  r=await call('GET','/api/painel/coletas-resumo',{cookie:cookieA});check('resumo da Lotação da empresa A traz a coleta dela',r.status===200&&JSON.stringify(r.json).includes('MOTORISTA A'),r.status+' '+r.text.slice(0,200));
  r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});
  r=await call('GET','/api/bills',{cookie:r.cookie});check('administração MOVIT (public) não vê a conta da empresa A',r.status===200&&!JSON.stringify(r.json).toLowerCase().includes('conta da empresa a'),r.status+' '+r.text.slice(0,120));

  console.log('L. Link de teste enviado pela MOVIT (com e sem o SSW)');
  const IPL='10.9.9.9',TOKEN_API=process.env.MOVIT_CONVITE_TOKEN||'';
  r=await call('POST','/api/demo/convites',{body:{nome:'Ana',empresa:'Expresso Convite',whatsapp:'19999990000'},ip:IPL});
  check('sem login MOVIT e sem token, não cria teste',r.status===401||r.status===403,'veio '+r.status);
  r=await call('POST','/api/demo/convites',{cookie:cookieA,body:{nome:'Ana',empresa:'Expresso Convite'},ip:IPL});
  check('cliente da demo não cria teste',r.status===403,'veio '+r.status);
  r=await call('POST','/api/demo/convites',{cookie:cookieAdm,body:{nome:'Ana Souza',empresa:'Expresso Convite',whatsapp:'(19) 99999-0000',modulos:['roteirizador','lotacao','frota']},ip:IPL});
  const linkEx=r.json?.link||'',tokEx=linkEx.split('/').pop(),cliEx=r.json?.cliente_id;
  check('MOVIT Central cria o teste com os módulos escolhidos e devolve o link e o WhatsApp',r.status===201&&/\/demo\/convite\/[A-Za-z0-9_-]{20,}$/.test(linkEx)&&/^https:\/\/wa\.me\/5519999990000\?text=/.test(r.json?.whatsapp_url||'')&&decodeURIComponent(r.json.whatsapp_url).includes(linkEx),r.status+' '+r.text.slice(0,300));
  const modsEx=(await db.query('SELECT module_key FROM movit_client_modules WHERE client_id=$1 AND enabled ORDER BY 1',[cliEx])).rows.map(x=>x.module_key);
  check('...só com os módulos marcados',JSON.stringify(modsEx)==='["frota","lotacao","roteirizador"]',JSON.stringify(modsEx));
  check('...e o token do link não fica guardado no banco',!(await db.query('SELECT 1 FROM movit_demo_convites WHERE token_hash=$1',[tokEx])).rowCount);
  r=await call('POST','/api/demo/convites',{cookie:cookieAdm,body:{nome:'Ana',empresa:'X',modulos:['nao_existe']},ip:IPL});
  check('módulo desconhecido -> 400',r.status===400,r.status+' '+r.text.slice(0,120));
  r=await call('GET','/demo/convite/'+tokEx);check('link abre a página do teste',r.status===200&&r.text.includes('Entrar sem o SSW'));
  r=await call('GET','/api/demo/convite/'+tokEx);
  check('página mostra a empresa e os módulos liberados, ainda sem modo',r.status===200&&r.json?.empresa==='Expresso Convite'&&r.json.modo===null&&(r.json.modulos||[]).includes('Frota'),r.text.slice(0,200));
  r=await call('GET','/api/demo/convite/'+'x'.repeat(32));check('link inválido -> 404',r.status===404,'veio '+r.status);
  const sE0=await stats();
  r=await call('POST','/api/demo/convite/'+tokEx+'/entrar',{body:{},ip:IPL});const cookieEx=r.cookie;
  check('sem o SSW, entra na empresa de exemplo',r.status===200&&!!cookieEx&&r.json?.modo==='exemplo'&&r.json?.user?.demo===true,r.status+' '+r.text.slice(0,200));
  check('...vendo só os módulos marcados',JSON.stringify(r.json?.user?.client_modules)==='["lotacao","roteirizador","frota"]',JSON.stringify(r.json?.user?.client_modules));
  const rowEx=(await db.query('SELECT s.exemplo,s.dominio,c.trial_ends_at FROM movit_client_ssw s JOIN movit_clients c ON c.id=s.client_id WHERE s.client_id=$1',[cliEx])).rows[0];
  check('...marcada como exemplo e com o teste grátis contando a partir de agora',rowEx?.exemplo===true&&rowEx.dominio==='EX-'+cliEx&&!!rowEx.trial_ends_at,JSON.stringify(rowEx));
  r=await call('GET','/coletas/api/coletas',{cookie:cookieEx});
  check('empresa de exemplo já abre a Lotação com coletas fictícias',r.status===200&&Array.isArray(r.json)&&r.json.length===8&&r.json.some(c=>c.status==='Em trânsito'),r.status+' '+r.text.slice(0,200));
  r=await call('GET','/api/painel/frota-state',{cookie:cookieEx});
  check('...a Frota com veículos, abastecimentos e motoristas',r.status===200&&(r.json?.data?.vehicles||[]).length===7&&(r.json.data.fuel||[]).length===21&&(r.json.data.people||[]).length===7,r.status+' '+r.text.slice(0,200));
  check('...e as contas a pagar e as despesas do DRE no esquema dela',(await db.query('SELECT count(*)::int n FROM t'+cliEx+'.bills')).rows[0].n===8&&(await db.query('SELECT count(*)::int n FROM t'+cliEx+'.dre_lancamentos')).rows[0].n===27);
  r=await call('GET','/coletas/api/coletas',{cookie:cookieA});check('os números de exemplo não aparecem para a empresa A',r.status===200&&!(r.json||[]).some(c=>/ATACADO NOVA ERA/.test(c.destinatario||'')),r.text.slice(0,200));
  r=await call('GET','/api/programacao-entregas/disponiveis',{cookie:cookieEx});
  const ctrcsEx=(r.json?.rows||[]).map(x=>x.ctrc);
  check('telas do SSW da empresa de exemplo mostram números fictícios do SSW de exemplo',r.status===200&&ctrcsEx.length>0&&ctrcsEx.every(c=>/^(MTZ|FIL)0[56]\d{4}-\d$/.test(c)),r.status+' '+r.text.slice(0,240));
  r=await call('GET','/api/programacao-entregas/disponiveis',{cookie:cookieAdm});
  const ctrcsAdm=(r.json?.rows||[]).map(x=>x.ctrc);
  check('administrador MOVIT na demo também vê só o SSW de exemplo (nada da CONSTRULOG)',r.status===200&&ctrcsAdm.length>0&&ctrcsAdm.every(c=>/^(MTZ|FIL)0[56]\d{4}-\d$/.test(c)),r.status+' '+r.text.slice(0,240));
  const sE1=await stats();
  check('...sem nenhum login no SSW (nem no de teste)',sE1.logins===sE0.logins,JSON.stringify({antes:sE0.logins,depois:sE1.logins}));
  r=await call('GET','/api/lancamentos',{cookie:cookieEx});check('módulo não liberado fica fechado (Lançamentos -> 403)',r.status===403,'veio '+r.status);
  r=await call('GET','/api/demo/convite/'+tokEx);check('abrindo o link de novo, a página sabe que está no exemplo',r.json?.modo==='exemplo',r.text.slice(0,160));
  r=await call('POST','/api/demo/convite/'+tokEx+'/entrar',{body:{ssw:{dominio:'tst',cpf:'12345678901',usuario:'joao',senha:'x'}},ip:IPL});
  check('domínio do SSW de outro teste -> 409',r.status===409,r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/demo/convite/'+tokEx+'/entrar',{body:{ssw:{dominio:'EXC',cpf:'11122233344',usuario:'ana',senha:'senha-errada'}},ip:IPL});
  check('senha do SSW recusada -> 401 e continua no exemplo',r.status===401&&(await db.query('SELECT exemplo FROM movit_client_ssw WHERE client_id=$1',[cliEx])).rows[0]?.exemplo===true,r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/demo/convite/'+tokEx+'/entrar',{body:{ssw:{dominio:'EXC',cpf:'111.222.333-44',usuario:'Ana',senha:'segredo-exc',unidades:'MTZ'}},ip:IPL});const cookieExS=r.cookie;
  const rowExS=(await db.query('SELECT exemplo,dominio,usuario,senha_cifrada FROM movit_client_ssw WHERE client_id=$1',[cliEx])).rows[0];
  check('com o login do SSW, a mesma empresa passa a ler o SSW real dela',r.status===200&&r.json?.modo==='ssw'&&rowExS?.exemplo===false&&rowExS.dominio==='EXC'&&rowExS.usuario==='ana'&&!rowExS.senha_cifrada.includes('segredo'),r.status+' '+JSON.stringify(rowExS||{}).slice(0,200));
  r=await call('GET','/coletas/api/coletas',{cookie:cookieExS});
  check('...e começa sem os números de exemplo, para lançar os dados dela',r.status===200&&Array.isArray(r.json)&&r.json.length===0,r.status+' '+r.text.slice(0,200));
  const sE2=await stats();
  r=await call('GET','/api/ssw/conexao',{cookie:cookieExS});const sE3=await stats();
  check('...entrando no SSW com o login dela',r.json?.conectado===true&&sE3.logins===sE2.logins+1&&sE3.ultimoLogin?.dominio==='EXC',r.text.slice(0,160)+' '+JSON.stringify(sE3.ultimoLogin));
  if(TOKEN_API){
    r=await call('POST','/api/demo/convites',{body:{nome:'Bruno',empresa:'Pedido Pelo Site',whatsapp:'5511988887777'},ip:IPL,auth:'Bearer '+TOKEN_API});
    const cvT=r.json?.cliente_id&&(await db.query('SELECT origem FROM movit_demo_convites WHERE client_id=$1',[r.json.cliente_id])).rows[0];
    check('painel da Torre MOVIT cria o teste com o token (todos os módulos)',r.status===201&&cvT?.origem==='torre'&&(r.json.modulos||[]).length>=10,r.status+' '+r.text.slice(0,200));
    r=await call('POST','/api/demo/convites',{body:{nome:'Bruno',empresa:'X'},ip:IPL,auth:'Bearer '+'y'.repeat(TOKEN_API.length)});
    check('token errado -> 401',r.status===401,'veio '+r.status);
  }

  await db.end();
  console.log('\nResultado demo: '+pass+' OK, '+fail+' falha(s)');process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
