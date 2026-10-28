// Leitura das despesas lançadas no SSW, opção 475 (Programação de Despesas, programa ssw0094).
// Só CONSULTA: usa o bloco de listagem da tela ("Período de pagamento ... Situação T ... Listar em V")
// e nunca envia os blocos de inclusão ou de alteração de data. A opção 476 (liquidação) não é usada.
'use strict';

function texto(s){
  return String(s||'')
    .replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"')
    .replace(/&ccedil;/gi,'ç').replace(/&atilde;/gi,'ã').replace(/&otilde;/gi,'õ').replace(/&aacute;/gi,'á')
    .replace(/&eacute;/gi,'é').replace(/&iacute;/gi,'í').replace(/&oacute;/gi,'ó').replace(/&uacute;/gi,'ú')
    .replace(/&ecirc;/gi,'ê').replace(/&ocirc;/gi,'ô').replace(/&acirc;/gi,'â').replace(/&deg;|&ordm;/gi,'º')
    .replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim()
}
const attr=(a,n)=>{const m=a.match(new RegExp('\\b'+n+'=["\']([^"\']*)["\']','i'))||a.match(new RegExp('\\b'+n+'=([^\\s>]+)','i'));return m?m[1]:''};
const ddmmaa=iso=>{const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+m[2]+m[1].slice(2):''};

