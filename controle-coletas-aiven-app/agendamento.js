'use strict';
// Agendamento de entregas: central de controle das notas pendentes no SSW, com e sem data agendada.
//
// Quem manda em quê:
//   SSW        = situação logística da nota (pendente, em rota, entregue, devolvida). Só consulta, nada é
//                alterado no SSW (nada de baixa, nada de exclusão).
//   Construlog = data do agendamento, observação, quem agendou e o histórico de reagendamentos.
//
// Tabelas (todas separadas por empresa, client_id):
//   ag_notas          uma linha por NF + CT-e (a mesma NF de outro remetente é outra linha). Nunca é apagada:
//                     entregue/devolvida só muda a situação e sai das listas operacionais.
//   ag_agendamentos   agendamentos da nota (no máximo um ativo por nota). Cancelar não toca no SSW.
//   ag_eventos        histórico: agendado, reagendado, observação, cancelado, entregue, devolvida...
//   ag_sincronizacoes log de cada varredura no SSW (automática das 02h00 ou manual).
//   ag_config         horário da varredura e limites de dias dos alertas.
//
// A varredura: o painel (dashboard/server.js, rota /api/agendamentos/ssw-snapshot) lê as pendências da
// opção 38 do SSW e confere na opção 101 as notas que saíram de lá. Este arquivo grava o resultado.
// Se o SSW falhar, nada muda aqui: o último estado válido fica e a falha vai para o log.
// Testado em tests/agendamento.js.

const http = require('http');
const { limparProduto } = require('./dashboard/ssw-cte');

const OPERACIONAIS = ['pendente', 'em_rota', 'verificar'];
const FINAIS = ['entregue', 'devolvida'];
const SITUACOES = OPERACIONAIS.concat(FINAIS);
const ROTULO = { pendente: 'Pendente', em_rota: 'Em rota', verificar: 'Verificação necessária', entregue: 'Entregue', devolvida: 'Devolvida' };

const limpo = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normNf = v => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
// CT-e no formato do SSW: série de 3 letras, número com 6 dígitos e dígito ("AMR000123-4").
function normCtrc(v) {
  const raw = String(v || '').toUpperCase().trim();
  const m = raw.match(/([A-Z]{3})\s*0*(\d{1,9})\s*-?\s*(\d)\b/);
  return m ? m[1] + m[2].padStart(6, '0') + '-' + m[3] : raw.replace(/[^A-Z0-9-]/g, '').slice(0, 30);
}
const numero = v => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const hojeSp = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const horaSp = (d = new Date()) => d.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
// Parceiros cujas entregas entram no agendamento: o termo é procurado no remetente e no pagador da nota.
// A FCB aparece também como Construdecor e Sarke (clientes da FCB). Lista vazia = todas as notas entram.
// Na versão de demonstração (outras transportadoras) não há filtro; a tela de configuração muda a lista.
const DEMO = /^(1|true|sim|yes)$/i.test(String(process.env.MOVIT_DEMO || '').trim());
const PARCEIROS_PADRAO = DEMO ? '' : 'FCB, CONSTRUDEC, SARKE, THM, THB, LANGB, JT TRANSP, TRANSBARBOSA, TRANS BARBOSA';
const semAcento = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const termosParceiros = txt => [...new Set(String(txt ?? '').split(/[,;\n]+/).map(t => semAcento(limpo(t, 60))).filter(t => t.length >= 2))].slice(0, 40);
const ehParceiro = (termos, ...nomes) => { if (!termos.length) return true; const t = nomes.map(semAcento).join(' | '); return termos.some(x => t.includes(x)); };
// Condição SQL equivalente a ehParceiro, para as listas e os indicadores ('' quando não há filtro).
function parceiroSql(termos, params) {
  if (!termos.length) return '';
  params.push(termos.map(t => '%' + t.replace(/[\\%_]/g, m => '\\' + m) + '%'));
  const k = '$' + params.length + '::text[]';
  return `(COALESCE(n.remetente,'') ILIKE ANY(${k}) OR COALESCE(n.pagador,'') ILIKE ANY(${k}))`;
}
const dataIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
// "21/10/2026", "21/10/26" ou "2026-10-21" -> "2026-10-21"
function dataBr(v) {
  const s = String(v || '');
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/(\d{2})\/(\d{2})\/(\d{2,4})/); if (!m) return '';
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return y + '-' + m[2] + '-' + m[1];
}

