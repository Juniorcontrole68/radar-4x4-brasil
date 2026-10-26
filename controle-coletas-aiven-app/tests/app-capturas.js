// Capturas de tela da versão da Play Store do aplicativo do motorista, para a página da loja.
// Roda no GitHub Actions, no mesmo Android emulado do teste do aplicativo, contra o servidor em
// modo teste. Não é um teste: se algo falhar, só faltam capturas. No fim desinstala o app para
// o teste do aplicativo começar do zero.
//
// Uso: APK=caminho/app-play.apk SAIDA=pasta node tests/app-capturas.js
const {execSync}=require('child_process');
const fs=require('fs'),path=require('path');
const B=process.env.BASE_URL||'http://127.0.0.1:10000';
const PKG='br.com.construlog.motorista';
const APK=process.env.APK||'motorista-android-v2/app/build/outputs/apk/play/app-play.apk';
const SAIDA=process.env.SAIDA||'capturas-motorista';
const ADMIN_USER=process.env.ADMIN_USER||'admin_teste',ADMIN_PASS=process.env.ADMIN_PASS||'senha-de-teste-123';
const DRIVER='João Batista Souza',PLATE='RTA4B21';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sh=(cmd,timeout=90000)=>{try{return execSync(cmd,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']}).trim()}catch(e){return 'ERRO: '+String((e.stderr||'')+' '+(e.message||'')).trim().slice(0,400)}};
const adb=(a,t)=>sh('adb '+a,t);
async function call(method,p,{body,cookie}={}){
  const h={Connection:'close'};if(body!==undefined)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;
  const r=await fetch(B+p,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});
  const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}
  return{status:r.status,json,text,setCookie:r.headers.get('set-cookie')||''}
}
async function until(fn,ms,step=2000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(step)}return null}
function tela(){adb('shell uiautomator dump /sdcard/tela.xml');return adb('shell cat /sdcard/tela.xml')}
function toque(trecho){
  const xml=tela();
  const m=xml.match(new RegExp('text="[^"]*'+trecho.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"'));
  if(!m)return false;
  adb('shell input tap '+Math.round((+m[1]+ +m[3])/2)+' '+Math.round((+m[2]+ +m[4])/2));
  return true
}
let n=0;
function captura(nome){
  n++;const arq=path.join(SAIDA,String(n).padStart(2,'0')+'-'+nome+'.png');
  adb('shell screencap -p /sdcard/captura.png');
  console.log('   captura',arq,adb('pull /sdcard/captura.png '+arq));
}
// Barra de status limpa: 09:00, bateria cheia, sinal cheio, sem ícones de notificação.
function barraLimpa(){
  adb('shell settings put global sysui_demo_allowed 1');
  const d=(a)=>adb('shell am broadcast -a com.android.systemui.demo -e command '+a);
  d('enter');d('clock -e hhmm 0900');d('battery -e level 100 -e plugged false');
  d('network -e mobile show -e level 4 -e datatype lte');d('network -e wifi show -e level 4');d('notifications -e visible false');
}
let lat=-22.7350,lon=-47.3320;
const andar=()=>{lat-=0.0004;lon+=0.0002;adb('emu geo fix '+lon.toFixed(5)+' '+lat.toFixed(5))};

(async()=>{
  fs.mkdirSync(SAIDA,{recursive:true});
  let r=await call('POST','/api/auth/login',{body:{username:ADMIN_USER,password:ADMIN_PASS}});
  const cookie=(r.setCookie.match(/cl_session=[^;]+/)||[''])[0];
  if(!cookie){console.log('::warning title=Capturas::login no servidor de teste falhou');return}
  adb('root');await sleep(3000);adb('wait-for-device');
  adb('uninstall '+PKG);
  console.log('   instalação:',adb('install '+APK,180000).slice(-80));
  adb('shell cmd location set-location-enabled true');andar();
  adb('shell dumpsys deviceidle whitelist +'+PKG);   // sem o passo da bateria nas capturas
  barraLimpa();

  console.log('1. Aviso de localização na primeira abertura');
  adb('shell am start -n '+PKG+'/.MainActivity');
  await until(async()=>tela().includes('Uso da sua localização'),30000);
  await sleep(800);captura('aviso-localizacao');

  console.log('2. Cadastro');
  toque('CONCORDO');await sleep(2500);
  for(const p of ['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION','ACCESS_BACKGROUND_LOCATION','POST_NOTIFICATIONS'])adb('shell pm grant '+PKG+' android.permission.'+p);
  for(let i=0;i<3&&!tela().includes('ATIVAR RASTREAMENTO');i++){adb('shell input keyevent KEYCODE_BACK');await sleep(1500)}
  if(!tela().includes('ATIVAR RASTREAMENTO'))adb('shell am start -n '+PKG+'/.MainActivity');
  await until(async()=>tela().includes('ATIVAR RASTREAMENTO'),20000);
  await sleep(1500);captura('cadastro');

  console.log('3. Pedido enviado, aguardando a central');
  adb('shell am start -n '+PKG+'/.MainActivity --es auto_driver "'+DRIVER.replace(/ /g,'\\ ')+'" --es auto_plate '+PLATE);
  const pend=await until(async()=>{const x=await call('GET','/api/painel/tracking/requests',{cookie});return x.json?.rows?.find(q=>q.status==='pending'&&q.vehicle_plate===PLATE)},60000,3000);
  await until(async()=>tela().includes('Aguardando a central liberar'),20000);
  await sleep(3000);captura('aguardando-liberacao');

  console.log('4. Liberado e rastreando o romaneio');
  if(pend)await call('POST','/api/painel/tracking/requests/'+pend.id+'/approve',{cookie,body:{}});
  const hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  await call('POST','/api/painel/tracking/assignment',{cookie,body:{driver_name:DRIVER,vehicle_plate:PLATE,romaneios:['CAP000123'],work_date:hoje}});
  await until(async()=>{andar();return /Tudo certo/.test(tela())},120000,3000);
  for(let i=0;i<10;i++){andar();await sleep(3000)}
  adb('shell am start -n '+PKG+'/.MainActivity');await sleep(3000);
  captura('tudo-certo');

  console.log('5. Aviso fixo do rastreio');
  adb('shell am broadcast -a com.android.systemui.demo -e command notifications -e visible true');
  adb('shell cmd statusbar expand-notifications');await sleep(2500);
  captura('notificacao');
  adb('shell cmd statusbar collapse');

  adb('shell am broadcast -a com.android.systemui.demo -e command exit');
  adb('uninstall '+PKG);
  console.log('Capturas prontas em '+SAIDA+': '+fs.readdirSync(SAIDA).join(', '));
})().catch(e=>{console.log('::warning title=Capturas::'+String(e&&e.stack||e).replace(/\r?\n/g,' ').slice(0,600))});
