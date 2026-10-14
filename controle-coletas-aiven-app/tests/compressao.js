// Economia de banda: respostas de texto comprimidas, 304 quando o navegador já tem a mesma versão,
// e arquivos binários / eventos contínuos passando sem mudança. Não usa banco nem a produção.
const http=require('http'),zlib=require('zlib');
const {economizarBanda}=require('../compressao');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name).replace(/[\r\n]+/g,' '))}}
const GRANDE=JSON.stringify({ok:true,rows:Array.from({length:400},(_,i)=>({id:i,cliente:'Cliente de teste '+i,cidade:'Americana/SP'}))});
const BIN=Buffer.alloc(5000,7);
const srv=http.createServer((req,res)=>{
  economizarBanda(req,res);
  if(req.url==='/json'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache'});return res.end(GRANDE)}
  if(req.url==='/pequeno'){res.setHeader('Content-Type','application/json');return res.end('{"ok":true}')}
  if(req.url==='/proxy'){res.writeHead(200,{'content-type':'text/html','transfer-encoding':'chunked'});res.write('<p>'+'x'.repeat(3000));return setTimeout(()=>res.end('</p>'),5)}
  if(req.url==='/apk'){res.writeHead(200,{'Content-Type':'application/vnd.android.package-archive'});res.write(BIN.subarray(0,2000));return res.end(BIN.subarray(2000))}
  if(req.url==='/sse'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: 1\n\n');return setTimeout(()=>res.end('data: 2\n\n'),5)}
  if(req.url==='/erro'){res.writeHead(500,{'Content-Type':'text/plain'});return res.end('falhou '+'y'.repeat(2000))}
  if(req.url==='/cache'){res.writeHead(200,{'Content-Type':'text/css','Cache-Control':'public, max-age=60'});return res.end('a{}'.repeat(500))}
  res.writeHead(404,{'Content-Type':'text/plain'});res.end('nada')
});
function pedir(path,headers={},method='GET'){return new Promise((ok,ko)=>{const r=http.request({host:'127.0.0.1',port:srv.address().port,path,method,headers},res=>{const p=[];res.on('data',c=>p.push(c));res.on('end',()=>ok({status:res.statusCode,h:res.headers,body:Buffer.concat(p)}))});r.on('error',ko);r.end()})}
srv.listen(0,'127.0.0.1',async()=>{
  try{
    console.log('Compressão');
    let r=await pedir('/json',{'accept-encoding':'gzip, deflate, br'});
    check('JSON grande vai comprimido em brotli',r.h['content-encoding']==='br',r.h);
    check('  ...e volta igual ao original',zlib.brotliDecompressSync(r.body).toString()===GRANDE);
    check('  ...e encolhe mais de 5 vezes',r.body.length*5<Buffer.byteLength(GRANDE),r.body.length+' de '+Buffer.byteLength(GRANDE));
    check('  ...Content-Length confere',Number(r.h['content-length'])===r.body.length);
    check('  ...Vary: Accept-Encoding',/accept-encoding/i.test(r.h.vary||''));
    check('  ...no-store vira private, no-cache (sempre confere com o servidor)',r.h['cache-control']==='private, no-cache'&&!r.h.pragma,r.h);
    const etag=r.h.etag;check('  ...com ETag',/^"[A-Za-z0-9_-]{27}"$/.test(etag||''),etag);
    r=await pedir('/json',{'accept-encoding':'gzip'});
    check('só gzip aceito: vai gzip',r.h['content-encoding']==='gzip'&&zlib.gunzipSync(r.body).toString()===GRANDE);
    r=await pedir('/json');
    check('navegador sem compressão recebe o texto puro',!r.h['content-encoding']&&r.body.toString()===GRANDE);
    r=await pedir('/pequeno',{'accept-encoding':'gzip'});
    check('resposta pequena não é comprimida',!r.h['content-encoding']&&r.body.toString()==='{"ok":true}');
    r=await pedir('/proxy',{'accept-encoding':'gzip'});
    check('resposta repassada em partes (proxy do dashboard) chega inteira e comprimida',r.h['content-encoding']==='gzip'&&zlib.gunzipSync(r.body).toString()==='<p>'+'x'.repeat(3000)+'</p>'&&!r.h['transfer-encoding'],r.h);
    r=await pedir('/cache',{'accept-encoding':'gzip'});
    check('Cache-Control definido pela rota é mantido',r.h['cache-control']==='public, max-age=60');

    console.log('Reaproveitar o que não mudou (304)');
    r=await pedir('/json',{'accept-encoding':'br','if-none-match':etag});
    check('mesma versão: 304 sem corpo',r.status===304&&r.body.length===0,r.status);
    r=await pedir('/json',{'if-none-match':'W/'+etag+', "outro"'});
    check('  ...também com ETag fraco numa lista',r.status===304);
    r=await pedir('/json',{'if-none-match':'"versao-antiga"'});
    check('versão diferente: manda o conteúdo novo',r.status===200&&r.body.toString()===GRANDE);

    console.log('Passa sem mudança');
    r=await pedir('/apk',{'accept-encoding':'gzip'});
    check('arquivo binário (APK) vai como está',!r.h['content-encoding']&&!r.h.etag&&Buffer.compare(r.body,BIN)===0);
    r=await pedir('/sse',{'accept-encoding':'gzip'});
    check('eventos contínuos não são guardados nem comprimidos',!r.h['content-encoding']&&r.body.toString()==='data: 1\n\ndata: 2\n\n');
    r=await pedir('/erro',{'accept-encoding':'gzip'});
    check('erro do servidor vai como está',r.status===500&&!r.h['content-encoding']);
    r=await pedir('/json',{'accept-encoding':'gzip'},'HEAD');
    check('HEAD não é alterado',r.status===200&&r.body.length===0&&!r.h['content-encoding']);
    r=await pedir('/nada',{'accept-encoding':'gzip'});
    check('404 continua 404',r.status===404&&r.body.toString()==='nada');
  }catch(e){check('sem erro inesperado',false,String(e.stack||e))}
  srv.close();
  console.log('\n'+pass+' ok, '+fail+' falha(s)');process.exit(fail?1:0)
});
