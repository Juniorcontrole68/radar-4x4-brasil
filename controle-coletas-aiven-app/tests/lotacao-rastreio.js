// Rastreio de carga lotação: viagem que começa na base do cliente (fora da área de Americana) e
// link público que acompanha o motorista até a entrega e para de mostrar quando ela é confirmada.
// Roda contra o servidor em TEST_MODE (banco vazio), como tests/e2e.js. Nunca rode contra a produção.
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
if(/onrender\.com/i.test(B)&&!/teste/i.test(B)){console.error('Recusado: BASE_URL parece ser a produção.');process.exit(2)}
const lr=require('../lotacao-rastreio');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name).replace(/[\r\n]+/g,' '))}}
async function call(method,path,{body,cookie,bearer}={}){
  const h={};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;if(bearer)h.Authorization='Bearer '+bearer;
  const r=await fetch(B+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});
  const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}
  return{status:r.status,json,text,headers:r.headers}
}
const agora=()=>new Date().toISOString();
const GOIANIA={latitude:-16.6869,longitude:-49.2648},ANAPOLIS={latitude:-16.3281,longitude:-48.9530},MANAUS={latitude:-3.119,longitude:-60.0217};

(async()=>{
  console.log('Leitura dos campos (sem rede)');
  check('coordenada colada como "lat, lon"',JSON.stringify(lr.lerCoordenadas('-25.4284, -49.2733'))==='{"lat":-25.4284,"lon":-49.2733}');
  check('link do Google Maps com @lat,lon',JSON.stringify(lr.lerCoordenadas('https://www.google.com/maps/place/X/@-16.6869,-49.2648,15z'))==='{"lat":-16.6869,"lon":-49.2648}');
  check('coordenada fora do Brasil é recusada (lat/lon trocados)',lr.lerCoordenadas('-49.27, -25.43')===null);
  check('cidade e UF tiradas do endereço da coleta',JSON.stringify(lr.cidadeUfDoTexto('Rua de Teste, 100 - Campinas - SP'))==='{"cidade":"Campinas","uf":"SP"}');
  check('  ...também no formato Cidade/UF',lr.cidadeUfDoTexto('Goiânia/GO')?.uf==='GO');
  check('endereço sem UF ("Rua 54 Jandira"): cidade reconhecida pelo nome',JSON.stringify(lr.cidadeUfDoTexto('Jose Albino Pereira 54 Jandira'))==='{"cidade":"Jandira","uf":"SP"}',lr.cidadeUfDoTexto('Jose Albino Pereira 54 Jandira'));
  check('  ...número no fim não vira cidade',lr.cidadeUfDoTexto('Rua Campinas 100')===null);
  const vx={origem_lat:-16.6869,origem_lon:-49.2648,destino_lat:-22.7394,destino_lon:-47.3314,destinos_extras:[{lat:-30.0346,lon:-51.2177}]};
  check('com 2ª entrega em Porto Alegre, o trecho até lá também vale',lr.noCorredor(vx,-27.5954,-48.548)&&!lr.noCorredor({...vx,destinos_extras:[]},-27.5954,-48.548));
  const p=lr.montarPonto({cidade:'Goiânia',uf:'go'});
  check('base do cliente pela sede do município',p&&p.precisao==='cidade'&&Math.abs(p.lat-GOIANIA.latitude)<0.2,p);
  check('cidade inexistente: sem ponto',lr.montarPonto({cidade:'Cidade Que Nao Existe',uf:'GO'})===null);

  console.log('Sem login');
  let r=await call('GET','/api/painel/lotacao-rastreios');check('lista sem login -> 401',r.status===401,'veio '+r.status);
  r=await call('POST','/api/painel/lotacao-rastreios',{body:{}});check('criar sem login -> 401',r.status===401,'veio '+r.status);
  r=await call('GET','/rastreio-lotacao');check('página da central sem login manda para o login',r.status===302&&/login=1/.test(r.headers.get('location')||''),'veio '+r.status);
  r=await call('GET','/api/rastreio-publico/naoexisteessetoken123');check('link público inexistente -> 404',r.status===404,'veio '+r.status);

  r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});
  const cookie=((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];check('login',!!cookie);
  r=await call('GET','/rastreio-lotacao',{cookie});check('página da central abre com login',r.status===200&&/Rastreio de carga lotação/.test(r.text),'veio '+r.status);

  console.log('Motorista com o app aprovado, sem romaneio');
  r=await call('POST','/api/tracking/register-request',{body:{driver_name:'João Lotação Teste',vehicle_plate:'LOT1A23',device_name:'Celular do João'}});
  const reqTk=r.json?.request_token;
  r=await call('GET','/api/painel/tracking/requests',{cookie});const pd=r.json?.rows?.find(y=>y.status==='pending'&&y.device_name==='Celular do João');
  r=await call('POST','/api/painel/tracking/requests/'+pd?.id+'/approve',{cookie,body:{}});
  r=await call('GET','/api/tracking/register-status?request_token='+reqTk);const dev=r.json?.token;
  check('aparelho aprovado',!!dev,r.text.slice(0,120));
  await call('POST','/api/tracking/heartbeat',{bearer:dev,body:{}});
  const ponto=(pt)=>call('POST','/api/tracking/point',{bearer:dev,body:{...pt,accuracy_m:10,speed_mps:20,captured_at:agora()}});
  r=await call('GET','/api/tracking/assignment/current',{bearer:dev});check('sem viagem: app fica "aguardando romaneio"',r.json?.assignment===null,r.text.slice(0,120));
  r=await ponto(GOIANIA);check('sem viagem: posição em Goiânia (fora da área de Americana) é descartada, como antes',r.json?.ignored===true,r.text.slice(0,120));

  console.log('Viagem de lotação a partir da base do cliente');
  r=await call('POST','/api/painel/lotacao-rastreios',{cookie,body:{cliente:'Cliente Goiano Ltda',driver_name:'João Lotação Teste',vehicle_plate:'lot-1a23',origem:{cidade:'Cidade Que Nao Existe',uf:'GO'},destino:{cidade:'Campinas',uf:'SP'}}});
  check('base do cliente não encontrada: 400 explicando o que informar',r.status===400&&/base do cliente/.test(r.json?.error||''),r.text.slice(0,160));
  r=await call('POST','/api/painel/lotacao-rastreios',{cookie,body:{cliente:'Cliente Goiano Ltda',driver_name:'João Lotação Teste',vehicle_plate:'lot-1a23',
    origem:{cidade:'Goiânia',uf:'GO',endereco:'Rod. BR-153, km 5'},destino:{nome:'Obra Campinas',endereco:'Rua de Teste, 100 - Campinas - SP'}}});
  const v1=r.json?.viagem||{};
  check('viagem criada com link público',r.status===201&&/\/rastreio\/[A-Za-z0-9_-]{20,}$/.test(v1.link||'')&&v1.vehicle_plate==='LOT1A23',r.text.slice(0,200));
  check('  ...origem na base do cliente (Goiânia) e destino tirado do endereço (Campinas)',v1.origem?.uf==='GO'&&v1.destino?.cidade==='Campinas'&&v1.destino?.uf==='SP',JSON.stringify(v1).slice(0,300));
  const token=(v1.link||'').split('/rastreio/')[1]||'';
  r=await call('GET','/api/tracking/assignment/current',{bearer:dev});
  check('com viagem ativa o app recebe "romaneio" e liga o GPS',!!r.json?.assignment&&r.json.assignment.lotacao?.cliente==='Cliente Goiano Ltda',r.text.slice(0,200));
  r=await ponto(GOIANIA);check('posição na base do cliente (Goiânia) é aceita',r.status===200&&!r.json?.ignored&&!!r.json?.session_id,r.text.slice(0,120));
  r=await ponto(ANAPOLIS);check('posição no caminho é aceita',r.status===200&&!r.json?.ignored,r.text.slice(0,120));
  r=await ponto(MANAUS);check('posição fora do corredor (Manaus) continua descartada',r.json?.ignored===true,r.text.slice(0,120));
  r=await call('POST','/api/tracking/points',{bearer:dev,body:{points:[{...ANAPOLIS,captured_at:new Date(Date.now()-60000).toISOString()},{...MANAUS,captured_at:new Date(Date.now()-30000).toISOString()}]}});
  check('fila de posições: aceita a do corredor e descarta a de Manaus',r.json?.saved===1&&r.json?.ignored===1,r.text.slice(0,120));

  r=await call('GET','/api/painel/tracking/live',{cookie});
  const lv=r.json?.rows?.find(x=>x.vehicle_plate==='LOT1A23');
  check('mapa da central mostra o motorista em Goiás (antes: só SP e vizinhança)',lv&&Number(lv.latitude)<-16&&Number(lv.latitude)>-17,JSON.stringify(lv||{}).slice(0,200));
  check('  ...com a viagem de lotação: base do cliente e destino',lv?.lotacao?.origem?.uf==='GO'&&lv?.lotacao?.destino?.uf==='SP'&&lv?.lotacao?.link===v1.link,JSON.stringify(lv?.lotacao||{}).slice(0,200));

  r=await call('GET','/api/painel/lotacao-rastreios',{cookie});
  const lst=r.json?.viagens?.find(x=>x.id===v1.id);
  check('quadro da central lista a viagem com a última posição',lst?.status==='ativo'&&!!lst?.ultima_posicao,JSON.stringify(lst||{}).slice(0,200));
  check('  ...e a base do cliente fica guardada para a próxima viagem',r.json?.bases?.some(b=>b.cliente==='Cliente Goiano Ltda'&&b.uf==='GO'),JSON.stringify(r.json?.bases||[]).slice(0,200));

  console.log('Link público (sem login)');
  r=await call('GET','/rastreio/'+token);check('página pública abre sem login',r.status===200&&/Rastreio da carga/.test(r.text),'veio '+r.status);
  r=await call('GET','/api/rastreio-publico/'+token);let pj=r.json||{};
  check('link mostra motorista, destino, última posição e o caminho desde a base do cliente',pj.status==='ativo'&&pj.motorista==='João'&&!!pj.posicao&&pj.trilha?.length>=2&&pj.origem?.uf==='GO'&&pj.distancia_destino_km>500,JSON.stringify(pj).slice(0,300));
  check('  ...sem dados internos (token, telefone, nome completo)',!('token' in pj)&&!/Lotação Teste/.test(r.text),r.text.slice(0,200));

  console.log('Entrega confirmada: o rastreio acaba');
  r=await call('POST','/api/painel/lotacao-rastreios/'+v1.id+'/entregue',{cookie,body:{}});
  check('central confirma a entrega',r.status===200&&r.json?.viagem?.status==='entregue',r.text.slice(0,160));
  r=await call('GET','/api/rastreio-publico/'+token);pj=r.json||{};
  check('link passa a mostrar "entregue" e não mostra mais onde o motorista está',pj.status==='entregue'&&!pj.posicao&&!pj.trilha&&!!pj.encerrado_em,JSON.stringify(pj).slice(0,200));
  r=await call('GET','/api/tracking/assignment/current',{bearer:dev});check('app volta a "aguardando romaneio"',r.json?.assignment===null,r.text.slice(0,120));
  r=await ponto(GOIANIA);check('posição em Goiânia volta a ser descartada',r.json?.ignored===true,r.text.slice(0,120));
  r=await call('POST','/api/painel/lotacao-rastreios/'+v1.id+'/entregue',{cookie,body:{}});check('confirmar de novo -> 404 (já encerrada)',r.status===404,'veio '+r.status);

  console.log('Viagem ligada à coleta da Lotação');
  r=await call('POST','/coletas/api/coletas',{cookie,body:{cliente:'Cliente Goiano Ltda',endereco_coleta:'Rod. BR-153 - Goiânia - GO',endereco_entrega:'Av. Brasil, 50 - Sorocaba - SP',destinatario:'Depósito Sorocaba',frete_cobrado:9000,frete_pago:6000,motorista:'João Lotação Teste',placa:'LOT1A23',data_carregamento:'2026-10-14',tipo_caminhao:'Carreta',implemento:'Sider'}});
  const coletaId=r.json?.id;check('coleta de lotação criada',r.status===201&&!!coletaId,r.text.slice(0,120));
  r=await call('PATCH','/api/painel/coletas-complementos/'+coletaId,{cookie,body:{entregas_extras:[{destinatario:'Loja Jandira',endereco_entrega:'Jose Albino Pereira 54 Jandira'}]}});
  check('2º destinatário gravado na coleta',r.status===200,r.text.slice(0,120));
  r=await call('GET','/api/painel/lotacao-rastreios',{cookie});
  const sug=r.json?.coletas?.find(c=>String(c.id)===String(coletaId));
  check('a coleta aparece para escolher, com o destino já reconhecido no endereço',sug?.destino_sugerido?.cidade==='Sorocaba'&&sug?.destino_sugerido?.uf==='SP',JSON.stringify(sug||{}).slice(0,240));
  check('  ...e com o 2º destinatário e a cidade dele',sug?.entregas_extras?.[0]?.destinatario==='Loja Jandira'&&sug?.entregas_extras?.[0]?.sugerido?.cidade==='Jandira',JSON.stringify(sug?.entregas_extras||[]));
  r=await call('POST','/api/painel/lotacao-rastreios',{cookie,body:{cliente:'Cliente Goiano Ltda',driver_name:'João Lotação Teste',vehicle_plate:'LOT1A23',origem:{cidade:'Goiânia',uf:'GO'},destino:{cidade:'Sorocaba',uf:'SP'},destinos_extras:[{nome:'Sem lugar',cidade:'Cidade Que Nao Existe',uf:'SP'}]}});
  check('entrega 2 sem cidade válida: 400 dizendo qual',r.status===400&&/entrega 2/.test(r.json?.error||''),r.text.slice(0,160));
  r=await call('POST','/api/painel/lotacao-rastreios',{cookie,body:{coleta_id:coletaId,cliente:'Cliente Goiano Ltda',driver_name:'João Lotação Teste',vehicle_plate:'LOT1A23',
    origem:{endereco:'Rod. BR-153 - Goiânia - GO',coordenadas:'https://www.google.com/maps/@-16.70,-49.25,14z'},destino:{nome:'Depósito Sorocaba',endereco:'Av. Brasil, 50 - Sorocaba - SP'},
    destinos_extras:[{nome:'Loja Jandira',endereco:'Jose Albino Pereira 54 Jandira'}]}});
  const v2=r.json?.viagem||{},token2=(v2.link||'').split('/rastreio/')[1]||'';
  check('viagem com localização exata da base colada do Google Maps',r.status===201&&v2.origem?.precisao==='exata'&&v2.origem?.lat===-16.7,r.text.slice(0,200));
  check('viagem com as duas entregas, na ordem',v2.destinos?.length===2&&v2.destinos[0].nome==='Depósito Sorocaba'&&v2.destinos[1].nome==='Loja Jandira'&&v2.destinos[1].uf==='SP',JSON.stringify(v2.destinos||[]));
  r=await call('GET','/api/rastreio-publico/'+token2);
  check('link público mostra as duas entregas',r.json?.destinos?.length===2&&r.json.destinos[1].cidade==='Jandira'&&!('endereco' in r.json.destinos[1]),JSON.stringify(r.json?.destinos||[]));
  r=await ponto(GOIANIA);check('GPS volta a valer com a nova viagem',r.status===200&&!r.json?.ignored,r.text.slice(0,120));
  r=await call('PATCH','/api/painel/coletas-status/'+coletaId,{cookie,body:{status:'Entregue'}});check('coleta marcada como Entregue na Lotação',r.status===200,r.text.slice(0,120));
  r=await call('GET','/api/rastreio-publico/'+token2);
  check('marcar a coleta como Entregue encerra o link sozinho',r.json?.status==='entregue'&&!r.json?.posicao,r.text.slice(0,200));

  console.log('Nova viagem substitui a anterior do mesmo motorista');
  const nova=()=>call('POST','/api/painel/lotacao-rastreios',{cookie,body:{cliente:'Outro Cliente',driver_name:'João Lotação Teste',vehicle_plate:'LOT1A23',origem:{cidade:'Uberlândia',uf:'MG'},destino:{cidade:'Americana',uf:'SP'}}});
  const a=(await nova()).json?.viagem,b2=(await nova()).json?.viagem;
  r=await call('GET','/api/rastreio-publico/'+a.link.split('/rastreio/')[1]);
  check('a viagem anterior fica cancelada (um link ativo por motorista)',r.json?.status==='cancelado'&&!r.json?.posicao,r.text.slice(0,160));
  r=await call('POST','/api/painel/lotacao-rastreios/'+b2.id+'/cancelar',{cookie,body:{}});check('central cancela a viagem',r.json?.viagem?.status==='cancelado',r.text.slice(0,120));

  console.log('\n'+pass+' ok, '+fail+' falha(s)');
  process.exit(fail?1:0)
})().catch(e=>{console.error(e);process.exit(1)});
