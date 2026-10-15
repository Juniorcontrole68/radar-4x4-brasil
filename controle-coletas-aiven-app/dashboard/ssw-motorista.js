'use strict';
// Endereço da casa do motorista no cadastro de motoristas do SSW (opção 028).
// Só funções de leitura, sem rede: quem abre a tela é o server.js. Testado em tests/ssw-motorista.js.
//
// O formulário é lido do próprio HTML (nome dos campos não é fixo): procura o campo do CPF e,
// se houver, o do nome. A tela do cadastro traz os dados dentro de campos <input value="...">
// ao lado do rótulo ("Endereço:", "Bairro:", "CEP:", "Cidade:"), então o texto da tela é montado
// com o valor de cada campo no lugar dele antes de procurar os rótulos.

// Acentos que o SSW escreve como entidade (&ccedil; &uacute; &atilde; ...).
const ENT={aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',agrave:'à',acirc:'â',ecirc:'ê',ocirc:'ô',atilde:'ã',otilde:'õ',ccedil:'ç',
  Aacute:'Á',Eacute:'É',Iacute:'Í',Oacute:'Ó',Uacute:'Ú',Agrave:'À',Acirc:'Â',Ecirc:'Ê',Ocirc:'Ô',Atilde:'Ã',Otilde:'Õ',Ccedil:'Ç',ordm:'º',deg:'°'};
function txt(s){
  let x=String(s||'').replace(/&([a-zA-Z]+);/g,(t,n)=>ENT[n]||t).replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'");
  x=x.replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&');
  return x.replace(/\s+/g,' ').trim()
}
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const attr=(a,n)=>((a.match(new RegExp('\\b'+n+'=["\']([^"\']*)["\']','i'))||a.match(new RegExp('\\b'+n+'=([^\\s>]+)','i'))||[])[1]||'');

// Campos de texto do formulário, cada um com o rótulo que vem logo antes dele na tela.
function camposForm(html){
  const s=String(html||''),out=[];
  const re=/<input\b([^>]*)>/gi;let m,ultimo=0;
  while((m=re.exec(s))){
    const a=m[1]||'',type=(attr(a,'type')||'text').toLowerCase();
    const rotulo=norm(txt(s.slice(Math.max(ultimo,m.index-300),m.index))).replace(/[:\s]+$/,'').slice(-40);
    ultimo=m.index+m[0].length;
    const name=attr(a,'name');if(!name)continue;
    out.push({name,type,id:attr(a,'id'),max:Number(attr(a,'maxlength'))||0,value:attr(a,'value'),rotulo})
  }
  return out
}
// Qual campo recebe o CPF e qual recebe o nome (quando a tela deixa procurar por nome).
function camposBusca(html){
  const c=camposForm(html).filter(x=>/^(text|tel|number|)$/.test(x.type));
  const cpf=c.find(x=>/CPF/.test(x.rotulo)||/cpf/i.test(x.name)||/cpf/i.test(x.id))||c.find(x=>x.max===11||x.max===14)||null;
  const nome=c.find(x=>x!==cpf&&(/\bNOME\b|MOTORISTA/.test(x.rotulo)||/nome/i.test(x.name)))||null;
  return{cpf:cpf?cpf.name:'',nome:nome?nome.name:''}
}
// Ação que o botão de pesquisa dispara (ajaxEnvia('P1',...) / act.value='P1'); P1 quando não achar.
function acaoBusca(html){
  const s=String(html||'');
  const m=s.match(/ajaxEnvia\(\s*['"]([A-Z0-9]{1,6})['"]/i)||s.match(/\bact\.value\s*=\s*['"]([A-Z0-9]{1,6})['"]/i);
  return m?m[1]:'P1'
}
// Texto da tela com o valor de cada <input> no lugar do campo.
function textoComValores(html){
  const s=String(html||'').replace(/<input\b([^>]*)>/gi,(_,a)=>{
    const type=(attr(a,'type')||'text').toLowerCase();
    if(/^(hidden|button|submit|checkbox|radio|password)$/.test(type))return' ';
    return' '+attr(a,'value').replace(/[<>]/g,' ')+' '
  });
  return txt(s)
}
const ROTULOS=/(ENDERECO|LOGRADOURO|NUMERO|NRO|N[º°O]\.?|COMPLEMENTO|BAIRRO|CEP|CIDADE|MUNICIPIO|UF|FONE|TELEFONE|CELULAR|E-?MAIL|CPF|RG|CNH|NOME|PLACA|SITUACAO|NASCIMENTO)\s*:/g;
// Lê o endereço do cadastro. Devolve null se a tela não tem endereço.
function parseCadastro(html){
  const t=norm(textoComValores(html));
  const pega=(...nomes)=>{
    for(const n of nomes){
      const re=new RegExp('(?:^|\\s)'+n+'\\s*:\\s*','g');const m=re.exec(t);if(!m)continue;
      const resto=t.slice(m.index+m[0].length);ROTULOS.lastIndex=0;
      const prox=ROTULOS.exec(resto);
      const v=(prox?resto.slice(0,prox.index):resto.slice(0,120)).trim();
      if(v)return v.slice(0,160)
    }
    return''
  };
  let endereco=pega('ENDERECO','LOGRADOURO'),numero=pega('NUMERO','NRO','N[º°O]\\.?');
  const bairro=pega('BAIRRO'),cep=pega('CEP').replace(/\D/g,'').slice(0,8);
  let cidade=pega('CIDADE','MUNICIPIO'),uf=pega('UF');
  // "AMERICANA / SP", "AMERICANA-SP"
  const cu=cidade.match(/^(.*?)\s*[\/-]\s*([A-Z]{2})$/);if(cu){cidade=cu[1].trim();uf=uf||cu[2]}
  uf=(uf.match(/\b[A-Z]{2}\b/)||[''])[0];
  // "RUA DAS FLORES, 120" no mesmo campo
  if(!numero){const en=endereco.match(/^(.*?)[,\s]+(\d{1,6}[A-Z]?)$/);if(en){endereco=en[1].trim();numero=en[2]}}
  if(!endereco&&!cep)return null;
  return{endereco,numero:numero.replace(/[^0-9A-Z\-\/]/g,'').slice(0,20),bairro,cidade,uf,cep,nome:pega('NOME')}
}
// Tela de lista (pesquisa por nome com mais de um resultado): links/linhas com CPF e nome.
function parseLista(html){
  const t=norm(txt(html)),out=[];
  for(const m of t.matchAll(/(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\s+([A-Z][A-Z .'-]{3,80}?)(?=\s+\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\s*$|\s{2})/g))out.push({cpf:m[1].replace(/\D/g,''),nome:m[2].trim()});
  return out
}
// Mesmo nome sem acento, caixa e espaços extras; aceita o nome digitado sem o último sobrenome.
function mesmoNome(a,b){
  const x=norm(a).replace(/[^A-Z ]/g,''),y=norm(b).replace(/[^A-Z ]/g,'');
  if(!x||!y)return false;
  return x===y||(x.length>=8&&y.startsWith(x+' '))||(y.length>=8&&x.startsWith(y+' '))
}

module.exports={camposForm,camposBusca,acaoBusca,textoComValores,parseCadastro,parseLista,mesmoNome};
