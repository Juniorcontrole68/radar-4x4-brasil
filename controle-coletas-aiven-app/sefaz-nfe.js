'use strict';
// SEFAZ (Ambiente Nacional): baixa o XML da NF-e pela chave com o certificado A1 da casa.
//
// Configuração (variáveis secretas do Render; sem elas a leitura pela chave fica desligada):
//   WMS_NFE_CERT_PFX_BASE64  arquivo .pfx do A1 em base64, ou então o próprio arquivo .pfx como Secret File do
//                            Render (fica em /etc/secrets/<nome>.pfx; WMS_NFE_CERT_PFX_FILE escolhe outro caminho)
//   WMS_NFE_CERT_SENHA       senha do .pfx
//   WMS_NFE_CNPJ             (opcional) CNPJ do interessado; padrão: o CNPJ que está no certificado
//   WMS_NFE_UF               (opcional) código IBGE da UF da empresa (35 = SP); padrão: a UF da chave
//   WMS_NFE_AMBIENTE         (opcional) 1 = produção (padrão), 2 = homologação
//   WMS_NFE_CA_PEM           (opcional) cadeia ICP-Brasil em PEM para validar o servidor da SEFAZ por completo.
//                            Sem ela, o servidor só é aceito se a cadeia que ele apresenta for da ICP-Brasil.
//   WMS_NFE_URL_DIST / WMS_NFE_URL_EVENTO  (testes) trocam os endereços da SEFAZ
//
// Fluxo: NFeDistribuicaoDFe (consChNFe). Quando a SEFAZ só devolve o resumo (resNFe), o interessado ainda não
// manifestou: registramos a Ciência da Operação (evento 210210, assinado com o A1) e o XML completo
// fica disponível alguns minutos depois.
const https=require('https');
const zlib=require('zlib');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');

const NS='http://www.portalfiscal.inf.br/nfe';
const URLS={
  1:{dist:'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',evento:'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'},
  2:{dist:'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',evento:'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'}
};
const TIMEOUT=30000;

function erro(status,msg,code){const e=new Error(msg);e.status=status;e.code=code;return e}
const so=v=>String(v??'').replace(/\D/g,'');

// chave de 44 dígitos com dígito verificador (módulo 11, pesos 2..9)
function chaveValida(ch){
  ch=so(ch);
  if(ch.length!==44)return false;
  let soma=0,peso=2;
  for(let i=42;i>=0;i--){soma+=Number(ch[i])*peso;peso=peso===9?2:peso+1}
  const r=soma%11,dv=r<2?0:11-r;
  return dv===Number(ch[43]);
}

