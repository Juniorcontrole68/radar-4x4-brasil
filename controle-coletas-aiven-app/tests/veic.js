// Abastecimentos do Veic na Frota (veic.js). Roda contra um Veic de mentira dentro do próprio teste,
// sem rede externa; nunca fala com o Veic real. Precisa do servidor no ar (modo teste) e do banco de teste.
const http=require('http');
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,typeof extra==='string'?extra:JSON.stringify(extra));if(process.env.GITHUB_ACTIONS)console.log('::error title=Veic::'+name)}}

const TRANS=[
  {id:9001,data:'2026-10-10T13:45:00.000Z',valor:350.5,produto:'DIESEL S10',status:'APROVADA',equipamento:{identificacao:'ABC-1D23'},condutor:{nome:'Gilmar Souza'},credenciado:{nome:'Posto Estrela',cidade:'Curitiba',estado:'PR'},abastecimento:{hodometro:120500,hodometroAnterior:120100,servico:'DIESEL S10',valorUnitario:5.85,quantidade:59.91}},
  {id:9002,data:'2026-10-12T08:05:00',valor:200,equipamento:{identificacao:'xyz9a88'},portador:{nomeImpresso:'MARIA L'},credenciado:{nome:'Posto Sol'},abastecimento:{hodometro:50300,hodometroAnterior:0,servico:'GASOLINA COMUM',valorUnitario:'6,25',quantidade:'32,000'}},
  {id:9003,data:'2026-10-11T10:00:00',valor:800,equipamento:{identificacao:'ABC1D23'},credenciado:{nome:'Oficina'},manutencao:{servico:'Troca de óleo'}}
];
const stats={logins:0,basic:'',listas:0,params:null,proibidas:0};
function veicFalso(){
  return http.createServer((req,res)=>{
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      const u=new URL(req.url,'http://x');
      const json=(st,o)=>{res.writeHead(st,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
      if(req.method==='POST'&&u.pathname==='/auth/token'){
        stats.logins++;stats.basic=Buffer.from(String(req.headers.authorization||'').replace(/^Basic /,''),'base64').toString();
        const f=new URLSearchParams(body);
        if(f.get('grant_type')!=='password'||!f.get('client_id'))return json(400,{error:'invalid_request'});
        if(stats.basic!=='frota@construlog:segredo')return json(401,{error:'invalid_grant'});
        return json(200,{access_token:'tk-123',refresh_token:'rf'})
      }
      if(req.method==='GET'&&u.pathname==='/transacao-query/transacao'){
        if(req.headers.authorization!=='Bearer tk-123'||req.headers['x-issuer-id']!=='4b0fe997782a4502a447b752dfac4fdb')return json(401,{});
        stats.listas++;stats.params=Object.fromEntries(u.searchParams);
        const size=Number(u.searchParams.get('pageSize')),idx=Number(u.searchParams.get('pageIndex'));
        return json(200,{list:TRANS.slice((idx-1)*size,idx*size),total:TRANS.length})
      }
      stats.proibidas++;json(404,{})
    })
  })
}

