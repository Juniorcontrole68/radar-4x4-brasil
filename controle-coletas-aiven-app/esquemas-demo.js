'use strict';
// Versão de demonstração (MOVIT_DEMO=1): cada empresa em teste guarda os dados dos módulos num
// esquema próprio do Postgres (t<id da empresa>), com as mesmas tabelas da operação. As telas e os
// módulos são os mesmos da CONSTRULOG, sem mudar nenhuma consulta: durante uma requisição de um
// usuário da empresa, toda consulta do pool roda com search_path "t<id>, public". As tabelas da
// lista abaixo resolvem para o esquema da empresa; o resto (usuários, sessões, MOVIT Central,
// agendamentos e roteirizador, que já separam por empresa) continua no public.
// Na produção (sem MOVIT_DEMO) nada daqui é instalado. Testado em tests/movit-demo.js.

const { AsyncLocalStorage } = require('async_hooks');

// Tabelas operacionais que ganham uma cópia vazia por empresa.
const TABELAS = [
  'coletas', 'coleta_documentos', 'carregamentos_finais', 'carregamentos_avarias', 'nf_materiais',
  'bills', 'bill_documents',
  'fleet_state', 'fleet_maintenance_files',
  'operacao_lancamentos', 'operacao_config',
  'dre_lancamentos', 'dre_holerite_arquivos', 'dre_holerites', 'dre_ssw_despesas', 'dre_ssw_eventos',
  'lotacao_clientes', 'lotacao_clientes_base', 'lotacao_clientes_importacao'
];
// Linhas iniciais copiadas do public (estado vazio da Frota).
const COPIAR = { fleet_state: 'id=1' };

const als = new AsyncLocalStorage();
const prontos = new Map();   // client_id -> Promise do esquema criado
let original = null;

const nomeEsquema = clientId => {
  const id = String(clientId || '');
  if (!/^\d{1,18}$/.test(id)) throw new Error('Empresa inválida para o esquema.');
  return 't' + id;
};

// Troca pool.query e pool.connect: dentro de rodar(), a conexão usa o esquema da empresa.
function instalar(pool) {
  if (original) return;
  original = { query: pool.query.bind(pool), connect: pool.connect.bind(pool) };
  const comEsquema = async esquema => {
    const c = await original.connect();
    try { await c.query('SET search_path TO ' + esquema + ', public'); } catch (e) { c.release(e); throw e; }
    return c;
  };
  const devolver = (c, rel) => c.query('SET search_path TO public').then(() => rel(), e => rel(e));
  pool.query = function (...args) {
    const st = als.getStore();
    if (!st || typeof args[args.length - 1] === 'function') return original.query(...args);
    return (async () => {
      const c = await comEsquema(st.esquema);
      try { return await c.query(...args); } finally { await devolver(c, e => c.release(e)); }
    })();
  };
  pool.connect = function (cb) {
    const st = als.getStore();
    if (!st || typeof cb === 'function') return original.connect(cb);
    return comEsquema(st.esquema).then(c => {
      const rel = c.release.bind(c);
      c.release = err => { c.release = rel; if (err) return rel(err); devolver(c, rel); };
      return c;
    });
  };
}

// Cria (uma vez) o esquema da empresa com as tabelas da lista, copiando a estrutura do public.
function garantir(clientId) {
  const esquema = nomeEsquema(clientId), id = String(clientId);
  if (prontos.has(id)) return prontos.get(id);
  const p = (async () => {
    const q = original.query;
    await q('CREATE SCHEMA IF NOT EXISTS ' + esquema);
    const existentes = new Set((await q("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])", [TABELAS])).rows.map(r => r.table_name));
    for (const t of TABELAS.filter(x => existentes.has(x))) {
      const ja = (await q('SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2', [esquema, t])).rowCount;
      if (ja) continue;
      await q('CREATE TABLE ' + esquema + '.' + t + ' (LIKE public.' + t + ' INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)');
      if (COPIAR[t]) await q('INSERT INTO ' + esquema + '.' + t + ' SELECT * FROM public.' + t + ' WHERE ' + COPIAR[t]);
      // Linhas gravadas sem empresa (sistema antigo de coletas e contas) ficam com a empresa dona do esquema.
      const temCliente = (await q("SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name='client_id'", [esquema, t])).rowCount;
      if (temCliente) await q('ALTER TABLE ' + esquema + '.' + t + ' ALTER COLUMN client_id SET DEFAULT ' + Number(id));
    }
    return esquema;
  })();
  prontos.set(id, p);
  p.catch(() => prontos.delete(id));
  return p;
}

// Apaga os dados da empresa (o esquema volta vazio no próximo uso).
async function limpar(clientId) {
  const esquema = nomeEsquema(clientId);
  prontos.delete(String(clientId));
  await original.query('DROP SCHEMA IF EXISTS ' + esquema + ' CASCADE');
}

// Roda fn com as consultas no esquema da empresa.
async function rodar(clientId, fn) {
  const esquema = await garantir(clientId);
  return als.run({ esquema, clientId: String(clientId) }, fn);
}
function atual() { const st = als.getStore(); return st ? st.clientId : null; }

module.exports = { TABELAS, instalar, garantir, limpar, rodar, atual, nomeEsquema };
