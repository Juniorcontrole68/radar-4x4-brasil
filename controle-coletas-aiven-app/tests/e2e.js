// Teste ponta a ponta do servidor em modo teste (TEST_MODE=1) com banco vazio.
// Cobre: endereços que exigem login, aba Lotação do dashboard, datas no fuso de São Paulo
// e o ciclo completo do GPS (ativação, romaneio, encerramento, 2º romaneio no mesmo dia).
//
// Uso:  BASE_URL=http://127.0.0.1:10000 ADMIN_USER=admin_teste ADMIN_PASS=... node tests/e2e.js
// Nunca rode contra a produção: o teste cria coletas, aparelhos e romaneios fictícios.
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
if(/onrender\.com/i.test(B)&&!/teste/i.test(B)){console.error('Recusado: BASE_URL parece ser a produção.');process.exit(2)}
let pass=0,fail=0;
function check(name,cond,extra=''){ if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,extra);if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name+' '+extra).replace(/\r?\n/g,' ').slice(0,900))} }
async function call(method,path,{body,cookie,bearer,headers}={}){
  const h={...(headers||{})}; if(body!==undefined)h['Content-Type']='application/json'; if(cookie)h.Cookie=cookie; if(bearer)h.Authorization='Bearer '+bearer;
  const r=await fetch(B+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});
  const text=await r.text(); let json=null; try{json=JSON.parse(text)}catch{}
  return {status:r.status,json,text,setCookie:r.headers.get('set-cookie')||''};
}
(async()=>{
  console.log('A. Sem login');
  for(const [m,p,b] of [['GET','/coletas/api/config'],['GET','/coletas/api/coletas'],['POST','/coletas/api/coletas',{cliente:'X',endereco_entrega:'Y'}],['PUT','/coletas/api/coletas/1',{status:'Cancelada'}],
      ['GET','/api/painel/coletas-status-resumo'],['GET','/api/painel/carregamentos-finais'],['GET','/api/painel/carregamentos-finais/1/foto'],['GET','/api/painel/carregamentos-finais/1/avaria/1'],
      ['PATCH','/api/painel/carregamentos-finais/1/coleta-devolucao',{}],['POST','/api/painel/carregamentos-finais',{}],['GET','/api/painel/nf-materiais'],['POST','/api/painel/nf-materiais/import',{rows:[]}],
      ['GET','/api/painel/coletas-resumo'],['GET','/api/painel/motoristas-veiculos'],['GET','/api/bills']]){
    const r=await call(m,p,{body:b}); check(m+' '+p+' -> 401',r.status===401,'veio '+r.status+' '+r.text.slice(0,80));
  }
  let r=await call('GET','/api/painel/carregamentos-finais',{headers:{'X-Internal-Key':'chave-errada'}}); check('chave interna errada -> 401',r.status===401,'veio '+r.status);
  r=await call('GET','/'); check('página inicial abre e mostra a faixa de teste',r.status===200&&r.text.includes('AMBIENTE DE TESTE'));

  console.log('B. Com login de administrador');
  r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});
  const cookie=(r.setCookie.match(/cl_session=[^;]+/)||[''])[0]; check('login',r.status===200&&!!cookie,r.text.slice(0,100));
  r=await call('GET','/coletas/api/coletas',{cookie}); check('lista de coletas (vazia)',r.status===200&&Array.isArray(r.json)&&r.json.length===0,r.text.slice(0,100));
  r=await call('POST','/coletas/api/coletas',{cookie,body:{cliente:'REMETENTE FICTICIO',endereco_entrega:'Rua de Teste, 100 - Campinas - SP',frete_cobrado:1500,frete_pago:900,pedagio:100,data_carregamento:'2026-10-08',motorista:'MOTORISTA TESTE',placa:'ABC1D23',tipo_caminhao:'Truck',implemento:'Baú'}});
  check('cria coleta; lucro = 1500-900-100 = 500',r.status===201&&Number(r.json?.lucro)===500,r.text.slice(0,160));
  const coletaId=r.json?.id;
  r=await call('GET','/api/lotacao?from=2026-10-01&to=2026-10-31',{cookie});
  check('aba Lotação do dashboard responde (antes: HTTP 500)',r.status===200&&r.json?.ok===true&&r.json.rows?.length===1&&Number(r.json.rows[0].lucro)===500,r.status+' '+r.text.slice(0,160));
  r=await call('GET','/api/carregamentos-finais',{cookie}); check('dashboard -> carregamentos (chave interna)',r.status===200&&r.json?.ok===true,r.status+' '+r.text.slice(0,120));
  r=await call('GET','/api/nf-materiais',{cookie}); check('dashboard -> notas (chave interna)',r.status===200&&r.json?.ok===true,r.status+' '+r.text.slice(0,120));
  r=await call('GET','/api/coletas/status',{cookie}); check('dashboard -> resumo de coletas (chave interna)',r.status===200&&r.json?.ok===true&&Number(r.json.total)===1,r.status+' '+r.text.slice(0,120));
  r=await call('PATCH','/api/painel/coletas-financeiro/'+coletaId,{cookie,body:{recebido:true}});
  const spHoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  check('recebido sem data grava a data de São Paulo ('+spHoje+')',r.status===200&&String(r.json?.data_recebimento).slice(0,10)===spHoje,r.text.slice(0,120));

  r=await call('PATCH','/api/painel/coletas-status/'+coletaId,{body:{status:'Entregue'}}); check('trocar status sem login -> 401',r.status===401,'veio '+r.status);
  r=await call('PATCH','/api/painel/coletas-status/'+coletaId,{cookie,body:{status:'Em trânsito'}}); check('trocar status da coleta para "Em trânsito"',r.status===200&&r.json?.row?.status==='Em trânsito',r.text.slice(0,120));
  r=await call('PATCH','/api/painel/coletas-status/'+coletaId,{cookie,body:{status:'Qualquer'}}); check('status inválido é recusado (400)',r.status===400,'veio '+r.status);
  r=await call('GET','/coletas?embed=1',{cookie}); check('tela de coletas abre com o botão de status e a função dele',r.status===200&&r.text.includes('editStatusInline(${c.id},this)')&&r.text.includes('window.editStatusInline='),'status '+r.status);
  console.log('C. Ciclo do GPS');
  r=await call('GET','/api/tracking/app-update?channel=normal&version_code=0'); check('app consulta atualização sem login (antes: 401)',r.status===200&&r.json?.ok===true,r.status+' '+r.text.slice(0,100));
  r=await call('POST','/api/tracking/register-request',{body:{driver_name:'Motorista Teste',vehicle_plate:'ABC1D23',device_name:'Aparelho de Teste'}});
  const rq=r.json?.request_token; check('aparelho pede ativação (pendente)',r.status===201&&r.json?.status==='pending');
  r=await call('GET','/api/painel/tracking/requests',{cookie}); const reqId=r.json?.rows?.[0]?.id; check('central vê o pedido',!!reqId,r.text.slice(0,120));
  r=await call('POST','/api/painel/tracking/requests/'+reqId+'/approve',{cookie,body:{}}); check('central aprova',r.json?.status==='approved',r.text.slice(0,120));
  r=await call('GET','/api/tracking/register-status?request_token='+rq); const dev=r.json?.token; check('aparelho recebe o token',!!dev);
  const ponto=()=>call('POST','/api/tracking/point',{bearer:dev,body:{latitude:-22.70,longitude:-47.31,accuracy_m:8,captured_at:new Date().toISOString()}});
  r=await call('GET','/api/tracking/assignment/current',{bearer:dev}); check('sem romaneio: nenhuma associação',r.status===200&&r.json?.assignment===null,r.text.slice(0,120));
  r=await call('POST','/api/painel/tracking/assignment',{cookie,body:{driver_name:'Motorista Teste',vehicle_plate:'ABC1D23',romaneios:['AMR000001'],work_date:spHoje}}); check('1º romaneio associado',r.status===201,r.text.slice(0,120));
  r=await ponto(); const s1=r.json?.session_id; check('1º romaneio: posição aceita',r.status===200&&!!s1,r.status+' '+r.text.slice(0,120));
  const ontem=new Date(Date.now()-86400000).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  r=await call('POST','/api/painel/tracking/assignment',{cookie,body:{driver_name:'Motorista Teste',vehicle_plate:'ABC1D23',romaneios:['AMR000000'],work_date:ontem,stop:true,active:false}}); check('stop referente a ONTEM é aceito',r.json?.stopped===true,r.text.slice(0,120));
  r=await ponto(); check('  ...e NÃO derruba o rastreio de hoje (antes: derrubava)',r.status===200&&r.json?.session_id===s1,r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/painel/tracking/assignment',{cookie,body:{driver_name:'Motorista Teste',vehicle_plate:'ABC1D23',romaneios:['AMR000001'],work_date:spHoje,stop:true,active:false,reason:'ultima_entrega_baixada'}}); check('última baixa: stop de HOJE',r.json?.stopped===true,r.text.slice(0,120));
  r=await call('GET','/api/tracking/assignment/current',{bearer:dev}); check('  app passa a ver "sem romaneio"',r.json?.assignment===null);
  r=await ponto(); check('  posição depois do encerramento é recusada (409)',r.status===409,r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/painel/tracking/assignment',{cookie,body:{driver_name:'Motorista Teste',vehicle_plate:'ABC1D23',romaneios:['AMR000002'],work_date:spHoje}}); check('2º romaneio do mesmo dia associado',r.status===201,r.text.slice(0,120));
  r=await ponto(); const s2=r.json?.session_id; check('2º romaneio: posição aceita em sessão nova (antes: 409 o dia todo)',r.status===200&&!!s2&&s2!==s1,r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/tracking/heartbeat',{bearer:dev,body:{session_id:s2}}); check('heartbeat confirma a sessão nova',r.json?.session_id===s2,r.text.slice(0,120));
  r=await call('GET','/api/painel/tracking/live?light=1',{cookie}); const live=r.json?.rows?.[0]; check('mapa ao vivo mostra o motorista em rota com o 2º romaneio',r.status===200&&live?.session_status==='active'&&JSON.stringify(live?.romaneios)==='["AMR000002"]',r.text.slice(0,200));
  console.log('\nResultado: '+pass+' OK, '+fail+' falha(s)');
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
