const fs = require('fs');
const path = require('path');
const qs = require('querystring');

function loadEnv(){
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const key = t.slice(0,i).trim();
    let value = t.slice(i+1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value=value.slice(1,-1);
    if (!(key in process.env)) process.env[key]=value;
  }
}
const titleCase=s=>String(s||'').toLocaleLowerCase('pt-BR').replace(/(^|[\s\-\/])([\p{L}])/gu,(m,sep,ch)=>sep+ch.toLocaleUpperCase('pt-BR'));
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatDate=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'-';
const body=req=>new Promise((resolve,reject)=>{let data='';req.on('data',c=>{data+=c;if(data.length>1_000_000)reject(new Error('Requisicao muito grande'));});req.on('end',()=>resolve(qs.parse(data)));req.on('error',reject);});
const redirect=(res,to='/')=>{res.writeHead(303,{Location:to});res.end();};
module.exports={loadEnv,titleCase,money,today,esc,formatDate,body,redirect};
