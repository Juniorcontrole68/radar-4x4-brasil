'use strict';
// Produtos de uma nota fiscal (descrição dos itens, a mesma do DANFE), para o agendamento de entregas.
// Ordem: 1º o que já está em nf_materiais (XMLs importados ou lidos antes); 2º o XML da NF-e na SEFAZ pela
// chave, com o certificado A1 da casa (a Construlog é a transportadora da nota); 3º o XML ou o DANFE em PDF
// que o SSW guarda do CT-e (o painel baixa e manda aqui). O que for lido fica gravado em nf_materiais.
// Rota: POST /api/painel/nf-materiais/produtos (server.js). Testado em tests/agendamento.js.
const sefaz = require('./sefaz-nfe');
const wms = require('./wms');

const so = v => String(v ?? '').replace(/\D/g, '');
// a SEFAZ bloqueia quem repete a mesma chave muitas vezes: chave que falhou espera 6 h para tentar de novo
const FALHAS = new Map();
const ESPERA_FALHA = 6 * 3600e3;

function classificar(produtos) {
  const t = produtos.join(' | ').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const tubo = /\bTUBOS?\b|\bTUBULACAO\b/.test(t), caixa = /\bCAIXAS?\s+(?:D\s*'?\s*|DE\s+)?AGUA\b|\bRESERVATORIOS?\b/.test(t);
  return tubo && caixa ? 'tubos_caixa_agua' : tubo ? 'tubos' : caixa ? 'caixa_agua' : 'normal';
}
function descricoes(nfe) {
  const out = [], vistos = new Set();
  for (const i of nfe.itens || []) {
    const d = String(i.descricao || '').replace(/\s+/g, ' ').trim();
    if (d && !vistos.has(d.toUpperCase())) { vistos.add(d.toUpperCase()); out.push(d); }
  }
  return out.slice(0, 250);
}
async function gravar(pool, nfe, produtos) {
  await pool.query(`INSERT INTO nf_materiais (chave,nf,emitente_cnpj,emitente_nome,cliente,classificacao,produtos,atualizado_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
    ON CONFLICT (chave) DO UPDATE SET produtos=EXCLUDED.produtos,atualizado_em=NOW(),
      classificacao=CASE WHEN nf_materiais.classificacao='normal' THEN EXCLUDED.classificacao ELSE nf_materiais.classificacao END`,
  [nfe.chave, String(nfe.numero || '').replace(/^0+/, '') || so(nfe.chave).slice(25, 34).replace(/^0+/, ''), nfe.emitente?.cnpj || '', nfe.emitente?.nome || '',
    nfe.destinatario?.nome || '', classificar(produtos), JSON.stringify(produtos)]);
}

// body: {chaves:[...], xml?:'<nfeProc ...>', pdf_base64?:'...'} -> {ok, produtos:[...], fonte, chave, avisos:[...]}
async function produtos(pool, body) {
  const chaves = [...new Set((Array.isArray(body.chaves) ? body.chaves : []).map(so).filter(sefaz.chaveValida))].slice(0, 5);
  const avisos = [];
  if (chaves.length) {
    const q = await pool.query("SELECT chave,produtos FROM nf_materiais WHERE chave=ANY($1) AND jsonb_array_length(produtos)>0", [chaves]);
    const lista = q.rows.flatMap(r => r.produtos || []);
    if (lista.length) return { ok: true, produtos: [...new Set(lista)], fonte: 'xml', chave: q.rows[0].chave, avisos };
  }
  if (chaves.length && sefaz.configurado()) {
    for (const chave of chaves) {
      const f = FALHAS.get(chave);
      if (f && Date.now() - f.em < ESPERA_FALHA) { avisos.push('SEFAZ (' + chave.slice(25, 34).replace(/^0+/, '') + '): ' + f.msg); continue; }
      try {
        const r = await sefaz.baixarNfe(chave);
        if (r.resumo) throw new Error('a SEFAZ só liberou o resumo da nota');
        const nfe = wms.lerNfe(r.xml), lista = descricoes(nfe);
        if (lista.length) { await gravar(pool, nfe, lista); FALHAS.delete(chave); return { ok: true, produtos: lista, fonte: 'nfe', chave, avisos }; }
      } catch (e) {
        const msg = String(e.message || e).slice(0, 200);
        FALHAS.set(chave, { em: Date.now(), msg });
        if (FALHAS.size > 5000) FALHAS.delete(FALHAS.keys().next().value);
        avisos.push('SEFAZ: ' + msg);
        if (e.code === 'SEFAZ_LIMITE') break;
      }
    }
  } else if (chaves.length) avisos.push('SEFAZ desligada (falta o certificado A1)');
  // o que o SSW guarda da nota (o painel baixou na opção 101)
  try {
    let nfe = null;
    if (body.xml && /<(?:\w+:)?infNFe\b/.test(String(body.xml))) nfe = wms.lerNfe(String(body.xml));
    else if (body.pdf_base64) nfe = await wms.lerDanfePdf(String(body.pdf_base64));
    const lista = nfe ? descricoes(nfe) : [];
    if (lista.length) { if (sefaz.chaveValida(nfe.chave)) await gravar(pool, nfe, lista); return { ok: true, produtos: lista, fonte: body.xml ? 'ssw_xml' : 'danfe', chave: nfe.chave || '', avisos }; }
  } catch (e) { avisos.push('SSW: ' + String(e.message || e).slice(0, 200)); }
  return { ok: true, produtos: [], fonte: '', chave: chaves[0] || '', avisos };
}

module.exports = { produtos, classificar, _falhas: FALHAS };
