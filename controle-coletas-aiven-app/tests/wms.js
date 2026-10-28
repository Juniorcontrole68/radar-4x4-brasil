// CONSTRULOG WMS 360° — Fase 1: cenários de homologação de ponta a ponta contra o servidor em modo teste
// (TEST_MODE=1, WMS_ATIVO=1, banco vazio). Recebe por XML, confere às cegas com recontagem por outro
// conferente, trata divergência, gera LPN e etiqueta, armazena no endereço sugerido, consulta saldo e
// rastreio, testa leituras repetidas, fila offline, concorrência, estoque insuficiente e acesso indevido.
// Uso: BASE_URL=http://127.0.0.1:10000 DATABASE_URL=... node tests/wms.js
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
if(/onrender\.com/i.test(B)&&!/teste/i.test(B)){console.error('Recusado: BASE_URL parece ser a produção.');process.exit(2)}
const lib=require('../wms.js');
const crypto=require('crypto');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra).slice(0,400));if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name).replace(/[\r\n]+/g,' '))}}
async function call(method,p,{body,cookie}={}){
  const h={};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;
  const r=await fetch(B+p,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});
  const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}
  return{status:r.status,json:json||{},text,headers:r.headers,setCookie:r.headers.get('set-cookie')||''};
}
const login=async(u,s)=>{const r=await call('POST','/api/auth/login',{body:{username:u,password:s}});return(r.setCookie.match(/cl_session=[^;]+/)||[''])[0]};
const uuid=()=>crypto.randomUUID();
const CNPJ_CLI='12345678000199',CNPJ_FORN='98765432000110';
function nfe({chave,itens}){
  const det=itens.map((it,i)=>`<det nItem="${i+1}"><prod><cProd>${it.cod}</cProd><cEAN>${it.ean||'SEM GTIN'}</cEAN><xProd>${it.desc} &amp; cia</xProd><uCom>${it.un||'UN'}</uCom><qCom>${it.q}.0000</qCom>${(it.lotes||[]).map(l=>`<rastro><nLote>${l.lote}</nLote><qLote>${l.q}</qLote><dFab>2026-01-10</dFab><dVal>${l.val}</dVal></rastro>`).join('')}</prod><imposto/></det>`).join('');
  return`<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><serie>1</serie><nNF>4812</nNF></ide>
    <emit><CNPJ>${CNPJ_FORN}</CNPJ><xNome>Fornecedor Teste Ltda</xNome></emit><dest><CNPJ>${CNPJ_CLI}</CNPJ><xNome>Cliente Teste</xNome></dest>${det}</infNFe></NFe></nfeProc>`;
}