async function ensureSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_notas (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT,
    nf TEXT NOT NULL,
    serie TEXT NOT NULL DEFAULT '',
    emitente TEXT NOT NULL DEFAULT '',
    ctrc TEXT NOT NULL DEFAULT '',
    tipo_operacao TEXT NOT NULL DEFAULT 'entrega',
    remetente TEXT, destinatario TEXT, cidade TEXT, uf TEXT, endereco TEXT,
    peso NUMERIC(14,3) NOT NULL DEFAULT 0,
    volumes NUMERIC(14,3) NOT NULL DEFAULT 0,
    produto TEXT,
    situacao TEXT NOT NULL DEFAULT 'pendente',
    status_ssw TEXT,
    previsao TEXT,
    data_emissao DATE,
    data_entrada DATE,
    primeiro_visto TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultima_consulta TIMESTAMPTZ,
    ultimo_sync_id BIGINT,
    concluido_em DATE,
    erro_integracao TEXT,
    origem TEXT NOT NULL DEFAULT 'sync',
    dados_ssw JSONB,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_ag_notas_chave ON ag_notas (COALESCE(client_id,0), tipo_operacao, nf, serie, emitente, ctrc)");
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_notas_situacao ON ag_notas (client_id, situacao)');
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_notas_nf ON ag_notas (client_id, nf)');
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_agendamentos (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT,
    nota_id BIGINT NOT NULL REFERENCES ag_notas(id),
    tipo_operacao TEXT NOT NULL DEFAULT 'entrega',
    data_agendada DATE NOT NULL,
    observacao TEXT,
    status TEXT NOT NULL DEFAULT 'ativo',
    reagendamentos INTEGER NOT NULL DEFAULT 0,
    criado_por BIGINT,
    criado_por_nome TEXT,
    motivo_cancelamento TEXT,
    cancelado_por TEXT,
    cancelado_em TIMESTAMPTZ,
    concluido_em TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_ag_agendamentos_ativo ON ag_agendamentos (nota_id) WHERE status='ativo'");
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_agendamentos_data ON ag_agendamentos (client_id, status, data_agendada)');
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_eventos (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT,
    nota_id BIGINT NOT NULL REFERENCES ag_notas(id),
    agendamento_id BIGINT,
    tipo TEXT NOT NULL,
    de TEXT, para TEXT, detalhe TEXT,
    usuario TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_eventos_nota ON ag_eventos (nota_id, criado_em)');
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_sincronizacoes (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT,
    origem TEXT NOT NULL,
    usuario TEXT,
    status TEXT NOT NULL DEFAULT 'rodando',
    iniciado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalizado_em TIMESTAMPTZ,
    pendentes_ssw INTEGER NOT NULL DEFAULT 0,
    novas INTEGER NOT NULL DEFAULT 0,
    atualizadas INTEGER NOT NULL DEFAULT 0,
    entregues INTEGER NOT NULL DEFAULT 0,
    devolvidas INTEGER NOT NULL DEFAULT 0,
    em_rota INTEGER NOT NULL DEFAULT 0,
    verificar INTEGER NOT NULL DEFAULT 0,
    retornaram INTEGER NOT NULL DEFAULT 0,
    erro TEXT,
    detalhes JSONB
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_sinc_cliente ON ag_sincronizacoes (client_id, iniciado_em DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_config (
    chave BIGINT PRIMARY KEY,
    hora_sync TEXT NOT NULL DEFAULT '02:00',
    sync_ativa BOOLEAN NOT NULL DEFAULT TRUE,
    dias_amarelo INTEGER NOT NULL DEFAULT 2,
    dias_vermelho INTEGER NOT NULL DEFAULT 5,
    atualizado_por TEXT,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('ALTER TABLE ag_notas ADD COLUMN IF NOT EXISTS pagador TEXT');
  // de onde veio o nome dos produtos (xml/nfe/ssw_xml/danfe = itens da NF-e; cte = produto predominante) e quando foi buscado
  await pool.query('ALTER TABLE ag_notas ADD COLUMN IF NOT EXISTS produto_fonte TEXT');
  await pool.query('ALTER TABLE ag_notas ADD COLUMN IF NOT EXISTS produtos_em TIMESTAMPTZ');
  await pool.query('ALTER TABLE ag_config ADD COLUMN IF NOT EXISTS parceiros TEXT');   // NULL = lista padrão
  // baixa de entregue feita pelo motorista no app (entregas_comprovantes): a varredura do SSW não reabre a nota
  await pool.query('ALTER TABLE ag_notas ADD COLUMN IF NOT EXISTS baixa_motorista_em TIMESTAMPTZ');
  await pool.query('ALTER TABLE ag_notas ADD COLUMN IF NOT EXISTS baixa_comprovante_id BIGINT');
  // varredura que ficou "rodando" porque o servidor reiniciou no meio
  await pool.query("UPDATE ag_sincronizacoes SET status='erro',erro='Interrompida (o servidor reiniciou durante a varredura).',finalizado_em=NOW() WHERE status='rodando' AND iniciado_em<NOW()-INTERVAL '20 minutes'");
}

const chaveCfg = cli => Number(cli || 0);
const FONTES_PRODUTO = ['xml', 'nfe', 'ssw_xml', 'danfe', 'cte'];
const termosDe = async (db, cli) => termosParceiros((await lerConfig(db, cli)).parceiros);
async function lerConfig(db, cli) {
  const q = await db.query('SELECT hora_sync,sync_ativa,dias_amarelo,dias_vermelho,parceiros,atualizado_por,atualizado_em FROM ag_config WHERE chave=$1', [chaveCfg(cli)]);
  const c = q.rows[0] || { hora_sync: '02:00', sync_ativa: true, dias_amarelo: 2, dias_vermelho: 5, parceiros: null, atualizado_por: null, atualizado_em: null };
  return { ...c, parceiros: c.parceiros == null ? PARCEIROS_PADRAO : c.parceiros };
}
async function gravarConfig(db, cli, b, usuario) {
  const atual = await lerConfig(db, cli);
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.hora_sync || '')) ? String(b.hora_sync) : atual.hora_sync;
  const am = Number.isInteger(Number(b.dias_amarelo)) && Number(b.dias_amarelo) >= 0 && Number(b.dias_amarelo) <= 60 ? Number(b.dias_amarelo) : atual.dias_amarelo;
  let vm = Number.isInteger(Number(b.dias_vermelho)) && Number(b.dias_vermelho) >= 0 && Number(b.dias_vermelho) <= 90 ? Number(b.dias_vermelho) : atual.dias_vermelho;
  if (vm <= am) { const e = new Error('O limite vermelho precisa ser maior que o amarelo.'); e.status = 400; throw e; }
  const ativa = typeof b.sync_ativa === 'boolean' ? b.sync_ativa : atual.sync_ativa;
  const parceiros = typeof b.parceiros === 'string' ? termosParceiros(b.parceiros).join(', ') : atual.parceiros;
  await db.query(`INSERT INTO ag_config(chave,hora_sync,sync_ativa,dias_amarelo,dias_vermelho,parceiros,atualizado_por,atualizado_em) VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (chave) DO UPDATE SET hora_sync=$2,sync_ativa=$3,dias_amarelo=$4,dias_vermelho=$5,parceiros=$6,atualizado_por=$7,atualizado_em=NOW()`, [chaveCfg(cli), hora, ativa, am, vm, parceiros, usuario]);
  return lerConfig(db, cli);
}

async function evento(db, cli, notaId, agId, tipo, de, para, detalhe, usuario) {
  await db.query('INSERT INTO ag_eventos(client_id,nota_id,agendamento_id,tipo,de,para,detalhe,usuario) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [cli, notaId, agId, tipo, de == null ? null : String(de), para == null ? null : String(para), detalhe ? limpo(detalhe, 500) : null, usuario || null]);
}

// Mesmo número de CT-e com ou sem a série ("000885-1" do BI2 = "AMR000885-1" da opção 38); $3 é o CT-e lido.
const MESMO_NUMERO_CTE = "ltrim(regexp_replace(ctrc,'\\D','','g'),'0')=ltrim(regexp_replace($3,'\\D','','g'),'0')";
// Nota do SSW -> linha de ag_notas. Procura pela NF + CT-e; uma linha antiga da mesma NF ainda sem CT-e é
// completada (não duplica). Devolve {id, nova, situacaoAntes}.
async function gravarNota(db, cli, r, { origem = 'sync', syncId = null, pendente = true, situacaoNova = '' } = {}) {
  const nf = normNf(r.nf), ctrc = normCtrc(r.ctrc), serie = limpo(r.serie, 5), emitente = limpo(r.emitente, 20);
  if (!nf) return null;
  const ex = await db.query(`SELECT id,situacao,(baixa_motorista_em IS NOT NULL AND situacao='entregue') AS travada FROM ag_notas WHERE client_id IS NOT DISTINCT FROM $1 AND tipo_operacao='entrega' AND nf=$2
      AND (ctrc=$3 OR ctrc='' OR $3='' OR ((ctrc !~ '^[A-Z]{3}' OR $3 !~ '^[A-Z]{3}') AND ${MESMO_NUMERO_CTE}))
      AND (serie=$4 OR serie='' OR $4='')
      ORDER BY (ctrc=$3) DESC, (serie=$4) DESC, id LIMIT 1`, [cli, nf, ctrc, serie]);
  const fonte = FONTES_PRODUTO.includes(r.produtos_fonte) ? r.produtos_fonte : '';
  const v = [limpo(r.remetente), limpo(r.destinatario ?? r.cliente), limpo(r.cidade, 80), limpo(r.uf, 2).toUpperCase(), limpo(r.endereco, 300),
    numero(r.peso), numero(r.volumes), limpo((fonte ? r.produto : limparProduto(r.produto)) || r.mercadoria, 600), limpo(r.status_ssw ?? r.status, 300), limpo(r.previsao, 20), dataBr(r.data_emissao || r.emissao) || null];
  if (ex.rows[0]) {
    const id = ex.rows[0].id, antes = ex.rows[0].situacao, travada = !!ex.rows[0].travada;
    await db.query(`UPDATE ag_notas SET ctrc=CASE WHEN ctrc='' OR (ctrc !~ '^[A-Z]{3}' AND $2 ~ '^[A-Z]{3}') THEN $2 ELSE ctrc END, serie=CASE WHEN serie='' THEN $3 ELSE serie END, emitente=CASE WHEN emitente='' THEN $4 ELSE emitente END,
        remetente=COALESCE(NULLIF($5,''),remetente), destinatario=COALESCE(NULLIF($6,''),destinatario), cidade=COALESCE(NULLIF($7,''),cidade), uf=COALESCE(NULLIF($8,''),uf),
        endereco=COALESCE(NULLIF($9,''),endereco), peso=CASE WHEN $10::numeric>0 THEN $10::numeric ELSE peso END, volumes=CASE WHEN $11::numeric>0 THEN $11::numeric ELSE volumes END,
        produto=CASE WHEN $19='' AND produto_fonte IS NOT NULL THEN produto ELSE COALESCE(NULLIF($12,''),produto) END,
        produto_fonte=CASE WHEN $19<>'' AND $12<>'' THEN $19 ELSE produto_fonte END, status_ssw=COALESCE(NULLIF($13,''),status_ssw), previsao=COALESCE(NULLIF($14,''),previsao), data_emissao=COALESCE(data_emissao,$15::date),
        situacao=CASE WHEN $16 THEN 'pendente' ELSE situacao END, concluido_em=CASE WHEN $16 THEN NULL ELSE concluido_em END,
        erro_integracao=CASE WHEN $16 THEN NULL ELSE erro_integracao END, ultima_consulta=NOW(), ultimo_sync_id=COALESCE($17,ultimo_sync_id), atualizado_em=NOW(),
        pagador=COALESCE(NULLIF($18,''),pagador)
      WHERE id=$1`, [id, ctrc, serie, emitente, ...v, !!pendente && !travada, syncId, limpo(r.pagador), fonte]);
    return { id, nova: false, situacaoAntes: antes, travada };
  }
  const q = await db.query(`INSERT INTO ag_notas(client_id,nf,ctrc,serie,emitente,remetente,destinatario,cidade,uf,endereco,peso,volumes,produto,status_ssw,previsao,data_emissao,
      situacao,data_entrada,ultima_consulta,ultimo_sync_id,origem,pagador,produto_fonte,produtos_em)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,(NOW() AT TIME ZONE 'America/Sao_Paulo')::date,NOW(),$18,$19,NULLIF($20,''),NULLIF($21,''),
      CASE WHEN $21<>'' THEN NOW() END) RETURNING id`,
    [cli, nf, ctrc, serie, emitente, ...v, situacaoNova || (pendente ? 'pendente' : 'verificar'), syncId, origem, limpo(r.pagador), v[7] ? fonte : '']);
  return { id: q.rows[0].id, nova: true, situacaoAntes: null };
}

// Nota entregue ou devolvida no SSW: sai das listas operacionais (a linha fica para o histórico) e o
// agendamento ativo é encerrado.
async function concluirNota(db, cli, nota, situacao, texto, em, syncId) {
  const data = dataBr(em) || hojeSp();
  await db.query("UPDATE ag_notas SET situacao=$2,status_ssw=COALESCE(NULLIF($3,''),status_ssw),concluido_em=$4,erro_integracao=NULL,ultima_consulta=NOW(),ultimo_sync_id=$5,atualizado_em=NOW() WHERE id=$1",
    [nota.id, situacao, limpo(texto, 300), data, syncId]);
  const ag = await db.query("UPDATE ag_agendamentos SET status=$2,concluido_em=NOW(),atualizado_em=NOW() WHERE nota_id=$1 AND status='ativo' RETURNING id",
    [nota.id, situacao === 'entregue' ? 'concluido' : 'devolvido']);
  await evento(db, cli, nota.id, ag.rows[0]?.id || null, situacao, ROTULO[nota.situacao] || nota.situacao, ROTULO[situacao], texto, 'SSW');
}

// Aplica uma leitura do SSW. snap = {pendentes:[...], verificados:{chave:{situacao,texto,em,erro}}}
// Idempotente: rodar de novo com a mesma leitura não muda nada nem duplica.
async function aplicarSnapshot(db, cli, snap, syncId = null) {
  const c = { pendentes_ssw: 0, novas: 0, atualizadas: 0, entregues: 0, devolvidas: 0, em_rota: 0, verificar: 0, retornaram: 0 };
  const vistos = new Set(), vistosNf = new Set();
  const termos = await termosDe(db, cli);
  for (const r of snap.pendentes || []) {
    const nf = normNf(r.nf), ctrc = normCtrc(r.ctrc);
    if (!nf) continue;
    if (!ehParceiro(termos, r.remetente, r.pagador)) continue;   // cliente que não entra no agendamento
    const k = nf + '|' + ctrc;
    if (vistos.has(k)) continue;
    vistos.add(k); vistosNf.add(nf); c.pendentes_ssw++;
    const g = await gravarNota(db, cli, r, { syncId });
    if (!g) continue;
    if (g.nova) c.novas++;
    else {
      c.atualizadas++;
      if (g.travada) continue;   // o motorista deu baixa no app; o SSW ainda não
      if (FINAIS.includes(g.situacaoAntes)) { c.retornaram++; await evento(db, cli, g.id, null, 'status', ROTULO[g.situacaoAntes], 'Pendente', 'Voltou a constar como pendente no SSW', 'SSW'); }
      else if (g.situacaoAntes && g.situacaoAntes !== 'pendente') await evento(db, cli, g.id, null, 'status', ROTULO[g.situacaoAntes], 'Pendente', null, 'SSW');
    }
  }
  const ver = snap.verificados || {};
  const pOps = [cli, OPERACIONAIS, syncId], fOps = parceiroSql(termos, pOps);
  const ops = await db.query("SELECT id,nf,ctrc,situacao FROM ag_notas n WHERE client_id IS NOT DISTINCT FROM $1 AND tipo_operacao='entrega' AND situacao=ANY($2) AND (ultimo_sync_id IS DISTINCT FROM $3::bigint OR $3::bigint IS NULL)" + (fOps ? ' AND ' + fOps : ''), pOps);
  for (const n of ops.rows) {
    if (vistos.has(n.nf + '|' + n.ctrc) || (!n.ctrc && vistosNf.has(n.nf))) continue;
    const v = ver[n.nf + '|' + n.ctrc] || ver[n.nf + '|'] || null;
    // a conferência no SSW completa o que faltava: CT-e com a série, cidade e o nome inteiro do destinatário
    if (v && (v.ctrc || v.cidade || v.destinatario)) {
      const ctrcSerie = /^[A-Z]{3}/.test(normCtrc(v.ctrc)) ? normCtrc(v.ctrc) : '';
      await db.query(`UPDATE ag_notas SET ctrc=CASE WHEN $2<>'' AND (ctrc='' OR (ctrc !~ '^[A-Z]{3}' AND ${MESMO_NUMERO_CTE.replace(/\$3/g, () => '$2')})) THEN $2 ELSE ctrc END,
          uf=CASE WHEN COALESCE(cidade,'')='' AND $3<>'' AND $4<>'' THEN $4 ELSE uf END, cidade=CASE WHEN COALESCE(cidade,'')='' THEN COALESCE(NULLIF($3,''),cidade) ELSE cidade END,
          destinatario=CASE WHEN $5<>'' AND (COALESCE(destinatario,'')='' OR destinatario ~ '\\.\\.\\)?\\s*$') THEN $5 ELSE destinatario END WHERE id=$1`,
        [n.id, ctrcSerie, limpo(v.cidade, 80), limpo(v.uf, 2).toUpperCase(), limpo(v.destinatario)]);
    }
    if (v && (v.situacao === 'entregue' || v.situacao === 'devolvida')) {
      await concluirNota(db, cli, n, v.situacao, v.texto, v.em, syncId);
      c[v.situacao === 'entregue' ? 'entregues' : 'devolvidas']++;
    } else if (v && v.situacao === 'em_rota') {
      await db.query("UPDATE ag_notas SET situacao='em_rota',status_ssw=COALESCE(NULLIF($2,''),status_ssw),ctrc=CASE WHEN ctrc='' THEN $3 ELSE ctrc END,erro_integracao=NULL,ultima_consulta=NOW(),ultimo_sync_id=$4,atualizado_em=NOW() WHERE id=$1",
        [n.id, limpo(v.texto, 300), normCtrc(v.ctrc), syncId]);
      if (n.situacao !== 'em_rota') await evento(db, cli, n.id, null, 'status', ROTULO[n.situacao], ROTULO.em_rota, v.texto, 'SSW');
      c.em_rota++;
    } else if (n.situacao === 'em_rota') {
      // já estava em rota e o SSW não respondeu desta vez: guarda o último estado válido
      await db.query("UPDATE ag_notas SET erro_integracao=$2,atualizado_em=NOW() WHERE id=$1", [n.id, v && v.erro ? limpo(v.erro, 300) : null]);
      c.em_rota++;
    } else {
      const motivo = v && v.erro ? 'Situação não confirmada no SSW: ' + limpo(v.erro, 250) : 'Saiu das pendências do SSW e a situação não foi confirmada';
      await db.query("UPDATE ag_notas SET situacao='verificar',erro_integracao=$2,atualizado_em=NOW() WHERE id=$1", [n.id, motivo]);
      if (n.situacao !== 'verificar') await evento(db, cli, n.id, null, 'status', ROTULO[n.situacao], ROTULO.verificar, motivo, 'SSW');
      c.verificar++;
    }
  }
  return c;
}

// Baixa pelo app do motorista: comprovante "entregue" (entregas.js, tabela entregas_comprovantes) da mesma NF
// (e do mesmo CT-e, quando o comprovante tem) registrado depois da entrada da nota -> nota entregue no agendamento.
// O comprovante mais recente da parada vale (um "não entregue" depois do "entregue" desfaz).
// Marca a nota como entregue pela baixa do motorista e conclui o agendamento ativo (só se ainda estiver em aberto).
async function darBaixa(pool, notaId, quando, texto, compId, usuario) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const n = (await db.query("SELECT id,client_id,situacao FROM ag_notas WHERE id=$1 AND situacao=ANY($2) FOR UPDATE", [notaId, OPERACIONAIS])).rows[0];
    if (!n) { await db.query('ROLLBACK'); return false; }
    await db.query("UPDATE ag_notas SET situacao='entregue',status_ssw=$2,concluido_em=$3,erro_integracao=NULL,baixa_motorista_em=$4,baixa_comprovante_id=$5,atualizado_em=NOW() WHERE id=$1",
      [n.id, texto, quando.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), quando.toISOString(), compId || null]);
    const ag = await db.query("UPDATE ag_agendamentos SET status='concluido',concluido_em=NOW(),atualizado_em=NOW() WHERE nota_id=$1 AND status='ativo' RETURNING id", [n.id]);
    await evento(db, n.client_id, n.id, ag.rows[0]?.id || null, 'entregue', ROTULO[n.situacao] || n.situacao, ROTULO.entregue, texto, usuario);
    await db.query('COMMIT');
    return true;
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
}
const quandoBr = d => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
// Só os dígitos do número do CT-e com o dígito verificador ("AMR017002-0" e "017002-0" -> "170020").
const ctrcDigitos = v => String(v || '').replace(/^[^0-9]*/, '').replace(/\D/g, '').replace(/^0+/, '');
// Data/hora da baixa no SSW ("2026-10-28T08:38:38" ou "28/10/2026 08:38"), no horário de Brasília.
function dataBaixa(v) {
  const t = String(v || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) { const b = t.match(/^(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/); if (b) m = [b[0], b[3].length === 2 ? '20' + b[3] : b[3], b[2], b[1], b[4], b[5], b[6]]; }
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] || '12'}:${m[5] || '00'}:${m[6] || '00'}-03:00`);
  return isNaN(d) ? null : d;
}
// Baixas dos motoristas: o rastreio do SSW (ocorrência 01, MERCADORIA ENTREGUE) e o comprovante do app MOVIT.
// lerBaixas() devolve { rows: [{ ctrc, ctrcOficial, nf, motorista, baixaDataHora }] } com as entregues do SSW.
async function baixasDosMotoristas(pool, { lerBaixas, ontem } = {}) {
  const c = { conferidas: 0, entregues: 0, baixas_ssw: 0 };
  if (lerBaixas) {
    const r = await lerBaixas({ ontem: !!ontem });
    if (!r || r.ok === false) throw new Error((r && r.error) || 'O SSW não respondeu.');
    const baixas = Array.isArray(r.rows) ? r.rows : [];
    c.baixas_ssw = baixas.length;
    const notas = (await pool.query(`SELECT id,nf,ctrc,COALESCE(data_entrada,data_emissao) AS desde FROM ag_notas
       WHERE tipo_operacao='entrega' AND situacao=ANY($1)
         AND (client_id IS NULL OR client_id IN (SELECT id FROM movit_clients WHERE lower(slug)='construlog'))`, [OPERACIONAIS])).rows;
    const porNf = new Map();
    for (const n of notas) { if (!porNf.has(n.nf)) porNf.set(n.nf, []); porNf.get(n.nf).push(n); }
    c.conferidas += notas.length;
    const feitas = new Set();
    for (const b of baixas) {
      const quando = dataBaixa(b.baixaDataHora) || new Date();
      const ctes = [b.ctrc, b.ctrcOficial].map(ctrcDigitos).filter(Boolean);
      for (const nf of new Set(String(b.nf || '').split(/\D+/).map(normNf).filter(Boolean))) {
        for (const n of porNf.get(nf) || []) {
          if (feitas.has(n.id)) continue;
          if (n.ctrc && ctes.length && !ctes.includes(ctrcDigitos(n.ctrc))) continue;   // outra nota com o mesmo número
          if (n.desde && quando < new Date(new Date(n.desde).getTime() - 2 * 86400000)) continue;   // baixa antiga de outra nota
          const texto = 'Baixa do motorista ' + (limpo(b.motorista, 80) || 'no SSW') + ' em ' + quandoBr(quando);
          if (await darBaixa(pool, n.id, quando, texto, null, 'Baixa do motorista (SSW)')) { feitas.add(n.id); c.entregues++; }
        }
      }
    }
  }
  const q = await pool.query(`SELECT n.id,n.client_id,n.nf,n.ctrc,n.situacao,x.id AS comp_id,x.ctrc AS comp_ctrc,x.resultado,x.driver_name,x.registrado_em
      FROM ag_notas n
      JOIN LATERAL (
        SELECT c.* FROM entregas_comprovantes c
         WHERE (c.client_id IS NOT DISTINCT FROM n.client_id OR (c.client_id IS NULL AND n.client_id IN (SELECT id FROM movit_clients WHERE lower(slug)='construlog')))
           AND n.nf IN (SELECT ltrim(t,'0') FROM regexp_split_to_table(c.nf,'\\D+') t)
           AND c.registrado_em >= COALESCE(n.data_entrada,n.data_emissao,CURRENT_DATE) - INTERVAL '2 days'
         ORDER BY c.registrado_em DESC LIMIT 5) x ON TRUE
     WHERE n.tipo_operacao='entrega' AND n.situacao=ANY($1)
     ORDER BY n.id, x.registrado_em DESC`, [OPERACIONAIS]);
  const porNota = new Map();
  for (const r of q.rows) {
    if (r.ctrc && r.comp_ctrc && normCtrc(r.comp_ctrc) !== r.ctrc) continue;   // outra nota com o mesmo número
    if (!porNota.has(r.id)) porNota.set(r.id, r);
  }
  for (const r of porNota.values()) {
    if (!lerBaixas) c.conferidas++;
    if (r.resultado !== 'entregue') continue;
    const quando = new Date(r.registrado_em), texto = 'Baixa no app pelo motorista ' + limpo(r.driver_name, 80) + ' em ' + quandoBr(quando);
    if (await darBaixa(pool, r.id, quando, texto, r.comp_id, 'App do motorista')) c.entregues++;
  }
  console.log('AGENDAMENTO baixas dos motoristas: ' + JSON.stringify(c));
  return c;
}
// De hora em hora, das 07:00 às 19:00 (Brasília): uma rodada no começo de cada hora.
// A das 07:00 (e a que roda logo depois de subir) confere também a véspera, para pegar as baixas da noite.
function iniciarBaixasMotoristas({ pool, lerBaixas }) {
  let ultima = '';
  const rodar = async ontem => { try { await baixasDosMotoristas(pool, { lerBaixas, ontem }); } catch (e) { console.log('AGENDAMENTO baixas dos motoristas ERRO: ' + (e.message || e)); } };
  const tick = async () => {
    const h = Number(horaSp().slice(0, 2)), k = hojeSp() + ' ' + h;
    if (h < 7 || h > 19 || k === ultima) return;
    ultima = k;
    await rodar(h === 7);
  };
  setTimeout(() => { ultima = hojeSp() + ' ' + Number(horaSp().slice(0, 2)); rodar(true); }, 60 * 1000);
  return setInterval(tick, 60 * 1000);
}

// Dígito do CT-e no SSW: módulo 11, pesos 2 a 9 a partir da direita; resto 0 -> 1, resto 1 -> 0.
function dvCtrc(numero) {
  const ds = String(numero || '').replace(/\D/g, '').split('').reverse();
  const r = ds.reduce((s, d, i) => s + Number(d) * (2 + (i % 8)), 0) % 11;
  return r === 0 ? 1 : r === 1 ? 0 : 11 - r;
}
// "AMR017002-0" ou "017002-0" (com a série à parte) -> {serie, numero}; confere o dígito.
function lerNumeroCte(v, serie) {
  const m = String(v || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{3})?0*(\d{1,9})-?(\d)$/);
  if (!m) return { erro: 'Informe o CT-e com o dígito, ex.: AMR017002-0.' };
  const s = m[1] || String(serie || 'AMR').toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(s)) return { erro: 'Série do CT-e inválida (3 letras, ex.: AMR).' };
  if (dvCtrc(m[2]) !== Number(m[3])) return { erro: 'Dígito errado em ' + v + ': o certo é ' + s + m[2].padStart(6, '0') + '-' + dvCtrc(m[2]) + '.' };
  return { serie: s, numero: Number(m[2]) };
}
const MAX_FAIXA = 200;
// Lista dos CT-es de uma faixa (do inicial ao final, os dois com dígito).
function faixaCtes(b) {
  const a = lerNumeroCte(b.de, b.serie), z = lerNumeroCte(b.ate || b.de, b.serie);
  const erro = a.erro || z.erro || (a.serie !== z.serie ? 'O CT-e inicial e o final precisam ser da mesma série.' : '') ||
    (z.numero < a.numero ? 'O CT-e final é menor que o inicial.' : '') ||
    (z.numero - a.numero + 1 > MAX_FAIXA ? 'Faixa grande demais: no máximo ' + MAX_FAIXA + ' CT-es por vez.' : '');
  if (erro) { const e = new Error(erro); e.status = 400; throw e; }
  const out = [];
  for (let n = a.numero; n <= z.numero; n++) out.push(a.serie + String(n).padStart(6, '0') + '-' + dvCtrc(n));
  return out;
}
// Importa uma faixa de CT-es (ou subcontratos) do SSW para o agendamento: entram como pendentes, sem agendamento.
// lerFaixa({ctes}) devolve {rows:[{ctrc,nf,remetente,pagador,destinatario,cidade,uf,peso,volumes,previsao,emissao,status,situacao}]}.
async function importarFaixa(pool, cli, user, b, lerFaixa, progresso = () => {}) {
  const ctes = faixaCtes(b);
  if (!lerFaixa) { const e = new Error('A leitura do SSW não está disponível neste servidor.'); e.status = 503; throw e; }
  const c = { pedidos: ctes.length, lidos: 0, novas: 0, ja_existiam: 0, nao_encontrados: [], finalizados: [], fora_parceiros: [], erros: [] };
  const termos = await termosDe(pool, cli);
  // em blocos de 10: o que já foi lido fica gravado mesmo se o SSW cair no meio
  for (let i = 0; i < ctes.length; i += 10) {
    const r = await lerFaixa({ ctes: ctes.slice(i, i + 10) });
    if (!r || r.ok === false) throw new Error((r && r.error) || 'O SSW não respondeu.');
    await gravarFaixa(pool, cli, user, r.rows || [], termos, c);
    c.lidos = Math.min(ctes.length, i + 10);
    progresso(c);
  }
  if (c.fora_nomes) c.fora_nomes = Object.entries(c.fora_nomes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => k + ' (' + n + ')');
  console.log('AGENDAMENTO importação de CT-es: ' + JSON.stringify({ ...c, nao_encontrados: c.nao_encontrados.length, finalizados: c.finalizados.length, fora_parceiros: c.fora_parceiros.length, erros: c.erros.length }));
  return c;
}
async function gravarFaixa(pool, cli, user, rows, termos, c) {
  for (const x of rows) {
    if (x.situacao === 'nao_encontrado' || !normNf(x.nf)) { c.nao_encontrados.push(x.ctrc); continue; }
    if (x.situacao === 'erro') { c.erros.push(x.ctrc); continue; }
    if (x.situacao === 'entregue' || x.situacao === 'devolvida') { c.finalizados.push(x.ctrc + ' (' + ROTULO[x.situacao].toLowerCase() + ')'); continue; }
    if (!ehParceiro(termos, x.remetente, x.pagador)) {
      c.fora_parceiros.push(x.ctrc);
      // quem são (para conferir a lista de parceiros): remetente / pagador mais frequentes
      const k = limpo(x.remetente, 60) + ' / ' + limpo(x.pagador, 60);
      c.fora_nomes = c.fora_nomes || {}; c.fora_nomes[k] = (c.fora_nomes[k] || 0) + 1;
      continue;
    }
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const g = await gravarNota(db, cli, x, { origem: 'importacao', pendente: false, situacaoNova: 'pendente' });
      if (g && g.nova) { c.novas++; await evento(db, cli, g.id, null, 'importada', null, ROTULO.pendente, 'Importada do SSW pela faixa de CT-es (' + x.ctrc + ')', limpo(user.username, 80)); }
      else if (g) c.ja_existiam++;
      await db.query('COMMIT');
    } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
  }
}
// Importações em andamento (a leitura leva alguns segundos por CT-e): a tela acompanha pelo id.
const IMPORTACOES = new Map();
function iniciarImportacao(pool, cli, user, b, lerFaixa) {
  const total = faixaCtes(b).length;   // valida antes de começar
  if (!lerFaixa) { const e = new Error('A leitura do SSW não está disponível neste servidor.'); e.status = 503; throw e; }
  for (const [k, v] of IMPORTACOES) if (v.fim && Date.now() - v.fim > 3600 * 1000) IMPORTACOES.delete(k);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const job = { id, cli: String(cli || 0), status: 'rodando', total, lidos: 0, resultado: null, erro: null, fim: 0 };
  IMPORTACOES.set(id, job);
  importarFaixa(pool, cli, user, b, lerFaixa, c => { job.lidos = c.lidos; job.resultado = c; })
    .then(c => { job.status = 'ok'; job.resultado = c; job.lidos = c.lidos; })
    .catch(e => { job.status = 'erro'; job.erro = limpo(e.message || e, 300); console.log('AGENDAMENTO importação de CT-es ERRO: ' + job.erro); })
    .finally(() => { job.fim = Date.now(); });
  return { id, total };
}

// Notas que a varredura precisa conferir no SSW (as operacionais que já conhecemos).
async function alvosDaVarredura(db, cli) {
  const params = [cli, OPERACIONAIS], f = parceiroSql(await termosDe(db, cli), params);
  const q = await db.query("SELECT nf,ctrc FROM ag_notas n WHERE client_id IS NOT DISTINCT FROM $1 AND tipo_operacao='entrega' AND situacao=ANY($2)" + (f ? ' AND ' + f : '') + " ORDER BY (situacao='pendente') DESC, id LIMIT 3000", params);
  return q.rows.map(r => ({ chave: r.nf + '|' + r.ctrc, nf: r.nf, ctrc: r.ctrc }));
}

const RODANDO = new Map();   // empresa -> promessa da varredura em andamento (uma por vez)
// Roda uma varredura completa. lerSsw(alvos) devolve a leitura do SSW (ou lança erro).
async function sincronizar({ pool, cli, origem, usuario, lerSsw }) {
  const k = String(cli || 0);
  if (RODANDO.has(k)) { const e = new Error('Já existe uma sincronização com o SSW em andamento.'); e.status = 409; e.emAndamento = true; throw e; }
  const s = await pool.query('INSERT INTO ag_sincronizacoes(client_id,origem,usuario) VALUES($1,$2,$3) RETURNING id', [cli, origem, usuario || null]);
  const syncId = s.rows[0].id;
  const p = (async () => {
    try {
      const alvos = await alvosDaVarredura(pool, cli);
      const snap = await lerSsw(alvos);
      if (!snap || snap.ok === false) throw new Error((snap && snap.error) || 'O SSW não respondeu.');
      if (!Array.isArray(snap.pendentes) || !snap.pendentes.length) throw new Error('O SSW não devolveu nenhuma nota pendente; nada foi alterado.');
      const db = await pool.connect();
      let c;
      try {
        await db.query('BEGIN');
        c = await aplicarSnapshot(db, cli, snap, syncId);
        await db.query(`UPDATE ag_sincronizacoes SET status='ok',finalizado_em=NOW(),pendentes_ssw=$2,novas=$3,atualizadas=$4,entregues=$5,devolvidas=$6,em_rota=$7,verificar=$8,retornaram=$9,detalhes=$10 WHERE id=$1`,
          [syncId, c.pendentes_ssw, c.novas, c.atualizadas, c.entregues, c.devolvidas, c.em_rota, c.verificar, c.retornaram,
            JSON.stringify({ fonte: snap.source || 'SSW', alvos: alvos.length, conferidas: Object.keys(snap.verificados || {}).length, avisos: (snap.avisos || []).slice(0, 20) })]);
        await db.query('COMMIT');
      } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
      console.log('AGENDAMENTO sincronização ' + syncId + ' ok: ' + JSON.stringify(c));
      return { id: syncId, status: 'ok', ...c };
    } catch (e) {
      const msg = limpo(e && e.message || e, 500);
      await pool.query("UPDATE ag_sincronizacoes SET status='erro',erro=$2,finalizado_em=NOW() WHERE id=$1", [syncId, msg]).catch(() => {});
      console.log('AGENDAMENTO sincronização ' + syncId + ' ERRO: ' + msg);
      return { id: syncId, status: 'erro', erro: msg };
    } finally { RODANDO.delete(k); }
  })();
  RODANDO.set(k, p);
  return { id: syncId, promessa: p };
}

// Varredura automática: confere a cada minuto se chegou o horário configurado (padrão 02:00, Brasília).
// Se falhar, tenta de novo a cada 30 min, até 3 tentativas no dia.
function iniciarVarreduraAutomatica({ pool, clientes, lerSsw }) {
  const tick = async () => {
    try {
      const agora = horaSp(), hoje = hojeSp();
      for (const cli of await clientes()) {
        if (RODANDO.has(String(cli || 0))) continue;
        const cfg = await lerConfig(pool, cli);
        if (!cfg.sync_ativa || agora < cfg.hora_sync) continue;
        const q = await pool.query(`SELECT status,iniciado_em FROM ag_sincronizacoes WHERE client_id IS NOT DISTINCT FROM $1 AND origem='automatica'
          AND (iniciado_em AT TIME ZONE 'America/Sao_Paulo')::date=$2 ORDER BY iniciado_em DESC`, [cli, hoje]);
        if (q.rows.some(r => r.status === 'ok' || r.status === 'rodando') || q.rows.length >= 3) continue;
        if (q.rows[0] && Date.now() - new Date(q.rows[0].iniciado_em).getTime() < 30 * 60 * 1000) continue;
        await sincronizar({ pool, cli, origem: 'automatica', usuario: 'Varredura ' + cfg.hora_sync, lerSsw: alvos => lerSsw(cli, alvos) }).catch(e => console.log('AGENDAMENTO varredura: ' + e.message));
      }
    } catch (e) { console.log('AGENDAMENTO varredura automática ERRO: ' + (e.message || e)); }
  };
  setTimeout(tick, 60 * 1000);
  return setInterval(tick, 60 * 1000);
}

// POST JSON para o leitor do SSW (processo do painel) e devolve a resposta.
function postJson(porta, caminho, headers, corpo, timeoutMs = 12 * 60 * 1000) {
  return new Promise((ok, falha) => {
    const dados = Buffer.from(JSON.stringify(corpo || {}));
    const r = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: 'POST', timeout: timeoutMs,
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': dados.length, Accept: 'application/json' } }, res => {
      let txt = ''; res.setEncoding('utf8');
      res.on('data', c => { txt += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(txt); } catch {} if (res.statusCode !== 200 || !j || j.ok === false) return falha(new Error((j && j.error) || ('Leitura do SSW respondeu HTTP ' + res.statusCode))); ok(j); });
    });
    r.on('timeout', () => r.destroy(new Error('A leitura do SSW demorou demais.')));
    r.on('error', falha);
    r.end(dados);
  });
}

// ------------------------------------------------------------------ consultas das telas
const SEL_NOTA = `n.id::text AS nota_id,n.nf,n.serie,n.ctrc,n.remetente,n.pagador,n.produto_fonte,n.destinatario,n.cidade,n.uf,n.endereco,n.peso::float8 AS peso,n.volumes::float8 AS volumes,
  n.produto,n.situacao,n.status_ssw,n.previsao,to_char(n.data_emissao,'YYYY-MM-DD') AS data_emissao,to_char(n.data_entrada,'YYYY-MM-DD') AS data_entrada,
  n.ultima_consulta,n.erro_integracao,to_char(n.concluido_em,'YYYY-MM-DD') AS concluido_em,
  ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date-COALESCE(n.data_entrada,n.data_emissao,(n.primeiro_visto AT TIME ZONE 'America/Sao_Paulo')::date))::int AS dias_sem`;
const SEL_AG = `a.id::text AS agendamento_id,to_char(a.data_agendada,'YYYY-MM-DD') AS data_agendada,a.observacao,a.reagendamentos,a.criado_por_nome,a.criado_em AS agendado_em,a.status AS status_agendamento`;
const DIAS_SEM_SQL = "((NOW() AT TIME ZONE 'America/Sao_Paulo')::date-COALESCE(n.data_entrada,n.data_emissao,(n.primeiro_visto AT TIME ZONE 'America/Sao_Paulo')::date))";
const HOJE_SQL = "(NOW() AT TIME ZONE 'America/Sao_Paulo')::date";

// O produto é o que o operador digitou ao agendar; o que veio do SSW/BI2 não aparece (vem ilegível).
const comProdutoLimpo = r => (r.produto_fonte === 'operador' ? r : { ...r, produto: '' });

function filtrosEntrega(f, params, aba) {
  const w = [];
  const p = v => { params.push(v); return '$' + params.length; };
  const like = v => '%' + String(v).replace(/[\\%_]/g, m => '\\' + m) + '%';
  const de = dataIso(f.de), ate = dataIso(f.ate);
  const campoData = aba === 'agendadas' ? 'a.data_agendada' : aba === 'pendentes' ? 'COALESCE(a.data_agendada,n.data_entrada,n.data_emissao)' : aba === 'historico' ? 'COALESCE(n.concluido_em,(n.atualizado_em AT TIME ZONE \'America/Sao_Paulo\')::date)' : 'COALESCE(n.data_entrada,n.data_emissao)';
  if (de) w.push(campoData + '>=' + p(de) + '::date');
  if (ate) w.push(campoData + '<=' + p(ate) + '::date');
  if (f.remetente) w.push('n.remetente ILIKE ' + p(like(limpo(f.remetente, 80))));
  if (f.destinatario) w.push('n.destinatario ILIKE ' + p(like(limpo(f.destinatario, 80))));
  if (f.cidade) w.push('n.cidade ILIKE ' + p(like(limpo(f.cidade, 80))));
  if (normNf(f.nf)) w.push('n.nf=' + p(normNf(f.nf)));
  if (SITUACOES.includes(f.status)) w.push('n.situacao=' + p(f.status));
  if (Number(f.dias_min) > 0) w.push(DIAS_SEM_SQL + '>=' + p(Math.floor(Number(f.dias_min))));
  if (f.q) { const t = p(like(limpo(f.q, 80))); w.push(`(n.nf ILIKE ${t} OR n.ctrc ILIKE ${t} OR n.remetente ILIKE ${t} OR n.destinatario ILIKE ${t} OR n.cidade ILIKE ${t} OR (n.produto_fonte='operador' AND n.produto ILIKE ${t}))`); }
  if (aba === 'agendadas' || aba === 'pendentes') {
    if (f.card === 'hoje') w.push('a.data_agendada=' + HOJE_SQL);
    if (f.card === 'amanha') w.push('a.data_agendada=' + HOJE_SQL + '+1');
    if (f.card === 'vencidas') w.push('a.data_agendada<' + HOJE_SQL);
  }
  return w;
}

async function listar(db, cli, aba, f) {
  const per = Math.max(1, Math.min(5000, Number(f.per) || 50)), page = Math.max(1, Number(f.page) || 1);
  if (aba === 'coletas') return listarColetas(db, cli, f, per, page);
  const params = [cli, OPERACIONAIS];
  let base, ordem, sel = SEL_NOTA + ',' + SEL_AG;
  if (aba === 'agendadas') {
    // as ativas; com o período começando antes de hoje, também as já entregues daqueles dias (consulta de datas anteriores)
    const passadas = !!dataIso(f.de) && dataIso(f.de) < hojeSp();
    base = passadas
      ? `FROM ag_notas n JOIN ag_agendamentos a ON a.nota_id=n.id AND (a.status='ativo' OR (a.status='concluido' AND a.data_agendada<${HOJE_SQL}))
      WHERE n.client_id IS NOT DISTINCT FROM $1 AND n.tipo_operacao='entrega' AND (n.situacao=ANY($2) OR a.status='concluido')`
      : "FROM ag_notas n JOIN ag_agendamentos a ON a.nota_id=n.id AND a.status='ativo' WHERE n.client_id IS NOT DISTINCT FROM $1 AND n.tipo_operacao='entrega' AND n.situacao=ANY($2)";
    ordem = 'a.data_agendada, n.nf';
  } else if (aba === 'sem') {
    base = "FROM ag_notas n LEFT JOIN ag_agendamentos a ON a.nota_id=n.id AND a.status='ativo' WHERE n.client_id IS NOT DISTINCT FROM $1 AND n.tipo_operacao='entrega' AND n.situacao=ANY($2) AND a.id IS NULL";
    ordem = DIAS_SEM_SQL + ' DESC, n.nf';
  } else if (aba === 'pendentes') {
    base = "FROM ag_notas n LEFT JOIN ag_agendamentos a ON a.nota_id=n.id AND a.status='ativo' WHERE n.client_id IS NOT DISTINCT FROM $1 AND n.tipo_operacao='entrega' AND n.situacao=ANY($2)";
    ordem = 'a.data_agendada NULLS LAST, ' + DIAS_SEM_SQL + ' DESC, n.nf';
  } else if (aba === 'historico') {
    // entregues, devolvidas e as notas com agendamento cancelado ou reagendado
    base = `FROM ag_notas n LEFT JOIN LATERAL (SELECT * FROM ag_agendamentos x WHERE x.nota_id=n.id ORDER BY x.id DESC LIMIT 1) a ON TRUE
      WHERE n.client_id IS NOT DISTINCT FROM $1 AND n.tipo_operacao='entrega' AND ($2::text[] IS NOT NULL) AND (n.situacao IN ('entregue','devolvida')
        OR EXISTS (SELECT 1 FROM ag_agendamentos y WHERE y.nota_id=n.id AND (y.status='cancelado' OR y.reagendamentos>0)))`;
    sel += `,(SELECT COUNT(*) FROM ag_agendamentos y WHERE y.nota_id=n.id AND y.status='cancelado')::int AS cancelamentos,
      (SELECT COALESCE(SUM(y.reagendamentos),0) FROM ag_agendamentos y WHERE y.nota_id=n.id)::int AS total_reagendamentos`;
    ordem = 'n.atualizado_em DESC';
  } else { const e = new Error('Aba inválida.'); e.status = 400; throw e; }
  const w = filtrosEntrega(f, params, aba);
  if (aba !== 'historico') { const fp = parceiroSql(await termosDe(db, cli), params); if (fp) w.push(fp); }
  const where = base + (w.length ? ' AND ' + w.join(' AND ') : '');
  const tot = await db.query('SELECT COUNT(*)::int AS n,COALESCE(SUM(n.peso),0)::float8 AS peso,COALESCE(SUM(n.volumes),0)::float8 AS volumes ' + where, params);
  params.push(per, (page - 1) * per);
  const q = await db.query('SELECT ' + sel + ' ' + where + ' ORDER BY ' + ordem + ' LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length, params);
  return { rows: q.rows.map(comProdutoLimpo), total: tot.rows[0].n, peso: tot.rows[0].peso, volumes: tot.rows[0].volumes, page, per };
}

// Coletas programadas (tabela de coletas da Lotação), só leitura: as que ainda não foram entregues nem canceladas.
async function listarColetas(db, cli, f, per, page) {
  const params = [cli], w = [];
  const p = v => { params.push(v); return '$' + params.length; };
  const like = v => '%' + String(v).replace(/[\\%_]/g, m => '\\' + m) + '%';
  const J = k => "COALESCE(to_jsonb(c)->>'" + k + "','')";
  const data = "COALESCE(NULLIF(to_jsonb(c)->>'data_coleta',''),NULLIF(to_jsonb(c)->>'data_carregamento',''),NULLIF(to_jsonb(c)->>'collection_date',''),LEFT(COALESCE(to_jsonb(c)->>'created_at',''),10))";
  w.push("c.client_id IS NOT DISTINCT FROM $1");
  if (f.status === 'todas') { /* inclui entregues e canceladas */ } else w.push("lower(" + J('status') + ") NOT LIKE 'entreg%' AND lower(" + J('status') + ") NOT LIKE 'cancel%'");
  if (dataIso(f.de)) w.push('LEFT(' + data + ',10)>=' + p(dataIso(f.de)));
  if (dataIso(f.ate)) w.push('LEFT(' + data + ',10)<=' + p(dataIso(f.ate)));
  if (f.remetente) w.push("(" + J('cliente') + " ILIKE " + p(like(limpo(f.remetente, 80))) + ")");
  if (f.destinatario) w.push("(" + J('destinatario') + " ILIKE " + p(like(limpo(f.destinatario, 80))) + ")");
  if (f.cidade) { const t = p(like(limpo(f.cidade, 80))); w.push("(" + J('destino') + " ILIKE " + t + " OR " + J('origem') + " ILIKE " + t + " OR " + J('cidade_entrega') + " ILIKE " + t + ")"); }
  if (f.q) { const t = p(like(limpo(f.q, 80))); w.push("(to_jsonb(c)::text ILIKE " + t + ")"); }
  const where = 'FROM coletas c WHERE ' + w.join(' AND ');
  const tot = await db.query('SELECT COUNT(*)::int AS n ' + where, params);
  params.push(per, (page - 1) * per);
  const q = await db.query(`SELECT c.id::text AS id,
      COALESCE(NULLIF(to_jsonb(c)->>'os_numero',''),NULLIF(to_jsonb(c)->>'numero_os',''),NULLIF(to_jsonb(c)->>'os',''),NULLIF(to_jsonb(c)->>'numero_coleta',''),'') AS os,
      ${J('cliente')} AS remetente, ${J('destinatario')} AS destinatario,
      COALESCE(NULLIF(to_jsonb(c)->>'origem',''),NULLIF(to_jsonb(c)->>'cidade_coleta',''),NULLIF(to_jsonb(c)->>'endereco_coleta',''),'') AS origem,
      COALESCE(NULLIF(to_jsonb(c)->>'destino',''),NULLIF(to_jsonb(c)->>'cidade_entrega',''),NULLIF(to_jsonb(c)->>'endereco_entrega',''),'') AS destino,
      COALESCE(NULLIF(to_jsonb(c)->>'motorista',''),NULLIF(to_jsonb(c)->>'nome_motorista',''),'') AS motorista,
      ${J('placa')} AS placa, ${J('status')} AS status, LEFT(${data},10) AS data_coleta
    ${where} ORDER BY LEFT(${data},10), c.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params).catch(e => { if (/relation "coletas"/.test(e.message)) return { rows: [] }; throw e; });
  return { rows: q.rows, total: tot.rows[0].n, peso: 0, volumes: 0, page, per };
}

