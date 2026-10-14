'use strict';
// Economia de banda (o plano do Render estourou 4x a banda incluída e passou a recusar publicações).
// Vale para TODA resposta do servidor, inclusive as do dashboard repassadas pelo proxy:
//  - ETag em respostas GET de texto (HTML, JS, CSS, JSON): se o navegador já tem a mesma versão,
//    responde 304 sem corpo. "no-store" vira "private, no-cache": o navegador guarda a cópia mas
//    SEMPRE pergunta ao servidor antes de usar, então nada fica desatualizado;
//  - compressão gzip/brotli do texto (JSON e HTML encolhem de 5 a 10 vezes).
// Arquivos binários (APK, PDF, fotos), eventos contínuos (text/event-stream) e respostas muito
// grandes passam direto, como antes. Testado em tests/compressao.js.
const zlib=require('zlib');
const crypto=require('crypto');

const TEXTO=/^(text\/(?!event-stream)|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/i;
const MINIMO_COMPRIMIR=1024;
const MAXIMO_BUFFER=12*1024*1024;

function escolherCodificacao(req){
  const ae=String(req.headers['accept-encoding']||'');
  if(/\bbr\b/.test(ae))return'br';
  if(/\bgzip\b/.test(ae))return'gzip';
  return''
}
function etagConfere(req,etag){
  const inm=String(req.headers['if-none-match']||'');
  if(!inm)return false;
  return inm.split(',').map(x=>x.trim().replace(/^W\//,'')).some(x=>x===etag||x==='*')
}

function economizarBanda(req,res){
  if(req.method==='HEAD')return;
  const writeHead=res.writeHead,write=res.write,end=res.end,setHeader=res.setHeader;
  let modo='',partes=[],tamanho=0;

  const restaurar=()=>{res.writeHead=writeHead;res.write=write;res.end=end};
  const tipo=()=>String(res.getHeader('content-type')||'');
  // Decide uma vez, no primeiro write/end (ou writeHead com o tipo): guardar o corpo ou passar direto.
  const decidir=()=>{
    if(modo)return modo;
    const ok=TEXTO.test(tipo())&&!res.getHeader('content-encoding')&&res.statusCode!==204&&res.statusCode!==304&&res.statusCode<500;
    modo=ok?'guardar':'direto';
    if(modo==='direto'){restaurar();writeHead.call(res,res.statusCode)}
    return modo
  };
  const despejarSemMexer=()=>{
    // corpo grande demais para guardar: manda o que já tem e segue em fluxo normal
    modo='direto';restaurar();writeHead.call(res,res.statusCode);
    for(const p of partes)write.call(res,p);partes=[]
  };

  res.writeHead=function(status,a,b){
    res.statusCode=status;
    const headers=(a&&typeof a==='object')?a:(b&&typeof b==='object'?b:null);
    if(typeof a==='string')res.statusMessage=a;
    if(Array.isArray(headers)){for(let i=0;i+1<headers.length;i+=2)setHeader.call(res,headers[i],headers[i+1])}
    else if(headers)for(const k of Object.keys(headers))if(headers[k]!==undefined)setHeader.call(res,k,headers[k]);
    return res
  };
  res.write=function(chunk,enc,cb){
    if(decidir()==='direto')return res.write(chunk,enc,cb);
    if(typeof enc==='function'){cb=enc;enc=undefined}
    if(chunk!=null&&chunk!==''){const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,enc||'utf8');partes.push(buf);tamanho+=buf.length}
    if(tamanho>MAXIMO_BUFFER){despejarSemMexer();if(cb)process.nextTick(cb);return true}
    if(cb)process.nextTick(cb);
    return true
  };
  res.end=function(chunk,enc,cb){
    if(typeof chunk==='function'){cb=chunk;chunk=null;enc=undefined}
    if(typeof enc==='function'){cb=enc;enc=undefined}
    if(decidir()==='direto')return res.end(chunk,enc,cb);
    if(chunk!=null&&chunk!==''){const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,enc||'utf8');partes.push(buf);tamanho+=buf.length}
    restaurar();
    let corpo=Buffer.concat(partes);partes=[];
    try{
      if(req.method==='GET'&&res.statusCode===200){
        const etag='"'+crypto.createHash('sha1').update(corpo).digest('base64url').slice(0,27)+'"';
        res.setHeader('ETag',etag);
        const cc=String(res.getHeader('cache-control')||'');
        if(!cc||/no-store/i.test(cc))res.setHeader('Cache-Control','private, no-cache');
        res.removeHeader('Pragma');res.removeHeader('Expires');
        if(etagConfere(req,etag)){
          res.removeHeader('Content-Type');res.removeHeader('Content-Length');
          writeHead.call(res,304);return end.call(res,null,undefined,cb)
        }
      }
      const cod=corpo.length>=MINIMO_COMPRIMIR?escolherCodificacao(req):'';
      if(cod){
        corpo=cod==='br'
          ?zlib.brotliCompressSync(corpo,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:5,[zlib.constants.BROTLI_PARAM_SIZE_HINT]:corpo.length}})
          :zlib.gzipSync(corpo,{level:6});
        res.setHeader('Content-Encoding',cod);
      }
      // cabeçalhos repassados pelo proxy do dashboard: o corpo agora vai inteiro, com tamanho fixo
      res.removeHeader('Transfer-Encoding');
      const vary=String(res.getHeader('vary')||'');
      if(!/accept-encoding/i.test(vary))res.setHeader('Vary',vary?vary+', Accept-Encoding':'Accept-Encoding');
      res.setHeader('Content-Length',corpo.length);
    }catch(e){
      console.log('COMPRESSAO falhou, resposta sem compressão: '+String(e.message||e));
      res.removeHeader('Content-Encoding');res.removeHeader('Transfer-Encoding');res.setHeader('Content-Length',corpo.length);
    }
    writeHead.call(res,res.statusCode);
    return end.call(res,corpo,undefined,cb)
  };
}

module.exports={economizarBanda,TEXTO};