// o .pfx vem do arquivo (Secret File do Render ou WMS_NFE_CERT_PFX_FILE) ou do texto em base64
function arquivoPfx(){
  const f=String(process.env.WMS_NFE_CERT_PFX_FILE||'').trim();
  if(f)return f;
  try{const n=fs.readdirSync('/etc/secrets').filter(x=>/\.(pfx|p12)$/i.test(x)).sort()[0];return n?path.join('/etc/secrets',n):''}catch{return ''}
}
function lerPfx(){
  const f=arquivoPfx();
  if(f){
    try{return{der:fs.readFileSync(f),origem:'o arquivo '+path.basename(f)}}
    catch(e){throw erro(503,'Não foi possível abrir o arquivo do certificado A1 ('+path.basename(f)+').','CERTIFICADO_INVALIDO')}
  }
  // tolera o que costuma vir junto ao colar: quebras de linha, aspas e o prefixo data:...;base64,
  const b64=String(process.env.WMS_NFE_CERT_PFX_BASE64||'').replace(/\s+/g,'').replace(/^["']+|["']+$/g,'').replace(/^data:[^,]*,/,'');
  if(!b64)return null;
  const der=Buffer.from(b64,'base64');
  if(!/^[A-Za-z0-9+/_-]+=*$/.test(b64)||der[0]!==0x30)
    throw erro(503,'O texto em WMS_NFE_CERT_PFX_BASE64 não é o certificado A1 ('+b64.length+' caracteres; o certificado em texto começa com MII). Cole de novo o texto gerado do arquivo .pfx ou envie o arquivo como Secret File no Render.','CERTIFICADO_INVALIDO');
  return{der,origem:'WMS_NFE_CERT_PFX_BASE64, '+b64.length+' caracteres'};
}
let cache=null;
function certificado(){
  const pfx=lerPfx();
  if(!pfx)return null;
  const senha=String(process.env.WMS_NFE_CERT_SENHA||'');
  const chaveCache=crypto.createHash('sha256').update(pfx.der).update('\0'+senha).digest('hex');
  if(cache&&cache.id===chaveCache)return cache;
  // node-forge lê também .pfx antigos (RC2/3DES) que o OpenSSL 3 do Node recusa
  const forge=require('node-forge');
  let p12;
  try{p12=forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.der.toString('binary')),senha)}
  catch(e){throw erro(503,/mac|password|invalid/i.test(e.message)?'A senha do certificado A1 não confere (WMS_NFE_CERT_SENHA).':'Não foi possível ler o certificado A1 ('+pfx.origem+'): '+e.message,'CERTIFICADO_INVALIDO')}
  const chaves=[...(p12.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag]||[]),...(p12.getBags({bagType:forge.pki.oids.keyBag})[forge.pki.oids.keyBag]||[])];
  const certs=p12.getBags({bagType:forge.pki.oids.certBag})[forge.pki.oids.certBag]||[];
  if(!chaves.length||!certs.length)throw erro(503,'O arquivo do certificado A1 não tem a chave privada ou o certificado.','CERTIFICADO_INVALIDO');
  const key=chaves[0].key;
  // o certificado da empresa é o que casa com a chave privada; os outros são da cadeia
  const fp=c=>forge.pki.getPublicKeyFingerprint(c.publicKey,{encoding:'hex'});
  const alvo=forge.pki.getPublicKeyFingerprint(forge.pki.setRsaPublicKey(key.n,key.e),{encoding:'hex'});
  const meu=(certs.find(b=>fp(b.cert)===alvo)||certs[0]).cert;
  const cn=(meu.subject.getField('CN')||{}).value||'';
  const validoAte=meu.validity.notAfter;
  if(validoAte<new Date())throw erro(503,'O certificado A1 venceu em '+validoAte.toLocaleDateString('pt-BR')+'. Cadastre o certificado novo.','CERTIFICADO_VENCIDO');
  cache={id:chaveCache,keyPem:forge.pki.privateKeyToPem(key),certPem:forge.pki.certificateToPem(meu),
    certB64:forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(meu)).getBytes()),
    cadeiaPem:certs.filter(b=>b.cert!==meu).map(b=>forge.pki.certificateToPem(b.cert)).join(''),
    cnpj:(cn.match(/:(\d{14})\s*$/)||[])[1]||'',nome:cn.replace(/:\d+\s*$/,''),validoAte};
  return cache;
}

function configurado(){return !!(arquivoPfx()||String(process.env.WMS_NFE_CERT_PFX_BASE64||'').trim())}
function ambiente(){return String(process.env.WMS_NFE_AMBIENTE||'1')==='2'?2:1}
function interessado(){
  const cert=certificado();
  const cnpj=so(process.env.WMS_NFE_CNPJ)||cert.cnpj;
  if(cnpj.length!==14)throw erro(503,'Não achei o CNPJ no certificado A1. Informe WMS_NFE_CNPJ.','CERTIFICADO_INVALIDO');
  return{cert,cnpj};
}
function status(){
  if(!configurado())return{configurado:false};
  try{const{cert,cnpj}=interessado();return{configurado:true,cnpj,titular:cert.nome,valido_ate:cert.validoAte.toISOString().slice(0,10),ambiente:ambiente()}}
  catch(e){return{configurado:true,erro:e.message}}
}

// cadeia apresentada pelo servidor precisa ser ICP-Brasil quando não há WMS_NFE_CA_PEM
function cadeiaIcp(socket){
  let c=socket.getPeerCertificate(true);const vistos=new Set();
  while(c&&c.raw&&!vistos.has(c.fingerprint256)){
    vistos.add(c.fingerprint256);
    if(/ICP-Brasil/i.test(String(c.subject?.O||'')+' '+String(c.issuer?.O||'')))return true;
    c=c.issuerCertificate;
  }
  return false;
}

