// Produtos do agendamento (agendamento-produtos.js): itens do XML da NF-e, escolha da chave, ordem SEFAZ -> SSW.
// Sem rede: a SEFAZ e o leitor do SSW são simulados aqui.
const sefaz=require('../sefaz-nfe');
const pr=require('../agendamento-produtos');
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  ok  ',name)}else{fail++;console.log('  FALHA',name,extra)}}

// chave válida (DV conferido) de uma NF de número n
function chave(n){
  const base='3526101234567800019955001'+String(n).padStart(9,'0')+'1'+'12345678';
  const pesos=[2,3,4,5,6,7,8,9];let s=0;
  for(let i=base.length-1,k=0;i>=0;i--,k++)s+=Number(base[i])*pesos[k%8];
  const r=s%11,dv=r<2?0:11-r;
  return base+dv;
}

(async()=>{
  const xml='<nfeProc><NFe><infNFe><det nItem="1"><prod><cProd>1</cProd><xProd>PAPEL KRAFT 80G &amp; CIA</xProd></prod></det>'+
    '<det nItem="2"><prod><xProd>CAIXA PAPELAO 40X30</xProd></prod></det><det nItem="3"><prod><xProd>papel kraft 80g &amp; cia</xProd></prod></det></infNFe></NFe></nfeProc>';
  check('itens do XML sem repetir e com entidades decodificadas',JSON.stringify(pr.itensDaNfe(xml))===JSON.stringify(['PAPEL KRAFT 80G & CIA','CAIXA PAPELAO 40X30']));
  check('formatar junta com ponto e vírgula',pr.formatar(['A','B'])==='A; B');
  const muitos=Array.from({length:40},(_,i)=>'PRODUTO NUMERO '+i+' COM DESCRICAO LONGA');
  const f=pr.formatar(muitos);
  check('formatar respeita 600 caracteres e avisa o que sobrou',f.length<=600&&/\(\+\d+ itens\)$/.test(f),f.length+' '+f.slice(-30));
  check('chave válida no teste',sefaz.chaveValida(chave(112319)));
  check('escolhe a chave do número da NF',pr.chaveDaNf([chave(5),chave(112319)],'112319')===chave(112319));
  check('chave única serve mesmo sem bater o número',pr.chaveDaNf([chave(5)],'9')===chave(5));
  check('várias chaves sem bater: nenhuma',pr.chaveDaNf([chave(5),chave(6)],'9')==='');

  // SEFAZ ligada e liberando o XML
  const orig={configurado:sefaz.configurado,baixarNfe:sefaz.baixarNfe};
  const chamadas=[];
  const ler=async b=>{chamadas.push(b);return b.relacao?{ctrc:'AMS001018-9',produtos:['ITEM DO SSW'],diag:''}:{ctrc:'AMS001018-9',chaves:[chave(112319)]}};
  sefaz.configurado=()=>true;
  sefaz.baixarNfe=async c=>({xml});
  let r=await pr.buscarProdutos({nf:'112319',ctrc:''},ler);
  check('com o XML da SEFAZ: fonte nfe e itens da nota',r.fonte==='nfe'&&r.produto==='PAPEL KRAFT 80G & CIA; CAIXA PAPELAO 40X30',JSON.stringify(r));
  check('com o XML da SEFAZ: não lê a relação do SSW',chamadas.length===1&&!chamadas[0].relacao);

  // SEFAZ recusa (empresa fora da nota): cai na relação do SSW e não pergunta de novo à SEFAZ
  pr._reset();chamadas.length=0;let nSefaz=0;
  sefaz.baixarNfe=async()=>{nSefaz++;const e=new Error('A SEFAZ não encontrou essa nota');e.code='NFE_NAO_ENCONTRADA';throw e};
  r=await pr.buscarProdutos({nf:'112319',ctrc:''},ler);
  check('SEFAZ recusou: usa a relação do SSW',r.fonte==='ssw'&&r.produto==='ITEM DO SSW',JSON.stringify(r));
  await pr.buscarProdutos({nf:'112319',ctrc:''},ler);
  check('chave recusada não volta à SEFAZ em 24 h',nSefaz===1,String(nSefaz));

  // excesso de consultas (656): pausa a SEFAZ
  pr._reset();nSefaz=0;
  sefaz.baixarNfe=async()=>{nSefaz++;const e=new Error('bloqueio');e.code='SEFAZ_LIMITE';throw e};
  await pr.buscarProdutos({nf:'112319',ctrc:''},ler);
  const ler2=async b=>b.relacao?{produtos:[]}:{chaves:[chave(5)]};
  r=await pr.buscarProdutos({nf:'5',ctrc:''},ler2);
  check('SEFAZ em pausa depois do 656 (outra chave nem é consultada)',nSefaz===1&&r.produto===''&&/pausa/.test(r.motivo),JSON.stringify(r));

  // sem certificado: direto para o SSW
  pr._reset();sefaz.configurado=()=>false;nSefaz=0;
  r=await pr.buscarProdutos({nf:'112319',ctrc:''},ler);
  check('sem certificado: relação do SSW',r.fonte==='ssw'&&nSefaz===0);
  r=await pr.buscarProdutos({nf:'1',ctrc:''},async b=>b.relacao?{produtos:[],diag:'SSW sem relação'}:{chaves:[]});
  check('nada encontrado: produto vazio com o motivo',r.produto===''&&/SSW sem relação/.test(r.motivo),JSON.stringify(r));

  // gravação nunca passa por cima do operador
  const qs=[];const db={query:async(sql,p)=>{qs.push({sql,p});return{rowCount:1}}};
  await pr.gravar(db,'7',{produto:'X',fonte:'nfe',ctrc:''});
  check('gravar protege o que o operador digitou',/produto_fonte IS DISTINCT FROM 'operador'/.test(qs[0].sql));
  await pr.gravar(db,'7',{produto:'',motivo:'nada'});
  check('sem produto: só marca a tentativa',/produtos_em=NOW\(\),produtos_erro=\$2/.test(qs[1].sql)&&qs[1].p[1]==='nada');

  // falha na leitura do SSW (ex.: chave interna recusada): não marca nenhuma nota e para a rodada
  const upd=[];const pool={query:async(sql,p)=>{if(/^SELECT/.test(sql.trim()))return{rows:[{id:'1',nf:'10',ctrc:''},{id:'2',nf:'11',ctrc:''}]};upd.push(sql);return{rowCount:1}}};
  let chamadasLer=0;
  const cc=await pr.completarPendentes(pool,async()=>{chamadasLer++;throw new Error('Não autenticado.')},{cli:null});
  check('falha na leitura não marca a nota nem continua a rodada',upd.length===0&&chamadasLer===1&&cc.tentadas===0&&cc.erro==='Não autenticado.',JSON.stringify(cc));
  // o painel só aceita a chave interna nas rotas da lista: a de produtos tem de estar nela
  const fonte=require('fs').readFileSync(require('path').join(__dirname,'..','dashboard','server.js'),'utf8');
  const lista=(fonte.match(/\[('\/api\/agendamentos\/ssw-snapshot'[^\]]*)\]\.includes/)||[])[1]||'';
  check('rota de produtos liberada para a chave interna do servidor',lista.includes("'/api/agendamentos/produtos-ssw'"),lista);
  Object.assign(sefaz,orig);
  console.log('\n'+pass+' ok, '+fail+' falha(s)');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