// Campos e botões da tela na ordem em que aparecem. Cada botão ▶ (ajaxEnvia com ação) fecha um bloco.
function blocosDaTela(html){
  const blocos=[],todos=[];let atual=[];
  const re=/<input\b([^>]*)>|ajaxEnvia\(\s*['"]([^'"]*)['"]/gi;
  for(const m of String(html||'').matchAll(re)){
    if(m[1]!==undefined){
      const a=m[1],name=attr(a,'name'),type=attr(a,'type').toLowerCase();
      if(!name||type==='button'||type==='submit')continue;
      const campo={name,value:texto(attr(a,'value')),type,maxlength:Number(attr(a,'maxlength'))||0};
      todos.push(campo);if(type!=='hidden')atual.push(campo)
    }else if(m[2]){blocos.push({act:m[2],campos:atual});atual=[]}
  }
  return{blocos,todos}
}

// Monta o envio da listagem: período de pagamento from..to, situação T (todas), listar em V (vídeo).
// Recusa (sem enviar nada) se não achar com certeza o bloco da listagem.
function envioDaListagem(html,from,to){
  const {blocos,todos}=blocosDaTela(html);
  const bloco=blocos.find(b=>b.campos.some(c=>/^v$/i.test(c.value))&&b.campos.some(c=>/^t$/i.test(c.value))&&b.campos.filter(c=>/^\d{6}$/.test(c.value)).length>=2);
  if(!bloco)return{ok:false,motivo:'Não achei o bloco de listagem (Situação T / Listar em V) na tela da opção 475',blocos:resumo(blocos)};
  const p=new URLSearchParams();
  for(const c of todos)p.set(c.name,c.value);
  const datas=bloco.campos.filter(c=>/^\d{6}$/.test(c.value)).slice(0,2);
  p.set(datas[0].name,ddmmaa(from));p.set(datas[1].name,ddmmaa(to));
  p.set('act',bloco.act);
  return{ok:true,params:p,act:bloco.act,campos:bloco.campos.map(c=>c.name),blocos:resumo(blocos)}
}
const resumo=blocos=>blocos.map(b=>({act:b.act,campos:b.campos.map(c=>c.name+'='+c.value)}));

// ------------------------------------------------------------------ leitura do resultado
// O SSW pode devolver XML (<r><f0>..), tabela HTML, divs posicionadas (left/top) ou texto em <pre>.
function linhasBrutas(body){
  const s=String(body||''),out=[];
  if(/<r\b[^>]*>[\s\S]*?<f\d+/i.test(s)){
    for(const rm of s.matchAll(/<r\b[^>]*>([\s\S]*?)<\/r>/gi)){
      const cel=[];for(const fm of rm[1].matchAll(/<f(\d+)\b[^>]*>([\s\S]*?)<\/f\1>/gi))cel[Number(fm[1])]=texto(fm[2]);
      out.push(Array.from(cel,x=>x||''))
    }
    if(out.length)return out
  }
  if(/<tr\b/i.test(s)){
    for(const tr of s.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)){
      const cel=[...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)].map(m=>texto(m[1]));
      if(cel.filter(Boolean).length>=2)out.push(cel)
    }
    if(out.length)return out
  }
  const divs=[...s.matchAll(/<div\b([^>]*style=["'][^"']*left:\s*(\d+)px[^"']*top:\s*(\d+)px[^"']*["'][^>]*)>([\s\S]*?)<\/div>/gi)];
  if(divs.length>4){
    const porTop=new Map();
    for(const d of divs){const top=Number(d[3]),t=texto(d[4]);if(!t)continue;const k=[...porTop.keys()].find(y=>Math.abs(y-top)<=3)??top;if(!porTop.has(k))porTop.set(k,[]);porTop.get(k).push([Number(d[2]),t])}
    for(const k of [...porTop.keys()].sort((a,b)=>a-b)){const cel=porTop.get(k).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);if(cel.length>=2)out.push(cel)}
    if(out.length)return out
  }
  const pre=(s.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)||[])[1];
  const txt=pre!==undefined?pre.replace(/<[^>]+>/g,''):s.replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|tr)>/gi,'\n').replace(/<[^>]+>/g,' ');
  for(const l of txt.split(/\r?\n/)){const cel=texto(l.replace(/\s{2,}/g,'\u0001')).split('\u0001').map(x=>x.trim()).filter(Boolean);if(cel.length>=2)out.push(cel)}
  return out
}
const RE_VALOR=/^-?R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}-?$|^-?R?\$?\s*\d+,\d{2}-?$/;
const RE_DATA=/\b(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/;
function valor(s){const t=String(s||'').replace(/R\$|\s/g,'');const neg=/^-|-$/.test(t);const n=Number(t.replace(/-/g,'').replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?(neg?-n:n):0}
function dataIso(s){const m=String(s||'').match(RE_DATA);if(!m)return'';const a=m[3].length===2?'20'+m[3]:m[3];return a+'-'+m[2]+'-'+m[1]}
const COLUNAS={
  valor:/^(?:valor|vlr|vl\.?|total|valor\s+(?:a\s+pagar|l[ií]quido|total|do\s+t[ií]tulo))\b/i,
  data:/pagamento|pgto|vencimento|venc\.?|dt\.?\s*pag/i,
  evento:/^evento/i,
  fornecedor:/fornecedor|favorecido|benefici[aá]rio|raz[aã]o|credor/i,
  lancamento:/lan[cç]|^n[º°o.]?\s*$|^n[º°o.]?\s*lan|^lcto|^seq/i,
  descricao:/descri|hist[oó]rico|observ|complemento/i,
  situacao:/situa|status/i
};
const RE_SITUACAO=/LIQUIDAD|QUITAD|BAIXAD|\bPAG[OA]\b|A VENCER|VENCID|PROGRAMAD|ABERT/i;
function despesasDaListagem(body){
  const linhas=linhasBrutas(body);
  let cab=-1,col={};
  for(let i=0;i<linhas.length&&cab<0;i++){
    const c={};linhas[i].forEach((t,j)=>{for(const[k,re]of Object.entries(COLUNAS))if(c[k]===undefined&&re.test(t)&&!RE_VALOR.test(t))c[k]=j});
    if(c.valor!==undefined&&Object.keys(c).length>=2){cab=i;col=c}
  }
  const out=[];
  for(let i=cab+1;i<linhas.length;i++){
    const l=linhas[i],junto=l.join(' ');
    if(/\btotal\b|\bsubtotal\b/i.test(junto))continue;
    let v,d,ev,fo,lc,de,si;
    if(cab>=0){
      v=valor(l[col.valor]);d=dataIso(l[col.data]);ev=l[col.evento]||'';fo=l[col.fornecedor]||'';lc=l[col.lancamento]||'';de=l[col.descricao]||'';si=l[col.situacao]||'';
      if(!RE_VALOR.test(String(l[col.valor]||'').trim()))continue
    }else{
      const vals=l.filter(x=>RE_VALOR.test(x.trim()));if(!vals.length)continue;
      v=valor(vals[vals.length-1]);
      ev=l.find(x=>/^\d{1,5}\s*[-–]?\s*[A-Za-zÀ-ú]/.test(x)&&!RE_DATA.test(x))||'';
      const li=l.findIndex(x=>/^\d{3,10}$/.test(x.trim()));
      lc=li>=0?l[li]:'';si=l.find(x=>RE_SITUACAO.test(x))||'';
      const letras=x=>/[A-Za-zÀ-ú]{3}/.test(x||'')&&!RE_DATA.test(x)&&!RE_VALOR.test(String(x).trim());
      // tela da 475 sem cabeçalho: Filial, Lançamento, Parcela, Evento (código), Descrição, Fornecedor, Histórico, NF, Emissão, Vencimento, Pagamento, Valor
      const ei=ev?-1:l.findIndex((x,i)=>i>li&&li>=0&&/^\d{1,5}$/.test(x.trim())&&letras(l[i+1]));
      if(ei>=0){
        ev=l[ei].trim()+' - '+l[ei+1].trim();
        fo=letras(l[ei+2])?l[ei+2]:'';de=letras(l[ei+3])?l[ei+3]:'';
        const ds=l.filter(x=>RE_DATA.test(x));d=dataIso(ds[ds.length-1]||'');
      }else{
        d=dataIso(l.find(x=>RE_DATA.test(x))||'');
        fo=l.filter(x=>x!==ev&&x!==si&&letras(x)).sort((a,b)=>b.length-a.length)[0]||''
      }
    }
    if(!v)continue;
    out.push({lancamento:String(lc).trim(),data:d,evento:String(ev).trim(),fornecedor:String(fo).trim(),descricao:String(de).trim(),situacao:String(si).trim(),valor:Math.abs(v)})
  }
  return{despesas:out,colunas:cab>=0?linhas[cab]:null,linhas:linhas.length}
}

// Situação da 475 que quer dizer despesa já liquidada (paga) na 476.
const liquidada=s=>/LIQUIDAD|QUITAD|BAIXAD|\bPAG[OA]\b/i.test(String(s||''));
module.exports={liquidada,texto,blocosDaTela,envioDaListagem,linhasBrutas,despesasDaListagem,ddmmaa};