(async()=>{
  // começa do zero: limpa só as tabelas wms_ de um banco de teste (nunca roda contra outro banco)
  {
    const url=process.env.DATABASE_URL||'postgresql://teste:teste@127.0.0.1:5432/construlog_teste';
    if(!/teste/i.test(url.split('/').pop()||'')){console.error('Recusado: DATABASE_URL não é um banco de teste.');process.exit(2)}
    const {Client}=require('pg');const db=new Client({connectionString:url});await db.connect();
    const t=(await db.query("SELECT string_agg(quote_ident(tablename),',') AS t FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wms\\_%'")).rows[0].t;
    if(t)await db.query('TRUNCATE '+t+' RESTART IDENTITY CASCADE');
    await db.end();
  }
  console.log('Regras sem servidor (wms.js)');
  {
    {
      // certificado A1: Secret File do Render (arquivo .pfx) ou texto colado; texto errado ganha aviso claro
      const sz=require('../sefaz-nfe.js'),fs=require('fs'),path=require('path');
      const F=path.join(__dirname,'fixtures','sefaz','a1-teste-legado.pfx'),antes={...process.env};
      const st=env=>{for(const k of['WMS_NFE_CERT_PFX_FILE','WMS_NFE_CERT_PFX_BASE64','WMS_NFE_CERT_SENHA'])delete process.env[k];Object.assign(process.env,env);sz._limparCache();return sz.status()};
      let s=st({WMS_NFE_CERT_PFX_FILE:F,WMS_NFE_CERT_SENHA:'senha-a1'});
      check('A1 lido do arquivo .pfx (Secret File)',s.cnpj==='11222333000181'&&!s.erro,s);
      s=st({WMS_NFE_CERT_PFX_BASE64:'"'+fs.readFileSync(F).toString('base64').replace(/(.{76})/g,'$1\r\n')+'"',WMS_NFE_CERT_SENHA:'senha-a1'});
      check('A1 colado com aspas e quebras de linha',s.cnpj==='11222333000181'&&!s.erro,s);
      s=st({WMS_NFE_CERT_PFX_BASE64:'-----BEGIN CERTIFICATE-----\r\n'+fs.readFileSync(F).toString('base64').replace(/(.{64})/g,'$1\r\n')+'\r\n-----END CERTIFICATE-----\r\n',WMS_NFE_CERT_SENHA:'senha-a1'});
      check('A1 colado do certutil -encode (com BEGIN/END)',s.cnpj==='11222333000181'&&!s.erro,s);
      s=st({WMS_NFE_CERT_PFX_BASE64:'[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))',WMS_NFE_CERT_SENHA:'x'});
      check('texto que não é o certificado: aviso explica',/não é o certificado A1/.test(s.erro||''),s);
      for(const k of['WMS_NFE_CERT_PFX_FILE','WMS_NFE_CERT_PFX_BASE64','WMS_NFE_CERT_SENHA'])if(antes[k]===undefined)delete process.env[k];else process.env[k]=antes[k];
      sz._limparCache();
    }
    const x=nfe({chave:'3'.repeat(44),itens:[{cod:'F-1',ean:'7891234567895',desc:'Argamassa',q:300,lotes:[{lote:'L1',q:200,val:'2027-04-30'},{lote:'L2',q:100,val:'2027-06-30'}]},{cod:'F-2',desc:'Rejunte',q:40}]});
    const n=lib.lerNfe(x);
    check('NF-e: chave, número, emitente, destinatário e itens com lote/validade',n.chave==='3'.repeat(44)&&n.numero==='4812'&&n.emitente.cnpj===CNPJ_FORN&&n.destinatario.cnpj===CNPJ_CLI&&n.itens.length===3&&n.itens[0].lote==='L1'&&n.itens[0].qtd===200&&n.itens[1].validade==='2027-06-30'&&n.itens[2].ean===''&&n.itens[0].descricao==='Argamassa & cia',n);
    let ok=false;try{lib.lerNfe('<xml>nada</xml>')}catch(e){ok=e.status===400}
    check('NF-e: arquivo que não é NF-e é recusado',ok);
  }
  check('Code 128: todo símbolo tem 11 módulos e a parada 13',lib.code128('A-03-05-02').match(/.{1,6}/g).slice(0,-2).every(s=>[...s].reduce((a,c)=>a+ +c,0)===11)&&lib.code128('X').endsWith('2331112'));
  check('Code 128: dígito verificador ("PJJ123C" = 55)',lib.code128('PJJ123C').slice(-13,-7)==='311321');
  check('datas: 30/04/2027, 04/2027 (último dia) e data impossível',lib.dataIso('30/04/2027')==='2027-04-30'&&lib.dataIso('02/2028')==='2028-02-29'&&lib.dataIso('31/02/2027')===null);
  {
    const g=lib.gerarEnderecos({rua_de:'A',rua_ate:'B',colunas:{de:1,ate:3},niveis:{de:1,ate:2}});
    check('faixa de endereços: A-01-01-01 a B-03-02-01, 12 posições, distância cresce por rua e coluna',g.length===12&&g[0].codigo==='A-01-01-01'&&g[11].codigo==='B-03-02-01'&&g[0].distancia_m<g[2].distancia_m&&g[0].distancia_m<g[6].distancia_m,g.map(x=>x.codigo+':'+x.distancia_m));
  }
  {
    const e=(codigo,d,nivel,ocup={})=>({id:codigo,codigo,zona_tipo:'pulmao',status:'ativo',tipo:'porta_palete',nivel,distancia_m:d,cap_paletes:1,cap_kg:1200,cap_m3:0,ocup:{paletes:0,kg:0,m3:0,produtos:[],clientes:[],...ocup}});
    const cands=[e('PERTO',5,1),e('MEIO',20,1),e('LONGE',40,1),e('ALTO',5,3),e('CHEIO',4,1,{paletes:1,kg:500,produtos:['9'],clientes:['1']}),e('OUTRO',3,1,{paletes:0,clientes:['7']}),{...e('BLOQ',2,1),status:'bloqueado'}];
    const carga=(curva,kg=300)=>({produto_id:'1',cliente_id:'1',paletes:1,kg,m3:0,curva,estado:'disponivel'});
    const a=lib.ranquearEnderecos(cands,carga('A')),c=lib.ranquearEnderecos(cands,carga('C')),p=lib.ranquearEnderecos(cands,carga('A',900));
    check('sugestão: curva A vai perto da doca, C vai ao fundo',a[0].codigo==='PERTO'||a[0].codigo==='ALTO'&&c[0].codigo==='LONGE',{a:a.map(x=>x.codigo),c:c.map(x=>x.codigo)});
    check('sugestão: carga pesada fica no nível 1',p[0].codigo==='PERTO'&&p.findIndex(x=>x.codigo==='ALTO')>p.findIndex(x=>x.codigo==='PERTO'),p.map(x=>x.codigo));
    check('sugestão: não usa endereço cheio, bloqueado ou com mercadoria de outro cliente',!a.some(x=>['CHEIO','OUTRO','BLOQ'].includes(x.codigo)));
    check('sugestão: o motivo vem escrito',/curva A/.test(a[0].motivo)&&/m da doca/.test(a[0].motivo)&&/cabe 1 palete/.test(a[0].motivo),a[0].motivo);
    check('capacidade: passa do peso',/peso/.test(lib.cabe(e('X',1,1,{kg:1000}),carga('A',300))));
    const av=lib.ranquearEnderecos([...cands,{...e('AV1',50,1),zona_tipo:'avaria'}],{...carga('A'),estado:'avariado'});
    check('avariado vai para a área de avarias',av.length===1&&av[0].codigo==='AV1'&&/avariada/.test(av[0].motivo));
  }

  console.log('Acesso e permissões');
  const adm=await login(ADMIN_USER,ADMIN_PASS);
  check('login do administrador',!!adm);
  const sufixo=Date.now().toString(36);
  const criarUser=async(nome,perms)=>{const r=await call('POST','/api/painel/auth/users',{cookie:adm,body:{username:nome+'_'+sufixo,password:'senha-wms-123',permissions:perms}});return login(nome+'_'+sufixo,'senha-wms-123')};
  const op=await criarUser('op1',['wms_operador']),op2=await criarUser('op2',['wms_operador']),sup=await criarUser('sup',['wms_operador','wms_supervisor']),gest=await criarUser('gest',['wms']),nada=await criarUser('nada',['frota']);
  check('usuários de teste criados',op&&op2&&sup&&gest&&nada);
  let r=await call('GET','/api/wms/status',{cookie:op});
  check('status: operador tem aplicativo, não tem gestão nem supervisão',r.status===200&&r.json.operador&&!r.json.gestao&&!r.json.supervisor,r.json);
  r=await call('GET','/api/wms/armazens',{cookie:nada});
  check('usuário sem permissão do WMS: 403',r.status===403);
  r=await call('GET','/api/wms/armazens');
  check('sem login: 401',r.status===401);
  r=await call('GET','/wms',{cookie:op});
  check('página de gestão leva o operador ao aplicativo',r.status===302&&/\/wms\/app/.test(r.headers.get('location')||''));
  r=await call('GET','/wms',{cookie:gest});
  check('página de gestão abre para quem tem "wms"',r.status===200&&/Armazém \(WMS\)/.test(r.text));
  r=await call('GET','/wms/app',{cookie:op});
  check('aplicativo do operador abre',r.status===200&&/WMS • Operador/.test(r.text));
  r=await call('GET','/api/auth/me',{cookie:op});
  check('painel recebe o aviso de que o WMS está ligado',r.json.user?.wms===true||r.json.wms===true,r.json);

  console.log('Cadastros');
  r=await call('POST','/api/wms/armazens',{cookie:op,body:{codigo:'X',nome:'X'}});
  check('operador não cadastra armazém',r.status===403);
  r=await call('POST','/api/wms/armazens',{cookie:gest,body:{codigo:'CD'+sufixo.slice(-4),nome:'CD Teste'}});
  check('cria armazém',r.status===201,r.json);
  const arm=r.json.id;
  r=await call('GET','/api/wms/armazens',{cookie:gest});
  const A=r.json.rows.find(a=>a.id===arm),Z=t=>A.zonas.find(z=>z.tipo===t).id;
  check('armazém nasce com docas, quarentena, avarias e pulmão',['doca','quarentena','avaria','pulmao'].every(t=>A.zonas.some(z=>z.tipo===t)));
  r=await call('POST','/api/wms/enderecos/lote',{cookie:gest,body:{armazem_id:arm,zona_id:Z('doca'),rua_de:'D',colunas:{de:1,ate:2}}});
  check('gera docas',r.status===201&&r.json.criados===2,r.json);
  r=await call('POST','/api/wms/enderecos/lote',{cookie:gest,body:{armazem_id:arm,zona_id:Z('pulmao'),rua_de:'A',rua_ate:'B',colunas:{de:1,ate:5},niveis:{de:1,ate:2},cap_paletes:1,cap_kg:1200}});
  check('gera 20 endereços de pulmão (A-01-01-01 a B-05-02-01)',r.status===201&&r.json.criados===20&&r.json.primeiro==='A-01-01-01'&&r.json.ultimo==='B-05-02-01',r.json);
  r=await call('POST','/api/wms/enderecos/lote',{cookie:gest,body:{armazem_id:arm,zona_id:Z('pulmao'),rua_de:'A',colunas:{de:1,ate:2}}});
  check('repetir a faixa não duplica endereço',r.json.criados===0&&r.json.ja_existiam===2,r.json);
  await call('POST','/api/wms/enderecos/lote',{cookie:gest,body:{armazem_id:arm,zona_id:Z('avaria'),rua_de:'Z',colunas:{de:1,ate:1},cap_paletes:4,distancia_base_m:60}});
  r=await call('POST','/api/wms/clientes',{cookie:gest,body:{nome:'Cliente Teste',cnpj:CNPJ_CLI}});
  check('cria cliente depositante',r.status===201);
  const cli=r.json.id;
  r=await call('POST','/api/wms/clientes',{cookie:gest,body:{nome:'Duplicado',cnpj:CNPJ_CLI}});
  check('CNPJ repetido é recusado',r.status===409);
  r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'ARG20',descricao:'Argamassa 20 kg',ean:'7891234567895',un_por_caixa:10,caixas_por_palete:20,peso_bruto_kg:1,curva_abc:'A',controla_lote:true,controla_validade:true}});
  check('cria produto com lote e validade (curva A, 200 un por palete)',r.status===201,r.json);
  const p1=r.json.id;
  r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'REJ1',descricao:'Rejunte 1 kg',peso_bruto_kg:5,curva_abc:'C',codigos_alt:['F-2']}});
  const p2=r.json.id;
  r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'REJ1',descricao:'x'}});
  check('SKU repetido no mesmo cliente é recusado',r.status===409);
  r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'X1',descricao:'x',ean:'123'}});
  check('EAN inválido é recusado',r.status===400);
  r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'ERR1',descricao:'Cadastrado errado'}});
  const pErr=r.json.id;
  r=await call('DELETE','/api/wms/produtos/'+pErr,{cookie:op});
  check('operador não exclui produto',r.status===403);
  r=await call('DELETE','/api/wms/produtos/'+pErr,{cookie:gest});
  check('produto nunca usado é excluído de vez',r.status===200&&r.json.resultado==='excluido',r.json);
  r=await call('GET','/api/wms/produtos?q=ERR1',{cookie:gest});
  check('produto excluído some da lista',r.json.rows.length===0);
  r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'ERR1',descricao:'Cadastrado certo'}});
  check('o mesmo SKU pode ser cadastrado de novo',r.status===201);

  console.log('Cenário 1 — receber mercadoria por XML');
  const chave='3526'+String(Date.now()).padStart(40,'0').slice(-40);
  const xml=nfe({chave,itens:[{cod:'F-1',ean:'7891234567895',desc:'Argamassa',q:300,lotes:[{lote:'L1',q:300,val:'2027-04-30'}]},{cod:'F-2',desc:'Rejunte',q:40}]});
  r=await call('POST','/api/wms/recebimentos/xml',{cookie:gest,body:{armazem_id:arm,xml}});
  check('importa a NF-e e acha o cliente pelo CNPJ do destinatário',r.status===201&&r.json.itens===2&&r.json.sem_produto===0,r.json);
  const rec=r.json.id;
  r=await call('POST','/api/wms/recebimentos/xml',{cookie:gest,body:{armazem_id:arm,xml}});
  check('a mesma NF-e não entra duas vezes',r.status===409&&r.json.code==='NFE_DUPLICADA',r.json);

  console.log('Cenário 2 — conferência física cega');
  r=await call('GET','/api/wms/recebimentos/'+rec,{cookie:op});
  check('o conferente não recebe a quantidade esperada',r.status===200&&r.json.recebimento.itens.length===0&&!/qtd_esperada|"300"/.test(JSON.stringify(r.json.recebimento)),r.json);
  r=await call('GET','/api/wms/recebimentos/'+rec,{cookie:gest});
  check('a gestão vê o esperado da nota',r.json.recebimento.itens.length===2&&r.json.recebimento.itens.some(i=>i.qtd_esperada===300));
  const cont=(ck,b)=>call('POST','/api/wms/recebimentos/'+rec+'/contagens',{cookie:ck,body:b});
  r=await cont(op,{uuid:uuid(),codigo:'7891234567895',lote:'L1',validade:'30/04/2027',qtd:300});
  check('não conta antes do veículo chegar na doca',r.status===409);
  r=await call('POST','/api/wms/recebimentos/'+rec+'/chegada',{cookie:op,body:{doca:'A-01-01-01',placa:'ABC1D23'}});
  check('chegada recusa endereço que não é doca',r.status===400);
  r=await call('POST','/api/wms/recebimentos/'+rec+'/chegada',{cookie:op,body:{doca:'D-01-01-01',placa:'ABC-1D23',motorista:'João'}});
  check('registra chegada na doca D-01-01-01',r.status===200&&r.json.status==='na_doca',r.json);
  r=await cont(op,{uuid:uuid(),codigo:'7891234567895',qtd:300});
  check('produto com controle de lote exige o lote',r.status===400&&r.json.code==='LOTE_OBRIGATORIO');
  const u1=uuid();
  r=await cont(op,{uuid:u1,codigo:'7891234567895',lote:'L1',validade:'04/2027',qtd:300});
  check('conta 300 un do ARG20 pelo EAN',r.status===201&&r.json.qtd===300,r.json);
  r=await cont(op,{uuid:u1,codigo:'7891234567895',lote:'L1',validade:'04/2027',qtd:300});
  check('leitura repetida (mesmo uuid) não duplica',r.status===201&&r.json.duplicado===true,r.json);
  r=await cont(op,{uuid:uuid(),codigo:'F-2',qtd:38});
  check('conta 38 un do REJ1 pelo código do fornecedor',r.status===201,r.json);
  r=await cont(op,{uuid:uuid(),codigo:'NAOEXISTE',qtd:1});
  check('produto não cadastrado é avisado',r.status===404&&r.json.code==='PRODUTO_INEXISTENTE');
  r=await call('POST','/api/wms/recebimentos/'+rec+'/fechar',{cookie:op,body:{}});
  check('diferença abre recontagem automática só do REJ1',r.status===200&&r.json.status==='recontagem'&&r.json.recontar.length===1&&String(r.json.recontar[0])===String(p2),r.json);
  r=await cont(op,{uuid:uuid(),codigo:'REJ1',qtd:38});
  check('recontagem pelo mesmo conferente é recusada',r.status===409&&r.json.code==='MESMO_CONFERENTE',r.json);
  r=await cont(op2,{uuid:uuid(),codigo:'ARG20',lote:'L1',validade:'04/2027',qtd:300});
  check('recontagem só aceita os produtos marcados',r.status===409&&r.json.code==='FORA_DA_RECONTAGEM');
  r=await cont(op2,{uuid:uuid(),codigo:'REJ1',qtd:38,avariada:1});
  check('avaria exige foto',r.status===400&&r.json.code==='FOTO_OBRIGATORIA');
  const foto='data:image/jpeg;base64,'+Buffer.from([0xFF,0xD8,0xFF,0xE0,1,2,3,4,5,6,7,8]).toString('base64');
  r=await cont(op2,{uuid:uuid(),codigo:'REJ1',qtd:38,avariada:1,foto});
  check('outro conferente reconta 38, 1 avariada com foto',r.status===201,r.json);
  r=await call('POST','/api/wms/recebimentos/'+rec+'/fechar',{cookie:op2,body:{}});
  check('fecha com divergência: falta 2 e avaria 1',r.status===200&&r.json.status==='divergencia'&&r.json.divergencias===2,r.json);
  r=await call('POST','/api/wms/recebimentos/'+rec+'/finalizar',{cookie:gest,body:{uuid:uuid()}});
  check('não finaliza com divergência aberta',r.status===409);
  r=await call('GET','/api/wms/recebimentos/'+rec,{cookie:gest});
  const divs=r.json.recebimento.divergencias;
  check('divergências registradas com esperado e contado',divs.some(d=>d.tipo==='falta'&&d.qtd===2&&d.qtd_esperada===40&&d.qtd_contada===38)&&divs.some(d=>d.tipo==='avaria'&&d.qtd===1),divs);
  r=await call('POST','/api/wms/divergencias/'+divs[0].id+'/decidir',{cookie:op,body:{decisao:'aceita'}});
  check('operador não decide divergência',r.status===403);
  r=await call('POST','/api/wms/divergencias/'+divs.find(d=>d.tipo==='falta').id+'/decidir',{cookie:sup,body:{decisao:'bloqueada'}});
  check('falta só aceita "registrar falta"',r.status===400);
  for(const d of divs){r=await call('POST','/api/wms/divergencias/'+d.id+'/decidir',{cookie:sup,body:{decisao:'aceita',obs:'conferido com o motorista'}})}
  check('supervisor decide e o recebimento fica conferido',r.status===200&&r.json.recebimento_conferido===true,r.json);

  console.log('Cenário 3 — LPN e etiqueta');
  r=await call('POST','/api/wms/recebimentos/'+rec+'/finalizar',{cookie:gest,body:{uuid:uuid()}});
  check('finaliza: 300 ARG20 em 2 paletes (200+100), 37 REJ1 bons e 1 avariado',r.status===200&&r.json.lpns.length===4,r.json);
  const lpns=r.json.lpns;
  r=await call('GET','/wms/etiquetas?tipo=lpn&recebimento_id='+rec,{cookie:op});
  check('etiquetas dos LPNs com código de barras e QR Code',r.status===200&&(r.text.match(/class="et"/g)||[]).length===4&&/<rect x=/.test(r.text)&&/<svg[^>]*viewBox/.test(r.text),r.text.slice(0,200));
  r=await call('GET','/wms/etiquetas?tipo=endereco&armazem_id='+arm,{cookie:op});
  check('etiquetas dos endereços',r.status===200&&/A-01-01-01/.test(r.text));

  console.log('Cenário 4 e 5 — direcionar e confirmar armazenagem');
  r=await call('GET','/api/wms/tarefas',{cookie:op});
  const tarefas=r.json.rows.filter(t=>lpns.some(l=>l.codigo===t.lpn));
  check('4 tarefas, cada uma com endereço sugerido diferente e motivo escrito',tarefas.length===4&&new Set(tarefas.map(t=>t.sugerido)).size===4&&tarefas.every(t=>t.sugerido&&t.motivo_sugestao),tarefas);
  const tA=tarefas.find(t=>/ARG20/.test(t.conteudo)),tAv=tarefas.find(t=>/avariado/.test(t.conteudo)||t.sugerido==='Z-01-01-01'),tR=tarefas.find(t=>/REJ1/.test(t.conteudo)&&t!==tAv);
  check('ARG20 (curva A) vai para o endereço mais perto da doca',tA.sugerido==='A-01-01-01',tA);
  check('palete avariado vai para a área de avarias',tAv&&tAv.sugerido==='Z-01-01-01',tAv);
  check('REJ1 (curva C) vai mais ao fundo',tR&&tR.sugerido.startsWith('B-05'),tR);
  const conf=(ck,t,b)=>call('POST','/api/wms/tarefas/'+t.id+'/confirmar',{cookie:ck,body:{uuid:uuid(),...b}});
  r=await conf(op,tA,{lpn:tR.lpn,endereco:tA.sugerido});
  check('palete errado é recusado',r.status===409&&r.json.code==='LPN_DIFERENTE');
  r=await conf(op,tA,{lpn:tA.lpn,endereco:'A-02-01-01'});
  check('endereço diferente sem justificativa é recusado',r.status===409&&r.json.code==='ENDERECO_DIFERENTE');
  r=await conf(op,tA,{lpn:tA.lpn,endereco:'A-02-01-01',justificativa:'empilhadeira bloqueando'});
  check('operador sem permissão não armazena fora da sugestão',r.status===403);
  r=await conf(op,tA,{lpn:tA.lpn,endereco:'A-09-01-01'});
  check('endereço inexistente é avisado',r.status===404);
  const uA=uuid();
  r=await call('POST','/api/wms/tarefas/'+tA.id+'/confirmar',{cookie:op,body:{uuid:uA,lpn:tA.lpn.toLowerCase(),endereco:tA.sugerido}});
  check('confirma armazenagem no endereço sugerido',r.status===200&&r.json.endereco==='A-01-01-01',r.json);
  r=await call('POST','/api/wms/tarefas/'+tA.id+'/confirmar',{cookie:op,body:{uuid:uA,lpn:tA.lpn,endereco:tA.sugerido}});
  check('confirmação repetida devolve a mesma resposta sem novo movimento',r.status===200&&r.json.duplicado===true);
  const t2=tarefas.find(t=>/ARG20/.test(t.conteudo)&&t!==tA);
  r=await conf(sup,t2,{lpn:t2.lpn,endereco:'A-01-01-01',justificativa:'teste'});
  check('não deixa pôr 2 paletes numa posição de 1',r.status===409&&r.json.code==='SEM_CAPACIDADE',r.json);
  r=await conf(sup,t2,{lpn:t2.lpn,endereco:'A-03-01-01',justificativa:'mais perto da expedição'});
  check('supervisor armazena fora da sugestão com justificativa',r.status===200&&r.json.fora_da_sugestao===true,r.json);
  r=await conf(op,tR,{lpn:tR.lpn,endereco:tR.sugerido});
  r=await conf(op,tAv,{lpn:tAv.lpn,endereco:tAv.sugerido});
  check('armazena o REJ1 e o avariado',r.status===200);

  console.log('Cenário 6 — consultar saldo e trajetória');
  r=await call('GET','/api/wms/saldos?armazem_id='+arm,{cookie:op});
  const tot=e=>(r.json.totais.find(t=>t.estado===e)||{}).qtd||0;
  check('saldo: 337 disponíveis e 1 avariado',tot('disponivel')===337&&tot('avariado')===1,r.json.totais);
  check('nada ficou na doca',!r.json.rows.some(x=>x.endereco.startsWith('D-')));
  r=await call('DELETE','/api/wms/produtos/'+p1,{cookie:gest});
  check('produto com estoque não pode ser excluído',r.status===409&&r.json.code==='COM_SALDO',r.json);
  r=await call('GET','/api/wms/consulta?armazem_id='+arm+'&codigo=A-01-01-01',{cookie:op});
  check('consulta por endereço mostra lote e validade',r.json.tipo==='endereco'&&r.json.saldos[0].lote==='L1'&&r.json.saldos[0].validade==='2027-04-30'&&r.json.saldos[0].qtd===200,r.json);
  r=await call('GET','/api/wms/consulta?codigo=7891234567895',{cookie:op});
  check('consulta por EAN mostra os dois paletes',r.json.tipo==='produto'&&r.json.saldos.length===2);
  r=await call('GET','/api/wms/rastreio?lpn='+tA.lpn,{cookie:op});
  check('trajetória do palete: entrada na doca e armazenagem',r.json.rows.length===2&&r.json.rows[0].tipo==='entrada'&&r.json.rows[0].destino==='D-01-01-01'&&r.json.rows[1].destino==='A-01-01-01'&&r.json.rows[1].usuario.startsWith('op1_'),r.json.rows);
  r=await call('GET','/api/wms/painel?armazem_id='+arm,{cookie:gest});
  check('painel: 3 posições de guarda ocupadas de 20',r.status===200&&r.json.ocupacao.ocupados===3&&r.json.ocupacao.capacidade===20,r.json.ocupacao);
  r=await call('GET','/api/wms/enderecos?armazem_id='+arm,{cookie:op});
  check('mapa: posição ocupada, livre e doca vazia',r.json.rows.find(e=>e.codigo==='A-01-01-01').situacao==='ocupado'&&r.json.rows.find(e=>e.codigo==='A-02-01-01').situacao==='livre');

  console.log('Movimentação, bloqueio, concorrência e falhas');
  r=await call('POST','/api/wms/movimentar',{cookie:op,body:{uuid:uuid(),armazem_id:arm,origem:tR.sugerido,produto:'REJ1',qtd:1000,destino:'B-04-01-01'}});
  check('estoque insuficiente: recusado sem mexer em nada',r.status===409&&r.json.code==='ESTOQUE_INSUFICIENTE',r.json);
  // 20 pedidos simultâneos de 5 un cada sobre 37 un: só 7 passam, nunca fica negativo
  const res=await Promise.all(Array.from({length:20},()=>call('POST','/api/wms/movimentar',{cookie:op,body:{uuid:uuid(),armazem_id:arm,origem:tR.sugerido,produto:'REJ1',qtd:5,destino:'B-04-01-01'}})));
  const okN=res.filter(x=>x.status===200).length,recusa=res.filter(x=>x.status===409).length;
  r=await call('GET','/api/wms/saldos?armazem_id='+arm+'&q=REJ1&estado=disponivel',{cookie:op});
  const naOrigem=r.json.rows.filter(x=>x.endereco===tR.sugerido).reduce((a,x)=>a+x.qtd,0),noDestino=r.json.rows.filter(x=>x.endereco==='B-04-01-01').reduce((a,x)=>a+x.qtd,0);
  check('20 movimentações simultâneas: '+okN+' passaram, '+recusa+' recusadas, saldo nunca negativo e total preservado',okN===7&&recusa===13&&naOrigem===2&&noDestino===35,{okN,recusa,naOrigem,noDestino,erros:res.filter(x=>x.status>=500).map(x=>x.text)});
  r=await call('POST','/api/wms/bloquear',{cookie:op,body:{uuid:uuid(),lpn:tA.lpn,motivo:'x'}});
  check('operador não bloqueia estoque',r.status===403);
  r=await call('POST','/api/wms/bloquear',{cookie:sup,body:{uuid:uuid(),lpn:tA.lpn,motivo:'suspeita de umidade'}});
  check('supervisor bloqueia o palete',r.status===200&&r.json.qtd===200,r.json);
  r=await call('POST','/api/wms/movimentar',{cookie:op,body:{uuid:uuid(),armazem_id:arm,origem:'A-01-01-01',produto:'ARG20',qtd:10,destino:'A-04-01-01'}});
  check('estoque bloqueado não sai como disponível',r.status===409);
  r=await call('POST','/api/wms/desbloquear',{cookie:sup,body:{uuid:uuid(),lpn:tA.lpn,motivo:'laudo ok'}});
  check('libera o palete',r.status===200&&r.json.qtd===200);

  console.log('Fila offline do aplicativo');
  const opsOff=[{uuid:uuid(),tipo:'movimentacao',dados:{armazem_id:arm,lpn:tA.lpn,destino:'A-05-01-01'}},{uuid:uuid(),tipo:'movimentacao',dados:{armazem_id:arm,lpn:tA.lpn,destino:'A-04-02-01'}},{uuid:uuid(),tipo:'movimentacao',dados:{armazem_id:arm,origem:'B-04-01-01',produto:'REJ1',qtd:9999,destino:'B-03-01-01'}}];
  r=await call('POST','/api/wms/sync',{cookie:op,body:{ops:opsOff}});
  check('sincroniza a fila: aplica em ordem e devolve o conflito sem aplicar',r.status===200&&r.json.resultados[0].ok&&r.json.resultados[1].ok&&!r.json.resultados[2].ok&&r.json.resultados[2].code==='ESTOQUE_INSUFICIENTE',r.json);
  r=await call('POST','/api/wms/sync',{cookie:op,body:{ops:opsOff}});
  check('reenviar a mesma fila (sinal voltou duas vezes) não duplica',r.json.resultados[0].duplicado&&r.json.resultados[1].duplicado);
  r=await call('GET','/api/wms/rastreio?lpn='+tA.lpn,{cookie:op});
  check('trajetória completa: entrada, armazenagem, bloqueio, desbloqueio e 2 transferências',r.json.rows.map(x=>x.tipo).join(',')==='entrada,armazenagem,bloqueio,desbloqueio,transferencia,transferencia'&&r.json.rows[5].destino==='A-04-02-01',r.json.rows.map(x=>x.tipo+':'+x.destino));

  console.log('Integridade e isolamento');
  const {Client}=require('pg');
  const db=new Client({connectionString:process.env.DATABASE_URL||'postgresql://teste:teste@127.0.0.1:5432/construlog_teste'});
  await db.connect();
  let bloqueou=false;try{await db.query('UPDATE wms_movimentos SET qtd=qtd+1 WHERE id=(SELECT MIN(id) FROM wms_movimentos)')}catch{bloqueou=true}
  check('movimento de estoque não pode ser alterado no banco',bloqueou);
  bloqueou=false;try{await db.query('DELETE FROM wms_auditoria')}catch{bloqueou=true}
  check('auditoria não pode ser apagada',bloqueou);
  bloqueou=false;try{await db.query("UPDATE wms_saldos SET qtd=-1 WHERE id=(SELECT MIN(id) FROM wms_saldos)")}catch{bloqueou=true}
  check('banco recusa saldo negativo',bloqueou);
  const soma=(await db.query(`SELECT (SELECT COALESCE(SUM(qtd),0) FROM wms_saldos WHERE armazem_id=$1)::float AS saldo,
    (SELECT COALESCE(SUM(qtd),0) FROM wms_movimentos WHERE armazem_id=$1 AND tipo='entrada')::float AS entradas`,[arm])).rows[0];
  check('saldo total do armazém = soma das entradas (nada sumiu nem apareceu)',soma.saldo===soma.entradas&&soma.saldo===338,soma);
  const outra=(await db.query("INSERT INTO wms_armazens(empresa,codigo,nome) VALUES(987654,'OUTRA'||$1,'Armazém de outra empresa') RETURNING id::text",[sufixo])).rows[0].id;
  r=await call('GET','/api/wms/armazens',{cookie:gest});
  check('armazém de outra empresa não aparece',!r.json.rows.some(a=>a.id===outra));
  r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'USADO1',descricao:'Já teve lote'}});
  const pUsado=r.json.id;
  await db.query("INSERT INTO wms_lotes(produto_id,lote) VALUES($1,'LX')",[pUsado]);
  r=await call('DELETE','/api/wms/produtos/'+pUsado,{cookie:gest});
  const inat=(await db.query('SELECT ativo,sku FROM wms_produtos WHERE id=$1',[pUsado])).rows[0];
  check('produto com histórico e sem estoque fica inativo (histórico mantido)',r.json.resultado==='inativado'&&inat&&inat.ativo===false&&inat.sku.startsWith('USADO1 (inativo'),{r:r.json,inat});
  r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'USADO1',descricao:'Cadastro certo'}});
  check('depois de inativar, o SKU fica livre para o cadastro certo',r.status===201);
  r=await call('GET','/api/wms/enderecos?armazem_id='+outra,{cookie:gest});
  check('acesso direto pelo id de outra empresa: 404',r.status===404);
  r=await call('GET','/api/wms/recebimentos/999999999',{cookie:gest});
  check('recebimento inexistente: 404',r.status===404);
  await db.end();
  r=await call('GET','/api/wms/auditoria',{cookie:sup});
  check('auditoria registra fora da sugestão, bloqueio e decisões',['armazenar_fora_sugestao','bloquear','decidir','finalizar'].every(a=>r.json.rows.some(x=>x.acao===a)),r.json.rows?.map(x=>x.acao));

  console.log('Estoque inicial / ajuste (permissão wms_ajuste)');
  {
    r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'AJ1',descricao:'Produto do estoque inicial'}});
    check('cria produto para o estoque inicial',r.status===201,r.json);
    const corpoAj=(x={})=>({uuid:'aj-'+sufixo+'-'+Math.random().toString(36).slice(2,10),armazem_id:arm,cliente_id:cli,produto:'AJ1',endereco:'B-05-01-01',qtd:50,motivo:'Estoque inicial',...x});
    r=await call('POST','/api/wms/ajuste',{cookie:gest,body:corpoAj()});
    check('gestão sem a permissão de ajuste: 403',r.status===403,r.status+' '+JSON.stringify(r.json));
    const aj=await criarUser('aj',['wms','wms_ajuste']);
    r=await call('GET','/api/wms/status',{cookie:aj});
    check('status avisa a tela que o usuário pode ajustar',r.json?.ajuste===true&&(await call('GET','/api/wms/status',{cookie:gest})).json?.ajuste===false,r.json);
    const c1=corpoAj();
    r=await call('POST','/api/wms/ajuste',{cookie:aj,body:c1});
    check('estoque inicial: 50 entram direto no endereço',r.status===200&&r.json.qtd===50&&r.json.endereco==='B-05-01-01',r.json);
    r=await call('POST','/api/wms/ajuste',{cookie:aj,body:c1});
    check('mesma operação repetida (rede ruim) não duplica',r.json?.duplicado===true,r.json);
    const saldoAj=async()=>(await call('GET','/api/wms/saldos?q=AJ1',{cookie:aj})).json.rows.filter(x=>x.sku==='AJ1').reduce((t,x)=>t+x.qtd,0);
    check('saldo do produto = 50',await saldoAj()===50);
    r=await call('POST','/api/wms/ajuste',{cookie:aj,body:corpoAj({sentido:'retirar',qtd:20,motivo:'Inventário'})});
    check('ajuste para menos: retira 20',r.status===200&&r.json.sentido==='retirar'&&await saldoAj()===30,r.json);
    r=await call('POST','/api/wms/ajuste',{cookie:aj,body:corpoAj({sentido:'retirar',qtd:100})});
    check('retirar mais do que tem: 409 sem mexer no saldo',r.status===409&&await saldoAj()===30,r.json);
    r=await call('POST','/api/wms/ajuste',{cookie:aj,body:corpoAj({motivo:''})});
    check('sem motivo: 400',r.status===400,r.json);
    r=await call('POST','/api/wms/ajuste',{cookie:aj,body:corpoAj({produto:'ARG20'})});
    check('produto que controla lote exige o lote',r.status===400&&/lote/.test(r.json?.error||''),r.json);
    r=await call('GET','/api/wms/auditoria',{cookie:sup});
    check('auditoria registra o ajuste com o usuário',r.json.rows.some(x=>x.acao==='ajuste_estoque'&&String(x.usuario).startsWith('aj_')),r.json.rows?.slice(0,3));
  }



  console.log('Fase 2 — expedição: NF de saída, reserva por vencimento, separação no coletor e baixa');
  {
    const gx=await criarUser('gx',['wms','wms_ajuste']);
    r=await call('POST','/api/wms/produtos',{cookie:gx,body:{cliente_id:cli,sku:'EXP1',descricao:'Produto da expedição',controla_lote:true,controla_validade:true}});
    check('cria produto com lote para a expedição',r.status===201,r.json);
    const aj=(x)=>call('POST','/api/wms/ajuste',{cookie:gx,body:{uuid:'ex-'+Math.random().toString(36).slice(2,12),armazem_id:arm,cliente_id:cli,motivo:'Estoque inicial',...x}});
    r=await aj({produto:'EXP1',endereco:'B-03-02-01',qtd:40,lote:'LA',validade:'2027-12-31'});
    const r2=await aj({produto:'EXP1',endereco:'B-04-02-01',qtd:20,lote:'LB',validade:'2027-03-31'});
    check('estoque: 40 do lote LA (vence 12/2027) e 20 do LB (vence 03/2027)',r.status===200&&r2.status===200,[r.json,r2.json]);
    const saldo=async(sku,estado)=>(await call('GET','/api/wms/saldos?q='+sku,{cookie:gx})).json.rows.filter(x=>x.sku===sku&&(!estado||x.estado===estado)).reduce((t,x)=>t+x.qtd,0);
    const aj1Antes=await saldo('AJ1','disponivel');
    const chS='3526'+String(Date.now()+7).padStart(40,'0').slice(-40);
    const xmlS=nfe({chave:chS,itens:[{cod:'EXP1',desc:'Produto da expedição',q:30},{cod:'AJ1',desc:'Produto do estoque inicial',q:5}]});
    r=await call('POST','/api/wms/expedicoes/xml',{cookie:op,body:{armazem_id:arm,xml:xmlS}});
    check('operador não lança nota de saída',r.status===403);
    r=await call('POST','/api/wms/expedicoes/xml',{cookie:gest,body:{armazem_id:arm,xml:xmlS}});
    check('importa a NF de saída e acha o cliente e os produtos',r.status===201&&r.json.itens===2&&r.json.sem_produto===0,r.json);
    const ex=r.json.id;
    r=await call('POST','/api/wms/expedicoes/xml',{cookie:gest,body:{armazem_id:arm,xml:xmlS}});
    check('a mesma nota de saída não entra duas vezes',r.status===409&&r.json.code==='NFE_DUPLICADA',r.json);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op,body:{uuid:uuid(),separacao_id:1,endereco:'B-04-02-01',produto:'EXP1'}});
    check('não separa antes de reservar',r.status===409||r.status===404,r.json);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/reservar',{cookie:op});
    check('operador não reserva',r.status===403);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/reservar',{cookie:gest});
    check('reserva: 3 linhas de separação',r.status===200&&r.json.linhas===3&&r.json.status==='separando',r.json);
    r=await call('GET','/api/wms/expedicoes/'+ex,{cookie:op});
    const E=r.json.expedicao||{},sepEXP=(E.separacao||[]).filter(x=>x.sku==='EXP1');
    check('vence primeiro, sai primeiro: 20 do LB e 10 do LA',sepEXP.length===2&&sepEXP.some(x=>x.lote==='LB'&&x.qtd===20&&x.endereco==='B-04-02-01')&&sepEXP.some(x=>x.lote==='LA'&&x.qtd===10&&x.endereco==='B-03-02-01'),E.separacao);
    check('reservado sai do disponível: EXP1 30 disponíveis e 30 reservados',await saldo('EXP1','disponivel')===30&&await saldo('EXP1','reservado')===30);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/reservar',{cookie:gest});
    check('reservar de novo é recusado',r.status===409);
    {
      const ch2='3526'+String(Date.now()+11).padStart(40,'0').slice(-40);
      r=await call('POST','/api/wms/expedicoes/xml',{cookie:gest,body:{armazem_id:arm,xml:nfe({chave:ch2,itens:[{cod:'AJ1',desc:'x',q:1},{cod:'EXP1',desc:'x',q:31}]})}});
      const ex2=r.json.id;
      r=await call('POST','/api/wms/expedicoes/'+ex2+'/reservar',{cookie:gest});
      check('sem estoque suficiente: 409 com o que falta e nada reservado',r.status===409&&r.json.code==='ESTOQUE_INSUFICIENTE'&&/EXP1/.test(r.json.error)&&await saldo('AJ1','reservado')===5&&await saldo('EXP1','disponivel')===30,r.json);
      r=await call('POST','/api/wms/expedicoes/'+ex2+'/cancelar',{cookie:gest,body:{motivo:'sem estoque'}});
      check('cancela a expedição sem reserva',r.status===200&&r.json.status==='cancelada',r.json);
    }
    const lb=sepEXP.find(x=>x.lote==='LB'),la=sepEXP.find(x=>x.lote==='LA'),lAj=E.separacao.find(x=>x.sku==='AJ1');
    r=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op,body:{uuid:uuid(),separacao_id:lb.id,endereco:'B-03-02-01',produto:'EXP1',qtd:5}});
    check('endereço errado é recusado e diz onde está',r.status===409&&r.json.code==='ENDERECO_ERRADO'&&r.json.error.includes('B-04-02-01'),r.json);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op,body:{uuid:uuid(),separacao_id:lb.id,endereco:'B-04-02-01',produto:'AJ1',qtd:5}});
    check('produto errado é recusado',r.status===409&&r.json.code==='PRODUTO_ERRADO',r.json);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op,body:{uuid:uuid(),separacao_id:lb.id,endereco:'B-04-02-01',produto:'EXP1',qtd:21}});
    check('quantidade maior que a reservada é recusada',r.status===409&&r.json.code==='QTD_MAIOR',r.json);
    const u1=uuid();
    r=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op,body:{uuid:u1,separacao_id:lb.id,endereco:'B-04-02-01',produto:'EXP1',qtd:15}});
    check('separa 15 de 20 e vai para a doca',r.status===200&&r.json.qtd===15&&r.json.restante===5&&r.json.doca==='D-01-01-01'&&r.json.status==='separando',r.json);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op,body:{uuid:u1,separacao_id:lb.id,endereco:'B-04-02-01',produto:'EXP1',qtd:15}});
    check('a mesma leitura repetida (sinal ruim) não separa de novo',r.json.duplicado===true,r.json);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/expedir',{cookie:gest,body:{}});
    check('não expede com item por separar',r.status===409,r.json);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op,body:{uuid:uuid(),separacao_id:lb.id,endereco:'B-04-02-01',produto:'EXP1'}});
    check('sem quantidade separa o que falta da linha (5)',r.status===200&&r.json.qtd===5&&r.json.restante===0,r.json);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op,body:{uuid:uuid(),separacao_id:la.id,endereco:'B-03-02-01',produto:'EXP1',qtd:10}});
    const r3=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op2,body:{uuid:uuid(),separacao_id:lAj.id,endereco:lAj.endereco,produto:'AJ1',qtd:5}});
    check('tudo separado: expedição fica "separada"',r.status===200&&r3.status===200&&r3.json.status==='separada'&&r3.json.linhas_abertas===0,[r.json,r3.json]);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/separar',{cookie:op,body:{uuid:uuid(),separacao_id:la.id,endereco:'B-03-02-01',produto:'EXP1',qtd:1}});
    check('linha já separada não separa de novo',r.status===409,r.json);
    r=await call('GET','/api/wms/saldos?q=D-01-01-01',{cookie:gx});
    check('na doca: 30 EXP1 e 5 AJ1 reservados para a nota',r.json.rows.filter(x=>x.sku==='EXP1'&&x.estado==='reservado').reduce((t,x)=>t+x.qtd,0)===30&&r.json.rows.filter(x=>x.sku==='AJ1'&&x.estado==='reservado').reduce((t,x)=>t+x.qtd,0)===5,r.json.rows);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/expedir',{cookie:op,body:{placa:'ABC1D23'}});
    check('operador não dá saída',r.status===403);
    r=await call('POST','/api/wms/expedicoes/'+ex+'/expedir',{cookie:gest,body:{placa:'abc1d23'}});
    check('expede: baixa do estoque',r.status===200&&r.json.status==='expedida',r.json);
    check('saldo depois da saída: EXP1 30 (só o LA), AJ1 −5, nada reservado',await saldo('EXP1')===30&&await saldo('EXP1','reservado')===0&&await saldo('AJ1','disponivel')===aj1Antes-5&&await saldo('AJ1','reservado')===0);
    r=await call('GET','/api/wms/expedicoes/'+ex,{cookie:gest});
    check('expedição guarda placa, quem expediu e as quantidades separadas',r.json.expedicao.status==='expedida'&&r.json.expedicao.placa==='ABC1D23'&&r.json.expedicao.itens.every(i=>i.separado===i.qtd),r.json.expedicao);
    {
      // relatórios em PDF do recebimento e da expedição
      const pdfParse=require('pdf-parse/lib/pdf-parse.js');
      const baixa=async(url,cookie)=>{const r=await fetch(B+url,{headers:{Cookie:cookie}});const buf=Buffer.from(await r.arrayBuffer());
        let texto='';if(r.status===200)try{texto=(await pdfParse(buf)).text}catch(e){texto='ERRO '+e.message}
        return{status:r.status,tipo:r.headers.get('content-type')||'',buf,texto}};
      let x=await baixa('/api/wms/expedicoes/'+ex+'/pdf',gest);
      check('PDF da expedição: arquivo PDF',x.status===200&&/application\/pdf/.test(x.tipo)&&x.buf.slice(0,5).toString()==='%PDF-',[x.status,x.tipo]);
      check('PDF da expedição traz romaneio, placa, lista de separação, endereços e assinaturas',/Romaneio de expedição/i.test(x.texto)&&x.texto.includes('ABC1D23')&&/Lista de separação/i.test(x.texto)
        &&x.texto.includes('EXP1')&&x.texto.includes('Expedida')&&/Motorista \(nome, documento e assinatura\)/.test(x.texto)&&/Página 1 de \d/.test(x.texto),x.texto.slice(0,600));
      x=await baixa('/api/wms/expedicoes/'+ex+'/pdf',op);
      check('operador não baixa o PDF da expedição',x.status===403,x.status);
      x=await baixa('/api/wms/recebimentos/'+rec+'/pdf',gest);
      check('PDF do recebimento: arquivo PDF',x.status===200&&/application\/pdf/.test(x.tipo)&&x.buf.slice(0,5).toString()==='%PDF-',[x.status,x.tipo]);
      check('PDF do recebimento traz nota, transporte, contagens, divergências, LPNs e assinaturas',/Relatório de recebimento/i.test(x.texto)&&x.texto.includes('ABC1D23')&&x.texto.includes('João')
        &&/Contagens registradas/i.test(x.texto)&&/Divergências e decisões/i.test(x.texto)&&/LPN\d{9}/.test(x.texto)&&x.texto.includes('Fornecedor Teste Ltda')&&/Conferente/.test(x.texto),x.texto.slice(0,600));
      x=await baixa('/api/wms/recebimentos/'+rec+'/pdf',op);
      check('conferência cega: operador não baixa o PDF do recebimento',x.status===403,x.status);
      x=await baixa('/api/wms/recebimentos/999999/pdf',gest);
      check('PDF de recebimento que não existe -> 404',x.status===404,x.status);
    }
    r=await call('POST','/api/wms/expedicoes/'+ex+'/cancelar',{cookie:gest,body:{}});
    check('expedição já expedida não cancela',r.status===409);
    {
      const ch3='3526'+String(Date.now()+13).padStart(40,'0').slice(-40);
      r=await call('POST','/api/wms/expedicoes/xml',{cookie:gest,body:{armazem_id:arm,xml:nfe({chave:ch3,itens:[{cod:'AJ1',desc:'x',q:4}]})}});
      const ex3=r.json.id;
      await call('POST','/api/wms/expedicoes/'+ex3+'/reservar',{cookie:gest});
      const L=(await call('GET','/api/wms/expedicoes/'+ex3,{cookie:op})).json.expedicao.separacao[0];
      await call('POST','/api/wms/expedicoes/'+ex3+'/separar',{cookie:op,body:{uuid:uuid(),separacao_id:L.id,endereco:L.endereco,produto:'AJ1',qtd:1}});
      r=await call('POST','/api/wms/expedicoes/'+ex3+'/cancelar',{cookie:gest,body:{motivo:'cliente desistiu'}});
      check('cancelar depois de separar parte: tudo volta ao disponível (o separado fica na doca)',r.status===200&&await saldo('AJ1','reservado')===0&&await saldo('AJ1','disponivel')===aj1Antes-5,r.json);
    }
    r=await call('GET','/api/wms/expedicoes?status=abertas',{cookie:op});
    check('lista de abertas não mostra expedida nem cancelada',r.status===200&&!r.json.rows.some(x=>['expedida','cancelada'].includes(x.status)),r.json.rows);
    r=await call('GET','/api/wms/auditoria',{cookie:sup});
    check('auditoria registra reserva e saída',r.json.rows.some(x=>x.acao==='expedir'&&x.entidade_id===ex)&&r.json.rows.some(x=>x.acao==='reservar'&&x.entidade_id===ex),r.json.rows?.slice(0,4));
  }

  console.log('Código de barras do DANFE → XML na SEFAZ (SEFAZ de mentira com certificado A1 de teste)');
  {
    const sefaz=require('../sefaz-nfe.js');
    const dv=b=>{let t=0,p=2;for(let i=b.length-1;i>=0;i--){t+=+b[i]*p;p=p===9?2:p+1}const r=t%11;return b+(r<2?0:11-r)};
    const nova=n=>dv('352610'+CNPJ_FORN+'55001'+String(n).padStart(9,'0')+'1'+String(n).padStart(8,'0'));
    const kOk=nova(4901),kRes=nova(4902),kNao=nova(4903),kSai=nova(4904);
    check('chave: dígito verificador confere e chave alterada é recusada',sefaz.chaveValida(kOk)&&!sefaz.chaveValida(kOk.slice(0,43)+((+kOk[43]+1)%10)));
    r=await call('GET','/api/wms/status',{cookie:gest});
    const ligado=r.json.nfe_chave===true;
    if(!ligado&&process.env.GITHUB_ACTIONS)check('servidor de teste com o certificado A1 de teste (WMS_NFE_*)',false,r.json);
    if(!ligado){
      r=await call('POST','/api/wms/recebimentos/chave',{cookie:gest,body:{chave:kOk,armazem_id:arm}});
      check('sem certificado: avisa que a busca na SEFAZ não está ligada',r.status===503&&r.json.code==='SEFAZ_DESLIGADA',r.json);
    }else{
      const fs=require('fs'),https=require('https'),zlib=require('zlib'),path=require('path');
      const dir=path.join(__dirname,'fixtures','sefaz');
      const gz=x=>zlib.gzipSync(Buffer.from(x)).toString('base64');
      const ret=(corpo)=>'<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">'+corpo+'</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>';
      const pedidos=[];
      const mock=https.createServer({key:fs.readFileSync(path.join(dir,'servidor.key')),cert:fs.readFileSync(path.join(dir,'servidor.pem')),ca:fs.readFileSync(path.join(dir,'ca.pem')),requestCert:true,rejectUnauthorized:true},(req,res)=>{
        let b='';req.on('data',d=>b+=d);req.on('end',()=>{
          const cn=req.socket.getPeerCertificate()?.subject?.CN||'';
          pedidos.push({url:req.url,acao:String(req.headers['content-type']||''),corpo:b,cn});
          res.writeHead(200,{'Content-Type':'application/soap+xml; charset=utf-8'});
          if(req.url==='/evento'){
            const ch=(b.match(/<chNFe>(\d{44})</)||[])[1];
            return res.end('<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><tpAmb>1</tpAmb><cOrgao>91</cOrgao><cStat>128</cStat><xMotivo>Lote de evento processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cOrgao>91</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>'+ch+'</chNFe><tpEvento>210210</tpEvento><nProt>891260000000001</nProt></infEvento></retEvento></retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>');
          }
          const ch=(b.match(/<chNFe>(\d{44})</)||[])[1];
          if(ch===kOk)return res.end(ret('<tpAmb>1</tpAmb><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><loteDistDFeInt><docZip NSU="000000000000001" schema="procNFe_v4.00.xsd">'+gz(nfe({chave:kOk,itens:[{cod:'F-1',ean:'7891234567895',desc:'Argamassa',q:120,lotes:[{lote:'L9',q:120,val:'2027-09-30'}]},{cod:'F-2',desc:'Rejunte',q:15}]}))+'</docZip></loteDistDFeInt>'));
          if(ch===kSai)return res.end(ret('<tpAmb>1</tpAmb><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><loteDistDFeInt><docZip NSU="000000000000003" schema="procNFe_v4.00.xsd">'+gz(nfe({chave:kSai,itens:[{cod:'AJ1',desc:'Produto do estoque inicial',q:2}]}))+'</docZip></loteDistDFeInt>'));
          if(ch===kRes)return res.end(ret('<tpAmb>1</tpAmb><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><loteDistDFeInt><docZip NSU="000000000000002" schema="resNFe_v1.01.xsd">'+gz('<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>'+kRes+'</chNFe></resNFe>')+'</docZip></loteDistDFeInt>'));
          res.end(ret('<tpAmb>1</tpAmb><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo>'));
        });
      });
      await new Promise(ok=>mock.listen(Number(process.env.SEFAZ_MOCK_PORT||10778),'127.0.0.1',ok));
      try{
        r=await call('POST','/api/wms/recebimentos/chave',{cookie:op,body:{chave:kOk,armazem_id:arm}});
        check('operador não importa nota pela chave',r.status===403,r.json);
        r=await call('POST','/api/wms/recebimentos/chave',{cookie:gest,body:{chave:kOk.slice(0,43)+((+kOk[43]+1)%10),armazem_id:arm}});
        check('leitura errada (dígito não confere): 400 sem consultar a SEFAZ',r.status===400&&r.json.code==='CHAVE_INVALIDA'&&!pedidos.length,r.json);
        r=await call('POST','/api/wms/recebimentos/chave',{cookie:gest,body:{chave:kOk,armazem_id:arm}});
        check('lê a chave, baixa o XML na SEFAZ e cria o recebimento com os itens',r.status===201&&r.json.origem==='sefaz'&&r.json.chave===kOk&&r.json.itens===2,r.json);
        const p0=pedidos[0]||{};
        check('consulta pela chave com o CNPJ do certificado e o certificado A1 na conexão',p0.url==='/dist'&&/nfeDistDFeInteresse/.test(p0.acao)&&p0.corpo.includes('<CNPJ>11222333000181</CNPJ>')&&p0.corpo.includes('<consChNFe><chNFe>'+kOk+'</chNFe></consChNFe>')&&/11222333000181/.test(p0.cn),p0);
        const recS=r.json.id;
        r=await call('GET','/api/wms/recebimentos/'+recS,{cookie:gest});
        check('recebimento da SEFAZ tem a nota, o cliente e o lote',r.json.recebimento?.nf_chave===kOk&&JSON.stringify(r.json).includes('L9'),r.json);
        const antes=pedidos.length;
        r=await call('POST','/api/wms/recebimentos/chave',{cookie:gest,body:{chave:kOk,armazem_id:arm}});
        check('ler a mesma nota de novo: avisa o recebimento e nem consulta a SEFAZ',r.status===409&&r.json.code==='NFE_DUPLICADA'&&r.json.error.includes(recS)&&pedidos.length===antes,r.json);
        r=await call('POST','/api/wms/recebimentos/chave',{cookie:gest,body:{chave:kRes,armazem_id:arm}});
        const ev=pedidos.find(x=>x.url==='/evento');
        check('só o resumo: registra a Ciência da Operação e pede para ler de novo em minutos',r.status===202&&r.json.pendente===true&&!!ev&&/nfeRecepcaoEvento/.test(ev.acao),r.json);
        {
          const x=ev?.corpo||'';
          const inf=(x.match(/<infEvento [\s\S]*?<\/infEvento>/)||[''])[0].replace('<infEvento ','<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" ');
          const si=(x.match(/<SignedInfo>[\s\S]*?<\/SignedInfo>/)||[''])[0].replace('<SignedInfo>','<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
          const dig=(x.match(/<DigestValue>([^<]+)/)||[])[1],sig=(x.match(/<SignatureValue>([^<]+)/)||[])[1],cer=(x.match(/<X509Certificate>([^<]+)/)||[])[1];
          let ok=false;try{ok=crypto.createHash('sha1').update(inf).digest('base64')===dig&&crypto.verify('RSA-SHA1',Buffer.from(si),new crypto.X509Certificate(Buffer.from(cer,'base64')).publicKey,Buffer.from(sig,'base64'))}catch(e){}
          check('evento 210210 assinado com o A1 (digest e assinatura conferem)',ok&&x.includes('<tpEvento>210210</tpEvento>')&&x.includes('Id="ID210210'+kRes+'01"')&&/<dhEvento>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-03:00</.test(x),x.slice(0,300));
        }
        r=await call('POST','/api/wms/recebimentos/chave',{cookie:gest,body:{chave:kNao,armazem_id:arm}});
        check('nota que não é da empresa: a SEFAZ não acha e o aviso explica',r.status===404&&r.json.code==='NFE_NAO_ENCONTRADA',r.json);
        r=await call('POST','/api/wms/expedicoes/chave',{cookie:gest,body:{chave:kSai,armazem_id:arm}});
        check('expedição: lê a chave da nota de saída e baixa o XML na SEFAZ',r.status===201&&r.json.origem==='sefaz'&&r.json.itens===1,r.json);
        r=await call('GET','/api/wms/auditoria',{cookie:sup});
        check('auditoria registra a Ciência da Operação',r.json.rows.some(x=>x.acao==='ciencia_operacao'&&x.entidade_id===kRes),r.json.rows?.slice(0,3));
      }finally{mock.close()}
    }
  }

  console.log('Cobrança da armazenagem: formas de cobrar por cliente, mês fechado e mês corrente');
  {
    const {Client}=require('pg');
    const db=new Client({connectionString:process.env.DATABASE_URL||'postgresql://teste:teste@127.0.0.1:5432/construlog_teste'});await db.connect();
    try{
      r=await call('POST','/api/wms/clientes',{cookie:gest,body:{nome:'Cliente Faturamento',cnpj:'11444777000161'}});
      check('cria o cliente da cobrança',r.status===201,r.json);
      const cf=r.json.id;
      const ant=(await db.query("SELECT to_char(((NOW() AT TIME ZONE 'America/Sao_Paulo')::date-INTERVAL '1 month'),'YYYY-MM') AS m")).rows[0].m;
      const ndias=(await db.query("SELECT EXTRACT(DAY FROM ($1::date+INTERVAL '1 month'-INTERVAL '1 day'))::int AS n",[ant+'-01'])).rows[0].n;
      // fotos do mês passado: dia 1 com 10 paletes, dia 11 cai para 4, dia 21 esvazia (dias sem foto repetem a anterior)
      for(const [d,pal,pos,m3,kg] of [['01',10,4,2,1000],['11',4,2,1,0],['21',0,0,0,0]])
        await db.query('INSERT INTO wms_ocupacao_diaria(data,empresa,cliente_id,armazem_id,paletes,posicoes,unidades,kg,m3) VALUES($1,0,$2,$3,$4,$5,0,$6,$7)',[ant+'-'+d,cf,arm,pal,pos,kg,m3]);
      await db.query(`INSERT INTO wms_recebimentos(empresa,armazem_id,cliente_id,nf_numero,status,finalizado_em,xml) VALUES(0,$1,$2,'777','finalizado',$3::date+INTERVAL '5 days 12 hours',
        '<nfeProc><NFe><infNFe><total><ICMSTot><vProd>1000.00</vProd><vNF>1234.56</vNF></ICMSTot></total></infNFe></NFe></nfeProc>')`,[arm,cf,ant+'-01']);
      r=await call('GET','/api/wms/faturamento?mes='+ant,{cookie:op});
      check('operador não vê a cobrança',r.status===403);
      r=await call('GET','/api/wms/faturamento?mes=2026-13',{cookie:gest});
      check('mês inválido: 400',r.status===400,r.json);
      r=await call('PUT','/api/wms/tarifas/'+cf,{cookie:op,body:{palete_dia:1}});
      check('operador não muda preço',r.status===403);
      r=await call('PUT','/api/wms/tarifas/'+cf,{cookie:gest,body:{ad_valorem:150}});
      check('ad valorem acima de 100% é recusado',r.status===400,r.json);
      r=await call('PUT','/api/wms/tarifas/'+cf,{cookie:gest,body:{palete_dia:1.5,m3_dia:2,ton_dia:10,palete_pico:3,nf_entrada:20,ad_valorem:0.5,mensalidade:100,minimo_mensal:600}});
      check('grava a tabela de preços do cliente',r.status===200&&r.json.tarifa.palete_dia===1.5&&r.json.tarifa.posicao_dia===0,r.json);
      r=await call('GET','/api/wms/faturamento?mes='+ant+'&cliente_id='+cf,{cookie:gest});
      const f=r.json.rows?.[0]||{},m=f.medidas||{},L=Object.fromEntries((f.linhas||[]).map(l=>[l.metodo,l]));
      check('mês fechado conta todos os dias e lista as formas de cobrar',r.status===200&&f.dias===ndias&&r.json.metodos?.length>=19,{dias:f.dias,ndias});
      check('palete/dia repete a última foto: 10×10 + 4×10 + 0',m.palete_dias===140&&m.pico_paletes===10,m);
      check('posição/dia, m³/dia e tonelada/dia',m.posicao_dias===60&&m.m3_dias===30&&m.ton_dias===10,m);
      check('valor das notas de entrada vem do XML (vNF)',m.valor_nf_entrada===1234.56&&m.nf_entrada===1,m);
      check('só cobra o que tem preço',!L.posicao_dia&&!L.entrada_un&&L.palete_dia?.valor===210&&L.m3_dia?.valor===60&&L.ton_dia?.valor===100&&L.palete_pico?.valor===30,f.linhas);
      check('nota de entrada, ad valorem e mensalidade',L.nf_entrada?.valor===20&&L.ad_valorem?.valor===6.17&&L.mensalidade?.valor===100,f.linhas);
      check('subtotal 526,17 abaixo do mínimo: completa até 600',f.subtotal===526.17&&f.ajuste_minimo===73.83&&f.total===600,f);
      const csv=await fetch(B+'/api/wms/faturamento?formato=csv&mes='+ant+'&cliente_id='+cf,{headers:{Cookie:gest}});
      const tx=await csv.text();
      check('planilha CSV com itens, mínimo e total',csv.status===200&&/text\/csv/.test(csv.headers.get('content-type'))&&tx.includes('"Palete por dia";140,00')&&tx.includes('0,50%')&&tx.includes('Complemento do mínimo mensal')&&tx.includes('600,00'),tx.slice(0,500));
      const hoje=(await db.query("SELECT paletes FROM wms_ocupacao_diaria WHERE cliente_id=$1 AND data=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date",[cf])).rows[0];
      check('cliente que esvaziou ganha foto zerada hoje',hoje&&hoje.paletes===0,hoje);
      // mês corrente do cliente principal: entrada e saída batem com os movimentos do banco
      r=await call('PUT','/api/wms/tarifas/'+cli,{cookie:gest,body:{entrada_un:0.1,entrada_cx:0.5,entrada_palete:2,saida_un:0.2,nf_saida:3,linha_separada:0.25}});
      check('preços por quantidade de entrada e saída',r.status===200,r.json);
      const mes=(await db.query("SELECT to_char((NOW() AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM') AS m")).rows[0].m;
      r=await call('GET','/api/wms/faturamento?mes='+mes,{cookie:gest});
      const g=(r.json.rows||[]).find(x=>x.cliente_id===String(cli))||{},gm=g.medidas||{},GL=Object.fromEntries((g.linhas||[]).map(l=>[l.metodo,l]));
      const bd=(await db.query(`SELECT SUM(qtd) FILTER (WHERE tipo='entrada')::float AS e,COUNT(DISTINCT lpn_id) FILTER (WHERE tipo='entrada')::int AS ep,SUM(qtd) FILTER (WHERE tipo='saida')::float AS s
        FROM wms_movimentos WHERE cliente_id=$1 AND date_trunc('month',criado_em AT TIME ZONE 'America/Sao_Paulo')=date_trunc('month',NOW() AT TIME ZONE 'America/Sao_Paulo')`,[cli])).rows[0];
      const sp=(await db.query(`SELECT COUNT(*)::int AS n FROM wms_expedicao_separacao s JOIN wms_expedicoes x ON x.id=s.expedicao_id WHERE x.cliente_id=$1 AND x.status='expedida' AND s.status='separada'`,[cli])).rows[0].n;
      check('quantidade de entrada no período bate com o estoque',bd.e>0&&gm.entrada_un===bd.e&&gm.entrada_paletes===bd.ep&&GL.entrada_un?.valor===Math.round(bd.e*0.1*100)/100,{gm,bd});
      check('saída: unidades, notas e linhas separadas',gm.saida_un===(bd.s||0)&&gm.nf_saida>=1&&gm.linhas_separadas===sp&&GL.linha_separada?.qtd===sp,{gm,bd,sp});
      check('caixas recebidas arredondam para cima',gm.entrada_cx>0&&Number.isInteger(gm.entrada_cx),gm);
      check('total geral soma os clientes',Math.abs(r.json.total-r.json.rows.reduce((a,x)=>a+x.total,0))<0.01,r.json.total);
      r=await call('GET','/api/wms/auditoria',{cookie:sup});
      check('mudança de preço fica na auditoria',r.json.rows.some(x=>x.acao==='tarifa'),r.json.rows?.slice(0,3));
    }finally{await db.end()}
  }

  console.log('Apagar endereços');
  {
    r=await call('POST','/api/wms/armazens/'+arm+'/zonas',{cookie:gest,body:{codigo:'BLOC',nome:'Blocado chão',tipo:'blocado'}});
    const zb=r.json.id;
    r=await call('POST','/api/wms/enderecos/lote',{cookie:gest,body:{armazem_id:arm,zona_id:zb,tipo:'chao',rua_de:'C',colunas:{de:1,ate:3}}});
    check('gera 3 endereços de chão',r.json.criados===3,r.json);
    r=await call('DELETE','/api/wms/enderecos?armazem_id='+arm+'&zona_id='+zb,{cookie:op});
    check('operador não apaga endereços',r.status===403);
    r=await call('DELETE','/api/wms/enderecos?armazem_id='+arm+'&zona_id='+zb,{cookie:gest});
    check('apaga os 3 endereços da zona',r.status===200&&r.json.apagados===3&&r.json.mantidos===0,r.json);
    const antes=(await call('GET','/api/wms/enderecos?armazem_id='+arm,{cookie:gest})).json.rows.length;
    r=await call('DELETE','/api/wms/enderecos?armazem_id='+arm,{cookie:gest});
    const depois=(await call('GET','/api/wms/enderecos?armazem_id='+arm,{cookie:gest})).json.rows;
    check('armazém inteiro: apaga os livres e mantém os com estoque ou histórico',r.status===200&&r.json.apagados>0&&r.json.com_saldo>0&&r.json.mantidos===depois.length&&antes===r.json.apagados+depois.length&&depois.some(e=>e.codigo==='B-05-01-01'),r.json);
  }

  console.log('DANFE em PDF e nota só pela chave (quando a SEFAZ não libera o XML)');
  {
    // texto do pdftotext -layout: descrição que quebra em duas linhas e lote/validade na descrição
    const txt=['RECEBEMOS DE ACME INDUSTRIA LTDA OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL','CHAVE DE ACESSO','   3526 1009 1663 4400 0220 5500 1000 3213 4916 2548 1649',
      'DESTINATÁRIO / REMETENTE','NOME / RAZÃO SOCIAL                         CNPJ / CPF          DATA DA EMISSÃO','CLIENTE TESTE LTDA                          12.345.678/0001-99  27/10/2026',
      'DADOS DO PRODUTO / SERVIÇO','CÓDIGO  DESCRIÇÃO   NCM/SH   CST  CFOP  UN.  QTD.  V.UNIT.',
      'A-1     PRODUTO UM COM NOME                     39231090   000   5949   UN   1.250,0000   12,5000   15.625,00',
      '        COMPRIDO QUE QUEBRA','B-2     PRODUTO DOIS LOTE: L-9 VAL: 31/12/2027  3923.50.00  0/00  5.949  CX   37,5   4,20   157,50','','DADOS ADICIONAIS'].join('\n');
    const d=lib.lerDanfe(txt);
    check('DANFE: chave, número, série, emitente e destinatário',d.chave==='35261009166344000220550010003213491625481649'&&d.numero==='321349'&&d.serie==='1'&&d.emitente.cnpj==='09166344000220'&&d.emitente.nome==='ACME INDUSTRIA LTDA'&&d.destinatario.cnpj===CNPJ_CLI&&d.destinatario.nome==='CLIENTE TESTE LTDA',d);
    check('DANFE: itens com descrição em duas linhas, unidade, quantidade, lote e validade',d.itens.length===2&&d.itens[0].descricao==='PRODUTO UM COM NOME COMPRIDO QUE QUEBRA'&&d.itens[0].qtd===1250&&d.itens[1].unidade==='CX'&&d.itens[1].qtd===37.5&&d.itens[1].lote==='L-9'&&d.itens[1].validade==='2027-12-31',d.itens);
    let e=null;try{lib.lerDanfe('   \n  ')}catch(x){e=x}
    check('PDF sem texto (digitalizado) dá aviso claro',e?.code==='PDF_SEM_TEXTO');
    e=null;try{lib.lerDanfe('CHAVE 3526 1009 1663 4400 0220 5500 1000 3213 4916 2548 1640')}catch(x){e=x}
    check('chave com dígito errado é recusada',e?.code==='DANFE_INVALIDO');

    r=await call('POST','/api/wms/nfe/previa',{cookie:op,body:{tipo:'saida',chave:'35261009166344000220550010003213491625481649'}});
    check('operador não lança nota sem XML',r.status===403);
    r=await call('POST','/api/wms/nfe/previa',{cookie:gest,body:{tipo:'saida',chave:'35261009166344000220550010003213491625481640'}});
    check('prévia pela chave: dígito errado é recusado',r.status===400);
    r=await call('POST','/api/wms/nfe/previa',{cookie:gest,body:{tipo:'saida',chave:'35261009166344000220550010003213491625481649'}});
    check('prévia pela chave: número, série e emitente saem da chave, sem itens',r.status===200&&r.json.nfe.numero==='321349'&&r.json.nfe.serie==='1'&&r.json.nfe.emitente.cnpj==='09166344000220'&&r.json.nfe.itens.length===0&&r.json.cliente_id===null&&r.json.ja===null,r.json);
    r=await call('POST','/api/wms/nfe/previa',{cookie:gest,body:{tipo:'entrada',pdf:Buffer.from('nao e pdf de verdade, so texto qualquer para passar do tamanho minimo de cem bytes do arquivo enviado').toString('base64')}});
    check('arquivo que não é PDF é recusado',r.status===400&&r.json.code==='PDF_INVALIDO',r.json);

    const temPdf=!require('child_process').spawnSync('pdftotext',['-v']).error;
    if(!temPdf)console.log('  (pulado: sem pdftotext neste ambiente)');
    else{
      const pdf=require('fs').readFileSync(require('path').join(__dirname,'fixtures','danfe','danfe-teste.pdf')).toString('base64');
      r=await call('POST','/api/wms/nfe/previa',{cookie:gest,body:{tipo:'entrada',pdf}});
      const pv=r.json;
      check('DANFE em PDF: lê a nota e acha o cliente pelo destinatário',r.status===200&&pv.nfe.origem==='danfe'&&pv.nfe.numero==='321349'&&pv.cliente_id===cli&&pv.nfe.itens.length===3,pv);
      check('DANFE em PDF: quantidades e lote',pv.nfe?.itens?.[0]?.qtd===1250&&pv.nfe.itens[1].qtd===48&&/QUATRO ENTRADAS$/.test(pv.nfe.itens[1].descricao)&&pv.nfe.itens[2].unidade==='CX'&&pv.nfe.itens[2].qtd===37.5&&pv.nfe.itens[2].lote==='T-77'&&pv.nfe.itens[2].validade==='2027-04-30',pv.nfe?.itens);
      const itens=pv.nfe.itens.map((i,k)=>k===0?{...i,qtd:'1.200,5'}:i);
      // número e emitente saem sempre da chave, mesmo que o navegador mande outros; o cliente vem do destinatário
      r=await call('POST','/api/wms/recebimentos/danfe',{cookie:gest,body:{armazem_id:arm,nfe:{...pv.nfe,itens,numero:'999',emitente:{cnpj:'11111111111111',nome:pv.nfe.emitente.nome}}}});
      check('recebimento lançado pelo DANFE',r.status===201&&r.json.itens===3&&r.json.origem==='danfe',r.json);
      const det=r.status===201&&(await call('GET','/api/wms/recebimentos/'+r.json.id,{cookie:gest})).json.recebimento;
      check('recebimento pelo DANFE: número e emitente da chave, itens corrigidos na prévia',det&&det.nf_numero==='321349'&&det.emitente_cnpj==='09166344000220'&&det.cliente.id===cli&&det.itens.length===3&&det.itens[0].qtd_nf===1200.5&&det.itens[2].lote==='T-77',det);
      const rec={id:det?.id};
      r=await call('POST','/api/wms/recebimentos/danfe',{cookie:gest,body:{armazem_id:arm,nfe:{...pv.nfe,itens}}});
      check('a mesma nota não entra duas vezes no recebimento',r.status===409&&r.json.code==='NFE_DUPLICADA',r.json);
      r=await call('POST','/api/wms/nfe/previa',{cookie:gest,body:{tipo:'entrada',pdf}});
      check('prévia avisa que a nota já foi lançada',r.json.ja===rec?.id,r.json);
      r=await call('POST','/api/wms/expedicoes/danfe',{cookie:gest,body:{armazem_id:arm,cliente_id:cli,nfe:{chave:pv.nfe.chave,itens:[{codigo:'A-1',descricao:'x',unidade:'UN',qtd:'2'}]}}});
      check('saída lançada só com a chave e um item digitado',r.status===201&&r.json.itens===1&&r.json.origem==='danfe',r.json);
      r=await call('POST','/api/wms/expedicoes/danfe',{cookie:gest,body:{armazem_id:arm,cliente_id:cli,nfe:{chave:pv.nfe.chave,itens:[{codigo:'A-1',qtd:'0'}]}}});
      check('saída: a mesma nota não entra duas vezes',r.status===409,r.json);
    }
  }

  console.log('Destinatários e expedição lançada à mão');
  {
    r=await call('POST','/api/wms/destinatarios',{cookie:op,body:{nome:'Mercado X'}});
    check('operador não cadastra destinatário',r.status===403);
    r=await call('POST','/api/wms/destinatarios',{cookie:gest,body:{nome:'',cnpj:''}});
    check('destinatário sem nome é recusado',r.status===400);
    r=await call('POST','/api/wms/destinatarios',{cookie:gest,body:{nome:'Supermercado Bom Preço',cnpj:'11.222.333/0001-81',cidade:'Sorocaba',uf:'sp'}});
    check('cadastra destinatário',r.status===201,r.json);
    const dest=r.json.id;
    r=await call('POST','/api/wms/destinatarios',{cookie:gest,body:{nome:'Outro',cnpj:'11222333000181'}});
    check('CNPJ de destinatário não repete',r.status===409);
    r=await call('PATCH','/api/wms/destinatarios/'+dest,{cookie:gest,body:{cidade:'Sorocaba Centro'}});
    r=await call('GET','/api/wms/destinatarios',{cookie:op});
    check('lista destinatários (operador vê)',r.status===200&&r.json.rows.some(d=>d.id===dest&&d.uf==='SP'&&d.cidade==='Sorocaba Centro'),r.json);
    const prod=(await call('GET','/api/wms/produtos?cliente_id='+cli,{cookie:gest})).json.rows[0];
    r=await call('POST','/api/wms/expedicoes',{cookie:gest,body:{armazem_id:arm,cliente_id:cli,destinatario_id:'999999',nf_numero:'5001',itens:[{produto_id:prod.id,qtd:1}]}});
    check('destinatário inexistente é recusado',r.status===400);
    r=await call('POST','/api/wms/expedicoes',{cookie:gest,body:{armazem_id:arm,cliente_id:cli,destinatario_id:dest,nf_numero:'5001',nf_serie:'1',itens:[{produto_id:prod.id,qtd:2}]}});
    check('expedição manual com destinatário do cadastro',r.status===201,r.json);
    const x=r.status===201&&(await call('GET','/api/wms/expedicoes/'+r.json.id,{cookie:gest})).json.expedicao;
    check('expedição manual: destinatário, NF e produto com SKU e descrição',x&&x.destinatario_nome==='Supermercado Bom Preço'&&x.destinatario_cnpj==='11222333000181'&&x.nf_numero==='5001'&&x.itens.length===1&&x.itens[0].produto_id===prod.id&&x.itens[0].codigo===prod.sku&&x.itens[0].descricao===prod.descricao,x);
    r=await call('DELETE','/api/wms/destinatarios/'+dest,{cookie:gest});
    const lista=(await call('GET','/api/wms/destinatarios',{cookie:gest})).json.rows;
    check('remove destinatário do cadastro (expedição continua com o nome)',r.status===200&&!lista.some(d=>d.id===dest));
  }

  console.log('Reserva usa estoque inicial fora das zonas de armazenagem e diz onde está o que falta');
  {
    r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'XD1',descricao:'Produto no cross docking'}});
    r=await call('POST','/api/wms/armazens/'+arm+'/zonas',{cookie:gest,body:{codigo:'XDK',nome:'Cross docking',tipo:'cross_docking'}});
    const zx=r.json.id;
    r=await call('POST','/api/wms/enderecos/lote',{cookie:gest,body:{armazem_id:arm,zona_id:zx,tipo:'chao',rua_de:'X',colunas:{de:1,ate:1}}});
    const endX=(await call('GET','/api/wms/enderecos?armazem_id='+arm,{cookie:gest})).json.rows.find(e=>e.zona_id===zx||/^X-/.test(e.codigo));
    const ajx=await criarUser('ajx',['wms','wms_ajuste']);
    r=await call('POST','/api/wms/ajuste',{cookie:ajx,body:{uuid:'ajx-'+sufixo,armazem_id:arm,cliente_id:cli,produto:'XD1',endereco:endX?.codigo,qtd:10,motivo:'Estoque inicial'}});
    check('estoque inicial de 10 no cross docking',r.status===200,r.json);
    const px=(await call('GET','/api/wms/produtos?cliente_id='+cli+'&q=XD1',{cookie:gest})).json.rows.find(p=>p.sku==='XD1');
    r=await call('POST','/api/wms/expedicoes',{cookie:gest,body:{armazem_id:arm,cliente_id:cli,nf_numero:'7001',itens:[{produto_id:px.id,qtd:20}]}});
    r=await call('POST','/api/wms/expedicoes/'+r.json.id+'/reservar',{cookie:gest});
    check('faltando: a mensagem diz quanto há e onde',r.status===409&&/XD1: faltam 10 \(há 10 em X-/.test(r.json.error),r.json);
    r=await call('POST','/api/wms/expedicoes',{cookie:gest,body:{armazem_id:arm,cliente_id:cli,nf_numero:'7002',itens:[{produto_id:px.id,qtd:7}]}});
    r=await call('POST','/api/wms/expedicoes/'+r.json.id+'/reservar',{cookie:gest});
    check('reserva o estoque inicial que está no cross docking',r.status===200&&r.json.linhas===1,r.json);
  }

  console.log('Endereços gerados na quarentena passam para uma zona Blocado');
  {
    r=await call('POST','/api/wms/produtos',{cookie:gest,body:{cliente_id:cli,sku:'QZ1',descricao:'Produto na quarentena'}});
    const zs=(await call('GET','/api/wms/armazens',{cookie:gest})).json.rows.find(a=>a.id===String(arm)).zonas;
    const zq=zs.find(z=>z.tipo==='quarentena').id;
    r=await call('POST','/api/wms/enderecos/lote',{cookie:gest,body:{armazem_id:arm,zona_id:zq,tipo:'chao',rua_de:'Q',colunas:{de:1,ate:2}}});
    const ajq=await criarUser('ajq',['wms','wms_ajuste']);
    r=await call('POST','/api/wms/ajuste',{cookie:ajq,body:{uuid:'ajq-'+sufixo,armazem_id:arm,cliente_id:cli,produto:'QZ1',endereco:'Q-01-01-01',qtd:30,motivo:'Estoque inicial'}});
    check('estoque inicial de 30 na quarentena',r.status===200,r.json);
    const pq=(await call('GET','/api/wms/produtos?cliente_id='+cli+'&q=QZ1',{cookie:gest})).json.rows.find(p=>p.sku==='QZ1');
    r=await call('POST','/api/wms/expedicoes',{cookie:gest,body:{armazem_id:arm,cliente_id:cli,nf_numero:'7101',itens:[{produto_id:pq.id,qtd:5}]}});
    const exq=r.json.id;
    r=await call('POST','/api/wms/expedicoes/'+exq+'/reservar',{cookie:gest});
    check('na quarentena a reserva recusa e diz a zona',r.status===409&&/zona quarentena/.test(r.json.error),r.json);
    r=await call('POST','/api/wms/armazens/'+arm+'/zonas',{cookie:gest,body:{codigo:'BLQZ',nome:'Blocado QZ',tipo:'blocado'}});
    const zb=r.json.id;
    r=await call('POST','/api/wms/enderecos/zona',{cookie:op,body:{armazem_id:arm,de_zona_id:zq,para_zona_id:zb}});
    check('operador não muda zona de endereço',r.status===403,r.status);
    r=await call('POST','/api/wms/enderecos/zona',{cookie:gest,body:{armazem_id:arm,de_zona_id:zq,para_zona_id:zq}});
    check('mesma zona -> 400',r.status===400,r.json);
    r=await call('POST','/api/wms/enderecos/zona',{cookie:gest,body:{armazem_id:arm,de_zona_id:zq,para_zona_id:zb,prefixo:'q-01-01'}});
    check('só os endereços com o prefixo mudam de zona',r.status===200&&r.json.movidos===1&&r.json.primeiro==='Q-01-01-01',r.json);
    const ends=(await call('GET','/api/wms/enderecos?armazem_id='+arm,{cookie:gest})).json.rows;
    check('Q-01-01-01 no blocado e Q-02-01-01 na quarentena',ends.find(e=>e.codigo==='Q-01-01-01')?.tipo&&ends.find(e=>e.codigo==='Q-01-01-01').zona==='Blocado QZ'&&ends.find(e=>e.codigo==='Q-02-01-01')?.zona!=='Blocado QZ',ends.filter(e=>/^Q-/.test(e.codigo)).map(e=>e.codigo+':'+e.zona));
    r=await call('POST','/api/wms/expedicoes/'+exq+'/reservar',{cookie:gest});
    check('depois de mudar a zona a reserva usa o saldo',r.status===200&&r.json.linhas===1,r.json);
  }

  console.log('Limpeza do estoque (administrador, com backup)');
  {
    let r=await call('GET','/api/wms/estoque/limpeza',{cookie:gest});
    check('gestão sem ser administrador não vê a limpeza',r.status===403,r.status);
    r=await call('POST','/api/wms/estoque/limpar',{cookie:gest,body:{modo:'tudo',confirmar:'LIMPAR'}});
    check('gestão sem ser administrador não limpa',r.status===403,r.status);
    r=await call('GET','/api/wms/status',{cookie:adm});
    check('status avisa que é administrador',r.json.admin===true,r.json);
    r=await call('GET','/api/wms/estoque/limpeza',{cookie:adm});
    const antes=r.json.resumo;
    check('resumo mostra o que será apagado',r.status===200&&antes.wms_saldos>0&&antes.wms_recebimentos>0&&antes.wms_movimentos>0&&antes.unidades_em_estoque>0,antes);
    r=await call('POST','/api/wms/estoque/limpar',{cookie:adm,body:{modo:'tudo',confirmar:'sim'}});
    check('sem digitar LIMPAR não limpa',r.status===400&&r.json.code==='CONFIRMAR',r.json);
    r=await call('POST','/api/wms/estoque/limpar',{cookie:adm,body:{confirmar:'LIMPAR'}});
    check('sem escolher o modo não limpa',r.status===400,r.json);
    r=await call('GET','/api/wms/estoque/backup',{cookie:adm});
    check('backup para baixar traz as tabelas de estoque',r.status===200&&/attachment/.test(r.headers.get('content-disposition')||'')&&r.json.tabelas?.wms_saldos?.length===antes.wms_saldos&&r.json.tabelas.wms_movimentos.length===antes.wms_movimentos,[r.status,Object.keys(r.json.tabelas||{})]);
    // só o saldo: quantidades zeradas por ajuste, histórico fica, expedições abertas canceladas
    r=await call('POST','/api/wms/estoque/limpar',{cookie:adm,body:{modo:'saldo',confirmar:'limpar'}});
    const bk1=r.json.backup_id;
    check('zerar saldo: estoque fica zerado',r.status===200&&r.json.depois.unidades_em_estoque===0&&r.json.depois.wms_saldos===0,r.json);
    check('zerar saldo: recebimentos e expedições ficam como histórico',r.json.depois.wms_recebimentos===antes.wms_recebimentos&&r.json.depois.wms_expedicoes===antes.wms_expedicoes&&r.json.depois.wms_movimentos>antes.wms_movimentos,r.json.depois);
    r=await call('GET','/api/wms/expedicoes?status=abertas',{cookie:gest});
    check('zerar saldo: nenhuma expedição aberta',r.status===200&&r.json.rows.length===0,r.json.rows);
    r=await call('GET','/api/wms/estoque/backup?id='+bk1,{cookie:adm});
    check('cópia de segurança guardada no banco antes de limpar',r.status===200&&r.json.tabelas.wms_saldos.length===antes.wms_saldos,r.status);
    // começar do zero: só os cadastros ficam
    const prodAntes=(await call('GET','/api/wms/produtos?cliente_id='+cli,{cookie:gest})).json.rows.length;
    r=await call('POST','/api/wms/estoque/limpar',{cookie:adm,body:{modo:'tudo',confirmar:'LIMPAR'}});
    const d=r.json.depois||{};
    check('começar do zero: tabelas de estoque vazias (fica só o registro da limpeza na auditoria)',r.status===200&&Object.entries(d).filter(([k])=>k.startsWith('wms_')&&k!=='wms_auditoria').every(([,v])=>v===0)&&d.wms_auditoria===1,r.json);
    check('começar do zero: produtos e endereços continuam',(await call('GET','/api/wms/produtos?cliente_id='+cli,{cookie:gest})).json.rows.length===prodAntes&&(await call('GET','/api/wms/enderecos?armazem_id='+arm,{cookie:gest})).json.rows.length>0);
    r=await call('GET','/api/wms/estoque/limpeza',{cookie:adm});
    check('as duas cópias de segurança aparecem na lista',r.json.backups?.length===2,r.json.backups);
    r=await call('GET','/api/wms/auditoria',{cookie:sup});
    check('auditoria registra a limpeza',r.json.rows?.some(x=>x.acao==='limpar_estoque'),r.json.rows?.slice(0,2));
  }

  console.log(`\n${pass} OK, ${fail} falha(s)`);
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
