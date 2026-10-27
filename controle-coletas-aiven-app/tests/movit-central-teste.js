// MOVIT Central da Construlog (produção, sem MOVIT_DEMO): envio do teste sem sair da tela.
// As chamadas vão para a versão de teste (MOVIT_DEMO_URL); aqui ela é um servidor de mentira
// local que primeiro responde como o Render acordando (503 em HTML) e depois em JSON.
// Pré-requisitos: servidor iniciado com MOVIT_DEMO_URL=http://127.0.0.1:<DEMO_FALSA_PORT>,
//   MOVIT_CENTRAL_TOKEN (32+ caracteres), MOVIT_DEMO_INTERVALO_MS e MOVIT_DEMO_ESPERA_MS curtos.
const http=require('http');
const B=process.env.BASE_URL||'http://127.0.0.1:10000',PORTA=Number(process.env.DEMO_FALSA_PORT||10777);
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const TOKEN=process.env.MOVIT_CENTRAL_TOKEN||'';
if(/onrender\.com/i.test(B)){console.error('Recusado: BASE_URL parece ser a produção.');process.exit(2)}
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,extra);if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name+' '+extra).replace(/\r?\n/g,' ').slice(0,300))}}
async function call(method,p,{body,cookie}={}){
  const h={};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;
  const r=await fetch(B+p,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});
  const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}
  return{status:r.status,json,text,cookie:((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0]};
}
const pedidos=[];let acordando=2;
const falsa=http.createServer((req,res)=>{
  let corpo='';req.on('data',c=>corpo+=c);req.on('end',()=>{
    pedidos.push({metodo:req.method,url:req.url,auth:req.headers.authorization||'',corpo});
    if(acordando>0){acordando--;res.writeHead(503,{'Content-Type':'text/html'});res.end('<html>acordando</html>');return}
    const j=(s,o)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
    if(req.url==='/api/demo/info')return j(200,{ok:true,demo:true,modulos:[{key:'lotacao',name:'Lotação'},{key:'frota',name:'Frota'}]});
    if(req.url==='/api/demo/convites'&&req.method==='POST'){const b=JSON.parse(corpo||'{}');return j(201,{ok:true,link:'https://teste/demo/convite/abc',modulos:b.modulos,dias:b.dias})}
    if(req.url==='/api/demo/convites')return j(200,{ok:true,testes:[{empresa:'Transportes X',modulos:2}]});
    if(req.url==='/api/demo/modulos-site')return j(200,{ok:true,modulos:req.method==='PUT'?JSON.parse(corpo).modulos:['lotacao']});
    j(404,{ok:false});
  });
});
(async()=>{
  await new Promise(ok=>falsa.listen(PORTA,'127.0.0.1',ok));
  console.log('MOVIT Central: envio do teste pela versão de teste');
  let r=await call('GET','/api/movit-central/teste/info');
  check('sem login -> 401',r.status===401,'veio '+r.status);
  check('...e nada chega à versão de teste',pedidos.length===0,JSON.stringify(pedidos));
  r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});const cookie=r.cookie;
  check('login do administrador',r.status===200&&!!cookie,r.text.slice(0,100));
  r=await call('GET','/api/movit-central/teste/info',{cookie});
  check('enquanto a versão de teste acorda (503 em HTML), tenta de novo e devolve os módulos',r.status===200&&(r.json?.modulos||[]).length===2&&pedidos.length===3,r.status+' '+r.text.slice(0,160)+' pedidos='+pedidos.length);
  check('...com o token da MOVIT Central',pedidos.every(p=>p.auth==='Bearer '+TOKEN),JSON.stringify(pedidos.map(p=>p.auth.slice(0,12))));
  r=await call('POST','/api/movit-central/teste/convites',{cookie,body:{nome:'Ana',empresa:'Transportes X',whatsapp:'19999990000',dias:10,modulos:['lotacao','frota']}});
  check('gera o link do teste na versão de teste, com dias e módulos',r.status===201&&r.json?.dias===10&&JSON.stringify(r.json?.modulos)==='["lotacao","frota"]'&&/convite/.test(r.json?.link||''),r.status+' '+r.text.slice(0,160));
  r=await call('GET','/api/movit-central/teste/convites',{cookie});
  check('lista os testes enviados',r.status===200&&r.json?.testes?.[0]?.empresa==='Transportes X',r.text.slice(0,160));
  r=await call('PUT','/api/movit-central/teste/modulos-site',{cookie,body:{modulos:['frota']}});
  check('salva os módulos de quem pede pelo site',r.status===200&&JSON.stringify(r.json?.modulos)==='["frota"]',r.text.slice(0,160));
  r=await call('DELETE','/api/movit-central/teste/convites',{cookie});
  check('método não suportado -> 405',r.status===405,'veio '+r.status);
  const antes=pedidos.length;falsa.close();
  r=await call('GET','/api/movit-central/teste/info',{cookie});
  check('versão de teste fora do ar -> 503 com aviso, sem travar',r.status===503&&/não respondeu/.test(r.json?.error||''),r.status+' '+r.text.slice(0,160));
  check('...e o pedido não foi a lugar nenhum além dela',pedidos.length===antes);
  console.log('\nResultado MOVIT Central teste: '+pass+' OK, '+fail+' falha(s)');process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
