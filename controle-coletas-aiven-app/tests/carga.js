// Montar carga (bipagem): CT-e bipado -> parada com endereço do SSW -> rota -> envio ao motorista.
// Roda contra o SSW de mentira (tests/apoio/ssw-falso.js), sem rede externa; nunca toca no SSW real.
// Pré-requisitos: os mesmos de tests/ssw-sessao.js (servidor sem TEST_MODE, com sem-rede.js e ssw-desvio.js).
const B=process.env.BASE_URL||'http://127.0.0.1:10000',M='http://127.0.0.1:'+(process.env.MOCK_PORT||10555);
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name).replace(/[\r\n]+/g,' '))}}
const chave=n=>'35'+'2610'+'54582567000142'+'57'+'001'+String(n).padStart(9,'0')+'1'+String(n).padStart(8,'0')+'4';
(async()=>{
  let r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:ADMIN_USER,password:ADMIN_PASS})});
  const cookie=((r.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];
  check('login',!!cookie);
  const H={Cookie:cookie};
  const bipar=async c=>{const x=await fetch(B+'/api/roteirizador/bipar?codigo='+encodeURIComponent(c),{headers:H});return{status:x.status,j:await x.json().catch(()=>({}))}};
  const posts=async()=>((await (await fetch(M+'/__mock/stats')).json()).paths['POST /bin/ssw0053']||0);

  console.log('Bipar o CT-e');
  r=await fetch(B+'/api/roteirizador/bipar?codigo=AMR15326-5');check('sem login -> 401',r.status===401,'veio '+r.status);
  let a=await bipar(chave(14791)),s=a.j.stop||{};
  check('chave de 44 dígitos acha o CT-e pelo campo "Código de barras" da opção 101',a.status===200&&s.ctrc==='AMR015326-5'&&s.barcode===chave(14791),a);
  check('destinatário, nota, volumes e peso vêm do SSW',s.destinatario==='3056207 WAGNO ABREU DE JESUZ'&&s.nf==='525535'&&s.volumes===5&&s.peso===134.084,s);
  check('endereço de entrega escrito no complemento vira o endereço da parada',s.endereco==='RUA JULIA PERES APARECIDO'&&s.numero==='30'&&s.enderecoFonte==='complemento (endereço de entrega)',s);
  check('  ...sem levar bairro e CEP do cadastro (são de outro lugar)',s.bairro===''&&s.cep==='',{bairro:s.bairro,cep:s.cep});
  check('complemento inteiro (do XML, não o cortado da tela) e situação do CT-e',s.complemento==='SN ENDERECO ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO'&&/85-SAIDA PARA ENTREGA/.test(s.situacao),s);
  check('entrega em outro endereço que o mapa não achou: fica no ponto do cadastro, marcada como aproximada',s.precision==='cliente'&&/outro endereço/.test(s.coordinateSource)&&Math.abs(s.lat+21.9777401)<1e-6&&Math.abs(s.lon+46.7894998)<1e-6&&s.cidade==='SAO JOAO DA BOA VISTA',s);
  const antes=await posts();
  a=await bipar('amr 15326-5');
  check('mesmo CT-e digitado depois: responde da memória, sem voltar ao SSW',a.status===200&&a.j.stop.ctrc==='AMR015326-5'&&await posts()===antes,{antes,depois:await posts()});
  a=await bipar(chave(14791));
  check('mesma chave de novo: também da memória',a.status===200&&await posts()===antes);
  a=await bipar('AMR15327-3');const s2=a.j.stop||{};
  check('número digitado: endereço do destinatário no XML (inteiro, não o do recebedor cortado), com bairro, CEP e telefone',a.status===200&&s2.endereco==='AVENIDA SAUDADE'&&s2.numero==='516'&&s2.bairro==='CENTRO'&&s2.cep==='13800-000'&&s2.enderecoFonte==='XML do CT-e (destinatário)'&&s2.telefone==='1936236644',s2);
  check('  ...entrega no próprio cadastro usa o ponto do cliente no SSW, sem marcar como aproximado',s2.precision==='ssw-cliente'&&Math.abs(s2.lat+22.42887)<1e-6,s2);
  check('  ...e a chave do XML fica guardada para o próximo bip',s2.barcode===chave(14792),s2.barcode);
  a=await bipar(chave(14793));const s3=a.j.stop||{};
  check('terceiro CT-e pela chave',a.status===200&&s3.ctrc==='AMR015328-1'&&s3.complemento==='GALPAO 2',s3);
  a=await bipar('AMR15329-9');const s4=a.j.stop||{};
  check('cliente sem ponto no SSW: fica na sede do município, como aproximado',a.status===200&&s4.precision==='cidade'&&s4.cidade==='PEDREIRA'&&s4.endereco==='RUA DAS PORCELANAS',s4);
  a=await bipar('AMR15330-7');check('destino a mais de 300 km: recusa com o motivo',a.status===422&&/mais de 300 km/.test(a.j.error),a);
  a=await bipar('AMR99999-1');check('CT-e que não existe: 404 com o número',a.status===404&&/AMR99999-1 não encontrado/.test(a.j.error),a);
  a=await bipar(chave(99999));check('chave de CT-e que não existe: 404',a.status===404&&/não encontrado no SSW/.test(a.j.error),a);
  a=await bipar('35261044530855000108550010005255351000000017');check('chave de nota fiscal (DANFE): explica que precisa ser o CT-e',a.status===400&&/DANFE/.test(a.j.error),a);
  a=await bipar('12345');check('código curto: 400 com orientação',a.status===400&&/Não reconheci/.test(a.j.error),a);

  console.log('Roteirizar e enviar');
  const stops=[s,s2,s3,s4].map((x,i)=>({...x,cargaId:'c'+(i+1)}));
  r=await fetch(B+'/api/roteirizador/recalcular',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({date:'',stops})});
  const plan=await r.json();
  check('rota sai da base e volta, com as 4 entregas',r.status===200&&plan.ok&&plan.optimizedOrder.length===4&&plan.points.length===5&&plan.optimizedDistanceMeters>100000,{status:r.status,erro:plan.error});
  check('cada ponto mantém a marca da carga (para a tela casar a ordem)',plan.points.slice(1).map(p=>p.cargaId).sort().join()==='c1,c2,c3,c4');
  check('aproximadas: só a entrega em outro endereço e a que ficou na sede do município',plan.approximateStops===2,plan.approximateStops);
  const ordem=plan.optimizedOrder.map(i=>plan.points[i]);
  const corpo={date:new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),driver_name:'Motorista Bipagem',vehicle_plate:'abc-1d23',
    plan:{points:[plan.points[0],...ordem],optimizedOrder:[1,2,3,4],geometry:plan.geometry,optimizedDistanceMeters:plan.optimizedDistanceMeters,durationSeconds:plan.durationSeconds}};
  r=await fetch(B+'/api/roteirizador/enviar-carga',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo)});
  check('enviar sem login -> 401',r.status===401,'veio '+r.status);
  r=await fetch(B+'/api/roteirizador/enviar-carga',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify(corpo)});
  const env=await r.json();
  check('enviar: cria o link e grava como rota de hoje do motorista',r.status===201&&env.ok&&/^[a-f0-9]{20}$/.test(env.token)&&env.para_motorista===true&&env.stops===4&&env.vehicle_plate==='ABC1D23'&&/^Carga • Motorista Bipagem • ABC1D23/.test(env.title),env);
  r=await fetch(B+'/movit/rota/'+env.token);const pg=await r.text();
  const pos=ordem.map(p=>pg.indexOf(String(p.destinatario).replace(/&/g,'&amp;')));
  check('link público lista as paradas na ordem enviada',r.status===200&&pos.every((p,i)=>p>0&&(i===0||p>pos[i-1])),pos);
  check('  ...com o endereço limpo (rua, número, cidade)',pg.includes('RUA JULIA PERES APARECIDO, 30, SAO JOAO DA BOA VISTA - SP')&&pg.includes('AVENIDA SAUDADE, 516, CENTRO, MOGI MIRIM - SP'),pg.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,500));
  r=await fetch(B+'/api/roteirizador/enviar-carga',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({...corpo,driver_name:''})});
  const env2=await r.json();
  check('sem motorista: só o link, não grava rota do dia',r.status===201&&env2.para_motorista===false&&env2.token!==env.token,env2);
  r=await fetch(B+'/api/roteirizador/enviar-carga',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({...corpo,plan:{points:[plan.points[0]],optimizedOrder:[]}})});
  check('carga vazia: 400',r.status===400,'veio '+r.status);
  r=await fetch(B+'/api/roteirizador/motoristas',{headers:H});const mot=await r.json();
  check('lista de motoristas responde',r.status===200&&mot.ok&&Array.isArray(mot.rows),mot);
  r=await fetch(B+'/api/roteirizador/motoristas');check('lista de motoristas exige login',r.status===401,'veio '+r.status);

  console.log('Permissão própria: Montar carga é liberada usuário a usuário');
  {
    const sufixo=Date.now().toString(36);
    const cria=async(nome,permissions)=>{
      const x=await fetch(B+'/api/painel/auth/users',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({username:nome,password:'senha-teste-1',permissions})});
      const l=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:nome,password:'senha-teste-1'})});
      return{criou:x.status,H:{Cookie:((l.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0]}}
    };
    const com=await cria('carga_sim_'+sufixo,['montar_carga']),sem=await cria('carga_nao_'+sufixo,['roteirizador','dashboard','tracking','programacao']);
    check('usuários de teste criados e logados',com.criou===201&&sem.criou===201&&!!com.H.Cookie&&!!sem.H.Cookie,{com:com.criou,sem:sem.criou});
    const st=async(h,m,u,body)=>(await fetch(B+u,{method:m,headers:{...h,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})).status;
    check('só com "Montar carga": bipa, lista motoristas, roteiriza e envia',
      await st(com.H,'GET','/api/roteirizador/bipar?codigo=AMR15327-3')===200&&await st(com.H,'GET','/api/roteirizador/motoristas')===200&&
      await st(com.H,'POST','/api/roteirizador/recalcular',{date:'',stops})===200&&await st(com.H,'POST','/api/roteirizador/enviar-carga',corpo)===201);
    check('  ...e não ganha acesso ao que não foi liberado (rastreio, programação)',await st(com.H,'GET','/api/tracking/contacts')===403&&await st(com.H,'GET','/api/programacao-entregas')===403,[await st(com.H,'GET','/api/tracking/contacts'),await st(com.H,'GET','/api/programacao-entregas')]);
    check('com Roteirizador, Dashboard e Rastreio mas sem "Montar carga": não bipa, não lista, não envia',
      await st(sem.H,'GET','/api/roteirizador/bipar?codigo=AMR15327-3')===403&&await st(sem.H,'GET','/api/roteirizador/motoristas')===403&&await st(sem.H,'POST','/api/roteirizador/enviar-carga',corpo)===403,
      [await st(sem.H,'GET','/api/roteirizador/bipar?codigo=AMR15327-3'),await st(sem.H,'GET','/api/roteirizador/motoristas'),await st(sem.H,'POST','/api/roteirizador/enviar-carga',corpo)]);
    check('  ...mas continua roteirizando nas telas que já tinha',await st(sem.H,'POST','/api/roteirizador/recalcular',{date:'',stops})===200);
    r=await fetch(B+'/dashboard/app.js');
    check('a permissão aparece na lista de acessos dos usuários',/\['montar_carga','Montar carga/.test(await r.text()))
  }

  console.log('Diagnóstico do SSW');
  r=await fetch(B+'/api/ssw/diagnostico-cte',{headers:H});let t=await r.text();
  check('sem código: mostra o campo para bipar',r.status===200&&/name="codigo"/.test(t)&&/autofocus/.test(t));
  r=await fetch(B+'/api/ssw/diagnostico-cte?codigo='+chave(14792),{headers:H});t=await r.text();
  const link=(t.match(/\/dashboard\/diag\/[a-f0-9]{24}/)||[])[0];
  check('com a chave bipada: devolve o link do resultado na hora',r.status===200&&!!link,t.slice(0,200));
  let d={};
  for(let i=0;i<40;i++){d=await (await fetch(B+link)).json();if(d.pronto)break;await sleep(500)}
  const it=(d.itens||[])[0]||{};
  check('diagnóstico termina e acha o CT-e pela chave na opção 101',d.pronto===true&&!d.erro&&d.ctrc==='AMR015327-3'&&d.achadoPor?.opcao101==='AMR015327-3',{pronto:d.pronto,erro:d.erro,ctrc:d.ctrc,achadoPor:d.achadoPor});
  check('  ...abre o .zip e lê o destinatário do XML',it.arquivo?.dentro===chave(14792)+'-cte.xml'&&it.cte?.destinatario?.logradouro==='AVENIDA SAUDADE'&&it.xmlTexto?.startsWith('<?xml'),it.arquivo);
  check('  ...mostra os endereços candidatos e o escolhido',Array.isArray(it.mapa?.candidatos)&&it.mapa.candidatos.length===1&&it.mapa.candidatos[0]?.fonte==='XML do CT-e (destinatário)'&&it.mapa.escolhido?.precisao==='ssw-cliente',it.mapa);
  check('  ...e sonda as telas DANFEs e Arquivos EDI',(it.sondagens||[]).map(x=>x.act).join()==='A,ARQ'&&/Nenhuma DANFE/.test(it.sondagens[0].texto),it.sondagens);
  r=await fetch(B+'/api/ssw/diagnostico-cte?codigo=xyz',{headers:H});check('código que não é CT-e: 400 com explicação',r.status===400&&/Não reconheci/.test(await r.text()));
  r=await fetch(B+'/dashboard/carga.css');check('folha de estilo sai como CSS (antes saía como HTML e o navegador recusava)',r.status===200&&/^text\/css/.test(r.headers.get('content-type')||''),r.headers.get('content-type'));
  console.log('\nResultado carga: '+pass+' OK, '+fail+' falha(s)');process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
