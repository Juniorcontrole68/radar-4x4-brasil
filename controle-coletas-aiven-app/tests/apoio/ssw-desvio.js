// Pré-carregado só no teste: desvia as chamadas ao SSW (sistema e WebAPI do BI2) para o SSW de mentira local.
const http=require('http'),https=require('https');
const real=globalThis.fetch,TARGET='http://127.0.0.1:'+(process.env.MOCK_PORT||10555);
const HOSTS=['https://sistema.ssw.inf.br','https://ssw.inf.br'];
const desvio=url=>{const h=typeof url==='string'&&HOSTS.find(x=>url.startsWith(x+'/'));return h?TARGET+url.slice(h.length):null};
globalThis.fetch=function(input,init){
  const url=typeof input==='string'?input:(input instanceof URL?input.toString():input?.url);
  const alvo=desvio(url);
  if(alvo)return real(alvo,init);
  return real(input,init);
};
const realGet=https.get;
https.get=function(url,opts,cb){
  const alvo=desvio(url);
  if(!alvo)return realGet.apply(this,arguments);
  if(typeof opts==='function'){cb=opts;opts={}}
  return http.get(alvo,opts||{},cb);
};
