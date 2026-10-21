'use strict';
// Versão de demonstração da Torre de Controle, para outras transportadoras.
// Roda como um serviço SEPARADO no Render (MOVIT_DEMO=1), com banco próprio e sem nenhum dado
// da CONSTRULOG. Na produção (sem MOVIT_DEMO) nada deste arquivo é usado.
//
// Como funciona:
//  - O cliente entra em /demo com o login do SSW dele (domínio, CPF, usuário, senha). O login é
//    conferido no próprio SSW; só depois disso a empresa e o usuário são criados.
//  - A senha do SSW fica guardada criptografada (AES-256-GCM) com a chave MOVIT_CHAVE_SSW, que
//    existe só nas variáveis do serviço no Render. Sem a chave o serviço demo não sobe.
//  - Cada empresa ganha o seu próprio processo de leitura do SSW (o mesmo dashboard/server.js da
//    produção), iniciado com o login DELA. Caches e sessões do SSW nunca se misturam entre
//    empresas. O processo para sozinho depois de um tempo sem uso.
//  - Só os módulos marcados como prontos para várias empresas abrem para o cliente da demo
//    (lista MODULOS abaixo). Os demais ainda leem dados guardados sem separação por empresa e
//    ficam fechados até serem adaptados.
// Testado em tests/movit-demo.js.

const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ATIVA = /^(1|true|sim|yes)$/i.test(String(process.env.MOVIT_DEMO || '').trim());
const SSW_BASE = 'https://sistema.ssw.inf.br';
const SSW_UA = 'Mozilla/5.0 Chrome/120 Safari/537.36';

