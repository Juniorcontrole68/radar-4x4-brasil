// Localização do cliente no agendamento: o que dá para colar do WhatsApp (sem rede)
'use strict';
const path=require('path');
const ag=require(path.join(__dirname,'..','agendamento.js'));
let pass=0,fail=0;
const check=(n,c,x='')=>{if(c){pass++;console.log('  OK   ',n)}else{fail++;console.log('  FALHA',n,JSON.stringify(x))}};
const c=ag.coordsDoTexto;
const t=(nome,txt,la,lo)=>{const r=c(txt);check(nome,r&&Math.abs(r.lat-la)<1e-6&&Math.abs(r.lon-lo)<1e-6,r)};
t('maps.google ?q= (Android)','https://maps.google.com/maps?q=-23.4567%2C-46.5123&z=17',-23.4567,-46.5123);
t('google maps @lat,lon','https://www.google.com/maps/place/Rua+X/@-23.5505,-46.6333,17z/data=!3m1',-23.5505,-46.6333);
t('google maps !3d!4d','https://www.google.com.br/maps/place/X/data=!4m6!3m5!1s0x0:0x0!8m2!3d-23.1234567!4d-46.7654321',-23.1234567,-46.7654321);
t('waze ll=','https://waze.com/ul?ll=-22.9,-43.2&navigate=yes',-22.9,-43.2);
t('apple maps','https://maps.apple.com/?ll=-23.6,-46.7&q=Local',-23.6,-46.7);
t('coordenadas digitadas','-23.55052, -46.63331',-23.55052,-46.63331);
check('link curto não tem coordenadas no texto',c('https://maps.app.goo.gl/AbCdEf')===null);
(async()=>{
  let r=await ag.lerLocalizacao('Olha a localização: https://maps.app.goo.gl/AbCdEf123',{abrir:async()=>({lat:-23.1,lon:-46.2})});
  check('link curto: abre para achar as coordenadas',r.link==='https://maps.app.goo.gl/AbCdEf123'&&r.lat===-23.1,r);
  r=await ag.lerLocalizacao('https://maps.app.goo.gl/AbCdEf123',{abrir:async()=>null});
  check('link curto sem coordenadas: guarda só o link',r.lat===null&&r.link.includes('goo.gl'),r);
  r=await ag.lerLocalizacao('-23.5, -46.6',{abrir:async()=>null});
  check('coordenadas viram link do Google Maps',/google\.com\/maps/.test(r.link)&&r.lat===-23.5,r);
  for(const ruim of ['https://google.evil.com/maps?q=-1.1,-2.2','javascript:alert(1)','ftp://maps.google.com/x','https://exemplo.com/x','']){
    let e=null;try{await ag.lerLocalizacao(ruim,{abrir:async()=>null})}catch(x){e=x}
    check('recusa '+(ruim||'vazio'),e&&e.status===400,e&&e.message);
  }
  console.log('\n'+pass+' ok, '+fail+' falha(s)');process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
