'use strict';
// NF-e da Lotação: confere a chave de acesso (o código de barras da DANFE), lê o XML da nota
// e monta a DANFE em PDF (A4 retrato, com canhoto, código de barras e itens em várias folhas).
// Só usa o pdf-lib, que o servidor já tinha. Testado em tests/lotacao-notas.js.

const UF_IBGE={'11':'RO','12':'AC','13':'AM','14':'RR','15':'PA','16':'AP','17':'TO','21':'MA','22':'PI','23':'CE','24':'RN','25':'PB','26':'PE','27':'AL','28':'SE','29':'BA',
  '31':'MG','32':'ES','33':'RJ','35':'SP','41':'PR','42':'SC','43':'RS','50':'MS','51':'MT','52':'GO','53':'DF'};

// Valor de cada caractere no cálculo dos dígitos: número vale ele mesmo; letra (CNPJ alfanumérico,
// a partir de 2026) vale o código ASCII menos 48, como manda a Receita.
const valorCar=c=>c.charCodeAt(0)-48;

function dvChave(ch43){
  let soma=0,peso=2;
  for(let i=ch43.length-1;i>=0;i--){soma+=valorCar(ch43[i])*peso;peso=peso===9?2:peso+1}
  const r=soma%11;return r<2?0:11-r
}
function cnpjValido(c){
  c=String(c||'').toUpperCase();
  if(!/^[0-9A-Z]{12}\d{2}$/.test(c)||/^(\d)\1{13}$/.test(c))return false;
  const dv=n=>{let s=0,p=2;for(let i=n-1;i>=0;i--){s+=valorCar(c[i])*p;p=p===9?2:p+1}const r=s%11;return r<2?0:11-r};
  return dv(12)===Number(c[12])&&dv(13)===Number(c[13])
}
function cpfValido(c){
  c=String(c||'').replace(/\D/g,'');
  if(c.length!==11||/^(\d)\1{10}$/.test(c))return false;
  const dv=n=>{let s=0;for(let i=0;i<n;i++)s+=Number(c[i])*(n+1-i);const r=(s*10)%11;return r===10?0:r};
  return dv(9)===Number(c[9])&&dv(10)===Number(c[10])
}
const fmtCnpj=c=>c.length===14?c.slice(0,2)+'.'+c.slice(2,5)+'.'+c.slice(5,8)+'/'+c.slice(8,12)+'-'+c.slice(12):c;
const fmtCpf=c=>c.length===11?c.slice(0,3)+'.'+c.slice(3,6)+'.'+c.slice(6,9)+'-'+c.slice(9):c;
const fmtDoc=d=>{d=String(d||'').toUpperCase().replace(/[^0-9A-Z]/g,'');return d.length===14?fmtCnpj(d):d.length===11?fmtCpf(d):d};
const fmtChave=ch=>String(ch||'').replace(/(.{4})/g,'$1 ').trim();

// Aceita o que o leitor manda (com espaços, pontos ou o prefixo "NFe"). Devolve {ok,erro} ou os dados da chave.
function lerChave(bruto){
  const ch=String(bruto||'').toUpperCase().replace(/^NFE/,'').replace(/[^0-9A-Z]/g,'');
  if(!ch)return{ok:false,erro:'Bipe ou digite a chave de acesso da nota.'};
  if(ch.length!==44)return{ok:false,erro:'A chave de acesso tem 44 caracteres; esta tem '+ch.length+'.'};
  if(!/^\d{6}[0-9A-Z]{12}\d{26}$/.test(ch))return{ok:false,erro:'Chave com caracteres inválidos.'};
  const uf=UF_IBGE[ch.slice(0,2)];
  if(!uf)return{ok:false,erro:'Código de UF da chave ('+ch.slice(0,2)+') não existe.'};
  const mes=Number(ch.slice(4,6));
  if(mes<1||mes>12)return{ok:false,erro:'Mês de emissão da chave ('+ch.slice(4,6)+') inválido.'};
  if(dvChave(ch.slice(0,43))!==Number(ch[43]))return{ok:false,erro:'Dígito verificador não confere: confira a chave (pode ter faltado ou trocado um número).'};
  const modelo=ch.slice(20,22);
  if(modelo!=='55'&&modelo!=='65')return{ok:false,erro:'Modelo '+modelo+' não é NF-e (55) nem NFC-e (65). Se for CT-e, use a tela de sobras.'};
  const doc=ch.slice(6,20);
  // Emitente pessoa física: a chave leva o CPF com três zeros na frente.
  const ehCpf=/^000\d{11}$/.test(doc)&&!cnpjValido(doc)&&cpfValido(doc.slice(3));
  return{ok:true,chave:ch,uf,cUF:ch.slice(0,2),emissao:'20'+ch.slice(2,4)+'-'+ch.slice(4,6),
    emitente_doc:ehCpf?doc.slice(3):doc,emitente_doc_fmt:ehCpf?fmtCpf(doc.slice(3)):fmtCnpj(doc),
    emitente_doc_ok:ehCpf||cnpjValido(doc),modelo,serie:String(Number(ch.slice(22,25))),numero:String(Number(ch.slice(25,34))),
    tpEmis:ch[34],chave_fmt:fmtChave(ch)}
}

