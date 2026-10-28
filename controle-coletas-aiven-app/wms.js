'use strict';
// CONSTRULOG WMS 360° — Fase 1 (núcleo operacional), como módulo da Torre de Controle.
// Armazéns, zonas e endereços; clientes depositantes e produtos; recebimento (manual ou XML da NF-e)
// com conferência cega e recontagem por outro conferente; LPN e etiquetas; armazenagem com endereço
// sugerido e explicado; saldos, movimentações, bloqueios e rastreio.
//
// Regras que não mudam:
//  - Saldo só muda junto com um movimento em wms_movimentos, na mesma transação. Movimento e auditoria
//    não aceitam UPDATE nem DELETE (gatilho no banco). Saldo negativo é recusado pelo banco (CHECK).
//  - Toda operação que mexe em estoque leva um uuid gerado no aparelho (wms_operacoes): a mesma
//    leitura enviada duas vezes (rede ruim, fila offline) devolve a mesma resposta, sem duplicar.
//  - Dados separados por empresa (coluna empresa: 0 = CONSTRULOG). Empresas da demonstração e do
//    teste grátis não chegam aqui (SANDBOX_API do server.js não libera /api/wms).
//  - O módulo só liga com WMS_ATIVO=1. Sem isso nenhuma rota responde e o card fica escondido.
// Permissões: wms (gestão), wms_operador (aplicativo), wms_supervisor (divergências, bloqueios,
// armazenar fora da sugestão), wms_ajuste (estoque inicial e ajuste de saldo). Administrador pode tudo. Testado em tests/wms.js.

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const sefaz=require('./sefaz-nfe');

let ativo=/^(1|true|sim|yes)$/i.test(String(process.env.WMS_ATIVO||'').trim());
const PAGINA_GESTAO=path.join(__dirname,'wms.html');
const PAGINA_APP=path.join(__dirname,'wms-app.html');

const ZONAS=['pulmao','picking','blocado','doca','quarentena','avaria','devolucao','cross_docking','expedicao'];
const ZONAS_GUARDA=['pulmao','picking','blocado'];
const TIPOS_ENDERECO=['porta_palete','blocado','prateleira','chao','doca'];
const ESTADOS=['disponivel','reservado','bloqueado','em_conferencia','avariado','em_transferencia'];
const FOTO_MAX=600*1024;

const limpo=(v,max=200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const codigo=(v,max=60)=>limpo(v,max).toUpperCase();
const so=(v)=>String(v??'').replace(/\D/g,'');
function num(v){
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  let s=String(v).trim();
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  return /^-?\d+(\.\d+)?$/.test(s)?Number(s):null;
}
function dataIso(v){
  const s=String(v??'').trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m){m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m)m=[0,m[3],m[2].padStart(2,'0'),m[1].padStart(2,'0')]}
  if(!m){m=s.match(/^(\d{1,2})\/(\d{4})$/);if(m){const fim=new Date(Date.UTC(+m[2],+m[1],0)).getUTCDate();m=[0,m[2],m[1].padStart(2,'0'),String(fim)]}}
  if(!m)return null;
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?`${m[1]}-${m[2]}-${String(m[3]).padStart(2,'0')}`:null;
}
const qtdOk=q=>q!==null&&q>0&&q<1e9;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function erro(status,msg,code){const e=new Error(msg);e.status=status;if(code)e.code=code;return e}

// ---------------------------------------------------------------- NF-e (XML)
function xmlTexto(s){return String(s??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&amp;/g,'&').trim()}
function tag(xml,nome){const m=String(xml||'').match(new RegExp('<(?:\\w+:)?'+nome+'(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?'+nome+'>'));return m?m[1]:''}
function tags(xml,nome){const out=[],re=new RegExp('<(?:\\w+:)?'+nome+'(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?'+nome+'>','g');let m;while((m=re.exec(String(xml||''))))out.push(m[1]);return out}
// Lê a NF-e (com ou sem nfeProc): chave, número, emitente, destinatário e itens com lote/validade.
function lerNfe(xml){
  const s=String(xml||'');
  const inf=s.match(/<(?:\w+:)?infNFe[^>]*\sId="NFe(\d{44})"/);
  if(!inf)throw erro(400,'O arquivo não é um XML de NF-e (chave de 44 dígitos não encontrada).','XML_INVALIDO');
  const ide=tag(s,'ide'),emit=tag(s,'emit'),dest=tag(s,'dest');
  const itens=[];
  const re=/<(?:\w+:)?det\s[^>]*nItem="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/g;let m;
  while((m=re.exec(s))){
    const prod=tag(m[2],'prod');
    const ean=so(xmlTexto(tag(prod,'cEAN')));
    const base={n_item:+m[1],codigo:xmlTexto(tag(prod,'cProd')).slice(0,60),ean:ean.length>=8?ean:'',descricao:xmlTexto(tag(prod,'xProd')).slice(0,200),
      unidade:xmlTexto(tag(prod,'uCom')).toUpperCase().slice(0,10),qtd:num(xmlTexto(tag(prod,'qCom')))};
    const rastros=tags(prod,'rastro');
    if(rastros.length)for(const r of rastros)itens.push({...base,qtd:num(xmlTexto(tag(r,'qLote')))??base.qtd,lote:xmlTexto(tag(r,'nLote')).slice(0,40),fabricacao:dataIso(xmlTexto(tag(r,'dFab'))),validade:dataIso(xmlTexto(tag(r,'dVal')))});
    else itens.push({...base,lote:'',fabricacao:null,validade:null});
  }
  if(!itens.length)throw erro(400,'A NF-e não tem itens.','XML_INVALIDO');
  return{chave:inf[1],numero:xmlTexto(tag(ide,'nNF')),serie:xmlTexto(tag(ide,'serie')),
    emitente:{cnpj:so(xmlTexto(tag(emit,'CNPJ'))||xmlTexto(tag(emit,'CPF'))),nome:xmlTexto(tag(emit,'xNome')).slice(0,160)},
    destinatario:{cnpj:so(xmlTexto(tag(dest,'CNPJ'))||xmlTexto(tag(dest,'CPF'))),nome:xmlTexto(tag(dest,'xNome')).slice(0,160)},itens};
}

// ---------------------------------------------------------------- DANFE (PDF)
// Quando a SEFAZ não libera o XML (a casa não é emitente, destinatária, transportadora nem autXML),
// o DANFE em PDF traz o mesmo conteúdo: chave, emitente, destinatário e a tabela de produtos.
// Lê o texto do pdftotext -layout; cada item é a linha que tem NCM, CST, CFOP, unidade e quantidade.
const RE_ITEM_DANFE=/^\s*(\S+)\s+(.+?)\s+(\d{8}|\d{4}\.\d{2}\.\d{2})\s+(\d{1,4}(?:\/\d{1,3})?)\s+(\d\.?\d{3})\s+([A-Za-zÀ-ú]{1,6}\d{0,2})\s+(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(?=\s|$)/;
const RE_DOC=/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})\b/;
function textoPdf(buf){
  return new Promise((resolve,reject)=>{
    const {spawn}=require('child_process');
    let p;try{p=spawn('pdftotext',['-layout','-enc','UTF-8','-','-'])}catch(e){return reject(e)}
    const out=[],err=[];let fim=false;
    const tm=setTimeout(()=>{if(fim)return;fim=true;p.kill('SIGKILL');reject(new Error('pdftotext demorou demais'))},20000);
    p.on('error',e=>{if(fim)return;fim=true;clearTimeout(tm);reject(e)});
    p.stdout.on('data',d=>out.push(d));p.stderr.on('data',d=>err.push(d));
    p.on('close',code=>{if(fim)return;fim=true;clearTimeout(tm);
      if(code!==0)return reject(new Error(Buffer.concat(err).toString().slice(0,200)||('pdftotext '+code)));
      resolve(Buffer.concat(out).toString('utf8'))});
    p.stdin.on('error',()=>{});p.stdin.end(buf)
  })
}
async function lerDanfePdf(base64){
  const buf=Buffer.from(String(base64||'').replace(/^data:[^,]*,/,''),'base64');
  if(buf.length<100||buf.slice(0,5).toString()!=='%PDF-')throw erro(400,'O arquivo não é um PDF.','PDF_INVALIDO');
  let txt;
  try{txt=await textoPdf(buf)}
  catch(e){throw erro(e.code==='ENOENT'?503:400,e.code==='ENOENT'?'Leitor de PDF indisponível no servidor.':'Não foi possível ler o PDF: '+limpo(e.message,160),'PDF_INVALIDO')}
  return lerDanfe(txt);
}
function lerDanfe(texto){
  const t=String(texto||'').replace(/\r/g,'');
  if(!t.replace(/\s/g,''))throw erro(400,'O PDF não tem texto (parece uma foto ou digitalização). Use o DANFE original em PDF ou lance os itens à mão.','PDF_SEM_TEXTO');
  let chave='';
  for(const m of t.matchAll(/\d{4}(?:[ .]?\d{4}){10}/g)){const c=so(m[0]);if(sefaz.chaveValida(c)){chave=c;break}}
  if(!chave)throw erro(400,'Não achei a chave de acesso no PDF. Confira se é um DANFE de NF-e.','DANFE_INVALIDO');
  const linhas=t.split('\n');
  const emitNome=limpo((t.match(/RECEBEMOS\s+DE\s+(.+?)\s+OS\s+PRODUTOS/i)||[])[1],160);
  // destinatário: primeira linha com documento depois do quadro "DESTINATÁRIO / REMETENTE"
  let dest={cnpj:'',nome:''};
  const iq=linhas.findIndex(l=>/DESTINAT[AÁ]RIO\s*\/\s*REMETENTE/i.test(l));
  if(iq>=0)for(let i=iq+1;i<Math.min(linhas.length,iq+6);i++){
    const m=linhas[i].match(RE_DOC);
    if(m){dest={cnpj:so(m[1]),nome:limpo(linhas[i].slice(0,m.index).split(/\s{2,}/).filter(Boolean)[0],160)};break}
  }
  if(!dest.cnpj){const m=t.match(/DESTINAT[AÁ]RIO\s*:\s*(.+?)\s+-\s+.*?(?:CNPJ|CPF)\s*:?\s*([\d./-]{14,18})/i);if(m)dest={cnpj:so(m[2]),nome:limpo(m[1],160)}}
  const itens=[];let ult=null,cont=0;
  for(const l of linhas){
    const m=l.match(RE_ITEM_DANFE);
    if(m){
      const qtd=num(m[7]);
      ult={n_item:itens.length+1,codigo:limpo(m[1],60),ean:'',descricao:limpo(m[2],200),unidade:codigo(m[6],10),qtd,lote:'',fabricacao:null,validade:null};
      itens.push(ult);cont=0;continue;
    }
    // descrição que quebrou em mais linhas: texto recuado logo abaixo do item
    if(ult&&cont<4&&/^\s+\S/.test(l)&&!/^\s*(DADOS|C[AÁ]LCULO|INFORMA[CÇ])/i.test(l)&&!/\d+,\d{2}\s+\d+,\d{2}/.test(l)){ult.descricao=limpo(ult.descricao+' '+l,200);cont++;continue}
    ult=null;
  }
  for(const it of itens){
    const lote=it.descricao.match(/\bLOTE\s*(?:N[º°O.]?\s*)?[:.\-]?\s*([A-Z0-9][A-Z0-9./-]{0,39})/i);
    if(lote)it.lote=lote[1].replace(/[.,;]$/,'');
    const val=it.descricao.match(/\b(?:VAL(?:IDADE)?|VENC(?:IMENTO)?|DVAL)\s*[:.\-]?\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\/\d{4})/i);
    if(val)it.validade=dataIso(val[1]);
    const fab=it.descricao.match(/\b(?:FAB(?:RICA[CÇ][AÃ]O)?|DFAB)\s*[:.\-]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if(fab)it.fabricacao=dataIso(fab[1]);
  }
  if(!itens.length||itens.some(i=>!qtdOk(i.qtd)))throw erro(400,'Não consegui ler os produtos deste DANFE. Lance os itens à mão (a chave já foi lida).','DANFE_SEM_ITENS');
  return{chave,numero:String(+chave.slice(25,34)),serie:String(+chave.slice(22,25)),
    emitente:{cnpj:chave.slice(6,20),nome:emitNome},destinatario:dest,itens,origem:'danfe'};
}

