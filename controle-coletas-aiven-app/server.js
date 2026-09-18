const fs=require('fs');
const path=require('path');
const zlib=require('zlib');

if(process.env.DATABASE_URL){
  try{
    const u=new URL(process.env.DATABASE_URL);
    if(u.searchParams.get('sslmode')==='require' && !u.searchParams.has('uselibpqcompat')){
      u.searchParams.set('uselibpqcompat','true');
      process.env.DATABASE_URL=u.toString();
    }
  }catch(e){
    console.error('DATABASE_URL invalida:',e.message);
  }
}

let b='';
for(let i=1;i<=6;i++) b+=fs.readFileSync(path.join(__dirname,'server.part'+i),'utf8').trim();
eval(zlib.gunzipSync(Buffer.from(b,'base64')).toString('utf8'));
