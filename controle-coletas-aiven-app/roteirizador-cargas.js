'use strict';
// Roteirizador de Cargas: substitui o "Roteirizador Teste" e o "Roteirizador V02" do portal.
// A página (roteirizador-cargas.html) guarda seus dados como documentos JSON por caminho
// ("cad/main/cidades/3509502", "op/main/notas/<chave>"), no mesmo formato em que foi criada.
// Este módulo é o banco desses documentos, separado por cliente da plataforma.
//   cad/...  cadastros (veículos, motoristas, cidades, ajustes): só administrador grava
//   op/...   operação (notas, planos, sobras, disponibilidade): quem tem acesso ao roteirizador grava
// A página consulta /api/rc/mudancas a cada poucos segundos para ver o que outros usuários gravaram.
// Testado em tests/roteirizador-cargas.js.

const fs = require('fs');
const path = require('path');

const PERM = 'roteirizador';
const MAX_DOC = 900 * 1024;
const SEED_FILE = path.join(__dirname, 'roteirizador-cargas.seed.json');
const BOOT = Date.now().toString(36);
const PAGE_FILE = path.join(__dirname, 'roteirizador-cargas.html');
// versão publicada da página (meta rc-versao gravada pelo build); a página compara para avisar que há versão nova
let versaoCache = { mtime: 0, v: '' };
function versaoPagina() {
  try {
    const st = fs.statSync(PAGE_FILE);
    if (st.mtimeMs !== versaoCache.mtime) {
      const head = fs.readFileSync(PAGE_FILE, 'utf8').slice(0, 2000);
      versaoCache = { mtime: st.mtimeMs, v: ((head.match(/name="rc-versao" content="([^"]+)"/) || [])[1]) || '' };
    }
  } catch { /* sem arquivo */ }
  return versaoCache.v;
}

// caminho de documento: segmentos alternados coleção/documento, número par de segmentos
function caminhoValido(p) {
  const s = String(p || '');
  if (s.length > 600) return false;
  const seg = s.split('/');
  if (seg.length < 2 || seg.length % 2) return false;
  return seg.every((x) => /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(x) && x !== '.' && x !== '..');
}
const colecaoDe = (p) => String(p).split('/').slice(0, -1).join('/');
const clienteDe = (user) => (user && user.client_id ? 'c' + user.client_id : 'construlog');
const podeGravar = (user, p) => (String(p).startsWith('cad/') ? !!(user && user.is_admin) : true);

async function ensureSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS rc_docs (
    cliente TEXT NOT NULL,
    path TEXT NOT NULL,
    colecao TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_by TEXT,
    PRIMARY KEY (cliente, path)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rc_docs_mudanca ON rc_docs (cliente, updated_at)');
  await pool.query(`CREATE TABLE IF NOT EXISTS rc_docs_removidos (
    cliente TEXT NOT NULL,
    path TEXT NOT NULL,
    removed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (cliente, path)
  )`);
}

// Carga inicial de um cliente sem nenhum documento: ajustes, cidades com os dias de rota
// (planilha AMERICANA_MATCOM 13-10, Araçoiaba corrigida) e as notas que ficaram em 09/10.
async function semear(pool, cliente) {
  const q = await pool.query('SELECT 1 FROM rc_docs WHERE cliente=$1 LIMIT 1', [cliente]);
  if (q.rowCount) return 0;
  let docs = [];
  try { docs = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); } catch { return 0; }
  for (const d of docs) {
    if (!caminhoValido(d.path)) continue;
    await pool.query('INSERT INTO rc_docs(cliente,path,colecao,data,updated_by) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING', [cliente, d.path, colecaoDe(d.path), JSON.stringify(d.data), 'carga inicial']);
  }
  return docs.length;
}

async function handle(req, res, u, ctx) {
  const p = u.pathname;
  if (p !== '/api/rc' && !p.startsWith('/api/rc/')) return false;
  const { pool, sendJson, readJsonBodyLimited, dashboardSession, dashboardHas } = ctx;
  try {
    // versão do sistema (muda a cada publicação, porque o servidor reinicia): usada pelo botão "Atualizar sistema"
    if (p === '/api/rc/sistema' && req.method === 'GET') return sendJson(res, 200, { ok: true, versao: BOOT, pagina: versaoPagina() }), true;
    const user = await dashboardSession(req, false);
    if (!dashboardHas(user, PERM)) return sendJson(res, 403, { ok: false, error: 'Seu usuário não tem acesso ao Roteirizador. Peça a liberação a um administrador.' }), true;
    const cliente = clienteDe(user);

    if (p === '/api/rc/versao' && req.method === 'GET') return sendJson(res, 200, { ok: true, versao: versaoPagina() }), true;

    if (p === '/api/rc/eu' && req.method === 'GET') {
      await semear(pool, cliente);
      return sendJson(res, 200, { ok: true, id: 'u' + user.id, username: user.username, admin: !!user.is_admin, permissions: user.permissions || [] }), true;
    }

    // tudo o que mudou desde um instante (sem "desde": tudo)
    if (p === '/api/rc/mudancas' && req.method === 'GET') {
      const desde = String(u.searchParams.get('desde') || '');
      const agora = (await pool.query('SELECT clock_timestamp() AS t')).rows[0].t;
      let docs, removidos = [];
      if (desde && !isNaN(Date.parse(desde))) {
        docs = (await pool.query('SELECT path,data,updated_at FROM rc_docs WHERE cliente=$1 AND updated_at>$2 ORDER BY updated_at', [cliente, desde])).rows;
        removidos = (await pool.query('SELECT path FROM rc_docs_removidos WHERE cliente=$1 AND removed_at>$2', [cliente, desde])).rows.map((r) => r.path);
      } else {
        docs = (await pool.query('SELECT path,data,updated_at FROM rc_docs WHERE cliente=$1 ORDER BY path', [cliente])).rows;
      }
      return sendJson(res, 200, { ok: true, agora, completo: !desde, docs, removidos }), true;
    }

    if (p === '/api/rc/doc' && (req.method === 'PUT' || req.method === 'DELETE')) {
      const body = req.method === 'PUT' ? await readJsonBodyLimited(req, MAX_DOC + 4096) : null;
      const dp = req.method === 'PUT' ? String(body && body.path || '') : String(u.searchParams.get('path') || '');
      if (!caminhoValido(dp)) return sendJson(res, 400, { ok: false, error: 'Caminho inválido.' }), true;
      if (!podeGravar(user, dp)) return sendJson(res, 403, { ok: false, code: 'invalid_argument', error: 'Somente administradores alteram veículos, motoristas, cidades e ajustes.' }), true;
      if (req.method === 'DELETE') {
        await pool.query('DELETE FROM rc_docs WHERE cliente=$1 AND path=$2', [cliente, dp]);
        await pool.query('INSERT INTO rc_docs_removidos(cliente,path) VALUES($1,$2) ON CONFLICT (cliente,path) DO UPDATE SET removed_at=clock_timestamp()', [cliente, dp]);
        return sendJson(res, 200, { ok: true }), true;
      }
      const data = body && body.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return sendJson(res, 400, { ok: false, error: 'Documento deve ser um objeto.' }), true;
      const txt = JSON.stringify(data);
      if (txt.length > MAX_DOC) return sendJson(res, 413, { ok: false, error: 'Documento grande demais.' }), true;
      await pool.query(`INSERT INTO rc_docs(cliente,path,colecao,data,updated_by,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,clock_timestamp())
        ON CONFLICT (cliente,path) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`, [cliente, dp, colecaoDe(dp), txt, user.username]);
      await pool.query('DELETE FROM rc_docs_removidos WHERE cliente=$1 AND path=$2', [cliente, dp]);
      return sendJson(res, 200, { ok: true }), true;
    }

    return sendJson(res, 404, { ok: false, error: 'Rota não encontrada.' }), true;
  } catch (e) {
    return sendJson(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Falha no Roteirizador: ' + (e.message || e) }), true;
  }
}

module.exports = { ensureSchema, handle, semear, versaoPagina, caminhoValido, colecaoDe, podeGravar, PERM };
