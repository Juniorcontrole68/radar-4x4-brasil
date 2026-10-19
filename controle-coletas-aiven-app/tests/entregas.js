// Comprovante de entrega pelo MOVIT: o motorista marca a entrega com foto (ou o motivo de não ter
// entregue), a rota do dia mostra o que já foi feito e a central vê os comprovantes em /entregas.
// Roda contra o servidor em TEST_MODE (banco vazio), como tests/e2e.js. Nunca rode contra a produção.
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
if(/onrender\.com/i.test(B)&&!/teste/i.test(B)){console.error('Recusado: BASE_URL parece ser a produção.');process.exit(2)}
const en=require('../entregas');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name).replace(/[\r\n]+/g,' '))}}
async function call(method,path,{body,cookie,bearer}={}){
  const h={};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;if(bearer)h.Authorization='Bearer '+bearer;
  const r=await fetch(B+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});
  const buf=Buffer.from(await r.arrayBuffer()),text=buf.toString('utf8');let json=null;try{json=JSON.parse(text)}catch{}
  return{status:r.status,json,text,buf,headers:r.headers}
}
const hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
// JPEG mínimo de verdade (cabeçalho FF D8 ... FF D9): o servidor confere o conteúdo, não só o nome.
const JPEG=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');
const foto='data:image/jpeg;base64,'+JPEG.toString('base64');