(async()=>{
  const srv=veicFalso();await new Promise(ok=>srv.listen(0,'127.0.0.1',ok));
  process.env.VEIC_API_URL='http://127.0.0.1:'+srv.address().port;
  delete process.env.VEIC_USUARIO;delete process.env.VEIC_SENHA;
  const veic=require('../veic.js');

  console.log('Leitura das transações (sem servidor)');
  {const a=veic.abastecimentoDaTransacao(TRANS[0]);
   check('transação de abastecimento: placa, data e hora de Brasília, KM, litros, valor/L, total, combustível, posto',a.id==='veic-9001'&&a.source==='veic'&&a.plate==='ABC1D23'&&a.date==='2026-10-10'&&a.time==='10:45'&&a.km===120500&&a.kmDriven===400&&a.liters===59.91&&a.price===5.85&&a.total===350.5&&a.fuelType==='DIESEL S10'&&a.station==='Posto Estrela'&&a.city==='Curitiba/PR'&&a.driver==='Gilmar Souza',a);
   check('  ...média km/L calculada pelo KM anterior do Veic',a.kmPerLiter===6.68,a.kmPerLiter)}
  {const a=veic.abastecimentoDaTransacao(TRANS[1]);
   check('números em formato brasileiro, hora sem fuso, portador como motorista, sem KM anterior',a.liters===32&&a.price===6.25&&a.time==='08:05'&&a.plate==='XYZ9A88'&&a.driver==='MARIA L'&&a.kmDriven===0&&a.kmPerLiter===0,a)}
  check('transação de manutenção fica fora',veic.abastecimentoDaTransacao(TRANS[2])===null);
  {const manual={id:'m1',date:'2026-10-11',plate:'ABC1D23',liters:10,total:60};
   const n=TRANS.map(veic.abastecimentoDaTransacao).filter(Boolean);
   let r=veic.mesclar([manual],n);
   check('mesclar: mantém o lançado à mão e acrescenta os do Veic, mais recentes primeiro',r.fuel.length===3&&r.criados===2&&r.fuel[0].id==='veic-9002'&&r.fuel.some(x=>x.id==='m1'),r);
   r=veic.mesclar(r.fuel,n);
   check('importar de novo não duplica (atualiza)',r.fuel.length===3&&r.criados===0&&r.atualizados===2,r)}

  console.log('Veic de mentira');
  let erro=null;try{await veic.lerAbastecimentos('2026-10-01','2026-10-31')}catch(e){erro=e}
  check('sem VEIC_USUARIO/VEIC_SENHA recusa sem chamar o Veic',erro&&/VEIC_USUARIO/.test(erro.message)&&stats.logins===0,String(erro));
  process.env.VEIC_USUARIO='frota@construlog';process.env.VEIC_SENHA='errada';
  erro=null;try{await veic.lerAbastecimentos('2026-10-01','2026-10-31')}catch(e){erro=e}
  check('senha errada: mensagem clara',erro&&/recusou o usuário/.test(erro.message),String(erro));
  process.env.VEIC_SENHA='segredo';
  const x=await veic.lerAbastecimentos('2026-10-01','2026-10-31');
  check('login com usuário e senha em Basic, como o site',stats.basic==='frota@construlog:segredo');
  check('lê as transações do período e devolve só os 2 abastecimentos',x.transacoes===3&&x.abastecimentos.length===2,x);
  check('  ...com o período nos filtros da consulta',stats.params&&stats.params.dataInicioTransacao==='2026-10-01'&&stats.params.dataFimTransacao==='2026-10-31',stats.params);
  check('  ...mandando o x-issuer-id do site (sem ele o Veic devolve 401)',stats.listas>0);
  check('  ...e nunca chamou nada além do login e da consulta',stats.proibidas===0,stats);

  console.log('Gravação na Frota (banco de teste)');
  const {Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL||'postgresql://teste:teste@127.0.0.1:5432/construlog_teste'});
  const antes=(await pool.query('SELECT data FROM fleet_state WHERE id=1')).rows[0]?.data||{};
  try{
    const manual={id:'manual-veic-teste',date:'2026-10-09',plate:'ABC1D23',km:120100,liters:50,price:5.8,total:290};
    await pool.query('UPDATE fleet_state SET data=$1::jsonb WHERE id=1',[JSON.stringify(Object.assign({},antes,{fuel:[manual]}))]);
    let r=await veic.importar(pool,'2026-10-01','2026-10-31');
    let f=(await pool.query('SELECT data FROM fleet_state WHERE id=1')).rows[0].data.fuel;
    check('importa para Frota → Combustível sem apagar o lançado à mão',r.ok&&r.criados===2&&f.length===3&&f.some(y=>y.id==='manual-veic-teste')&&f.some(y=>y.id==='veic-9001'&&y.importedAt),{r,n:f.length});
    r=await veic.importar(pool,'2026-10-01','2026-10-31');
    f=(await pool.query('SELECT data FROM fleet_state WHERE id=1')).rows[0].data.fuel;
    check('importar de novo não duplica',r.criados===0&&r.atualizados===2&&f.length===3,r);
  }finally{await pool.query('UPDATE fleet_state SET data=$1::jsonb WHERE id=1',[JSON.stringify(antes)]);await pool.end()}

  console.log('Rotas do servidor');
  let s=await fetch(B+'/api/painel/frota-veic');
  check('sem login a situação do Veic é recusada',s.status===401||s.status===403,s.status);
  s=await fetch(B+'/api/painel/frota-veic/importar',{method:'POST'});
  check('sem login a importação é recusada',s.status===401||s.status===403,s.status);
  const lg=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:ADMIN_USER,password:ADMIN_PASS})});
  const Cookie=((lg.headers.get('set-cookie')||'').match(/cl_session=[^;]+/)||[''])[0];
  s=await fetch(B+'/api/painel/frota-veic',{headers:{Cookie}});const sj=await s.json().catch(()=>({}));
  check('com login mostra que falta configurar o Veic',s.status===200&&sj.ok&&sj.configurado===false,sj);
  s=await fetch(B+'/api/painel/frota-veic/importar',{method:'POST',headers:{Cookie,'Content-Type':'application/json'},body:JSON.stringify({from:'2026-01-01',to:'2026-10-31'})});
  check('período maior que 92 dias é recusado',s.status===400,s.status);
  s=await fetch(B+'/api/painel/frota-veic/importar',{method:'POST',headers:{Cookie,'Content-Type':'application/json'},body:JSON.stringify({from:'2026-10-01',to:'2026-10-31'})});
  const ij=await s.json().catch(()=>({}));
  check('sem usuário do Veic no servidor a importação explica o que falta',s.status===400&&/VEIC_USUARIO/.test(ij.error||''),ij);

  srv.close();
  console.log(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail?1:0)
})().catch(e=>{console.error(e);process.exit(1)});
