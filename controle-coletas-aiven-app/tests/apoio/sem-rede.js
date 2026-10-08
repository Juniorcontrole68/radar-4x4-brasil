// Carregado antes do app (node --require): bloqueia qualquer conexão que não seja local
// e anota o destino. Garante que o teste não fale com SSW, Google, Render, etc.
const net=require('net'),fs=require('fs');
const LOG=process.env.NETGUARD_LOG||'';
const orig=net.Socket.prototype.connect;
const local=h=>!h||h==='localhost'||h==='127.0.0.1'||h==='::1'||h==='0.0.0.0';
net.Socket.prototype.connect=function(...args){
  let o=args[0];
  if(Array.isArray(o))o=o[0];
  let host='',port='';
  if(o&&typeof o==='object'){host=o.host||o.hostname||'';port=o.port||''}
  else if(typeof o==='number'){port=o;host=typeof args[1]==='string'?args[1]:''}
  if(o&&typeof o==='object'&&o.path)return orig.apply(this,args);   // socket unix
  if(local(host))return orig.apply(this,args);
  if(LOG)try{fs.appendFileSync(LOG,JSON.stringify({pid:process.pid,host:String(host),port:String(port)})+'\n')}catch{}
  const err=Object.assign(new Error('NETGUARD: saída bloqueada para '+host+':'+port),{code:'ECONNREFUSED'});
  process.nextTick(()=>this.destroy(err));
  return this;
};