async function ultimaSync(db, cli) {
  const q = await db.query(`SELECT id::text,origem,usuario,status,iniciado_em,finalizado_em,pendentes_ssw,novas,atualizadas,entregues,devolvidas,em_rota,verificar,retornaram,erro
    FROM ag_sincronizacoes WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY iniciado_em DESC LIMIT 1`, [cli]);
  const ok = await db.query(`SELECT id::text,origem,usuario,status,iniciado_em,finalizado_em,pendentes_ssw,novas,atualizadas,entregues,devolvidas,em_rota,verificar,retornaram
    FROM ag_sincronizacoes WHERE client_id IS NOT DISTINCT FROM $1 AND status='ok' ORDER BY iniciado_em DESC LIMIT 1`, [cli]);
  return { ultima: q.rows[0] || null, ultimaOk: ok.rows[0] || null };
}

async function indicadores(db, cli) {
  const params = [cli, OPERACIONAIS], fp = parceiroSql(await termosDe(db, cli), params);
  const q = await db.query(`SELECT COUNT(*)::int AS pendentes,
      COUNT(a.id)::int AS com_agendamento,
      COUNT(*) FILTER (WHERE a.id IS NULL)::int AS sem_agendamento,
      COUNT(*) FILTER (WHERE a.data_agendada=${HOJE_SQL})::int AS hoje,
      COUNT(*) FILTER (WHERE a.data_agendada=${HOJE_SQL}+1)::int AS amanha,
      COUNT(*) FILTER (WHERE a.data_agendada<${HOJE_SQL})::int AS vencidas,
      COUNT(*) FILTER (WHERE n.situacao='verificar')::int AS verificar,
      COALESCE(SUM(n.peso),0)::float8 AS peso_pendente
    FROM ag_notas n LEFT JOIN ag_agendamentos a ON a.nota_id=n.id AND a.status='ativo'
    WHERE n.client_id IS NOT DISTINCT FROM $1 AND n.tipo_operacao='entrega' AND n.situacao=ANY($2)` + (fp ? ' AND ' + fp : ''), params);
  const s = await ultimaSync(db, cli);
  const r = q.rows[0];
  r.entregues_ultima = s.ultimaOk ? s.ultimaOk.entregues : 0;
  r.devolvidas_ultima = s.ultimaOk ? s.ultimaOk.devolvidas : 0;
  const idadeH = s.ultimaOk ? (Date.now() - new Date(s.ultimaOk.finalizado_em || s.ultimaOk.iniciado_em).getTime()) / 3600000 : null;
  const falhou = !!(s.ultima && s.ultima.status === 'erro');
  return { ...r, sync: s, desatualizado: idadeH === null || idadeH > 26 || falhou, idade_horas: idadeH === null ? null : Math.round(idadeH * 10) / 10, falhou, rodando: RODANDO.has(String(cli || 0)) };
}

