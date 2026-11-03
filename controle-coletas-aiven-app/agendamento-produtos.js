'use strict';
// Produtos das notas do agendamento: os itens da NF-e, para o operador não precisar digitar.
//
// De onde vêm, nesta ordem:
//   1. XML da NF-e baixado na SEFAZ pela chave (certificado A1 da casa, o mesmo do WMS) -> produto_fonte 'nfe'
//      A chave da NF sai do XML do CT-e no SSW. A SEFAZ só libera a nota quando a empresa do certificado
//      está nela (emitente, destinatária, transportadora ou autXML); senão segue para o passo 2.
//      Nunca registra Ciência da Operação aqui: a transportadora não é a destinatária da nota.
//   2. Relação de produtos do CT-e na opção 101 do SSW -> produto_fonte 'ssw'
// O que o operador digita (produto_fonte 'operador') nunca é trocado.
//
// Usado ao digitar a NF na tela (rota /api/painel/agendamentos/produtos) e por uma rotina em segundo plano
// que completa as notas em aberto aos poucos, para não sobrecarregar o SSW nem a SEFAZ.

const sefaz = require('./sefaz-nfe');

const FONTES_AUTO = ['nfe', 'ssw'];
const FONTES_VISIVEIS = ['operador'].concat(FONTES_AUTO);
const ROTULO_FONTE = { nfe: 'XML da NF-e (SEFAZ)', ssw: 'relação de produtos do SSW', operador: 'digitado pelo operador' };

const limpo = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const so = v => String(v || '').replace(/\D/g, '');
const semZeros = v => so(v).replace(/^0+(?=\d)/, '');
const decodificar = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

