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
// Frota e motoristas fictícios do ambiente de demonstração
const DEMO_EXTRA = [
  { path: 'cad/main/veiculos/demo-fiorino-1', data: { id: 'demo-fiorino-1', nome: 'Fiorino 01', placa: 'DEM1A11', tipo: 'fiorino', capKg: 600, capM3: 3, custoDiaria: 400, kmL: 11, combustivel: 'gasolina', compr: 1.9, larg: 1.3, alt: 1.2, aceitaTubos: true, motoristaId: 'demo-m1', ativo: true } },
  { path: 'cad/main/veiculos/demo-van-1', data: { id: 'demo-van-1', nome: 'Van 01', placa: 'DEM2B22', tipo: 'van', capKg: 1500, capM3: 10, custoDiaria: 700, kmL: 9, combustivel: 'diesel', compr: 3.3, larg: 1.75, alt: 1.75, aceitaTubos: true, motoristaId: 'demo-m2', ativo: true } },
  { path: 'cad/main/veiculos/demo-van-2', data: { id: 'demo-van-2', nome: 'Van 02', placa: 'DEM3C33', tipo: 'van', capKg: 1500, capM3: 10, custoDiaria: 700, kmL: 9, combustivel: 'diesel', compr: 3.3, larg: 1.75, alt: 1.75, aceitaTubos: true, motoristaId: 'demo-m3', ativo: true } },
  { path: 'cad/main/veiculos/demo-tubos-1', data: { id: 'demo-tubos-1', nome: 'Van com tubo 01', placa: 'DEM4D44', tipo: 'tubos', capKg: 1500, capM3: 15, custoDiaria: 800, kmL: 8, combustivel: 'diesel', compr: 4.2, larg: 1.8, alt: 2, secaoL: 1, secaoA: 1, tuboCompr: 6, aceitaTubos: true, motoristaId: 'demo-m4', ativo: true } },
].concat(['Carlos Demonstração', 'Ana Exemplo', 'Bruno Teste', 'Diego Fictício', 'Eduardo Modelo'].map((nome, i) => ({ path: 'cad/main/motoristas/demo-m' + (i + 1), data: { id: 'demo-m' + (i + 1), nome, telefone: '', diaria: 0, ativo: true, disponivel: true, origem: 'Demonstração' } })));
async function semear(pool, cliente, demo, construlog) {
  const q = await pool.query('SELECT 1 FROM rc_docs WHERE cliente=$1 LIMIT 1', [cliente]);
  if (q.rowCount) return 0;
  let docs = [];
  try { docs = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); } catch { return 0; }
  // clientes que não são a CONSTRULOG não recebem as notas dela
  if (!construlog) docs = docs.filter((d) => !String(d.path).startsWith('op/'));
  if (demo) docs = docs.concat(DEMO_EXTRA);
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
      await semear(pool, cliente, user.client && String(user.client.slug || '').toLowerCase() === 'demo', !user.client || String(user.client.slug || '').toLowerCase() === 'construlog');
      return sendJson(res, 200, { ok: true, id: 'u' + user.id, username: user.username, admin: !!user.is_admin, permissions: user.permissions || [], sandbox: !!user.sandbox, demo: !!(user.client && String(user.client.slug || '').toLowerCase() === 'demo'), cliente: user.client ? user.client.name : '', testeAte: user.client && user.client.status === 'trial' ? user.client.trial_ends_at : null }), true;
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

// Demonstração: apaga e recarrega os dados do cliente de demonstração (todo dia)
async function resetDemo(pool, cliente) {
  await pool.query('DELETE FROM rc_docs WHERE cliente=$1', [cliente]);
  await pool.query('DELETE FROM rc_docs_removidos WHERE cliente=$1', [cliente]);
  return semear(pool, cliente, true);
}
// ---------------- Sobras em galpão: baixa automática pelo SSW ----------------
// De hora em hora, das 05:00 às 20:00 (Brasília), o servidor confere no SSW as notas que ficaram no
// galpão e ainda não foram entregues: entregue (baixa no SSW) sai da lista; em rota / pendente
// atualiza a situação. A sobra marcada à mão não é mexida. A nota ligada à sobra acompanha.
const HORARIOS_SOBRAS = Array.from({ length: 16 }, (_, i) => String(5 + i).padStart(2, '0') + ':00');   // 05:00 ... 20:00
const agoraSP = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { dia: p.year + '-' + p.month + '-' + p.day, hora: p.hour + ':' + p.minute };
};
const somaDias = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const chaveNf = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');