// Módulos da plataforma (chaves de movit_modules) que já funcionam separados por empresa na demo,
// com as rotas que o cliente pode chamar. Rotas fora desta lista respondem 403 para o cliente da demo.
//   painel: rotas atendidas pelo servidor principal
//   ssw:    rotas atendidas pelo processo de leitura do SSW da própria empresa
//   telas:  abas do painel (data-module em painel.html) que o módulo mostra
const MODULOS = {
  roteirizador: {
    painel: [/^\/api\/rc(\/|$)/],
    // "Buscar no SSW" do Roteirizador: CTRCs disponíveis nas unidades da empresa, situação das notas e endereços dos CT-es
    ssw: [/^\/api\/programacao-entregas\/(disponiveis|status-nfs)$/, /^\/api\/roteirizador\/(enderecos-ctrc|localizar-enderecos)$/],
    telas: ['roteirizador-cargas']
  },
  agendamento: {
    // agendamentos gravados por empresa (client_id) no servidor principal
    painel: [/^\/api\/painel\/agendamentos(\/|$)/],
    // busca da NF no SSW da própria empresa (opções 38 e 101); a varredura chama o processo da empresa direto
    ssw: [/^\/api\/agendamentos\/nf$/],
    telas: ['agendamento-entregas']
  },
  usuarios: { painel: [], ssw: [], telas: ['usuarios'] },
  // Dashboards: os cards que leem a opção 38 do SSW com o login da empresa. Os cards do BI2 (lista
  // BI2 abaixo) entram só para a empresa que informou o acesso ao BI2 na entrada.
  // Parceiros (transportadoras que entregam pela empresa em outras regiões): cadastro com o login
  // do SSW de cada parceiro e a evolução de todos, na tela Parceiros.
  dashboards: {
    painel: [/^\/api\/painel\/parceiros(\/\d+|\/evolucao)?$/],
    ssw: [/^\/api\/evolucao-motoristas$/, /^\/api\/bi2\/saidas-baixas$/],
    telas: ['dashboards', 'parceiros']
  }
};
// Cards dos Dashboards que leem a WebAPI do BI2 da empresa: rotas do processo de leitura e permissões.
// Os cards que dependem das planilhas ou do banco da CONSTRULOG (Ocorrências e SLA, Receita) ficam fora.
const BI2 = {
  modulo: 'dashboards',
  ssw: [/^\/api\/bi2\/atrasos$/, /^\/api\/bi2\/remetentes$/, /^\/api\/ssw\/cidades-mapa$/],
  perms: ['ssw_atrasos', 'remetentes', 'remetentes_comparativo', 'cidade_destino']
};
// Rotas que todo cliente da demo usa (login, sessão, usuários da própria empresa, guia e vídeos,
// e a conferência da conexão com o SSW da empresa).
const ROTAS_BASE = { painel: [/^\/api\/empresa\/logo$/, /^\/api\/auth\//, /^\/api\/painel\/auth\//, /^\/api\/demo\//, /^\/api\/guia(\/|$)/], ssw: [/^\/api\/ssw\/conexao$/] };
// Permissões internas que cada módulo libera (as mesmas usadas pelo painel).
const PERMS_POR_MODULO = { roteirizador: ['roteirizador'], agendamento: ['agendamentos'], usuarios: [], dashboards: ['evolucao', 'ssw_saidas'] };

function modulosProntos() { return Object.keys(MODULOS); }

// ------------------------------------------------------------------ criptografia da senha do SSW
function chave() {
  const s = String(process.env.MOVIT_CHAVE_SSW || '');
  if (s.length < 32) throw new Error('MOVIT_CHAVE_SSW precisa ter pelo menos 32 caracteres.');
  return crypto.createHash('sha256').update('movit-ssw:' + s).digest();
}
function cifrar(texto) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decifrar(blob) {
  const m = /^v1:(.+)$/.exec(String(blob || ''));
  if (!m) throw new Error('Senha guardada em formato desconhecido.');
  const b = Buffer.from(m[1], 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

// ------------------------------------------------------------------ dados do formulário de entrada
function normalizarEntrada(body) {
  const dominio = String(body.dominio || '').trim().toUpperCase();
  const cpf = String(body.cpf || '').replace(/\D/g, '');
  const usuario = String(body.usuario || '').trim().toLowerCase();
  const senha = String(body.senha || '');
  const empresa = String(body.empresa || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const unidades = [...new Set(String(body.unidades || '').toUpperCase().split(/[\s,;/]+/).filter(x => /^[A-Z0-9]{3}$/.test(x)))].slice(0, 12);
  const contato = String(body.contato || '').trim().slice(0, 160);
  // Acesso ao BI2 (opcional): sigla e senha da WebAPI do BI2, que não são o login do SSW.
  const bi2Sigla = String(body.bi2_sigla || '').trim().toLowerCase();
  const bi2Senha = String(body.bi2_senha || '');
  const bi2Pasta = String(body.bi2_pasta || '').trim().toLowerCase() || 'cliente';
  const bi2 = bi2Sigla || bi2Senha ? { sigla: bi2Sigla, senha: bi2Senha, pasta: bi2Pasta } : null;
  const erros = [];
  if (!/^[A-Z0-9]{2,10}$/.test(dominio)) erros.push('Informe o domínio do SSW (as letras que você digita no primeiro campo do login).');
  if (cpf.length !== 11) erros.push('Informe o CPF do login do SSW (11 números).');
  if (!/^[a-z0-9._-]{1,40}$/.test(usuario)) erros.push('Informe o usuário do SSW.');
  if (!senha || senha.length > 80) erros.push('Informe a senha do SSW.');
  if (empresa.length < 2) erros.push('Informe o nome da transportadora.');
  if (bi2) {
    if (!/^[a-z0-9._-]{1,20}$/.test(bi2Sigla)) erros.push('Informe a sigla do BI2 (ou deixe os campos do BI2 vazios).');
    if (!bi2Senha || bi2Senha.length > 80) erros.push('Informe a senha do BI2 (ou deixe os campos do BI2 vazios).');
    if (!/^[a-z0-9._-]{1,40}$/.test(bi2Pasta)) erros.push('Pasta do BI2 inválida. Se não souber, use "cliente".');
  }
  return { dominio, cpf, usuario, senha, empresa, unidades, contato, bi2, erros };
}

// ------------------------------------------------------------------ conferência do login no SSW
// Mesma sequência do dashboard (sswLoginFresh): abre a tela de login, envia os 4 campos e confere
// se o SSW devolveu o cookie "token". Devolve {ok:true} ou {ok:false, erro}.
async function testarLoginSsw({ dominio, cpf, usuario, senha }) {
  const jar = new Map();
  const apply = h => {
    const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : (h.get('set-cookie') ? [h.get('set-cookie')] : []);
    for (const raw of list) { const pair = String(raw).split(';')[0], i = pair.indexOf('='); if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
  };
  const cookie = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
  try {
    let r = await fetch(SSW_BASE + '/bin/ssw0422', { headers: { 'User-Agent': SSW_UA }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    apply(r.headers); await r.text().catch(() => '');
    const body = new URLSearchParams({ act: 'L', f1: dominio, f2: cpf, f3: usuario, f4: senha });
    r = await fetch(SSW_BASE + '/bin/ssw0422', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': SSW_UA, Referer: SSW_BASE + '/bin/ssw0422', Cookie: cookie() },
      body: body.toString(), redirect: 'manual', signal: AbortSignal.timeout(15000)
    });
    apply(r.headers); await r.text().catch(() => '');
  } catch (e) {
    return { ok: false, indisponivel: true, erro: 'Não foi possível falar com o SSW agora. Tente de novo em instantes.' };
  }
  if (!jar.has('token')) return { ok: false, erro: 'O SSW não aceitou esse login. Confira domínio, CPF, usuário e senha.' };
  return { ok: true };
}

// ------------------------------------------------------------------ conferência do acesso ao BI2
// A WebAPI do BI2 (a mesma que o dashboard lê) responde 200 com CSV quando sigla, pasta e senha
// conferem. Testa os relatórios usados pelos cards; basta um responder.
const BI2_BASE = 'https://ssw.inf.br/api/bi2/';
async function testarBi2({ sigla, senha, pasta }, { timeoutMs = 15000 } = {}) {
  const auth = 'Basic ' + crypto.createHash('md5').update(senha).digest('hex');
  let respondeu = false;
  for (const codigo of [13, 16, 83]) {
    try {
      const r = await fetch(BI2_BASE + encodeURIComponent(sigla) + '/' + encodeURIComponent(pasta) + '?codigo=' + codigo, {
        headers: { 'User-Agent': 'MOVIT-BI2/1.0', Accept: 'text/csv,*/*', Authorization: auth, 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      await r.arrayBuffer().catch(() => null);
      respondeu = true;
      if (r.status === 200) return { ok: true };
      if (r.status === 401 || r.status === 403) break;   // acesso recusado: não adianta tentar outro relatório
    } catch { /* tenta o próximo */ }
  }
  if (!respondeu) return { ok: false, indisponivel: true, erro: 'Não foi possível falar com o BI2 agora. Tente de novo em instantes, ou entre sem o BI2.' };
  return { ok: false, erro: 'O BI2 não aceitou esse acesso. Confira sigla, senha e pasta do BI2, ou deixe esses campos vazios.' };
}

// BI2 automático: sem os campos do BI2, tenta a WebAPI com o domínio do SSW como sigla e a senha do
// SSW. Se o BI2 aceitar, a empresa ganha os cards do BI2 sem digitar nada; se não, segue sem eles.
async function bi2Automatico({ dominio, senha }) {
  const acesso = { sigla: String(dominio || '').toLowerCase(), senha, pasta: 'cliente' };
  const t = await testarBi2(acesso, { timeoutMs: 6000 });
  return t.ok ? acesso : null;
}

// ------------------------------------------------------------------ banco
async function initDb(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS movit_client_ssw (
    client_id BIGINT PRIMARY KEY REFERENCES movit_clients(id) ON DELETE CASCADE,
    dominio TEXT NOT NULL UNIQUE,
    cpf TEXT NOT NULL,
    usuario TEXT NOT NULL,
    senha_cifrada TEXT NOT NULL,
    unidades TEXT NOT NULL DEFAULT '',
    contato TEXT,
    validado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('ALTER TABLE movit_client_ssw ADD COLUMN IF NOT EXISTS bi2_sigla TEXT, ADD COLUMN IF NOT EXISTS bi2_pasta TEXT, ADD COLUMN IF NOT EXISTS bi2_senha_cifrada TEXT');
  // Uso da demo, para a MOVIT Central: quantas vezes a empresa entrou e quando usou por último.
  await pool.query('ALTER TABLE movit_client_ssw ADD COLUMN IF NOT EXISTS entradas INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS ultimo_acesso TIMESTAMPTZ');
  // Parceiros de cada empresa: login do SSW que a empresa criou para o parceiro (ou o do domínio
  // do próprio parceiro) e as unidades onde saem os romaneios dele.
  await pool.query(`CREATE TABLE IF NOT EXISTS movit_parceiros (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT NOT NULL REFERENCES movit_clients(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    dominio TEXT NOT NULL,
    cpf TEXT NOT NULL,
    usuario TEXT NOT NULL,
    senha_cifrada TEXT NOT NULL,
    unidades TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(client_id, dominio, usuario)
  )`);
}

// ------------------------------------------------------------------ parceiros
// Mesmos campos da entrada da demo (o nome vai no lugar do nome da transportadora); as unidades
// são obrigatórias, porque é por elas que a opção 38 separa os romaneios do parceiro.
function normalizarParceiro(body) {
  const d = normalizarEntrada({ ...body, empresa: body && body.nome });
  d.nome = d.empresa;
  d.erros = d.erros.map(e => e.replace('nome da transportadora', 'nome do parceiro'));
  if (!d.unidades.length) d.erros.push('Informe a unidade do parceiro no SSW (sigla de 3 letras).');
  return d;
}

// ------------------------------------------------------------------ processos de leitura do SSW
// Um processo por empresa, cada um com o login do SSW dela. Ficam no ar enquanto são usados;
// o menos usado sai quando o limite é atingido e qualquer um sai depois de OCIOSO_MS sem uso.
const MAX_PROCESSOS = Math.max(1, Number(process.env.MOVIT_DEMO_MAX_PROCESSOS || 3) || 3);
const OCIOSO_MS = Math.max(60, Number(process.env.MOVIT_DEMO_OCIOSO_SEGUNDOS || 900) || 900) * 1000;
const PORTA_INICIAL = Number(process.env.MOVIT_DEMO_PORTA_INICIAL || 10100);
const DASHBOARD_DIR = path.join(__dirname, 'dashboard');
const PROCESSOS = new Map();   // client_id -> {proc, porta, chaveInterna, usado, pronto}
// Variáveis repassadas ao processo da empresa. Lista fechada: nada de banco, chaves ou acessos da
// CONSTRULOG chega a ele, só o login do SSW da própria empresa.
const ENV_REPASSADAS = ['PATH', 'HOME', 'TZ', 'LANG', 'NODE_ENV', 'NODE_PATH', 'NODE_OPTIONS', 'PUBLIC_BASE_URL', 'QUALP_API_KEY', 'TEST_MODE', 'MOCK_PORT', 'NETGUARD_LOG'];

function portaLivre() {
  const usadas = new Set([...PROCESSOS.values()].map(p => p.porta));
  for (let p = PORTA_INICIAL; p < PORTA_INICIAL + 200; p++) if (!usadas.has(p)) return p;
  throw new Error('Sem porta livre para o processo da empresa.');
}
function encerrar(clientId) {
  const p = PROCESSOS.get(String(clientId));
  if (!p) return;
  PROCESSOS.delete(String(clientId));
  try { p.proc.removeAllListeners('exit'); p.proc.kill(); } catch { /* já saiu */ }
}
function encerrarTodos() { for (const id of [...PROCESSOS.keys()]) encerrar(id); }
function aguardarSaude(porta, ms = 30000) {
  const fim = Date.now() + ms;
  return new Promise((ok, falha) => {
    const tentar = () => {
      const r = http.get({ host: '127.0.0.1', port: porta, path: '/health', timeout: 2000 }, res => {
        res.resume();
        if (res.statusCode === 200) return ok();
        if (Date.now() > fim) return falha(new Error('Processo da empresa não respondeu.'));
        setTimeout(tentar, 300);
      });
      r.on('error', () => { if (Date.now() > fim) return falha(new Error('Processo da empresa não respondeu.')); setTimeout(tentar, 300); });
      r.on('timeout', () => r.destroy());
    };
    tentar();
  });
}
async function processoDaEmpresa(pool, clientId, portalUrl) {
  const id = String(clientId);
  const p = PROCESSOS.get(id);
  if (p) { p.usado = Date.now(); await p.pronto; return p; }
  const q = await pool.query('SELECT dominio,cpf,usuario,senha_cifrada,unidades,bi2_sigla,bi2_pasta,bi2_senha_cifrada FROM movit_client_ssw WHERE client_id=$1', [id]);
  if (!q.rowCount) { const e = new Error('Esta empresa ainda não conectou o SSW.'); e.status = 403; throw e; }
  return iniciarProcesso(id, id, q.rows[0], portalUrl);
}
// Processo de leitura de um parceiro da empresa: o mesmo leitor, com o login do SSW do parceiro.
async function processoDoParceiro(pool, clientId, parceiroId, portalUrl) {
  const chave = 'parceiro:' + parceiroId;
  const p = PROCESSOS.get(chave);
  if (p) { p.usado = Date.now(); await p.pronto; return p; }
  const q = await pool.query('SELECT dominio,cpf,usuario,senha_cifrada,unidades FROM movit_parceiros WHERE id=$1 AND client_id=$2', [parceiroId, clientId]);
  if (!q.rowCount) { const e = new Error('Parceiro não encontrado.'); e.status = 404; throw e; }
  return iniciarProcesso(chave, String(clientId), q.rows[0], portalUrl);
}
async function iniciarProcesso(id, clientId, c, portalUrl) {
  while (PROCESSOS.size >= MAX_PROCESSOS) {
    const antigo = [...PROCESSOS.entries()].sort((a, b) => a[1].usado - b[1].usado)[0];
    encerrar(antigo[0]);
  }
  const porta = portaLivre(), chaveInterna = crypto.randomBytes(32).toString('hex');
  const env = {};
  for (const k of ENV_REPASSADAS) if (process.env[k] !== undefined) env[k] = process.env[k];
  Object.assign(env, {
    PORT: String(porta),
    COLETAS_PORTAL_URL: portalUrl,
    DASH_INTERNAL_KEY: chaveInterna,
    MOVIT_DEMO: '1',
    MOVIT_CLIENTE_ID: clientId,
    SSW_INTERNAL_DOMINIO: c.dominio,
    SSW_INTERNAL_CPF: c.cpf,
    SSW_INTERNAL_USUARIO: c.usuario,
    SSW_INTERNAL_SENHA: decifrar(c.senha_cifrada),
    SSW_UNIDADES: c.unidades || ''
  });
  // Acesso ao BI2 da empresa, quando informado (sem BI2_HOST: só a WebAPI, nada de SFTP).
  if (c.bi2_sigla && c.bi2_senha_cifrada) Object.assign(env, { BI2_COMPANY: c.bi2_sigla, BI2_USERNAME: c.bi2_sigla, BI2_PASSWORD: decifrar(c.bi2_senha_cifrada), BI2_FOLDER: c.bi2_pasta || 'cliente' });
  const proc = spawn(process.execPath, [path.join(DASHBOARD_DIR, 'server.js')], { cwd: DASHBOARD_DIR, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const p = { proc, porta, chaveInterna, usado: Date.now(), pronto: null };
  p.pronto = aguardarSaude(porta).catch(e => { encerrar(id); throw e; });
  proc.on('exit', () => { if (PROCESSOS.get(id) === p) PROCESSOS.delete(id); });
  PROCESSOS.set(id, p);
  await p.pronto;
  return p;
}
if (ATIVA) {
  setInterval(() => {
    const limite = Date.now() - OCIOSO_MS;
    for (const [id, p] of PROCESSOS) if (p.usado < limite) encerrar(id);
  }, 60 * 1000).unref();
  process.on('exit', encerrarTodos);
}
// Repassa a requisição ao processo da empresa (mesma ideia do proxyDashboard do servidor).
function repassar(req, res, porta, alvo) {
  const pr = http.request({ host: '127.0.0.1', port: porta, method: req.method, path: alvo, headers: { ...req.headers, host: '127.0.0.1:' + porta } }, pres => {
    res.writeHead(pres.statusCode || 502, { ...pres.headers });
    pres.pipe(res);
  });
  pr.on('error', err => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: 'Leitura do SSW da empresa indisponível: ' + err.message }));
  });
  req.pipe(pr);
}

// GET no processo de leitura, com a sessão do usuário (o processo confere a sessão no servidor principal).
function consultar(porta, alvo, headers) {
  return new Promise((ok, falha) => {
    const r = http.get({ host: '127.0.0.1', port: porta, path: alvo, timeout: 60000, headers: { cookie: headers.cookie || '', authorization: headers.authorization || '' } }, res => {
      let corpo = ''; res.setEncoding('utf8');
      res.on('data', c => { corpo += c; });
      res.on('end', () => { try { const j = JSON.parse(corpo); if (res.statusCode !== 200 || j.ok === false) return falha(new Error(j.error || ('HTTP ' + res.statusCode))); ok(j); } catch { falha(new Error('Resposta inválida da leitura do SSW.')); } });
    });
    r.on('timeout', () => r.destroy(new Error('A leitura do SSW do parceiro demorou demais.')));
    r.on('error', falha);
  });
}

// ------------------------------------------------------------------ regras de acesso do cliente da demo
// Cliente da demo = usuário de uma empresa que entrou pelo SSW (não CONSTRULOG, não administrador MOVIT).
function clienteDemo(user) {
  return !!(ATIVA && user && !user.internal && !user.is_platform_admin && user.client && user.client.ssw && String(user.client.slug || '').toLowerCase() !== 'construlog');
}
function modulosLiberados(user) {
  const contratados = new Set((user && user.client_modules) || []);
  return modulosProntos().filter(m => contratados.has(m));
}
function telasLiberadas(user) {
  return modulosLiberados(user).flatMap(m => MODULOS[m].telas || []);
}
function comBi2(user) {
  return !!(user && user.client && user.client.bi2 && modulosLiberados(user).includes(BI2.modulo));
}
function permsLiberadas(user) {
  const perms = modulosLiberados(user).flatMap(m => PERMS_POR_MODULO[m] || []);
  if (comBi2(user)) perms.push(...BI2.perms);
  return new Set(perms);
}
function rotaLiberada(user, pathname, onde) {
  if ((ROTAS_BASE[onde] || []).some(re => re.test(pathname))) return true;
  if (onde === 'ssw' && comBi2(user) && BI2.ssw.some(re => re.test(pathname))) return true;
  return modulosLiberados(user).some(m => (MODULOS[m][onde] || []).some(re => re.test(pathname)));
}

module.exports = {
  ATIVA, MODULOS, modulosProntos, cifrar, decifrar, normalizarEntrada, testarLoginSsw, testarBi2, bi2Automatico, initDb,
  processoDaEmpresa, processoDoParceiro, normalizarParceiro, consultar, encerrar, encerrarTodos, repassar, clienteDemo, comBi2, modulosLiberados, telasLiberadas, permsLiberadas, rotaLiberada
};