async function buscarNf(db, cli, nf) {
  const q = await db.query('SELECT ' + SEL_NOTA + ',' + SEL_AG + " FROM ag_notas n LEFT JOIN ag_agendamentos a ON a.nota_id=n.id AND a.status='ativo' WHERE n.client_id IS NOT DISTINCT FROM $1 AND n.tipo_operacao='entrega' AND n.nf=$2 ORDER BY (n.situacao=ANY($3)) DESC, n.id DESC LIMIT 20",
    [cli, normNf(nf), OPERACIONAIS]);
  return q.rows.map(comProdutoLimpo);
}

async function historicoNota(db, cli, notaId) {
  const n = await db.query('SELECT ' + SEL_NOTA + ' FROM ag_notas n WHERE n.id=$1 AND n.client_id IS NOT DISTINCT FROM $2', [notaId, cli]);
  if (!n.rowCount) return null;
  const a = await db.query("SELECT id::text,to_char(data_agendada,'YYYY-MM-DD') AS data_agendada,observacao,status,reagendamentos,criado_por_nome,criado_em,motivo_cancelamento,cancelado_por,cancelado_em,concluido_em FROM ag_agendamentos WHERE nota_id=$1 ORDER BY id DESC", [notaId]);
  const e = await db.query('SELECT id::text,agendamento_id::text,tipo,de,para,detalhe,usuario,criado_em FROM ag_eventos WHERE nota_id=$1 ORDER BY criado_em DESC,id DESC LIMIT 300', [notaId]);
  return { nota: n.rows[0], agendamentos: a.rows, eventos: e.rows };
}

