const fs = require('fs');
const path = require('path');
const http = require('http');
const Module = require('module');
const crypto = require('crypto');

if (process.env.DATABASE_URL) {
  try {
    const u = new URL(process.env.DATABASE_URL);
    if (u.searchParams.get('sslmode') === 'require' && !u.searchParams.has('uselibpqcompat')) {
      u.searchParams.set('uselibpqcompat', 'true');
      process.env.DATABASE_URL = u.toString();
    }
  } catch (e) {
    console.error('DATABASE_URL invalida:', e.message);
  }
}

process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module.Module._initPaths();

const { initDb, pool } = require('../contas-a-pagar-v3/src/db');
const { initColetasDb } = require('../contas-a-pagar-v3/src/coletas');
const { handler } = require('../contas-a-pagar-v3/src/handler');

const PORT = process.env.PORT || 10000;
const PANEL = path.join(__dirname, 'painel.html');
const ACCOUNTS_INDEX = path.join(__dirname, '..', 'contas-a-pagar-v3', 'public', 'index.html');

function sendHtml(res, file) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(fs.readFileSync(file));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw new Error('JSON inválido'); }
}


async function duplicateColetaMinimal(id, novaData) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(novaData || ''))) {
    const e = new Error('Nova data inválida.'); e.status = 400; throw e;
  }
  const meta = await pool.query(`
    SELECT column_name, data_type, is_nullable, is_identity, is_generated, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='coletas'
    ORDER BY ordinal_position
  `);
  const originalResult = await pool.query('SELECT * FROM coletas WHERE id::text=$1 LIMIT 1',[id]);
  if (!originalResult.rowCount) { const e=new Error('Coleta não encontrada.'); e.status=404; throw e; }
  const original=originalResult.rows[0], names=new Set(meta.rows.map(x=>x.column_name));
  const first=(arr)=>arr.find(x=>names.has(x));
  const like=(patterns)=>{const hit=meta.rows.find(m=>patterns.some(re=>re.test(String(m.column_name||'').toLowerCase())));return hit?.column_name||null;};

  let dateCol=first(['data_carregamento','data_coleta','data_agendada','data_agendamento','data_solicitacao','data_programada','collection_date','pickup_date','data','date']);
  if(!dateCol) dateCol=like([/data.*colet/,/colet.*data/,/data.*agend/,/agend.*data/,/data.*program/,/program.*data/,/collection.*date/,/pickup.*date/]);
  if(!dateCol){
    const candidates=meta.rows.filter(m=>
      /date|timestamp/.test(String(m.data_type||'')) &&
      !['created_at','updated_at','data_recebimento','previsao_pagamento_fatura','payment_date','due_date'].includes(m.column_name)
    );
    if(candidates.length===1) dateCol=candidates[0].column_name;
  }
  if(!dateCol){
    console.error('Duplicação: coluna de data não localizada. Colunas disponíveis:',meta.rows.map(x=>x.column_name).join(', '));
    const e=new Error('Não consegui localizar automaticamente a data da coleta. Tente novamente após atualizar a página.');
    e.status=500;
    throw e;
  }

  const remetente=first(['cliente_remetente','remetente','nome_remetente','shipper']) || like([/remetente/,/cliente.*origem/]);
  const destinatario=first(['destinatario','nome_destinatario','recipient','cliente_destinatario']) || like([/destinat/,/recipient/]);
  const enderecoColeta=first(['endereco_coleta','endereco_origem','collection_address','pickup_address','origem']) || like([/endereco.*colet/,/colet.*endereco/,/endereco.*origem/,/pickup.*address/]);
  const enderecoEntrega=first(['endereco_entrega','endereco_destino','delivery_address','destino']) || like([/endereco.*entreg/,/entreg.*endereco/,/endereco.*destino/,/delivery.*address/]);

  const preserve=new Set([remetente,destinatario,enderecoColeta,enderecoEntrega].filter(Boolean));

  const cols=[], vals=[];
  for(const m of meta.rows){
    const col=m.column_name;
    if(m.is_identity==='YES'||m.is_generated==='ALWAYS') continue;
    if(col==='id'){
      if(m.data_type==='uuid'){cols.push(col);vals.push(crypto.randomUUID());}
      continue;
    }
    if(col==='created_at'||col==='updated_at') continue;
    cols.push(col);
    if(col===dateCol) vals.push(novaData);
    else if(preserve.has(col)) vals.push(original[col]);
    else if(col==='recebido') vals.push(false);
    else if(col==='data_recebimento'||col==='previsao_pagamento_fatura') vals.push(null);
    else if(m.column_default!=null) { cols.pop(); continue; }
    else if(m.is_nullable==='YES') vals.push(null);
    else if(/char|text|json/.test(m.data_type)) vals.push('');
    else if(/int|numeric|decimal|real|double/.test(m.data_type)) vals.push(0);
    else if(m.data_type==='boolean') vals.push(false);
    else if(m.data_type==='date') vals.push(novaData);
    else if(/timestamp/.test(m.data_type)) vals.push(new Date());
    else if(m.data_type==='uuid') vals.push(crypto.randomUUID());
    else vals.push(original[col] ?? null);
  }
  const qCols=cols.map(x=>'"'+x.replace(/"/g,'""')+'"').join(',');
  const placeholders=vals.map((_,i)=>'$'+(i+1)).join(',');
  const inserted=await pool.query('INSERT INTO coletas ('+qCols+') VALUES ('+placeholders+') RETURNING id::text AS id',vals);
  return inserted.rows[0];
}

async function migrateLegacyBillsIfNeeded() {
  try {
    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM bills');
    const current = countResult.rows[0]?.total || 0;
    if (current > 0) {
      console.log('Contas a Pagar no Aiven: ' + current + ' registro(s). Migracao automatica dispensada.');
      return;
    }

    const response = await fetch('https://contas-jr.onrender.com/api/bills', {
      headers: { 'User-Agent': 'PainelTransportadora-Migracao/1.0' },
      signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bills = await response.json();
    if (!Array.isArray(bills) || bills.length === 0) {
      console.log('Sistema antigo sem contas para migrar.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const b of bills) {
        await client.query(
          `INSERT INTO bills
          (id, recurrence_group, description, supplier, area, category, amount, due_date, original_due_date, status, payment_date, postponed_count, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (id) DO NOTHING`,
          [
            b.id,
            b.recurrence_group || null,
            b.description || '',
            b.supplier || '',
            b.area || 'Pessoal',
            b.category || 'Outros',
            Number(b.amount || 0),
            String(b.due_date || '').slice(0, 10),
            b.original_due_date ? String(b.original_due_date).slice(0, 10) : null,
            b.status === 'paid' ? 'paid' : 'pending',
            b.payment_date ? String(b.payment_date).slice(0, 10) : null,
            Number(b.postponed_count || 0),
            b.created_at || new Date().toISOString(),
            b.updated_at || b.created_at || new Date().toISOString()
          ]
        );
      }
      await client.query('COMMIT');
      console.log('Migracao Contas a Pagar concluida: ' + bills.length + ' registro(s) copiados para o Aiven.');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Migracao automatica do Contas a Pagar nao concluida:', e.message);
  }
}


async function start() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL nao configurada');
  await Promise.all([initDb(), initColetasDb()]);
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS recebido BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS data_recebimento DATE');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS previsao_pagamento_fatura DATE');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS destinatario TEXT');
  await migrateLegacyBillsIfNeeded();
  

  http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/painel')) {
        return sendHtml(res, PANEL);
      }

      if (req.method === 'GET' && (u.pathname === '/coletas' || u.pathname === '/coletas/') && u.searchParams.get('embed') !== '1') {
        res.writeHead(302, { Location: '/#coletas', 'Cache-Control': 'no-store' });
        return res.end();
      }

      if (req.method === 'GET' && (u.pathname === '/contas' || u.pathname === '/contas/') && u.searchParams.get('embed') !== '1') {
        res.writeHead(302, { Location: '/#contas', 'Cache-Control': 'no-store' });
        return res.end();
      }

      if (req.method === 'GET' && (u.pathname === '/contas' || u.pathname === '/contas/')) {
        return sendHtml(res, ACCOUNTS_INDEX);
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/coletas-status-resumo') {
        try {
          const from = String(u.searchParams.get('from') || '').trim();
          const to = String(u.searchParams.get('to') || '').trim();
          const params = [];
          const where = [];
          if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); where.push('data_carregamento >= $' + params.length); }
          if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { params.push(to); where.push('data_carregamento <= $' + params.length); }
          const sql = 'SELECT ' +
            "COUNT(*)::int AS total, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,'')))='programada')::int AS programadas, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,'')))='carregando')::int AS carregando, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,''))) IN ('em trânsito','em transito'))::int AS em_transito, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,'')))='entregue')::int AS entregues, " +
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,'')))='cancelada')::int AS canceladas, " +
            'MAX(updated_at) AS ultima_atualizacao FROM coletas ' +
            (where.length ? 'WHERE ' + where.join(' AND ') : '');
          const r = await pool.query(sql, params);
          const row = r.rows[0] || {};
          row.ativas = Math.max(0, Number(row.total || 0) - Number(row.canceladas || 0));
          row.pendentes = Number(row.programadas || 0) + Number(row.carregando || 0) + Number(row.em_transito || 0);
          return sendJson(res, 200, { ok: true, from: from || null, to: to || null, ...row });
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: e.message || 'Não foi possível resumir as coletas.' });
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/coletas-resumo') {
        const result = await pool.query(`
          SELECT
            id::text AS id,
            COALESCE(to_jsonb(c)->>'numero_os', to_jsonb(c)->>'os', to_jsonb(c)->>'numero_coleta', to_jsonb(c)->>'collection_number', '') AS os,
            COALESCE(to_jsonb(c)->>'cliente', to_jsonb(c)->>'client', to_jsonb(c)->>'nome_cliente', to_jsonb(c)->>'customer', '') AS cliente,
            COALESCE(to_jsonb(c)->>'destinatario', '') AS destinatario,
            COALESCE(to_jsonb(c)->>'destino', to_jsonb(c)->>'cidade_entrega', to_jsonb(c)->>'endereco_entrega', to_jsonb(c)->>'delivery_address', '') AS destino,
            COALESCE(to_jsonb(c)->>'placa', to_jsonb(c)->>'plate', '') AS placa,
            COALESCE(to_jsonb(c)->>'data_coleta', to_jsonb(c)->>'collection_date', to_jsonb(c)->>'created_at', '') AS data,
            previsao_pagamento_fatura
          FROM coletas c
          LIMIT 500
        `);
        return sendJson(res, 200, result.rows);
      }


      const duplicarMatch = u.pathname.match(/^\/api\/painel\/coletas-duplicar\/([^/]+)$/);
      if (req.method === 'POST' && duplicarMatch) {
        const id = decodeURIComponent(duplicarMatch[1]);
        const body = await readJsonBody(req);
        try {
          const nova = await duplicateColetaMinimal(id, body.data);
          return sendJson(res, 201, { ok: true, ...nova });
        } catch (e) {
          return sendJson(res, e.status || 500, { error: e.message || 'Não foi possível duplicar a coleta.' });
        }
      }

      const destinatarioMatch = u.pathname.match(/^\/api\/painel\/coletas-destinatario\/([^/]+)$/);
      if (req.method === 'PATCH' && destinatarioMatch) {
        const id = decodeURIComponent(destinatarioMatch[1]);
        const body = await readJsonBody(req);
        const destinatario = String(body.destinatario || '').trim();
        const result = await pool.query(
          'UPDATE coletas SET destinatario=$1, updated_at=NOW() WHERE id::text=$2 RETURNING id::text AS id, destinatario',
          [destinatario, id]
        );
        if (!result.rowCount) return sendJson(res, 404, { error: 'Coleta não encontrada.' });
        return sendJson(res, 200, { ok: true, ...result.rows[0] });
      }

      const recebimentoMatch = u.pathname.match(/^\/api\/painel\/coletas-financeiro\/([^/]+)$/);
      if (req.method === 'PATCH' && recebimentoMatch) {
        const id = decodeURIComponent(recebimentoMatch[1]);
        const body = await readJsonBody(req);
        const recebido = body.recebido === true || body.recebido === 'true' || body.recebido === 1 || body.recebido === '1';
        let dataRecebimento = body.data_recebimento ? String(body.data_recebimento).slice(0,10) : null;
        if (recebido && !dataRecebimento) dataRecebimento = new Date().toISOString().slice(0,10);
        if (!recebido) dataRecebimento = null;

        const result = await pool.query(
          'UPDATE coletas SET recebido=$1, data_recebimento=$2, updated_at=NOW() WHERE id::text=$3 RETURNING id::text AS id, recebido, data_recebimento',
          [recebido, dataRecebimento, id]
        );
        if (!result.rowCount) return sendJson(res, 404, { error: 'Coleta não encontrada.' });
        return sendJson(res, 200, { ok: true, ...result.rows[0] });
      }

      const previsaoMatch = u.pathname.match(/^\/api\/painel\/coletas-previsao\/([^/]+)$/);
      if (req.method === 'PATCH' && previsaoMatch) {
        const id = decodeURIComponent(previsaoMatch[1]);
        const body = await readJsonBody(req);
        const previsao = body.previsao_pagamento_fatura ? String(body.previsao_pagamento_fatura).slice(0,10) : null;
        if (previsao && !/^\d{4}-\d{2}-\d{2}$/.test(previsao)) {
          return sendJson(res, 400, { error: 'Data de previsão inválida.' });
        }
        const result = await pool.query(
          'UPDATE coletas SET previsao_pagamento_fatura=$1, updated_at=NOW() WHERE id::text=$2 RETURNING id::text AS id, previsao_pagamento_fatura',
          [previsao, id]
        );
        if (!result.rowCount) return sendJson(res, 404, { error: 'Coleta não encontrada.' });
        return sendJson(res, 200, { ok: true, ...result.rows[0] });
      }

      const deleteMatch = u.pathname.match(/^\/api\/painel\/coletas\/([^/]+)$/);
      if (req.method === 'DELETE' && deleteMatch) {
        const id = decodeURIComponent(deleteMatch[1]);
        const result = await pool.query(
          'DELETE FROM coletas WHERE id::text = $1 RETURNING id::text AS id',
          [id]
        );
        if (!result.rowCount) return sendJson(res, 404, { error: 'Coleta não encontrada.' });
        return sendJson(res, 200, { ok: true, id: result.rows[0].id });
      }

      return handler(req, res);
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro interno');
    }
  }).listen(PORT, '0.0.0.0', () => {
    console.log('Painel da Transportadora ativo na porta ' + PORT + ' com PostgreSQL Aiven');
  });
}

start().catch(err => {
  console.error('Falha ao iniciar Painel da Transportadora:', err);
  process.exit(1);
});
