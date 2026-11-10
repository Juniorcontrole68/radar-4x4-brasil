'use strict';
// Conferência de carga por código de barras das etiquetas dos clientes (a Construlog não imprime etiqueta própria).
//
// Descarga: a carga esperada são os CT-es emitidos no SSW na janela da descarga (padrão: 19:00 da véspera até
// 04:00 do dia), lidos do relatório 174 do BI2 pelo painel (rota /api/conferencia/ssw-esperado). Depois a carga
// inteira é bipada, volumes misturados. Cada etiqueta é reconhecida pelo formato do código e conta para o parceiro:
//   Transbarbosa  14 dígitos começando com 465701, um código por volume
//   Conasid       12 dígitos começando com 001000, um código por volume
//   Leal Dutra    número do pedido (6 dígitos), igual em todos os volumes: só conta
//   Comercial Leal QR de 23 dígitos, um por volume: NF (12) + 0 + 1001 + volume (3) + total (3),
//                 ex.: 00000032643501001013043 = NF 326435, volume 13 de 43 (o texto impresso embaixo é só o começo)
// A etiqueta não traz NF nem CT-e: a conferência fecha por parceiro (esperado = soma dos volumes dos CT-es dele).
// DACTE (chave de 44 dígitos) também pode ser bipado: marca o CT-e como documento conferido, não conta volume.
//
// Carregamento: a carga esperada vem do romaneio de entregas (opção 38 do SSW) ou é montada bipando os DACTEs dos
// CT-es que vão no caminhão (cada DACTE novo entra na carga). Depois os volumes: volume de parceiro sem CT-e na
// carga ou a mais do que os CT-es dizem aparece em vermelho, "NÃO CARREGAR".
//
// Contagem do galpão: a carga esperada são os CT-es disponíveis para entrega na unidade (pendências da opção 38 do
// SSW, ainda sem romaneio). Bipa-se tudo o que está no galpão; fecha por parceiro: o que falta (está no SSW e não foi
// achado) e o que sobra (volume a mais ou de parceiro sem CT-e na unidade).
//
// Motorista: no carregamento, o conferente gera um link exclusivo daquela carga (placa/romaneio) e manda pelo
// WhatsApp. O motorista abre no celular sem login (/conferencia/m/<token>) e só bipa e acompanha: não desfaz
// leitura, não tira nem põe CT-e, não atualiza do SSW, não fecha e não vê outras cargas. O link vale enquanto a
// conferência estiver aberta (até 24 h) e pode ser trocado (o anterior para de funcionar).
//
// Tabelas: conf_formatos (formatos de etiqueta por empresa, editáveis), conf_sessoes, conf_esperado, conf_leituras.
// Testado em tests/conferencia.js.

const crypto = require('crypto');
const limpo = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const semAcento = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const erro = (status, msg, code) => { const e = new Error(msg); e.status = status; if (code) e.code = code; return e; };

const FORMATOS_PADRAO = [
  { nome: 'Transbarbosa', padrao: '^465701\\d{8}$', termos: 'TRANSBARBOSA', por_volume: true },
  { nome: 'Conasid', padrao: '^001000\\d{6}$', termos: 'CONASID', por_volume: true },
  { nome: 'Leal Dutra', padrao: '^\\d{6}$', termos: 'LEAL DUTRA', por_volume: false },
  { nome: 'Comercial Leal', padrao: '^\\d{12}0\\d{10}$', termos: 'COMERCIAL LEAL', por_volume: true },
];
// Formatos que entraram depois: são acrescentados a quem já tinha a lista (se não houver um com o mesmo nome;
// para não usar, o administrador desliga).
const FORMATOS_ACRESCIDOS = ['Comercial Leal'];
const TIPOS = ['descarga', 'carregamento', 'contagem'];

