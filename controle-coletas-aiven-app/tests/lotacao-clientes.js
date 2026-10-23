// Cadastro de clientes da Lotação e o endereço da coleta gravado como veio da tela.
// Roda contra o servidor em TEST_MODE (banco vazio), como tests/e2e.js. Nunca rode contra a produção.
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
if(/onrender\.com/i.test(B)&&!/teste/i.test(B)){console.error('Recusado: BASE_URL parece ser a produção.');process.exit(2)}
const lc=require('../lotacao-clientes');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name).replace(/[\r\n]+/g,' '))}}
async function call(method,path,{body,cookie}={}){
  const h={};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;
  const r=await fetch(B+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});
  const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}
  return{status:r.status,json,text,headers:r.headers}
}

(async()=>{
  console.log('Endereço completo (sem rede)');
  check('monta "rua - bairro - cidade - UF - CEP"',lc.enderecoCompleto({endereco:'Rua de Teste, 100',bairro:'Centro',cidade:'Campinas',uf:'sp',cep:'13000-000'})==='Rua de Teste, 100 - Centro - Campinas - SP - CEP 13000-000');
  check('campos vazios ficam de fora',lc.enderecoCompleto({endereco:'Rua X, 1',cidade:'Itu'})==='Rua X, 1 - Itu');
  check('CEP só com números ganha o traço',lc.lerCorpo({nome:'A',cep:'13000000'}).cep==='13000-000');
  let erro='';try{lc.lerCorpo({nome:''})}catch(e){erro=e.message}
  check('nome é obrigatório',/nome/i.test(erro));

  console.log('Sem login');
  let r=await call('GET','/api/painel/lotacao-clientes');check('lista sem login -> 401',r.status===401,'veio '+r.status);
  r=await call('POST','/api/painel/lotacao-clientes',{body:{nome:'X'}});check('criar sem login -> 401',r.status===401,'veio '+r.status);

  r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});
  const cookie=((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];check('login',!!cookie);

  console.log('Cadastro');
  const novo={nome:'Cliente Lotação Teste',endereco:'Av. das Indústrias, 500',bairro:'Distrito Industrial',cidade:'Sorocaba',uf:'sp',cep:'18087000',referencia:'Portão azul ao lado do posto',observacoes:'Carregar das 7h às 16h.\nFalar com o Sr. Paulo.'};
  r=await call('POST','/api/painel/lotacao-clientes',{cookie,body:novo});
  const cli=r.json?.row;
  check('cadastra cliente com endereço completo, referência e observações',r.status===201&&cli?.uf==='SP'&&cli.cep==='18087-000'&&cli.referencia===novo.referencia&&cli.observacoes.includes('Sr. Paulo')
    &&cli.endereco_completo==='Av. das Indústrias, 500 - Distrito Industrial - Sorocaba - SP - CEP 18087-000',r.text.slice(0,300));
  r=await call('POST','/api/painel/lotacao-clientes',{cookie,body:{nome:'cliente lotacao  TESTE'}});check('nome repetido (sem acento/maiúscula) -> 409',r.status===409,'veio '+r.status);
  r=await call('POST','/api/painel/lotacao-clientes',{cookie,body:{nome:'Sem UF',uf:'XX'}});check('UF inválida -> 400',r.status===400,'veio '+r.status);
  r=await call('GET','/api/painel/lotacao-clientes',{cookie});check('lista traz o cliente',r.status===200&&r.json?.rows?.some(x=>x.id===cli?.id),r.text.slice(0,200));
  r=await call('PUT','/api/painel/lotacao-clientes/'+cli?.id,{cookie,body:{...novo,referencia:'Em frente à balança'}});
  check('edita o cliente',r.status===200&&r.json?.row?.referencia==='Em frente à balança',r.text.slice(0,200));
  const end=r.json?.row?.endereco_completo;
  r=await call('PUT','/api/painel/lotacao-clientes/999999',{cookie,body:{nome:'Ninguém'}});check('editar inexistente -> 404',r.status===404,'veio '+r.status);

  console.log('Coleta com o cliente cadastrado');
  r=await call('POST','/coletas/api/coletas',{cookie,body:{cliente:novo.nome,endereco_coleta:end,endereco_entrega:'Rua de Teste, 100 - Campinas - SP',data_carregamento:'2026-10-23',motorista:'MOTORISTA CLIENTE',placa:'CLI1A23',tipo_caminhao:'Truck',implemento:'Baú'}});
  const coletaId=r.json?.id;
  check('coleta grava o endereço do cliente (antes era sempre o endereço fixo)',r.status===201&&r.json?.endereco_coleta===end,r.text.slice(0,200));
  r=await call('PUT','/coletas/api/coletas/'+coletaId,{cookie,body:{status:'Carregando'}});
  check('editar a coleta mantém o endereço do cliente',r.status===200&&r.json?.endereco_coleta===end,r.text.slice(0,200));
  r=await call('POST','/coletas/api/coletas',{cookie,body:{cliente:'Sem Endereço',endereco_entrega:'Rua Y, 1',data_carregamento:'2026-10-23',tipo_caminhao:'Truck',implemento:'Baú'}});
  check('coleta sem endereço continua com o endereço fixo de sempre',r.status===201&&r.json?.endereco_coleta===lc.ENDERECO_FIXO_ANTIGO,r.text.slice(0,200));
  r=await call('PATCH','/api/painel/coletas-complementos/'+coletaId,{cookie,body:{entregas_extras:[],motorista_banco:{},coleta_principal:{referencia:'Portão azul',observacao:'Falar com o Sr. Paulo'}}});
  check('grava referência e observações da coleta 1',r.status===200&&r.json?.coleta_principal?.referencia==='Portão azul',r.text.slice(0,200));
  r=await call('PATCH','/api/painel/coletas-complementos/'+coletaId,{cookie,body:{entregas_extras:[],motorista_banco:{}}});
  check('tela antiga (sem o campo) não apaga a referência',r.status===200&&r.json?.coleta_principal?.observacao==='Falar com o Sr. Paulo',r.text.slice(0,200));

  console.log('Clientes já usados');
  r=await call('POST','/api/painel/lotacao-clientes/importar',{cookie});
  check('importa remetentes já usados nas coletas',r.status===200&&r.json?.importados>=1,r.text.slice(0,200));
  r=await call('GET','/api/painel/lotacao-clientes',{cookie});
  const imp=r.json?.rows?.find(x=>x.nome==='Sem Endereço');
  check('remetente com o endereço fixo antigo entra sem endereço',!!imp&&imp.endereco==='',JSON.stringify(imp||{}));
  check('importar não muda o cliente já cadastrado',r.json?.rows?.find(x=>x.id===cli?.id)?.referencia==='Em frente à balança');
  r=await call('POST','/api/painel/lotacao-clientes/importar',{cookie});check('importar de novo não duplica',r.status===200&&r.json?.importados===0,r.text.slice(0,120));

  r=await call('GET','/coletas?embed=1&lotacao=1',{cookie});
  check('tela de coletas tem o seletor de clientes cadastrados',r.status===200&&r.text.includes('lcCliSel')&&r.text.includes('Cadastro de clientes')&&!r.text.includes('id="endereco_coleta" readonly'),'status '+r.status);

  r=await call('DELETE','/api/painel/lotacao-clientes/'+cli?.id,{cookie});check('exclui o cliente',r.status===200,'veio '+r.status);
  r=await call('GET','/coletas/api/coletas',{cookie});
  check('a coleta feita com o cliente continua igual',r.json?.find?.(x=>String(x.id)===String(coletaId))?.endereco_coleta===end);

  console.log(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail?1:0)
})().catch(e=>{console.error(e);process.exit(1)});
