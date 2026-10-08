// Teste do aplicativo do motorista num celular Android emulado, contra o servidor em modo teste.
// Roda só no GitHub Actions (workflow "Teste do aplicativo do motorista"). Cobre o que antes
// só dava para descobrir com o motorista na rua: ativação, liberação com o app fechado,
// GPS por romaneio, volta sozinho depois de o Android matar o app e fila sem internet.
//
// Uso: APK=caminho/app-debug.apk node tests/app-emulador.js
const {execSync}=require('child_process');
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const PKG='br.com.construlog.motorista',APK=process.env.APK||'motorista-android-v2/app/build/outputs/apk/debug/app-debug.apk';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const DRIVER='Motorista Emulador',PLATE='EMU1A23';
let pass=0,fail=0;const resumo=[];
function check(name,cond,extra=''){
  if(cond){pass++;console.log('  OK   ',name);resumo.push('OK '+name)}
  else{fail++;console.log('  FALHA',name,extra);resumo.push('FALHA '+name);console.log('::error title=App do motorista::'+String(name+' — '+extra).replace(/\r?\n/g,' ').slice(0,900))}
}
const nota=t=>console.log('::notice title=App do motorista::'+String(t).replace(/\r?\n/g,' | ').slice(0,1500));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sh=(cmd,timeout=90000)=>{try{return execSync(cmd,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']}).trim()}catch(e){return 'ERRO: '+String((e.stderr||'')+' '+(e.message||'')).trim().slice(0,400)}};
const adb=(a,t)=>sh('adb '+a,t);
async function call(method,path,{body,cookie}={}){
  // Uma conexão nova por chamada e até 4 tentativas: o roteiro passa minutos entre uma chamada
  // e outra, e reaproveitar conexão antiga com o servidor dá "fetch failed" de vez em quando.
  const h={Connection:'close'};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;
  let erro;
  for(let i=0;i<4;i++){
    try{
      const r=await fetch(B+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});
      const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}
      return{status:r.status,json,text,setCookie:r.headers.get('set-cookie')||''}
    }catch(e){erro=e;await sleep(1500)}
  }
  throw new Error('servidor de teste não respondeu em '+path+': '+String(erro?.cause?.code||erro?.cause?.message||erro?.message||erro))
}
async function until(fn,ms,step=3000){
  const end=Date.now()+ms;let last;
  while(Date.now()<end){last=await fn();if(last)return last;await sleep(step)}
  return null
}
const pid=()=>{const p=adb('shell pidof '+PKG);return /^\d+/.test(p)?p.split(/\s+/)[0]:''};
function tela(){
  adb('shell uiautomator dump /sdcard/tela.xml');
  const xml=adb('shell cat /sdcard/tela.xml');
  return [...xml.matchAll(/ text="([^"]+)"/g)].map(m=>m[1].replace(/&quot;/g,'"').replace(/&#10;/g,' ').replace(/&amp;/g,'&')).join(' ¦ ')
}
let lat=-22.7000,lon=-47.3100;
function andar(){lat-=0.0004;lon+=0.0002;return adb('emu geo fix '+lon.toFixed(5)+' '+lat.toFixed(5))}
function ficar(){return adb('emu geo fix '+lon.toFixed(5)+' '+lat.toFixed(5))}

(async()=>{
  const {Pool}=require('pg');const db=new Pool({connectionString:process.env.DATABASE_URL});
  const pontos=async()=>(await db.query("SELECT COUNT(*)::int AS n,MAX(captured_at) AS ultimo FROM driver_tracking_points p JOIN driver_tracking_devices d ON d.id=p.device_id WHERE d.vehicle_plate=$1",[PLATE])).rows[0];
  const aparelho=async()=>(await db.query("SELECT id,active,last_seen_at,enrolled_at,app_version,health FROM driver_tracking_devices WHERE vehicle_plate=$1 ORDER BY id DESC LIMIT 1",[PLATE])).rows[0]||null;

  let r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});
  const cookie=(r.setCookie.match(/cl_session=[^;]+/)||[''])[0];
  if(!cookie){console.log('::error::login no servidor de teste falhou');process.exit(2)}

  console.log('1. Instalação e pedido de ativação');
  console.log('   adb root:',adb('root'));await sleep(3000);adb('wait-for-device');
  const inst=adb('install -r -g '+APK,180000);
  check('APK instala no Android '+adb('shell getprop ro.build.version.release')+' (API '+adb('shell getprop ro.build.version.sdk')+')',/Success/.test(inst),inst.slice(-300));
  adb('shell dumpsys deviceidle whitelist +'+PKG);
  adb('shell cmd location set-location-enabled true');
  adb('shell settings put secure location_mode 3');
  ficar();
  adb('logcat -c');
  adb('shell am start -n '+PKG+'/.MainActivity --es auto_driver "'+DRIVER.replace(/ /g,'\\ ')+'" --es auto_plate '+PLATE);
  const pend=await until(async()=>{const x=await call('GET','/api/painel/tracking/requests',{cookie});return x.json?.rows?.find(q=>q.status==='pending'&&q.vehicle_plate===PLATE)},60000);
  check('aplicativo abre e envia o pedido de ativação (nome, placa e modelo do celular)',!!pend&&pend.driver_name===DRIVER,JSON.stringify(pend||{})+' tela: '+tela().slice(0,300));
  const t1=tela();nota('Tela aguardando liberação: '+t1.slice(0,500));
  check('tela mostra "Aguardando a central liberar"',t1.includes('Aguardando a central liberar'),t1.slice(0,300));

  console.log('2. Liberação com o aplicativo fechado');
  adb('shell input keyevent KEYCODE_HOME');await sleep(2500);
  if(pend){r=await call('POST','/api/painel/tracking/requests/'+pend.id+'/approve',{cookie,body:{}});check('central aprova o aparelho',r.json?.status==='approved',r.text.slice(0,200))}
  await sleep(1500);
  console.log('   vigia (tarefa periódica) acionado:',adb('shell cmd jobscheduler run -f '+PKG+' 7002'));
  let dev=await until(async()=>{const d=await aparelho();return d&&d.app_version&&new Date(d.last_seen_at)>new Date(d.enrolled_at)?d:null},90000);
  const fundo=!!dev;
  check('com o app fechado, o vigia busca a liberação e liga o rastreio sozinho (antes: só com o app aberto)',fundo,'aparelho: '+JSON.stringify(await aparelho())+' | '+adb('shell dumpsys activity services '+PKG).slice(0,300));
  if(!dev){
    adb('shell am start -n '+PKG+'/.MainActivity');
    dev=await until(async()=>{const d=await aparelho();return d&&d.app_version?d:null},60000);
    adb('shell input keyevent KEYCODE_HOME')
  }
  const h=dev?.health||{};
  nota('Diagnóstico enviado pelo app: versão '+dev?.app_version+' '+JSON.stringify(h));
  check('aplicativo envia versão e diagnóstico do celular',dev?.app_version==='1.1.0'&&h.perm_location===true&&h.gps_on===true&&typeof h.battery_pct==='number'&&h.version_code===11,JSON.stringify(dev||{}).slice(0,400));
  check('diagnóstico: serviço de pé, localização "o tempo todo" e bateria liberada',h.service_running===true&&h.perm_background===true&&h.battery_unrestricted===true,JSON.stringify(h));

  console.log('3. Romaneio liga o GPS sozinho');
  const hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  let p0=await pontos();
  check('sem romaneio o aplicativo não envia posição',p0.n===0,'pontos='+p0.n);
  r=await call('POST','/api/painel/tracking/assignment',{cookie,body:{driver_name:DRIVER,vehicle_plate:PLATE,romaneios:['EMU000001'],work_date:hoje}});
  check('romaneio associado ao motorista',r.status===201,r.text.slice(0,160));
  let p1=await until(async()=>{andar();const x=await pontos();return x.n>0?x:null},120000,3000);
  check('com romaneio, o GPS liga sozinho e as posições chegam (sem abrir o app)',!!p1,'pontos='+(await pontos()).n+' | '+adb('shell dumpsys location | grep -i -m3 construlog').slice(0,300));
  for(let i=0;i<8;i++){andar();await sleep(3000)}
  r=await call('GET','/api/painel/tracking/live?light=1',{cookie});const lv=r.json?.rows?.find(x=>x.vehicle_plate===PLATE);
  check('mapa ao vivo mostra o motorista com posição recente e sessão de hoje',!!lv&&lv.session_status==='active'&&Math.abs(Number(lv.latitude)-lat)<0.02&&Number(lv.age_seconds)<120,JSON.stringify(lv||{}).slice(0,300));
  check('posição leva o nível da bateria',lv?.battery_pct!==null&&lv?.battery_pct!==undefined,JSON.stringify({battery:lv?.battery_pct}));

  console.log('4. Veículo parado continua dando posição (1 a cada 2 minutos)');
  await sleep(4000);const a0=(await pontos()).n;const tParado=Date.now();
  while(Date.now()-tParado<150000){ficar();await sleep(5000)}
  const a1=(await pontos()).n;
  check('parado por 2,5 min: chegam 1 ou 2 posições (antes: nenhuma, e a central via "sem GPS")',a1-a0>=1&&a1-a0<=3,'novas='+(a1-a0));

  console.log('5. Android mata o aplicativo');
  const pidAntes=pid();const restAntes=Number((await aparelho())?.health?.restarts||0);
  const tKill=new Date();
  console.log('   kill:',adb('shell kill -9 '+pidAntes),'pid',pidAntes);
  let pidDepois=await until(async()=>{const p=pid();return p&&p!==pidAntes?p:null},45000,2000);
  let como='o próprio Android religou o serviço';
  if(!pidDepois){
    como='o vigia religou o serviço';
    console.log('   vigia acionado:',adb('shell cmd jobscheduler run -f '+PKG+' 7002'));
    pidDepois=await until(async()=>{const p=pid();return p&&p!==pidAntes?p:null},45000,2000)
  }
  check('aplicativo morto volta sozinho ('+como+')',!!pidDepois,'pid antes '+pidAntes+' depois '+pid());
  const vivo=await until(async()=>{andar();const d=await aparelho();return d&&new Date(d.last_seen_at)>new Date(tKill.getTime()+3000)&&Number(d.health?.restarts||0)>restAntes?d:null},120000,3000);
  check('depois de religar, volta a dar sinal de vida para a central',!!vivo,JSON.stringify(await aparelho()).slice(0,300));
  const pk=await until(async()=>{andar();const x=await pontos();return x.ultimo&&new Date(x.ultimo)>tKill?x:null},90000,3000);
  check('...e volta a enviar posição sem ninguém abrir o app',!!pk,JSON.stringify(await pontos()));

  console.log('6. Trecho sem internet');
  const b0=(await pontos()).n;
  console.log('   modo avião:',adb('shell cmd connectivity airplane-mode enable'));await sleep(6000);
  const tOff=new Date();
  for(let i=0;i<14;i++){andar();await sleep(4000)}
  const b1=(await pontos()).n;const tOn=new Date();
  check('sem internet, nada chega ao servidor',b1-b0<=1,'chegaram '+(b1-b0));
  adb('shell cmd connectivity airplane-mode disable');
  const b2=await until(async()=>{const x=await pontos();return x.n-b1>=3?x:null},150000,4000);
  const noTrecho=(await db.query("SELECT COUNT(*)::int AS n FROM driver_tracking_points p JOIN driver_tracking_devices d ON d.id=p.device_id WHERE d.vehicle_plate=$1 AND captured_at>$2 AND captured_at<$3",[PLATE,tOff,tOn])).rows[0].n;
  check('quando a internet volta, as posições do trecho sem sinal são enviadas (antes: perdidas)',!!b2&&noTrecho>=3,'novas='+((await pontos()).n-b1)+' do trecho='+noTrecho);

  console.log('7. Celular desligado e ligado de novo');
  adb('reboot');await sleep(8000);adb('wait-for-device',180000);
  const ligou=await until(async()=>adb('shell getprop sys.boot_completed')==='1',240000,4000);
  const tBoot=new Date();
  check('emulador reiniciou',!!ligou,adb('shell getprop sys.boot_completed'));
  const posBoot=await until(async()=>{const d=await aparelho();return d&&new Date(d.last_seen_at)>tBoot?d:null},180000,4000);
  check('depois de desligar e ligar o celular, o rastreio volta sozinho (sem abrir o app)',!!posBoot&&posBoot.health?.service_running===true,JSON.stringify(await aparelho()).slice(0,300)+' pid='+pid());
  const pb=await until(async()=>{andar();const x=await pontos();return x.ultimo&&new Date(x.ultimo)>tBoot?x:null},120000,3000);
  check('...e as posições voltam a chegar',!!pb,JSON.stringify(await pontos()));

  console.log('8. Permissões retiradas: o app não pode travar e a central precisa saber');
  adb('logcat -b crash -c');
  adb('shell pm revoke '+PKG+' android.permission.ACCESS_BACKGROUND_LOCATION');await sleep(3000);
  let tPerm=new Date();
  console.log('   vigia acionado:',adb('shell cmd jobscheduler run -f '+PKG+' 7002'));
  const semFundo=await until(async()=>{const d=await aparelho();return d&&new Date(d.last_seen_at)>tPerm&&d.health?.perm_background===false?d:null},120000,4000);
  nota('Sem "permitir o tempo todo": '+JSON.stringify(semFundo?.health||(await aparelho())?.health||{}));
  check('sem "Permitir o tempo todo": o app continua dando sinal de vida e informa o que falta',!!semFundo,JSON.stringify(await aparelho()).slice(0,300));
  adb('shell pm revoke '+PKG+' android.permission.ACCESS_FINE_LOCATION');adb('shell pm revoke '+PKG+' android.permission.ACCESS_COARSE_LOCATION');await sleep(3000);
  tPerm=new Date();
  console.log('   vigia acionado:',adb('shell cmd jobscheduler run -f '+PKG+' 7002'));
  const semLoc=await until(async()=>{const d=await aparelho();return d&&new Date(d.last_seen_at)>tPerm&&d.health?.perm_location===false?d:null},120000,4000);
  nota('Sem permissão de localização: '+JSON.stringify(semLoc?.health||(await aparelho())?.health||{}));
  check('sem nenhuma permissão de localização: ainda avisa a central (modo reduzido), sem travar',!!semLoc&&semLoc.health?.service_running===false,JSON.stringify(await aparelho()).slice(0,300));
  adb('shell am start -n '+PKG+'/.MainActivity');await sleep(5000);
  const t3=tela();nota('Tela com permissão faltando: '+t3.slice(0,400));
  check('tela mostra o passo que falta, com botão',t3.includes('Falta')&&t3.includes('PERMITIR LOCALIZAÇÃO'),t3.slice(0,300));
  const crashPerm=adb('logcat -d -b crash').split('\n').filter(l=>l.includes(PKG)||/FATAL EXCEPTION/.test(l));
  check('nenhum travamento com as permissões retiradas',crashPerm.length===0,crashPerm.slice(0,6).join(' | ').slice(0,700));
  adb('shell input keyevent KEYCODE_HOME');
  for(const perm of ['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION','ACCESS_BACKGROUND_LOCATION'])adb('shell pm grant '+PKG+' android.permission.'+perm);
  await sleep(2000);

  console.log('9. Tela e estabilidade');
  adb('shell am start -n '+PKG+'/.MainActivity');await sleep(5000);
  const t2=tela();nota('Tela com tudo certo: '+t2.slice(0,500));
  check('tela principal mostra "Tudo certo" e nenhum passo pendente',t2.includes('Tudo certo')&&!t2.includes('Falta'),t2.slice(0,400));
  const crash=adb('logcat -d -b crash').split('\n').filter(l=>l.includes(PKG)||/FATAL EXCEPTION/.test(l));
  check('nenhum travamento do aplicativo durante todo o teste',crash.length===0,crash.slice(0,6).join(' | ').slice(0,700));
  const fim=await aparelho();
  nota('Resultado: '+pass+' OK, '+fail+' falha(s). Pontos gravados: '+(await pontos()).n+'. Reinícios do serviço: '+(fim?.health?.restarts)+'. '+resumo.join(' ; '));
  await db.end();
  console.log('\nResultado do aplicativo: '+pass+' OK, '+fail+' falha(s)');
  process.exit(fail?1:0)
})().catch(e=>{console.error('ERRO NO TESTE',e);console.log('::error title=App do motorista::erro no roteiro de teste: '+String(e&&e.stack||e).replace(/\r?\n/g,' ').slice(0,800));process.exit(2)});