// Descrições dos itens (xProd) do XML da NF-e, sem repetir.
function itensDaNfe(xml) {
  const out = [], vistos = new Set();
  for (const m of String(xml || '').matchAll(/<(?:\w+:)?det\b[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/g)) {
    const x = (m[1].match(/<(?:\w+:)?xProd>([\s\S]*?)<\/(?:\w+:)?xProd>/) || [])[1];
    const t = limpo(decodificar(x), 200);
    const k = t.toUpperCase();
    if (t && !vistos.has(k)) { vistos.add(k); out.push(t); }
  }
  return out;
}

// Lista de itens -> texto da coluna Produto (até 600 caracteres; o que não couber vira "+N itens").
function formatar(itens) {
  const lista = (itens || []).map(x => limpo(x, 200)).filter(Boolean);
  let txt = '';
  for (let i = 0; i < lista.length; i++) {
    const resto = lista.length - i - 1;
    const prox = (txt ? txt + '; ' : '') + lista[i];
    if (prox.length > (resto ? 580 : 600)) return txt + ' (+' + (lista.length - i) + ' itens)';
    txt = prox;
  }
  return txt;
}

// Chave da NF-e certa entre as do CT-e: o número da nota fica nas posições 26 a 34 da chave.
function chaveDaNf(chaves, nf) {
  const alvo = semZeros(nf), lista = [...new Set((chaves || []).map(so).filter(c => sefaz.chaveValida(c)))];
  return lista.find(c => semZeros(c.slice(25, 34)) === alvo) || (lista.length === 1 ? lista[0] : '');
}

// A SEFAZ bloqueia por uma hora quem consulta demais (656): enquanto isso, só o SSW.
let SEFAZ_PAUSA_ATE = 0;
const SEFAZ_RECUSADA = new Map();   // chave -> quando a SEFAZ recusou (não pergunta de novo por 24 h)
async function itensDaSefaz(chave) {
  if (!chave || !sefaz.configurado()) return { itens: [], motivo: chave ? 'certificado A1 não configurado' : 'chave da NF-e não encontrada no CT-e' };
  if (Date.now() < SEFAZ_PAUSA_ATE) return { itens: [], motivo: 'SEFAZ em pausa por excesso de consultas' };
  const rec = SEFAZ_RECUSADA.get(chave);
  if (rec && Date.now() - rec.em < 24 * 3600 * 1000) return { itens: [], motivo: rec.motivo };
  try {
    const nota = await sefaz.baixarNfe(chave);
    if (nota.resumo) { SEFAZ_RECUSADA.set(chave, { em: Date.now(), motivo: 'SEFAZ liberou só o resumo da nota' }); return { itens: [], motivo: 'SEFAZ liberou só o resumo da nota' }; }
    const itens = itensDaNfe(nota.xml);
    return { itens, motivo: itens.length ? '' : 'XML da NF-e sem itens' };
  } catch (e) {
    const motivo = limpo('SEFAZ: ' + (e.message || e), 200);
    if (e.code === 'SEFAZ_LIMITE') SEFAZ_PAUSA_ATE = Date.now() + 65 * 60 * 1000;
    else SEFAZ_RECUSADA.set(chave, { em: Date.now(), motivo });
    if (SEFAZ_RECUSADA.size > 5000) SEFAZ_RECUSADA.clear();
    return { itens: [], motivo };
  }
}

// lerSsw({nf, ctrc, relacao}) -> {ctrc, chaves, produtos, diag} (painel: rota /api/agendamentos/produtos-ssw)
async function buscarProdutos({ nf, ctrc }, lerSsw) {
  if (!lerSsw) return { produto: '', fonte: '', motivo: 'leitura do SSW indisponível' };
  const motivos = [];
  const base = await lerSsw({ nf, ctrc, relacao: false });
  const chave = chaveDaNf(base.chaves, nf);
  const s = await itensDaSefaz(chave);
  if (s.itens.length) return { produto: formatar(s.itens), fonte: 'nfe', chave, ctrc: base.ctrc || ctrc || '', itens: s.itens };
  if (s.motivo) motivos.push(s.motivo);
  const r = await lerSsw({ nf, ctrc: base.ctrc || ctrc, relacao: true });
  if (r.produtos && r.produtos.length) return { produto: formatar(r.produtos), fonte: 'ssw', chave, ctrc: r.ctrc || base.ctrc || ctrc || '', itens: r.produtos };
  motivos.push(r.diag || 'SSW sem relação de produtos');
  return { produto: '', fonte: '', chave, ctrc: base.ctrc || ctrc || '', motivo: limpo(motivos.join(' | '), 300) };
}

// Grava na nota (nunca por cima do que o operador digitou). Sem resultado, só marca a tentativa.
async function gravar(db, notaId, r) {
  if (r && r.produto) {
    await db.query(`UPDATE ag_notas SET produto=$2,produto_fonte=$3,produtos_em=NOW(),produtos_erro=NULL,
        ctrc=CASE WHEN ctrc='' AND $4<>'' THEN $4 ELSE ctrc END
      WHERE id=$1 AND produto_fonte IS DISTINCT FROM 'operador'`, [notaId, r.produto, r.fonte, r.ctrc || '']);
  } else {
    await db.query('UPDATE ag_notas SET produtos_em=NOW(),produtos_erro=$2 WHERE id=$1', [notaId, limpo(r && r.motivo || 'sem produtos', 300)]);
  }
}

// Segundo plano: a cada 2 minutos completa até 10 notas em aberto sem produto (a mais nova primeiro).
// Nota sem resultado só é tentada de novo depois de 24 h.
async function completarPendentes(pool, lerSsw, { cli = null, limite = 10, situacoes = ['pendente', 'em_rota', 'verificar'] } = {}) {
  const q = await pool.query(`SELECT id::text AS id,nf,ctrc FROM ag_notas
    WHERE client_id IS NOT DISTINCT FROM $4 AND tipo_operacao='entrega' AND situacao=ANY($1) AND (produto_fonte IS NULL OR produto_fonte<>ALL($2))
      AND (produtos_em IS NULL OR produtos_em<NOW()-INTERVAL '24 hours')
    ORDER BY produtos_em NULLS FIRST, id DESC LIMIT $3`, [situacoes, FONTES_VISIVEIS, limite, cli]);
  const c = { tentadas: 0, nfe: 0, ssw: 0, sem: 0 };
  for (const n of q.rows) {
    c.tentadas++;
    let r;
    // falha na leitura (painel fora do ar, sessão do SSW, chave interna): não marca a nota, para na rodada
    try { r = await buscarProdutos(n, lerSsw); } catch (e) { c.tentadas--; c.erro = limpo(e.message || e, 200); break; }
    await gravar(pool, n.id, r);
    if (!r.produto && !c.motivo) c.motivo = r.motivo;
    if (r.produto) c[r.fonte]++; else c.sem++;
  }
  if (c.tentadas || c.erro) console.log('AGENDAMENTO produtos: ' + JSON.stringify(c));
  return c;
}
// clientes(): empresas que leem o SSW da casa (as da demonstração não entram)
function iniciarProdutos({ pool, lerSsw, situacoes, clientes }) {
  let rodando = false;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try { for (const cli of await clientes()) await completarPendentes(pool, lerSsw, { cli, situacoes }); } catch (e) { console.log('AGENDAMENTO produtos ERRO: ' + (e.message || e)); } finally { rodando = false; }
  };
  setTimeout(tick, 3 * 60 * 1000);
  return setInterval(tick, 2 * 60 * 1000);
}

module.exports = { FONTES_AUTO, FONTES_VISIVEIS, ROTULO_FONTE, itensDaNfe, formatar, chaveDaNf, buscarProdutos, gravar, completarPendentes, iniciarProdutos,
  _reset() { SEFAZ_PAUSA_ATE = 0; SEFAZ_RECUSADA.clear(); } };
