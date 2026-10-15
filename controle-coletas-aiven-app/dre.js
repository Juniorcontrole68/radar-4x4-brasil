'use strict';
// Despesas (DRE) do Financeiro: um demonstrativo de resultado por mês, com cada conta no seu lugar.
// Os valores vêm de três fontes, todas separadas por empresa (client_id):
//   manual   = lançado no card (qualquer conta)
//   ssw      = receita de fretes do mês, lida dos CT-es emitidos no SSW (o painel lê e manda aqui)
//   holerite = conta Salários (e FGTS em Encargos), somada dos holerites em PDF enviados no card
//   ssw 475  = despesas lançadas no SSW (opção 475), lidas pelo painel por mês de pagamento; cada evento
//              do SSW vai para uma conta (sugerida pelo nome do evento, ou escolhida no card)
// Testado em tests/dre.js.

// Plano de contas. sinal +1 soma no resultado, -1 subtrai. Os subtotais são calculados na ordem.
const GRUPOS=[
  {id:'receita',nome:'Receita bruta',contas:[
    {id:'receita_fretes',nome:'Receita de fretes (CT-es)',sinal:1,ssw:true},
    {id:'outras_receitas',nome:'Outras receitas operacionais',sinal:1}]},
  {id:'deducoes',nome:'Deduções da receita',contas:[
    {id:'impostos_venda',nome:'Impostos sobre o faturamento (ICMS, PIS, COFINS, ISS)',sinal:-1},
    {id:'cancelamentos',nome:'Cancelamentos e descontos',sinal:-1}]},
  {subtotal:'receita_liquida',nome:'Receita líquida'},
  {id:'custos',nome:'Custos do transporte',contas:[
    {id:'fretes_terceiros',nome:'Fretes pagos a agregados e terceiros',sinal:-1},
    {id:'combustivel',nome:'Combustível',sinal:-1},
    {id:'manutencao',nome:'Manutenção e peças',sinal:-1},
    {id:'pneus',nome:'Pneus',sinal:-1},
    {id:'pedagio',nome:'Pedágios',sinal:-1},
    {id:'seguros',nome:'Seguros (carga e frota)',sinal:-1},
    {id:'ajudantes',nome:'Ajudantes e diárias',sinal:-1}]},
  {subtotal:'lucro_bruto',nome:'Lucro bruto'},
  {id:'pessoal',nome:'Despesas com pessoal',contas:[
    {id:'salarios',nome:'Salários',sinal:-1,holerite:true},
    {id:'encargos',nome:'Encargos (INSS, FGTS)',sinal:-1},
    {id:'beneficios',nome:'Benefícios (VR, VT, plano de saúde)',sinal:-1},
    {id:'pro_labore',nome:'Pró-labore',sinal:-1}]},
  {id:'administrativas',nome:'Despesas administrativas',contas:[
    {id:'aluguel',nome:'Aluguel e condomínio',sinal:-1},
    {id:'utilidades',nome:'Água, energia, telefone e internet',sinal:-1},
    {id:'sistemas',nome:'Sistemas e softwares',sinal:-1},
    {id:'contabilidade',nome:'Contabilidade e jurídico',sinal:-1},
    {id:'adm_outras',nome:'Outras despesas administrativas',sinal:-1}]},
  {id:'comerciais',nome:'Despesas comerciais',contas:[
    {id:'comerciais',nome:'Comissões e marketing',sinal:-1}]},
  {subtotal:'ebitda',nome:'Resultado operacional (EBITDA)'},
  {id:'depreciacao_g',nome:'Depreciação',contas:[
    {id:'depreciacao',nome:'Depreciação de veículos e equipamentos',sinal:-1}]},
  {id:'financeiro',nome:'Resultado financeiro',contas:[
    {id:'receitas_fin',nome:'Receitas financeiras',sinal:1},
    {id:'despesas_fin',nome:'Juros e tarifas bancárias',sinal:-1}]},
  {subtotal:'antes_ir',nome:'Resultado antes do IR e CSLL'},
  {id:'impostos_lucro',nome:'Impostos sobre o lucro',contas:[
    {id:'irpj_csll',nome:'IRPJ e CSLL',sinal:-1}]},
  {subtotal:'lucro_liquido',nome:'Lucro líquido'}
];
const CONTAS=new Map(GRUPOS.flatMap(g=>(g.contas||[]).map(c=>[c.id,{...c,grupo:g.id}])));