const erro = (status, msg) => { const e = new Error(msg); e.status = status; return e; };
function validarData(v) {
  const d = dataIso(v);
  if (!d) throw erro(400, 'Informe a data do agendamento.');
  if (d < hojeSp()) throw erro(400, 'A data do agendamento não pode ser anterior a hoje.');
  if (d > hojeSp(new Date(Date.now() + 366 * 86400000))) throw erro(400, 'A data do agendamento está longe demais. Confira o ano.');
  return d;
}
const brData = d => d ? String(d).split('-').reverse().join('/') : '';

async function agendar(pool, cli, user, b) {
  const data = validarData(b.data_agendada || b.data);
  const obs = limpo(b.observacao, 1000);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    let notaId = b.nota_id ? String(b.nota_id) : '';
    if (notaId) {
      const n = await db.query('SELECT id FROM ag_notas WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2', [notaId, cli]);
      if (!n.rowCount) throw erro(404, 'Nota não encontrada.');
    } else {
      const nota = b.nota || {};
      if (!normNf(nota.nf)) throw erro(400, 'Informe a nota fiscal.');
      // nota consultada agora no SSW, antes de aparecer numa varredura
      // (uma nota que já conhecemos mantém a situação que a varredura gravou)
      const g = await gravarNota(db, cli, nota, { origem: 'consulta', pendente: false, situacaoNova: 'pendente' });
      notaId = String(g.id);
    }
    const n = (await db.query('SELECT id,nf,situacao,remetente,pagador FROM ag_notas WHERE id=$1 FOR UPDATE', [notaId])).rows[0];
    if (!ehParceiro(await termosDe(db, cli), n.remetente, n.pagador)) throw erro(422, 'A NF ' + n.nf + (n.remetente ? ' (' + n.remetente + ')' : '') + ' não é de um parceiro do agendamento e não entra aqui. Os parceiros ficam em ⚙ Configurar.');
    if (FINAIS.includes(n.situacao)) throw erro(409, 'A NF ' + n.nf + ' já está ' + ROTULO[n.situacao].toLowerCase() + ' no SSW e não pode ser agendada.');
    const at = await db.query("SELECT id,to_char(data_agendada,'YYYY-MM-DD') AS data FROM ag_agendamentos WHERE nota_id=$1 AND status='ativo'", [notaId]);
    if (at.rowCount) throw erro(409, 'A NF ' + n.nf + ' já está agendada para ' + brData(at.rows[0].data) + '. Use Reagendar na lista.');
    const produto = limpo(b.produto, 600);
    if (produto) await db.query("UPDATE ag_notas SET produto=$2,produto_fonte='operador',atualizado_em=NOW() WHERE id=$1", [notaId, produto]);
    const q = await db.query("INSERT INTO ag_agendamentos(client_id,nota_id,data_agendada,observacao,criado_por,criado_por_nome) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text",
      [cli, notaId, data, obs || null, /^\d+$/.test(String(user.id || '')) ? user.id : null, limpo(user.username, 80)]);
    await evento(db, cli, notaId, q.rows[0].id, 'agendado', null, brData(data), obs, limpo(user.username, 80));
    await db.query('COMMIT');
    return { id: q.rows[0].id, nota_id: notaId, data_agendada: data };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') throw erro(409, 'Esta NF já tem um agendamento ativo.');
    throw e;
  } finally { db.release(); }
}