// ---------------------------------------------------------------- etiquetas: Code 128 (conjunto B)
const C128=['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
function code128(texto){
  const t=String(texto||'');
  if(!t||/[^\x20-\x7e]/.test(t))throw erro(400,'Código de barras só aceita letras, números e símbolos simples.');
  const vals=[104,...[...t].map(ch=>ch.charCodeAt(0)-32)];
  const soma=vals.reduce((a,v,i)=>a+v*(i||1),0);
  return[...vals,soma%103,106].map(v=>C128[v]).join('');
}
function code128Svg(texto,{altura=60,modulo=2}={}){
  const larguras=code128(texto);
  let x=10*modulo,barras='';
  [...larguras].forEach((w,i)=>{const l=+w*modulo;if(i%2===0)barras+=`<rect x="${x}" y="0" width="${l}" height="${altura}"/>`;x+=l});
  const total=x+10*modulo;
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${altura}" width="${total}" height="${altura}" role="img" aria-label="${String(texto).replace(/[<>&"]/g,'')}">${barras}</svg>`;
}

// ---------------------------------------------------------------- endereço sugerido (armazenagem)
// candidatos: [{id,codigo,zona_tipo,status,tipo,nivel,distancia_m,cap_paletes,cap_kg,cap_m3,
//              ocup:{paletes,kg,m3,produtos:[ids],clientes:[ids]}}]
// carga: {produto_id,cliente_id,paletes,kg,m3,curva,estado}
function cabe(e,carga){
  const o=e.ocup||{paletes:0,kg:0,m3:0,produtos:[],clientes:[]};
  if(e.status!=='ativo')return'endereço '+(e.status==='bloqueado'?'bloqueado':'inativo');
  if(e.tipo==='doca')return'endereço de doca';
  if((o.clientes||[]).some(c=>String(c)!==String(carga.cliente_id)))return'tem mercadoria de outro cliente';
  if(e.tipo==='porta_palete'&&(o.produtos||[]).some(p=>String(p)!==String(carga.produto_id)))return'tem outro produto';
  if(+e.cap_paletes>0&&+o.paletes+ +carga.paletes>+e.cap_paletes)return'sem posição palete livre';
  if(+e.cap_kg>0&&+o.kg+ +carga.kg>+e.cap_kg+1e-9)return'passa do peso máximo ('+(+e.cap_kg)+' kg)';
  if(+e.cap_m3>0&&+o.m3+ +carga.m3>+e.cap_m3+1e-9)return'passa do volume máximo ('+(+e.cap_m3)+' m³)';
  return'';
}
const fmt=(n,c=0)=>Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:c,maximumFractionDigits:c});
function ranquearEnderecos(candidatos,carga){
  const zonas=carga.estado==='avariado'?['avaria']:carga.estado==='bloqueado'?['quarentena']:ZONAS_GUARDA;
  const bons=candidatos.filter(e=>zonas.includes(e.zona_tipo)&&!cabe(e,carga));
  if(!bons.length)return[];
  const dists=bons.map(e=>+e.distancia_m||0).sort((a,b)=>a-b);
  const curva=['A','B','C'].includes(carga.curva)?carga.curva:'C';
  const alvo=curva==='A'?dists[0]:curva==='B'?dists[Math.floor(dists.length/2)]:dists[dists.length-1];
  const pesado=+carga.kg>500;
  return bons.map(e=>{
    const d=+e.distancia_m||0,mesmo=(e.ocup?.produtos||[]).some(p=>String(p)===String(carga.produto_id));
    const pontos=Math.abs(d-alvo)+(pesado?(Math.max(1,+e.nivel||1)-1)*8:0)-(mesmo?6:0);
    const partes=[];
    if(zonas===ZONAS_GUARDA)partes.push('curva '+curva+(curva==='A'?' fica perto da doca':curva==='C'?' fica mais ao fundo':' fica no meio'));
    else partes.push(carga.estado==='avariado'?'mercadoria avariada vai para a área de avarias':'mercadoria bloqueada vai para a quarentena');
    partes.push(fmt(d,0)+' m da doca');
    partes.push('nível '+(+e.nivel||1)+(pesado&&(+e.nivel||1)===1?' (carga pesada embaixo)':''));
    partes.push('cabe '+fmt(carga.paletes)+' palete(s) de '+fmt(carga.kg,0)+' kg');
    if(mesmo)partes.push('junto do mesmo produto');
    return{...e,pontos,motivo:e.codigo+': '+partes.join(', ')};
  }).sort((a,b)=>a.pontos-b.pontos||String(a.codigo).localeCompare(String(b.codigo)));
}

// Códigos A-03-05-02 (rua-coluna-nível-posição) para cadastrar uma faixa de endereços de uma vez.
function ruasDaFaixa(de,ate){
  const a=codigo(de,3),b=codigo(ate||de,3);
  if(/^\d+$/.test(a)&&/^\d+$/.test(b)){const out=[];for(let i=+a;i<=+b;i++)out.push(String(i).padStart(2,'0'));return out}
  if(/^[A-Z]$/.test(a)&&/^[A-Z]$/.test(b)){const out=[];for(let i=a.charCodeAt(0);i<=b.charCodeAt(0);i++)out.push(String.fromCharCode(i));return out}
  return[];
}
function gerarEnderecos(f){
  const ruas=ruasDaFaixa(f.rua_de,f.rua_ate);
  const faixa=(x,padrao)=>{const de=Math.trunc(num(x?.de)??padrao),ate=Math.trunc(num(x?.ate)??de);return{de,ate}};
  const col=faixa(f.colunas,1),niv=faixa(f.niveis,1),pos=faixa(f.posicoes,1);
  if(!ruas.length)throw erro(400,'Informe as ruas (ex.: de A até F, ou de 01 até 10).');
  for(const[nome,x]of[['colunas',col],['níveis',niv],['posições',pos]])if(!(x.de>=1&&x.ate>=x.de&&x.ate<=99))throw erro(400,'Faixa de '+nome+' inválida (1 a 99).');
  const base=num(f.distancia_base_m)??5,passoRua=num(f.passo_rua_m)??8,passoCol=num(f.passo_coluna_m)??1.2;
  const out=[];
  ruas.forEach((rua,ri)=>{for(let c=col.de;c<=col.ate;c++)for(let n=niv.de;n<=niv.ate;n++)for(let p=pos.de;p<=pos.ate;p++){
    out.push({codigo:[rua,String(c).padStart(2,'0'),String(n).padStart(2,'0'),String(p).padStart(2,'0')].join('-'),rua,coluna:c,nivel:n,posicao:p,
      distancia_m:Math.round((base+ri*passoRua+(c-1)*passoCol)*10)/10});
  }});
  if(out.length>5000)throw erro(400,'Faixa grande demais: no máximo 5.000 endereços por vez.');
  return out;
}

// ---------------------------------------------------------------- banco
async function ensureSchema(pool){
  const q=s=>pool.query(s);
  await q(`CREATE TABLE IF NOT EXISTS wms_armazens (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, codigo TEXT NOT NULL, nome TEXT NOT NULL,
    endereco TEXT NOT NULL DEFAULT '', ativo BOOLEAN NOT NULL DEFAULT TRUE, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(empresa,codigo))`);
  await q(`CREATE TABLE IF NOT EXISTS wms_zonas (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, armazem_id BIGINT NOT NULL REFERENCES wms_armazens(id),
    codigo TEXT NOT NULL, nome TEXT NOT NULL, tipo TEXT NOT NULL CHECK (tipo IN (${ZONAS.map(z=>"'"+z+"'").join(',')})),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(armazem_id,codigo))`);
  await q(`CREATE TABLE IF NOT EXISTS wms_enderecos (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, armazem_id BIGINT NOT NULL REFERENCES wms_armazens(id),
    zona_id BIGINT NOT NULL REFERENCES wms_zonas(id), codigo TEXT NOT NULL, rua TEXT NOT NULL DEFAULT '', coluna INT, nivel INT, posicao INT,
    tipo TEXT NOT NULL DEFAULT 'porta_palete' CHECK (tipo IN (${TIPOS_ENDERECO.map(z=>"'"+z+"'").join(',')})),
    cap_paletes INT NOT NULL DEFAULT 1 CHECK (cap_paletes>=0), cap_kg NUMERIC NOT NULL DEFAULT 0 CHECK (cap_kg>=0), cap_m3 NUMERIC NOT NULL DEFAULT 0 CHECK (cap_m3>=0),
    distancia_m NUMERIC NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','bloqueado','inativo')),
    motivo_bloqueio TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(armazem_id,codigo))`);
  await q('CREATE INDEX IF NOT EXISTS idx_wms_enderecos_zona ON wms_enderecos (zona_id)');
  await q(`CREATE TABLE IF NOT EXISTS wms_clientes (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, nome TEXT NOT NULL, cnpj TEXT NOT NULL DEFAULT '',
    regras JSONB NOT NULL DEFAULT '{}'::jsonb, ativo BOOLEAN NOT NULL DEFAULT TRUE, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q("CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_clientes_cnpj ON wms_clientes (empresa,cnpj) WHERE cnpj<>''");
  await q(`CREATE TABLE IF NOT EXISTS wms_produtos (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, cliente_id BIGINT NOT NULL REFERENCES wms_clientes(id),
    sku TEXT NOT NULL, descricao TEXT NOT NULL, ean TEXT NOT NULL DEFAULT '', codigos_alt TEXT[] NOT NULL DEFAULT '{}', categoria TEXT NOT NULL DEFAULT '',
    familia TEXT NOT NULL DEFAULT '', fabricante TEXT NOT NULL DEFAULT '', unidade TEXT NOT NULL DEFAULT 'UN', un_por_caixa INT NOT NULL DEFAULT 0 CHECK (un_por_caixa>=0),
    caixas_por_palete INT NOT NULL DEFAULT 0 CHECK (caixas_por_palete>=0), peso_bruto_kg NUMERIC NOT NULL DEFAULT 0 CHECK (peso_bruto_kg>=0),
    peso_liquido_kg NUMERIC NOT NULL DEFAULT 0, comprimento_cm NUMERIC NOT NULL DEFAULT 0, largura_cm NUMERIC NOT NULL DEFAULT 0, altura_cm NUMERIC NOT NULL DEFAULT 0,
    controla_lote BOOLEAN NOT NULL DEFAULT FALSE, controla_validade BOOLEAN NOT NULL DEFAULT FALSE, controla_serie BOOLEAN NOT NULL DEFAULT FALSE,
    curva_abc TEXT NOT NULL DEFAULT 'C' CHECK (curva_abc IN ('A','B','C')), controle_especial TEXT NOT NULL DEFAULT '',
    estoque_min NUMERIC NOT NULL DEFAULT 0, estoque_max NUMERIC NOT NULL DEFAULT 0, ponto_reposicao NUMERIC NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(cliente_id,sku))`);
  await q("CREATE INDEX IF NOT EXISTS idx_wms_produtos_ean ON wms_produtos (empresa,ean) WHERE ean<>''");
  await q(`CREATE TABLE IF NOT EXISTS wms_lotes (id BIGSERIAL PRIMARY KEY, produto_id BIGINT NOT NULL REFERENCES wms_produtos(id), lote TEXT NOT NULL,
    fabricacao DATE, validade DATE, UNIQUE(produto_id,lote))`);
  await q('CREATE SEQUENCE IF NOT EXISTS wms_lpn_seq');
  await q(`CREATE TABLE IF NOT EXISTS wms_recebimentos (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, armazem_id BIGINT NOT NULL REFERENCES wms_armazens(id),
    cliente_id BIGINT NOT NULL REFERENCES wms_clientes(id), nf_numero TEXT NOT NULL DEFAULT '', nf_serie TEXT NOT NULL DEFAULT '', nf_chave TEXT NOT NULL DEFAULT '',
    emitente_cnpj TEXT NOT NULL DEFAULT '', emitente_nome TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','na_doca','em_conferencia','recontagem','divergencia','conferido','finalizado','cancelado')),
    rodada INT NOT NULL DEFAULT 1, recontar BIGINT[] NOT NULL DEFAULT '{}', doca_id BIGINT REFERENCES wms_enderecos(id), placa TEXT NOT NULL DEFAULT '',
    motorista TEXT NOT NULL DEFAULT '', motorista_doc TEXT NOT NULL DEFAULT '', previsto_para DATE, chegada_em TIMESTAMPTZ, conferencia_inicio_em TIMESTAMPTZ,
    conferencia_fim_em TIMESTAMPTZ, finalizado_em TIMESTAMPTZ, criado_por TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), xml TEXT)`);
  await q("CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_recebimentos_chave ON wms_recebimentos (empresa,nf_chave) WHERE nf_chave<>'' AND status<>'cancelado'");
  await q(`CREATE TABLE IF NOT EXISTS wms_recebimento_itens (id BIGSERIAL PRIMARY KEY, recebimento_id BIGINT NOT NULL REFERENCES wms_recebimentos(id) ON DELETE CASCADE,
    n_item INT NOT NULL DEFAULT 0, produto_id BIGINT REFERENCES wms_produtos(id), codigo TEXT NOT NULL DEFAULT '', ean TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    unidade TEXT NOT NULL DEFAULT '', qtd_nf NUMERIC NOT NULL CHECK (qtd_nf>0), fator NUMERIC NOT NULL DEFAULT 1 CHECK (fator>0),
    lote TEXT NOT NULL DEFAULT '', fabricacao DATE, validade DATE)`);
  await q('CREATE INDEX IF NOT EXISTS idx_wms_rec_itens ON wms_recebimento_itens (recebimento_id)');
  await q(`CREATE TABLE IF NOT EXISTS wms_contagens (id BIGSERIAL PRIMARY KEY, uuid TEXT NOT NULL UNIQUE, recebimento_id BIGINT NOT NULL REFERENCES wms_recebimentos(id),
    rodada INT NOT NULL, produto_id BIGINT NOT NULL REFERENCES wms_produtos(id), lote TEXT NOT NULL DEFAULT '', fabricacao DATE, validade DATE,
    qtd NUMERIC NOT NULL CHECK (qtd>=0), avariada NUMERIC NOT NULL DEFAULT 0 CHECK (avariada>=0), foto BYTEA, foto_mime TEXT,
    usuario TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK (avariada<=qtd))`);
  await q('CREATE INDEX IF NOT EXISTS idx_wms_contagens_rec ON wms_contagens (recebimento_id,rodada)');
  await q(`CREATE TABLE IF NOT EXISTS wms_divergencias (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, recebimento_id BIGINT NOT NULL REFERENCES wms_recebimentos(id),
    produto_id BIGINT NOT NULL REFERENCES wms_produtos(id), tipo TEXT NOT NULL CHECK (tipo IN ('falta','sobra','produto_errado','avaria')),
    qtd_esperada NUMERIC NOT NULL DEFAULT 0, qtd_contada NUMERIC NOT NULL DEFAULT 0, qtd NUMERIC NOT NULL CHECK (qtd>0),
    status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','aceita','bloqueada','recusada')), decisao_por TEXT NOT NULL DEFAULT '',
    decisao_em TIMESTAMPTZ, obs TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS wms_lpns (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, codigo TEXT NOT NULL UNIQUE,
    armazem_id BIGINT NOT NULL REFERENCES wms_armazens(id), endereco_id BIGINT REFERENCES wms_enderecos(id), recebimento_id BIGINT REFERENCES wms_recebimentos(id),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS wms_saldos (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, armazem_id BIGINT NOT NULL REFERENCES wms_armazens(id),
    endereco_id BIGINT NOT NULL REFERENCES wms_enderecos(id), produto_id BIGINT NOT NULL REFERENCES wms_produtos(id), cliente_id BIGINT NOT NULL REFERENCES wms_clientes(id),
    lote_id BIGINT REFERENCES wms_lotes(id), lpn_id BIGINT REFERENCES wms_lpns(id),
    estado TEXT NOT NULL CHECK (estado IN (${ESTADOS.map(z=>"'"+z+"'").join(',')})), qtd NUMERIC NOT NULL CHECK (qtd>=0), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q('CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_saldos_chave ON wms_saldos (endereco_id,produto_id,(COALESCE(lote_id,0)),(COALESCE(lpn_id,0)),estado)');
  await q('CREATE INDEX IF NOT EXISTS idx_wms_saldos_produto ON wms_saldos (empresa,produto_id)');
  await q('CREATE INDEX IF NOT EXISTS idx_wms_saldos_lpn ON wms_saldos (lpn_id) WHERE lpn_id IS NOT NULL');
  await q(`CREATE TABLE IF NOT EXISTS wms_operacoes (uuid TEXT PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, tipo TEXT NOT NULL, usuario TEXT NOT NULL,
    resposta JSONB NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS wms_movimentos (id BIGSERIAL PRIMARY KEY, operacao TEXT NOT NULL, empresa BIGINT NOT NULL DEFAULT 0,
    armazem_id BIGINT NOT NULL REFERENCES wms_armazens(id), tipo TEXT NOT NULL CHECK (tipo IN ('entrada','armazenagem','transferencia','bloqueio','desbloqueio','ajuste','saida')),
    produto_id BIGINT NOT NULL REFERENCES wms_produtos(id), cliente_id BIGINT NOT NULL, lote_id BIGINT, lpn_id BIGINT, qtd NUMERIC NOT NULL CHECK (qtd>0),
    origem_id BIGINT REFERENCES wms_enderecos(id), destino_id BIGINT REFERENCES wms_enderecos(id), estado_origem TEXT, estado_destino TEXT,
    motivo TEXT NOT NULL DEFAULT '', documento TEXT NOT NULL DEFAULT '', usuario TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q('CREATE INDEX IF NOT EXISTS idx_wms_mov_produto ON wms_movimentos (empresa,produto_id,criado_em)');
  await q('CREATE INDEX IF NOT EXISTS idx_wms_mov_lpn ON wms_movimentos (lpn_id) WHERE lpn_id IS NOT NULL');
  await q(`CREATE TABLE IF NOT EXISTS wms_tarefas (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, armazem_id BIGINT NOT NULL REFERENCES wms_armazens(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('armazenagem','movimentacao')), lpn_id BIGINT REFERENCES wms_lpns(id), recebimento_id BIGINT REFERENCES wms_recebimentos(id),
    origem_id BIGINT REFERENCES wms_enderecos(id), sugerido_id BIGINT REFERENCES wms_enderecos(id), motivo_sugestao TEXT NOT NULL DEFAULT '',
    destino_id BIGINT REFERENCES wms_enderecos(id), justificativa TEXT NOT NULL DEFAULT '', prioridade INT NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_execucao','concluida','cancelada')), operador TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), iniciado_em TIMESTAMPTZ, concluido_em TIMESTAMPTZ)`);
  await q("CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_tarefa_lpn_aberta ON wms_tarefas (lpn_id) WHERE status IN ('pendente','em_execucao')");
  await q(`CREATE TABLE IF NOT EXISTS wms_auditoria (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, usuario TEXT NOT NULL, acao TEXT NOT NULL,
    entidade TEXT NOT NULL, entidade_id TEXT NOT NULL DEFAULT '', dados JSONB NOT NULL DEFAULT '{}'::jsonb, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS wms_expedicoes (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, armazem_id BIGINT NOT NULL REFERENCES wms_armazens(id),
    cliente_id BIGINT NOT NULL REFERENCES wms_clientes(id), nf_numero TEXT NOT NULL DEFAULT '', nf_serie TEXT NOT NULL DEFAULT '', nf_chave TEXT NOT NULL DEFAULT '',
    destinatario_cnpj TEXT NOT NULL DEFAULT '', destinatario_nome TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','separando','separada','expedida','cancelada')),
    doca_id BIGINT REFERENCES wms_enderecos(id), placa TEXT NOT NULL DEFAULT '', criado_por TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    separada_em TIMESTAMPTZ, expedida_em TIMESTAMPTZ, expedida_por TEXT NOT NULL DEFAULT '', xml TEXT)`);
  // destinatários das notas de saída (cadastro prévio para lançar a expedição à mão)
  await q(`CREATE TABLE IF NOT EXISTS wms_destinatarios (id BIGSERIAL PRIMARY KEY, empresa BIGINT NOT NULL DEFAULT 0, nome TEXT NOT NULL, cnpj TEXT NOT NULL DEFAULT '',
    cidade TEXT NOT NULL DEFAULT '', uf TEXT NOT NULL DEFAULT '', ativo BOOLEAN NOT NULL DEFAULT TRUE, criado_por TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q("CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_destinatarios_cnpj ON wms_destinatarios (empresa,cnpj) WHERE cnpj<>'' AND ativo");
  await q("CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_expedicoes_chave ON wms_expedicoes (empresa,nf_chave) WHERE nf_chave<>'' AND status<>'cancelada'");
  await q(`CREATE TABLE IF NOT EXISTS wms_expedicao_itens (id BIGSERIAL PRIMARY KEY, expedicao_id BIGINT NOT NULL REFERENCES wms_expedicoes(id) ON DELETE CASCADE,
    n_item INT NOT NULL DEFAULT 0, produto_id BIGINT REFERENCES wms_produtos(id), codigo TEXT NOT NULL DEFAULT '', ean TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    unidade TEXT NOT NULL DEFAULT '', qtd_nf NUMERIC NOT NULL CHECK (qtd_nf>0), fator NUMERIC NOT NULL DEFAULT 1 CHECK (fator>0), lote TEXT NOT NULL DEFAULT '')`);
  await q('CREATE INDEX IF NOT EXISTS idx_wms_exp_itens ON wms_expedicao_itens (expedicao_id)');
  await q(`CREATE TABLE IF NOT EXISTS wms_expedicao_separacao (id BIGSERIAL PRIMARY KEY, expedicao_id BIGINT NOT NULL REFERENCES wms_expedicoes(id),
    item_id BIGINT NOT NULL REFERENCES wms_expedicao_itens(id), endereco_id BIGINT NOT NULL REFERENCES wms_enderecos(id), lote_id BIGINT REFERENCES wms_lotes(id),
    lpn_id BIGINT REFERENCES wms_lpns(id), qtd NUMERIC NOT NULL CHECK (qtd>0), qtd_separada NUMERIC NOT NULL DEFAULT 0 CHECK (qtd_separada>=0 AND qtd_separada<=qtd),
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','separada','cancelada')), separado_por TEXT NOT NULL DEFAULT '', separado_em TIMESTAMPTZ)`);
  await q('CREATE INDEX IF NOT EXISTS idx_wms_exp_sep ON wms_expedicao_separacao (expedicao_id)');
  // tipos de movimento da expedição (reserva e separação) entram na regra do banco sem recriar a tabela
  {const r=await q("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='wms_movimentos_tipo_check'");
   if(!r?.rows?.[0]||!/separacao/.test(r.rows[0].d)){
     await q('ALTER TABLE wms_movimentos DROP CONSTRAINT IF EXISTS wms_movimentos_tipo_check');
     await q("ALTER TABLE wms_movimentos ADD CONSTRAINT wms_movimentos_tipo_check CHECK (tipo IN ('entrada','armazenagem','transferencia','bloqueio','desbloqueio','ajuste','saida','reserva','separacao'))");
   }}
  await q(`CREATE TABLE IF NOT EXISTS wms_tarifas (cliente_id BIGINT PRIMARY KEY REFERENCES wms_clientes(id), empresa BIGINT NOT NULL DEFAULT 0,
    atualizado_por TEXT NOT NULL DEFAULT '', atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for(const k of CAMPOS_TARIFA)await q(`ALTER TABLE wms_tarifas ADD COLUMN IF NOT EXISTS ${k} NUMERIC NOT NULL DEFAULT 0 CHECK (${k}>=0)`);
  await q(`CREATE TABLE IF NOT EXISTS wms_ocupacao_diaria (data DATE NOT NULL, empresa BIGINT NOT NULL DEFAULT 0, cliente_id BIGINT NOT NULL REFERENCES wms_clientes(id),
    armazem_id BIGINT NOT NULL REFERENCES wms_armazens(id), paletes INT NOT NULL DEFAULT 0, posicoes INT NOT NULL DEFAULT 0, unidades NUMERIC NOT NULL DEFAULT 0, kg NUMERIC NOT NULL DEFAULT 0, m3 NUMERIC NOT NULL DEFAULT 0,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (data,cliente_id,armazem_id))`);
  await q('ALTER TABLE wms_ocupacao_diaria ADD COLUMN IF NOT EXISTS posicoes INT NOT NULL DEFAULT 0');
  await q(`CREATE OR REPLACE FUNCTION wms_imutavel() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN RAISE EXCEPTION 'registro do WMS não pode ser alterado nem apagado (%).', TG_TABLE_NAME USING ERRCODE='42501'; END $f$`);
  for(const t of['wms_movimentos','wms_auditoria']){
    await q(`DROP TRIGGER IF EXISTS ${t}_imutavel ON ${t}`);
    await q(`CREATE TRIGGER ${t}_imutavel BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION wms_imutavel()`);
  }
  // foto da ocupação para o faturamento: na subida e a cada hora (guarda o maior valor do dia)
  const foto=()=>fotografarOcupacao(pool).catch(e=>console.error('[wms] foto da ocupação falhou:',e.message));
  foto();if(!fotoTimer){fotoTimer=setInterval(foto,3600e3);fotoTimer.unref?.()}
}
let fotoTimer=null;

async function tx(pool,fn){
  for(let t=0;;t++){
    const c=await pool.connect();
    try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r}
    catch(e){
      await c.query('ROLLBACK').catch(()=>{});
      if((e.code==='40P01'||e.code==='40001')&&t<4){await sleep(25*(t+1)+Math.random()*25);continue}
      throw e;
    }finally{c.release()}
  }
}
async function auditar(c,ctx,acao,entidade,id,dados={}){
  await c.query('INSERT INTO wms_auditoria(empresa,usuario,acao,entidade,entidade_id,dados) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[ctx.emp,ctx.usuario,acao,entidade,String(id??''),JSON.stringify(dados)]);
}
// Operação com uuid do aparelho: a primeira resposta fica guardada e é devolvida nas repetições.
async function operacao(pool,ctx,uuid,tipo,fn){
  const id=String(uuid||'');
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(id))throw erro(400,'Identificador da operação (uuid) inválido.','UUID_INVALIDO');
  const ja=await pool.query('SELECT resposta FROM wms_operacoes WHERE uuid=$1 AND empresa=$2',[id,ctx.emp]);
  if(ja.rowCount)return{...ja.rows[0].resposta,duplicado:true};
  try{
    return await tx(pool,async c=>{
      await c.query('INSERT INTO wms_operacoes(uuid,empresa,tipo,usuario,resposta) VALUES($1,$2,$3,$4,$5::jsonb)',[id,ctx.emp,tipo,ctx.usuario,'{}']);
      const r=await fn(c,id);
      await c.query('UPDATE wms_operacoes SET resposta=$2::jsonb WHERE uuid=$1',[id,JSON.stringify(r)]);
      return r;
    });
  }catch(e){
    if(e.code==='23505'&&/wms_operacoes_pkey/.test(e.constraint||e.message||'')){
      const r=await pool.query('SELECT resposta FROM wms_operacoes WHERE uuid=$1 AND empresa=$2',[id,ctx.emp]);
      if(r.rowCount)return{...r.rows[0].resposta,duplicado:true};
    }
    throw e;
  }
}
// Muda saldo: tira de (endereço, estado) e/ou põe em (endereço, estado), grava o movimento.
async function mover(c,ctx,m){
  const q=+m.qtd;
  if(!(q>0))throw erro(400,'Quantidade inválida.');
  const chave=[m.produto_id,m.lote_id||0];
  if(m.de){
    const r=await c.query(`SELECT id,qtd FROM wms_saldos WHERE endereco_id=$1 AND produto_id=$2 AND COALESCE(lote_id,0)=$3 AND COALESCE(lpn_id,0)=$4 AND estado=$5 FOR UPDATE`,
      [m.de.endereco_id,...chave,m.de.lpn_id||0,m.de.estado]);
    const tem=r.rowCount?+r.rows[0].qtd:0;
    if(tem+1e-9<q)throw erro(409,'Estoque insuficiente: há '+fmt(tem,3).replace(/,?0+$/,'')+' e foram pedidas '+fmt(q,3).replace(/,?0+$/,'')+'.','ESTOQUE_INSUFICIENTE');
    if(Math.abs(tem-q)<1e-9)await c.query('DELETE FROM wms_saldos WHERE id=$1',[r.rows[0].id]);
    else await c.query('UPDATE wms_saldos SET qtd=qtd-$2,atualizado_em=NOW() WHERE id=$1',[r.rows[0].id,q]);
  }
  if(m.para){
    await c.query(`INSERT INTO wms_saldos(empresa,armazem_id,endereco_id,produto_id,cliente_id,lote_id,lpn_id,estado,qtd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (endereco_id,produto_id,(COALESCE(lote_id,0)),(COALESCE(lpn_id,0)),estado) DO UPDATE SET qtd=wms_saldos.qtd+EXCLUDED.qtd,atualizado_em=NOW()`,
      [ctx.emp,m.armazem_id,m.para.endereco_id,m.produto_id,m.cliente_id,m.lote_id||null,m.para.lpn_id||null,m.para.estado,q]);
  }
  await c.query(`INSERT INTO wms_movimentos(operacao,empresa,armazem_id,tipo,produto_id,cliente_id,lote_id,lpn_id,qtd,origem_id,destino_id,estado_origem,estado_destino,motivo,documento,usuario)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [m.operacao,ctx.emp,m.armazem_id,m.tipo,m.produto_id,m.cliente_id,m.lote_id||null,(m.para?.lpn_id||m.de?.lpn_id)||null,q,m.de?.endereco_id||null,m.para?.endereco_id||null,
     m.de?.estado||null,m.para?.estado||null,limpo(m.motivo,300),limpo(m.documento,120),ctx.usuario]);
}
const SQL_M3='(p.comprimento_cm*p.largura_cm*p.altura_cm/1000000.0)';
async function ocupacoes(c,ids){
  if(!ids.length)return new Map();
  const r=await c.query(`SELECT s.endereco_id::text AS id,COUNT(DISTINCT s.lpn_id)::int AS lpns,BOOL_OR(s.lpn_id IS NULL) AS solto,
      COALESCE(SUM(s.qtd*p.peso_bruto_kg),0)::float AS kg,COALESCE(SUM(s.qtd*${SQL_M3}),0)::float AS m3,
      ARRAY_AGG(DISTINCT s.produto_id::text) AS produtos,ARRAY_AGG(DISTINCT s.cliente_id::text) AS clientes
    FROM wms_saldos s JOIN wms_produtos p ON p.id=s.produto_id WHERE s.endereco_id=ANY($1::bigint[]) GROUP BY s.endereco_id`,[ids]);
  // posições já prometidas a tarefas abertas contam como ocupadas (duas tarefas não recebem o mesmo endereço)
  const t=await c.query(`SELECT t.sugerido_id::text AS id,COUNT(*)::int AS n,COALESCE(SUM(x.kg),0)::float AS kg,COALESCE(SUM(x.m3),0)::float AS m3,
      ARRAY_AGG(DISTINCT x.produto) FILTER (WHERE x.produto IS NOT NULL) AS produtos,ARRAY_AGG(DISTINCT x.cliente) FILTER (WHERE x.cliente IS NOT NULL) AS clientes
    FROM wms_tarefas t LEFT JOIN LATERAL (SELECT SUM(s.qtd*p.peso_bruto_kg) AS kg,SUM(s.qtd*${SQL_M3}) AS m3,MIN(s.produto_id)::text AS produto,MIN(s.cliente_id)::text AS cliente
      FROM wms_saldos s JOIN wms_produtos p ON p.id=s.produto_id WHERE s.lpn_id=t.lpn_id) x ON TRUE
    WHERE t.status IN ('pendente','em_execucao') AND t.sugerido_id=ANY($1::bigint[]) GROUP BY t.sugerido_id`,[ids]);
  const out=new Map();
  for(const x of r.rows)out.set(x.id,{paletes:x.lpns+(x.solto?1:0),kg:x.kg,m3:x.m3,produtos:x.produtos||[],clientes:x.clientes||[]});
  for(const x of t.rows){const o=out.get(x.id)||{paletes:0,kg:0,m3:0,produtos:[],clientes:[]};
    out.set(x.id,{paletes:o.paletes+x.n,kg:o.kg+x.kg,m3:o.m3+x.m3,produtos:[...new Set([...o.produtos,...(x.produtos||[])])],clientes:[...new Set([...o.clientes,...(x.clientes||[])])]})}
  return out;
}
async function cargaDoLpn(c,lpnId){
  const r=await c.query(`SELECT s.produto_id::text AS produto_id,s.cliente_id::text AS cliente_id,s.estado,SUM(s.qtd)::float AS qtd,
      SUM(s.qtd*p.peso_bruto_kg)::float AS kg,SUM(s.qtd*${SQL_M3})::float AS m3,MIN(p.curva_abc) AS curva
    FROM wms_saldos s JOIN wms_produtos p ON p.id=s.produto_id WHERE s.lpn_id=$1 GROUP BY s.produto_id,s.cliente_id,s.estado`,[lpnId]);
  if(!r.rowCount)return null;
  const x=r.rows[0];
  return{produto_id:x.produto_id,cliente_id:x.cliente_id,estado:x.estado,curva:x.curva,paletes:1,
    kg:r.rows.reduce((a,y)=>a+y.kg,0),m3:r.rows.reduce((a,y)=>a+y.m3,0),qtd:r.rows.reduce((a,y)=>a+y.qtd,0)};
}
async function candidatos(c,armazemId,excluirId){
  const r=await c.query(`SELECT e.id::text AS id,e.codigo,e.tipo,e.status,e.nivel,e.distancia_m::float AS distancia_m,e.cap_paletes,e.cap_kg::float AS cap_kg,
      e.cap_m3::float AS cap_m3,z.tipo AS zona_tipo FROM wms_enderecos e JOIN wms_zonas z ON z.id=e.zona_id
    WHERE e.armazem_id=$1 AND e.status='ativo' AND z.tipo<>'doca' AND e.id<>COALESCE($2::bigint,0)`,[armazemId,excluirId||null]);
  const oc=await ocupacoes(c,r.rows.map(x=>x.id));
  return r.rows.map(e=>({...e,ocup:oc.get(e.id)||{paletes:0,kg:0,m3:0,produtos:[],clientes:[]}}));
}
async function sugerir(c,armazemId,lpnId,excluirId){
  const carga=await cargaDoLpn(c,lpnId);
  if(!carga)return null;
  const lista=ranquearEnderecos(await candidatos(c,armazemId,excluirId),carga);
  return lista[0]?{id:lista[0].id,codigo:lista[0].codigo,motivo:lista[0].motivo}:{id:null,codigo:'',motivo:'Nenhum endereço livre comporta este palete. Cadastre ou libere endereços.'};
}

// ---------------------------------------------------------------- sessão e permissões
async function contexto(deps,req,nivel){
  const user=await deps.dashboardSession(req,false);
  if(user.sandbox||user.demo)throw erro(403,'O WMS ainda não está disponível para esta empresa.');
  const casa=!user.client_id||String(user.client?.slug||'').toLowerCase()==='construlog';
  const has=p=>!!(user.is_admin||deps.dashboardHas(user,p));
  const ctx={user,emp:casa?0:Number(user.client_id),usuario:String(user.username||''),
    gestao:has('wms'),operador:has('wms')||has('wms_operador'),supervisor:has('wms_supervisor'),ajuste:has('wms_ajuste'),admin:!!user.is_admin};
  if(nivel==='gestao'&&!ctx.gestao)throw erro(403,'Seu usuário não tem acesso à gestão do WMS. Peça a liberação a um administrador.');
  if(nivel==='operador'&&!ctx.operador)throw erro(403,'Seu usuário não tem acesso ao WMS. Peça a liberação a um administrador.');
  if(nivel==='supervisor'&&!ctx.supervisor)throw erro(403,'Esta ação é do supervisor do WMS.','SEM_PERMISSAO');
  if(nivel==='ajuste'&&!ctx.ajuste)throw erro(403,'Seu usuário não tem a permissão de estoque inicial e ajuste do WMS. Peça a liberação a um administrador.','SEM_PERMISSAO');
  return ctx;
}
async function doEmpresa(c,ctx,tabela,id,msg){
  if(!/^\d+$/.test(String(id??'')))throw erro(404,msg||'Registro não encontrado.');
  const r=await c.query(`SELECT * FROM ${tabela} WHERE id=$1 AND empresa=$2`,[id,ctx.emp]);
  if(!r.rowCount)throw erro(404,msg||'Registro não encontrado.');
  return r.rows[0];
}
async function enderecoPorCodigo(c,ctx,armazemId,cod){
  const s=codigo(cod);
  const r=await c.query(`SELECT e.*,z.tipo AS zona_tipo FROM wms_enderecos e JOIN wms_zonas z ON z.id=e.zona_id WHERE e.empresa=$1 AND e.armazem_id=$2 AND (e.codigo=$3 OR e.id::text=$3)`,[ctx.emp,armazemId,s]);
  if(!r.rowCount)throw erro(404,'Endereço '+s+' não existe neste armazém.','ENDERECO_INEXISTENTE');
  return r.rows[0];
}
async function produtoPorCodigo(c,ctx,clienteId,cod){
  const s=limpo(cod,80);
  if(!s)throw erro(400,'Leia o código do produto.');
  const r=await c.query(`SELECT * FROM wms_produtos WHERE empresa=$1 AND ativo AND ($2::bigint IS NULL OR cliente_id=$2)
      AND (upper(sku)=upper($3) OR ean=$3 OR $3=ANY(codigos_alt)) ORDER BY (upper(sku)=upper($3)) DESC LIMIT 2`,[ctx.emp,clienteId||null,s]);
  if(!r.rowCount)throw erro(404,'Produto '+s+' não cadastrado'+(clienteId?' para este cliente':'')+'. Chame o supervisor.','PRODUTO_INEXISTENTE');
  if(r.rowCount>1&&!clienteId)throw erro(409,'Este código existe em mais de um cliente. Informe o cliente.','PRODUTO_AMBIGUO');
  return r.rows[0];
}
async function lotePara(c,produto,lote,validade,fabricacao){
  const l=limpo(lote,40);
  if(!l)return null;
  const r=await c.query(`INSERT INTO wms_lotes(produto_id,lote,fabricacao,validade) VALUES($1,$2,$3,$4)
    ON CONFLICT (produto_id,lote) DO UPDATE SET validade=COALESCE(wms_lotes.validade,EXCLUDED.validade),fabricacao=COALESCE(wms_lotes.fabricacao,EXCLUDED.fabricacao) RETURNING id`,
    [produto.id,l,fabricacao||null,validade||null]);
  return r.rows[0].id;
}

// ---------------------------------------------------------------- cadastros
const CAMPOS_PRODUTO={descricao:['t',200],ean:['ean'],categoria:['t',80],familia:['t',80],fabricante:['t',120],unidade:['u'],un_por_caixa:['i'],caixas_por_palete:['i'],
  peso_bruto_kg:['n'],peso_liquido_kg:['n'],comprimento_cm:['n'],largura_cm:['n'],altura_cm:['n'],controla_lote:['b'],controla_validade:['b'],controla_serie:['b'],
  curva_abc:['abc'],controle_especial:['t',120],estoque_min:['n'],estoque_max:['n'],ponto_reposicao:['n'],ativo:['b'],codigos_alt:['arr']};
function camposProduto(b,novo){
  const out={};
  for(const[k,[t,max]]of Object.entries(CAMPOS_PRODUTO)){
    if(!(k in b))continue;
    const v=b[k];
    if(t==='t')out[k]=limpo(v,max);
    else if(t==='ean'){const e=so(v);if(e&&![8,12,13,14].includes(e.length))throw erro(400,'EAN/GTIN deve ter 8, 12, 13 ou 14 dígitos.');out[k]=e}
    else if(t==='u')out[k]=codigo(v,10)||'UN';
    else if(t==='i'){const n=num(v);if(n===null||n<0||!Number.isInteger(n))throw erro(400,'Campo '+k+' deve ser número inteiro.');out[k]=n}
    else if(t==='n'){const n=num(v);if(n===null||n<0)throw erro(400,'Campo '+k+' inválido.');out[k]=n}
    else if(t==='b')out[k]=v===true||v==='true'||v===1||v==='1'||v==='sim';
    else if(t==='abc'){const s=codigo(v,1);if(!['A','B','C'].includes(s))throw erro(400,'Curva ABC deve ser A, B ou C.');out[k]=s}
    else if(t==='arr')out[k]=(Array.isArray(v)?v:String(v||'').split(/[,;\n]/)).map(x=>limpo(x,60)).filter(Boolean).slice(0,20);
  }
  if(novo&&!out.descricao)throw erro(400,'Informe a descrição do produto.');
  return out;
}

// ---------------------------------------------------------------- recebimento
async function lerRecebimento(c,ctx,id,{cega=false}={}){
  const r=await doEmpresa(c,ctx,'wms_recebimentos',id,'Recebimento não encontrado.');
  const itens=(await c.query(`SELECT i.id::text,i.n_item,i.produto_id::text,i.codigo,i.ean,i.descricao,i.unidade,i.qtd_nf::float,i.fator::float,(i.qtd_nf*i.fator)::float AS qtd_esperada,
      i.lote,i.validade::text,p.sku,p.descricao AS produto FROM wms_recebimento_itens i LEFT JOIN wms_produtos p ON p.id=i.produto_id WHERE i.recebimento_id=$1 ORDER BY i.n_item,i.id`,[r.id])).rows;
  const cont=(await c.query(`SELECT c.id::text,c.rodada,c.produto_id::text,p.sku,p.descricao AS produto,c.lote,c.validade::text,c.qtd::float,c.avariada::float,(c.foto IS NOT NULL) AS tem_foto,c.usuario,c.criado_em
      FROM wms_contagens c JOIN wms_produtos p ON p.id=c.produto_id WHERE c.recebimento_id=$1 ORDER BY c.id`,[r.id])).rows;
  const div=(await c.query(`SELECT d.id::text,d.produto_id::text,p.sku,p.descricao AS produto,d.tipo,d.qtd_esperada::float,d.qtd_contada::float,d.qtd::float,d.status,d.decisao_por,d.decisao_em,d.obs
      FROM wms_divergencias d JOIN wms_produtos p ON p.id=d.produto_id WHERE d.recebimento_id=$1 ORDER BY d.id`,[r.id])).rows;
  const cli=(await c.query('SELECT id::text,nome,cnpj,regras FROM wms_clientes WHERE id=$1',[r.cliente_id])).rows[0];
  const doca=r.doca_id?(await c.query('SELECT codigo FROM wms_enderecos WHERE id=$1',[r.doca_id])).rows[0]?.codigo:'';
  const lpns=(await c.query(`SELECT l.id::text,l.codigo,e.codigo AS endereco,(SELECT string_agg(p.sku||' · '||s.qtd::float||' · '||s.estado,'; ') FROM wms_saldos s JOIN wms_produtos p ON p.id=s.produto_id WHERE s.lpn_id=l.id) AS conteudo,
      t.id::text AS tarefa_id,t.status AS tarefa_status,se.codigo AS sugerido FROM wms_lpns l LEFT JOIN wms_enderecos e ON e.id=l.endereco_id
      LEFT JOIN LATERAL (SELECT * FROM wms_tarefas WHERE lpn_id=l.id ORDER BY id DESC LIMIT 1) t ON TRUE LEFT JOIN wms_enderecos se ON se.id=t.sugerido_id
      WHERE l.recebimento_id=$1 ORDER BY l.id`,[r.id])).rows;
  const out={id:String(r.id),armazem_id:String(r.armazem_id),cliente:cli,nf_numero:r.nf_numero,nf_serie:r.nf_serie,nf_chave:r.nf_chave,emitente_nome:r.emitente_nome,
    emitente_cnpj:r.emitente_cnpj,status:r.status,rodada:r.rodada,recontar:(r.recontar||[]).map(String),doca,placa:r.placa,motorista:r.motorista,
    previsto_para:r.previsto_para,chegada_em:r.chegada_em,conferencia_inicio_em:r.conferencia_inicio_em,conferencia_fim_em:r.conferencia_fim_em,finalizado_em:r.finalizado_em,
    criado_por:r.criado_por,criado_em:r.criado_em,itens,contagens:cont,divergencias:div,lpns};
  if(cega){
    // conferência cega: o conferente vê o que contou, nunca o esperado da nota
    out.itens=[];out.divergencias=[];
    out.contagens=cont.filter(x=>x.usuario===ctx.usuario&&x.rodada===r.rodada);
    if(r.status==='recontagem'){
      const ps=new Set((r.recontar||[]).map(String));
      out.recontar_produtos=(await c.query('SELECT id::text,sku,descricao FROM wms_produtos WHERE id=ANY($1::bigint[])',[[...ps]])).rows;
    }
  }
  return out;
}
// NF-e (XML) vira recebimento; o cliente vem do CNPJ do destinatário ou do emitente quando não é informado
async function importarXml(pool,ctx,b,xml){
  const nfe=typeof xml==='object'&&xml?xml:lerNfe(xml);
  let clienteId=b.cliente_id||null;
  if(!clienteId){
    const r=await pool.query('SELECT id::text,cnpj FROM wms_clientes WHERE empresa=$1 AND ativo AND cnpj=ANY($2::text[])',[ctx.emp,[nfe.destinatario.cnpj,nfe.emitente.cnpj].filter(Boolean)]);
    const d=r.rows.find(x=>x.cnpj===nfe.destinatario.cnpj)||r.rows.find(x=>x.cnpj===nfe.emitente.cnpj);
    if(!d)throw erro(409,'Nenhum cliente cadastrado com o CNPJ do destinatário ('+nfe.destinatario.cnpj+') ou do emitente ('+nfe.emitente.cnpj+'). Escolha o cliente.','CLIENTE_NAO_IDENTIFICADO');
    clienteId=d.id;
  }
  const r=await tx(pool,c=>criarRecebimento(c,ctx,{armazem_id:b.armazem_id,cliente_id:clienteId,nf_numero:nfe.numero,nf_serie:nfe.serie,nf_chave:nfe.chave,
    emitente_cnpj:nfe.emitente.cnpj,emitente_nome:nfe.emitente.nome,previsto_para:b.previsto_para,xml:typeof xml==='string'?xml:null,
    itens:nfe.itens.map(i=>({n_item:i.n_item,codigo:i.codigo,ean:i.ean,descricao:i.descricao,unidade:i.unidade,qtd:i.qtd,lote:i.lote,validade:i.validade,fabricacao:i.fabricacao}))}));
  return{ok:true,...r,chave:nfe.chave,itens:nfe.itens.length};
}
async function criarRecebimento(c,ctx,b){
  const arm=await doEmpresa(c,ctx,'wms_armazens',b.armazem_id,'Armazém não encontrado.');
  const cli=await doEmpresa(c,ctx,'wms_clientes',b.cliente_id,'Cliente não encontrado.');
  const itens=Array.isArray(b.itens)?b.itens:[];
  if(!itens.length||itens.length>500)throw erro(400,'Informe de 1 a 500 itens.');
  const chave=so(b.nf_chave);
  if(chave&&chave.length!==44)throw erro(400,'Chave da NF-e deve ter 44 dígitos.');
  if(chave){const d=await c.query("SELECT id FROM wms_recebimentos WHERE empresa=$1 AND nf_chave=$2 AND status<>'cancelado'",[ctx.emp,chave]);
    if(d.rowCount)throw erro(409,'Esta NF-e já foi lançada (recebimento '+d.rows[0].id+').','NFE_DUPLICADA')}
  const r=await c.query(`INSERT INTO wms_recebimentos(empresa,armazem_id,cliente_id,nf_numero,nf_serie,nf_chave,emitente_cnpj,emitente_nome,previsto_para,criado_por,xml)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[ctx.emp,arm.id,cli.id,limpo(b.nf_numero,20),limpo(b.nf_serie,5),chave,so(b.emitente_cnpj),limpo(b.emitente_nome,160),
    dataIso(b.previsto_para),ctx.usuario,b.xml||null]);
  const id=r.rows[0].id;
  let n=0,semProduto=0;
  for(const it of itens){
    n++;
    const qtd=num(it.qtd);
    if(!qtdOk(qtd))throw erro(400,'Item '+n+': quantidade inválida.');
    let prod=null;
    if(it.produto_id)prod=(await c.query('SELECT * FROM wms_produtos WHERE id=$1 AND cliente_id=$2',[it.produto_id,cli.id])).rows[0]||null;
    else for(const cod of[it.ean,it.codigo,it.sku].filter(Boolean)){
      const p=await c.query(`SELECT * FROM wms_produtos WHERE cliente_id=$1 AND ativo AND (upper(sku)=upper($2) OR ean=$2 OR $2=ANY(codigos_alt)) LIMIT 1`,[cli.id,limpo(cod,80)]);
      if(p.rowCount){prod=p.rows[0];break}
    }
    if(it.produto_id&&!prod)throw erro(400,'Item '+n+': produto não é deste cliente.');
    if(!prod)semProduto++;
    const un=codigo(it.unidade,10);
    const fator=prod&&prod.un_por_caixa>0&&['CX','CXA','CAIXA','FD','FARDO','PCT'].includes(un)&&un!==prod.unidade?prod.un_por_caixa:1;
    await c.query(`INSERT INTO wms_recebimento_itens(recebimento_id,n_item,produto_id,codigo,ean,descricao,unidade,qtd_nf,fator,lote,fabricacao,validade)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,it.n_item||n,prod?.id||null,limpo(it.codigo||prod?.sku,60),so(it.ean),limpo(it.descricao||prod?.descricao,200),un||prod?.unidade||'UN',
      qtd,fator,limpo(it.lote,40),dataIso(it.fabricacao),dataIso(it.validade)]);
  }
  await auditar(c,ctx,'criar','recebimento',id,{nf:chave||b.nf_numero,itens:itens.length,sem_produto:semProduto});
  return{id:String(id),sem_produto:semProduto};
}
function regrasCliente(cli){const r=cli?.regras||{};return{recontagem:r.recontagem!==false}}
async function fecharConferencia(c,ctx,rec){
  if(!['em_conferencia','recontagem'].includes(rec.status))throw erro(409,'Conferência não está em andamento (situação: '+rec.status+').','SITUACAO');
  const itens=(await c.query('SELECT produto_id::text AS p,SUM(qtd_nf*fator)::float AS q FROM wms_recebimento_itens WHERE recebimento_id=$1 GROUP BY produto_id',[rec.id])).rows;
  if(itens.some(x=>x.p===null))throw erro(409,'Há itens da nota sem produto vinculado. Vincule antes de fechar.','ITEM_SEM_PRODUTO');
  const esperado=new Map(itens.map(x=>[x.p,x.q]));
  const cont=(await c.query('SELECT produto_id::text AS p,rodada,SUM(qtd)::float AS q,SUM(avariada)::float AS a FROM wms_contagens WHERE recebimento_id=$1 GROUP BY produto_id,rodada',[rec.id])).rows;
  const por=(p,rd)=>cont.find(x=>x.p===p&&x.rodada===rd);
  const produtos=new Set([...esperado.keys(),...cont.map(x=>x.p)]);
  const recontar=new Set((rec.recontar||[]).map(String));
  if(rec.status==='recontagem'){
    const faltam=[...recontar].filter(p=>!por(p,2));
    if(faltam.length){const n=(await c.query('SELECT string_agg(sku,\', \') AS s FROM wms_produtos WHERE id=ANY($1::bigint[])',[faltam])).rows[0].s;throw erro(409,'Falta recontar: '+n+'.','RECONTAGEM_PENDENTE')}
  }
  const final=p=>{const x=recontar.has(p)?por(p,2):por(p,1);return{q:x?.q||0,a:x?.a||0}};
  const diferentes=[...produtos].filter(p=>Math.abs(final(p).q-(esperado.get(p)||0))>1e-9);
  const cli=(await c.query('SELECT regras FROM wms_clientes WHERE id=$1',[rec.cliente_id])).rows[0];
  if(rec.status==='em_conferencia'&&diferentes.length&&regrasCliente(cli).recontagem){
    await c.query("UPDATE wms_recebimentos SET status='recontagem',rodada=2,recontar=$2::bigint[] WHERE id=$1",[rec.id,diferentes]);
    await auditar(c,ctx,'recontagem','recebimento',rec.id,{produtos:diferentes});
    return{status:'recontagem',recontar:diferentes};
  }
  let n=0;
  for(const p of produtos){
    const e=esperado.get(p)||0,f=final(p);
    const tipo=!esperado.has(p)?'produto_errado':f.q<e?'falta':f.q>e?'sobra':null;
    if(tipo){n++;await c.query('INSERT INTO wms_divergencias(empresa,recebimento_id,produto_id,tipo,qtd_esperada,qtd_contada,qtd) VALUES($1,$2,$3,$4,$5,$6,$7)',[ctx.emp,rec.id,p,tipo,e,f.q,Math.abs(f.q-e)])}
    if(f.a>0){n++;await c.query("INSERT INTO wms_divergencias(empresa,recebimento_id,produto_id,tipo,qtd_esperada,qtd_contada,qtd) VALUES($1,$2,$3,'avaria',$4,$5,$6)",[ctx.emp,rec.id,p,e,f.q,f.a])}
  }
  const status=n?'divergencia':'conferido';
  await c.query('UPDATE wms_recebimentos SET status=$2,conferencia_fim_em=NOW() WHERE id=$1',[rec.id,status]);
  await auditar(c,ctx,'fechar_conferencia','recebimento',rec.id,{status,divergencias:n});
  return{status,divergencias:n};
}
async function finalizarRecebimento(c,ctx,rec,operacaoId){
  if(rec.status!=='conferido')throw erro(409,rec.status==='divergencia'?'Ainda há divergências sem decisão.':'O recebimento precisa estar conferido para finalizar (situação: '+rec.status+').','SITUACAO');
  if(!rec.doca_id)throw erro(409,'Informe a doca de chegada antes de finalizar.','SEM_DOCA');
  const esperado=new Map((await c.query('SELECT produto_id::text AS p,SUM(qtd_nf*fator)::float AS q FROM wms_recebimento_itens WHERE recebimento_id=$1 GROUP BY produto_id',[rec.id])).rows.map(x=>[x.p,x.q]));
  const rodadaDe=p=>(rec.recontar||[]).map(String).includes(p)?2:1;
  const cont=(await c.query(`SELECT produto_id::text AS p,rodada,lote,MIN(validade)::text AS validade,MIN(fabricacao)::text AS fabricacao,SUM(qtd)::float AS q,SUM(avariada)::float AS a
    FROM wms_contagens WHERE recebimento_id=$1 GROUP BY produto_id,rodada,lote ORDER BY MIN(validade) NULLS LAST,lote`,[rec.id])).rows.filter(x=>x.rodada===rodadaDe(x.p));
  const decisao=new Map((await c.query('SELECT produto_id::text AS p,tipo,status FROM wms_divergencias WHERE recebimento_id=$1',[rec.id])).rows.map(x=>[x.p+'|'+x.tipo,x.status]));
  const estadoPor=st=>st==='aceita'?'disponivel':st==='bloqueada'?'bloqueado':null;
  const partes=[];
  const restante=new Map(esperado);
  for(const x of cont){
    const boa=x.q-x.a;
    const normal=Math.min(boa,restante.get(x.p)||0);
    restante.set(x.p,(restante.get(x.p)||0)-normal);
    const extra=boa-normal;
    const add=(qtd,estado)=>{if(qtd>1e-9&&estado)partes.push({...x,qtd,estado})};
    add(normal,'disponivel');
    add(extra,estadoPor(decisao.get(x.p+'|'+(esperado.has(x.p)?'sobra':'produto_errado'))));
    const da=decisao.get(x.p+'|avaria');
    add(x.a,da==='aceita'||da==='bloqueada'?'avariado':null);
  }
  const lpns=[];
  for(const pt of partes){
    const prod=(await c.query('SELECT * FROM wms_produtos WHERE id=$1',[pt.p])).rows[0];
    const loteId=await lotePara(c,prod,pt.lote,pt.validade,pt.fabricacao);
    const porPalete=prod.un_por_caixa>0&&prod.caixas_por_palete>0?prod.un_por_caixa*prod.caixas_por_palete:pt.qtd;
    let falta=pt.qtd;
    while(falta>1e-9){
      const q=Math.min(falta,porPalete);falta-=q;
      const seq=(await c.query("SELECT nextval('wms_lpn_seq') AS n")).rows[0].n;
      const cod='LPN'+String(seq).padStart(9,'0');
      const l=(await c.query('INSERT INTO wms_lpns(empresa,codigo,armazem_id,endereco_id,recebimento_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[ctx.emp,cod,rec.armazem_id,rec.doca_id,rec.id])).rows[0].id;
      await mover(c,ctx,{operacao:operacaoId,tipo:'entrada',armazem_id:rec.armazem_id,produto_id:prod.id,cliente_id:prod.cliente_id,lote_id:loteId,qtd:q,
        para:{endereco_id:rec.doca_id,estado:pt.estado,lpn_id:l},motivo:'Recebimento '+rec.id,documento:rec.nf_chave||('NF '+rec.nf_numero)});
      lpns.push({id:String(l),codigo:cod});
    }
  }
  for(const l of lpns){
    const s=await sugerir(c,rec.armazem_id,l.id);
    await c.query(`INSERT INTO wms_tarefas(empresa,armazem_id,tipo,lpn_id,recebimento_id,origem_id,sugerido_id,motivo_sugestao) VALUES($1,$2,'armazenagem',$3,$4,$5,$6,$7)`,
      [ctx.emp,rec.armazem_id,l.id,rec.id,rec.doca_id,s?.id||null,s?.motivo||'']);
    l.sugerido=s?.codigo||'';
  }
  await c.query("UPDATE wms_recebimentos SET status='finalizado',finalizado_em=NOW() WHERE id=$1",[rec.id]);
  await auditar(c,ctx,'finalizar','recebimento',rec.id,{lpns:lpns.map(l=>l.codigo)});
  return{status:'finalizado',lpns};
}

// ---------------------------------------------------------------- operações de estoque (app e tela)
async function registrarContagem(pool,ctx,recId,b){
  return operacao(pool,ctx,b.uuid,'contagem',async(c)=>{
    const rec=(await c.query('SELECT * FROM wms_recebimentos WHERE id=$1 AND empresa=$2 FOR UPDATE',[recId,ctx.emp])).rows[0];
    if(!rec)throw erro(404,'Recebimento não encontrado.');
    if(!['na_doca','em_conferencia','recontagem'].includes(rec.status))throw erro(409,rec.status==='aguardando'?'O veículo ainda não chegou na doca.':'Este recebimento não está em conferência.','SITUACAO');
    const prod=await produtoPorCodigo(c,ctx,rec.cliente_id,b.codigo);
    const qtd=num(b.qtd),av=num(b.avariada)||0;
    if(qtd===null||qtd<0||qtd>=1e9)throw erro(400,'Quantidade inválida.');
    if(av<0||av>qtd)throw erro(400,'Quantidade avariada não pode passar da contada.');
    const lote=limpo(b.lote,40),validade=dataIso(b.validade);
    if(prod.controla_lote&&!lote)throw erro(400,'Este produto exige o lote.','LOTE_OBRIGATORIO');
    if(prod.controla_validade&&!validade)throw erro(400,'Este produto exige a validade.','VALIDADE_OBRIGATORIA');
    if(rec.status==='recontagem'){
      if(!(rec.recontar||[]).map(String).includes(String(prod.id)))throw erro(409,'Este produto não está na recontagem.','FORA_DA_RECONTAGEM');
      const r1=await c.query('SELECT 1 FROM wms_contagens WHERE recebimento_id=$1 AND rodada=1 AND produto_id=$2 AND usuario=$3 LIMIT 1',[rec.id,prod.id,ctx.usuario]);
      if(r1.rowCount)throw erro(409,'A recontagem tem de ser feita por outro conferente.','MESMO_CONFERENTE');
    }
    let foto=null,mime=null;
    if(b.foto){
      const m=String(b.foto).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
      const buf=m?Buffer.from(m[2],'base64'):null;
      if(!buf||!buf.length||buf.length>FOTO_MAX)throw erro(400,'Foto inválida ou grande demais (máx. 600 KB).');
      foto=buf;mime=m[1];
    }
    if(av>0&&!foto)throw erro(400,'Tire a foto da avaria.','FOTO_OBRIGATORIA');
    if(rec.status==='na_doca')await c.query("UPDATE wms_recebimentos SET status='em_conferencia',conferencia_inicio_em=NOW() WHERE id=$1",[rec.id]);
    const r=await c.query(`INSERT INTO wms_contagens(uuid,recebimento_id,rodada,produto_id,lote,validade,fabricacao,qtd,avariada,foto,foto_mime,usuario) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [b.uuid,rec.id,rec.rodada,prod.id,lote,validade,dataIso(b.fabricacao),qtd,av,foto,mime,ctx.usuario]);
    return{ok:true,id:String(r.rows[0].id),produto:{sku:prod.sku,descricao:prod.descricao},qtd,avariada:av,rodada:rec.rodada};
  });
}
async function confirmarArmazenagem(pool,ctx,tarefaId,b){
  return operacao(pool,ctx,b.uuid,'armazenagem',async(c,op)=>{
    const t=(await c.query('SELECT * FROM wms_tarefas WHERE id=$1 AND empresa=$2 FOR UPDATE',[tarefaId,ctx.emp])).rows[0];
    if(!t)throw erro(404,'Tarefa não encontrada.');
    if(!['pendente','em_execucao'].includes(t.status))throw erro(409,'Esta tarefa já foi '+(t.status==='concluida'?'concluída':'cancelada')+'.','TAREFA_FECHADA');
    const lpn=(await c.query('SELECT * FROM wms_lpns WHERE id=$1 FOR UPDATE',[t.lpn_id])).rows[0];
    if(codigo(b.lpn)!==lpn.codigo)throw erro(409,'O palete lido ('+codigo(b.lpn)+') não é o desta tarefa ('+lpn.codigo+').','LPN_DIFERENTE');
    const dest=await enderecoPorCodigo(c,ctx,t.armazem_id,b.endereco);
    await c.query('SELECT id FROM wms_enderecos WHERE id=$1 FOR UPDATE',[dest.id]);
    const just=limpo(b.justificativa,300);
    if(String(dest.id)!==String(t.sugerido_id)){
      if(!just)throw erro(409,'Endereço diferente do sugerido'+(t.sugerido_id?'':' (não havia sugestão)')+'. Informe a justificativa.','ENDERECO_DIFERENTE');
      if(!ctx.supervisor)throw erro(403,'Armazenar fora do endereço sugerido precisa de permissão de supervisor.','SEM_PERMISSAO');
    }
    const carga=await cargaDoLpn(c,lpn.id);
    if(!carga)throw erro(409,'Este palete está vazio.');
    const [cand]=(await candidatos(c,t.armazem_id)).filter(e=>e.id===String(dest.id));
    if(!cand)throw erro(409,'Endereço '+dest.codigo+' não aceita armazenagem ('+dest.status+(dest.zona_tipo==='doca'?', doca':'')+').','ENDERECO_INVALIDO');
    // a própria tarefa já reservou o sugerido: não conta duas vezes
    if(String(dest.id)===String(t.sugerido_id)){cand.ocup.paletes-=1;cand.ocup.kg-=carga.kg;cand.ocup.m3-=carga.m3}
    const motivo=cabe(cand,carga);
    if(motivo)throw erro(409,'Endereço '+dest.codigo+' não comporta: '+motivo+'.','SEM_CAPACIDADE');
    const saldos=(await c.query('SELECT * FROM wms_saldos WHERE lpn_id=$1 ORDER BY id',[lpn.id])).rows;
    for(const s of saldos)await mover(c,ctx,{operacao:op,tipo:'armazenagem',armazem_id:t.armazem_id,produto_id:s.produto_id,cliente_id:s.cliente_id,lote_id:s.lote_id,qtd:s.qtd,
      de:{endereco_id:s.endereco_id,estado:s.estado,lpn_id:lpn.id},para:{endereco_id:dest.id,estado:s.estado,lpn_id:lpn.id},motivo:just?'Fora da sugestão: '+just:'Armazenagem',documento:'Tarefa '+t.id});
    await c.query('UPDATE wms_lpns SET endereco_id=$2 WHERE id=$1',[lpn.id,dest.id]);
    await c.query("UPDATE wms_tarefas SET status='concluida',destino_id=$2,justificativa=$3,operador=$4,iniciado_em=COALESCE(iniciado_em,NOW()),concluido_em=NOW() WHERE id=$1",[t.id,dest.id,just,ctx.usuario]);
    if(just)await auditar(c,ctx,'armazenar_fora_sugestao','tarefa',t.id,{sugerido:t.sugerido_id,destino:dest.codigo,justificativa:just});
    return{ok:true,tarefa_id:String(t.id),lpn:lpn.codigo,endereco:dest.codigo,fora_da_sugestao:!!just};
  });
}
async function movimentar(pool,ctx,b){
  return operacao(pool,ctx,b.uuid,'movimentacao',async(c,op)=>{
    const arm=await doEmpresa(c,ctx,'wms_armazens',b.armazem_id,'Armazém não encontrado.');
    const dest=await enderecoPorCodigo(c,ctx,arm.id,b.destino);
    await c.query('SELECT id FROM wms_enderecos WHERE id=$1 FOR UPDATE',[dest.id]);
    let linhas=[],origem,lpn=null,carga;
    if(b.lpn){
      lpn=(await c.query('SELECT * FROM wms_lpns WHERE codigo=$1 AND empresa=$2 FOR UPDATE',[codigo(b.lpn),ctx.emp])).rows[0];
      if(!lpn||!lpn.endereco_id)throw erro(404,'Palete '+codigo(b.lpn)+' não encontrado.','LPN_INEXISTENTE');
      const ab=await c.query("SELECT id FROM wms_tarefas WHERE lpn_id=$1 AND status IN ('pendente','em_execucao')",[lpn.id]);
      if(ab.rowCount)throw erro(409,'Este palete tem tarefa de armazenagem aberta. Conclua a tarefa.','TAREFA_ABERTA');
      origem=(await c.query('SELECT * FROM wms_enderecos WHERE id=$1',[lpn.endereco_id])).rows[0];
      if(b.origem&&codigo(b.origem)!==origem.codigo)throw erro(409,'O palete está em '+origem.codigo+', não em '+codigo(b.origem)+'.','ORIGEM_DIFERENTE');
      linhas=(await c.query('SELECT * FROM wms_saldos WHERE lpn_id=$1 ORDER BY id',[lpn.id])).rows.map(s=>({s,q:+s.qtd,lpnDestino:lpn.id}));
      carga=await cargaDoLpn(c,lpn.id);
    }else{
      origem=await enderecoPorCodigo(c,ctx,arm.id,b.origem);
      const prod=await produtoPorCodigo(c,ctx,null,b.produto);
      let falta=num(b.qtd);
      if(!qtdOk(falta))throw erro(400,'Quantidade inválida.');
      const lote=limpo(b.lote,40);
      const rs=(await c.query(`SELECT s.* FROM wms_saldos s LEFT JOIN wms_lotes l ON l.id=s.lote_id WHERE s.endereco_id=$1 AND s.produto_id=$2 AND s.estado='disponivel'
          AND ($3='' OR l.lote=$3) ORDER BY (s.lpn_id IS NULL) DESC,l.validade NULLS LAST,s.id FOR UPDATE OF s`,[origem.id,prod.id,lote])).rows;
      const total=rs.reduce((a,s)=>a+ +s.qtd,0);
      if(total+1e-9<falta)throw erro(409,'Estoque insuficiente em '+origem.codigo+': há '+fmt(total,3).replace(/,?0+$/,'')+' disponível.','ESTOQUE_INSUFICIENTE');
      for(const s of rs){if(falta<=1e-9)break;const q=Math.min(falta,+s.qtd);falta-=q;linhas.push({s,q,lpnDestino:null})}
      const m3=(+prod.comprimento_cm*+prod.largura_cm*+prod.altura_cm)/1e6,qt=linhas.reduce((a,l)=>a+l.q,0);
      carga={produto_id:String(prod.id),cliente_id:String(prod.cliente_id),paletes:0,kg:qt*+prod.peso_bruto_kg,m3:qt*m3};
    }
    if(String(origem.id)===String(dest.id))throw erro(400,'Origem e destino são o mesmo endereço.');
    const [cand]=(await candidatos(c,arm.id)).filter(e=>e.id===String(dest.id));
    if(dest.zona_tipo!=='doca'){
      if(!cand)throw erro(409,'Endereço '+dest.codigo+' não aceita mercadoria ('+dest.status+').','ENDERECO_INVALIDO');
      if(!lpn&&!cand.ocup.paletes)carga.paletes=1;
      const motivo=cabe(cand,carga);
      if(motivo)throw erro(409,'Endereço '+dest.codigo+' não comporta: '+motivo+'.','SEM_CAPACIDADE');
    }else if(dest.status!=='ativo')throw erro(409,'Doca '+dest.codigo+' bloqueada.','ENDERECO_INVALIDO');
    for(const{s,q,lpnDestino}of linhas)await mover(c,ctx,{operacao:op,tipo:'transferencia',armazem_id:arm.id,produto_id:s.produto_id,cliente_id:s.cliente_id,lote_id:s.lote_id,qtd:q,
      de:{endereco_id:s.endereco_id,estado:s.estado,lpn_id:s.lpn_id},para:{endereco_id:dest.id,estado:s.estado,lpn_id:lpnDestino},motivo:limpo(b.motivo,200)||'Movimentação interna'});
    if(lpn)await c.query('UPDATE wms_lpns SET endereco_id=$2 WHERE id=$1',[lpn.id,dest.id]);
    return{ok:true,origem:origem.codigo,destino:dest.codigo,qtd:linhas.reduce((a,l)=>a+l.q,0),lpn:lpn?.codigo||''};
  });
}
// Estoque inicial e ajuste: põe saldo direto num endereço (sem recebimento) ou tira dele, com motivo.
// Só quem tem a permissão wms_ajuste. Fica no histórico como movimento "ajuste" e na auditoria.
async function ajustar(pool,ctx,b){
  return operacao(pool,ctx,b.uuid,'ajuste',async(c,op)=>{
    const arm=await doEmpresa(c,ctx,'wms_armazens',b.armazem_id,'Escolha o armazém.');
    const end=await enderecoPorCodigo(c,ctx,arm.id,b.endereco);
    if(end.status!=='ativo')throw erro(409,'Endereço '+end.codigo+' está '+end.status+'.','ENDERECO_INVALIDO');
    const prod=await produtoPorCodigo(c,ctx,b.cliente_id||null,b.produto);
    const q=Number(String(b.qtd??'').replace(',','.')),sentido=b.sentido==='retirar'?'retirar':'adicionar',motivo=limpo(b.motivo,300);
    if(!(q>0))throw erro(400,'Informe a quantidade.');
    if(motivo.length<3)throw erro(400,'Informe o motivo (ex.: estoque inicial, inventário).');
    if(prod.controla_lote&&!limpo(b.lote,40)&&sentido==='adicionar')throw erro(400,'Este produto controla lote: informe o lote.');
    const val=/^\d{4}-\d{2}-\d{2}$/.test(String(b.validade||''))?b.validade:null;
    if(prod.controla_validade&&!val&&sentido==='adicionar')throw erro(400,'Este produto controla validade: informe a validade.');
    const loteId=await lotePara(c,prod,b.lote,val,null);
    const base={operacao:op,tipo:'ajuste',armazem_id:arm.id,produto_id:prod.id,cliente_id:prod.cliente_id,lote_id:loteId,motivo,documento:sentido==='adicionar'?'Estoque inicial / ajuste +':'Ajuste −'};
    if(sentido==='adicionar'){
      await mover(c,ctx,{...base,qtd:q,para:{endereco_id:end.id,estado:'disponivel',lpn_id:null}});
    }else{
      // tira do saldo disponível do endereço (soltos primeiro, depois os paletes)
      const r=await c.query(`SELECT lpn_id,qtd::float AS qtd FROM wms_saldos WHERE endereco_id=$1 AND produto_id=$2 AND COALESCE(lote_id,0)=COALESCE($3::bigint,0) AND estado='disponivel'
        ORDER BY lpn_id NULLS FIRST,id`,[end.id,prod.id,loteId]);
      const tem=r.rows.reduce((a,x)=>a+x.qtd,0);
      if(tem+1e-9<q)throw erro(409,'Estoque insuficiente em '+end.codigo+': há '+fmt(tem,3).replace(/,?0+$/,'')+' disponível.','ESTOQUE_INSUFICIENTE');
      let falta=q;
      for(const x of r.rows){if(falta<=1e-9)break;const t=Math.min(falta,x.qtd);falta-=t;
        await mover(c,ctx,{...base,qtd:t,de:{endereco_id:end.id,estado:'disponivel',lpn_id:x.lpn_id}})}
    }
    await auditar(c,ctx,'ajuste_estoque','produto',prod.id,{sentido,sku:prod.sku,endereco:end.codigo,qtd:q,lote:limpo(b.lote,40)||null,motivo});
    return{ok:true,sentido,sku:prod.sku,descricao:prod.descricao,endereco:end.codigo,qtd:q};
  });
}
// ---------------------------------------------------------------- expedição (saída)
// NF de saída (XML, chave na SEFAZ ou manual) -> reserva FEFO do saldo disponível -> separação no coletor
// (endereço, produto e quantidade conferidos) para a doca de expedição -> expedir dá baixa (movimento "saida").
async function criarExpedicao(c,ctx,b){
  const arm=await doEmpresa(c,ctx,'wms_armazens',b.armazem_id,'Escolha o armazém.');
  const cli=await doEmpresa(c,ctx,'wms_clientes',b.cliente_id,'Cliente não encontrado.');
  const itens=Array.isArray(b.itens)?b.itens:[];
  if(!itens.length||itens.length>500)throw erro(400,'Informe de 1 a 500 itens.');
  const chave=so(b.nf_chave);
  if(chave&&chave.length!==44)throw erro(400,'Chave da NF-e deve ter 44 dígitos.');
  if(chave){const d=await c.query("SELECT id FROM wms_expedicoes WHERE empresa=$1 AND nf_chave=$2 AND status<>'cancelada'",[ctx.emp,chave]);
    if(d.rowCount)throw erro(409,'Esta NF-e já está na expedição nº '+d.rows[0].id+'.','NFE_DUPLICADA')}
  const r=await c.query(`INSERT INTO wms_expedicoes(empresa,armazem_id,cliente_id,nf_numero,nf_serie,nf_chave,destinatario_cnpj,destinatario_nome,criado_por,xml)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[ctx.emp,arm.id,cli.id,limpo(b.nf_numero,20),limpo(b.nf_serie,5),chave,so(b.destinatario_cnpj),limpo(b.destinatario_nome,160),ctx.usuario,b.xml||null]);
  const id=r.rows[0].id;
  let n=0,semProduto=0;
  for(const it of itens){
    n++;
    const qtd=num(it.qtd);
    if(!qtdOk(qtd))throw erro(400,'Item '+n+': quantidade inválida.');
    let prod=null;
    if(it.produto_id)prod=(await c.query('SELECT * FROM wms_produtos WHERE id=$1 AND cliente_id=$2',[it.produto_id,cli.id])).rows[0]||null;
    else for(const cod of[it.ean,it.codigo,it.sku].filter(Boolean)){
      const p=await c.query(`SELECT * FROM wms_produtos WHERE cliente_id=$1 AND ativo AND (upper(sku)=upper($2) OR ean=$2 OR $2=ANY(codigos_alt)) LIMIT 1`,[cli.id,limpo(cod,80)]);
      if(p.rowCount){prod=p.rows[0];break}
    }
    if(it.produto_id&&!prod)throw erro(400,'Item '+n+': produto não é deste cliente.');
    if(!prod)semProduto++;
    const un=codigo(it.unidade,10);
    const fator=prod&&prod.un_por_caixa>0&&['CX','CXA','CAIXA','FD','FARDO','PCT'].includes(un)&&un!==prod.unidade?prod.un_por_caixa:1;
    await c.query(`INSERT INTO wms_expedicao_itens(expedicao_id,n_item,produto_id,codigo,ean,descricao,unidade,qtd_nf,fator,lote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id,it.n_item||n,prod?.id||null,limpo(it.codigo||prod?.sku,60),so(it.ean),limpo(it.descricao||prod?.descricao,200),un||prod?.unidade||'UN',qtd,fator,limpo(it.lote,40)]);
  }
  await auditar(c,ctx,'criar','expedicao',id,{nf:chave||b.nf_numero,itens:itens.length,sem_produto:semProduto});
  return{id:String(id),sem_produto:semProduto};
}
// NF de saída: o cliente do armazém normalmente é o emitente (vende o que está guardado); depois tenta o destinatário
async function importarSaida(pool,ctx,b,xml){
  const nfe=typeof xml==='object'&&xml?xml:lerNfe(xml);
  let clienteId=b.cliente_id||null;
  if(!clienteId){
    const r=await pool.query('SELECT id::text,cnpj FROM wms_clientes WHERE empresa=$1 AND ativo AND cnpj=ANY($2::text[])',[ctx.emp,[nfe.emitente.cnpj,nfe.destinatario.cnpj].filter(Boolean)]);
    const d=r.rows.find(x=>x.cnpj===nfe.emitente.cnpj)||r.rows.find(x=>x.cnpj===nfe.destinatario.cnpj);
    if(!d)throw erro(409,'Nenhum cliente cadastrado com o CNPJ do emitente ('+nfe.emitente.cnpj+') ou do destinatário ('+nfe.destinatario.cnpj+'). Escolha o cliente.','CLIENTE_NAO_IDENTIFICADO');
    clienteId=d.id;
  }
  // na saída o lote da nota é o pedido do cliente; sem lote, a reserva escolhe pelo vencimento (FEFO)
  const r=await tx(pool,c=>criarExpedicao(c,ctx,{armazem_id:b.armazem_id,cliente_id:clienteId,nf_numero:nfe.numero,nf_serie:nfe.serie,nf_chave:nfe.chave,
    destinatario_cnpj:nfe.destinatario.cnpj,destinatario_nome:nfe.destinatario.nome,xml:typeof xml==='string'?xml:null,
    itens:nfe.itens.map(i=>({n_item:i.n_item,codigo:i.codigo,ean:i.ean,descricao:i.descricao,unidade:i.unidade,qtd:i.qtd,lote:i.lote}))}));
  return{ok:true,...r,chave:nfe.chave,itens:nfe.itens.length};
}
// Nota sem XML: só a chave (número, série e CNPJ do emitente estão nela) ou o DANFE em PDF; a prévia sugere o cliente
function nfeDaChave(chave){
  return{chave,numero:String(+chave.slice(25,34)),serie:String(+chave.slice(22,25)),emitente:{cnpj:chave.slice(6,20),nome:''},destinatario:{cnpj:'',nome:''},itens:[],origem:'chave'};
}
async function previaNota(pool,ctx,b){
  const saida=b.tipo==='saida';
  let nfe;
  if(b.pdf)nfe=await lerDanfePdf(b.pdf);
  else{const ch=so(b.chave);if(!sefaz.chaveValida(ch))throw erro(400,'Chave de acesso inválida (44 dígitos).','CHAVE_INVALIDA');nfe=nfeDaChave(ch)}
  const docs=(saida?[nfe.emitente.cnpj,nfe.destinatario.cnpj]:[nfe.destinatario.cnpj,nfe.emitente.cnpj]).filter(Boolean);
  const r=await pool.query('SELECT id::text,nome,cnpj FROM wms_clientes WHERE empresa=$1 AND ativo AND cnpj=ANY($2::text[])',[ctx.emp,docs]);
  const cli=docs.map(d=>r.rows.find(x=>x.cnpj===d)).find(Boolean)||null;
  const ja=(await pool.query(saida?"SELECT id::text FROM wms_expedicoes WHERE empresa=$1 AND nf_chave=$2 AND status<>'cancelada' LIMIT 1"
    :"SELECT id::text FROM wms_recebimentos WHERE empresa=$1 AND nf_chave=$2 AND status<>'cancelado' LIMIT 1",[ctx.emp,nfe.chave])).rows[0];
  return{ok:true,nfe,cliente_id:cli?.id||null,cliente_nome:cli?.nome||null,ja:ja?.id||null};
}
// a nota conferida na prévia volta do navegador: número, série e emitente saem sempre da chave
function nfeDoCorpo(x){
  x=x||{};
  const chave=so(x.chave);
  if(!sefaz.chaveValida(chave))throw erro(400,'Chave de acesso inválida (44 dígitos).','CHAVE_INVALIDA');
  const nfe=nfeDaChave(chave);
  nfe.emitente.nome=limpo(x.emitente?.nome,160);
  nfe.destinatario={cnpj:so(x.destinatario?.cnpj).slice(0,14),nome:limpo(x.destinatario?.nome,160)};
  nfe.itens=(Array.isArray(x.itens)?x.itens:[]).slice(0,501).map((i,k)=>({n_item:k+1,codigo:limpo(i.codigo,60),ean:so(i.ean).slice(0,14),descricao:limpo(i.descricao,200),
    unidade:codigo(i.unidade,10),qtd:num(i.qtd),lote:limpo(i.lote,40),fabricacao:dataIso(i.fabricacao),validade:dataIso(i.validade)}));
  nfe.itens.forEach((i,k)=>{if(!i.descricao&&!i.codigo)throw erro(400,'Item '+(k+1)+': informe o código ou a descrição.')});
  return nfe;
}
// baixa o XML pela chave; devolve {xml} ou a resposta "pendente" (só resumo: Ciência da Operação registrada)
async function nfePelaChave(pool,ctx,chave){
  if(ctx.emp!==0||!sefaz.configurado())throw erro(503,'A busca da nota na SEFAZ ainda não está ligada (falta o certificado A1). Importe o arquivo XML.','SEFAZ_DESLIGADA');
  const nota=await sefaz.baixarNfe(chave);
  if(!nota.resumo)return nota;
  const ev=await sefaz.cienciaOperacao(chave);
  await tx(pool,c=>auditar(c,ctx,'ciencia_operacao','nfe',chave,{protocolo:ev.protocolo||null,cStat:ev.cStat}));
  return{pendente:{ok:true,pendente:true,chave,mensagem:'A SEFAZ só liberou o resumo desta nota. Registramos a Ciência da Operação; o XML completo costuma ficar disponível em alguns minutos. Leia o código de novo daqui a pouco.'}};
}
async function lerExpedicao(c,ctx,id){
  const x=await doEmpresa(c,ctx,'wms_expedicoes',id,'Expedição não encontrada.');
  const itens=(await c.query(`SELECT i.id::text,i.n_item,i.produto_id::text,i.codigo,i.ean,i.descricao,i.unidade,i.qtd_nf::float,i.fator::float,(i.qtd_nf*i.fator)::float AS qtd,i.lote,
      p.sku,p.descricao AS produto,COALESCE((SELECT SUM(s.qtd) FROM wms_expedicao_separacao s WHERE s.item_id=i.id AND s.status<>'cancelada'),0)::float AS reservado,
      COALESCE((SELECT SUM(s.qtd_separada) FROM wms_expedicao_separacao s WHERE s.item_id=i.id AND s.status<>'cancelada'),0)::float AS separado
    FROM wms_expedicao_itens i LEFT JOIN wms_produtos p ON p.id=i.produto_id WHERE i.expedicao_id=$1 ORDER BY i.n_item,i.id`,[x.id])).rows;
  const sep=(await c.query(`SELECT s.id::text,s.item_id::text,e.codigo AS endereco,e.distancia_m::float AS distancia,p.sku,p.descricao AS produto,p.ean,p.unidade,l.lote,l.validade::text,
      lp.codigo AS lpn,s.qtd::float,s.qtd_separada::float,s.status,s.separado_por,s.separado_em
    FROM wms_expedicao_separacao s JOIN wms_expedicao_itens i ON i.id=s.item_id JOIN wms_produtos p ON p.id=i.produto_id JOIN wms_enderecos e ON e.id=s.endereco_id
    LEFT JOIN wms_lotes l ON l.id=s.lote_id LEFT JOIN wms_lpns lp ON lp.id=s.lpn_id WHERE s.expedicao_id=$1 AND s.status<>'cancelada'
    ORDER BY (s.status='pendente') DESC,e.distancia_m,e.codigo,s.id`,[x.id])).rows;
  const cli=(await c.query('SELECT id::text,nome,cnpj FROM wms_clientes WHERE id=$1',[x.cliente_id])).rows[0];
  const doca=x.doca_id?(await c.query('SELECT codigo FROM wms_enderecos WHERE id=$1',[x.doca_id])).rows[0]?.codigo:'';
  return{id:String(x.id),armazem_id:String(x.armazem_id),cliente:cli,nf_numero:x.nf_numero,nf_serie:x.nf_serie,nf_chave:x.nf_chave,destinatario_cnpj:x.destinatario_cnpj,
    destinatario_nome:x.destinatario_nome,status:x.status,doca:doca||'',placa:x.placa,criado_por:x.criado_por,criado_em:x.criado_em,separada_em:x.separada_em,
    expedida_em:x.expedida_em,expedida_por:x.expedida_por,itens,separacao:sep};
}
// reserva tudo ou nada: primeiro vence, primeiro sai (FEFO); no mesmo vencimento, picking e saldo solto antes de palete fechado
// quando falta, diz onde está o saldo do produto que a reserva não pôde usar (outro armazém, palete na doca, quarentena…)
async function ondeEsta(c,ctx,x,it){
  const r=(await c.query(`SELECT a.nome AS armazem,(s.armazem_id=$2) AS mesmo,e.codigo,z.tipo,e.status AS st_end,s.estado,(s.lpn_id IS NOT NULL) AS palete,l.lote,SUM(s.qtd)::float AS qtd
      FROM wms_saldos s JOIN wms_enderecos e ON e.id=s.endereco_id JOIN wms_zonas z ON z.id=e.zona_id JOIN wms_armazens a ON a.id=s.armazem_id LEFT JOIN wms_lotes l ON l.id=s.lote_id
      WHERE s.empresa=$1 AND s.produto_id=$3 AND s.qtd>0 GROUP BY 1,2,3,4,5,6,7,8 ORDER BY 2 DESC,9 DESC LIMIT 4`,[ctx.emp,x.armazem_id,it.produto_id])).rows;
  if(!r.length)return' (sem saldo deste produto em nenhum endereço)';
  const por=y=>!y.mesmo?'no armazém '+y.armazem:y.estado!=='disponivel'?y.estado:y.st_end!=='ativo'?'endereço '+y.st_end
    :it.lote&&y.lote!==it.lote?'lote '+(y.lote||'sem lote'):y.tipo==='doca'&&y.palete?'palete na doca aguardando armazenagem':['avaria','quarentena','devolucao'].includes(y.tipo)?'zona '+y.tipo:'disponível';
  return' (há '+r.map(y=>fmt(y.qtd,3).replace(/,?0+$/,'')+' em '+y.codigo+': '+por(y)).join('; ')+')';
}
async function reservarExpedicao(c,ctx,id){
  const x=(await c.query('SELECT * FROM wms_expedicoes WHERE id=$1 AND empresa=$2 FOR UPDATE',[id,ctx.emp])).rows[0];
  if(!x)throw erro(404,'Expedição não encontrada.');
  if(x.status!=='aberta')throw erro(409,'A expedição já foi reservada (situação: '+x.status+').','SITUACAO');
  const itens=(await c.query('SELECT i.*,p.sku FROM wms_expedicao_itens i LEFT JOIN wms_produtos p ON p.id=i.produto_id WHERE i.expedicao_id=$1 ORDER BY i.n_item,i.id',[x.id])).rows;
  if(itens.some(i=>!i.produto_id))throw erro(409,'Há itens da nota sem produto vinculado. Vincule antes de reservar.','ITEM_SEM_PRODUTO');
  const op='exp-'+x.id+'-reserva',faltas=[];let linhas=0;
  for(const it of itens){
    let falta=+it.qtd_nf*+it.fator;
    const rs=(await c.query(`SELECT s.id,s.endereco_id,s.lote_id,s.lpn_id,s.qtd::float AS qtd FROM wms_saldos s JOIN wms_enderecos e ON e.id=s.endereco_id JOIN wms_zonas z ON z.id=e.zona_id
        LEFT JOIN wms_lotes l ON l.id=s.lote_id
      WHERE s.empresa=$1 AND s.armazem_id=$2 AND s.produto_id=$3 AND s.cliente_id=$4 AND s.estado='disponivel' AND e.status='ativo'
        AND (z.tipo=ANY($5::text[]) OR z.tipo IN ('cross_docking','expedicao') OR (z.tipo='doca' AND s.lpn_id IS NULL))
        AND ($6='' OR l.lote=$6)
      ORDER BY l.validade NULLS LAST,(z.tipo=ANY($5::text[])) DESC,(z.tipo='picking') DESC,s.lpn_id NULLS FIRST,e.distancia_m,s.id FOR UPDATE OF s`,[ctx.emp,x.armazem_id,it.produto_id,x.cliente_id,ZONAS_GUARDA,it.lote||''])).rows;
    const tirar=[];
    for(const s of rs){if(falta<=1e-9)break;const q=Math.min(falta,s.qtd);falta-=q;tirar.push({s,q})}
    if(falta>1e-9){faltas.push(it.sku+(it.lote?' lote '+it.lote:'')+': faltam '+fmt(falta,3).replace(/,?0+$/,'')+(await ondeEsta(c,ctx,x,it)));continue}
    for(const{s,q}of tirar){
      await mover(c,ctx,{operacao:op,tipo:'reserva',armazem_id:x.armazem_id,produto_id:it.produto_id,cliente_id:x.cliente_id,lote_id:s.lote_id,qtd:q,
        de:{endereco_id:s.endereco_id,estado:'disponivel',lpn_id:s.lpn_id},para:{endereco_id:s.endereco_id,estado:'reservado',lpn_id:s.lpn_id},motivo:'reserva para expedição',documento:'NF '+(x.nf_numero||x.id)});
      await c.query('INSERT INTO wms_expedicao_separacao(expedicao_id,item_id,endereco_id,lote_id,lpn_id,qtd) VALUES($1,$2,$3,$4,$5,$6)',[x.id,it.id,s.endereco_id,s.lote_id,s.lpn_id,q]);
      linhas++;
    }
  }
  if(faltas.length)throw erro(409,'Estoque disponível insuficiente: '+faltas.join('; ')+'. Nada foi reservado.','ESTOQUE_INSUFICIENTE');
  await c.query("UPDATE wms_expedicoes SET status='separando' WHERE id=$1",[x.id]);
  await auditar(c,ctx,'reservar','expedicao',x.id,{linhas});
  return{ok:true,status:'separando',linhas};
}
async function docaExpedicao(c,ctx,x,cod){
  if(cod){const e=await enderecoPorCodigo(c,ctx,x.armazem_id,cod);
    if(!['doca','expedicao'].includes(e.zona_tipo))throw erro(409,'O endereço '+e.codigo+' não é doca nem área de expedição.','ENDERECO_INVALIDO');return e}
  if(x.doca_id)return(await c.query('SELECT * FROM wms_enderecos WHERE id=$1',[x.doca_id])).rows[0];
  const e=(await c.query(`SELECT e.* FROM wms_enderecos e JOIN wms_zonas z ON z.id=e.zona_id WHERE e.armazem_id=$1 AND e.status='ativo' AND z.tipo IN ('expedicao','doca')
    ORDER BY (z.tipo='expedicao') DESC,e.codigo LIMIT 1`,[x.armazem_id])).rows[0];
  if(!e)throw erro(409,'Cadastre um endereço de doca ou de expedição neste armazém.','SEM_DOCA');
  return e;
}
async function separarItem(pool,ctx,id,b){
  return operacao(pool,ctx,b.uuid,'separacao',async(c,op)=>{
    const x=(await c.query('SELECT * FROM wms_expedicoes WHERE id=$1 AND empresa=$2 FOR UPDATE',[id,ctx.emp])).rows[0];
    if(!x)throw erro(404,'Expedição não encontrada.');
    if(x.status!=='separando')throw erro(409,'Esta expedição não está em separação (situação: '+x.status+').','SITUACAO');
    const s=(await c.query("SELECT s.*,i.produto_id FROM wms_expedicao_separacao s JOIN wms_expedicao_itens i ON i.id=s.item_id WHERE s.id=$1 AND s.expedicao_id=$2 FOR UPDATE OF s",[b.separacao_id,x.id])).rows[0];
    if(!s)throw erro(404,'Linha de separação não encontrada.');
    if(s.status!=='pendente')throw erro(409,'Esta linha já foi separada.','JA_SEPARADA');
    const end=await enderecoPorCodigo(c,ctx,x.armazem_id,b.endereco);
    if(String(end.id)!==String(s.endereco_id)){const certo=(await c.query('SELECT codigo FROM wms_enderecos WHERE id=$1',[s.endereco_id])).rows[0].codigo;
      throw erro(409,'Endereço errado: a mercadoria reservada está em '+certo+'.','ENDERECO_ERRADO')}
    const prod=await produtoPorCodigo(c,ctx,x.cliente_id,b.produto);
    if(String(prod.id)!==String(s.produto_id))throw erro(409,'Produto errado: '+prod.sku+' não é o item desta linha.','PRODUTO_ERRADO');
    const pend=+s.qtd-+s.qtd_separada;
    const q=b.qtd===undefined||b.qtd===''?pend:num(b.qtd);
    if(!qtdOk(q))throw erro(400,'Quantidade inválida.');
    if(q>pend+1e-9)throw erro(409,'Quantidade maior que a reservada nesta linha ('+fmt(pend,3).replace(/,?0+$/,'')+').','QTD_MAIOR');
    const doca=await docaExpedicao(c,ctx,x,b.doca);
    await mover(c,ctx,{operacao:op,tipo:'separacao',armazem_id:x.armazem_id,produto_id:s.produto_id,cliente_id:x.cliente_id,lote_id:s.lote_id,qtd:q,
      de:{endereco_id:s.endereco_id,estado:'reservado',lpn_id:s.lpn_id},para:{endereco_id:doca.id,estado:'reservado',lpn_id:null},motivo:'separação',documento:'NF '+(x.nf_numero||x.id)});
    const resto=pend-q;
    await c.query("UPDATE wms_expedicao_separacao SET qtd_separada=qtd_separada+$2,status=CASE WHEN $3 THEN 'separada' ELSE status END,separado_por=$4,separado_em=NOW() WHERE id=$1",
      [s.id,q,resto<=1e-9,ctx.usuario]);
    if(!x.doca_id)await c.query('UPDATE wms_expedicoes SET doca_id=$2 WHERE id=$1',[x.id,doca.id]);
    const abertas=+(await c.query("SELECT COUNT(*) AS n FROM wms_expedicao_separacao WHERE expedicao_id=$1 AND status='pendente'",[x.id])).rows[0].n;
    if(!abertas)await c.query("UPDATE wms_expedicoes SET status='separada',separada_em=NOW() WHERE id=$1",[x.id]);
    return{ok:true,sku:prod.sku,qtd:q,restante:resto,doca:doca.codigo,status:abertas?'separando':'separada',linhas_abertas:abertas};
  });
}
async function expedir(c,ctx,id,b){
  const x=(await c.query('SELECT * FROM wms_expedicoes WHERE id=$1 AND empresa=$2 FOR UPDATE',[id,ctx.emp])).rows[0];
  if(!x)throw erro(404,'Expedição não encontrada.');
  if(x.status!=='separada')throw erro(409,x.status==='separando'?'Ainda há itens para separar.':'A expedição não está pronta para sair (situação: '+x.status+').','SITUACAO');
  const op='exp-'+x.id+'-saida';
  const rs=(await c.query(`SELECT i.produto_id,s.lote_id,SUM(s.qtd_separada)::float AS q FROM wms_expedicao_separacao s JOIN wms_expedicao_itens i ON i.id=s.item_id
    WHERE s.expedicao_id=$1 AND s.status='separada' GROUP BY i.produto_id,s.lote_id`,[x.id])).rows;
  for(const r of rs)await mover(c,ctx,{operacao:op,tipo:'saida',armazem_id:x.armazem_id,produto_id:r.produto_id,cliente_id:x.cliente_id,lote_id:r.lote_id,qtd:r.q,
    de:{endereco_id:x.doca_id,estado:'reservado',lpn_id:null},motivo:'expedição'+(limpo(b.placa,8)?' placa '+codigo(b.placa,8):''),documento:'NF '+(x.nf_numero||x.id)});
  await c.query("UPDATE wms_expedicoes SET status='expedida',expedida_em=NOW(),expedida_por=$2,placa=$3 WHERE id=$1",[x.id,ctx.usuario,codigo(b.placa,8)]);
  await auditar(c,ctx,'expedir','expedicao',x.id,{nf:x.nf_chave||x.nf_numero,placa:codigo(b.placa,8)||null,itens:rs.length});
  return{ok:true,status:'expedida'};
}
// cancelar devolve ao disponível: o que não foi separado fica onde estava; o que já foi para a doca fica disponível na doca
async function cancelarExpedicao(c,ctx,id,b){
  const x=(await c.query('SELECT * FROM wms_expedicoes WHERE id=$1 AND empresa=$2 FOR UPDATE',[id,ctx.emp])).rows[0];
  if(!x)throw erro(404,'Expedição não encontrada.');
  if(['expedida','cancelada'].includes(x.status))throw erro(409,'Expedição já '+x.status+'.','SITUACAO');
  const op='exp-'+x.id+'-cancela',base={operacao:op,tipo:'reserva',armazem_id:x.armazem_id,cliente_id:x.cliente_id,motivo:'expedição cancelada',documento:'NF '+(x.nf_numero||x.id)};
  const rs=(await c.query("SELECT s.*,i.produto_id FROM wms_expedicao_separacao s JOIN wms_expedicao_itens i ON i.id=s.item_id WHERE s.expedicao_id=$1 AND s.status<>'cancelada' FOR UPDATE OF s",[x.id])).rows;
  for(const s of rs){
    const pend=+s.qtd-+s.qtd_separada,sep=+s.qtd_separada;
    if(pend>1e-9)await mover(c,ctx,{...base,produto_id:s.produto_id,lote_id:s.lote_id,qtd:pend,de:{endereco_id:s.endereco_id,estado:'reservado',lpn_id:s.lpn_id},para:{endereco_id:s.endereco_id,estado:'disponivel',lpn_id:s.lpn_id}});
    if(sep>1e-9)await mover(c,ctx,{...base,produto_id:s.produto_id,lote_id:s.lote_id,qtd:sep,de:{endereco_id:x.doca_id,estado:'reservado',lpn_id:null},para:{endereco_id:x.doca_id,estado:'disponivel',lpn_id:null}});
  }
  await c.query("UPDATE wms_expedicao_separacao SET status='cancelada' WHERE expedicao_id=$1",[x.id]);
  await c.query("UPDATE wms_expedicoes SET status='cancelada' WHERE id=$1",[x.id]);
  await auditar(c,ctx,'cancelar','expedicao',x.id,{motivo:limpo(b.motivo,300)});
  return{ok:true,status:'cancelada'};
}
// ---------------------------------------------------------------- faturamento da armazenagem
// Foto diária da ocupação por cliente (paletes = LPNs + endereços com saldo solto), guardando o maior valor do dia.
// Cada cliente tem a sua tabela de preços: só entram na conta as formas de cobrança com preço maior que zero.
// Na armazenagem, o dia sem foto repete a última foto anterior; entrada e saída contam o que aconteceu no período.
const METODOS_COBRANCA=[
  {k:'palete_dia',grupo:'Armazenagem',item:'Palete por dia',un:'palete-dia',m:'palete_dias'},
  {k:'posicao_dia',grupo:'Armazenagem',item:'Posição (endereço) por dia',un:'posição-dia',m:'posicao_dias'},
  {k:'m3_dia',grupo:'Armazenagem',item:'m³ por dia',un:'m³-dia',m:'m3_dias'},
  {k:'ton_dia',grupo:'Armazenagem',item:'Tonelada por dia',un:'t-dia',m:'ton_dias'},
  {k:'palete_pico',grupo:'Armazenagem',item:'Pico de paletes no mês',un:'palete',m:'pico_paletes'},
  {k:'entrada_un',grupo:'Entrada',item:'Unidades recebidas',un:'un',m:'entrada_un'},
  {k:'entrada_cx',grupo:'Entrada',item:'Caixas recebidas',un:'cx',m:'entrada_cx'},
  {k:'entrada_palete',grupo:'Entrada',item:'Paletes recebidos',un:'palete',m:'entrada_paletes'},
  {k:'entrada_ton',grupo:'Entrada',item:'Toneladas recebidas',un:'t',m:'entrada_ton'},
  {k:'nf_entrada',grupo:'Entrada',item:'Notas de entrada',un:'NF',m:'nf_entrada'},
  {k:'ad_valorem',grupo:'Entrada',item:'Ad valorem sobre o valor das notas de entrada',un:'R$',m:'valor_nf_entrada',pct:true},
  {k:'saida_un',grupo:'Saída',item:'Unidades expedidas',un:'un',m:'saida_un'},
  {k:'saida_cx',grupo:'Saída',item:'Caixas expedidas',un:'cx',m:'saida_cx'},
  {k:'saida_palete',grupo:'Saída',item:'Paletes separados',un:'palete',m:'saida_paletes'},
  {k:'saida_ton',grupo:'Saída',item:'Toneladas expedidas',un:'t',m:'saida_ton'},
  {k:'nf_saida',grupo:'Saída',item:'Notas de saída',un:'NF',m:'nf_saida'},
  {k:'linha_separada',grupo:'Saída',item:'Linhas separadas (picking)',un:'linha',m:'linhas_separadas'},
  {k:'mensalidade',grupo:'Fixo',item:'Mensalidade fixa',un:'mês',m:'um'},
  {k:'minimo_mensal',grupo:'Fixo',item:'Mínimo mensal',un:'mês',minimo:true},
];
const CAMPOS_TARIFA=METODOS_COBRANCA.map(x=>x.k);
async function fotografarOcupacao(c){
  const hoje="(NOW() AT TIME ZONE 'America/Sao_Paulo')::date";
  await c.query(`INSERT INTO wms_ocupacao_diaria(data,empresa,cliente_id,armazem_id,paletes,posicoes,unidades,kg,m3)
    SELECT ${hoje},s.empresa,s.cliente_id,s.armazem_id,
      COUNT(DISTINCT s.lpn_id)+COUNT(DISTINCT s.endereco_id) FILTER (WHERE s.lpn_id IS NULL),COUNT(DISTINCT s.endereco_id),SUM(s.qtd),SUM(s.qtd*p.peso_bruto_kg),SUM(s.qtd*${SQL_M3})
    FROM wms_saldos s JOIN wms_produtos p ON p.id=s.produto_id WHERE s.qtd>0 GROUP BY s.empresa,s.cliente_id,s.armazem_id
    ON CONFLICT (data,cliente_id,armazem_id) DO UPDATE SET paletes=GREATEST(wms_ocupacao_diaria.paletes,EXCLUDED.paletes),
      posicoes=GREATEST(wms_ocupacao_diaria.posicoes,EXCLUDED.posicoes),unidades=GREATEST(wms_ocupacao_diaria.unidades,EXCLUDED.unidades),
      kg=GREATEST(wms_ocupacao_diaria.kg,EXCLUDED.kg),m3=GREATEST(wms_ocupacao_diaria.m3,EXCLUDED.m3),atualizado_em=NOW()`);
  // quem esvaziou o estoque ganha uma foto zerada, senão o dia seguinte repetiria a última foto com saldo
  await c.query(`INSERT INTO wms_ocupacao_diaria(data,empresa,cliente_id,armazem_id)
    SELECT DISTINCT ${hoje},o.empresa,o.cliente_id,o.armazem_id FROM wms_ocupacao_diaria o WHERE o.data>=${hoje}-60 AND o.data<${hoje}
    ON CONFLICT (data,cliente_id,armazem_id) DO NOTHING`);
}
const mesOk=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m||''));
const r2=v=>Math.round(v*100)/100,r3=v=>Math.round(v*1000)/1000;
async function faturamento(pool,ctx,mes,clienteId){
  if(!mesOk(mes))throw erro(400,'Informe o mês (AAAA-MM).');
  await fotografarOcupacao(pool);
  const noPeriodo=col=>`(${col} AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN lim.ini AND lim.fim`;
  // dias do mês até hoje (mês corrente) ou até o fim (mês fechado)
  const r=await pool.query(`WITH lim AS (SELECT $2::date AS ini,LEAST(($2::date+INTERVAL '1 month'-INTERVAL '1 day')::date,(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AS fim),
      dias AS (SELECT generate_series(lim.ini,lim.fim,INTERVAL '1 day')::date AS d FROM lim WHERE lim.fim>=lim.ini),
      cli AS (SELECT c.* FROM wms_clientes c WHERE c.empresa=$1 AND ($3::bigint IS NULL OR c.id=$3)),
      ocup AS (SELECT cli.id AS cliente_id,dias.d,COALESCE(o.paletes,0) AS paletes,COALESCE(o.posicoes,0) AS posicoes,COALESCE(o.m3,0) AS m3,COALESCE(o.kg,0) AS kg
        FROM cli CROSS JOIN dias LEFT JOIN LATERAL (SELECT SUM(o.paletes) AS paletes,SUM(o.posicoes) AS posicoes,SUM(o.m3) AS m3,SUM(o.kg) AS kg FROM wms_ocupacao_diaria o
          WHERE o.cliente_id=cli.id AND o.data=(SELECT MAX(o2.data) FROM wms_ocupacao_diaria o2 WHERE o2.cliente_id=cli.id AND o2.data<=dias.d)) o ON TRUE),
      arm AS (SELECT cliente_id,SUM(paletes) AS palete_dias,SUM(posicoes) AS posicao_dias,SUM(m3) AS m3_dias,SUM(kg)/1000 AS ton_dias,MAX(paletes) AS pico_paletes
        FROM ocup GROUP BY cliente_id),
      mov AS (SELECT m.cliente_id,
          SUM(m.qtd) FILTER (WHERE m.tipo='entrada') AS entrada_un,CEIL(SUM(CASE WHEN p.un_por_caixa>0 THEN m.qtd/p.un_por_caixa ELSE m.qtd END) FILTER (WHERE m.tipo='entrada')) AS entrada_cx,
          COUNT(DISTINCT m.lpn_id) FILTER (WHERE m.tipo='entrada') AS entrada_paletes,SUM(m.qtd*p.peso_bruto_kg) FILTER (WHERE m.tipo='entrada')/1000 AS entrada_ton,
          SUM(m.qtd) FILTER (WHERE m.tipo='saida') AS saida_un,CEIL(SUM(CASE WHEN p.un_por_caixa>0 THEN m.qtd/p.un_por_caixa ELSE m.qtd END) FILTER (WHERE m.tipo='saida')) AS saida_cx,
          SUM(m.qtd*p.peso_bruto_kg) FILTER (WHERE m.tipo='saida')/1000 AS saida_ton
        FROM wms_movimentos m JOIN wms_produtos p ON p.id=m.produto_id,lim WHERE m.empresa=$1 AND m.tipo IN ('entrada','saida') AND ${noPeriodo('m.criado_em')} GROUP BY m.cliente_id),
      nfe AS (SELECT r.cliente_id,COUNT(*) AS n,SUM(COALESCE(NULLIF(substring(r.xml from '<(?:[A-Za-z0-9]+:)?vNF>([0-9.]+)<'),'')::numeric,0)) AS valor
        FROM wms_recebimentos r,lim WHERE r.empresa=$1 AND r.status='finalizado' AND ${noPeriodo('r.finalizado_em')} GROUP BY r.cliente_id),
      nfs AS (SELECT x.cliente_id,COUNT(*) AS n FROM wms_expedicoes x,lim WHERE x.empresa=$1 AND x.status='expedida' AND ${noPeriodo('x.expedida_em')} GROUP BY x.cliente_id),
      sep AS (SELECT x.cliente_id,COUNT(*) AS linhas,COUNT(DISTINCT s.lpn_id) AS paletes FROM wms_expedicao_separacao s JOIN wms_expedicoes x ON x.id=s.expedicao_id,lim
        WHERE x.empresa=$1 AND x.status='expedida' AND s.status='separada' AND ${noPeriodo('x.expedida_em')} GROUP BY x.cliente_id)
    SELECT cli.id::text,cli.nome,cli.cnpj,(SELECT COUNT(*) FROM dias)::int AS dias,
      COALESCE(arm.palete_dias,0)::float AS palete_dias,COALESCE(arm.posicao_dias,0)::float AS posicao_dias,COALESCE(arm.m3_dias,0)::float AS m3_dias,
      COALESCE(arm.ton_dias,0)::float AS ton_dias,COALESCE(arm.pico_paletes,0)::float AS pico_paletes,
      COALESCE(mov.entrada_un,0)::float AS entrada_un,COALESCE(mov.entrada_cx,0)::float AS entrada_cx,COALESCE(mov.entrada_paletes,0)::float AS entrada_paletes,
      COALESCE(mov.entrada_ton,0)::float AS entrada_ton,COALESCE(nfe.n,0)::float AS nf_entrada,COALESCE(nfe.valor,0)::float AS valor_nf_entrada,
      COALESCE(mov.saida_un,0)::float AS saida_un,COALESCE(mov.saida_cx,0)::float AS saida_cx,COALESCE(sep.paletes,0)::float AS saida_paletes,
      COALESCE(mov.saida_ton,0)::float AS saida_ton,COALESCE(nfs.n,0)::float AS nf_saida,COALESCE(sep.linhas,0)::float AS linhas_separadas,
      1::float AS um,row_to_json(t) AS tarifa
    FROM cli LEFT JOIN arm ON arm.cliente_id=cli.id LEFT JOIN mov ON mov.cliente_id=cli.id LEFT JOIN nfe ON nfe.cliente_id=cli.id
      LEFT JOIN nfs ON nfs.cliente_id=cli.id LEFT JOIN sep ON sep.cliente_id=cli.id LEFT JOIN wms_tarifas t ON t.cliente_id=cli.id
    ORDER BY cli.nome`,[ctx.emp,mes+'-01',clienteId||null]);
  const rs=r.rows.map(x=>{
    const t=Object.fromEntries(CAMPOS_TARIFA.map(k=>[k,+(x.tarifa?.[k]||0)]));
    const medidas=Object.fromEntries(METODOS_COBRANCA.filter(d=>d.m&&d.m!=='um').map(d=>[d.m,r3(x[d.m])]));
    const linhas=METODOS_COBRANCA.filter(d=>!d.minimo&&t[d.k]>0).map(d=>{
      const qtd=r3(x[d.m]);
      return{metodo:d.k,grupo:d.grupo,item:d.item,un:d.un,qtd,preco:t[d.k],pct:!!d.pct,valor:r2(d.pct?qtd*t[d.k]/100:qtd*t[d.k])};
    });
    const soma=r2(linhas.reduce((a,l)=>a+l.valor,0));
    const total=Math.max(soma,t.minimo_mensal);
    return{cliente_id:x.id,cliente:x.nome,cnpj:x.cnpj,dias:x.dias,pico_paletes:x.pico_paletes,medidas,tarifa:t,tem_tarifa:!!x.tarifa,linhas,subtotal:soma,
      minimo:t.minimo_mensal,ajuste_minimo:r2(total-soma),total};
  });
  return{ok:true,mes,metodos:METODOS_COBRANCA,rows:rs,total:r2(rs.reduce((a,x)=>a+x.total,0))};
}
function faturamentoCsv(f){
  const br=(v,d=2)=>Number(v||0).toFixed(d).replace('.',','),q=s=>'"'+String(s??'').replace(/"/g,'""')+'"';
  const out=['Cliente;CNPJ;Item;Quantidade;Unidade;Preço unitário;Valor'];
  for(const x of f.rows){
    for(const l of x.linhas)out.push([q(x.cliente),q(x.cnpj),q(l.item),br(l.qtd,l.un==='t'||l.un==='t-dia'||/m³/.test(l.un)?3:2),q(l.un),l.pct?br(l.preco)+'%':br(l.preco,4),br(l.valor)].join(';'));
    if(x.ajuste_minimo>0)out.push([q(x.cliente),q(x.cnpj),q('Complemento do mínimo mensal'),'1',q('mês'),br(x.ajuste_minimo),br(x.ajuste_minimo)].join(';'));
    out.push([q(x.cliente),q(x.cnpj),q('TOTAL '+f.mes),'','','',br(x.total)].join(';'));
  }
  return '﻿'+out.join('\r\n')+'\r\n';
}
async function mudarEstado(pool,ctx,b,bloquear){
  const motivo=limpo(b.motivo,300);
  if(!motivo)throw erro(400,'Informe o motivo.');
  return operacao(pool,ctx,b.uuid,bloquear?'bloqueio':'desbloqueio',async(c,op)=>{
    const de=bloquear?'disponivel':'bloqueado',para=bloquear?'bloqueado':'disponivel';
    let linhas=[];
    if(b.lpn){
      const lpn=(await c.query('SELECT * FROM wms_lpns WHERE codigo=$1 AND empresa=$2',[codigo(b.lpn),ctx.emp])).rows[0];
      if(!lpn)throw erro(404,'Palete não encontrado.','LPN_INEXISTENTE');
      linhas=(await c.query('SELECT * FROM wms_saldos WHERE lpn_id=$1 AND estado=$2 FOR UPDATE',[lpn.id,de])).rows.map(s=>({s,q:+s.qtd}));
    }else{
      const arm=await doEmpresa(c,ctx,'wms_armazens',b.armazem_id,'Armazém não encontrado.');
      const end=await enderecoPorCodigo(c,ctx,arm.id,b.endereco);
      const prod=await produtoPorCodigo(c,ctx,null,b.produto);
      let falta=num(b.qtd);
      const rs=(await c.query('SELECT * FROM wms_saldos WHERE endereco_id=$1 AND produto_id=$2 AND estado=$3 ORDER BY id FOR UPDATE',[end.id,prod.id,de])).rows;
      if(falta===null)falta=rs.reduce((a,s)=>a+ +s.qtd,0);
      if(!qtdOk(falta))throw erro(409,'Não há saldo '+(bloquear?'disponível':'bloqueado')+' deste produto em '+end.codigo+'.','ESTOQUE_INSUFICIENTE');
      for(const s of rs){if(falta<=1e-9)break;const q=Math.min(falta,+s.qtd);falta-=q;linhas.push({s,q})}
      if(falta>1e-9)throw erro(409,'Estoque insuficiente para '+(bloquear?'bloquear':'desbloquear')+'.','ESTOQUE_INSUFICIENTE');
    }
    if(!linhas.length)throw erro(409,'Nada '+(bloquear?'disponível para bloquear':'bloqueado para liberar')+'.','ESTOQUE_INSUFICIENTE');
    for(const{s,q}of linhas)await mover(c,ctx,{operacao:op,tipo:bloquear?'bloqueio':'desbloqueio',armazem_id:s.armazem_id,produto_id:s.produto_id,cliente_id:s.cliente_id,lote_id:s.lote_id,qtd:q,
      de:{endereco_id:s.endereco_id,estado:de,lpn_id:s.lpn_id},para:{endereco_id:s.endereco_id,estado:para,lpn_id:s.lpn_id},motivo});
    await auditar(c,ctx,bloquear?'bloquear':'desbloquear','estoque',op,{motivo,linhas:linhas.length});
    return{ok:true,linhas:linhas.length,qtd:linhas.reduce((a,l)=>a+l.q,0)};
  });
}

// ---------------------------------------------------------------- consultas
async function consulta(pool,ctx,cod,armazemId){
  const s=limpo(cod,80);
  if(!s)throw erro(400,'Leia um endereço, palete ou produto.');
  const base=`SELECT s.id::text,e.codigo AS endereco,p.sku,p.descricao,c.nome AS cliente,l.lote,l.validade::text,lp.codigo AS lpn,s.estado,s.qtd::float,p.unidade
    FROM wms_saldos s JOIN wms_enderecos e ON e.id=s.endereco_id JOIN wms_produtos p ON p.id=s.produto_id JOIN wms_clientes c ON c.id=s.cliente_id
    LEFT JOIN wms_lotes l ON l.id=s.lote_id LEFT JOIN wms_lpns lp ON lp.id=s.lpn_id WHERE s.empresa=$1 AND ($2::bigint IS NULL OR s.armazem_id=$2) AND `;
  const arm=armazemId&&/^\d+$/.test(String(armazemId))?armazemId:null;
  const e=await pool.query(base+'e.codigo=$3 ORDER BY p.sku',[ctx.emp,arm,codigo(s)]);
  const end=(await pool.query(`SELECT e.codigo,e.status,e.tipo,e.cap_paletes,e.cap_kg::float,z.nome AS zona FROM wms_enderecos e JOIN wms_zonas z ON z.id=e.zona_id WHERE e.empresa=$1 AND ($2::bigint IS NULL OR e.armazem_id=$2) AND e.codigo=$3 LIMIT 1`,[ctx.emp,arm,codigo(s)])).rows[0];
  if(end)return{tipo:'endereco',endereco:end,saldos:e.rows};
  const l=await pool.query(base+'lp.codigo=$3 ORDER BY p.sku',[ctx.emp,arm,codigo(s)]);
  if(l.rowCount)return{tipo:'lpn',lpn:codigo(s),saldos:l.rows};
  const p=await pool.query(base+'(upper(p.sku)=upper($3) OR p.ean=$3 OR $3=ANY(p.codigos_alt)) ORDER BY l.validade NULLS LAST,e.codigo',[ctx.emp,arm,s]);
  if(p.rowCount)return{tipo:'produto',saldos:p.rows};
  const pr=await pool.query('SELECT sku,descricao FROM wms_produtos WHERE empresa=$1 AND (upper(sku)=upper($2) OR ean=$2 OR $2=ANY(codigos_alt)) LIMIT 1',[ctx.emp,s]);
  if(pr.rowCount)return{tipo:'produto',produto:pr.rows[0],saldos:[]};
  throw erro(404,'Nada encontrado para '+s+'.');
}
async function rastreio(pool,ctx,u){
  const params=[ctx.emp],w=[];
  const lpn=u.searchParams.get('lpn'),prod=u.searchParams.get('produto'),lote=u.searchParams.get('lote');
  if(lpn){params.push(codigo(lpn));w.push('lp.codigo=$'+params.length)}
  if(prod){params.push(limpo(prod,80));w.push(`(upper(p.sku)=upper($${params.length}) OR p.ean=$${params.length})`)}
  if(lote){params.push(limpo(lote,40));w.push('l.lote=$'+params.length)}
  if(!w.length)throw erro(400,'Informe o palete (LPN), o produto ou o lote.');
  const r=await pool.query(`SELECT m.id::text,m.criado_em,m.tipo,p.sku,p.descricao,l.lote,lp.codigo AS lpn,m.qtd::float,eo.codigo AS origem,ed.codigo AS destino,
      m.estado_origem,m.estado_destino,m.motivo,m.documento,m.usuario FROM wms_movimentos m JOIN wms_produtos p ON p.id=m.produto_id
      LEFT JOIN wms_lotes l ON l.id=m.lote_id LEFT JOIN wms_lpns lp ON lp.id=m.lpn_id LEFT JOIN wms_enderecos eo ON eo.id=m.origem_id LEFT JOIN wms_enderecos ed ON ed.id=m.destino_id
    WHERE m.empresa=$1 AND ${w.join(' AND ')} ORDER BY m.id LIMIT 2000`,params);
  return r.rows;
}
async function painel(pool,ctx,armazemId){
  const arm=armazemId&&/^\d+$/.test(String(armazemId))?armazemId:null;
  const P=[ctx.emp,arm];
  const zonas=(await pool.query(`SELECT z.id::text,z.nome,z.tipo,COUNT(e.id)::int AS enderecos,COALESCE(SUM(e.cap_paletes),0)::int AS capacidade,
      COUNT(e.id) FILTER (WHERE e.status='bloqueado')::int AS bloqueados,
      COALESCE(SUM((SELECT COUNT(DISTINCT s.lpn_id)+CASE WHEN BOOL_OR(s.lpn_id IS NULL) THEN 1 ELSE 0 END FROM wms_saldos s WHERE s.endereco_id=e.id)),0)::int AS ocupados
    FROM wms_zonas z LEFT JOIN wms_enderecos e ON e.zona_id=z.id WHERE z.empresa=$1 AND ($2::bigint IS NULL OR z.armazem_id=$2) GROUP BY z.id ORDER BY z.id`,P)).rows;
  const rec=(await pool.query(`SELECT status,COUNT(*)::int AS n FROM wms_recebimentos WHERE empresa=$1 AND ($2::bigint IS NULL OR armazem_id=$2) AND (status NOT IN ('finalizado','cancelado') OR finalizado_em>NOW()-INTERVAL '1 day') GROUP BY status`,P)).rows;
  const tarefas=(await pool.query(`SELECT status,COUNT(*)::int AS n FROM wms_tarefas WHERE empresa=$1 AND ($2::bigint IS NULL OR armazem_id=$2) AND status IN ('pendente','em_execucao') GROUP BY status`,P)).rows;
  const div=(await pool.query(`SELECT d.tipo,COUNT(*)::int AS n FROM wms_divergencias d JOIN wms_recebimentos r ON r.id=d.recebimento_id WHERE d.empresa=$1 AND ($2::bigint IS NULL OR r.armazem_id=$2) AND d.status='aberta' GROUP BY d.tipo`,P)).rows;
  const estoque=(await pool.query(`SELECT estado,COALESCE(SUM(qtd),0)::float AS qtd,COUNT(DISTINCT lpn_id)::int AS paletes FROM wms_saldos WHERE empresa=$1 AND ($2::bigint IS NULL OR armazem_id=$2) GROUP BY estado`,P)).rows;
  const movs=(await pool.query(`SELECT m.criado_em,m.tipo,p.sku,lp.codigo AS lpn,m.qtd::float,eo.codigo AS origem,ed.codigo AS destino,m.usuario FROM wms_movimentos m JOIN wms_produtos p ON p.id=m.produto_id
      LEFT JOIN wms_lpns lp ON lp.id=m.lpn_id LEFT JOIN wms_enderecos eo ON eo.id=m.origem_id LEFT JOIN wms_enderecos ed ON ed.id=m.destino_id
    WHERE m.empresa=$1 AND ($2::bigint IS NULL OR m.armazem_id=$2) ORDER BY m.id DESC LIMIT 15`,P)).rows;
  const cap=zonas.filter(z=>ZONAS_GUARDA.includes(z.tipo)).reduce((a,z)=>a+z.capacidade,0),oc=zonas.filter(z=>ZONAS_GUARDA.includes(z.tipo)).reduce((a,z)=>a+z.ocupados,0);
  return{ocupacao:{capacidade:cap,ocupados:oc,pct:cap?Math.round(oc*1000/cap)/10:0},zonas,recebimentos:rec,tarefas,divergencias:div,estoque,movimentos:movs};
}
async function mapa(pool,ctx,armazemId){
  const arm=await doEmpresa(pool,ctx,'wms_armazens',armazemId,'Armazém não encontrado.');
  const r=await pool.query(`SELECT e.id::text,e.codigo,e.rua,e.coluna,e.nivel,e.posicao,e.tipo,e.status,e.cap_paletes,e.cap_kg::float,e.distancia_m::float,z.nome AS zona,z.tipo AS zona_tipo
    FROM wms_enderecos e JOIN wms_zonas z ON z.id=e.zona_id WHERE e.armazem_id=$1 ORDER BY e.rua,e.coluna,e.nivel,e.posicao,e.codigo`,[arm.id]);
  const oc=await ocupacoes(pool,r.rows.map(x=>x.id));
  return r.rows.map(e=>{
    const o=oc.get(e.id)||{paletes:0,kg:0};
    const situacao=e.status!=='ativo'?'bloqueado':!o.paletes?'livre':(e.cap_paletes>0&&o.paletes>=e.cap_paletes)||(e.cap_kg>0&&o.kg>=e.cap_kg)?'ocupado':'parcial';
    return{...e,paletes:o.paletes,kg:Math.round(o.kg),situacao};
  });
}

// ---------------------------------------------------------------- etiquetas (HTML para imprimir)
async function etiquetas(pool,ctx,u){
  const tipo=u.searchParams.get('tipo');
  let itens=[];
  if(tipo==='endereco'){
    const arm=await doEmpresa(pool,ctx,'wms_armazens',u.searchParams.get('armazem_id'),'Armazém não encontrado.');
    const ids=String(u.searchParams.get('ids')||'').split(',').filter(x=>/^\d+$/.test(x)).slice(0,2000);
    const zona=u.searchParams.get('zona_id');
    const r=await pool.query(`SELECT e.codigo,z.nome AS zona FROM wms_enderecos e JOIN wms_zonas z ON z.id=e.zona_id WHERE e.armazem_id=$1
      AND (cardinality($2::bigint[])=0 OR e.id=ANY($2::bigint[])) AND ($3::bigint IS NULL OR e.zona_id=$3) ORDER BY e.codigo LIMIT 2000`,[arm.id,ids,zona&&/^\d+$/.test(zona)?zona:null]);
    itens=r.rows.map(x=>({codigo:x.codigo,titulo:x.codigo,linha:arm.nome+' · '+x.zona}));
  }else if(tipo==='lpn'){
    const rec=u.searchParams.get('recebimento_id'),cods=String(u.searchParams.get('codigos')||'').split(',').map(x=>codigo(x)).filter(Boolean).slice(0,500);
    const r=await pool.query(`SELECT l.codigo,(SELECT string_agg(p.sku||' · '||p.descricao||' · '||s.qtd::float||' '||p.unidade||COALESCE(' · lote '||lo.lote,'')||COALESCE(' · val. '||to_char(lo.validade,'DD/MM/YYYY'),''),' | ')
        FROM wms_saldos s JOIN wms_produtos p ON p.id=s.produto_id LEFT JOIN wms_lotes lo ON lo.id=s.lote_id WHERE s.lpn_id=l.id) AS conteudo,c.nome AS cliente
      FROM wms_lpns l LEFT JOIN wms_recebimentos r ON r.id=l.recebimento_id LEFT JOIN wms_clientes c ON c.id=r.cliente_id
      WHERE l.empresa=$1 AND (($2::bigint IS NOT NULL AND l.recebimento_id=$2) OR l.codigo=ANY($3::text[])) ORDER BY l.id`,[ctx.emp,rec&&/^\d+$/.test(rec)?rec:null,cods]);
    itens=r.rows.map(x=>({codigo:x.codigo,titulo:x.codigo,linha:(x.cliente?x.cliente+' · ':'')+(x.conteudo||'')}));
  }else throw erro(400,'Tipo de etiqueta inválido.');
  if(!itens.length)throw erro(404,'Nenhuma etiqueta para imprimir.');
  let QR=null;try{QR=require('qrcode')}catch{}
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let html='';
  for(const it of itens){
    const qr=QR?await QR.toString(it.codigo,{type:'svg',margin:0,errorCorrectionLevel:'M'}):'';
    html+=`<div class="et"><div class="t">${esc(it.titulo)}</div><div class="cod">${code128Svg(it.codigo,{altura:70,modulo:2})}</div><div class="rod"><div class="qr">${qr}</div><div class="l">${esc(it.linha)}</div></div></div>`;
  }
  return`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas WMS</title><style>
    body{margin:0;font-family:Segoe UI,Arial,sans-serif;color:#000}.bar{padding:10px;background:#0f172a;color:#fff;display:flex;gap:10px;align-items:center}
    .bar button{font:700 14px Segoe UI,Arial;padding:8px 14px;border-radius:8px;border:0;background:#0f766e;color:#fff;cursor:pointer}
    .folha{display:flex;flex-wrap:wrap;gap:6mm;padding:6mm}.et{width:95mm;height:60mm;border:1px dashed #94a3b8;padding:3mm;box-sizing:border-box;display:flex;flex-direction:column;page-break-inside:avoid}
    .t{font:800 26px Segoe UI,Arial;letter-spacing:1px}.cod svg{width:100%;height:20mm}.rod{display:flex;gap:3mm;align-items:center;flex:1}.qr svg{width:18mm;height:18mm}.l{font-size:10px;line-height:1.25;overflow:hidden;max-height:20mm}
    @media print{.bar{display:none}.et{border:0}}</style></head><body><div class="bar"><button onclick="print()">Imprimir</button><span>${itens.length} etiqueta(s)</span></div><div class="folha">${html}</div></body></html>`;
}

// ---------------------------------------------------------------- rotas
function enviarPagina(res,arquivo,testMode){
  let html=fs.readFileSync(arquivo,'utf8');
  if(testMode)html=html.replace(/<body([^>]*)>/i,m=>m+'<div style="position:sticky;top:0;z-index:99999;background:#b45309;color:#fff;font:600 13px Segoe UI,Arial,sans-serif;text-align:center;padding:6px 10px">AMBIENTE DE TESTE — dados fictícios, integrações desligadas</div>');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
  res.end(html);
}
const MANIFESTO=JSON.stringify({name:'CONSTRULOG WMS',short_name:'WMS',start_url:'/wms/app',scope:'/wms/',display:'standalone',background_color:'#0f172a',theme_color:'#0f766e',
  icons:[{src:'/wms/icone.svg',sizes:'any',type:'image/svg+xml'}]});
const ICONE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="#0f766e"/><path d="M20 70V38l28-14 28 14v32H62V48H34v22z" fill="#fff"/><rect x="38" y="54" width="20" height="16" fill="#fff"/></svg>';
// Guarda a tela do aplicativo para abrir sem sinal; os dados seguem pela fila do próprio aplicativo.
const SW=`const C='wms-app-v1';self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['/wms/app'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method==='GET'&&u.pathname==='/wms/app')e.respondWith(fetch(e.request).then(r=>{const k=r.clone();caches.open(C).then(c=>c.put('/wms/app',k));return r}).catch(()=>caches.match('/wms/app')))});`;

async function handle(req,res,u,deps){
  const p=u.pathname;
  if(!(p==='/wms'||p.startsWith('/wms/')||p.startsWith('/api/wms/')||p==='/api/wms'))return false;
  const {pool,sendJson,readJsonBodyLimited,testMode}=deps;
  if(!ativo){sendJson(res,404,{ok:false,error:'Módulo WMS desligado neste ambiente.'});return true}
  const json=(st,o)=>{sendJson(res,st,o);return true};
  const corpo=(max=256*1024)=>readJsonBodyLimited(req,max);
  const M=req.method;
  try{
    // ---------- páginas
    if(M==='GET'&&(p==='/wms'||p==='/wms/'||p==='/wms/app'||p==='/wms/app/')){
      try{const ctx=await contexto(deps,req,'operador');if(!ctx.gestao&&!p.startsWith('/wms/app')){res.writeHead(302,{Location:'/wms/app','Cache-Control':'no-store'});res.end();return true}}catch(e){
        if(e.status===403){res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial;padding:30px;color:#334155}h2{color:#991b1b}</style><h2>Acesso não autorizado</h2><p>'+e.message+'</p>');return true}
        res.writeHead(302,{Location:'/?login=1','Cache-Control':'no-store'});res.end();return true;
      }
      enviarPagina(res,p.startsWith('/wms/app')?PAGINA_APP:PAGINA_GESTAO,testMode);return true;
    }
    if(M==='GET'&&p==='/wms/manifest.json'){res.writeHead(200,{'Content-Type':'application/manifest+json','Cache-Control':'public, max-age=3600'});res.end(MANIFESTO);return true}
    if(M==='GET'&&p==='/wms/icone.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=86400'});res.end(ICONE);return true}
    if(M==='GET'&&p==='/wms/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache','Service-Worker-Allowed':'/wms/'});res.end(SW);return true}
    if(M==='GET'&&p==='/wms/etiquetas'){
      const ctx=await contexto(deps,req,'operador');
      const html=await etiquetas(pool,ctx,u);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return true;
    }
    if(!p.startsWith('/api/wms'))return json(404,{ok:false,error:'Página não encontrada.'});

    // ---------- API
    if(M==='GET'&&p==='/api/wms/status'){
      const ctx=await contexto(deps,req);
      return json(200,{ok:true,ativo:true,usuario:ctx.usuario,gestao:ctx.gestao,operador:ctx.operador,supervisor:ctx.supervisor||ctx.admin,ajuste:ctx.ajuste,
        nfe_chave:ctx.emp===0&&sefaz.configurado()});
    }
    // armazéns e zonas
    if(p==='/api/wms/armazens'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const r=await pool.query(`SELECT a.id::text,a.codigo,a.nome,a.endereco,a.ativo,(SELECT COUNT(*) FROM wms_enderecos e WHERE e.armazem_id=a.id)::int AS enderecos,
        COALESCE((SELECT json_agg(json_build_object('id',z.id::text,'codigo',z.codigo,'nome',z.nome,'tipo',z.tipo) ORDER BY z.id) FROM wms_zonas z WHERE z.armazem_id=a.id),'[]') AS zonas
        FROM wms_armazens a WHERE a.empresa=$1 ORDER BY a.codigo`,[ctx.emp]);
      return json(200,{ok:true,rows:r.rows});
    }
    if(p==='/api/wms/armazens'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const cod=codigo(b.codigo,20),nome=limpo(b.nome,120);
      if(!cod||!nome)throw erro(400,'Informe código e nome do armazém.');
      const r=await tx(pool,async c=>{
        const a=await c.query('INSERT INTO wms_armazens(empresa,codigo,nome,endereco) VALUES($1,$2,$3,$4) RETURNING id::text',[ctx.emp,cod,nome,limpo(b.endereco,240)]);
        const id=a.rows[0].id;
        // toda área nasce com doca, quarentena e avarias; o pulmão vem do cadastro de endereços
        for(const[zc,zn,zt]of[['DOCA','Docas','doca'],['QUAR','Quarentena','quarentena'],['AVAR','Avarias','avaria'],['PULM','Pulmão','pulmao']])
          await c.query('INSERT INTO wms_zonas(empresa,armazem_id,codigo,nome,tipo) VALUES($1,$2,$3,$4,$5)',[ctx.emp,id,zc,zn,zt]);
        await auditar(c,ctx,'criar','armazem',id,{codigo:cod});
        return id;
      }).catch(e=>{if(e.code==='23505')throw erro(409,'Já existe armazém com este código.');throw e});
      return json(201,{ok:true,id:r});
    }
    let m=p.match(/^\/api\/wms\/armazens\/(\d+)\/zonas$/);
    if(m&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      await doEmpresa(pool,ctx,'wms_armazens',m[1],'Armazém não encontrado.');
      const cod=codigo(b.codigo,20),nome=limpo(b.nome,80),tipo=String(b.tipo||'');
      if(!cod||!nome||!ZONAS.includes(tipo))throw erro(400,'Informe código, nome e tipo da zona ('+ZONAS.join(', ')+').');
      const r=await pool.query('INSERT INTO wms_zonas(empresa,armazem_id,codigo,nome,tipo) VALUES($1,$2,$3,$4,$5) RETURNING id::text',[ctx.emp,m[1],cod,nome,tipo]).catch(e=>{if(e.code==='23505')throw erro(409,'Já existe zona com este código.');throw e});
      return json(201,{ok:true,id:r.rows[0].id});
    }
    // endereços
    if(p==='/api/wms/enderecos'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const arm=await doEmpresa(pool,ctx,'wms_armazens',u.searchParams.get('armazem_id'),'Armazém não encontrado.');
      return json(200,{ok:true,rows:await mapa(pool,ctx,arm.id)});
    }
    if(p==='/api/wms/enderecos/lote'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const arm=await doEmpresa(pool,ctx,'wms_armazens',b.armazem_id,'Armazém não encontrado.');
      const zona=(await pool.query('SELECT * FROM wms_zonas WHERE id=$1 AND armazem_id=$2',[b.zona_id,arm.id])).rows[0];
      if(!zona)throw erro(400,'Zona não encontrada neste armazém.');
      const tipo=TIPOS_ENDERECO.includes(b.tipo)?b.tipo:(zona.tipo==='doca'?'doca':'porta_palete');
      const capP=Math.trunc(num(b.cap_paletes)??1),capKg=num(b.cap_kg)??0,capM3=num(b.cap_m3)??0;
      if(capP<0||capKg<0||capM3<0)throw erro(400,'Capacidades não podem ser negativas.');
      const lista=gerarEnderecos(b);
      const n=await tx(pool,async c=>{
        let criados=0;
        for(const e of lista){
          const r=await c.query(`INSERT INTO wms_enderecos(empresa,armazem_id,zona_id,codigo,rua,coluna,nivel,posicao,tipo,cap_paletes,cap_kg,cap_m3,distancia_m)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (armazem_id,codigo) DO NOTHING`,[ctx.emp,arm.id,zona.id,e.codigo,e.rua,e.coluna,e.nivel,e.posicao,tipo,capP,capKg,capM3,e.distancia_m]);
          criados+=r.rowCount;
        }
        await auditar(c,ctx,'criar_lote','enderecos',arm.id,{zona:zona.codigo,criados,de:lista[0]?.codigo,ate:lista[lista.length-1]?.codigo});
        return criados;
      });
      return json(201,{ok:true,criados:n,ja_existiam:lista.length-n,primeiro:lista[0]?.codigo,ultimo:lista[lista.length-1]?.codigo});
    }
    // Apaga os endereços do armazém (ou da zona) sem saldo e sem histórico; os que têm ficam e são contados.
    if(p==='/api/wms/enderecos'&&M==='DELETE'){
      const ctx=await contexto(deps,req,'gestao');
      const arm=await doEmpresa(pool,ctx,'wms_armazens',u.searchParams.get('armazem_id'),'Armazém não encontrado.');
      const zonaId=u.searchParams.get('zona_id')||null;
      if(zonaId&&!(await pool.query('SELECT 1 FROM wms_zonas WHERE id=$1 AND armazem_id=$2',[zonaId,arm.id])).rowCount)throw erro(400,'Zona não encontrada neste armazém.');
      const r=await tx(pool,async c=>{
        const refs=(await c.query(`SELECT c.conrelid::regclass::text AS tabela,a.attname AS coluna FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='f' AND c.confrelid='wms_enderecos'::regclass`)).rows;
        const usado=refs.map(f=>`EXISTS (SELECT 1 FROM ${f.tabela} x WHERE x.${f.coluna}=e.id)`).join(' OR ')||'FALSE';
        const alvo='e.empresa=$1 AND e.armazem_id=$2 AND ($3::bigint IS NULL OR e.zona_id=$3)';
        const comSaldo=(await c.query(`SELECT COUNT(*)::int AS n FROM wms_enderecos e WHERE ${alvo} AND EXISTS (SELECT 1 FROM wms_saldos s WHERE s.endereco_id=e.id AND s.qtd>0)`,[ctx.emp,arm.id,zonaId])).rows[0].n;
        const apagados=(await c.query(`DELETE FROM wms_enderecos e WHERE ${alvo} AND NOT (${usado})`,[ctx.emp,arm.id,zonaId])).rowCount;
        const mantidos=(await c.query(`SELECT COUNT(*)::int AS n FROM wms_enderecos e WHERE ${alvo}`,[ctx.emp,arm.id,zonaId])).rows[0].n;
        await auditar(c,ctx,'apagar_lote','enderecos',arm.id,{zona_id:zonaId,apagados,mantidos,com_saldo:comSaldo});
        return{apagados,mantidos,com_saldo:comSaldo};
      });
      return json(200,{ok:true,...r});
    }
    // Passa os endereços de uma zona para outra do mesmo armazém (ex.: gerados por engano na quarentena); o saldo fica onde está.
    if(p==='/api/wms/enderecos/zona'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const arm=await doEmpresa(pool,ctx,'wms_armazens',b.armazem_id,'Armazém não encontrado.');
      const zonas=(await pool.query('SELECT id::text,codigo,tipo FROM wms_zonas WHERE armazem_id=$1 AND id::text=ANY($2::text[])',[arm.id,[String(b.de_zona_id||''),String(b.para_zona_id||'')]])).rows;
      const de=zonas.find(z=>z.id===String(b.de_zona_id)),para=zonas.find(z=>z.id===String(b.para_zona_id));
      if(!de||!para)throw erro(400,'Escolha a zona de origem e a de destino neste armazém.');
      if(de.id===para.id)throw erro(400,'A zona de destino é a mesma de origem.');
      const pref=limpo(b.prefixo,20).toUpperCase();
      const r=await tx(pool,async c=>{
        const q=await c.query(`UPDATE wms_enderecos SET zona_id=$3 WHERE armazem_id=$1 AND zona_id=$2 AND left(upper(codigo),length($4))=$4 RETURNING codigo`,[arm.id,de.id,para.id,pref]);
        await auditar(c,ctx,'mudar_zona','enderecos',arm.id,{de:de.codigo,para:para.codigo,prefixo:pref,movidos:q.rowCount});
        return q.rows.map(x=>x.codigo).sort();
      });
      return json(200,{ok:true,movidos:r.length,primeiro:r[0],ultimo:r[r.length-1]});
    }
    m=p.match(/^\/api\/wms\/enderecos\/(\d+)$/);
    if(m&&M==='PATCH'){
      const ctx=await contexto(deps,req,'supervisor'),b=await corpo();
      const e=await doEmpresa(pool,ctx,'wms_enderecos',m[1],'Endereço não encontrado.');
      const st=b.status!==undefined?String(b.status):e.status;
      if(!['ativo','bloqueado','inativo'].includes(st))throw erro(400,'Situação inválida.');
      const motivo=limpo(b.motivo,200);
      if(st!=='ativo'&&st!==e.status&&!motivo)throw erro(400,'Informe o motivo do bloqueio.');
      const capP=b.cap_paletes!==undefined?Math.trunc(num(b.cap_paletes)):e.cap_paletes,capKg=b.cap_kg!==undefined?num(b.cap_kg):e.cap_kg,dist=b.distancia_m!==undefined?num(b.distancia_m):e.distancia_m;
      if(!(capP>=0)||capKg===null||capKg<0||dist===null)throw erro(400,'Capacidade ou distância inválida.');
      await tx(pool,async c=>{
        await c.query('UPDATE wms_enderecos SET status=$2,motivo_bloqueio=$3,cap_paletes=$4,cap_kg=$5,distancia_m=$6 WHERE id=$1',[e.id,st,st==='ativo'?'':motivo||e.motivo_bloqueio,capP,capKg,dist]);
        await auditar(c,ctx,'alterar','endereco',e.id,{codigo:e.codigo,status:st,motivo});
      });
      return json(200,{ok:true});
    }
    // clientes
    if(p==='/api/wms/clientes'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const r=await pool.query('SELECT id::text,nome,cnpj,regras,ativo,(SELECT COUNT(*) FROM wms_produtos p WHERE p.cliente_id=c.id)::int AS produtos FROM wms_clientes c WHERE empresa=$1 ORDER BY nome',[ctx.emp]);
      return json(200,{ok:true,rows:r.rows});
    }
    if(p==='/api/wms/clientes'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const nome=limpo(b.nome,160),cnpj=so(b.cnpj);
      if(!nome)throw erro(400,'Informe o nome do cliente.');
      if(cnpj&&![11,14].includes(cnpj.length))throw erro(400,'CNPJ/CPF inválido.');
      const regras={recontagem:b.regras?.recontagem!==false,politica:['FEFO','FIFO'].includes(b.regras?.politica)?b.regras.politica:'FEFO'};
      const r=await pool.query('INSERT INTO wms_clientes(empresa,nome,cnpj,regras) VALUES($1,$2,$3,$4::jsonb) RETURNING id::text',[ctx.emp,nome,cnpj,JSON.stringify(regras)]).catch(e=>{if(e.code==='23505')throw erro(409,'Já existe cliente com este CNPJ.');throw e});
      return json(201,{ok:true,id:r.rows[0].id});
    }
    // destinatários (clientes de saída)
    if(p==='/api/wms/destinatarios'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const r=await pool.query('SELECT id::text,nome,cnpj,cidade,uf FROM wms_destinatarios WHERE empresa=$1 AND ativo ORDER BY nome',[ctx.emp]);
      return json(200,{ok:true,rows:r.rows});
    }
    if(p==='/api/wms/destinatarios'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const nome=limpo(b.nome,160),cnpj=so(b.cnpj);
      if(!nome)throw erro(400,'Informe o nome do destinatário.');
      if(cnpj&&![11,14].includes(cnpj.length))throw erro(400,'CNPJ/CPF inválido.');
      const r=await pool.query('INSERT INTO wms_destinatarios(empresa,nome,cnpj,cidade,uf,criado_por) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text',
        [ctx.emp,nome,cnpj,limpo(b.cidade,80),codigo(b.uf,2),ctx.usuario]).catch(e=>{if(e.code==='23505')throw erro(409,'Já existe destinatário com este CNPJ.');throw e});
      return json(201,{ok:true,id:r.rows[0].id});
    }
    m=p.match(/^\/api\/wms\/destinatarios\/(\d+)$/);
    if(m&&(M==='PATCH'||M==='DELETE')){
      const ctx=await contexto(deps,req,'gestao'),b=M==='PATCH'?await corpo():{};
      const d=(await pool.query('SELECT * FROM wms_destinatarios WHERE id=$1 AND empresa=$2 AND ativo',[m[1],ctx.emp])).rows[0];
      if(!d)throw erro(404,'Destinatário não encontrado.');
      if(M==='DELETE'){await pool.query('UPDATE wms_destinatarios SET ativo=FALSE WHERE id=$1',[d.id]);return json(200,{ok:true})}
      const nome=b.nome===undefined?d.nome:limpo(b.nome,160),cnpj=b.cnpj===undefined?d.cnpj:so(b.cnpj);
      if(!nome)throw erro(400,'Informe o nome do destinatário.');
      if(cnpj&&![11,14].includes(cnpj.length))throw erro(400,'CNPJ/CPF inválido.');
      await pool.query('UPDATE wms_destinatarios SET nome=$2,cnpj=$3,cidade=$4,uf=$5 WHERE id=$1',[d.id,nome,cnpj,b.cidade===undefined?d.cidade:limpo(b.cidade,80),b.uf===undefined?d.uf:codigo(b.uf,2)])
        .catch(e=>{if(e.code==='23505')throw erro(409,'Já existe destinatário com este CNPJ.');throw e});
      return json(200,{ok:true});
    }
    m=p.match(/^\/api\/wms\/clientes\/(\d+)$/);
    if(m&&M==='PATCH'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const cli=await doEmpresa(pool,ctx,'wms_clientes',m[1],'Cliente não encontrado.');
      const regras={...cli.regras,...(b.regras?{recontagem:b.regras.recontagem!==false,politica:['FEFO','FIFO'].includes(b.regras.politica)?b.regras.politica:(cli.regras.politica||'FEFO')}:{})};
      await pool.query('UPDATE wms_clientes SET nome=$2,regras=$3::jsonb,ativo=$4 WHERE id=$1',[cli.id,limpo(b.nome??cli.nome,160)||cli.nome,JSON.stringify(regras),b.ativo===undefined?cli.ativo:!!b.ativo]);
      return json(200,{ok:true});
    }
    // produtos
    if(p==='/api/wms/produtos'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const q=limpo(u.searchParams.get('q'),80),cli=u.searchParams.get('cliente_id');
      const r=await pool.query(`SELECT p.id::text,p.cliente_id::text,c.nome AS cliente,p.sku,p.descricao,p.ean,p.codigos_alt,p.unidade,p.un_por_caixa,p.caixas_por_palete,p.peso_bruto_kg::float,
          p.comprimento_cm::float,p.largura_cm::float,p.altura_cm::float,p.controla_lote,p.controla_validade,p.curva_abc,p.estoque_min::float,p.estoque_max::float,p.ativo,
          COALESCE((SELECT SUM(s.qtd) FROM wms_saldos s WHERE s.produto_id=p.id),0)::float AS saldo
        FROM wms_produtos p JOIN wms_clientes c ON c.id=p.cliente_id WHERE p.empresa=$1 AND p.ativo AND ($2::bigint IS NULL OR p.cliente_id=$2)
          AND ($3='' OR p.sku ILIKE '%'||$3||'%' OR p.descricao ILIKE '%'||$3||'%' OR p.ean=$3) ORDER BY c.nome,p.sku LIMIT 500`,[ctx.emp,cli&&/^\d+$/.test(cli)?cli:null,q]);
      return json(200,{ok:true,rows:r.rows});
    }
    if(p==='/api/wms/produtos'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const cli=await doEmpresa(pool,ctx,'wms_clientes',b.cliente_id,'Cliente não encontrado.');
      const sku=limpo(b.sku,60);
      if(!sku)throw erro(400,'Informe o SKU.');
      const f=camposProduto(b,true);
      const cols=['empresa','cliente_id','sku',...Object.keys(f)],vals=[ctx.emp,cli.id,sku,...Object.values(f)];
      const r=await pool.query(`INSERT INTO wms_produtos(${cols.join(',')}) VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id::text`,vals).catch(e=>{if(e.code==='23505')throw erro(409,'Este cliente já tem o SKU '+sku+'.');throw e});
      return json(201,{ok:true,id:r.rows[0].id});
    }
    m=p.match(/^\/api\/wms\/produtos\/(\d+)$/);
    if(m&&M==='PATCH'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      await doEmpresa(pool,ctx,'wms_produtos',m[1],'Produto não encontrado.');
      const f=camposProduto(b,false);
      if(!Object.keys(f).length)throw erro(400,'Nada para alterar.');
      await pool.query(`UPDATE wms_produtos SET ${Object.keys(f).map((k,i)=>k+'=$'+(i+2)).join(',')},atualizado_em=NOW() WHERE id=$1`,[m[1],...Object.values(f)]);
      return json(200,{ok:true});
    }
    // excluir: some de vez se nunca foi usado; se já tem histórico, fica inativo (o histórico não se apaga)
    if(m&&M==='DELETE'){
      const ctx=await contexto(deps,req,'gestao');
      await doEmpresa(pool,ctx,'wms_produtos',m[1],'Produto não encontrado.');
      return json(200,await tx(pool,async c=>{
        const prod=(await c.query('SELECT id,sku,descricao FROM wms_produtos WHERE id=$1 FOR UPDATE',[m[1]])).rows[0];
        const saldo=+(await c.query('SELECT COALESCE(SUM(qtd),0) AS q FROM wms_saldos WHERE produto_id=$1',[prod.id])).rows[0].q;
        if(saldo>0)throw erro(409,'O produto '+prod.sku+' ainda tem '+fmt(saldo,0)+' em estoque. Movimente ou dê baixa antes de excluir.','COM_SALDO');
        const aberto=(await c.query(`SELECT r.id FROM wms_recebimento_itens i JOIN wms_recebimentos r ON r.id=i.recebimento_id
          WHERE i.produto_id=$1 AND r.status NOT IN ('finalizado','cancelado') LIMIT 1`,[prod.id])).rows[0];
        if(aberto)throw erro(409,'O produto '+prod.sku+' está num recebimento em andamento (nº '+aberto.id+'). Desvincule o item ou cancele o recebimento antes.','EM_RECEBIMENTO');
        const usado=(await c.query(`SELECT EXISTS(SELECT 1 FROM wms_movimentos WHERE produto_id=$1) OR EXISTS(SELECT 1 FROM wms_recebimento_itens WHERE produto_id=$1)
          OR EXISTS(SELECT 1 FROM wms_contagens WHERE produto_id=$1) OR EXISTS(SELECT 1 FROM wms_divergencias WHERE produto_id=$1)
          OR EXISTS(SELECT 1 FROM wms_lotes WHERE produto_id=$1) OR EXISTS(SELECT 1 FROM wms_saldos WHERE produto_id=$1) AS u`,[prod.id])).rows[0].u;
        if(usado){
          // libera o SKU para um novo cadastro certo; o antigo continua no histórico com o código marcado
          await c.query("UPDATE wms_produtos SET ativo=FALSE,sku=sku||' (inativo '||id||')',atualizado_em=NOW() WHERE id=$1",[prod.id]);
          await auditar(c,ctx,'inativar','produto',prod.id,{sku:prod.sku,descricao:prod.descricao});
          return{ok:true,resultado:'inativado'};
        }
        await c.query('DELETE FROM wms_produtos WHERE id=$1',[prod.id]);
        await auditar(c,ctx,'excluir','produto',prod.id,{sku:prod.sku,descricao:prod.descricao});
        return{ok:true,resultado:'excluido'};
      }));
    }
    if(p==='/api/wms/produtos/busca'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const prod=await produtoPorCodigo(pool,ctx,u.searchParams.get('cliente_id')||null,u.searchParams.get('codigo'));
      return json(200,{ok:true,produto:{id:String(prod.id),sku:prod.sku,descricao:prod.descricao,unidade:prod.unidade,controla_lote:prod.controla_lote,controla_validade:prod.controla_validade}});
    }
    // recebimentos
    if(p==='/api/wms/recebimentos'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const st=String(u.searchParams.get('status')||'');
      const sts=st==='abertos'?['aguardando','na_doca','em_conferencia','recontagem','divergencia','conferido']:st==='conferencia'?['na_doca','em_conferencia','recontagem']:st?st.split(','):null;
      const r=await pool.query(`SELECT r.id::text,r.nf_numero,r.nf_chave,r.status,r.rodada,c.nome AS cliente,a.nome AS armazem,e.codigo AS doca,r.placa,r.criado_em,r.chegada_em,r.finalizado_em,
          (SELECT COUNT(*) FROM wms_divergencias d WHERE d.recebimento_id=r.id AND d.status='aberta')::int AS divergencias_abertas,
          (SELECT COUNT(*) FROM wms_recebimento_itens i WHERE i.recebimento_id=r.id AND i.produto_id IS NULL)::int AS itens_sem_produto
        FROM wms_recebimentos r JOIN wms_clientes c ON c.id=r.cliente_id JOIN wms_armazens a ON a.id=r.armazem_id LEFT JOIN wms_enderecos e ON e.id=r.doca_id
        WHERE r.empresa=$1 AND ($2::text[] IS NULL OR r.status=ANY($2)) ORDER BY r.id DESC LIMIT 200`,[ctx.emp,sts]);
      return json(200,{ok:true,rows:r.rows});
    }
    if(p==='/api/wms/recebimentos'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const r=await tx(pool,c=>criarRecebimento(c,ctx,{...b,xml:null}));
      return json(201,{ok:true,...r});
    }
    if(p==='/api/wms/recebimentos/xml'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo(3*1024*1024);
      return json(201,await importarXml(pool,ctx,b,b.xml));
    }
    // DANFE em PDF ou só a chave: prévia para conferir antes de lançar
    if(p==='/api/wms/nfe/previa'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo(8*1024*1024);
      return json(200,await previaNota(pool,ctx,b));
    }
    if(p==='/api/wms/recebimentos/danfe'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo(1024*1024);
      return json(201,{...(await importarXml(pool,ctx,b,nfeDoCorpo(b.nfe))),origem:'danfe'});
    }
    // leitura do código de barras do DANFE: baixa o XML na SEFAZ com o A1 da casa e cria o recebimento
    if(p==='/api/wms/recebimentos/chave'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const chave=so(b.chave);
      if(!sefaz.chaveValida(chave))throw erro(400,'Chave de acesso inválida. Leia o código de barras do DANFE (44 dígitos).','CHAVE_INVALIDA');
      const ja=(await pool.query('SELECT id::text,status FROM wms_recebimentos WHERE empresa=$1 AND nf_chave=$2 ORDER BY id DESC LIMIT 1',[ctx.emp,chave])).rows[0];
      if(ja&&ja.status!=='cancelado')throw erro(409,'Esta NF-e já está no recebimento nº '+ja.id+'.','NFE_DUPLICADA');
      const nota=await nfePelaChave(pool,ctx,chave);
      if(nota.pendente)return json(202,nota.pendente);
      return json(201,{...(await importarXml(pool,ctx,b,nota.xml)),origem:'sefaz'});
    }
    // faturamento da armazenagem (gestão)
    if(p==='/api/wms/faturamento'&&M==='GET'){
      const ctx=await contexto(deps,req,'gestao');
      const f=await faturamento(pool,ctx,u.searchParams.get('mes'),/^\d+$/.test(u.searchParams.get('cliente_id')||'')?u.searchParams.get('cliente_id'):null);
      if(u.searchParams.get('formato')==='csv'){
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="armazenagem-'+f.mes+'.csv"','Cache-Control':'no-store'});
        res.end(faturamentoCsv(f));return true;
      }
      return json(200,f);
    }
    m=p.match(/^\/api\/wms\/tarifas\/(\d+)$/);
    if(m&&M==='PUT'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const cli=await doEmpresa(pool,ctx,'wms_clientes',m[1],'Cliente não encontrado.');
      const v={};
      for(const k of CAMPOS_TARIFA){const x=b[k]===undefined||b[k]===''||b[k]===null?0:num(b[k]);if(x===null||x<0||x>(k==='ad_valorem'?100:1e7))throw erro(400,'Valor inválido em '+k+'.');v[k]=x}
      await tx(pool,async c=>{
        await c.query(`INSERT INTO wms_tarifas(cliente_id,empresa,${CAMPOS_TARIFA.join(',')},atualizado_por) VALUES($1,$2,${CAMPOS_TARIFA.map((_,i)=>'$'+(i+3)).join(',')},$${CAMPOS_TARIFA.length+3})
          ON CONFLICT (cliente_id) DO UPDATE SET ${CAMPOS_TARIFA.map(k=>k+'=EXCLUDED.'+k).join(',')},atualizado_por=EXCLUDED.atualizado_por,atualizado_em=NOW()`,
          [cli.id,ctx.emp,...CAMPOS_TARIFA.map(k=>v[k]),ctx.usuario]);
        await auditar(c,ctx,'tarifa','cliente',cli.id,v);
      });
      return json(200,{ok:true,tarifa:v});
    }
    // expedição
    if(p==='/api/wms/expedicoes'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const st=String(u.searchParams.get('status')||'');
      const sts=st==='abertas'?['aberta','separando','separada']:st?st.split(','):null;
      const r=await pool.query(`SELECT x.id::text,x.nf_numero,x.nf_chave,x.status,c.nome AS cliente,x.destinatario_nome,a.nome AS armazem,x.armazem_id::text,e.codigo AS doca,x.placa,x.criado_em,x.expedida_em,
          (SELECT COUNT(*) FROM wms_expedicao_itens i WHERE i.expedicao_id=x.id)::int AS itens,
          (SELECT COUNT(*) FROM wms_expedicao_itens i WHERE i.expedicao_id=x.id AND i.produto_id IS NULL)::int AS itens_sem_produto,
          (SELECT COUNT(*) FROM wms_expedicao_separacao s WHERE s.expedicao_id=x.id AND s.status='pendente')::int AS linhas_pendentes
        FROM wms_expedicoes x JOIN wms_clientes c ON c.id=x.cliente_id JOIN wms_armazens a ON a.id=x.armazem_id LEFT JOIN wms_enderecos e ON e.id=x.doca_id
        WHERE x.empresa=$1 AND ($2::text[] IS NULL OR x.status=ANY($2)) ORDER BY x.id DESC LIMIT 200`,[ctx.emp,sts]);
      return json(200,{ok:true,rows:r.rows});
    }
    if(p==='/api/wms/expedicoes'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      if(b.destinatario_id){
        const d=(await pool.query('SELECT nome,cnpj FROM wms_destinatarios WHERE id=$1 AND empresa=$2 AND ativo',[/^\d+$/.test(String(b.destinatario_id))?b.destinatario_id:0,ctx.emp])).rows[0];
        if(!d)throw erro(400,'Destinatário não encontrado.');
        b.destinatario_nome=d.nome;b.destinatario_cnpj=d.cnpj;
      }
      return json(201,{ok:true,...(await tx(pool,c=>criarExpedicao(c,ctx,{...b,xml:null})))});
    }
    if(p==='/api/wms/expedicoes/xml'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo(3*1024*1024);
      return json(201,await importarSaida(pool,ctx,b,b.xml));
    }
    if(p==='/api/wms/expedicoes/danfe'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo(1024*1024);
      return json(201,{...(await importarSaida(pool,ctx,b,nfeDoCorpo(b.nfe))),origem:'danfe'});
    }
    if(p==='/api/wms/expedicoes/chave'&&M==='POST'){
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      const chave=so(b.chave);
      if(!sefaz.chaveValida(chave))throw erro(400,'Chave de acesso inválida. Leia o código de barras do DANFE (44 dígitos).','CHAVE_INVALIDA');
      const ja=(await pool.query("SELECT id::text FROM wms_expedicoes WHERE empresa=$1 AND nf_chave=$2 AND status<>'cancelada' LIMIT 1",[ctx.emp,chave])).rows[0];
      if(ja)throw erro(409,'Esta NF-e já está na expedição nº '+ja.id+'.','NFE_DUPLICADA');
      const nota=await nfePelaChave(pool,ctx,chave);
      if(nota.pendente)return json(202,nota.pendente);
      return json(201,{...(await importarSaida(pool,ctx,b,nota.xml)),origem:'sefaz'});
    }
    m=p.match(/^\/api\/wms\/expedicoes\/(\d+)$/);
    if(m&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      return json(200,{ok:true,expedicao:await lerExpedicao(pool,ctx,m[1])});
    }
    m=p.match(/^\/api\/wms\/expedicoes\/(\d+)\/(vincular|reservar|separar|expedir|cancelar)$/);
    if(m&&M==='POST'){
      const acao=m[2],id=m[1];
      if(acao==='separar'){const ctx=await contexto(deps,req,'operador'),b=await corpo();return json(200,await separarItem(pool,ctx,id,b))}
      const ctx=await contexto(deps,req,'gestao'),b=await corpo();
      if(acao==='reservar')return json(200,await tx(pool,c=>reservarExpedicao(c,ctx,id)));
      if(acao==='expedir')return json(200,await tx(pool,c=>expedir(c,ctx,id,b)));
      if(acao==='cancelar')return json(200,await tx(pool,c=>cancelarExpedicao(c,ctx,id,b)));
      // vincular item da nota a um produto do cliente (só antes de reservar)
      return json(200,await tx(pool,async c=>{
        const x=(await c.query('SELECT * FROM wms_expedicoes WHERE id=$1 AND empresa=$2 FOR UPDATE',[id,ctx.emp])).rows[0];
        if(!x)throw erro(404,'Expedição não encontrada.');
        if(x.status!=='aberta')throw erro(409,'Só dá para vincular antes de reservar.','SITUACAO');
        const it=(await c.query('SELECT * FROM wms_expedicao_itens WHERE id=$1 AND expedicao_id=$2',[b.item_id,x.id])).rows[0];
        if(!it)throw erro(404,'Item não encontrado.');
        const prod=(await c.query('SELECT * FROM wms_produtos WHERE id=$1 AND cliente_id=$2 AND ativo',[b.produto_id,x.cliente_id])).rows[0];
        if(!prod)throw erro(400,'Produto não é deste cliente.');
        const fator=num(b.fator)||(prod.un_por_caixa>0&&['CX','CXA','CAIXA','FD','FARDO','PCT'].includes(it.unidade)&&it.unidade!==prod.unidade?prod.un_por_caixa:1);
        await c.query('UPDATE wms_expedicao_itens SET produto_id=$2,fator=$3 WHERE id=$1',[it.id,prod.id,fator]);
        if(it.codigo&&it.codigo!==prod.sku)await c.query('UPDATE wms_produtos SET codigos_alt=array_append(codigos_alt,$2) WHERE id=$1 AND NOT ($2=ANY(codigos_alt))',[prod.id,it.codigo]);
        await auditar(c,ctx,'vincular','expedicao_item',it.id,{produto:prod.sku,fator});
        return{ok:true};
      }));
    }
    m=p.match(/^\/api\/wms\/recebimentos\/(\d+)$/);
    if(m&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const cega=!ctx.gestao||u.searchParams.get('cega')==='1';
      return json(200,{ok:true,recebimento:await lerRecebimento(pool,ctx,m[1],{cega})});
    }
    m=p.match(/^\/api\/wms\/recebimentos\/(\d+)\/(vincular|chegada|contagens|fechar|finalizar|cancelar)$/);
    if(m&&M==='POST'){
      const acao=m[2],id=m[1];
      if(acao==='contagens'){
        const ctx=await contexto(deps,req,'operador'),b=await corpo(1536*1024);
        return json(201,await registrarContagem(pool,ctx,id,b));
      }
      if(acao==='finalizar'){
        const ctx=await contexto(deps,req,'gestao'),b=await corpo();
        return json(200,await operacao(pool,ctx,b.uuid||('fin-'+id+'-'+crypto.randomUUID()),'finalizar',async(c,op)=>{
          const rec=(await c.query('SELECT * FROM wms_recebimentos WHERE id=$1 AND empresa=$2 FOR UPDATE',[id,ctx.emp])).rows[0];
          if(!rec)throw erro(404,'Recebimento não encontrado.');
          return{ok:true,...await finalizarRecebimento(c,ctx,rec,op)};
        }));
      }
      const ctx=await contexto(deps,req,acao==='chegada'||acao==='fechar'?'operador':'gestao'),b=await corpo();
      const r=await tx(pool,async c=>{
        const rec=(await c.query('SELECT * FROM wms_recebimentos WHERE id=$1 AND empresa=$2 FOR UPDATE',[id,ctx.emp])).rows[0];
        if(!rec)throw erro(404,'Recebimento não encontrado.');
        if(acao==='vincular'){
          if(['finalizado','cancelado'].includes(rec.status))throw erro(409,'Recebimento encerrado.','SITUACAO');
          const prod=(await c.query('SELECT * FROM wms_produtos WHERE id=$1 AND cliente_id=$2',[b.produto_id,rec.cliente_id])).rows[0];
          if(!prod)throw erro(400,'Produto não é deste cliente.');
          const it=(await c.query('SELECT * FROM wms_recebimento_itens WHERE id=$1 AND recebimento_id=$2',[b.item_id,rec.id])).rows[0];
          if(!it)throw erro(404,'Item não encontrado.');
          const fator=num(b.fator)||(prod.un_por_caixa>0&&['CX','CXA','CAIXA','FD','FARDO','PCT'].includes(it.unidade)&&it.unidade!==prod.unidade?prod.un_por_caixa:1);
          await c.query('UPDATE wms_recebimento_itens SET produto_id=$2,fator=$3 WHERE id=$1',[it.id,prod.id,fator]);
          if(b.salvar_codigo!==false&&it.codigo&&it.codigo.toUpperCase()!==prod.sku.toUpperCase()&&!prod.codigos_alt.includes(it.codigo))
            await c.query('UPDATE wms_produtos SET codigos_alt=array_append(codigos_alt,$2) WHERE id=$1',[prod.id,it.codigo]);
          await auditar(c,ctx,'vincular_item','recebimento',rec.id,{item:it.id,produto:prod.sku,fator});
          return{ok:true};
        }
        if(acao==='chegada'){
          if(rec.status!=='aguardando')throw erro(409,'A chegada já foi registrada.','SITUACAO');
          const doca=await enderecoPorCodigo(c,ctx,rec.armazem_id,b.doca);
          if(doca.zona_tipo!=='doca')throw erro(400,doca.codigo+' não é uma doca.');
          if(doca.status!=='ativo')throw erro(409,'Doca '+doca.codigo+' bloqueada.');
          await c.query("UPDATE wms_recebimentos SET status='na_doca',doca_id=$2,placa=$3,motorista=$4,motorista_doc=$5,chegada_em=NOW() WHERE id=$1",
            [rec.id,doca.id,codigo(b.placa,10).replace(/[^A-Z0-9]/g,''),limpo(b.motorista,120),limpo(b.motorista_doc,30)]);
          await auditar(c,ctx,'chegada','recebimento',rec.id,{doca:doca.codigo,placa:b.placa});
          return{ok:true,status:'na_doca'};
        }
        if(acao==='fechar')return{ok:true,...await fecharConferencia(c,ctx,rec)};
        if(acao==='cancelar'){
          if(['finalizado','cancelado'].includes(rec.status))throw erro(409,'Recebimento já encerrado.','SITUACAO');
          const motivo=limpo(b.motivo,200);if(!motivo)throw erro(400,'Informe o motivo do cancelamento.');
          await c.query("UPDATE wms_recebimentos SET status='cancelado' WHERE id=$1",[rec.id]);
          await auditar(c,ctx,'cancelar','recebimento',rec.id,{motivo});
          return{ok:true,status:'cancelado'};
        }
      });
      return json(200,r);
    }
    m=p.match(/^\/api\/wms\/divergencias\/(\d+)\/decidir$/);
    if(m&&M==='POST'){
      const ctx=await contexto(deps,req,'supervisor'),b=await corpo();
      const dec=String(b.decisao||'');
      const r=await tx(pool,async c=>{
        const d=(await c.query('SELECT * FROM wms_divergencias WHERE id=$1 AND empresa=$2 FOR UPDATE',[m[1],ctx.emp])).rows[0];
        if(!d)throw erro(404,'Divergência não encontrada.');
        if(d.status!=='aberta')throw erro(409,'Divergência já decidida.','SITUACAO');
        const validas=d.tipo==='falta'?['aceita']:['aceita','bloqueada','recusada'];
        if(!validas.includes(dec))throw erro(400,'Decisão inválida para '+d.tipo+' ('+validas.join(', ')+').');
        await c.query('UPDATE wms_divergencias SET status=$2,decisao_por=$3,decisao_em=NOW(),obs=$4 WHERE id=$1',[d.id,dec,ctx.usuario,limpo(b.obs,300)]);
        await auditar(c,ctx,'decidir','divergencia',d.id,{tipo:d.tipo,decisao:dec,obs:limpo(b.obs,300)});
        const ab=await c.query("SELECT 1 FROM wms_divergencias WHERE recebimento_id=$1 AND status='aberta' LIMIT 1",[d.recebimento_id]);
        if(!ab.rowCount)await c.query("UPDATE wms_recebimentos SET status='conferido' WHERE id=$1 AND status='divergencia'",[d.recebimento_id]);
        return{ok:true,recebimento_conferido:!ab.rowCount};
      });
      return json(200,r);
    }
    m=p.match(/^\/api\/wms\/fotos\/contagem\/(\d+)$/);
    if(m&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const r=await pool.query('SELECT c.foto,c.foto_mime FROM wms_contagens c JOIN wms_recebimentos r ON r.id=c.recebimento_id WHERE c.id=$1 AND r.empresa=$2 AND c.foto IS NOT NULL',[m[1],ctx.emp]);
      if(!r.rowCount)throw erro(404,'Foto não encontrada.');
      res.writeHead(200,{'Content-Type':r.rows[0].foto_mime,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});res.end(r.rows[0].foto);return true;
    }
    // tarefas
    if(p==='/api/wms/tarefas'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const st=u.searchParams.get('status')==='concluidas'?['concluida']:['pendente','em_execucao'];
      const r=await pool.query(`SELECT t.id::text,t.tipo,t.status,t.prioridade,lp.codigo AS lpn,eo.codigo AS origem,es.codigo AS sugerido,t.motivo_sugestao,ed.codigo AS destino,t.operador,t.criado_em,t.concluido_em,
          (SELECT string_agg(p.sku||' · '||p.descricao||' · '||s.qtd::float||' '||p.unidade,'; ') FROM wms_saldos s JOIN wms_produtos p ON p.id=s.produto_id WHERE s.lpn_id=t.lpn_id) AS conteudo
        FROM wms_tarefas t LEFT JOIN wms_lpns lp ON lp.id=t.lpn_id LEFT JOIN wms_enderecos eo ON eo.id=t.origem_id LEFT JOIN wms_enderecos es ON es.id=t.sugerido_id LEFT JOIN wms_enderecos ed ON ed.id=t.destino_id
        WHERE t.empresa=$1 AND t.status=ANY($2) ORDER BY t.prioridade,t.id LIMIT 300`,[ctx.emp,st]);
      return json(200,{ok:true,rows:r.rows});
    }
    m=p.match(/^\/api\/wms\/tarefas\/(\d+)\/(confirmar|sugerir)$/);
    if(m&&M==='POST'){
      const ctx=await contexto(deps,req,'operador'),b=await corpo();
      if(m[2]==='confirmar')return json(200,await confirmarArmazenagem(pool,ctx,m[1],b));
      const r=await tx(pool,async c=>{
        const t=(await c.query("SELECT * FROM wms_tarefas WHERE id=$1 AND empresa=$2 AND status IN ('pendente','em_execucao') FOR UPDATE",[m[1],ctx.emp])).rows[0];
        if(!t)throw erro(404,'Tarefa aberta não encontrada.');
        // nova sugestão: o endereço atual sai da conta (ex.: o operador encontrou a posição ocupada)
        await c.query('UPDATE wms_tarefas SET sugerido_id=NULL WHERE id=$1',[t.id]);
        const s=await sugerir(c,t.armazem_id,t.lpn_id,t.sugerido_id);
        await c.query("UPDATE wms_tarefas SET sugerido_id=$2,motivo_sugestao=$3,status='em_execucao',iniciado_em=COALESCE(iniciado_em,NOW()),operador=$4 WHERE id=$1",[t.id,s?.id||null,s?.motivo||'',ctx.usuario]);
        if(t.sugerido_id)await auditar(c,ctx,'nova_sugestao','tarefa',t.id,{anterior:t.sugerido_id,nova:s?.codigo||'',motivo:limpo(b.motivo,200)});
        return{ok:true,sugerido:s?.codigo||'',motivo:s?.motivo||''};
      });
      return json(200,r);
    }
    // estoque
    if(p==='/api/wms/saldos'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      const params=[ctx.emp],w=['s.empresa=$1'];
      const f=(k,sql)=>{const v=u.searchParams.get(k);if(v){params.push(v);w.push(sql.replace('?','$'+params.length))}};
      f('armazem_id','s.armazem_id=?::bigint');f('cliente_id','s.cliente_id=?::bigint');f('estado','s.estado=?');
      const q=limpo(u.searchParams.get('q'),80);if(q){params.push(q);w.push(`(p.sku ILIKE '%'||$${params.length}||'%' OR p.descricao ILIKE '%'||$${params.length}||'%' OR p.ean=$${params.length} OR e.codigo=upper($${params.length}) OR lp.codigo=upper($${params.length}) OR l.lote=$${params.length})`)}
      const r=await pool.query(`SELECT s.id::text,c.nome AS cliente,p.sku,p.descricao,p.unidade,l.lote,l.validade::text,e.codigo AS endereco,lp.codigo AS lpn,s.estado,s.qtd::float,s.atualizado_em
        FROM wms_saldos s JOIN wms_produtos p ON p.id=s.produto_id JOIN wms_clientes c ON c.id=s.cliente_id JOIN wms_enderecos e ON e.id=s.endereco_id
        LEFT JOIN wms_lotes l ON l.id=s.lote_id LEFT JOIN wms_lpns lp ON lp.id=s.lpn_id WHERE ${w.join(' AND ')} ORDER BY c.nome,p.sku,l.validade NULLS LAST,e.codigo LIMIT 1000`,params);
      const tot=await pool.query(`SELECT s.estado,SUM(s.qtd)::float AS qtd FROM wms_saldos s JOIN wms_produtos p ON p.id=s.produto_id JOIN wms_enderecos e ON e.id=s.endereco_id
        LEFT JOIN wms_lotes l ON l.id=s.lote_id LEFT JOIN wms_lpns lp ON lp.id=s.lpn_id WHERE ${w.join(' AND ')} GROUP BY s.estado`,params);
      return json(200,{ok:true,rows:r.rows,totais:tot.rows});
    }
    if(p==='/api/wms/consulta'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      return json(200,{ok:true,...await consulta(pool,ctx,u.searchParams.get('codigo'),u.searchParams.get('armazem_id'))});
    }
    if(p==='/api/wms/rastreio'&&M==='GET'){
      const ctx=await contexto(deps,req,'operador');
      return json(200,{ok:true,rows:await rastreio(pool,ctx,u)});
    }
    if(p==='/api/wms/movimentar'&&M==='POST'){
      const ctx=await contexto(deps,req,'operador'),b=await corpo();
      return json(200,await movimentar(pool,ctx,b));
    }
    if(p==='/api/wms/ajuste'&&M==='POST'){
      const ctx=await contexto(deps,req,'ajuste'),b=await corpo();
      return json(200,await ajustar(pool,ctx,b));
    }
    if((p==='/api/wms/bloquear'||p==='/api/wms/desbloquear')&&M==='POST'){
      const ctx=await contexto(deps,req,'supervisor'),b=await corpo();
      return json(200,await mudarEstado(pool,ctx,b,p.endsWith('/bloquear')));
    }
    // fila do aplicativo (offline): cada operação volta com o próprio resultado; nada é sobrescrito
    if(p==='/api/wms/sync'&&M==='POST'){
      const ctx=await contexto(deps,req,'operador'),b=await corpo(8*1024*1024);
      const ops=Array.isArray(b.ops)?b.ops.slice(0,200):[];
      const out=[];
      for(const o of ops){
        const d={...(o.dados||{}),uuid:o.uuid};
        try{
          let r;
          if(o.tipo==='contagem')r=await registrarContagem(pool,ctx,d.recebimento_id,d);
          else if(o.tipo==='armazenagem')r=await confirmarArmazenagem(pool,ctx,d.tarefa_id,d);
          else if(o.tipo==='movimentacao')r=await movimentar(pool,ctx,d);
          else throw erro(400,'Tipo de operação desconhecido.');
          out.push({uuid:o.uuid,ok:true,duplicado:!!r.duplicado,resultado:r});
        }catch(e){out.push({uuid:o.uuid,ok:false,status:e.status||500,code:e.code||'',error:e.status?e.message:'Falha ao aplicar.'});if(!e.status)console.error('WMS SYNC',e)}
      }
      return json(200,{ok:true,resultados:out});
    }
    if(p==='/api/wms/painel'&&M==='GET'){
      const ctx=await contexto(deps,req,'gestao');
      return json(200,{ok:true,...await painel(pool,ctx,u.searchParams.get('armazem_id'))});
    }
    if(p==='/api/wms/auditoria'&&M==='GET'){
      const ctx=await contexto(deps,req,'supervisor');
      const r=await pool.query('SELECT id::text,usuario,acao,entidade,entidade_id,dados,criado_em FROM wms_auditoria WHERE empresa=$1 ORDER BY id DESC LIMIT 300',[ctx.emp]);
      return json(200,{ok:true,rows:r.rows});
    }
    return json(404,{ok:false,error:'Rota do WMS não encontrada.'});
  }catch(e){
    if(!e.status&&e.code==='23514')e.status=409,e.message='Operação recusada pelas regras do estoque (saldo negativo ou valor inválido).';
    if(!e.status)console.error('WMS ERRO',p,e);
    return json(e.status||500,{ok:false,error:e.status?e.message:'Falha no WMS. Tente de novo.',code:e.code&&e.status?e.code:undefined});
  }
}

module.exports={get ATIVO(){return ativo},desligar(){ativo=false},ensureSchema,handle,lerNfe,code128,code128Svg,ranquearEnderecos,cabe,gerarEnderecos,dataIso,num,lerDanfe,lerDanfePdf};
