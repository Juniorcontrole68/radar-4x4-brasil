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


  console.log('Código de barras do DANFE → XML na SEFAZ (SEFAZ de mentira com certificado A1 de teste)');
  {
    const sefaz=require('../sefaz-nfe.js');
    const dv=b=>{let t=0,p=2;for(let i=b.length-1;i>=0;i--){t+=+b[i]*p;p=p===9?2:p+1}const r=t%11;return b+(r<2?0:11-r)};
    const nova=n=>dv('352610'+CNPJ_FORN+'55001'+String(n).padStart(9,'0')+'1'+String(n).padStart(8,'0'));
    const kOk=nova(4901),kRes=nova(4902),kNao=nova(4903);
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
        r=await call('GET','/api/wms/auditoria',{cookie:sup});
        check('auditoria registra a Ciência da Operação',r.json.rows.some(x=>x.acao==='ciencia_operacao'&&x.entidade_id===kRes),r.json.rows?.slice(0,3));
      }finally{mock.close()}
    }
  }

  console.log(`\n${pass} OK, ${fail} falha(s)`);
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