async function ensureSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS conf_formatos (id BIGSERIAL PRIMARY KEY, client_id BIGINT, nome TEXT NOT NULL,
    padrao TEXT NOT NULL, termos TEXT NOT NULL DEFAULT '', por_volume BOOLEAN NOT NULL DEFAULT TRUE, ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ordem INT NOT NULL DEFAULT 0, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS conf_sessoes (id BIGSERIAL PRIMARY KEY, client_id BIGINT, tipo TEXT NOT NULL,
    titulo TEXT NOT NULL DEFAULT '', janela_ini TIMESTAMPTZ, janela_fim TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'aberta',
    criado_por TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), carregado_em TIMESTAMPTZ,
    fechada_em TIMESTAMPTZ, fechada_por TEXT, observacao TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS conf_esperado (id BIGSERIAL PRIMARY KEY, sessao_id BIGINT NOT NULL REFERENCES conf_sessoes(id) ON DELETE CASCADE,
    ctrc TEXT NOT NULL, nf TEXT NOT NULL DEFAULT '', volumes INT NOT NULL DEFAULT 0, chave TEXT NOT NULL DEFAULT '', destinatario TEXT NOT NULL DEFAULT '',
    cidade TEXT NOT NULL DEFAULT '', parceiro TEXT NOT NULL DEFAULT '', nomes TEXT NOT NULL DEFAULT '', emitido_em TIMESTAMPTZ,
    dacte_lido_em TIMESTAMPTZ, UNIQUE (sessao_id, ctrc))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS conf_leituras (id BIGSERIAL PRIMARY KEY, sessao_id BIGINT NOT NULL REFERENCES conf_sessoes(id) ON DELETE CASCADE,
    uuid TEXT, codigo TEXT NOT NULL, tipo TEXT NOT NULL, parceiro TEXT NOT NULL DEFAULT '', ctrc TEXT NOT NULL DEFAULT '',
    situacao TEXT NOT NULL, usuario TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), desfeita_em TIMESTAMPTZ)`);
  // carregamento: modo 'romaneio' (referencia = romaneio do SSW) ou 'ctes' (carga montada pelos DACTEs bipados)
  await pool.query("ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS modo TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS referencia TEXT NOT NULL DEFAULT ''");
  // link do motorista: só o hash do token fica no banco
  await pool.query('ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS motorista_token_hash TEXT');
  await pool.query('ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS motorista_link_em TIMESTAMPTZ');
  await pool.query('ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS motorista_terminou_em TIMESTAMPTZ');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_conf_motorista_token ON conf_sessoes (motorista_token_hash) WHERE motorista_token_hash IS NOT NULL');
  // DACTE do parceiro (Transbarbosa): a chave do CT-e dele, que bipamos no lugar do nosso
  await pool.query("ALTER TABLE conf_esperado ADD COLUMN IF NOT EXISTS chave_parceiro TEXT NOT NULL DEFAULT ''");
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_conf_leitura_uuid ON conf_leituras (sessao_id, uuid) WHERE uuid IS NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_conf_leitura_sessao ON conf_leituras (sessao_id, id)');
}

// ------------------------------------------------------------------ formatos de etiqueta
async function formatos(db, cli) {
  let q = await db.query('SELECT id::text,nome,padrao,termos,por_volume,ativo,ordem FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY ordem,id', [cli]);
  if (!q.rowCount) {
    for (const [i, f] of FORMATOS_PADRAO.entries())
      await db.query('INSERT INTO conf_formatos(client_id,nome,padrao,termos,por_volume,ordem) VALUES($1,$2,$3,$4,$5,$6)', [cli, f.nome, f.padrao, f.termos, f.por_volume, i]);
    q = await db.query('SELECT id::text,nome,padrao,termos,por_volume,ativo,ordem FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY ordem,id', [cli]);
  }
  const faltam = FORMATOS_PADRAO.filter(f => FORMATOS_ACRESCIDOS.includes(f.nome) && !q.rows.some(r => r.nome === f.nome));
  if (faltam.length) {
    let ordem = Math.max(0, ...q.rows.map(r => r.ordem)) + 1;
    for (const f of faltam) await db.query('INSERT INTO conf_formatos(client_id,nome,padrao,termos,por_volume,ordem) VALUES($1,$2,$3,$4,$5,$6)', [cli, f.nome, f.padrao, f.termos, f.por_volume, ordem++]);
    q = await db.query('SELECT id::text,nome,padrao,termos,por_volume,ativo,ordem FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY ordem,id', [cli]);
  }
  return q.rows;
}
function compilar(fs) {
  return fs.filter(f => f.ativo).map(f => {
    let re = null; try { re = new RegExp(f.padrao); } catch { re = null; }
    return { ...f, re, termosN: String(f.termos || '').split(/[,;\n]/).map(semAcento).filter(Boolean) };
  }).filter(f => f.re);
}
async function salvarFormatos(db, cli, lista) {
  if (!Array.isArray(lista) || !lista.length) throw erro(400, 'Informe ao menos um formato de etiqueta.');
  const ok = lista.slice(0, 40).map((f, i) => {
    const nome = limpo(f.nome, 60), padrao = String(f.padrao || '').trim().slice(0, 200);
    if (!nome || !padrao) throw erro(400, 'Cada formato precisa de nome e padrão.');
    try { new RegExp(padrao); } catch { throw erro(400, 'Padrão inválido em "' + nome + '".'); }
    return { nome, padrao, termos: limpo(f.termos, 300), por_volume: f.por_volume !== false, ativo: f.ativo !== false, ordem: i };
  });
  await db.query('DELETE FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1', [cli]);
  for (const f of ok) await db.query('INSERT INTO conf_formatos(client_id,nome,padrao,termos,por_volume,ativo,ordem) VALUES($1,$2,$3,$4,$5,$6,$7)', [cli, f.nome, f.padrao, f.termos, f.por_volume, f.ativo, f.ordem]);
}

// Ensinar etiqueta: a partir de 1 a 10 códigos bipados do mesmo cliente, monta o padrão (regex).
//   prefixo fixo (letras do começo e, se cada caixa tem código próprio, os primeiros dígitos até 6, só o que é comum
//   aos exemplos) + o resto pelo tipo de caractere e pelo tamanho.
//   "Mesmo código em todas as caixas" (número do pedido) muda a cada carga: aí só ficam as letras do começo.
const normCodigo = v => String(v || '').replace(/[\s\r\n\t]+/g, '').toUpperCase().slice(0, 120);
const escRe = v => v.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
function inferirPadrao(exemplos, porVolume = true) {
  const ex = [...new Set((Array.isArray(exemplos) ? exemplos : [exemplos]).map(normCodigo).filter(Boolean))].slice(0, 10);
  if (!ex.length) throw erro(400, 'Bipe ao menos uma etiqueta do cliente.');
  const min = Math.min(...ex.map(e => e.length)), max = Math.max(...ex.map(e => e.length));
  const letras = (ex[0].match(/^[^0-9]*/) || [''])[0];
  let pre;
  if (!porVolume) pre = ex.every(e => e.startsWith(letras)) ? letras : '';
  else if (ex.length === 1) pre = ex[0].slice(0, Math.max(letras.length, Math.min(6, Math.floor(ex[0].length / 2))));
  else {
    pre = ex[0];
    for (const e of ex.slice(1)) { let i = 0; while (i < pre.length && i < e.length && pre[i] === e[i]) i++; pre = pre.slice(0, i); }
    pre = pre.slice(0, Math.min(min - 2, Math.max(letras.length, Math.min(6, Math.floor(min / 2)))));   // volumes da mesma carga têm números seguidos
  }
  const restos = ex.map(e => e.slice(pre.length)).join('');
  const classe = /^\d*$/.test(restos) ? '\\d' : /^[A-Z0-9]*$/.test(restos) ? '[A-Z0-9]' : '\\S';
  const a = min - pre.length, b = max - pre.length;
  const padrao = '^' + escRe(pre) + (b <= 0 ? '' : classe + (a === b ? '{' + a + '}' : '{' + a + ',' + b + '}')) + '$';
  return { padrao, exemplos: ex };
}

// Formato novo ensinado no chão (qualquer usuário com acesso à Conferência). Entra no fim da lista: não muda o que
// já é reconhecido. Depois reaplica nas conferências abertas (leituras "não reconhecida" e CT-es sem parceiro).
async function ensinar(pool, cli, b) {
  const nome = limpo(b.nome, 60);
  if (!nome) throw erro(400, 'Informe o cliente desta etiqueta.');
  const porVolume = b.por_volume !== false;
  const inf = inferirPadrao(b.exemplos, porVolume);
  const padrao = String(b.padrao || inf.padrao).trim().slice(0, 200);
  let re; try { re = new RegExp(padrao); } catch { throw erro(400, 'Padrão inválido.'); }
  const naoBate = inf.exemplos.filter(e => !re.test(e));
  if (naoBate.length) throw erro(400, 'O padrão não reconhece a etiqueta ' + naoBate[0] + '.');
  const fs = compilar(await formatos(pool, cli));
  for (const e of inf.exemplos) {
    const c = classificar(fs, e);
    if (c.tipo === 'volume') throw erro(409, 'A etiqueta ' + e + ' já é reconhecida como ' + c.parceiro + '. Para trocar, o administrador ajusta o formato de ' + c.parceiro + '.');
    if (c.tipo === 'dacte' || c.tipo === 'danfe') throw erro(400, 'Este código é a chave de um ' + c.tipo.toUpperCase() + ', não a etiqueta do cliente.');
  }
  const termos = limpo(b.termos, 300) || semAcento(nome);
  const ordem = Number((await pool.query('SELECT COALESCE(MAX(ordem),0)+1 AS o FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1', [cli])).rows[0].o);
  await pool.query('INSERT INTO conf_formatos(client_id,nome,padrao,termos,por_volume,ordem) VALUES($1,$2,$3,$4,$5,$6)', [cli, nome, padrao, termos, porVolume, ordem]);
  return { padrao, reaplicadas: await reaplicar(pool, cli) };
}

async function reaplicar(pool, cli) {
  const fs = compilar(await formatos(pool, cli));
  const abertas = (await pool.query("SELECT id::text FROM conf_sessoes WHERE client_id IS NOT DISTINCT FROM $1 AND status='aberta' AND criado_em > NOW() - INTERVAL '7 days'", [cli])).rows;
  let n = 0;
  for (const { id } of abertas) {
    for (const e of (await pool.query("SELECT ctrc,nomes FROM conf_esperado WHERE sessao_id=$1 AND parceiro=''", [id])).rows) {
      const p = parceiroDoCte(fs, [e.nomes]);
      if (p) await pool.query('UPDATE conf_esperado SET parceiro=$3 WHERE sessao_id=$1 AND ctrc=$2', [id, e.ctrc, p]);
    }
    for (const l of (await pool.query("SELECT id,codigo,usuario FROM conf_leituras WHERE sessao_id=$1 AND situacao='nao_reconhecido' AND desfeita_em IS NULL ORDER BY id", [id])).rows) {
      if (classificar(fs, l.codigo).tipo !== 'volume') continue;
      await pool.query('UPDATE conf_leituras SET desfeita_em=NOW() WHERE id=$1', [l.id]);
      await ler(pool, cli, { username: l.usuario }, id, { codigo: l.codigo }, null);
      n++;
    }
  }
  return n;
}

// CT-e -> parceiro pelos nomes do relatório (remetente, pagador, tomador...)
function parceiroDoCte(fs, nomes) {
  const txt = semAcento((nomes || []).join(' | '));
  const f = fs.find(x => x.termosN.some(t => txt.includes(t)));
  return f ? f.nome : '';
}

// Código lido -> o que é. Chave de 44 dígitos: DACTE (modelo 57) ou DANFE (55).
function classificar(fs, bruto) {
  const codigo = String(bruto || '').replace(/[\s\r\n\t]+/g, '').toUpperCase().slice(0, 120);
  if (!codigo) return { codigo, tipo: 'vazio' };
  if (/^\d{44}$/.test(codigo)) {
    const modelo = codigo.slice(20, 22);
    if (modelo === '57') return { codigo, tipo: 'dacte' };
    if (modelo === '55') return { codigo, tipo: 'danfe', nf: codigo.slice(25, 34).replace(/^0+/, '') };
  }
  const f = fs.find(x => x.re.test(codigo));
  if (f) return { codigo, tipo: 'volume', parceiro: f.nome, por_volume: f.por_volume };
  return { codigo, tipo: 'desconhecido' };
}

// ------------------------------------------------------------------ janela da descarga
// data = dia da descarga (Brasília). Padrão: 19:00 da véspera até 04:00 do dia.
function janelaDescarga(data, horaIni = '19:00', horaFim = '04:00') {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) ? data : hojeSp();
  const vesp = new Date(new Date(d + 'T12:00:00-03:00').getTime() - 86400000).toISOString().slice(0, 10);
  return { inicio: new Date(vesp + 'T' + horaIni + ':00-03:00'), fim: new Date(d + 'T' + horaFim + ':00-03:00'), data: d };
}
function hojeSp(d = new Date()) { return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }

// ------------------------------------------------------------------ sessões
async function carregarEsperado(pool, cli, sessaoId, rows, { acrescentar = false } = {}) {
  const fs = compilar(await formatos(pool, cli));
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (!acrescentar) await db.query('DELETE FROM conf_esperado WHERE sessao_id=$1', [sessaoId]);
    for (const r of rows || []) {
      const ctrc = limpo(r.ctrc, 20).toUpperCase();
      if (!ctrc) continue;
      const cp = [r.chave_parceiro, ...(Array.isArray(r.ctes_parceiro) ? r.ctes_parceiro : [])].map(c => String(c || '').replace(/\D/g, '')).filter(c => c.length === 44);
      await db.query(`INSERT INTO conf_esperado(sessao_id,ctrc,nf,volumes,chave,destinatario,cidade,parceiro,nomes,emitido_em,chave_parceiro)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (sessao_id,ctrc) DO UPDATE SET chave_parceiro=CASE WHEN conf_esperado.chave_parceiro='' THEN EXCLUDED.chave_parceiro ELSE conf_esperado.chave_parceiro END`,
        [sessaoId, ctrc, limpo(r.nf, 20), Math.max(0, Math.round(Number(r.volumes) || 0)), String(r.chave || '').replace(/\D/g, '').slice(0, 44),
          limpo(r.destinatario, 80), limpo(r.cidade, 60), parceiroDoCte(fs, r.nomes), (r.nomes || []).map(x => limpo(x, 80)).join(' | ').slice(0, 600), r.emitido_em || null, cp[0] || '']);
    }
    await db.query('UPDATE conf_sessoes SET carregado_em=NOW() WHERE id=$1', [sessaoId]);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
}

// lerSsw(rota, corpo): rotas /api/conferencia/<rota> do painel (ssw-esperado, ssw-romaneio, ssw-ctes, ssw-romaneios)
async function criarSessao(pool, cli, user, b, lerSsw) {
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'descarga';
  const teste = Array.isArray(b.rows) && b.testMode;   // testes: carga esperada informada
  const semSsw = () => erro(503, 'A leitura do SSW não está disponível neste servidor.');
  let rows = [], fontes = [], titulo, ini = null, fim = null, modo = '', referencia = '';
  if (tipo === 'contagem') {
    titulo = 'Galpão ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (teste) rows = b.rows;
    else { if (!lerSsw) throw semSsw(); const r = await lerSsw('ssw-galpao', {}); rows = r.rows || []; fontes = r.fontes || []; }
  } else if (tipo === 'descarga') {
    const j = janelaDescarga(b.data, /^\d{2}:\d{2}$/.test(b.hora_inicio || '') ? b.hora_inicio : '19:00', /^\d{2}:\d{2}$/.test(b.hora_fim || '') ? b.hora_fim : '04:00');
    ini = j.inicio; fim = j.fim; titulo = 'Descarga ' + j.data.split('-').reverse().join('/');
    if (teste) rows = b.rows;
    else { if (!lerSsw) throw semSsw(); const r = await lerSsw('ssw-esperado', { inicio: ini.toISOString(), fim: fim.toISOString() }); rows = r.rows || []; fontes = r.fontes || []; }
  } else {
    modo = b.modo === 'ctes' ? 'ctes' : 'romaneio';
    const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (modo === 'romaneio') {
      referencia = limpo(b.romaneio, 20).toUpperCase();
      if (!/^[A-Z]{3}\d+-\d$/.test(referencia)) throw erro(400, 'Escolha o romaneio (ex.: AMR001186-0).');
      let placa = limpo(b.placa, 10).toUpperCase(), motorista = limpo(b.motorista, 60);
      if (teste) rows = b.rows;
      else { if (!lerSsw) throw semSsw(); const r = await lerSsw('ssw-romaneio', { romaneio: referencia, ctes: Number(b.ctes) || 0 }); rows = r.rows || []; fontes = r.fontes || []; placa = placa || limpo(r.placa, 10); }
      if (!rows.length) throw erro(404, 'O SSW não devolveu nenhum CT-e para o romaneio ' + referencia + '.');
      titulo = 'Carregamento ' + referencia + (placa ? ' · ' + placa : '') + (motorista ? ' · ' + motorista.split(' ')[0] : '');
    } else {
      referencia = limpo(b.placa, 10).toUpperCase();
      titulo = 'Carregamento ' + (referencia ? referencia + ' · ' : '') + quando;
      if (teste) rows = b.rows;
    }
  }
  const s = await pool.query('INSERT INTO conf_sessoes(client_id,tipo,titulo,janela_ini,janela_fim,criado_por,modo,referencia) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text',
    [cli, tipo, titulo, ini, fim, limpo(user.username, 80), modo, referencia]);
  const id = s.rows[0].id;
  await carregarEsperado(pool, cli, id, rows);
  return { id, fontes };
}

async function recarregar(pool, cli, id, lerSsw, b = {}) {
  const s = await sessao(pool, cli, id);
  if (s.status !== 'aberta') throw erro(409, 'Conferência já fechada.');
  let rows;
  if (Array.isArray(b.rows) && b.testMode) rows = b.rows;
  else if (!lerSsw) throw erro(503, 'A leitura do SSW não está disponível neste servidor.');
  else if (s.tipo === 'contagem') rows = (await lerSsw('ssw-galpao', {})).rows || [];
  else if (s.tipo === 'descarga') rows = (await lerSsw('ssw-esperado', { inicio: new Date(s.janela_ini).toISOString(), fim: new Date(s.janela_fim).toISOString() })).rows || [];
  else if (s.modo === 'romaneio') rows = (await lerSsw('ssw-romaneio', { romaneio: s.referencia })).rows || [];
  else {
    const chaves = (await pool.query("SELECT CASE WHEN chave<>'' THEN chave ELSE chave_parceiro END AS chave FROM conf_esperado WHERE sessao_id=$1 AND (chave<>'' OR chave_parceiro<>'')", [id])).rows.map(r => r.chave);
    rows = chaves.length ? (await lerSsw('ssw-ctes', { chaves })).rows || [] : [];
  }
  // guarda os DACTEs já lidos
  const lidos = (await pool.query('SELECT ctrc,dacte_lido_em FROM conf_esperado WHERE sessao_id=$1 AND dacte_lido_em IS NOT NULL', [id])).rows;
  await carregarEsperado(pool, cli, id, rows);
  for (const l of lidos) await pool.query('UPDATE conf_esperado SET dacte_lido_em=$3 WHERE sessao_id=$1 AND ctrc=$2', [id, l.ctrc, l.dacte_lido_em]);
}

// carregamento montado pelos DACTEs: tira um CT-e bipado por engano
async function tirarCte(pool, cli, id, ctrc) {
  const s = await sessao(pool, cli, id);
  if (s.status !== 'aberta') throw erro(409, 'Conferência já fechada.');
  if (s.tipo !== 'carregamento') throw erro(400, 'Só no carregamento dá para tirar um CT-e da carga.');
  const q = await pool.query('DELETE FROM conf_esperado WHERE sessao_id=$1 AND ctrc=$2', [id, limpo(ctrc, 20).toUpperCase()]);
  if (!q.rowCount) throw erro(404, 'CT-e não está nesta carga.');
}

async function sessao(db, cli, id) {
  if (!/^\d+$/.test(String(id))) throw erro(404, 'Conferência não encontrada.');
  const q = await db.query('SELECT * FROM conf_sessoes WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2', [id, cli]);
  if (!q.rowCount) throw erro(404, 'Conferência não encontrada.');
  return q.rows[0];
}

// Resumo por parceiro: esperado (volumes dos CT-es), lidos, faltam, a mais, repetidos.
async function resumo(db, cli, id) {
  const s = await sessao(db, cli, id);
  const esp = (await db.query('SELECT ctrc,nf,volumes,chave,destinatario,cidade,parceiro,emitido_em,dacte_lido_em FROM conf_esperado WHERE sessao_id=$1 ORDER BY parceiro,ctrc', [id])).rows;
  const lei = (await db.query(`SELECT parceiro,situacao,COUNT(*)::int AS n FROM conf_leituras WHERE sessao_id=$1 AND desfeita_em IS NULL GROUP BY parceiro,situacao`, [id])).rows;
  const fs = await formatos(db, cli);
  const nomes = [...new Set(fs.filter(f => f.ativo).map(f => f.nome).concat(esp.map(e => e.parceiro).filter(Boolean)).concat(lei.map(l => l.parceiro).filter(Boolean)))];
  const conta = (p, sit) => lei.filter(l => l.parceiro === p && (!sit || sit.includes(l.situacao))).reduce((a, l) => a + l.n, 0);
  const parceiros = nomes.map(p => {
    const ctes = esp.filter(e => e.parceiro === p), esperado = ctes.reduce((a, e) => a + e.volumes, 0);
    const lidos = conta(p, ['ok']), excesso = conta(p, ['excesso', 'sobra']), repetidos = conta(p, ['duplicado']);
    return { parceiro: p, ctes: ctes.length, esperado, lidos, faltam: Math.max(0, esperado - lidos), excesso, repetidos, completo: esperado > 0 && lidos >= esperado };
  }).filter(p => p.ctes || p.lidos || p.excesso || p.repetidos);
  const outros = esp.filter(e => !e.parceiro);
  const t = k => parceiros.reduce((a, p) => a + p[k], 0);
  return {
    sessao: { id: String(s.id), tipo: s.tipo, modo: s.modo || '', referencia: s.referencia || '', titulo: s.titulo, status: s.status, janela_ini: s.janela_ini, janela_fim: s.janela_fim, criado_por: s.criado_por, criado_em: s.criado_em, carregado_em: s.carregado_em, fechada_em: s.fechada_em, fechada_por: s.fechada_por, observacao: s.observacao || '', motorista_link_em: s.motorista_link_em || null, motorista_terminou_em: s.motorista_terminou_em || null },
    parceiros,
    outros: { ctes: outros.length, volumes: outros.reduce((a, e) => a + e.volumes, 0) },
    nao_reconhecidos: conta('', ['nao_reconhecido']),
    totais: { esperado: t('esperado'), lidos: t('lidos'), faltam: t('faltam'), excesso: t('excesso'), repetidos: t('repetidos') },
    esperado: esp,
  };
}

// Uma leitura. Uma de cada vez por conferência (vários coletores na mesma carga não estouram a contagem).
async function ler(pool, cli, user, id, b, lerSsw) {
  // carregamento: DACTE que ainda não está na carga é lido no SSW antes (fora da trava, pode levar alguns segundos)
  let novoCte = null;
  {
    const s0 = await sessao(pool, cli, id);
    const bruto = String(b.codigo || '').replace(/[\s\r\n\t]+/g, '');
    if (!b.motorista && s0.tipo === 'carregamento' && s0.status === 'aberta' && /^\d{44}$/.test(bruto) && bruto.slice(20, 22) === '57') {
      const tem = (await pool.query('SELECT 1 FROM conf_esperado WHERE sessao_id=$1 AND (chave=$2 OR chave_parceiro=$2)', [id, bruto])).rowCount;
      if (!tem) {
        if (b.testMode && b.cte_teste) novoCte = b.cte_teste.chave ? { ...b.cte_teste, chave_parceiro: bruto } : { ...b.cte_teste, chave: bruto };
        else if (lerSsw) { const r = await lerSsw('ssw-ctes', { chaves: [bruto] }); novoCte = (r.rows || [])[0] || null; }
        if (novoCte) {
          const ja = (await pool.query('SELECT 1 FROM conf_esperado WHERE sessao_id=$1 AND ctrc=$2', [id, limpo(novoCte.ctrc, 20).toUpperCase()])).rowCount;
          if (!ja) await carregarEsperado(pool, cli, id, [novoCte], { acrescentar: true });
          else if (novoCte.chave_parceiro) await pool.query("UPDATE conf_esperado SET chave_parceiro=$3 WHERE sessao_id=$1 AND ctrc=$2", [id, limpo(novoCte.ctrc, 20).toUpperCase(), bruto]);
          else await pool.query("UPDATE conf_esperado SET chave=$3 WHERE sessao_id=$1 AND ctrc=$2 AND chave=''", [id, limpo(novoCte.ctrc, 20).toUpperCase(), bruto]);
        }
      }
    }
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['conf-' + id]);
    const s = await sessao(db, cli, id);
    if (s.status !== 'aberta') throw erro(409, 'Esta conferência já foi fechada.', 'FECHADA');
    const uuid = b.uuid ? limpo(b.uuid, 60) : null;
    if (uuid) {
      const ja = await db.query('SELECT situacao,parceiro,ctrc,codigo FROM conf_leituras WHERE sessao_id=$1 AND uuid=$2', [id, uuid]);
      if (ja.rowCount) { await db.query('COMMIT'); return { ...ja.rows[0], repetida_envio: true, ...(await mensagem(db, cli, id, { ...ja.rows[0], tipo: s.tipo })) }; }
    }
    const fs = compilar(await formatos(db, cli));
    const c = classificar(fs, b.codigo);
    if (c.tipo === 'vazio') throw erro(400, 'Código vazio.');
    let situacao = 'nao_reconhecido', parceiro = '', ctrc = '';
    if (c.tipo === 'dacte') {
      const e = (await db.query('SELECT ctrc,parceiro FROM conf_esperado WHERE sessao_id=$1 AND (chave=$2 OR chave_parceiro=$2) ORDER BY (chave=$2) DESC LIMIT 1', [id, c.codigo])).rows[0];
      if (e) { situacao = novoCte ? 'cte_adicionado' : 'dacte'; ctrc = e.ctrc; parceiro = e.parceiro; await db.query('UPDATE conf_esperado SET dacte_lido_em=COALESCE(dacte_lido_em,NOW()) WHERE sessao_id=$1 AND ctrc=$2', [id, e.ctrc]); }
      else situacao = b.motorista ? 'dacte_fora' : s.tipo === 'carregamento' ? 'cte_nao_achado' : 'dacte_parceiro';   // descarga: DACTE de outra transportadora (ex.: Transbarbosa) fica registrado
    } else if (c.tipo === 'danfe') {
      const e = (await db.query("SELECT ctrc,parceiro FROM conf_esperado WHERE sessao_id=$1 AND ltrim(nf,'0')=$2 LIMIT 1", [id, c.nf])).rows[0];
      situacao = e ? 'danfe' : 'danfe_fora'; if (e) { ctrc = e.ctrc; parceiro = e.parceiro; }
    } else if (c.tipo === 'volume') {
      parceiro = c.parceiro;
      const esperado = Number((await db.query('SELECT COALESCE(SUM(volumes),0)::int AS v FROM conf_esperado WHERE sessao_id=$1 AND parceiro=$2', [id, parceiro])).rows[0].v);
      const lidos = Number((await db.query("SELECT COUNT(*)::int AS n FROM conf_leituras WHERE sessao_id=$1 AND parceiro=$2 AND situacao='ok' AND desfeita_em IS NULL", [id, parceiro])).rows[0].n);
      const repetido = c.por_volume && (await db.query("SELECT 1 FROM conf_leituras WHERE sessao_id=$1 AND codigo=$2 AND situacao IN ('ok','excesso','sobra') AND desfeita_em IS NULL LIMIT 1", [id, c.codigo])).rowCount;
      if (repetido) situacao = 'duplicado';
      else if (!esperado) situacao = 'sobra';          // parceiro sem nenhum CT-e nesta carga
      else if (lidos >= esperado) situacao = 'excesso'; // mais volumes do que os CT-es dizem
      else situacao = 'ok';
    }
    const ins = await db.query('INSERT INTO conf_leituras(sessao_id,uuid,codigo,tipo,parceiro,ctrc,situacao,usuario) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text',
      [id, uuid, c.codigo, c.tipo, parceiro, ctrc, situacao, limpo(user.username, 80)]);
    const out = { id: ins.rows[0].id, codigo: c.codigo, tipo: c.tipo, parceiro, ctrc, situacao, ...(await mensagem(db, cli, id, { situacao, parceiro, ctrc, codigo: c.codigo, tipo: s.tipo })) };
    await db.query('COMMIT');
    return out;
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
}
async function mensagem(db, cli, id, l) {
  const r = l.parceiro ? (await resumo(db, cli, id)).parceiros.find(p => p.parceiro === l.parceiro) : null;
  const prog = r ? r.lidos + ' de ' + r.esperado : '';
  const carg = l.tipo === 'carregamento', onde = l.tipo === 'contagem' ? 'no galpão (SSW)' : 'nesta carga';
  const cte = l.ctrc ? (await db.query('SELECT volumes,parceiro FROM conf_esperado WHERE sessao_id=$1 AND ctrc=$2', [id, l.ctrc])).rows[0] : null;
  const M = {
    cte_adicionado: ['info', 'CT-e ' + l.ctrc + ' na carga' + (cte ? ' · ' + cte.volumes + ' volume(s)' + (cte.parceiro ? ' · ' + cte.parceiro : ' · sem etiqueta reconhecida') : '')],
    cte_nao_achado: ['erro', 'CT-e deste DACTE não encontrado no SSW'],
    dacte_fora: ['erro', 'NÃO CARREGAR · este DACTE não é desta carga'],
    ok: [r && r.completo ? 'ok_completo' : 'ok', l.parceiro + ': ' + prog + (r && r.completo ? ' ✓ completo' : '')],
    duplicado: ['alerta', 'Volume já bipado (' + l.parceiro + ')'],
    excesso: ['erro', (carg ? 'NÃO CARREGAR · ' : '') + 'A mais: ' + l.parceiro + ' já tem ' + prog + ' volumes'],
    sobra: ['erro', (carg ? 'NÃO CARREGAR · ' : '') + l.parceiro + ' não tem CT-e ' + onde],
    nao_reconhecido: ['erro', (carg ? 'NÃO CARREGAR · ' : '') + 'Etiqueta não reconhecida'],
    dacte: ['info', 'DACTE ' + l.ctrc + ' conferido'],
    dacte_parceiro: ['info', 'DACTE de outra transportadora registrado'],
    danfe: ['info', 'DANFE do CT-e ' + l.ctrc],
    danfe_fora: ['alerta', 'DANFE de nota que não está ' + onde],
  }[l.situacao] || ['info', l.situacao];
  return { sinal: M[0], mensagem: M[1], progresso: r || null };
}

async function desfazer(pool, cli, user, id, leituraId) {
  const s = await sessao(pool, cli, id);
  if (s.status !== 'aberta') throw erro(409, 'Esta conferência já foi fechada.');
  const q = await pool.query('UPDATE conf_leituras SET desfeita_em=NOW() WHERE id=$1 AND sessao_id=$2 AND desfeita_em IS NULL RETURNING id', [leituraId, id]);
  if (!q.rowCount) throw erro(404, 'Leitura não encontrada.');
}

async function leituras(db, cli, id, limite = 60) {
  await sessao(db, cli, id);
  return (await db.query(`SELECT id::text,codigo,tipo,parceiro,ctrc,situacao,usuario,criado_em FROM conf_leituras WHERE sessao_id=$1 AND desfeita_em IS NULL ORDER BY id DESC LIMIT $2`, [id, limite])).rows;
}

async function fechar(pool, cli, user, id, obs) {
  const q = await pool.query("UPDATE conf_sessoes SET status='fechada',fechada_em=NOW(),fechada_por=$3,observacao=$4 WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2 AND status='aberta' RETURNING id",
    [id, cli, limpo(user.username, 80), limpo(obs, 1000) || null]);
  if (!q.rowCount) throw erro(409, 'Conferência não encontrada ou já fechada.');
}

async function listar(db, cli, tipo) {
  return (await db.query(`SELECT s.id::text,s.tipo,s.modo,s.referencia,s.titulo,s.status,s.criado_por,s.criado_em,s.fechada_em,
      (SELECT COALESCE(SUM(volumes),0)::int FROM conf_esperado e WHERE e.sessao_id=s.id) AS esperado,
      (SELECT COUNT(*)::int FROM conf_leituras l WHERE l.sessao_id=s.id AND l.situacao='ok' AND l.desfeita_em IS NULL) AS lidos
    FROM conf_sessoes s WHERE s.client_id IS NOT DISTINCT FROM $1 AND ($2::text IS NULL OR s.tipo=$2) ORDER BY s.id DESC LIMIT 60`, [cli, TIPOS.includes(tipo) ? tipo : null])).rows;
}

// ------------------------------------------------------------------ link do motorista
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
async function gerarLinkMotorista(pool, cli, id, base) {
  const s = await sessao(pool, cli, id);
  if (s.tipo !== 'carregamento') throw erro(400, 'O link do motorista é só para carregamento.');
  if (s.status !== 'aberta') throw erro(409, 'Conferência já fechada.');
  const token = crypto.randomBytes(24).toString('base64url');
  await pool.query('UPDATE conf_sessoes SET motorista_token_hash=$2,motorista_link_em=NOW(),motorista_terminou_em=NULL WHERE id=$1', [id, hashToken(token)]);
  const link = String(base || '').replace(/\/+$/, '') + '/conferencia/m/' + token;
  const texto = 'Conferência do carregamento ' + (s.referencia || '') + '\n' + s.titulo + '\n\nAbra o link e bipe cada caixa que for colocar no caminhão:\n' + link;
  return { link, whatsapp: 'https://wa.me/?text=' + encodeURIComponent(texto) };
}
async function revogarLinkMotorista(pool, cli, id) {
  await sessao(pool, cli, id);
  await pool.query('UPDATE conf_sessoes SET motorista_token_hash=NULL WHERE id=$1', [id]);
}
// token -> conferência (aberta, link com menos de 24 h)
async function sessaoDoMotorista(pool, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) throw erro(404, 'Link inválido.');
  const q = await pool.query('SELECT * FROM conf_sessoes WHERE motorista_token_hash=$1', [hashToken(token)]);
  if (!q.rowCount) throw erro(404, 'Link inválido ou trocado. Peça um novo link ao conferente.');
  const s = q.rows[0];
  if (s.status !== 'aberta') throw erro(410, 'Esta conferência já foi encerrada.');
  if (s.motorista_link_em && Date.now() - new Date(s.motorista_link_em).getTime() > 24 * 3600 * 1000) throw erro(410, 'Link vencido. Peça um novo link ao conferente.');
  return s;
}
// o que o motorista vê: progresso por parceiro e as próprias leituras (sem dados de outras cargas)
async function resumoMotorista(pool, s) {
  const cli = s.client_id === null ? null : String(s.client_id);
  const r = await resumo(pool, cli, String(s.id));
  const lei = (await pool.query("SELECT codigo,parceiro,situacao,criado_em FROM conf_leituras WHERE sessao_id=$1 AND desfeita_em IS NULL ORDER BY id DESC LIMIT 15", [s.id])).rows;
  return { sessao: { titulo: r.sessao.titulo, referencia: r.sessao.referencia, status: r.sessao.status, terminou_em: s.motorista_terminou_em || null },
    parceiros: r.parceiros, totais: r.totais, nao_reconhecidos: r.nao_reconhecidos, ctes: r.esperado.length, leituras: lei };
}
const LIMITE_MOT = new Map();
function motoristaPermitido(token) {
  const now = Date.now(), k = String(token).slice(0, 16), row = LIMITE_MOT.get(k) || { at: now, n: 0 };
  if (now - row.at > 60000) { row.at = now; row.n = 0; }
  row.n++; LIMITE_MOT.set(k, row); if (LIMITE_MOT.size > 5000) LIMITE_MOT.clear();
  return row.n <= 240;
}
// rotas sem login: página /conferencia/m/<token> e /api/conferencia-motorista/<token>[/leituras|/terminei]
async function handleMotorista(req, res, u, deps) {
  const { pool, sendJson, readJsonBodyLimited, sendHtml, paginaMotorista } = deps;
  let m = u.pathname.match(/^\/conferencia\/m\/([A-Za-z0-9_-]{20,64})\/?$/);
  if (m && req.method === 'GET') return sendHtml(res, paginaMotorista), true;
  m = u.pathname.match(/^\/api\/conferencia-motorista\/([A-Za-z0-9_-]{20,64})(\/leituras|\/terminei)?$/);
  if (!m) return false;
  try {
    if (!motoristaPermitido(m[1])) return sendJson(res, 429, { ok: false, error: 'Muitas leituras em pouco tempo. Aguarde um instante.' }), true;
    const s = await sessaoDoMotorista(pool, m[1]);
    const cli = s.client_id === null ? null : String(s.client_id);
    const quem = { username: 'Motorista' + (s.referencia ? ' ' + s.referencia : '') };
    if (!m[2] && req.method === 'GET') return sendJson(res, 200, { ok: true, ...(await resumoMotorista(pool, s)) }), true;
    if (m[2] === '/leituras' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 4 * 1024);
      const r = await ler(pool, cli, quem, String(s.id), { codigo: b.codigo, uuid: b.uuid, motorista: true }, null);
      return sendJson(res, 200, { ok: true, situacao: r.situacao, parceiro: r.parceiro, sinal: r.sinal, mensagem: r.mensagem, progresso: r.progresso, repetida_envio: !!r.repetida_envio }), true;
    }
    if (m[2] === '/terminei' && req.method === 'POST') {
      await pool.query('UPDATE conf_sessoes SET motorista_terminou_em=NOW() WHERE id=$1', [s.id]);
      return sendJson(res, 200, { ok: true }), true;
    }
    return sendJson(res, 405, { ok: false, error: 'Operação não permitida.' }), true;
  } catch (e) {
    if (!e.status) console.log('CONFERENCIA MOTORISTA ERRO: ' + (e.stack || e.message || e));
    return sendJson(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Falha na conferência.' }), true;
  }
}

// ------------------------------------------------------------------ rotas /api/painel/conferencia*
async function handle(req, res, u, deps) {
  if (u.pathname.startsWith('/conferencia/m/') || u.pathname.startsWith('/api/conferencia-motorista/')) return handleMotorista(req, res, u, deps);
  if (u.pathname !== '/api/painel/conferencia' && !u.pathname.startsWith('/api/painel/conferencia/')) return false;
  const { pool, sendJson, readJsonBodyLimited, dashboardSession, dashboardHas, lerSswDoUsuario, testMode } = deps;
  const p = u.pathname.slice('/api/painel/conferencia'.length) || '/';
  try {
    const user = await dashboardSession(req, false);
    if (!(user.is_admin || dashboardHas(user, 'conferencia') || dashboardHas(user, 'dashboard') || dashboardHas(user, 'agendamentos')))
      return sendJson(res, 403, { ok: false, error: 'Seu usuário não tem acesso à Conferência de carga. Peça a liberação a um administrador.' }), true;
    const cli = user.client_id ? String(user.client_id) : null;
    const lerSsw = lerSswDoUsuario ? lerSswDoUsuario(user) : null;
    let m;
    if (p === '/formatos' && req.method === 'GET') return sendJson(res, 200, { ok: true, formatos: await formatos(pool, cli), pode_editar: !!user.is_admin }), true;
    if (p === '/formatos' && req.method === 'PUT') {
      if (!user.is_admin) return sendJson(res, 403, { ok: false, error: 'Só o administrador muda os formatos de etiqueta.' }), true;
      const b = await readJsonBodyLimited(req, 64 * 1024);
      await salvarFormatos(pool, cli, b.formatos);
      return sendJson(res, 200, { ok: true, formatos: await formatos(pool, cli) }), true;
    }
    if (p === '/formatos/sugerir' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 16 * 1024);
      const inf = inferirPadrao(b.exemplos, b.por_volume !== false);
      const fs = compilar(await formatos(pool, cli));
      return sendJson(res, 200, { ok: true, padrao: inf.padrao, atual: inf.exemplos.map(e => { const c = classificar(fs, e); return { codigo: e, tipo: c.tipo, parceiro: c.parceiro || '' }; }) }), true;
    }
    if (p === '/formatos/ensinar' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 16 * 1024);
      const r = await ensinar(pool, cli, b);
      return sendJson(res, 201, { ok: true, ...r, formatos: await formatos(pool, cli) }), true;
    }
    if (p === '/romaneios' && req.method === 'GET') {
      if (!lerSsw) return sendJson(res, 200, { ok: true, rows: [] }), true;
      return sendJson(res, 200, { ok: true, rows: (await lerSsw('ssw-romaneios', {})).rows || [] }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/link-motorista$/)) && req.method === 'POST')
      return sendJson(res, 200, { ok: true, ...(await gerarLinkMotorista(pool, cli, m[1], deps.publicBase)) }), true;
    if ((m = p.match(/^\/sessoes\/(\d+)\/link-motorista$/)) && req.method === 'DELETE') {
      await revogarLinkMotorista(pool, cli, m[1]);
      return sendJson(res, 200, { ok: true }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/ctes\/([A-Za-z0-9-]+)$/)) && req.method === 'DELETE') {
      await tirarCte(pool, cli, m[1], m[2]);
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])) }), true;
    }
    if (p === '/sessoes' && req.method === 'GET') return sendJson(res, 200, { ok: true, rows: await listar(pool, cli, u.searchParams.get('tipo')), hoje: hojeSp() }), true;
    if (p === '/sessoes' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 2 * 1024 * 1024);
      const r = await criarSessao(pool, cli, user, { ...b, testMode: !!testMode }, lerSsw);
      return sendJson(res, 201, { ok: true, id: r.id, fontes: r.fontes, ...(await resumo(pool, cli, r.id)) }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)$/)) && req.method === 'GET')
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])), leituras: await leituras(pool, cli, m[1]) }), true;
    if ((m = p.match(/^\/sessoes\/(\d+)\/leituras$/)) && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 8 * 1024);
      return sendJson(res, 200, { ok: true, ...(await ler(pool, cli, user, m[1], { ...b, testMode: !!testMode }, lerSsw)) }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/leituras\/(\d+)$/)) && req.method === 'DELETE') {
      await desfazer(pool, cli, user, m[1], m[2]);
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])) }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/recarregar$/)) && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 2 * 1024 * 1024);
      await recarregar(pool, cli, m[1], lerSsw, { ...b, testMode: !!testMode });
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])) }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/fechar$/)) && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 16 * 1024);
      await fechar(pool, cli, user, m[1], b.observacao);
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])) }), true;
    }
    return sendJson(res, 404, { ok: false, error: 'Rota não encontrada.' }), true;
  } catch (e) {
    if (!e.status) console.log('CONFERENCIA ERRO: ' + (e.stack || e.message || e));
    return sendJson(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Falha na conferência: ' + (e.message || e), code: e.code }), true;
  }
}

module.exports = { ensureSchema, handle, classificar, compilar, parceiroDoCte, inferirPadrao, janelaDescarga, FORMATOS_PADRAO, formatos, criarSessao, ler, resumo };
