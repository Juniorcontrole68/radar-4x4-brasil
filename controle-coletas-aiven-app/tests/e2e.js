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

  console.log('D. Celular do motorista: recuperação automática e diagnóstico');
  // Acesso direto ao banco só para simular a passagem do tempo (aparelho parado, aparelho antigo).
  let db=null;
  try{const {Pool}=require('pg');if(process.env.DATABASE_URL){db=new Pool({connectionString:process.env.DATABASE_URL});await db.query('SELECT 1')}}catch(e){db=null}
  const hb=(bearer,body={})=>call('POST','/api/tracking/heartbeat',{bearer,body});
  r=await hb(dev,{session_id:'999999999'}); check('heartbeat com sessão vencida continua valendo como sinal de vida (antes: 409)',r.status===200&&r.json?.session_id===s2,r.status+' '+r.text.slice(0,120));
  r=await hb(dev,{app_version:'1.1.0',health:{battery_pct:63,charging:false,gps_on:false,perm_location:true,perm_background:false,battery_unrestricted:false,version_code:11,lixo:'<script>',net:'cell'}});
  check('heartbeat aceita o diagnóstico do aplicativo e devolve a versão publicada',r.status===200&&Number(r.json?.latest_version_code)>0&&/\.apk$/.test(String(r.json?.apk_url||'')),r.text.slice(0,200));
  r=await call('GET','/api/painel/tracking/live?light=1',{cookie}); let lv=r.json?.rows?.find(x=>x.vehicle_plate==='ABC1D23');
  check('central recebe o diagnóstico (GPS desligado, bateria 63%, versão 1.1.0) sem campos estranhos',lv?.app_version==='1.1.0'&&lv?.health?.gps_on===false&&lv?.health?.battery_pct===63&&lv?.health?.lixo===undefined&&lv?.never_connected===false,JSON.stringify(lv||{}).slice(0,300));

  // Pedido antigo aprovado por engano: o aparelho que está funcionando não pode ser derrubado.
  r=await call('POST','/api/tracking/register-request',{body:{driver_name:'Motorista Teste',vehicle_plate:'ABC1D23',device_name:'Aparelho de Teste 2'}});
  const rq2=r.json?.request_token; check('2º pedido do mesmo motorista/placa com outro aparelho fica pendente',r.status===201&&r.json?.status==='pending',r.text.slice(0,120));
  r=await call('GET','/api/painel/tracking/requests',{cookie}); const pend=r.json?.rows?.find(x=>x.status==='pending'&&x.vehicle_plate==='ABC1D23');
  check('central vê o pedido com o aviso "já tem um celular funcionando"',!!pend&&pend.has_live_device===true,r.text.slice(0,200));
  r=await call('POST','/api/painel/tracking/requests/'+pend.id+'/approve',{cookie,body:{}}); check('central aprova o 2º aparelho',r.json?.status==='approved',r.text.slice(0,120));
  r=await hb(dev); check('  aparelho antigo continua enviando (antes: 401 para sempre, sem aviso)',r.status===200,r.status+' '+r.text.slice(0,120));
  r=await call('GET','/api/painel/tracking/live?light=1',{cookie}); lv=r.json?.rows?.find(x=>x.vehicle_plate==='ABC1D23');
  check('  mapa segue mostrando o aparelho que está vivo, não o que nunca conectou',lv?.device_name==='Aparelho de Teste'&&lv?.never_connected===false,JSON.stringify(lv||{}).slice(0,200));
  r=await call('GET','/api/tracking/register-status?request_token='+rq2); const dev2=r.json?.token; check('2º aparelho recebe a credencial',!!dev2);
  if(db){
    await db.query("UPDATE driver_tracking_devices SET active=FALSE WHERE device_name='Aparelho de Teste'");
    r=await hb(dev); check('aparelho desativado volta a valer sozinho quando o substituto nunca conectou',r.status===200,r.status+' '+r.text.slice(0,120));
    // O 2º aparelho conecta de verdade: o antigo cede a vez.
    r=await hb(dev2,{app_version:'1.1.0'}); check('2º aparelho conecta',r.status===200,r.status+' '+r.text.slice(0,120));
    r=await hb(dev); check('  com o novo funcionando, o aparelho antigo é recusado (401)',r.status===401,r.status+' '+r.text.slice(0,120));
    r=await call('GET','/api/tracking/assignment/current',{bearer:dev}); check('  ...e continua recusado nas outras chamadas',r.status===401,r.status+' '+r.text.slice(0,120));
    // O novo fica parado (celular desligado): o antigo, se ainda estiver rodando, reassume.
    await db.query("UPDATE driver_tracking_devices SET last_seen_at=NOW()-INTERVAL '30 minutes' WHERE device_name='Aparelho de Teste 2'");
    r=await hb(dev); check('  se o novo parar por mais de 10 minutos, o antigo reassume sozinho',r.status===200,r.status+' '+r.text.slice(0,120));
    await db.query("UPDATE driver_tracking_devices SET last_seen_at=NOW()-INTERVAL '30 minutes' WHERE device_name='Aparelho de Teste'");
  }else console.log('  (sem acesso direto ao banco: testes de passagem de tempo pulados)');
  r=await hb(dev2,{app_version:'1.1.0',health:{gps_on:true,perm_location:true,perm_background:true,battery_unrestricted:true,battery_pct:80}}); check('2º aparelho segue ativo',r.status===200,r.status+' '+r.text.slice(0,120));

  // Fila do aplicativo: posições guardadas sem internet chegam em lote, sem duplicar.
  const t0=Date.now()-20*60000,pt=(i,extra={})=>({latitude:-22.70-i*0.001,longitude:-47.31,accuracy_m:9,battery_pct:77,captured_at:new Date(t0+i*15000).toISOString(),...extra});
  r=await call('POST','/api/tracking/points',{bearer:dev2,body:{points:[pt(1),pt(2),pt(3),pt(4,{latitude:10,longitude:10}),pt(5,{captured_at:'2020-01-01T00:00:00Z'})]}});
  check('lote de posições: grava 3, ignora a fora da área e a antiga',r.status===200&&r.json?.saved===3&&r.json?.ignored===2,r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/tracking/points',{bearer:dev2,body:{points:[pt(1),pt(2),pt(3),pt(6)]}});
  check('reenvio do mesmo lote não duplica (grava só a posição nova)',r.status===200&&r.json?.saved===1&&r.json?.ignored===3,r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/tracking/points',{body:{points:[pt(7)]}}); check('lote sem credencial -> 401',r.status===401,'veio '+r.status);

  // Aprovado que nunca conectou não aparece mais como "Em rota".
  r=await call('POST','/api/tracking/register-request',{body:{driver_name:'Motorista Fantasma',vehicle_plate:'XYZ9Z99',device_name:'Aparelho Fantasma'}});
  r=await call('GET','/api/painel/tracking/requests',{cookie}); const ghost=r.json?.rows?.find(x=>x.status==='pending'&&x.vehicle_plate==='XYZ9Z99');
  check('pedido de motorista novo aparece sem o aviso de celular funcionando',!!ghost&&ghost.has_live_device===false,r.text.slice(0,200));
  r=await call('POST','/api/painel/tracking/requests/'+ghost.id+'/approve',{cookie,body:{}});
  r=await call('GET','/api/painel/tracking/live?light=1',{cookie}); lv=r.json?.rows?.find(x=>x.vehicle_plate==='XYZ9Z99');
  check('aprovado que não conectou: sem sessão "Em rota" e marcado como nunca conectou',!!lv&&lv.session_id===null&&lv.never_connected===true&&lv.map_active===false,JSON.stringify(lv||{}).slice(0,240));
  r=await call('GET','/api/painel/tracking/requests',{cookie}); const ghostOk=r.json?.rows?.find(x=>x.vehicle_plate==='XYZ9Z99');
  check('lista de pedidos marca o aprovado que ainda não conectou',ghostOk?.status==='approved'&&ghostOk?.never_connected===true,JSON.stringify(ghostOk||{}).slice(0,200));

  // Pedido pendente antigo de quem já tem aprovação mais nova não volta para a fila.
  if(db){
    await db.query("INSERT INTO driver_tracking_requests(request_token_hash,driver_name,vehicle_plate,device_name,status,created_at) VALUES('hash-antigo-teste','Motorista Teste','ABC1D23','Aparelho velho','pending',NOW()-INTERVAL '3 days')");
    r=await call('GET','/api/painel/tracking/requests',{cookie});
    check('pedido pendente antigo de motorista já aprovado não aparece para aprovar',!r.json?.rows?.some(x=>x.device_name==='Aparelho velho'),r.text.slice(0,200));
  }

  // Telefone do motorista (para o botão "Avisar no WhatsApp" ir direto no contato).
  r=await call('GET','/api/painel/tracking/contacts'); check('telefones sem login -> 401',r.status===401,'veio '+r.status);
  r=await call('PUT','/api/tracking/contacts',{cookie,body:{driver_name:'Motorista Tésté',phone:'(19) 99999-8888'}}); check('salva o WhatsApp do motorista pelo dashboard',r.status===200&&r.json?.phone==='5519999998888'&&r.json?.driver_key==='MOTORISTA TESTE',r.status+' '+r.text.slice(0,160));
  r=await call('PUT','/api/tracking/contacts',{cookie,body:{driver_name:'Motorista Teste',phone:'12345'}}); check('telefone inválido é recusado (400)',r.status===400,r.status+' '+r.text.slice(0,120));
  r=await call('GET','/api/tracking/contacts',{cookie}); check('lista de telefones traz o motorista',r.status===200&&r.json?.rows?.length===1&&r.json.rows[0].phone==='5519999998888',r.text.slice(0,160));
  r=await call('PUT','/api/tracking/contacts',{cookie,body:{driver_name:'Motorista Teste',phone:''}}); r=await call('GET','/api/tracking/contacts',{cookie}); check('telefone em branco remove o contato',r.json?.rows?.length===0,r.text.slice(0,120));
  r=await call('GET','/dashboard',{cookie}); check('tela de rastreio traz o quadro "Motoristas de hoje"',r.status===200&&r.text.includes('id="trackingBoardTable"')&&r.text.includes('id="trackingSupport"'),'status '+r.status);

  console.log('E. MOVIT: rota do dia do motorista da empresa');
  r=await call('POST','/api/tracking/movit-link',{body:{}}); check('pedir vínculo sem credencial do aparelho -> 401',r.status===401,'veio '+r.status);
  r=await call('POST','/api/tracking/movit-link',{bearer:dev2,body:{}}); const code=r.json?.code;
  check('app do motorista recebe um código de uso único e o link do MOVIT',r.status===201&&/^[a-f0-9]{24}$/.test(code||'')&&r.json?.app_url==='movit://empresa/'+code,r.status+' '+r.text.slice(0,160));
  r=await call('POST','/api/router-app/company/claim',{body:{code:'0'.repeat(24)}}); check('código inexistente é recusado (404)',r.status===404,'veio '+r.status);
  r=await call('GET','/api/router-app/company/today'); check('rota do dia sem vínculo -> 401',r.status===401,'veio '+r.status);
  r=await call('POST','/api/router-app/company/claim',{body:{code}}); const ctk=r.json?.company_token;
  check('MOVIT troca o código pelo vínculo com motorista e placa',r.status===200&&!!ctk&&r.json?.driver_name==='Motorista Teste'&&r.json?.vehicle_plate==='ABC1D23',r.status+' '+r.text.slice(0,200));
  r=await call('POST','/api/router-app/company/claim',{body:{code}}); check('o mesmo código não vale duas vezes',r.status===404,'veio '+r.status);
  r=await call('GET','/api/router-app/company/today',{bearer:ctk});
  check('sem rota disponível: resposta vazia com explicação, sem erro',r.status===200&&r.json?.ok===true&&Array.isArray(r.json.stops)&&r.json.stops.length===0&&!!r.json.message&&JSON.stringify(r.json.romaneios)==='["AMR000002"]',r.status+' '+r.text.slice(0,260));
  // A operação exporta a rota do romaneio (como o MOVIT/central já fazem): ela vira a rota do dia.
  const paradas=[{lat:-22.74,lon:-47.33,label:'CLIENTE A',resolved:'Rua Um, 10, Americana - SP',destinatario:'CLIENTE A',nf:'1001'},{lat:-22.90,lon:-47.06,label:'CLIENTE B',resolved:'Av. Dois, 200, Campinas - SP',destinatario:'CLIENTE B',nf:'1002',entregue:true},{lat:'x',lon:1,label:'sem coordenada'}];
  r=await call('POST','/api/public-router/export-construlog',{body:{romaneio:'AMR000002',driver_name:'Motorista Teste',event_date:spHoje,title:'Rota teste',route_data:{stops:paradas,start:{lat:-22.69552,lon:-47.307,label:'Base'},returnToStart:true,distanceMeters:81234}}});
  check('rota do romaneio exportada',r.status===200&&r.json?.ok===true,r.status+' '+r.text.slice(0,160));
  await new Promise(z=>setTimeout(z,300));
  r=await call('GET','/api/router-app/company/today?fresh=1',{bearer:ctk});
  if(r.json&&!r.json.stops?.length){await new Promise(z=>setTimeout(z,21000));r=await call('GET','/api/router-app/company/today?fresh=1',{bearer:ctk})}
  const dia=r.json||{};
  check('rota do dia traz as paradas na ordem, com cliente, nota e o que já foi entregue',dia.source==='movit'&&dia.stops?.length===2&&dia.stops[0].destinatario==='CLIENTE A'&&dia.stops[0].seq===1&&dia.stops[1].nf==='1002'&&dia.stops[1].entregue===true&&dia.start?.label==='Base'&&dia.distanceMeters===81234,r.text.slice(0,400));
  // Novo vínculo do mesmo aparelho substitui o anterior (celular trocado ou MOVIT reinstalado).
  r=await call('POST','/api/tracking/movit-link',{bearer:dev2,body:{}}); const code2=r.json?.code;
  r=await call('POST','/api/router-app/company/claim',{body:{code:code2}}); const ctk2=r.json?.company_token;
  r=await call('GET','/api/router-app/company/today',{bearer:ctk}); check('vínculo antigo deixa de valer quando um novo é criado',r.status===401,'veio '+r.status);
  r=await call('GET','/api/router-app/company/today',{bearer:ctk2}); check('vínculo novo recebe a mesma rota',r.status===200&&r.json?.stops?.length===2,r.status+' '+r.text.slice(0,120));
  // Troca de celular com o cadastro digitado diferente do SSW (caso real de 09/10: "Carlos André
  // Oliveira de jesus" / RDV4F12 no celular novo; "Carlos Andre Oliveira de Jesus" / RVD4F12 no SSW).
  console.log('F. Troca de celular: nome com acento e placa digitada com letras trocadas');
  const cadastra=async(nome,placa,modelo)=>{
    let x=await call('POST','/api/tracking/register-request',{body:{driver_name:nome,vehicle_plate:placa,device_name:modelo}});const tk=x.json?.request_token;
    x=await call('GET','/api/painel/tracking/requests',{cookie});const pd=x.json?.rows?.find(y=>y.status==='pending'&&y.device_name===modelo);
    if(pd)await call('POST','/api/painel/tracking/requests/'+pd.id+'/approve',{cookie,body:{}});
    x=await call('GET','/api/tracking/register-status?request_token='+tk);return x.json?.token};
  const doMotorista=async re=>((await call('GET','/api/painel/tracking/live?light=1',{cookie})).json?.rows||[]).filter(x=>re.test(x.driver_name));
  // O mapa ao vivo já junta aparelhos de mesma placa; para saber quais estão ativos de fato, olha o banco.
  const ativos=async()=>(await db.query("SELECT device_name FROM driver_tracking_devices WHERE active=TRUE AND device_name LIKE '%do Carlos' ORDER BY id")).rows.map(x=>x.device_name).join(', ');
  const velho=await cadastra('Carlos Andre Oliveira de Jesus','RVD4F12','Celular antigo do Carlos');
  await hb(velho);
  r=await call('POST','/api/painel/tracking/assignment',{cookie,body:{driver_name:'Carlos Andre Oliveira de Jesus',vehicle_plate:'RVD4F12',romaneios:['AMR001058-8'],work_date:spHoje}});
  if(db){
    await db.query("UPDATE driver_tracking_devices SET enrolled_at=NOW()-INTERVAL '5 days',last_seen_at=NOW()-INTERVAL '2 days' WHERE device_name='Celular antigo do Carlos'");
    const novo=await cadastra('Carlos André  Oliveira de jesus','rdv-4f12','Celular novo do Carlos');
    check('celular novo é aprovado e recebe a credencial',!!novo);
    let dele=await doMotorista(/^carlos andr/i);
    check('aprovar o celular novo aposenta o antigo parado, mesmo com nome e placa digitados diferente',await ativos()==='Celular novo do Carlos'&&dele.length===1,await ativos());
    r=await call('GET','/api/tracking/assignment/current',{bearer:novo});
    check('celular novo recebe o romaneio do dia (antes: nenhum, e o GPS não iniciava)',JSON.stringify(r.json?.assignment?.romaneios)==='["AMR001058-8"]'&&!('mesma_placa' in (r.json?.assignment||{})),r.text.slice(0,160));
    dele=await doMotorista(/^carlos andr/i);
    check('cadastro do celular passa a usar a placa do romaneio',dele[0]?.vehicle_plate==='RVD4F12','placa '+dele[0]?.vehicle_plate);
    // Estado que já existe em produção: os dois aparelhos ativos, o antigo parado há dias.
    await db.query("UPDATE driver_tracking_devices SET active=TRUE WHERE device_name='Celular antigo do Carlos'");
    check('  (preparo) os dois aparelhos ativos, como está em produção',await ativos()==='Celular antigo do Carlos, Celular novo do Carlos',await ativos());
    r=await hb(novo); check('celular novo dá sinal e abre a sessão do dia',r.status===200&&!!r.json?.session_id,r.status+' '+r.text.slice(0,120));
    dele=await doMotorista(/^carlos andr/i);
    check('ao dar sinal, o celular novo aposenta o antigo parado: um motorista, um celular',await ativos()==='Celular novo do Carlos'&&dele.length===1&&dele[0].device_name==='Celular novo do Carlos',await ativos());
    check('mapa ao vivo mostra o romaneio no celular novo',JSON.stringify(dele[0]?.romaneios)==='["AMR001058-8"]',JSON.stringify(dele[0]?.romaneios));
    r=await call('POST','/api/tracking/point',{bearer:novo,body:{latitude:-22.70,longitude:-47.31,accuracy_m:8,captured_at:new Date().toISOString()}});
    check('celular novo envia posição',r.status===200||r.status===201,r.status+' '+r.text.slice(0,120));
    // O antigo, se voltar a dar sinal com o novo funcionando, é recusado (não vira segundo motorista).
    r=await hb(velho); check('celular antigo é recusado enquanto o novo está funcionando',r.status===401,r.status+' '+r.text.slice(0,120));
    check('  ...e continua inativo',await ativos()==='Celular novo do Carlos',await ativos());
    // Homônimo parcial não é o mesmo motorista.
    const outro=await cadastra('Carlos Andre Oliveira','RVD4F12','Celular de outro Carlos');
    await hb(outro); r=await hb(novo);
    check('motorista de nome parecido, mas diferente, não derruba o celular do Carlos',r.status===200,r.status+' '+r.text.slice(0,120));
    // Aparelho recém-aprovado que ainda não conectou não é derrubado pelo antigo que segue funcionando.
    const troca=await cadastra('CARLOS ANDRÉ OLIVEIRA DE JESUS','RVD4F12','Terceiro celular do Carlos');
    r=await hb(novo); check('aparelho em uso continua valendo enquanto o recém-aprovado não conecta',r.status===200,r.status+' '+r.text.slice(0,120));
    check('  ...e o recém-aprovado continua ativo, esperando conectar',await ativos()==='Celular novo do Carlos, Terceiro celular do Carlos',await ativos());
    r=await hb(troca); check('recém-aprovado conecta',r.status===200,r.status+' '+r.text.slice(0,120));
    r=await hb(novo); check('  ...e o anterior cede a vez',r.status===401&&await ativos()==='Terceiro celular do Carlos',r.status+' '+await ativos());
  }else console.log('  (pulado: precisa de acesso direto ao banco para simular aparelho parado)');

  // A central escolhe, ao aprovar, a qual motorista do dia pertence o celular.
  console.log('G. Aprovação: a central escolhe o motorista do romaneio');
  const pedido=async(nome,placa,modelo)=>{
    let x=await call('POST','/api/tracking/register-request',{body:{driver_name:nome,vehicle_plate:placa,device_name:modelo}});const tk=x.json?.request_token;
    x=await call('GET','/api/painel/tracking/requests',{cookie});return{tk,row:x.json?.rows?.find(y=>y.status==='pending'&&y.device_name===modelo)}};
  r=await call('POST','/api/painel/tracking/assignment',{cookie,body:{driver_name:'FABIANO ROGERIO ELIAS',vehicle_plate:'EIJ9C59',romaneios:['AMR001062-6'],work_date:spHoje}});
  let pd=await pedido('fabiano','EIJ9C95','Celular do Fabiano');
  check('pedido com apelido e placa trocada entra na fila',!!pd.row&&pd.row.driver_name==='fabiano',JSON.stringify(pd.row||{}).slice(0,160));
  r=await call('POST','/api/painel/tracking/requests/'+pd.row.id+'/approve',{cookie,body:{driver_name:'Fabiano Rogerio Elias',vehicle_plate:'123'}});
  check('placa escolhida inválida é recusada (400) e o pedido continua pendente',r.status===400,r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/tracking/requests/'+pd.row.id+'/approve',{cookie,body:{driver_name:'Fabiano Rogerio Elias',vehicle_plate:'eij-9c59'}});
  check('aprovação pelo dashboard com o motorista escolhido',r.status===200&&r.json?.status==='approved'&&r.json?.driver_name==='Fabiano Rogerio Elias'&&r.json?.vehicle_plate==='EIJ9C59',r.status+' '+r.text.slice(0,160));
  r=await call('GET','/api/tracking/register-status?request_token='+pd.tk); const fab=r.json?.token;
  check('aplicativo recebe a credencial com o nome e a placa do romaneio',!!fab&&r.json?.driver_name==='Fabiano Rogerio Elias'&&r.json?.vehicle_plate==='EIJ9C59',r.text.slice(0,160));
  r=await call('GET','/api/tracking/assignment/current',{bearer:fab});
  check('celular recebe o romaneio do dia mesmo tendo digitado "fabiano" e a placa errada',JSON.stringify(r.json?.assignment?.romaneios)==='["AMR001062-6"]',r.text.slice(0,160));
  if(db){
    const g=(await db.query("SELECT r.driver_name,r.vehicle_plate,r.typed_driver_name,r.typed_vehicle_plate,d.driver_name AS dn,d.vehicle_plate AS dp FROM driver_tracking_requests r JOIN driver_tracking_devices d ON d.id=r.approved_device_id WHERE r.device_name='Celular do Fabiano'")).rows[0]||{};
    check('cadastro do celular fica com o motorista escolhido; o que foi digitado fica guardado',g.dn==='Fabiano Rogerio Elias'&&g.dp==='EIJ9C59'&&g.typed_driver_name==='fabiano'&&g.typed_vehicle_plate==='EIJ9C95',JSON.stringify(g));
  }
  pd=await pedido('Motorista Sem Romaneio','QWE1R23','Celular sem romaneio');
  r=await call('POST','/api/tracking/requests/'+pd.row.id+'/approve',{cookie,body:{}});
  check('sem escolha, vale o que o motorista digitou (como antes)',r.status===200&&r.json?.driver_name==='Motorista Sem Romaneio'&&r.json?.vehicle_plate==='QWE1R23',r.status+' '+r.text.slice(0,160));

  // A central abre no próprio celular a rota do dia de um motorista (sem ser motorista).
  console.log('H. Simulação da rota do dia no MOVIT');
  r=await call('POST','/api/painel/tracking/movit-simulacao',{body:{driver_name:'Motorista Teste',vehicle_plate:'ABC1D23'}}); check('simulação sem login -> 401',r.status===401,'veio '+r.status);
  r=await call('POST','/api/tracking/movit-simulacao',{cookie,body:{driver_name:'',vehicle_plate:'ABC1D23'}}); check('simulação sem motorista -> 400',r.status===400,'veio '+r.status);
  r=await call('POST','/api/tracking/movit-simulacao',{cookie,body:{driver_name:'Motorista Teste',vehicle_plate:'abc-1d23'}}); const sim=r.json||{};
  check('central gera o link de simulação pelo dashboard',r.status===201&&/^[a-f0-9]{24}$/.test(sim.code||'')&&sim.app_url==='movit://empresa/'+sim.code&&String(sim.open_url).endsWith('/movit/empresa/'+sim.code)&&sim.vehicle_plate==='ABC1D23',r.status+' '+r.text.slice(0,200));
  r=await call('GET','/movit/empresa/'+sim.code); check('página do link mostra o motorista e o botão que abre o MOVIT',r.status===200&&r.text.includes('Motorista Teste')&&r.text.includes('href="movit://empresa/'+sim.code+'"')&&r.text.includes('/downloads/MOVIT.apk'),r.status+' '+r.text.slice(0,120));
  r=await call('POST','/api/router-app/company/claim',{body:{code:sim.code}}); const stk=r.json?.company_token;
  check('MOVIT troca o código pelo vínculo de simulação',r.status===200&&!!stk&&r.json?.driver_name==='Motorista Teste',r.status+' '+r.text.slice(0,160));
  r=await call('GET','/api/router-app/company/today?fresh=1',{bearer:stk});
  if(r.json&&r.json.building){await new Promise(z=>setTimeout(z,21000));r=await call('GET','/api/router-app/company/today?fresh=1',{bearer:stk})}
  check('simulação recebe a mesma rota do dia do motorista (2 paradas, na ordem)',r.status===200&&r.json?.stops?.length===2&&r.json.stops[0].destinatario==='CLIENTE A',r.status+' '+r.text.slice(0,200));
  r=await call('POST','/api/router-app/company/claim',{body:{code:sim.code}}); check('código de simulação só abre uma vez',r.status===404,'veio '+r.status);
  r=await call('GET','/movit/empresa/'+sim.code); check('página de link já usado avisa que venceu',r.status===410&&!r.text.includes('movit://empresa/'),r.status+' '+r.text.slice(0,120));
  r=await call('GET','/api/router-app/company/today',{bearer:ctk2}); check('o vínculo do próprio motorista continua valendo',r.status===200&&r.json?.stops?.length===2,r.status+' '+r.text.slice(0,120));
  if(db){
    await db.query("UPDATE router_company_links SET claimed_at=NOW()-INTERVAL '25 hours' WHERE simulation=TRUE AND token_hash IS NOT NULL");
    r=await call('GET','/api/router-app/company/today',{bearer:stk}); check('simulação vence 24 horas depois de aberta',r.status===401&&/simulação vencido/.test(r.text),r.status+' '+r.text.slice(0,120));
    r=await call('GET','/api/router-app/company/today',{bearer:ctk2}); check('  ...sem afetar o vínculo do motorista',r.status===200,'veio '+r.status);
  }
  if(db)await db.end();
  console.log('\nResultado: '+pass+' OK, '+fail+' falha(s)');
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