function soap(url,acao,corpo){
  const{cert}=interessado();
  const ca=String(process.env.WMS_NFE_CA_PEM||'').trim();
  const env='<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>'+corpo+'</soap12:Body></soap12:Envelope>';
  return new Promise((ok,falha)=>{
    const u=new URL(url);
    const req=https.request({hostname:u.hostname,port:u.port||443,path:u.pathname+u.search,method:'POST',
      key:cert.keyPem,cert:cert.certPem+cert.cadeiaPem,
      ...(ca?{ca,rejectUnauthorized:true}:{rejectUnauthorized:false}),
      agent:false,timeout:TIMEOUT,
      headers:{'Content-Type':'application/soap+xml; charset=utf-8; action="'+acao+'"','Content-Length':Buffer.byteLength(env)}},res=>{
      if(!ca&&!cadeiaIcp(res.socket)){res.destroy();return falha(erro(502,'O servidor que respondeu não apresentou certificado ICP-Brasil. Consulta cancelada por segurança.','SEFAZ_TLS'))}
      const partes=[];let tam=0;
      res.on('data',d=>{tam+=d.length;if(tam>20*1024*1024){res.destroy();return}partes.push(d)});
      res.on('end',()=>{
        const txt=Buffer.concat(partes).toString('utf8');
        if(res.statusCode>=400&&!/<(?:\w+:)?cStat>/.test(txt))return falha(erro(502,'A SEFAZ respondeu com erro HTTP '+res.statusCode+'.','SEFAZ_HTTP'));
        ok(txt);
      });
      res.on('error',falha);
    });
    req.on('timeout',()=>req.destroy(erro(504,'A SEFAZ não respondeu em '+TIMEOUT/1000+' segundos. Tente de novo em instantes.','SEFAZ_TIMEOUT')));
    req.on('error',e=>{
      if(e.status)return falha(e);
      if(/certificate|self.signed|issuer/i.test(e.message))return falha(erro(502,'Não foi possível validar o certificado do servidor da SEFAZ ('+e.code+').','SEFAZ_TLS'));
      falha(erro(502,'Sem conexão com a SEFAZ: '+(e.code||e.message)+'.','SEFAZ_CONEXAO'));
    });
    req.end(env);
  });
}

const tag=(xml,nome)=>{const m=String(xml||'').match(new RegExp('<(?:\\w+:)?'+nome+'(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?'+nome+'>'));return m?m[1]:''};

// Consulta a NF-e pela chave. Devolve {xml} (procNFe completo) ou {resumo:true} quando só há o resumo.
async function baixarNfe(chave){
  chave=so(chave);
  const{cnpj}=interessado();
  const amb=ambiente();
  const uf=so(process.env.WMS_NFE_UF)||chave.slice(0,2);
  const corpo='<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>'+
    '<distDFeInt xmlns="'+NS+'" versao="1.01"><tpAmb>'+amb+'</tpAmb><cUFAutor>'+uf+'</cUFAutor><CNPJ>'+cnpj+'</CNPJ><consChNFe><chNFe>'+chave+'</chNFe></consChNFe></distDFeInt>'+
    '</nfeDadosMsg></nfeDistDFeInteresse>';
  const resp=await soap(process.env.WMS_NFE_URL_DIST||URLS[amb].dist,'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse',corpo);
  const ret=tag(resp,'retDistDFeInt')||resp;
  const cStat=tag(ret,'cStat'),xMotivo=tag(ret,'xMotivo');
  if(cStat==='137')throw erro(404,'A SEFAZ não encontrou essa nota para o CNPJ '+cnpj+'. Só vêm notas em que a empresa é destinatária, emitente, transportadora ou autorizada no XML.','NFE_NAO_ENCONTRADA');
  if(cStat==='656')throw erro(429,'A SEFAZ bloqueou consultas por excesso de pedidos (consumo indevido). Espere 1 hora e tente de novo.','SEFAZ_LIMITE');
  if(cStat==='640'||cStat==='641')throw erro(403,'A SEFAZ diz que o CNPJ '+cnpj+' não tem permissão para baixar esta nota ('+xMotivo+').','SEFAZ_SEM_PERMISSAO');
  if(cStat!=='138')throw erro(502,'SEFAZ: '+(cStat?cStat+' - ':'')+(xMotivo||'resposta inesperada')+'.','SEFAZ_REJEICAO');
  const docs=[];const re=/<(?:\w+:)?docZip[^>]*schema="([^"]*)"[^>]*>([\s\S]*?)<\/(?:\w+:)?docZip>/g;let m;
  while((m=re.exec(ret))){
    let xml;try{xml=zlib.gunzipSync(Buffer.from(m[2].trim(),'base64')).toString('utf8')}catch{continue}
    docs.push({schema:m[1],xml});
  }
  const proc=docs.find(d=>/^procNFe/i.test(d.schema)||/<(?:\w+:)?nfeProc[\s>]/.test(d.xml));
  if(proc)return{xml:proc.xml};
  if(docs.some(d=>/^resNFe/i.test(d.schema)||/<(?:\w+:)?resNFe[\s>]/.test(d.xml)))return{resumo:true};
  throw erro(502,'A SEFAZ respondeu sem o XML da nota.','SEFAZ_REJEICAO');
}