// statusNfs(nfs, desde) -> { itens: { "<nf>": { status: 'entregue'|'em_rota'|'pendente', em, fonte } } }
async function conferirSobras(pool, cliente, statusNfs, hoje) {
  hoje = hoje || agoraSP().dia;
  const docs = (await pool.query("SELECT path,data FROM rc_docs WHERE cliente=$1 AND (colecao='op/main/sobras' OR colecao='op/main/notas')", [cliente])).rows;
  const notas = new Map(docs.filter((d) => d.path.startsWith('op/main/notas/')).map((d) => [d.data.id || d.path.split('/').pop(), d]));
  const limite = somaDias(hoje, -20);
  const abertas = docs.filter((d) => {
    if (!d.path.startsWith('op/main/sobras/')) return false;
    const s = d.data || {};
    if (!chaveNf(s.numero) || s.statusManual || s.status === 'entregue' || !s.data || s.data < limite || s.data > hoje) return false;
    const n = s.notaId && notas.get(s.notaId);
    return !(n && n.data.status === 'entregue');
  });
  const out = { cliente, conferidas: abertas.length, entregues: 0, emRota: 0, alteradas: 0 };
  if (!abertas.length) return out;
  const desde = abertas.map((d) => d.data.data).sort()[0];
  const itens = {};
  const nfs = [...new Set(abertas.map((d) => chaveNf(d.data.numero)))];
  for (let i = 0; i < nfs.length; i += 300) Object.assign(itens, ((await statusNfs(nfs.slice(i, i + 300), desde)) || {}).itens || {});
  const grava = (path, data) => pool.query(`INSERT INTO rc_docs(cliente,path,colecao,data,updated_by,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,clock_timestamp())
    ON CONFLICT (cliente,path) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`, [cliente, path, colecaoDe(path), JSON.stringify(data), 'conferência SSW']);
  for (const d of abertas) {
    const s = d.data, r = itens[chaveNf(s.numero)];
    if (!r || !['entregue', 'em_rota', 'pendente'].includes(r.status)) continue;
    if (r.status === 'entregue') out.entregues++; else if (r.status === 'em_rota') out.emRota++;
    const q = Object.assign({}, s, { conferidoEm: new Date().toISOString() });
    if (r.status !== (s.status || 'pendente')) {
      Object.assign(q, { status: r.status, statusFonte: r.fonte || 'SSW', statusEm: hoje });
      if (r.status === 'entregue') q.entregueEm = r.em || hoje; else delete q.entregueEm;
      out.alteradas++;
      const n = s.notaId && notas.get(s.notaId);
      if (n) {
        const st = n.data.status, ns = r.status === 'entregue' ? 'entregue' : r.status === 'em_rota' ? 'em_rota' : (st === 'em_rota' ? 'pronta' : st);
        if (ns !== st) await grava(n.path, Object.assign({}, n.data, { status: ns }, ns === 'entregue' ? { entregueEm: q.entregueEm } : {}));
      }
    }
    await grava(d.path, q);
  }
  return out;
}

// Roda nos HORARIOS_SOBRAS (uma vez por horário por dia). clientes(): chaves de cliente com SSW (a CONSTRULOG).
function iniciarConferenciaSobras({ pool, statusNfs, clientes, horarios = HORARIOS_SOBRAS, log = console.log }) {
  const feitos = new Set();
  const tick = async () => {
    const { dia, hora } = agoraSP();
    const h = horarios.find((x) => hora >= x && hora < somaMin(x, 30));
    if (!h || feitos.has(dia + ' ' + h)) return;
    feitos.add(dia + ' ' + h);
    for (const c of await clientes()) {
      try { log('SOBRAS SSW ' + h + ': ' + JSON.stringify(await conferirSobras(pool, c, statusNfs, dia))); }
      catch (e) { log('SOBRAS SSW ' + h + ' ERRO (' + c + '): ' + (e.message || e)); }
    }
  };
  return setInterval(() => { tick().catch(() => {}); }, 60 * 1000);
}
const somaMin = (hhmm, n) => { const [a, b] = hhmm.split(':').map(Number), t = a * 60 + b + n; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

module.exports = { resetDemo, ensureSchema, handle, semear, versaoPagina, caminhoValido, colecaoDe, podeGravar, PERM, conferirSobras, iniciarConferenciaSobras, HORARIOS_SOBRAS };