(async()=>{
  console.log('Regras (sem rede)');
  check('chave da parada pelo CT-e',en.chaveParada({ctrc:'amr 123',nf:'55'})==='ctrc:AMR 123');
  check('  ...pela NF (sem zeros à esquerda) e romaneio',en.chaveParada({nf:'0001002',romaneio:'amr000002'})==='nf:1002@AMR000002');
  check('  ...pela posição quando não há documento',en.chaveParada({lat:-22.74,lon:-47.33})==='pos:-22.74000,-47.33000');
  check('  ...sem nada, sem chave',en.chaveParada({})==='');
  check('foto JPEG reconhecida pelo conteúdo',en.lerImagem(foto,1e6)?.mime==='image/jpeg');
  check('texto qualquer não passa como foto',en.lerImagem('data:image/jpeg;base64,'+Buffer.from('nao sou foto').toString('base64'),1e6)?.erro===true);
  check('foto grande demais é recusada',en.lerImagem(foto,10)?.erro===true);
  check('comprovante de hoje vale',en.dataValida(hoje));
  check('data no futuro não vale',!en.dataValida('2999-01-01'));

  console.log('Sem login');
  let r=await call('POST','/api/router-app/company/comprovante',{body:{}});check('comprovante sem vínculo do MOVIT -> 401',r.status===401,'veio '+r.status);
  r=await call('GET','/api/painel/entregas');check('lista da central sem login -> 401',r.status===401,'veio '+r.status);
  r=await call('GET','/entregas');check('tela da central sem login manda para o login',r.status===302&&/login=1/.test(r.headers.get('location')||''),'veio '+r.status);

  r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});
  const cookie=(r.headers.get('set-cookie')||'').split(';')[0];
  check('login do admin de teste',r.status===200&&!!cookie,r.status+' '+r.text.slice(0,120));

  console.log('Motorista no MOVIT com a rota do dia');
  const motorista='Motorista Entregas '+Date.now().toString(36);
  r=await call('POST','/api/painel/tracking/movit-simulacao',{cookie,body:{driver_name:motorista,vehicle_plate:'ENT1A23'}});
  r=await call('POST','/api/router-app/company/claim',{body:{code:r.json?.code}});const ctk=r.json?.company_token;
  check('MOVIT vinculado',r.status===200&&!!ctk,r.status+' '+r.text.slice(0,160));
  const paradas=[{lat:-22.74,lon:-47.33,label:'CLIENTE A',resolved:'Rua Um, 10, Americana - SP',destinatario:'CLIENTE A',nf:'1001',romaneio:'AMRENT01'},
    {lat:-22.90,lon:-47.06,label:'CLIENTE B',resolved:'Av. Dois, 200, Campinas - SP',destinatario:'CLIENTE B',ctrc:'AMR 555'}];
  r=await call('POST','/api/public-router/export-construlog',{body:{romaneio:'AMRENT01',driver_name:motorista,event_date:hoje,title:'Rota entregas',route_data:{stops:paradas,start:{lat:-22.69552,lon:-47.307,label:'Base'}}}});
  check('rota do romaneio exportada',r.status===200,r.status+' '+r.text.slice(0,160));
  const rota=async()=>{let x=await call('GET','/api/router-app/company/today?fresh=1',{bearer:ctk});if(x.json&&!x.json.stops?.length){await new Promise(z=>setTimeout(z,21000));x=await call('GET','/api/router-app/company/today?fresh=1',{bearer:ctk})}return x.json||{}};
  let dia=await rota();
  check('cada parada da rota do dia traz a sua chave',dia.stops?.length===2&&dia.stops[0].chave==='nf:1001@AMRENT01'&&dia.stops[1].chave==='ctrc:AMR 555'&&!dia.stops[0].entregue,JSON.stringify(dia).slice(0,300));
  const A=dia.stops?.[0]||{},Bp=dia.stops?.[1]||{};

  console.log('Comprovantes');
  const base={work_date:hoje,registrado_em:new Date().toISOString()};
  r=await call('POST','/api/router-app/company/comprovante',{bearer:ctk,body:{...base,client_uuid:'t-'+Date.now()+'-a',stop:A,resultado:'entregue'}});
  check('entregue sem foto é recusado',r.status===400&&/foto/i.test(r.json?.error||''),r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/router-app/company/comprovante',{bearer:ctk,body:{...base,client_uuid:'t-'+Date.now()+'-b',stop:Bp,resultado:'falhou'}});
  check('não entregue sem motivo é recusado',r.status===400&&/motivo/i.test(r.json?.error||''),r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/router-app/company/comprovante',{bearer:ctk,body:{...base,client_uuid:'t-'+Date.now()+'-c',stop:{label:'sem nada'},resultado:'entregue',foto}});
  check('parada sem identificação é recusada',r.status===400,r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/router-app/company/comprovante',{bearer:ctk,body:{...base,client_uuid:'t-'+Date.now()+'-d',work_date:'2020-01-01',stop:A,resultado:'entregue',foto}});
  check('data antiga demais é recusada',r.status===400,r.status+' '+r.text.slice(0,120));

  const uuidA='t-'+Date.now()+'-ok';
  const corpoA={...base,client_uuid:uuidA,stop:A,resultado:'entregue',recebedor_nome:'Maria da Portaria',onde_deixou:'portaria',observacao:'Deixado com a portaria',foto,miniatura:foto,lat:-22.7405,lon:-47.3302};
  r=await call('POST','/api/router-app/company/comprovante',{bearer:ctk,body:corpoA});
  check('entrega com foto registrada',r.status===201&&r.json?.ok&&r.json?.chave===A.chave,r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/router-app/company/comprovante',{bearer:ctk,body:corpoA});
  check('reenvio do mesmo comprovante (celular sem sinal) não duplica',r.status===200&&r.json?.duplicado===true,r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/router-app/company/comprovante',{bearer:ctk,body:{...base,client_uuid:'t-'+Date.now()+'-f',stop:Bp,resultado:'falhou',motivo:'ausente'}});
  check('não entregue com motivo registrado (sem foto)',r.status===201,r.status+' '+r.text.slice(0,160));

  dia=await rota();
  const a2=dia.stops?.find(s=>s.chave===A.chave),b2=dia.stops?.find(s=>s.chave===Bp.chave);
  check('rota do dia mostra a entrega feita na hora, com o horário',a2?.entregue===true&&/^\d\d:\d\d$/.test(a2?.baixaAt||'')&&a2?.comprovante?.resultado==='entregue',JSON.stringify(a2));
  check('rota do dia mostra a que não foi entregue, com o motivo',b2?.falhou===true&&!b2?.entregue&&b2?.motivoFalha==='Destinatário ausente',JSON.stringify(b2));

  console.log('Central');
  r=await call('GET','/entregas',{cookie});check('tela /entregas abre para o admin',r.status===200&&r.text.includes('id="lista"'),'veio '+r.status);
  r=await call('GET','/api/painel/entregas?data='+hoje,{cookie});
  const rows=(r.json?.rows||[]).filter(x=>x.driver_name===motorista);
  const ca=rows.find(x=>x.resultado==='entregue'),cb=rows.find(x=>x.resultado==='falhou');
  check('central lista os 2 comprovantes do motorista',r.status===200&&rows.length===2,r.status+' '+r.text.slice(0,200));
  check('  ...com recebedor, onde deixou e distância até o endereço',ca?.recebedor_nome==='Maria da Portaria'&&ca?.onde_texto==='Portaria / recepção'&&ca?.distancia_m>=0&&ca?.distancia_m<300,JSON.stringify(ca));
  check('  ...e o motivo da não entrega',cb?.motivo_texto==='Destinatário ausente'&&!cb?.foto_id,JSON.stringify(cb));
  r=await call('GET','/api/painel/entregas/arquivo/'+ca?.foto_id,{cookie});
  check('foto abre na central como imagem, com cache longo',r.status===200&&r.headers.get('content-type')==='image/jpeg'&&r.buf.equals(JPEG)&&/immutable/.test(r.headers.get('cache-control')||''),r.status+' '+r.headers.get('content-type'));
  r=await call('GET','/api/painel/entregas/arquivo/'+(ca?.foto_id||'1'));check('foto sem login -> 401',r.status===401,'veio '+r.status);
  r=await call('GET','/api/painel/entregas/arquivo/999999999',{cookie});check('foto inexistente -> 404',r.status===404,'veio '+r.status);

  console.log(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail?1:0)
})().catch(e=>{console.error(e);process.exit(1)});
