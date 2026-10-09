'use strict';
// O que o SSW guarda de um CT-e, lido sem depender do texto (cortado) do romaneio:
//   - o XML do CT-e, que a opção 101 entrega dentro de um .zip;
//   - a tela da opção 101: bloco "Entrega" e o ponto do mapa que o próprio SSW guarda do cliente.
// Só funções de leitura, sem rede: quem busca os dados é o servidor. Testado em tests/ssw-cte.js.
const zlib=require('zlib');

const MAX_SAIDA=8*1024*1024; // um XML de CT-e tem poucos KB; isto só evita arquivo malicioso

// ---------------------------------------------------------------- .zip
// Lista os arquivos de um .zip (lendo o índice no fim do arquivo) e devolve o conteúdo de cada um.
function zipEntries(buf){
  if(!Buffer.isBuffer(buf)||buf.length<22)return[];
  const out=[];
  let eocd=-1;
  for(let i=buf.length-22;i>=Math.max(0,buf.length-22-65535);i--){
    if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}
  }
  const inflate=(method,data)=>{
    if(method===0)return Buffer.from(data);
    if(method===8)return zlib.inflateRawSync(data,{maxOutputLength:MAX_SAIDA});
    throw new Error('compactação '+method+' não suportada')
  };
  const local=offset=>{
    if(offset<0||offset+30>buf.length||buf.readUInt32LE(offset)!==0x04034b50)return null;
    return{method:buf.readUInt16LE(offset+8),compSize:buf.readUInt32LE(offset+18),
      nameLen:buf.readUInt16LE(offset+26),extraLen:buf.readUInt16LE(offset+28),
      start:offset+30+buf.readUInt16LE(offset+26)+buf.readUInt16LE(offset+28)}
  };
  if(eocd>=0){
    const total=buf.readUInt16LE(eocd+10);
    let p=buf.readUInt32LE(eocd+16);
    for(let n=0;n<total&&n<200;n++){
      if(p+46>buf.length||buf.readUInt32LE(p)!==0x02014b50)break;
      const method=buf.readUInt16LE(p+10),compSize=buf.readUInt32LE(p+20),
        nameLen=buf.readUInt16LE(p+28),extraLen=buf.readUInt16LE(p+30),commentLen=buf.readUInt16LE(p+32),
        offset=buf.readUInt32LE(p+42),name=buf.subarray(p+46,p+46+nameLen).toString('utf8');
      p+=46+nameLen+extraLen+commentLen;
      const lh=local(offset);
      if(!lh||lh.start+compSize>buf.length)continue;
      try{out.push({name,data:inflate(method,buf.subarray(lh.start,lh.start+compSize))})}catch(e){out.push({name,error:String(e.message||e)})}
    }
    if(out.length)return out
  }
  // Sem índice legível: tenta o primeiro arquivo pelo cabeçalho do começo.
  const lh=local(0);
  if(lh&&lh.compSize>0&&lh.start+lh.compSize<=buf.length){
    const name=buf.subarray(30,30+lh.nameLen).toString('utf8');
    try{out.push({name,data:inflate(lh.method,buf.subarray(lh.start,lh.start+lh.compSize))})}catch(e){out.push({name,error:String(e.message||e)})}
  }
  return out
}
function isZip(buf){return Buffer.isBuffer(buf)&&buf.length>4&&buf.readUInt32LE(0)===0x04034b50}
// Texto de um XML baixado do SSW: aceita o .zip (pega o primeiro .xml) ou o XML direto.
function xmlFromDownload(buf){
  if(!Buffer.isBuffer(buf)||!buf.length)return{nome:'',xml:''};
  const decode=b=>{
    const head=b.subarray(0,200).toString('latin1');
    const enc=/encoding=["'](?:iso-8859-1|latin-?1|windows-1252)["']/i.test(head)?'latin1':'utf8';
    return b.toString(enc).replace(/^\uFEFF/,'')
  };
  if(isZip(buf)){
    const entries=zipEntries(buf);
    const hit=entries.find(e=>e.data&&/\.xml$/i.test(e.name))||entries.find(e=>e.data);
    return hit?{nome:hit.name,xml:decode(hit.data),arquivos:entries.map(e=>e.name)}:{nome:'',xml:'',arquivos:entries.map(e=>e.name),erro:(entries.find(e=>e.error)||{}).error||'zip sem arquivo legível'}
  }
  const text=decode(buf);
  return/^\s*</.test(text)?{nome:'',xml:text}:{nome:'',xml:''}
}

// ---------------------------------------------------------------- XML do CT-e
function xmlText(v){
  return String(v||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')
    .replace(/\s+/g,' ').trim()
}
function xmlBlock(xml,name){
  const m=String(xml||'').match(new RegExp('<(?:\\w+:)?'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?'+name+'>','i'));
  return m?m[1]:''
}
function xmlValue(xml,name){return xmlText(xmlBlock(xml,name))}
function xmlParty(xml,name,enderName){
  const block=xmlBlock(xml,name);
  if(!block)return null;
  const e=xmlBlock(block,enderName);
  const cep=xmlValue(e,'CEP').replace(/\D/g,'');
  return{
    nome:xmlValue(block.replace(e,''),'xNome'),doc:xmlValue(block,'CNPJ')||xmlValue(block,'CPF'),
    logradouro:xmlValue(e,'xLgr'),numero:xmlValue(e,'nro'),complemento:xmlValue(e,'xCpl'),bairro:xmlValue(e,'xBairro'),
    cidade:xmlValue(e,'xMun'),uf:xmlValue(e,'UF'),codMunicipio:xmlValue(e,'cMun'),
    cep:cep.length===8?cep.slice(0,5)+'-'+cep.slice(5):''
  }
}
// Lê do XML do CT-e as partes e os campos que ajudam a achar o local de entrega.
function parseCteXml(xml){
  xml=String(xml||'');
  if(!/<(?:\w+:)?infCte\b/i.test(xml))return null;
  const ide=xmlBlock(xml,'ide'),compl=xmlBlock(xml,'compl');
  const obs=[];
  const xObs=xmlValue(compl,'xObs');if(xObs)obs.push(xObs);
  for(const m of compl.matchAll(/<(?:\w+:)?Obs(?:Cont|Fisco)\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Obs(?:Cont|Fisco)>/gi)){
    const campo=(m[1].match(/xCampo=["']([^"']*)["']/i)||[])[1]||'',texto=xmlValue(m[2],'xTexto');
    if(texto)obs.push((campo?campo+': ':'')+texto)
  }
  return{
    chave:((xml.match(/<(?:\w+:)?infCte\b[^>]*\bId=["']CTe(\d{44})["']/i)||[])[1])||xmlValue(xmlBlock(xml,'protCTe'),'chCTe')||'',
    numero:xmlValue(ide,'nCT'),serie:xmlValue(ide,'serie'),emissao:xmlValue(ide,'dhEmi'),
    cidadeFim:xmlValue(ide,'xMunFim'),ufFim:xmlValue(ide,'UFFim'),
    remetente:xmlParty(xml,'rem','enderReme'),expedidor:xmlParty(xml,'exped','enderExped'),
    recebedor:xmlParty(xml,'receb','enderReceb'),destinatario:xmlParty(xml,'dest','enderDest'),
    nfChaves:[...xml.matchAll(/<(?:\w+:)?infNFe\b[^>]*>\s*<(?:\w+:)?chave>(\d{44})<\//gi)].map(m=>m[1]),
    observacoes:obs
  }
}

// ---------------------------------------------------------------- tela da opção 101
function htmlPlain(s){
  return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&([aeiouc])(acute|grave|circ|tilde|cedil|uml);/gi,(_,c,t)=>{
      const map={acute:'\u0301',grave:'\u0300',circ:'\u0302',tilde:'\u0303',cedil:'\u0327',uml:'\u0308'};
      return(c+map[t.toLowerCase()]).normalize('NFC')})
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ').trim()
}
function sswCoord(v){
  const n=Number(String(v??'').trim().replace(',','.'));
  return Number.isFinite(n)&&Math.abs(n)>0.01?n:null
}
// "mapa" ao lado de cada parte: showmapa('end=…&nome=…&olat=-21,97&olng=-46,78&cid=…&uf=SP').
// olat/olng só aparecem quando o SSW já tem o ponto do cliente.
function parseMapaCall(call){
  const m=String(call||'').match(/showmapa\(\s*(['"])([\s\S]*?)\1\s*\)/i);
  if(!m)return null;
  const raw=m[2].replace(/&amp;/g,'&'),out={};
  for(const part of raw.split(/&(?=(?:end|nome|olat|olng|cid|uf)=)/)){
    const i=part.indexOf('=');if(i<0)continue;
    let v=part.slice(i+1);try{v=decodeURIComponent(v)}catch{}
    out[part.slice(0,i)]=v.replace(/\s+/g,' ').trim()
  }
  const lat=sswCoord(out.olat),lon=sswCoord(out.olng);
  const em=String(out.end||'').match(/^(.*?)(?:\s*,\s*([^,]*))?$/);
  return{
    endereco:out.end||'',logradouro:(em?.[1]||'').trim(),numero:(em?.[2]||'').trim(),nome:out.nome||'',cidade:out.cid||'',uf:out.uf||'',
    lat:(lat!==null&&lon!==null&&lat>=-35&&lat<=6&&lon>=-75&&lon<=-33)?lat:null,
    lon:(lat!==null&&lon!==null&&lat>=-35&&lat<=6&&lon>=-75&&lon<=-33)?lon:null
  }
}
// A tela tem duas colunas lado a lado (Expedidor | Entrega), então no texto corrido cada
// rótulo aparece duas vezes: a segunda ocorrência é a da coluna "Entrega".
function parseTela101(html){
  html=String(html||'');
  const mapas={};
  for(const m of html.matchAll(/<a\b([^>]*)>/gi)){
    const a=m[1],id=(a.match(/\bid=["']?(link_mapa_setor_cli_(\w+?))["'\s>]/i)||a.match(/\bid=["']?(link_mapa_setor_cli_(\w+))$/i)||[])[2];
    if(!id)continue;
    const call=(a.match(/\bonclick="([^"]*)"/i)||a.match(/\bonclick='([^']*)'/i)||[])[1]||'';
    const p=parseMapaCall(call.replace(/&quot;/g,'"').replace(/&#39;/g,"'"));
    if(p)mapas[id.toLowerCase()]=p
  }
  const plain=htmlPlain(html);
  let entrega=null;
  const i=plain.search(/Expedidor:\s*Entrega:/i);
  if(i>=0){
    const seg=plain.slice(i,i+1800);
    const m=seg.match(/Endere[cç]o:\s*(.*?)\s*Endere[cç]o:\s*(.*?)\s*Complemento:\s*(.*?)\s*Complemento:\s*(.*?)\s*Bairro:\s*(.*?)\s*Bairro:\s*(.*?)\s*CEP:\s*(\d{5}-?\d{3})?\s*(.*?)\s*CEP:\s*(\d{5}-?\d{3})?\s*(.*?)\s*(?:Telefone:|Celular:|Pagador:|$)/i);
    if(m){
      const cu=String(m[10]||'').match(/^(.*?)\s*\/\s*([A-Z]{2})$/i);
      const en=String(m[2]||'').match(/^(.*?)(?:\s*,\s*([^,]*))?$/);
      entrega={endereco:m[2]||'',logradouro:(en?.[1]||'').trim(),numero:(en?.[2]||'').trim(),complemento:m[4]||'',bairro:m[6]||'',
        cep:m[9]||'',cidade:(cu?cu[1]:m[10]||'').trim(),uf:(cu?cu[2]:'').toUpperCase()};
      const nm=seg.match(/Nome:\s*.*?\s*Nome:\s*(.*?)\s*CNPJ:/i);
      if(nm)entrega.nome=nm[1]
    }
  }
  // Dados da carga, para a lista de carregamento.
  const num=v=>{const n=Number(String(v||'').replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?n:0};
  const ctrc=((plain.match(/CTRC[^:]{0,20}:\s*([A-Z]{3}\d{5,7}-\d)/i)||[])[1]||'').toUpperCase();
  const nfTxt=(plain.match(/da Nota Fiscal:\s*(?:\d{1,3}\/)?0*(\d{1,12})/i)||[])[1]||'';
  const resumo={
    ctrc,nf:nfTxt,
    volumes:Number((plain.match(/Qtde\.?\s*de\s*vol\.?[^:]{0,12}:\s*(\d+)/i)||[])[1]||0),
    peso:num((plain.match(/Peso real[^:]{0,40}:\s*([\d.,]+)/i)||[])[1]),
    valorNf:num((plain.match(/Valor da Nota Fiscal:\s*([\d.,]+)/i)||[])[1]),
    previsao:(plain.match(/Previs[aã]o de entrega:\s*(\d{2}\/\d{2}\/\d{2,4})/i)||[])[1]||'',
    pedido:(plain.match(/Pedido:\s*([A-Z0-9.\/-]{1,30})/i)||[])[1]||'',
    // "CNG AMR 09/10/26 06:45 85-SAIDA PARA ENTREGA": última ocorrência do CT-e
    situacao:((plain.match(/Situa[cç][aã]o Atual:\s*(.{0,140}?)\s+(?:O\s?corr[eê]ncias|Fr\s?e\s?te|D\s?ANFEs)/i)||[])[1]||'').replace(/^[A-Z]{3}\s+[A-Z]{3}\s+/,'').trim()
  };
  return{entrega,mapas,resumo}
}

// ---------------------------------------------------------------- qual endereço usar na entrega
const semAcento=v=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const TIPO_RUA=/^(?:RUA|R|AVENIDA|AV|ALAMEDA|AL|TRAVESSA|TRAV|TV|ESTRADA|ESTR|EST|RODOVIA|ROD|PRACA|PCA|PC|LARGO|VIELA|VIA|VICINAL)\b\.?\s*\S/;
// "SN ENDERECO ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR" -> "RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR"
// Só vale quando o texto diz que é o local de entrega E o que vem depois começa como um logradouro.
function entregaNoComplemento(texto){
  const t=semAcento(texto);
  const m=t.match(/\b(?:END(?:ERECO)?\.?\s*(?:DE\s+|P\/\s*|PARA\s+)?ENTREGA|LOCAL\s+(?:DE\s+|DA\s+)?ENTREGA|ENTREGAR?(?:\s+(?:EM|NA|NO|A))?)\s*[:\-]?\s*(.+)$/);
  if(!m)return'';
  const resto=m[1].replace(/^[\s:,\-]+/,'').trim();
  return TIPO_RUA.test(resto)?resto:''
}
// Endereços possíveis de uma entrega, do mais confiável para o menos. Quem chama tenta achar
// cada um no mapa, nesta ordem, e fica com o primeiro que o mapa reconhece.
//   info: {cte (XML), entrega e mapas (tela 101)}   romaneioEndereco: texto do romaneio (pode vir cortado)
function enderecosEntrega(info,romaneioEndereco=''){
  const cte=info?.cte||null,dest=cte?.destinatario||null,receb=cte?.recebedor||null,tela=info?.entrega||null;
  const mapa=info?.mapas?.ent||info?.mapas?.dest||null;
  const cidade=receb?.cidade||dest?.cidade||tela?.cidade||mapa?.cidade||'',uf=receb?.uf||dest?.uf||tela?.uf||mapa?.uf||'';
  const out=[],seen=new Set();
  const add=(fonte,endereco,numero='',extra={})=>{
    endereco=String(endereco||'').replace(/\s+/g,' ').trim();numero=String(numero||'').trim();
    if(endereco.length<4)return;
    const key=semAcento(endereco)+'|'+semAcento(numero);
    if(seen.has(key))return;seen.add(key);
    out.push({fonte,endereco,numero,bairro:extra.bairro||'',cidade:extra.cidade||cidade,uf:extra.uf||uf,cep:extra.cep||''})
  };
  // 1) recebedor: o CT-e diz que a entrega é em outro lugar
  if(receb?.logradouro)add('XML do CT-e (recebedor)',receb.logradouro,receb.numero,{bairro:receb.bairro,cidade:receb.cidade,uf:receb.uf,cep:receb.cep});
  // 2) "endereço de entrega" escrito no complemento: usa a versão mais completa do texto
  // (a tela do SSW corta o complemento em 28 letras: cortado, ele pode casar com a rua errada)
  const telaCompl=String(tela?.complemento||'').length<26?tela?.complemento:'';
  const textos=[dest?.complemento,telaCompl,romaneioEndereco].map(entregaNoComplemento).filter(Boolean).sort((a,b)=>b.length-a.length);
  if(textos[0])add('complemento (endereço de entrega)',textos[0],'');
  // 3) endereço do destinatário
  if(dest?.logradouro)add('XML do CT-e (destinatário)',dest.logradouro,dest.numero,{bairro:dest.bairro,cep:dest.cep});
  // (com o XML em mãos, cadastro e tela só repetem o mesmo endereço, às vezes cortado)
  if(!dest?.logradouro){
    if(mapa?.logradouro)add('cadastro do cliente no SSW',mapa.logradouro,mapa.numero,{cep:tela?.cep||''});
    if(tela?.logradouro)add('tela do CT-e no SSW',tela.logradouro,tela.numero,{bairro:tela.bairro,cep:tela.cep})
  }
  // 4) o que já se usava: texto do romaneio
  if(romaneioEndereco)add('romaneio',romaneioEndereco,'');
  return out
}


module.exports={zipEntries,isZip,xmlFromDownload,parseCteXml,parseTela101,parseMapaCall,xmlValue,xmlBlock,entregaNoComplemento,enderecosEntrega};
