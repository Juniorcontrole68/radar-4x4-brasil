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
async function call(method,p,{body,cookie}={}){
  const h={};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;
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
  check('usuário marcado como cliente da demo, só com os módulos prontos',r.json?.user?.demo===true&&JSON.stringify(r.json?.user?.client_modules)==='["roteirizador","agendamento","usuarios","dashboards"]',JSON.stringify(r.json?.user||{}).slice(0,300));
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
  r=await call('GET','/api/agendamento-teste/nf?nf=30101',{cookie:cookieA});
  check('Agendamento acha a NF no SSW da empresa (CTRC e cidade)',r.status===200&&r.json?.row?.ctrc==='MTZ000501-1'&&r.json?.row?.cidade==='CAMPINAS',r.status+' '+r.text.slice(0,240));
  r=await call('POST','/api/agendamento-teste',{cookie:cookieA,body:{nf:'30101',ctrc:'MTZ000501-1',cliente:'LOJA CENTRO',cidade:'CAMPINAS',uf:'SP',agendado:true,data_agendamento:'2026-10-20'}});
  check('Agendamento grava o agendamento da empresa',r.status===201&&r.json?.row?.nf==='30101',r.status+' '+r.text.slice(0,200));
  r=await call('GET','/api/agendamento-teste',{cookie:cookieA});
  check('Agendamento lista o agendamento gravado',r.status===200&&(r.json?.rows||[]).length===1&&r.json.rows[0].nf==='30101',r.status+' '+r.text.slice(0,200));

  r=await call('GET','/api/auth/me',{cookie:cookieA});
  check('Dashboards liberado na demo só com os cards do SSW da empresa',(r.json?.user?.demo_telas||[]).includes('dashboards')&&JSON.stringify((r.json?.user?.demo_perms||[]).slice().sort())===JSON.stringify(['agendamentos','evolucao','roteirizador','ssw_saidas']),JSON.stringify(r.json?.user||{}).slice(0,400));
  r=await call('GET','/api/evolucao-motoristas',{cookie:cookieA});
  const motsA=(r.json?.motoristas38||[]).map(x=>x.motorista).sort();
  check('Evolução por Motorista lê a opção 38 nas unidades da empresa A (MTZ e CPS)',r.status===200&&JSON.stringify(motsA)===JSON.stringify(['CARLOS DEMO MTZ','PAULO DEMO CPS']),r.status+' '+r.text.slice(0,300));
  r=await call('GET','/api/bi2/saidas-baixas',{cookie:cookieA});
  check('Saídas x Baixas responde com os romaneios das unidades da empresa A',r.status===200&&/CARLOS DEMO MTZ/.test(r.text)&&/PAULO DEMO CPS/.test(r.text)&&!/JAILSON|ROGER TESTE/.test(r.text),r.status+' '+r.text.slice(0,300));

  console.log('C. O que ainda não está pronto fica fechado para o cliente da demo');
  for(const p of ['/api/roteirizador/lista','/api/ssw/sessoes','/api/lancamentos','/api/tracking/live','/api/sheet/base','/api/bi2/receita','/api/bi2/atrasos','/api/sheet/agendamentos','/api/ssw/cidades-mapa'])
  {r=await call('GET',p,{cookie:cookieA});check('GET '+p+' -> 403',r.status===403,'veio '+r.status+' '+r.text.slice(0,120))}
  for(const p of ['/coletas/api/coletas','/api/bills','/api/painel/carregamentos-finais','/api/painel/nf-materiais','/api/painel/frota-state','/api/movit-central/clients','/api/painel/tracking/live'])
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
  r=await call('GET','/api/agendamento-teste',{cookie:cookieB});
  check('Agendamento da empresa B não mostra os agendamentos da empresa A',r.status===200&&!(r.json?.rows||[]).length,r.status+' '+r.text.slice(0,200));
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
  r=await call('GET','/api/ssw/conexao',{cookie:cookieAdm});
  check('administrador não usa o SSW de nenhuma empresa da demo',r.json?.dominio!=='TST'&&r.json?.dominio!=='XYZ',r.text.slice(0,200));

  console.log('G. Passo a passo e vídeos');
  r=await call('POST','/api/demo/entrar',{body:EMPRESA_A});const cookieG=r.cookie;
  r=await call('GET','/api/guia',{cookie:cookieG});
  const passosIds=(r.json?.passos||[]).map(p=>p.id);
  check('passo a passo da demo: conexão SSW primeiro, depois só os módulos liberados',r.status===200&&passosIds[0]==="ssw"&&passosIds.includes("usuarios")&&passosIds.includes("roteirizador")&&!passosIds.includes("coletas")&&!passosIds.includes("frota"),JSON.stringify(passosIds));
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
  let lg=await logoDe('');check('sem sessão, o logo é o da MOVIT',lg.status===200&&/svg/.test(lg.tipo)&&lg.corpo.toString().includes('<svg'),lg.status+' '+lg.tipo);
  r=await call('GET','/api/auth/me',{cookie:cookieG});check('empresa sem logo: painel sabe que é o da MOVIT',r.json?.user?.client?.has_logo===false,JSON.stringify(r.json?.user?.client||{}).slice(0,200));
  lg=await logoDe(cookieG);check('empresa sem logo recebe o logo da MOVIT',/svg/.test(lg.tipo));
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
  lg=await logoDe(cookieB);check('empresa B continua com o logo da MOVIT (não vê o logo da A)',/svg/.test(lg.tipo),lg.tipo);
  r=await call('DELETE','/api/empresa/logo',{cookie:cookieG});lg=await logoDe(cookieG);
  check('remover volta ao logo da MOVIT',r.status===200&&/svg/.test(lg.tipo),r.status+' '+lg.tipo);
  const EMPRESA_C={empresa:'Cargas Teste C',dominio:'LGC',cpf:'11122233344',usuario:'ana',senha:'segredo-c-3',unidades:'MTZ'};
  r=await call('POST','/api/demo/entrar',{body:{...EMPRESA_C,logo:'data:image/gif;base64,'+Buffer.from('nada').toString('base64')}});
  check('entrada da demo com logo inválido mostra o erro do logo',r.status===400&&/imagem/i.test(r.json?.error||''),r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/demo/entrar',{body:{...EMPRESA_C,logo:PNG1}});const cookieC=r.cookie;
  lg=await logoDe(cookieC);check('logo enviado junto com o login do SSW já aparece no painel',r.status===200&&lg.tipo==='image/png',r.status+' '+lg.tipo+' '+r.text.slice(0,160));

  console.log('I. Reinício do servidor não transforma cliente da demo em administrador MOVIT');
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
    check('...e continua cliente da demo, só com os módulos prontos',me.demo===true&&me.is_platform_admin===false&&me.is_admin===true&&JSON.stringify(me.client_modules)==='["roteirizador","agendamento","usuarios"]',JSON.stringify(me).slice(0,300));
    const y=await fetch('http://127.0.0.1:'+P2+'/api/lancamentos',{headers:{Cookie:cookieG}});
    check('...e o que não está pronto continua fechado (Lançamentos -> 403)',y.status===403,'veio '+y.status);
    const adm=(await db.query('SELECT is_platform_admin FROM dashboard_users WHERE lower(username)=lower($1)',[ADMIN_USER])).rows[0];
    check('administrador MOVIT continua administrador MOVIT',adm?.is_platform_admin===true);
  }finally{try{process.kill(-srv2.pid,'SIGTERM')}catch{}}

  await db.end();
  console.log('\nResultado demo: '+pass+' OK, '+fail+' falha(s)');process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