async function alterar(pool, cli, user, id, b) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const a = (await db.query("SELECT id,nota_id,to_char(data_agendada,'YYYY-MM-DD') AS data,observacao,status FROM ag_agendamentos WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2 FOR UPDATE", [id, cli])).rows[0];
    if (!a) throw erro(404, 'Agendamento não encontrado.');
    if (a.status !== 'ativo') throw erro(409, 'Este agendamento não está mais ativo.');
    const quem = limpo(user.username, 80);
    if (b.data_agendada !== undefined) {
      const d = validarData(b.data_agendada);
      if (d !== a.data) {
        await db.query('UPDATE ag_agendamentos SET data_agendada=$2,reagendamentos=reagendamentos+1,atualizado_em=NOW() WHERE id=$1', [id, d]);
        await evento(db, cli, a.nota_id, id, 'reagendado', brData(a.data), brData(d), b.motivo || null, quem);
      }
    }
    if (b.produto !== undefined) {
      const pr = limpo(b.produto, 600);
      const n = (await db.query('SELECT produto,produto_fonte FROM ag_notas WHERE id=$1', [a.nota_id])).rows[0] || {};
      const antes = n.produto_fonte === 'operador' ? n.produto || '' : '';
      if (pr !== antes) {
        await db.query("UPDATE ag_notas SET produto=$2,produto_fonte=CASE WHEN $2::text IS NULL THEN NULL ELSE 'operador' END,atualizado_em=NOW() WHERE id=$1", [a.nota_id, pr || null]);
        await evento(db, cli, a.nota_id, id, 'produto', antes, pr, null, quem);
      }
    }
    if (b.observacao !== undefined) {
      const o = limpo(b.observacao, 1000);
      if (o !== (a.observacao || '')) {
        await db.query('UPDATE ag_agendamentos SET observacao=$2,atualizado_em=NOW() WHERE id=$1', [id, o || null]);
        await evento(db, cli, a.nota_id, id, 'observacao', a.observacao || '', o, null, quem);
      }
    }
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
}

