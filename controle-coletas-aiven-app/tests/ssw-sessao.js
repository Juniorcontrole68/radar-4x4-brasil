// Verifica que o servidor reaproveita a sessão do SSW em vez de fazer login a cada consulta.
// Roda contra o SSW de mentira (tests/apoio/ssw-falso.js); nunca toca no SSW real.
// Pré-requisitos: servidor iniciado SEM TEST_MODE, com credenciais SSW fictícias e
//   NODE_OPTIONS="--require tests/apoio/sem-rede.js --require tests/apoio/ssw-desvio.js"
const B=process.env.BASE_URL||'http://127.0.0.1:10000',M='http://127.0.0.1:'+(process.env.MOCK_PORT||10555);
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const stats=async()=>(await fetch(M+'/__mock/stats')).json();
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,extra)}}
(async()=>{
  let r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:ADMIN_USER,password:ADMIN_PASS})});
  const cookie=((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];
  check('login',!!cookie);
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const lista=async()=>(await fetch(B+'/api/roteirizador/lista?date='+today,{headers:{Cookie:cookie}})).json();
  await sleep(9000);                                   // leituras de inicialização
  const s0=await stats();
  const N=4;let last=null;
  for(let i=0;i<N;i++){last=await lista();await sleep(11000)}   // 11 s > validade de 10 s da leitura rápida
  await sleep(2000);
  const s1=await stats();
  const nomes=(last.rows||[]).map(x=>x.motorista+'|'+x.veiculo+'|'+(x.romaneios||[]).join(',')).sort();
  check('lista traz os 3 motoristas, cada um com a placa e o romaneio da sua unidade',
    JSON.stringify(nomes)===JSON.stringify(['FABIANO TESTE|FAB1A23|AMR001057-1','JAILSON MOREIRA DE SOUZA|EYV3626|AMR001056-1','ROGER TESTE|TBT9Z99|TBT000321-1']),JSON.stringify(nomes));
  check('em '+N+' consultas seguidas: no máximo 3 logins (antes: 3 por consulta) — foram '+(s1.logins-s0.logins),s1.logins-s0.logins<=3);
  await fetch(M+'/__mock/expire');await sleep(11000);
  const x=await lista();await sleep(4000);const s2=await stats();
  check('sessões derrubadas no SSW: a lista continua completa',(x.rows||[]).length===3,'linhas='+(x.rows||[]).length);
  check('  ...com um login novo por fluxo, no máximo 3 — foram '+(s2.logins-s1.logins),s2.logins-s1.logins>=1&&s2.logins-s1.logins<=3);
  await sleep(11000);await lista();await sleep(3000);const s3=await stats();
  check('consulta seguinte volta a reaproveitar (0 logins) — foram '+(s3.logins-s2.logins),s3.logins-s2.logins===0);
  check('nada foi enviado à tela de login além dos logins',s3.recusados===0,'recusados='+s3.recusados);
  r=await fetch(B+'/api/ssw/sessoes',{headers:{Cookie:cookie}});const j=await r.json();
  check('contador /api/ssw/sessoes confere com o SSW de teste ('+j.logins+' logins, '+j.reused+' reaproveitamentos)',r.status===200&&j.logins===s3.logins&&j.reused>0,JSON.stringify(j).slice(0,200));
  r=await fetch(B+'/api/ssw/sessoes');check('contador exige login',r.status===401,'veio '+r.status);
  console.log('\nResultado SSW: '+pass+' OK, '+fail+' falha(s)');process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
