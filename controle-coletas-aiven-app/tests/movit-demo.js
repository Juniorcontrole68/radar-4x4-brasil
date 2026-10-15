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
  check('usuário marcado como cliente da demo, só com os módulos prontos',r.json?.user?.demo===true&&JSON.stringify(r.json?.user?.client_modules)==='["roteirizador","usuarios"]',JSON.stringify(r.json?.user||{}).slice(0,300));
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

  console.log('C. O que ainda não está pronto fica fechado para o cliente da demo');
  for(const p of ['/api/roteirizador/lista','/api/ssw/sessoes','/api/lancamentos','/api/tracking/live','/api/sheet/base','/api/bi2/receita'])
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
  check('Roteirizador da empresa B não recebe os CTRCs da empresa A',!(r.json?.rows||[]).some(x=>/^(MTZ|CPS)/.test(x.ctrc)),r.status+' '+r.text.slice(0,200));
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

  await db.end();
  console.log('\nResultado demo: '+pass+' OK, '+fail+' falha(s)');process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
