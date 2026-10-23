// Torre Docs: app do Compartilhar do Android (manifesto com share_target, service worker e a tela),
// e as rotas que a tela usa para salvar o PDF na coleta ou na conta pessoal.
// Roda contra o servidor em TEST_MODE (banco vazio), como tests/e2e.js. Nunca rode contra a produção.
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
if(/onrender\.com/i.test(B)&&!/teste/i.test(B)){console.error('Recusado: BASE_URL parece ser a produção.');process.exit(2)}
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name).replace(/[\r\n]+/g,' '))}}
async function call(method,path,{body,cookie,raw,headers={}}={}){
  const h={...headers};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;
  const r=await fetch(B+path,{method,headers:h,body:raw!==undefined?raw:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});
  const buf=Buffer.from(await r.arrayBuffer()),text=buf.toString('utf8');let json=null;try{json=JSON.parse(text)}catch{}
  return{status:r.status,json,text,buf,headers:r.headers}
}
const PDF='data:application/pdf;base64,'+Buffer.from('%PDF-1.4\n% teste Torre Docs\n%%EOF\n').toString('base64');

(async()=>{
  console.log('App instalável');
  let r=await call('GET','/compartilhar/manifest.json');
  const m=r.json||{};
  check('manifesto responde como application/manifest+json',r.status===200&&/manifest\+json/.test(r.headers.get('content-type')||''),r.status);
  check('manifesto tem share_target POST multipart com o campo arquivo aceitando PDF',m.share_target?.method==='POST'&&m.share_target?.enctype==='multipart/form-data'
    &&m.share_target?.action==='/compartilhar/receber'&&m.share_target?.params?.files?.[0]?.name==='arquivo'&&m.share_target.params.files[0].accept.includes('application/pdf'),JSON.stringify(m.share_target));
  check('manifesto instalável (standalone, escopo, ícones 192 e 512)',m.display==='standalone'&&m.scope==='/compartilhar/'&&m.start_url==='/compartilhar/'
    &&['192x192','512x512'].every(s=>m.icons?.some(i=>i.sizes===s&&i.type==='image/png')));
  for(const i of m.icons||[]){r=await call('GET',i.src);check('ícone '+i.sizes+' é PNG',r.status===200&&r.buf.slice(1,4).toString()==='PNG')}
  r=await call('GET','/compartilhar/sw.js');
  check('service worker guarda o arquivo compartilhado e volta para a tela',r.status===200&&r.headers.get('service-worker-allowed')==='/compartilhar/'
    &&r.text.includes("formData()")&&r.text.includes("f.get('arquivo')")&&r.text.includes('?recebido=1'));
  let sintaxe='';try{new Function(r.text)}catch(e){sintaxe=e.message}
  check('service worker sem erro de sintaxe',!sintaxe,sintaxe);
  r=await call('GET','/compartilhar/');
  check('tela abre sem login (o login é feito nela)',r.status===200&&r.text.includes('rel="manifest" href="/compartilhar/manifest.json"')&&r.text.includes("register('/compartilhar/sw.js'"));
  check('tela usa as rotas de documento da coleta e das contas',r.text.includes('/api/painel/coletas-documentos/')&&r.text.includes("'/api/bills/'+id+'/document/'")&&r.text.includes("'/api/bills/'+id+'/pay'"));
  r=await call('GET','/compartilhar');check('/compartilhar sem barra também abre',r.status===200);
  const fd=new FormData();fd.append('arquivo',new Blob([Buffer.from('%PDF-1.4')],{type:'application/pdf'}),'doc.pdf');
  r=await fetch(B+'/compartilhar/receber',{method:'POST',body:fd,redirect:'manual'});
  check('sem service worker o envio volta para a tela com o aviso',r.status===303&&/\/compartilhar\/\?sem_sw=1$/.test(r.headers.get('location')||''),r.status+' '+r.headers.get('location'));

  console.log('Salvar na coleta e na conta pessoal (o que a tela faz)');
  r=await call('POST','/api/painel/coletas-documentos/1',{body:{tipo:'cavalo',arquivo:PDF,nome_arquivo:'crlv.pdf'}});
  check('sem login não salva documento',r.status===401,'veio '+r.status);
  r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});
  const cookie=((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];check('login',!!cookie);
  r=await call('POST','/coletas/api/coletas',{cookie,body:{cliente:'Cliente Docs',endereco_entrega:'Rua de Teste, 1',data_carregamento:'2026-10-23',motorista:'MOTORISTA DOCS',placa:'DOC1A23',tipo_caminhao:'Carreta',implemento:'Baú'}});
  const col=r.json?.id;check('coleta criada',r.status===201&&!!col,r.text.slice(0,200));
  for(const tipo of ['motorista','cavalo','carreta']){
    r=await call('POST','/api/painel/coletas-documentos/'+col,{cookie,body:{tipo,arquivo:PDF,nome_arquivo:tipo+'.pdf'}});
    check('salva o PDF como documento do '+tipo,r.status===201&&r.json?.tipo===tipo,r.text.slice(0,200));
  }
  r=await call('GET','/api/painel/coletas-documentos/'+col,{cookie});
  check('a coleta lista os três documentos',['motorista','cavalo','carreta'].every(t=>r.json?.rows?.some(x=>x.tipo===t)),r.text.slice(0,300));
  r=await call('GET','/api/painel/coletas-documentos/'+col+'/cavalo',{cookie});
  check('o PDF do cavalo abre igual ao enviado',r.status===200&&r.buf.toString().startsWith('%PDF-1.4'));

  r=await call('POST','/api/bills',{cookie,body:{description:'Conta de luz',amount:187.4,dueDate:'2026-11-10',area:'Pessoal',category:'Outros'}});
  const nova=r.json?.ids?.[0];check('nova conta pessoal',r.status===201&&!!nova,r.text.slice(0,200));
  r=await call('POST','/api/bills/'+nova+'/document/boleto',{cookie,body:{fileName:'luz.pdf',mimeType:'application/pdf',dataUrl:PDF}});
  check('boleto salvo na conta pessoal',r.status<300,r.status+' '+r.text.slice(0,200));
  r=await call('POST','/api/bills/'+nova+'/document/comprovante',{cookie,body:{fileName:'pago.pdf',mimeType:'application/pdf',dataUrl:PDF}});
  check('comprovante salvo',r.status<300,r.status+' '+r.text.slice(0,200));
  r=await call('POST','/api/bills/'+nova+'/pay',{cookie});check('dar baixa na conta',r.status<300,'veio '+r.status);
  r=await call('GET','/api/bills',{cookie});
  const b=(r.json||[]).find(x=>x.id===nova);
  check('conta fica paga com boleto e comprovante',b?.status==='paid'&&!!b.has_boleto&&!!b.has_comprovante&&b.area==='Pessoal',JSON.stringify(b||{}).slice(0,300));

  console.log(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail?1:0)
})().catch(e=>{console.error(e);process.exit(1)});