async function cancelar(pool, cli, user, id, motivo) {
  const quem = limpo(user.username, 80);
  const q = await pool.query("UPDATE ag_agendamentos SET status='cancelado',cancelado_em=NOW(),cancelado_por=$3,motivo_cancelamento=$4,atualizado_em=NOW() WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2 AND status='ativo' RETURNING nota_id,to_char(data_agendada,'YYYY-MM-DD') AS data",
    [id, cli, quem, limpo(motivo, 500) || null]);
  if (!q.rowCount) throw erro(404, 'Agendamento ativo não encontrado.');
  await evento(pool, cli, q.rows[0].nota_id, id, 'cancelado', brData(q.rows[0].data), null, motivo, quem);
}

// ------------------------------------------------------------------ rotas /api/painel/agendamentos*
async function handle(req, res, u, ctx) {
  if (u.pathname !== '/api/painel/agendamentos' && !u.pathname.startsWith('/api/painel/agendamentos/')) return false;
  await atender(req, res, u, ctx);
  return true;
}
async function atender(req, res, u, { pool, sendJson, readJsonBodyLimited, dashboardSession, dashboardHas, lerSswDoUsuario, lerBaixasDoUsuario, lerFaixaDoUsuario }) {
  const p = u.pathname.slice('/api/painel/agendamentos'.length) || '/';
  try {
    const user = await dashboardSession(req, false);
    if (!(user.is_admin || dashboardHas(user, 'agendamentos') || dashboardHas(user, 'dashboard')))
      return sendJson(res, 403, { ok: false, error: 'Seu usuário não tem acesso ao Agendamento. Peça a liberação a um administrador.' });
    const cli = user.client_id ? String(user.client_id) : null;
    const f = Object.fromEntries(u.searchParams);

    if (p === '/painel' && req.method === 'GET') {
      const [ind, cfg] = await Promise.all([indicadores(pool, cli), lerConfig(pool, cli)]);
      return sendJson(res, 200, { ok: true, indicadores: ind, config: cfg, pode_configurar: !!user.is_admin, hoje: hojeSp() });
    }
    if (p === '/lista' && req.method === 'GET') {
      const x = await listar(pool, cli, String(f.aba || 'agendadas'), f);
      return sendJson(res, 200, { ok: true, ...x });
    }
    if (p === '/buscar-nf' && req.method === 'GET') {
      if (!normNf(f.nf)) return sendJson(res, 400, { ok: false, error: 'Informe a nota fiscal.' });
      return sendJson(res, 200, { ok: true, rows: await buscarNf(pool, cli, f.nf) });
    }
    if (p === '/' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 64 * 1024);
      return sendJson(res, 201, { ok: true, ...(await agendar(pool, cli, user, b)) });
    }
    let m = p.match(/^\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      await alterar(pool, cli, user, m[1], await readJsonBodyLimited(req, 32 * 1024));
      return sendJson(res, 200, { ok: true });
    }
    m = p.match(/^\/(\d+)\/cancelar$/);
    if (m && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 16 * 1024);
      await cancelar(pool, cli, user, m[1], b.motivo);
      return sendJson(res, 200, { ok: true });
    }
    m = p.match(/^\/historico\/(\d+)$/);
    if (m && req.method === 'GET') {
      const h = await historicoNota(pool, cli, m[1]);
      if (!h) return sendJson(res, 404, { ok: false, error: 'Nota não encontrada.' });
      return sendJson(res, 200, { ok: true, ...h });
    }
    if (p === '/sincronizacoes' && req.method === 'GET') {
      const q = await pool.query(`SELECT id::text,origem,usuario,status,iniciado_em,finalizado_em,pendentes_ssw,novas,atualizadas,entregues,devolvidas,em_rota,verificar,retornaram,erro,detalhes
        FROM ag_sincronizacoes WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY iniciado_em DESC LIMIT 40`, [cli]);
      return sendJson(res, 200, { ok: true, rows: q.rows, rodando: RODANDO.has(String(cli || 0)) });
    }
    if (p === '/sincronizar' && req.method === 'POST') {
      if (!lerSswDoUsuario) return sendJson(res, 503, { ok: false, error: 'A leitura do SSW não está disponível neste servidor.' });
      // evita excesso de consultas: uma manual a cada 2 minutos
      const rec = await pool.query("SELECT 1 FROM ag_sincronizacoes WHERE client_id IS NOT DISTINCT FROM $1 AND origem='manual' AND iniciado_em>NOW()-INTERVAL '2 minutes' LIMIT 1", [cli]);
      if (rec.rowCount && !RODANDO.has(String(cli || 0))) return sendJson(res, 429, { ok: false, error: 'Uma sincronização manual acabou de rodar. Aguarde 2 minutos para pedir outra.' });
      try {
        const s = await sincronizar({ pool, cli, origem: 'manual', usuario: limpo(user.username, 80), lerSsw: lerSswDoUsuario(user, req) });
        return sendJson(res, 202, { ok: true, id: String(s.id), rodando: true });
      } catch (e) { if (e.emAndamento) return sendJson(res, 409, { ok: false, error: e.message, rodando: true }); throw e; }
    }
    // importar uma faixa de CT-es / subcontratos do SSW (do número inicial ao final, com dígito)
    if (p === '/importar' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 16 * 1024);
      return sendJson(res, 202, { ok: true, ...iniciarImportacao(pool, cli, user, b, lerFaixaDoUsuario ? lerFaixaDoUsuario(user) : null) });
    }
    m = p.match(/^\/importar\/([a-z0-9]+)$/);
    if (m && req.method === 'GET') {
      const j = IMPORTACOES.get(m[1]);
      if (!j || j.cli !== String(cli || 0)) return sendJson(res, 404, { ok: false, error: 'Importação não encontrada.' });
      return sendJson(res, 200, { ok: true, id: j.id, status: j.status, total: j.total, lidos: j.lidos, resultado: j.resultado, erro: j.erro });
    }
    // botão "Atualizar baixas": confere agora as baixas dos motoristas no app (a rotina roda de hora em hora)
    if (p === '/baixas' && req.method === 'POST') return sendJson(res, 200, { ok: true, ...(await baixasDosMotoristas(pool, { lerBaixas: lerBaixasDoUsuario ? lerBaixasDoUsuario(user) : null, ontem: true })) });
    if (p === '/config' && req.method === 'GET') return sendJson(res, 200, { ok: true, config: await lerConfig(pool, cli) });
    if (p === '/config' && req.method === 'PUT') {
      if (!user.is_admin) return sendJson(res, 403, { ok: false, error: 'Só o administrador altera a configuração do agendamento.' });
      const cfg = await gravarConfig(pool, cli, await readJsonBodyLimited(req, 8 * 1024), limpo(user.username, 80));
      return sendJson(res, 200, { ok: true, config: cfg });
    }
    return sendJson(res, 404, { ok: false, error: 'Rota não encontrada.' });
  } catch (e) {
    return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Falha no agendamento.' });
  }
}

module.exports = { dvCtrc, faixaCtes, importarFaixa, iniciarImportacao, baixasDosMotoristas, iniciarBaixasMotoristas, OPERACIONAIS, FINAIS, ROTULO, PARCEIROS_PADRAO, normNf, normCtrc, dataBr, termosParceiros, ehParceiro, ensureSchema, lerConfig, gravarConfig, gravarNota, aplicarSnapshot, alvosDaVarredura,
  sincronizar, iniciarVarreduraAutomatica, postJson, listar, indicadores, buscarNf, historicoNota, agendar, alterar, cancelar, handle };