// horário de Brasília (UTC-3) no formato AAAA-MM-DDThh:mm:ss-03:00
function dhBrasilia(d=new Date()){return new Date(d.getTime()-3*3600e3).toISOString().slice(0,19)+'-03:00'}

// Assina o evento (XMLDSig enveloped, C14N, RSA-SHA1, como pede o leiaute da NF-e).
// O XML é montado já na forma canônica, então o texto assinado é o próprio texto enviado.
function assinarEvento(infEvento,id,cert){
  const canon=infEvento.replace('<infEvento ','<infEvento xmlns="'+NS+'" ');
  const digest=crypto.createHash('sha1').update(canon,'utf8').digest('base64');
  const signedInfo='<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>'+
    '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#'+id+'"><Transforms>'+
    '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms>'+
    '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>'+digest+'</DigestValue></Reference></SignedInfo>';
  const assinatura=crypto.createSign('RSA-SHA1').update(signedInfo,'utf8').sign(cert.keyPem,'base64');
  return'<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">'+signedInfo.replace(' xmlns="http://www.w3.org/2000/09/xmldsig#"','')+
    '<SignatureValue>'+assinatura+'</SignatureValue><KeyInfo><X509Data><X509Certificate>'+cert.certB64+'</X509Certificate></X509Data></KeyInfo></Signature>';
}
function eventoCiencia(chave,quando=new Date()){
  const{cert,cnpj}=interessado();
  const id='ID210210'+chave+'01';
  const inf='<infEvento Id="'+id+'"><cOrgao>91</cOrgao><tpAmb>'+ambiente()+'</tpAmb><CNPJ>'+cnpj+'</CNPJ><chNFe>'+chave+'</chNFe><dhEvento>'+dhBrasilia(quando)+'</dhEvento>'+
    '<tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>';
  return'<envEvento xmlns="'+NS+'" versao="1.00"><idLote>'+String(Date.now()).slice(-15)+'</idLote><evento versao="1.00">'+inf+assinarEvento(inf,id,cert)+'</evento></envEvento>';
}

// Registra a Ciência da Operação; duplicidade (573) conta como já registrada.
async function cienciaOperacao(chave){
  chave=so(chave);
  const amb=ambiente();
  const corpo='<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">'+eventoCiencia(chave)+'</nfeDadosMsg>';
  const resp=await soap(process.env.WMS_NFE_URL_EVENTO||URLS[amb].evento,'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',corpo);
  const lote=tag(resp,'retEnvEvento')||resp;
  if(tag(lote,'cStat')!=='128')throw erro(502,'SEFAZ (evento): '+tag(lote,'cStat')+' - '+(tag(lote,'xMotivo')||'resposta inesperada')+'.','SEFAZ_REJEICAO');
  const inf=tag(tag(lote,'retEvento'),'infEvento');
  const cStat=tag(inf,'cStat');
  if(cStat==='135'||cStat==='136'||cStat==='573')return{registrada:true,cStat,protocolo:tag(inf,'nProt')};
  throw erro(502,'A SEFAZ recusou a Ciência da Operação: '+cStat+' - '+tag(inf,'xMotivo')+'.','SEFAZ_REJEICAO');
}

module.exports={configurado,status,chaveValida,baixarNfe,cienciaOperacao,eventoCiencia,dhBrasilia,_limparCache(){cache=null}};