const limpo=(v,max=200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const r2=n=>Math.round(Number(n||0)*100)/100;
// Evento do SSW -> conta da DRE. 'ignorar' = não entra na DRE (salário já vem dos holerites;
// parcela de empréstimo/financiamento não é despesa do resultado).
const IGNORAR='ignorar';
const SUGESTOES=[
  [/IRPJ|CSLL/,'irpj_csll'],
  [/INSS|FGTS|\bGPS\b|ENCARGO/,'encargos'],
  [/SALARI|FOLHA|FERIAS|RESCIS|DECIMO|13\s*O?\s*SAL/,IGNORAR],
  [/EMPREST|FINANCIAM|CONSORCIO|LEASING/,IGNORAR],
  [/PRO.?LABORE/,'pro_labore'],
  [/\bVALE\b|\bVR\b|\bVT\b|REFEI|ALIMENTA|PLANO DE SAUDE|UNIMED|CONVENIO|CESTA BASICA|BENEFICIO/,'beneficios'],
  [/COMBUST|DIESEL|GASOL|ETANOL|ARLA|ABASTEC|\bPOSTO\b/,'combustivel'],
  [/PNEU|RECAP|BORRACHAR/,'pneus'],
  [/MANUT|\bPECAS?\b|OFICINA|MECANIC|REVISAO|LUBRIF|\bOLEO\b|FUNILAR/,'manutencao'],
  [/PEDAG|SEM PARAR|CONECTCAR|VELOE/,'pedagio'],
  [/SEGUR|APOLICE|\bRCTR|\bRCF/,'seguros'],
  [/AGREGAD|TERCEIR|CARRETEIRO|\bFRETE|\bCTRB|SUBCONTRAT|REDESPACH/,'fretes_terceiros'],
  [/AJUDANTE|DIARIA|\bCHAPA\b|ESTADIA/,'ajudantes'],
  [/ALUGUE|CONDOMIN|IPTU/,'aluguel'],
  [/ENERGIA|\bLUZ\b|\bAGUA\b|TELEF|INTERNET|CELULAR|SANEAMENTO|\bCPFL\b|SABESP|\bVIVO\b|\bCLARO\b|\bTIM\b/,'utilidades'],
  [/SISTEMA|SOFTWARE|\bSSW\b|LICENC|RASTREA/,'sistemas'],
  [/CONTAB|CONTADOR|ADVOG|JURIDIC|HONORARIO/,'contabilidade'],
  [/JUROS|TARIFA|\bIOF\b|BANCARI/,'despesas_fin'],
  [/ICMS|\bPIS\b|COFINS|\bISS\b|SIMPLES NACIONAL|\bDAS\b/,'impostos_venda'],
  [/COMISS|MARKETING|PUBLICID|PROPAGANDA|BRINDE/,'comerciais']
];
const maiusculo=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
function contaSugerida(evento){const t=maiusculo(evento);for(const[re,c]of SUGESTOES)if(re.test(t))return c;return'adm_outras'}
// "0420 - COMBUSTIVEL" e "420 COMBUSTÍVEL" são o mesmo evento: a chave é o código, ou o nome quando não há código.
function eventoChave(evento){const t=limpo(evento,120),m=t.match(/^0*(\d{1,6})\b/);return m?m[1]:(maiusculo(t)||'SEM EVENTO')}

// "1.704,05" / "R$ 550,00" / "1704.05" / 550 -> número (NaN quando não é número)
function numero(v){
  if(typeof v==='number')return v;
  let s=String(v??'').replace(/R\$/gi,'').replace(/\s/g,'');
  if(!s||s==='-')return NaN;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  else if(/^-?\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  return/^-?\d+(\.\d+)?$/.test(s)?Number(s):NaN
}
// "2026-10", "2026-10-15", "10/2026" -> "2026-10" ('' quando não é mês)
function competencia(v){
  const s=String(v??'').trim();
  let m=s.match(/^(\d{4})-(\d{2})/);
  if(!m){const b=s.match(/^(\d{1,2})\/(\d{4})$/);if(b)m=[0,b[2],b[1].padStart(2,'0')]}
  if(!m)return'';
  const mes=Number(m[2]);
  return mes>=1&&mes<=12&&Number(m[1])>=2000&&Number(m[1])<=2100?m[1]+'-'+String(mes).padStart(2,'0'):''
}

// Monta o demonstrativo do ano: uma linha por conta e por subtotal, com o valor de cada mês e o total.
// valores: [{conta,mes:'2026-10',valor}] (valores positivos; o sinal da conta decide se soma ou subtrai)
function montarDre(ano,valores){
  const meses=Array.from({length:12},(_,i)=>ano+'-'+String(i+1).padStart(2,'0'));
  const por=new Map();
  for(const v of valores||[]){
    if(!CONTAS.has(v.conta)||!meses.includes(v.mes))continue;
    const k=v.conta+'|'+v.mes;por.set(k,r2((por.get(k)||0)+Number(v.valor||0)))
  }
  const acum=meses.map(()=>0),linhas=[];
  const linha=(o,vals)=>linhas.push({...o,meses:vals.map(r2),total:r2(vals.reduce((a,b)=>a+b,0))});
  for(const g of GRUPOS){
    if(g.subtotal){linha({tipo:'subtotal',id:g.subtotal,nome:g.nome},acum);continue}
    const tot=meses.map(()=>0),filhas=[];
    for(const c of g.contas){
      const vals=meses.map(m=>por.get(c.id+'|'+m)||0);
      vals.forEach((x,i)=>{tot[i]+=x;acum[i]+=c.sinal*x});
      filhas.push({c,vals})
    }
    linha({tipo:'grupo',id:g.id,nome:g.nome},tot);
    for(const{c,vals}of filhas)linha({tipo:'conta',id:c.id,nome:c.nome,sinal:c.sinal,grupo:g.id,ssw:!!c.ssw,holerite:!!c.holerite},vals)
  }
  return{ano:Number(ano),meses,linhas}
}

// ---------------------------------------------------------------- holerite em PDF
const DINHEIRO=/-?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g;
const valoresDa=l=>(String(l).match(DINHEIRO)||[]).map(numero);
// Rótulos que aparecem nos cabeçalhos do rodapé do holerite (vários na mesma linha, valores na linha de baixo)
const ROTULOS=[
  ['vencimentos',/total\s+d[eo]s?\s+(vencimentos|proventos)|total\s+(vencimentos|proventos)|total\s+bruto|sal[aá]rio\s+bruto/i],
  ['descontos',/total\s+d[eo]s?\s+descontos|total\s+descontos/i],
  ['liquido',/(valor\s+)?l[ií]quido(\s+a\s+receber)?|l[ií]quido\s+a\s+pagar|total\s+l[ií]quido/i],
  ['salario_base',/sal[aá]rio[\s-]+base|sal\.?\s*base/i],
  ['base_inss',/sal\.?\s*contr\.?\s*inss|base\s+(de\s+)?c[aá]lc(\.|ulo)?\s+(do\s+)?inss|base\s+inss/i],
  ['base_fgts',/base\s+(de\s+)?c[aá]lc(\.|ulo)?\s+(do\s+)?f\.?g\.?t\.?s|base\s+f\.?g\.?t\.?s/i],
  ['fgts',/f\.?g\.?t\.?s\.?\s+(do\s+)?m[eê]s|valor\s+(do\s+)?f\.?g\.?t\.?s|dep[oó]sito\s+f\.?g\.?t\.?s/i],
  ['base_irrf',/base\s+(de\s+)?c[aá]lc(\.|ulo)?\s+(do\s+)?i\.?r\.?r\.?f|base\s+i\.?r\.?r\.?f/i],
  ['faixa_irrf',/faixa\s+i\.?r\.?r\.?f/i]
];
const MESES=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const semAcento=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'');

// Lê os números de um holerite (texto de uma página). Os campos não encontrados ficam null.
function lerHolerite(texto){
  const linhas=String(texto||'').split(/\r?\n/).map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
  const out={funcionario:'',cargo:'',competencia:'',vencimentos:null,descontos:null,liquido:null,salario_base:null,base_inss:null,base_fgts:null,fgts:null,base_irrf:null,inss:null,irrf:null,hora_extra:null,horas_extras:null};
  for(let i=0;i<linhas.length;i++){
    const l=linhas[i];
    // rótulos desta linha, na ordem em que aparecem
    const achados=[];
    for(const[campo,re]of ROTULOS){const m=l.match(re);if(m)achados.push({campo,pos:m.index,fim:m.index+m[0].length})}
    if(!achados.length)continue;
    achados.sort((a,b)=>a.pos-b.pos);
    // descarta rótulos contidos em outro (ex.: "líquido" dentro de "total líquido")
    const rot=achados.filter((a,k)=>!achados.some((b,j)=>j!==k&&b.pos<=a.pos&&b.fim>=a.fim&&(b.fim-b.pos)>(a.fim-a.pos)));
    const depois=rot.map((a,k)=>valoresDa(l.slice(a.fim,k+1<rot.length?rot[k+1].pos:undefined)));
    if(depois.every(v=>v.length)){rot.forEach((a,k)=>{if(out[a.campo]===null)out[a.campo]=depois[k][0]});continue}
    // valores na linha de baixo, um por rótulo, na mesma ordem
    for(let j=i+1;j<=Math.min(i+3,linhas.length-1);j++){
      const vs=valoresDa(linhas[j]);if(!vs.length)continue;
      rot.forEach((a,k)=>{
        if(out[a.campo]!==null)return;
        if(depois[k].length){out[a.campo]=depois[k][0];return}
        const v=vs.length===rot.length?vs[k]:(rot.length===1?vs[vs.length-1]:vs[k]);
        if(v!==undefined)out[a.campo]=v
      });
      break
    }
  }
  // INSS e IRRF descontados: primeira linha de evento com o nome e um valor
  for(const l of linhas){
    if(out.inss===null&&/\bi\.?n\.?s\.?s\b/i.test(l)&&!/base|contr|sal\.|faixa/i.test(l)){const v=valoresDa(l);if(v.length)out.inss=v[v.length-1]}
    if(out.irrf===null&&/\bi\.?r\.?r\.?f\b|imposto\s+de\s+renda/i.test(l)&&!/base|faixa/i.test(l)){const v=valoresDa(l);if(v.length)out.irrf=v[v.length-1]}
  }
  // horas extras: soma das linhas de evento de hora extra (50%, 100%, noturna...). A mesma linha repetida
  // (as duas vias do recibo na página) conta uma vez. Valor = último número; horas = o primeiro, quando há dois.
  const vistasHe=new Set();
  for(const l of linhas){
    if(!/hora?s?\s*extra|\bh\.?\s?e(xtra)?\.?\s*\d{2,3}\s*%|\bextras?\s+\d{2,3}\s*%/i.test(l)||/dsr|d\.s\.r|reflexo|repouso|base|total/i.test(l)||vistasHe.has(l))continue;
    vistasHe.add(l);
    const v=valoresDa(l);if(!v.length)continue;
    out.hora_extra=r2((out.hora_extra||0)+v[v.length-1]);
    const hh=l.match(/\b(\d{1,3}):(\d{2})\b/);
    const horas=hh?Number(hh[1])+Number(hh[2])/60:(v.length>=2?v[0]:null);
    if(horas!==null)out.horas_extras=r2((out.horas_extras||0)+horas)
  }
  // nome do funcionário: na linha do rótulo ou na de baixo (sem códigos, CBO e números)
  const nomeDe=s=>{
    const partes=semAcento(s).replace(/\d[\d./-]*/g,' ').split(/\s{1,}/).filter(Boolean);
    const run=[];let melhor=[];
    for(const p of partes){if(/^[A-Z][A-Z']+$/.test(p)||/^(DA|DE|DO|DAS|DOS|E)$/.test(p))run.push(p);else{if(run.length>melhor.length)melhor=run.slice();run.length=0}}
    if(run.length>melhor.length)melhor=run.slice();
    while(melhor.length&&/^(DA|DE|DO|DAS|DOS|E)$/.test(melhor[melhor.length-1]))melhor.pop();
    return melhor.length>=2?melhor.join(' '):''
  };
  for(let i=0;i<linhas.length&&!out.funcionario;i++){
    const m=linhas[i].match(/(nome\s+do\s+(funcion[aá]rio|empregado|colaborador)|funcion[aá]rio|empregado|colaborador)\s*:?/i);
    if(!m)continue;
    const resto=linhas[i].slice(m.index+m[0].length).replace(/\b(c[oó]digo|cbo|cargo|fun[cç][aã]o|departamento|setor|filial|admiss[aã]o|se[cç][aã]o)\b.*$/i,'');
    out.funcionario=nomeDe(resto.toUpperCase())||nomeDe((linhas[i+1]||'').toUpperCase())
  }
  for(let i=0;i<linhas.length&&!out.cargo;i++){
    const m=linhas[i].match(/\b(cargo|fun[cç][aã]o)\s*:\s*(.+)$/i);
    if(m)out.cargo=limpo(m[2].replace(/\d[\d./-]*/g,' '),80)
  }
  // competência: "Outubro/2026", "Outubro de 2026", "10/2026" perto de "referência", "competência" ou "mês"
  const t=semAcento(linhas.join(' ')).toLowerCase();
  let mm=t.match(new RegExp('('+MESES.join('|')+')\\s*(?:/|de|-)?\\s*(20\\d{2})'));
  if(mm)out.competencia=mm[2]+'-'+String(MESES.indexOf(mm[1])+1).padStart(2,'0');
  else if((mm=t.match(/(?:refer[e]?ncia|competencia|mes(?:\/ano)?|periodo)\s*:?\s*(\d{1,2})\s*\/\s*(20\d{2})/)))out.competencia=competencia(mm[1]+'/'+mm[2]);
  if(out.liquido===null&&out.vencimentos!==null&&out.descontos!==null)out.liquido=r2(out.vencimentos-out.descontos);
  if(out.vencimentos===null&&out.liquido!==null&&out.descontos!==null)out.vencimentos=r2(out.liquido+out.descontos);
  if(out.vencimentos===null&&out.salario_base!==null)out.vencimentos=out.salario_base;
  return out
}

// Texto de cada página do PDF, pelo pdftotext (o mesmo do romaneio; mantém as colunas alinhadas).
function pdftotextPaginas(buf){
  return new Promise((resolve,reject)=>{
    const {spawn}=require('child_process');
    let p;try{p=spawn('pdftotext',['-layout','-enc','UTF-8','-','-'])}catch(e){return reject(e)}
    const out=[],err=[];let fim=false;
    const tm=setTimeout(()=>{if(fim)return;fim=true;p.kill('SIGKILL');reject(new Error('pdftotext demorou demais'))},20000);
    p.on('error',e=>{if(fim)return;fim=true;clearTimeout(tm);reject(e)});
    p.stdout.on('data',d=>out.push(d));p.stderr.on('data',d=>err.push(d));
    p.on('close',code=>{if(fim)return;fim=true;clearTimeout(tm);
      if(code!==0)return reject(new Error(Buffer.concat(err).toString().slice(0,200)||('pdftotext '+code)));
      const pgs=Buffer.concat(out).toString('utf8').split('\f');if(pgs.length>1&&!pgs[pgs.length-1].trim())pgs.pop();resolve(pgs)});
    p.stdin.on('error',()=>{});p.stdin.end(buf)
  })
}
// (o pdf-parse antigo derruba o processo com alguns PDFs: por isso não fica como reserva)
async function paginasDoPdf(buf){
  try{return await pdftotextPaginas(buf)}
  catch(e){throw new Error(e.code==='ENOENT'?'leitor de PDF indisponível no servidor':limpo(e.message,160))}
}
// Holerites de um PDF: um por página (as duas vias iguais da mesma página/arquivo contam uma vez só).
async function holeritesDoPdf(buf){
  const paginas=await paginasDoPdf(buf),out=[],vistos=new Set();
  paginas.forEach((txt,i)=>{
    const h=lerHolerite(txt);
    if(!h.funcionario&&h.vencimentos===null&&h.liquido===null)return;
    const k=h.funcionario+'|'+h.liquido+'|'+h.vencimentos;
    if(vistos.has(k))return;vistos.add(k);
    out.push({...h,pagina:i+1})
  });
  return{paginas:paginas.length,holerites:out}
}

// ---------------------------------------------------------------- banco
async function ensureSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS dre_lancamentos (
    id BIGSERIAL PRIMARY KEY, client_id BIGINT, competencia DATE NOT NULL, conta TEXT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '', valor NUMERIC(14,2) NOT NULL DEFAULT 0, origem TEXT NOT NULL DEFAULT 'manual',
    criado_por TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_dre_lanc_cliente ON dre_lancamentos(client_id,competencia)');
  await pool.query(`CREATE TABLE IF NOT EXISTS dre_holerite_arquivos (
    id BIGSERIAL PRIMARY KEY, client_id BIGINT, nome TEXT NOT NULL DEFAULT '', sha TEXT NOT NULL, pdf BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS dre_holerites (
    id BIGSERIAL PRIMARY KEY, client_id BIGINT, competencia DATE NOT NULL, arquivo_id BIGINT REFERENCES dre_holerite_arquivos(id) ON DELETE SET NULL,
    pagina INT, funcionario TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '',
    vencimentos NUMERIC(14,2), descontos NUMERIC(14,2), liquido NUMERIC(14,2), salario_base NUMERIC(14,2),
    inss NUMERIC(14,2), irrf NUMERIC(14,2), fgts NUMERIC(14,2), competencia_pdf TEXT NOT NULL DEFAULT '',
    criado_por TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  // hora extra só é mostrada no card (não muda a DRE: já está dentro dos vencimentos)
  await pool.query('ALTER TABLE dre_holerites ADD COLUMN IF NOT EXISTS hora_extra NUMERIC(14,2), ADD COLUMN IF NOT EXISTS horas_extras NUMERIC(10,2)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_dre_hol_cliente ON dre_holerites(client_id,competencia)');
  await pool.query(`CREATE TABLE IF NOT EXISTS dre_ssw_despesas (
    id BIGSERIAL PRIMARY KEY, client_id BIGINT, competencia DATE NOT NULL, lancamento TEXT NOT NULL DEFAULT '', data_pgto DATE,
    evento TEXT NOT NULL DEFAULT '', evento_chave TEXT NOT NULL, fornecedor TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    valor NUMERIC(14,2) NOT NULL DEFAULT 0, criado_por TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query("ALTER TABLE dre_ssw_despesas ADD COLUMN IF NOT EXISTS situacao TEXT NOT NULL DEFAULT ''");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_dre_sswd_cliente ON dre_ssw_despesas(client_id,competencia)');
  // Contas a Pagar (contas-a-pagar-v3): a conta lembra de qual lançamento da 475 ela veio
  await pool.query('ALTER TABLE IF EXISTS bills ADD COLUMN IF NOT EXISTS ssw_lancamento TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_bills_ssw_lancamento ON bills(ssw_lancamento)').catch(()=>{});
  await pool.query(`CREATE TABLE IF NOT EXISTS dre_ssw_eventos (
    client_id BIGINT, evento_chave TEXT NOT NULL, conta TEXT NOT NULL, criado_por TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_dre_ssw_eventos ON dre_ssw_eventos(COALESCE(client_id,0),evento_chave)');
}
// Contas a Pagar acompanha a 475: cada lançamento do SSW vira (ou se liga a) uma conta da empresa, e quando
// a 475 mostra a despesa liquidada (paga na 476) a conta fica paga também. Nunca desfaz um pagamento.
// Ligação a uma conta já lançada à mão: mesma quantia, ainda pendente, da empresa e com vencimento até 5 dias de diferença.
const liquidada=s=>/LIQUIDAD|QUITAD|BAIXAD|\bPAG[OA]\b/i.test(String(s||''));
async function sincronizarContas(pool,despesas,hojeIso){
  const out={criadas:0,ligadas:0,liquidadas:0};
  const tem=await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='ssw_lancamento'");
  if(!tem.rowCount)return out;
  const crypto=require('crypto');
  for(const d of despesas){
    const lanc=limpo(d.lancamento,40),valor=r2(Math.abs(numero(d.valor)));
    if(!lanc||!Number.isFinite(valor)||!valor)continue;
    const pago=liquidada(d.situacao),venc=/^\d{4}-\d{2}-\d{2}$/.test(String(d.data||''))?d.data:hojeIso;
    let b=(await pool.query('SELECT id,status FROM bills WHERE ssw_lancamento=$1 LIMIT 1',[lanc])).rows[0];
    if(!b){
      b=(await pool.query("SELECT id,status FROM bills WHERE ssw_lancamento IS NULL AND status='pending' AND amount=$1 AND ABS(due_date-$2::date)<=5 AND lower(translate(area,'ÁáÍí','AaIi')) NOT IN ('pessoal','casa','familia') ORDER BY ABS(due_date-$2::date),created_at LIMIT 1",[valor,venc])).rows[0];
      if(b){await pool.query('UPDATE bills SET ssw_lancamento=$2,updated_at=NOW() WHERE id=$1',[b.id,lanc]);out.ligadas++}
    }
    if(!b){
      const conta=CONTAS.get(contaSugerida(d.evento));
      await pool.query("INSERT INTO bills(id,description,supplier,area,category,amount,due_date,status,payment_date,ssw_lancamento) VALUES($1,$2,$3,'Empresa',$4,$5,$6,$7,$8,$9)",
        [crypto.randomUUID(),limpo((limpo(d.evento,120)||'Despesa')+' (SSW 475 nº '+lanc+')',200),limpo(d.fornecedor,160),conta?conta.nome.slice(0,60):'Outros',valor,venc,pago?'paid':'pending',pago?venc:null,lanc]);
      out.criadas++;if(pago)out.liquidadas++;continue
    }
    if(pago&&b.status!=='paid'){await pool.query("UPDATE bills SET status='paid',payment_date=COALESCE(payment_date,$2),updated_at=NOW() WHERE id=$1",[b.id,venc]);out.liquidadas++}
  }
  return out
}
// Grava a leitura da 475 de um mês: troca as linhas da DRE desse mês e acompanha o Contas a Pagar.
async function gravarDespesasSsw(pool,cli,c,lista,quem,{contas=true}={}){
  const linhas=[];
  for(const x of lista){
    const v=numero(x&&x.valor);if(!Number.isFinite(v)||v===0)continue;
    const ev=limpo(x.evento,120),dt=/^\d{4}-\d{2}-\d{2}$/.test(String(x.data||''))?x.data:null;
    linhas.push([limpo(x.lancamento,40),dt,ev,eventoChave(ev),limpo(x.fornecedor,160),limpo(x.descricao,200),r2(Math.abs(v)),limpo(x.situacao,40)])
  }
  const cn=await pool.connect();
  try{
    await cn.query('BEGIN');
    await cn.query('DELETE FROM dre_ssw_despesas WHERE client_id IS NOT DISTINCT FROM $1 AND competencia=$2',[cli,c+'-01']);
    for(const l of linhas)await cn.query('INSERT INTO dre_ssw_despesas(client_id,competencia,lancamento,data_pgto,evento,evento_chave,fornecedor,descricao,valor,situacao,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[cli,c+'-01',...l,quem]);
    await cn.query('COMMIT')
  }catch(e){await cn.query('ROLLBACK');throw e}finally{cn.release()}
  const hojeIso=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const cp=contas?await sincronizarContas(pool,lista,hojeIso):null;
  return{despesas:linhas.length,total:r2(linhas.reduce((t,l)=>t+l[6],0)),contasPagar:cp}
}
// Leitura automática (servidor principal, fora do modo teste): mês atual e anterior a cada 30 minutos,
// pedida ao painel com a chave interna. Só a CONSTRULOG tem o SSW interno.
function iniciarLeituraAutomatica({pool,buscar,intervaloMs=30*60*1000}){
  const rodar=async()=>{
    try{
      const cq=await pool.query("SELECT id::text FROM movit_clients WHERE lower(slug)='construlog' LIMIT 1").catch(()=>({rows:[]}));
      const cli=cq.rows[0]?.id||null,hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
      const [y,m]=hoje.split('-').map(Number),meses=[[y,m],m===1?[y-1,12]:[y,m-1]];
      for(const[a,mm]of meses){
        const c=a+'-'+String(mm).padStart(2,'0'),fim=new Date(Date.UTC(a,mm,0)).toISOString().slice(0,10);
        const j=await buscar(c+'-01',fim);
        if(!j||!j.ok||!Array.isArray(j.despesas)||!j.despesas.length)continue;
        const g=await gravarDespesasSsw(pool,cli,c,j.despesas,'leitura automática');
        console.log('DRE SSW475 automático: '+JSON.stringify({mes:c,...g}))
      }
    }catch(e){console.error('DRE SSW475 automático ERRO: '+(e.message||e))}
  };
  setTimeout(rodar,90*1000);
  return setInterval(rodar,intervaloMs)
}

// Despesas do SSW somadas por mês e evento, com a conta de cada evento (escolhida no card ou sugerida).
async function despesasSsw(pool,cli,de,ate){
  const q=await pool.query("SELECT to_char(d.competencia,'YYYY-MM') AS mes,d.evento_chave,MIN(d.evento) AS evento,SUM(d.valor)::float8 AS valor,COUNT(*)::int AS n,MIN(e.conta) AS conta FROM dre_ssw_despesas d LEFT JOIN dre_ssw_eventos e ON COALESCE(e.client_id,0)=COALESCE(d.client_id,0) AND e.evento_chave=d.evento_chave WHERE d.client_id IS NOT DISTINCT FROM $1 AND d.competencia BETWEEN $2 AND $3 GROUP BY 1,2 ORDER BY 1,4 DESC",[cli,de,ate]);
  return q.rows.map(r=>({...r,escolhida:!!r.conta,conta:r.conta||contaSugerida(r.evento)}))
}

const LIMITE_ARQUIVOS=30,LIMITE_PDF=8*1024*1024;
const CAMPOS_HOL=['vencimentos','descontos','liquido','salario_base','inss','irrf','fgts','hora_extra','horas_extras'];
const holSel="SELECT id::text,to_char(competencia,'YYYY-MM') AS competencia,arquivo_id::text,pagina,funcionario,cargo,vencimentos::float8,descontos::float8,liquido::float8,salario_base::float8,inss::float8,irrf::float8,fgts::float8,hora_extra::float8,horas_extras::float8,competencia_pdf,created_at FROM dre_holerites";

// Atende as rotas /api/dre*. Devolve true quando a rota era daqui (a resposta já foi enviada).
async function handle(req,res,u,ctx){
  if(u.pathname!=='/api/dre'&&!u.pathname.startsWith('/api/dre/'))return false;
  await atender(req,res,u,ctx);
  return true
}
async function atender(req,res,u,{pool,sendJson,readJsonBodyLimited,dashboardSession,dashboardHas}){
  const p=u.pathname;
  try{
    const user=await dashboardSession(req,false);
    if(!dashboardHas(user,'financeiro'))return sendJson(res,403,{ok:false,error:'Seu usuário não tem acesso ao Financeiro. Peça a liberação a um administrador.'});
    const cli=user.client_id?String(user.client_id):null;
    const quem=limpo(user.username,80);

    if(p==='/api/dre'&&req.method==='GET'){
      const ano=Number(u.searchParams.get('ano'))||Number(new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}).slice(0,4));
      if(ano<2000||ano>2100)return sendJson(res,400,{ok:false,error:'Ano inválido.'});
      const de=ano+'-01-01',ate=ano+'-12-31';
      const lq=await pool.query("SELECT conta,to_char(competencia,'YYYY-MM') AS mes,SUM(valor)::float8 AS valor FROM dre_lancamentos WHERE client_id IS NOT DISTINCT FROM $1 AND competencia BETWEEN $2 AND $3 GROUP BY 1,2",[cli,de,ate]);
      const hq=await pool.query("SELECT to_char(competencia,'YYYY-MM') AS mes,SUM(COALESCE(vencimentos,liquido,0))::float8 AS salarios,SUM(COALESCE(fgts,0))::float8 AS fgts,COUNT(*)::int AS n FROM dre_holerites WHERE client_id IS NOT DISTINCT FROM $1 AND competencia BETWEEN $2 AND $3 GROUP BY 1",[cli,de,ate]);
      const valores=lq.rows.slice();
      for(const h of hq.rows){valores.push({conta:'salarios',mes:h.mes,valor:h.salarios});if(h.fgts)valores.push({conta:'encargos',mes:h.mes,valor:h.fgts})}
      for(const d of await despesasSsw(pool,cli,de,ate))if(CONTAS.has(d.conta))valores.push({conta:d.conta,mes:d.mes,valor:d.valor});
      const dre=montarDre(ano,valores);
      const holerites={};for(const h of hq.rows)holerites[h.mes]=h.n;
      return sendJson(res,200,{ok:true,...dre,holerites,plano:GRUPOS})
    }
    if(p==='/api/dre/mes'&&req.method==='GET'){
      const c=competencia(u.searchParams.get('competencia'));
      if(!c)return sendJson(res,400,{ok:false,error:'Informe o mês.'});
      const lq=await pool.query("SELECT id::text,conta,descricao,valor::float8,origem,criado_por,created_at FROM dre_lancamentos WHERE client_id IS NOT DISTINCT FROM $1 AND competencia=$2 ORDER BY conta,id",[cli,c+'-01']);
      const hq=await pool.query(holSel+' WHERE client_id IS NOT DISTINCT FROM $1 AND competencia=$2 ORDER BY funcionario,id',[cli,c+'-01']);
      const sswDespesas=await despesasSsw(pool,cli,c+'-01',c+'-01');
      return sendJson(res,200,{ok:true,competencia:c,lancamentos:lq.rows,holerites:hq.rows,sswDespesas})
    }
    if(p==='/api/dre/lancamentos'&&req.method==='POST'){
      const b=await readJsonBodyLimited(req,64*1024);
      const c=competencia(b.competencia),conta=String(b.conta||''),valor=numero(b.valor);
      if(!c)return sendJson(res,400,{ok:false,error:'Informe o mês.'});
      if(!CONTAS.has(conta))return sendJson(res,400,{ok:false,error:'Escolha a conta.'});
      if(!Number.isFinite(valor)||valor<=0)return sendJson(res,400,{ok:false,error:'Informe um valor maior que zero.'});
      const q=await pool.query("INSERT INTO dre_lancamentos(client_id,competencia,conta,descricao,valor,origem,criado_por) VALUES($1,$2,$3,$4,$5,'manual',$6) RETURNING id::text",[cli,c+'-01',conta,limpo(b.descricao,200),r2(valor),quem]);
      return sendJson(res,201,{ok:true,id:q.rows[0].id})
    }
    const lm=p.match(/^\/api\/dre\/lancamentos\/(\d+)$/);
    if(lm&&req.method==='DELETE'){
      const q=await pool.query('DELETE FROM dre_lancamentos WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2 RETURNING id',[lm[1],cli]);
      if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Lançamento não encontrado.'});
      return sendJson(res,200,{ok:true})
    }
    // receita de fretes do mês lida do SSW pelo painel: troca a leitura anterior do mesmo mês
    if(p==='/api/dre/ssw'&&req.method==='POST'){
      const b=await readJsonBodyLimited(req,64*1024);
      const c=competencia(b.competencia),valor=numero(b.valor);
      if(!c)return sendJson(res,400,{ok:false,error:'Informe o mês.'});
      if(!Number.isFinite(valor)||valor<0)return sendJson(res,400,{ok:false,error:'Valor do SSW inválido.'});
      const cn=await pool.connect();
      try{
        await cn.query('BEGIN');
        await cn.query("DELETE FROM dre_lancamentos WHERE client_id IS NOT DISTINCT FROM $1 AND competencia=$2 AND conta='receita_fretes' AND origem='ssw'",[cli,c+'-01']);
        if(valor>0)await cn.query("INSERT INTO dre_lancamentos(client_id,competencia,conta,descricao,valor,origem,criado_por) VALUES($1,$2,'receita_fretes',$3,$4,'ssw',$5)",[cli,c+'-01',limpo(b.descricao||'CT-es emitidos no SSW',200),r2(valor),quem]);
        await cn.query('COMMIT')
      }catch(e){await cn.query('ROLLBACK');throw e}finally{cn.release()}
      return sendJson(res,200,{ok:true,valor:r2(valor)})
    }
    // despesas da opção 475 do SSW (mês de pagamento), lidas pelo painel: trocam a leitura anterior do mesmo mês
    if(p==='/api/dre/ssw-despesas'&&req.method==='POST'){
      const b=await readJsonBodyLimited(req,4*1024*1024);
      const c=competencia(b.competencia),lista=Array.isArray(b.despesas)?b.despesas:null;
      if(!c)return sendJson(res,400,{ok:false,error:'Informe o mês.'});
      if(!lista||lista.length>20000)return sendJson(res,400,{ok:false,error:'Lista de despesas inválida.'});
      // o Contas a Pagar não separa empresas: só a casa (CONSTRULOG) acompanha a 475 nele
      const casa=!user.client||String(user.client.slug||'').toLowerCase()==='construlog';
      const g=await gravarDespesasSsw(pool,cli,c,lista,quem,{contas:casa});
      return sendJson(res,200,{ok:true,...g,eventos:await despesasSsw(pool,cli,c+'-01',c+'-01')})
    }
    // conta da DRE escolhida para um evento do SSW (vale para todos os meses)
    if(p==='/api/dre/ssw-eventos'&&req.method==='PUT'){
      const b=await readJsonBodyLimited(req,16*1024);
      const chave=limpo(b.evento_chave,120),conta=String(b.conta||'');
      if(!chave)return sendJson(res,400,{ok:false,error:'Evento inválido.'});
      if(conta!==IGNORAR&&!CONTAS.has(conta))return sendJson(res,400,{ok:false,error:'Escolha a conta.'});
      await pool.query('INSERT INTO dre_ssw_eventos(client_id,evento_chave,conta,criado_por) VALUES($1,$2,$3,$4) ON CONFLICT (COALESCE(client_id,0),evento_chave) DO UPDATE SET conta=EXCLUDED.conta,criado_por=EXCLUDED.criado_por,updated_at=NOW()',[cli,chave,conta,quem]);
      return sendJson(res,200,{ok:true})
    }
    // holerites em PDF: lê cada página e grava um holerite por funcionário
    if(p==='/api/dre/holerites'&&req.method==='POST'){
      const b=await readJsonBodyLimited(req,40*1024*1024);
      const c=competencia(b.competencia);
      if(!c)return sendJson(res,400,{ok:false,error:'Informe o mês dos holerites.'});
      const arqs=Array.isArray(b.arquivos)?b.arquivos.slice(0,LIMITE_ARQUIVOS):[];
      if(!arqs.length)return sendJson(res,400,{ok:false,error:'Escolha os PDFs dos holerites.'});
      const crypto=require('crypto'),resultado=[];
      for(const a of arqs){
        const nome=limpo(a.nome,160)||'holerite.pdf';
        let buf;try{buf=Buffer.from(String(a.base64||'').replace(/^data:[^,]*,/,''),'base64')}catch{buf=Buffer.alloc(0)}
        if(!buf.length||buf.slice(0,5).toString('latin1')!=='%PDF-'){resultado.push({nome,erro:'Não é um PDF.'});continue}
        if(buf.length>LIMITE_PDF){resultado.push({nome,erro:'PDF maior que 8 MB.'});continue}
        const sha=crypto.createHash('sha256').update(buf).digest('hex');
        const ja=await pool.query("SELECT 1 FROM dre_holerites h JOIN dre_holerite_arquivos a ON a.id=h.arquivo_id WHERE a.sha=$1 AND h.client_id IS NOT DISTINCT FROM $2 AND h.competencia=$3 LIMIT 1",[sha,cli,c+'-01']);
        if(ja.rowCount){resultado.push({nome,erro:'Este PDF já foi enviado neste mês.'});continue}
        let lido;try{lido=await holeritesDoPdf(buf)}catch(e){resultado.push({nome,erro:'Não consegui ler o PDF ('+limpo(e.message,120)+').'});continue}
        if(!lido.holerites.length){resultado.push({nome,erro:'Não achei os valores do holerite neste PDF (pode ser um PDF escaneado, sem texto).'});continue}
        const aq=await pool.query('INSERT INTO dre_holerite_arquivos(client_id,nome,sha,pdf) VALUES($1,$2,$3,$4) RETURNING id',[cli,nome,sha,buf]);
        const ids=[];
        for(const h of lido.holerites){
          const q=await pool.query('INSERT INTO dre_holerites(client_id,competencia,arquivo_id,pagina,funcionario,cargo,vencimentos,descontos,liquido,salario_base,inss,irrf,fgts,hora_extra,horas_extras,competencia_pdf,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id::text',
            [cli,c+'-01',aq.rows[0].id,h.pagina,h.funcionario,h.cargo,h.vencimentos,h.descontos,h.liquido,h.salario_base,h.inss,h.irrf,h.fgts,h.hora_extra,h.horas_extras,h.competencia,quem]);
          ids.push(q.rows[0].id)
        }
        resultado.push({nome,holerites:ids.length,outroMes:lido.holerites.some(h=>h.competencia&&h.competencia!==c)})
      }
      return sendJson(res,200,{ok:true,competencia:c,arquivos:resultado})
    }
    const hm=p.match(/^\/api\/dre\/holerites\/(\d+)(\/pdf)?$/);
    if(hm&&hm[2]&&req.method==='GET'){
      const q=await pool.query('SELECT a.nome,a.pdf FROM dre_holerites h JOIN dre_holerite_arquivos a ON a.id=h.arquivo_id WHERE h.id=$1 AND h.client_id IS NOT DISTINCT FROM $2',[hm[1],cli]);
      if(!q.rowCount)return sendJson(res,404,{ok:false,error:'PDF não encontrado.'});
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="'+q.rows[0].nome.replace(/[^\w.\- ]/g,'_')+'"','Cache-Control':'private, no-store'});
      return res.end(q.rows[0].pdf)
    }
    if(hm&&!hm[2]&&req.method==='PATCH'){
      const b=await readJsonBodyLimited(req,64*1024),sets=[],vals=[];
      if(b.funcionario!==undefined){vals.push(limpo(b.funcionario,120).toUpperCase());sets.push('funcionario=$'+vals.length)}
      if(b.cargo!==undefined){vals.push(limpo(b.cargo,80));sets.push('cargo=$'+vals.length)}
      for(const k of CAMPOS_HOL)if(b[k]!==undefined){
        const n=b[k]===null||b[k]===''?null:numero(b[k]);
        if(n!==null&&(!Number.isFinite(n)||n<0))return sendJson(res,400,{ok:false,error:'Valor inválido em '+k+'.'});
        vals.push(n===null?null:r2(n));sets.push(k+'=$'+vals.length)
      }
      if(!sets.length)return sendJson(res,400,{ok:false,error:'Nada para alterar.'});
      vals.push(hm[1],cli);
      const q=await pool.query('UPDATE dre_holerites SET '+sets.join(',')+' WHERE id=$'+(vals.length-1)+' AND client_id IS NOT DISTINCT FROM $'+vals.length+' RETURNING id',vals);
      if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Holerite não encontrado.'});
      return sendJson(res,200,{ok:true})
    }
    if(hm&&!hm[2]&&req.method==='DELETE'){
      const q=await pool.query('DELETE FROM dre_holerites WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2 RETURNING arquivo_id',[hm[1],cli]);
      if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Holerite não encontrado.'});
      // o PDF sai junto quando não sobrou nenhum holerite dele
      if(q.rows[0].arquivo_id)await pool.query('DELETE FROM dre_holerite_arquivos a WHERE a.id=$1 AND NOT EXISTS(SELECT 1 FROM dre_holerites h WHERE h.arquivo_id=a.id)',[q.rows[0].arquivo_id]);
      return sendJson(res,200,{ok:true})
    }
    return sendJson(res,404,{ok:false,error:'Rota não encontrada.'})
  }catch(e){
    return sendJson(res,e.status||500,{ok:false,error:e.status?e.message:'Erro ao processar as despesas: '+limpo(e.message,200)})
  }
}

module.exports={GRUPOS,CONTAS,IGNORAR,liquidada,sincronizarContas,gravarDespesasSsw,iniciarLeituraAutomatica,contaSugerida,eventoChave,numero,competencia,montarDre,lerHolerite,paginasDoPdf,holeritesDoPdf,ensureSchema,handle};