// ------------------------------------------------------------------ leitura do XML
function entidades(s){
  return String(s??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(Number(d))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')
}
function bloco(xml,tag){const m=String(xml||'').match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>'));return m?m[1]:''}
function blocos(xml,tag){return[...String(xml||'').matchAll(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','g'))].map(m=>m[1])}
function campo(xml,tag){return entidades(bloco(xml,tag)).replace(/\s+/g,' ').trim()}
function num(v){const n=Number(String(v||'').trim());return Number.isFinite(n)?n:0}

function endereco(b){
  return{lgr:campo(b,'xLgr'),nro:campo(b,'nro'),cpl:campo(b,'xCpl'),bairro:campo(b,'xBairro'),mun:campo(b,'xMun'),uf:campo(b,'UF'),cep:campo(b,'CEP'),fone:campo(b,'fone')}
}

// Lê procNFe/nfeProc (nota autorizada) ou NFe solta. Erro com status 400 se não for NF-e.
function lerXml(texto){
  let xml=String(texto||'');
  if(xml.charCodeAt(0)===0xFEFF)xml=xml.slice(1);
  xml=xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g,'<$1').replace(/\sxmlns(:\w+)?="[^"]*"/g,'');
  const inf=xml.match(/<infNFe\b[^>]*\bId="NFe([0-9A-Z]{44})"[^>]*>([\s\S]*?)<\/infNFe>/);
  if(!inf){const e=new Error('O arquivo não é o XML de uma NF-e (não achei a tag infNFe).');e.status=400;throw e}
  const chave=inf[1],corpo=inf[2];
  const ide=bloco(corpo,'ide'),emit=bloco(corpo,'emit'),dest=bloco(corpo,'dest'),tot=bloco(bloco(corpo,'total'),'ICMSTot');
  const transp=bloco(corpo,'transp'),cobr=bloco(corpo,'cobr'),infAdic=bloco(corpo,'infAdic');
  const prot=bloco(xml,'infProt');
  const itens=blocos(corpo,'det').map(d=>{
    const p=bloco(d,'prod'),imp=bloco(d,'imposto'),icms=bloco(imp,'ICMS'),ipi=bloco(imp,'IPI');
    const orig=campo(icms,'orig'),cst=campo(icms,'CST'),csosn=campo(icms,'CSOSN');
    return{codigo:campo(p,'cProd'),descricao:campo(p,'xProd'),ncm:campo(p,'NCM'),cst:orig+(cst||csosn),cfop:campo(p,'CFOP'),un:campo(p,'uCom'),
      qtd:num(campo(p,'qCom')),vun:num(campo(p,'vUnCom')),vtot:num(campo(p,'vProd')),bc:num(campo(icms,'vBC')),vicms:num(campo(icms,'vICMS')),
      picms:num(campo(icms,'pICMS')),vipi:num(campo(ipi,'vIPI')),pipi:num(campo(ipi,'pIPI')),infAd:campo(d,'infAdProd')}
  });
  const transporta=bloco(transp,'transporta'),veic=bloco(transp,'veicTransp');
  const vols=blocos(transp,'vol').map(v=>({qtd:num(campo(v,'qVol')),esp:campo(v,'esp'),marca:campo(v,'marca'),nVol:campo(v,'nVol'),pesoL:num(campo(v,'pesoL')),pesoB:num(campo(v,'pesoB'))}));
  const somaVol=k=>vols.reduce((s,v)=>s+v[k],0);
  return{
    chave,versao:(xml.match(/<infNFe\b[^>]*\bversao="([^"]+)"/)||[])[1]||'',
    numero:campo(ide,'nNF'),serie:campo(ide,'serie'),modelo:campo(ide,'mod'),natOp:campo(ide,'natOp'),tpNF:campo(ide,'tpNF'),tpAmb:campo(ide,'tpAmb'),
    emissao:campo(ide,'dhEmi')||campo(ide,'dEmi'),saida:campo(ide,'dhSaiEnt')||campo(ide,'dSaiEnt'),
    emit:{doc:campo(emit,'CNPJ')||campo(emit,'CPF'),nome:campo(emit,'xNome'),fantasia:campo(emit,'xFant'),ie:campo(emit,'IE'),iest:campo(emit,'IEST'),ender:endereco(bloco(emit,'enderEmit'))},
    dest:{doc:campo(dest,'CNPJ')||campo(dest,'CPF')||campo(dest,'idEstrangeiro'),nome:campo(dest,'xNome'),ie:campo(dest,'IE'),ender:endereco(bloco(dest,'enderDest'))},
    total:{vBC:num(campo(tot,'vBC')),vICMS:num(campo(tot,'vICMS')),vBCST:num(campo(tot,'vBCST')),vST:num(campo(tot,'vST')),vProd:num(campo(tot,'vProd')),
      vFrete:num(campo(tot,'vFrete')),vSeg:num(campo(tot,'vSeg')),vDesc:num(campo(tot,'vDesc')),vOutro:num(campo(tot,'vOutro')),vIPI:num(campo(tot,'vIPI')),
      vNF:num(campo(tot,'vNF')),vTotTrib:num(campo(tot,'vTotTrib'))},
    transp:{modFrete:campo(transp,'modFrete'),doc:campo(transporta,'CNPJ')||campo(transporta,'CPF'),nome:campo(transporta,'xNome'),ie:campo(transporta,'IE'),
      ender:campo(transporta,'xEnder'),mun:campo(transporta,'xMun'),uf:campo(transporta,'UF'),placa:campo(veic,'placa'),placaUf:campo(veic,'UF'),antt:campo(veic,'RNTC'),
      vol:{qtd:somaVol('qtd'),esp:vols[0]?.esp||'',marca:vols[0]?.marca||'',nVol:vols[0]?.nVol||'',pesoL:somaVol('pesoL'),pesoB:somaVol('pesoB')}},
    dups:blocos(cobr,'dup').map(d=>({n:campo(d,'nDup'),venc:campo(d,'dVenc'),valor:num(campo(d,'vDup'))})),
    infCpl:campo(infAdic,'infCpl'),infFisco:campo(infAdic,'infAdFisco'),
    protocolo:campo(prot,'nProt'),protData:campo(prot,'dhRecbto'),cStat:campo(prot,'cStat'),
    itens
  }
}

// Resumo que fica na lista da coleta (sem os itens).
function resumo(n){
  return{numero:n.numero,serie:n.serie,emissao:n.emissao,emitente_nome:n.emit.nome,emitente_doc:n.emit.doc,destinatario_nome:n.dest.nome,
    destino:[n.dest.ender.mun,n.dest.ender.uf].filter(Boolean).join(' - '),valor:n.total.vNF,peso:n.transp.vol.pesoB||n.transp.vol.pesoL,volumes:n.transp.vol.qtd,
    autorizada:!!n.protocolo&&(n.cStat==='100'||n.cStat==='150'||!n.cStat),protocolo:n.protocolo}
}

// ------------------------------------------------------------------ código de barras (Code 128)
const C128=['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112'];
// Chave só com números: conjunto C (dois dígitos por símbolo), como na DANFE. Com letras: conjunto B.
function code128(texto){
  const t=String(texto);let cod;
  if(/^\d+$/.test(t)&&t.length%2===0){cod=[105];for(let i=0;i<t.length;i+=2)cod.push(Number(t.slice(i,i+2)))}
  else{cod=[104];for(const c of t){const v=c.charCodeAt(0)-32;if(v<0||v>94)throw new Error('Caractere fora do Code 128B');cod.push(v)}}
  let soma=cod[0];for(let i=1;i<cod.length;i++)soma+=cod[i]*i;
  cod.push(soma%103,106);
  return cod.map(c=>C128[c]).join('')
}

// ------------------------------------------------------------------ DANFE em PDF
const CP1252_EXTRA=new Set([0x20AC,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,0x2030,0x0160,0x2039,0x0152,0x017D,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x02DC,0x2122,0x0161,0x203A,0x0153,0x017E,0x0178]);
function texto(v){
  let s='';
  for(const ch of String(v??'').replace(/[\r\n\t]+/g,' ')){
    const c=ch.codePointAt(0);
    if((c>=0x20&&c<=0x7E)||(c>=0xA0&&c<=0xFF)||CP1252_EXTRA.has(c))s+=ch;
    else{const base=ch.normalize('NFD').replace(/[̀-ͯ]/g,'');s+=/^[\x20-\x7E]+$/.test(base)?base:'?'}
  }
  return s
}
const moeda=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const qtdFmt=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:4});
const pesoFmt=v=>v?Number(v).toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3}):'';
function dataBr(v){const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:''}
function horaBr(v){const m=String(v||'').match(/T(\d{2}:\d{2}:\d{2})/);return m?m[1]:''}
const MOD_FRETE={'0':'0-Por conta do Emit','1':'1-Por conta do Dest','2':'2-Por conta de Terceiros','3':'3-Próprio por conta do Rem','4':'4-Próprio por conta do Dest','9':'9-Sem Ocorrência de Transporte'};

async function danfePdf(n){
  const {PDFDocument,StandardFonts,rgb,degrees}=require('pdf-lib');
  const pdf=await PDFDocument.create();
  pdf.setTitle('DANFE NF-e '+n.numero+' série '+n.serie);pdf.setCreator('CONSTRULOG - Torre de Controle');
  const F=await pdf.embedFont(StandardFonts.Helvetica),FB=await pdf.embedFont(StandardFonts.HelveticaBold);
  const W=595.28,H=841.89,M=18,L=M,R=W-M,LW=R-L,preto=rgb(0,0,0),cinza=rgb(.35,.35,.35);
  let pg,y;
  const largura=(t,f,s)=>f.widthOfTextAtSize(t,s);
  function cabe(t,f,s,w){t=texto(t);if(largura(t,f,s)<=w)return t;while(t&&largura(t+'…',f,s)>w)t=t.slice(0,-1);return t+'…'}
  function quebra(t,f,s,w){
    const out=[];let linha='';
    for(const p of texto(t).split(' ')){
      const tent=linha?linha+' '+p:p;
      if(largura(tent,f,s)<=w){linha=tent;continue}
      if(linha)out.push(linha);
      linha=p;while(largura(linha,f,s)>w){let k=linha.length;while(k>1&&largura(linha.slice(0,k),f,s)>w)k--;out.push(linha.slice(0,k));linha=linha.slice(k)}
    }
    if(linha)out.push(linha);return out
  }
  const escrever=(t,x,yy,{f=F,s=7,w,al='l',cor=preto}={})=>{
    let tt=w?cabe(t,f,s,w):texto(t);
    let xx=x;if(w&&al==='r')xx=x+w-largura(tt,f,s);else if(w&&al==='c')xx=x+(w-largura(tt,f,s))/2;
    pg.drawText(tt,{x:xx,y:yy,size:s,font:f,color:cor})
  };
  const caixa=(x,yTopo,w,h)=>pg.drawRectangle({x,y:yTopo-h,width:w,height:h,borderColor:preto,borderWidth:.6});
  // Campo com rótulo pequeno em cima e o valor embaixo.
  function campoBox(x,yTopo,w,h,rot,val,{al='l',s=8,f=F}={}){
    caixa(x,yTopo,w,h);
    escrever(String(rot).toUpperCase(),x+2,yTopo-6,{s:5,w:w-4,cor:cinza});
    escrever(val,x+2,yTopo-h+3,{s,f,w:w-4,al})
  }
  const titulo=(t,yy)=>{escrever(t,L,yy-7,{f:FB,s:6.5});return yy-9};
  function linhaCampos(yTopo,h,defs){let x=L;defs.forEach(([rot,val,frac,op])=>{const w=LW*frac;campoBox(x,yTopo,w,h,rot,val,op||{});x+=w});return yTopo-h}

  const autorizada=!!n.protocolo;
  const semValor=!autorizada?'SEM VALOR FISCAL - XML SEM PROTOCOLO DE AUTORIZAÇÃO':n.tpAmb==='2'?'SEM VALOR FISCAL - EMITIDA EM HOMOLOGAÇÃO':'';
  const emitDoc=fmtDoc(n.emit.doc),barras=code128(n.chave);
  let totalFolhas=1,folha=0;

  function cabecalho(comCanhoto){
    pg=pdf.addPage([W,H]);folha++;y=H-M;
    if(semValor)pg.drawText(texto(semValor),{x:90,y:250,size:26,font:FB,color:rgb(.85,.2,.2),opacity:.25,rotate:degrees(50)});
    if(comCanhoto){
      const hC=46,wNF=LW*.18,wTxt=LW-wNF;
      caixa(L,y,wTxt,22);
      quebra('RECEBEMOS DE '+(n.emit.nome||'')+' OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO. EMISSÃO: '+dataBr(n.emissao)+' VALOR TOTAL: R$ '+moeda(n.total.vNF)+' DESTINATÁRIO: '+(n.dest.nome||''),F,5.5,wTxt-4).slice(0,3)
        .forEach((t,i)=>escrever(t,L+2,y-7-i*6.2,{s:5.5}));
      campoBox(L,y-22,wTxt*.3,hC-22,'Data de recebimento','');
      campoBox(L+wTxt*.3,y-22,wTxt*.7,hC-22,'Identificação e assinatura do recebedor','');
      caixa(L+wTxt,y,wNF,hC);
      escrever('NF-e',L+wTxt,y-14,{f:FB,s:12,w:wNF,al:'c'});
      escrever('Nº '+fmtNumero(n.numero),L+wTxt,y-27,{f:FB,s:8.5,w:wNF,al:'c'});
      escrever('SÉRIE '+(n.serie||''),L+wTxt,y-38,{f:FB,s:8.5,w:wNF,al:'c'});
      y-=hC+3;
      for(let x=L;x<R;x+=6)pg.drawLine({start:{x,y},end:{x:Math.min(x+3,R),y},thickness:.5,color:cinza});
      y-=4;
    }
    // Quadro do emitente | DANFE | código de barras
    const hQ=92,wE=LW*.4,wD=LW*.17,wB=LW-wE-wD;
    caixa(L,y,wE,hQ);
    escrever('IDENTIFICAÇÃO DO EMITENTE',L+2,y-6,{s:5,cor:cinza});
    const nomeLin=quebra(n.emit.nome||'',FB,10,wE-8).slice(0,2);
    nomeLin.forEach((t,i)=>escrever(t,L+4,y-20-i*12,{f:FB,s:10,w:wE-8,al:'c'}));
    const e=n.emit.ender,yE=y-22-nomeLin.length*12;
    [[e.lgr,e.nro].filter(Boolean).join(', ')+(e.cpl?' - '+e.cpl:''),[e.bairro,e.cep?'CEP '+fmtCep(e.cep):''].filter(Boolean).join(' - '),[e.mun,e.uf].filter(Boolean).join(' - '),e.fone?'Fone: '+fmtFone(e.fone):'']
      .filter(Boolean).forEach((t,i)=>escrever(t,L+4,yE-i*9,{s:7,w:wE-8,al:'c'}));
    const xD=L+wE;caixa(xD,y,wD,hQ);
    escrever('DANFE',xD,y-15,{f:FB,s:13,w:wD,al:'c'});
    ['Documento Auxiliar da','Nota Fiscal Eletrônica'].forEach((t,i)=>escrever(t,xD,y-25-i*7.5,{s:6.5,w:wD,al:'c'}));
    escrever('0 - ENTRADA',xD+6,y-48,{s:6.5});escrever('1 - SAÍDA',xD+6,y-56,{s:6.5});
    caixa(xD+wD-22,y-42,13,15);escrever(n.tpNF||'',xD+wD-22,y-53,{f:FB,s:10,w:13,al:'c'});
    escrever('Nº '+fmtNumero(n.numero),xD,y-69,{f:FB,s:8,w:wD,al:'c'});
    escrever('SÉRIE '+(n.serie||''),xD,y-78,{f:FB,s:8,w:wD,al:'c'});
    escrever('FOLHA '+folha+'/'+totalFolhas,xD,y-87,{s:7,w:wD,al:'c'});
    const xB=xD+wD;caixa(xB,y,wB,hQ*.42);
    const mod=(wB-16)/barras.split('').reduce((s,d)=>s+Number(d),0);let bx=xB+8,barra=true;
    for(const d of barras){const w=Number(d)*mod;if(barra)pg.drawRectangle({x:bx,y:y-hQ*.42+5,width:w,height:hQ*.42-10,color:preto});bx+=w;barra=!barra}
    campoBox(xB,y-hQ*.42,wB,hQ*.23,'Chave de acesso',fmtChave(n.chave),{al:'c',s:7.5,f:FB});
    caixa(xB,y-hQ*.65,wB,hQ*.35);
    ['Consulta de autenticidade no portal nacional da NF-e','www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora']
      .forEach((t,i)=>escrever(t,xB,y-hQ*.65-12-i*9,{s:7,w:wB,al:'c'}));
    y-=hQ;
    y=linhaCampos(y,20,[['Natureza da operação',n.natOp,.6],['Protocolo de autorização de uso',autorizada?(n.protocolo+' - '+dataBr(n.protData)+' '+horaBr(n.protData)):'NÃO AUTORIZADA (sem protocolo no XML)',.4,{al:'c'}]]);
    y=linhaCampos(y,20,[['Inscrição estadual',n.emit.ie,1/3],['Insc. estadual do subst. trib.',n.emit.iest,1/3],['CNPJ / CPF',emitDoc,1/3]]);
  }

  // Colunas dos itens (frações da largura)
  const COLS=[['CÓDIGO',.08,'l'],['DESCRIÇÃO DO PRODUTO / SERVIÇO',.275,'l'],['NCM/SH',.06,'c'],['CST',.035,'c'],['CFOP',.04,'c'],['UN',.035,'c'],['QUANT.',.065,'r'],
    ['V. UNIT.',.07,'r'],['V. TOTAL',.075,'r'],['BC ICMS',.07,'r'],['V. ICMS',.06,'r'],['V. IPI',.055,'r'],['% ICMS',.04,'r'],['% IPI',.04,'r']];
  const colX=[];{let x=L;COLS.forEach(c=>{colX.push(x);x+=LW*c[1]})}
  const wDesc=LW*COLS[1][1]-4,sItem=6,hLin=7.2;
  const linhasDoItem=it=>quebra(it.descricao+(it.infAd?' - '+it.infAd:''),F,sItem,wDesc);
  function cabecalhoItens(){
    y=titulo('DADOS DO PRODUTO / SERVIÇO',y);
    COLS.forEach((c,i)=>{caixa(colX[i],y,LW*c[1],11);escrever(c[0],colX[i]+1,y-7.5,{s:5,w:LW*c[1]-2,al:'c'})});
    y-=11
  }
  function desenharItem(it,lin){
    const h=lin.length*hLin+2;
    pg.drawLine({start:{x:L,y:y-h},end:{x:R,y:y-h},thickness:.25,color:rgb(.7,.7,.7)});
    COLS.forEach((c,i)=>pg.drawLine({start:{x:colX[i],y},end:{x:colX[i],y:y-h},thickness:.4,color:preto}));
    pg.drawLine({start:{x:R,y},end:{x:R,y:y-h},thickness:.4,color:preto});
    const vals=[it.codigo,null,it.ncm,it.cst,it.cfop,it.un,qtdFmt(it.qtd),qtdFmt(it.vun),moeda(it.vtot),moeda(it.bc),moeda(it.vicms),moeda(it.vipi),qtdFmt(it.picms),qtdFmt(it.pipi)];
    vals.forEach((v,i)=>{if(i===1)lin.forEach((t,k)=>escrever(t,colX[1]+2,y-6-k*hLin,{s:sItem}));else escrever(v,colX[i]+1,y-6,{s:sItem,w:LW*COLS[i][1]-2,al:COLS[i][2]})});
    y-=h
  }
  function blocosPrimeiraFolha(){
    const d=n.dest,de=d.ender;
    y=titulo('DESTINATÁRIO / REMETENTE',y);
    y=linhaCampos(y,19,[['Nome / razão social',d.nome,.62],['CNPJ / CPF',fmtDoc(d.doc),.23],['Data da emissão',dataBr(n.emissao),.15,{al:'c'}]]);
    y=linhaCampos(y,19,[['Endereço',[de.lgr,de.nro].filter(Boolean).join(', ')+(de.cpl?' - '+de.cpl:''),.5],['Bairro / distrito',de.bairro,.22],['CEP',fmtCep(de.cep),.13,{al:'c'}],['Data da saída/entrada',dataBr(n.saida),.15,{al:'c'}]]);
    y=linhaCampos(y,19,[['Município',de.mun,.4],['Fone / fax',fmtFone(de.fone),.2],['UF',de.uf,.05,{al:'c'}],['Inscrição estadual',d.ie,.2],['Hora da saída/entrada',horaBr(n.saida),.15,{al:'c'}]]);
    if(n.dups.length){
      y=titulo('FATURA / DUPLICATAS',y);
      const porLinha=6,wd=LW/porLinha,lin=Math.ceil(Math.min(n.dups.length,18)/porLinha);
      caixa(L,y,LW,lin*20);
      n.dups.slice(0,18).forEach((d,i)=>{const x=L+(i%porLinha)*wd,yy=y-Math.floor(i/porLinha)*20;
        escrever('Nº '+d.n+'  Venc. '+dataBr(d.venc),x+3,yy-8,{s:6,w:wd-6});escrever('R$ '+moeda(d.valor),x+3,yy-16,{s:6.5,f:FB,w:wd-6})});
      y-=lin*20
    }
    const t=n.total;
    y=titulo('CÁLCULO DO IMPOSTO',y);
    y=linhaCampos(y,19,[['Base de cálculo do ICMS',moeda(t.vBC),1/6,{al:'r'}],['Valor do ICMS',moeda(t.vICMS),1/6,{al:'r'}],['Base de cálc. ICMS S.T.',moeda(t.vBCST),1/6,{al:'r'}],
      ['Valor do ICMS subst.',moeda(t.vST),1/6,{al:'r'}],['V. aprox. tributos',moeda(t.vTotTrib),1/6,{al:'r'}],['Valor total dos produtos',moeda(t.vProd),1/6,{al:'r'}]]);
    y=linhaCampos(y,19,[['Valor do frete',moeda(t.vFrete),1/6,{al:'r'}],['Valor do seguro',moeda(t.vSeg),1/6,{al:'r'}],['Desconto',moeda(t.vDesc),1/6,{al:'r'}],
      ['Outras despesas',moeda(t.vOutro),1/6,{al:'r'}],['Valor total do IPI',moeda(t.vIPI),1/6,{al:'r'}],['Valor total da nota',moeda(t.vNF),1/6,{al:'r',f:FB}]]);
    const tr=n.transp,v=tr.vol;
    y=titulo('TRANSPORTADOR / VOLUMES TRANSPORTADOS',y);
    y=linhaCampos(y,19,[['Nome / razão social',tr.nome,.33],['Frete',MOD_FRETE[tr.modFrete]||tr.modFrete,.18],['Código ANTT',tr.antt,.11],['Placa do veículo',tr.placa,.11],['UF',tr.placaUf,.05,{al:'c'}],['CNPJ / CPF',fmtDoc(tr.doc),.22]]);
    y=linhaCampos(y,19,[['Endereço',tr.ender,.45],['Município',tr.mun,.28],['UF',tr.uf,.05,{al:'c'}],['Inscrição estadual',tr.ie,.22]]);
    y=linhaCampos(y,19,[['Quantidade',v.qtd?qtdFmt(v.qtd):'',.12,{al:'r'}],['Espécie',v.esp,.18],['Marca',v.marca,.17],['Numeração',v.nVol,.17],['Peso bruto',pesoFmt(v.pesoB),.18,{al:'r'}],['Peso líquido',pesoFmt(v.pesoL),.18,{al:'r'}]]);
  }

  const hAdic=Math.max(60,Math.min(150,quebra(n.infCpl+(n.infFisco?' '+n.infFisco:''),F,6.5,LW*.65-6).length*7.5+14));
  function dadosAdicionais(){
    const yA=M+hAdic+9;
    escrever('DADOS ADICIONAIS',L,yA-7,{f:FB,s:6.5});
    const w1=LW*.65;caixa(L,yA-9,w1,hAdic);caixa(L+w1,yA-9,LW-w1,hAdic);
    escrever('INFORMAÇÕES COMPLEMENTARES',L+2,yA-15,{s:5,cor:cinza});escrever('RESERVADO AO FISCO',L+w1+2,yA-15,{s:5,cor:cinza});
    const max=Math.floor((hAdic-12)/7.5);
    quebra([n.infCpl,n.infFisco].filter(Boolean).join(' '),F,6.5,w1-6).slice(0,max).forEach((t,i)=>escrever(t,L+3,yA-23-i*7.5,{s:6.5}))
  }

  // Monta as folhas: na primeira, os itens vão até onde couber acima dos dados adicionais;
  // nas outras, o cabeçalho se repete e os itens usam a folha inteira.
  async function montar(){
    folha=0;
    const paginas=[];
    let it=0;
    cabecalho(true);blocosPrimeiraFolha();cabecalhoItens();
    const limite1=M+hAdic+12;
    let limite=limite1;
    while(it<n.itens.length){
      const lin=linhasDoItem(n.itens[it]);
      if(y-(lin.length*hLin+2)<limite){
        paginas.push(pg);cabecalho(false);cabecalhoItens();limite=M+4;continue
      }
      desenharItem(n.itens[it],lin);it++
    }
    paginas.push(pg);
    return paginas
  }
  let paginas=await montar();
  dadosAdicionaisNaPrimeira(paginas);
  if(paginas.length!==totalFolhas){
    // Refaz com a contagem certa de folhas no cabeçalho.
    totalFolhas=paginas.length;
    paginas.forEach(()=>pdf.removePage(0));
    paginas=await montar();dadosAdicionaisNaPrimeira(paginas)
  }
  function dadosAdicionaisNaPrimeira(ps){const atual=pg;pg=ps[0];dadosAdicionais();pg=atual}
  return Buffer.from(await pdf.save())
}
function fmtNumero(nf){const s=String(nf||'').replace(/\D/g,'').padStart(9,'0');return s.slice(0,3)+'.'+s.slice(3,6)+'.'+s.slice(6)}
function fmtCep(c){c=String(c||'').replace(/\D/g,'');return c.length===8?c.slice(0,5)+'-'+c.slice(5):c}
function fmtFone(f){f=String(f||'').replace(/\D/g,'');if(f.length===10)return'('+f.slice(0,2)+') '+f.slice(2,6)+'-'+f.slice(6);if(f.length===11)return'('+f.slice(0,2)+') '+f.slice(2,7)+'-'+f.slice(7);return f}

module.exports={lerChave,dvChave,cnpjValido,cpfValido,lerXml,resumo,danfePdf,code128,fmtChave,fmtDoc,UF_IBGE};
