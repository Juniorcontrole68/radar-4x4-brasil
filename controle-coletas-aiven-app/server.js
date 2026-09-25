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

async function readJsonBodyLimited(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const e = new Error('Arquivo muito grande. Tire a foto novamente.');
      e.status = 413;
      throw e;
    }
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); }
  catch {
    const e = new Error('Dados inválidos.');
    e.status = 400;
    throw e;
  }
}

function parseImageDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!m) {
    const e = new Error('Foto inválida.');
    e.status = 400;
    throw e;
  }
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > 900 * 1024) {
    const e = new Error('A foto deve ter no máximo 900 KB após a compactação.');
    e.status = 413;
    throw e;
  }
  return { mime, buffer };
}

function parseDocumentDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(application\/pdf|image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!m) {
    const e = new Error('Documento inválido. Envie PDF, JPG, PNG ou WEBP.');
    e.status = 400;
    throw e;
  }
  let mime = m[1].toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > 7 * 1024 * 1024) {
    const e = new Error('O documento deve ter no máximo 7 MB.');
    e.status = 413;
    throw e;
  }
  return { mime, buffer };
}



function dashboardHashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function dashboardVerifyPassword(password, salt, expectedHash) {
  try {
    const actual = crypto.scryptSync(String(password), String(salt), 64);
    const expected = Buffer.from(String(expectedHash), 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
function dashboardTokenHash(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function dashboardCookie(req, name='cl_session') {
  const raw=String(req.headers.cookie||'');
  for(const part of raw.split(';')){
    const i=part.indexOf('=');
    if(i<0)continue;
    const k=part.slice(0,i).trim();
    if(k===name){try{return decodeURIComponent(part.slice(i+1).trim())}catch{return part.slice(i+1).trim()}}
  }
  return '';
}
function dashboardBearer(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : dashboardCookie(req);
}
function dashboardSetCookie(token,maxAge=14*24*60*60){
  return 'cl_session='+encodeURIComponent(token||'')+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;
}
function dashboardPerms(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') { try { const p=JSON.parse(v); return Array.isArray(p)?p.map(String):[]; } catch { return []; } }
  return [];
}
function dashboardHas(user,perm){return !!(user&&(user.is_admin||user.permissions?.includes('*')||user.permissions?.includes(perm)))}
async function dashboardSession(req, adminOnly=false) {
  const token=dashboardBearer(req);
  if(!token){const e=new Error('Sessão não informada.');e.status=401;throw e}
  const r=await pool.query("SELECT u.id::text AS id,u.username,u.is_admin,u.active,u.permissions FROM dashboard_sessions s JOIN dashboard_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE LIMIT 1",[dashboardTokenHash(token)]);
  if(!r.rowCount){const e=new Error('Sessão expirada ou inválida.');e.status=401;throw e}
  const row=r.rows[0];
  if(adminOnly&&!row.is_admin){const e=new Error('Acesso exclusivo do administrador.');e.status=403;throw e}
  return {id:row.id,username:row.username,is_admin:!!row.is_admin,active:!!row.active,permissions:row.is_admin?['*']:dashboardPerms(row.permissions)};
}
async function dashboardCreateSession(userId, days=14){
  const token=crypto.randomBytes(32).toString('hex');
  const safeDays=Math.max(1,Math.min(365,Number(days)||14));
  await pool.query('DELETE FROM dashboard_sessions WHERE expires_at<=NOW()');
  await pool.query("INSERT INTO dashboard_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+($3 * INTERVAL '1 day'))",[dashboardTokenHash(token),userId,safeDays]);
  return token;
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
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS motorista_cpf TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS motorista_rg TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS placa_carreta TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS capacidade_carga_cavalo TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS eixos_cavalo INTEGER');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS capacidade_carga_carreta TEXT');
  await pool.query('ALTER TABLE coletas ADD COLUMN IF NOT EXISTS eixos_carreta INTEGER');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coleta_documentos (
      id BIGSERIAL PRIMARY KEY,
      coleta_id TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('motorista','cavalo','carreta')),
      nome_arquivo TEXT NOT NULL,
      mime TEXT NOT NULL,
      arquivo BYTEA NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (coleta_id, tipo)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_coleta_documentos_coleta ON coleta_documentos (coleta_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carregamentos_finais (
      id BIGSERIAL PRIMARY KEY,
      conferente TEXT NOT NULL,
      motorista TEXT NOT NULL,
      quantidade_entregas INTEGER NOT NULL CHECK (quantidade_entregas >= 0),
      foto BYTEA NOT NULL,
      foto_mime TEXT NOT NULL DEFAULT 'image/jpeg',
      foto_bytes INTEGER NOT NULL DEFAULT 0,
      capturada_em TIMESTAMPTZ NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_carregamentos_finais_capturada_em ON carregamentos_finais (capturada_em DESC)');
  await pool.query("ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'carregamento'");
  await pool.query("UPDATE carregamentos_finais SET tipo='carregamento' WHERE tipo IS NULL OR trim(tipo)=''");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nf_materiais (
      id BIGSERIAL PRIMARY KEY,
      chave TEXT NOT NULL,
      nf TEXT NOT NULL,
      emitente_cnpj TEXT,
      emitente_nome TEXT,
      cliente TEXT,
      cidade TEXT,
      uf TEXT,
      classificacao TEXT NOT NULL DEFAULT 'normal',
      produtos JSONB NOT NULL DEFAULT '[]'::jsonb,
      importado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_materiais_chave ON nf_materiais (chave)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_nf_materiais_nf ON nf_materiais (nf)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_nf_materiais_classificacao ON nf_materiais (classificacao)');
  await pool.query("CREATE TABLE IF NOT EXISTS dashboard_users (id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE, permissions JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_users_username_lower ON dashboard_users (lower(username))');
  await pool.query('CREATE TABLE IF NOT EXISTS dashboard_sessions (token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_exp ON dashboard_sessions (expires_at)');
  await pool.query("CREATE TABLE IF NOT EXISTS dashboard_embed_tickets (ticket_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_dashboard_embed_tickets_exp ON dashboard_embed_tickets (expires_at)');
  const adminUser=String(process.env.DASHBOARD_INITIAL_ADMIN_USER||'Junior').trim();
  const adminPass=String(process.env.DASHBOARD_INITIAL_ADMIN_PASSWORD||'').trim();
  if(adminUser&&adminPass){
    const existing=await pool.query('SELECT id FROM dashboard_users WHERE lower(username)=lower($1) LIMIT 1',[adminUser]);
    if(!existing.rowCount){
      const ph=dashboardHashPassword(adminPass);
      await pool.query("INSERT INTO dashboard_users(username,password_salt,password_hash,is_admin,active,permissions) VALUES($1,$2,$3,TRUE,TRUE,'[]'::jsonb)",[adminUser,ph.salt,ph.hash]);
      console.log('Administrador inicial do dashboard criado: '+adminUser);
    }
  }
  await migrateLegacyBillsIfNeeded();
  

  http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');

      if (req.method === 'POST' && u.pathname === '/api/auth/login') {
        try {
          const body=await readJsonBodyLimited(req,64*1024);
          const username=String(body.username||'').trim();
          const password=String(body.password||'');
          if(!username||!password)return sendJson(res,400,{ok:false,error:'Informe usuário e senha.'});
          const r=await pool.query('SELECT id::text AS id,username,password_salt,password_hash,is_admin,active,permissions FROM dashboard_users WHERE lower(username)=lower($1) LIMIT 1',[username]);
          if(!r.rowCount||!r.rows[0].active||!dashboardVerifyPassword(password,r.rows[0].password_salt,r.rows[0].password_hash)){
            return sendJson(res,401,{ok:false,error:'Usuário ou senha inválidos.'});
          }
          const row=r.rows[0],sessionDays=row.is_admin?365:14,token=await dashboardCreateSession(row.id,sessionDays);
          res.writeHead(200,{
            'Content-Type':'application/json; charset=utf-8',
            'Cache-Control':'no-store',
            'Set-Cookie':dashboardSetCookie(token,sessionDays*24*60*60)
          });
          return res.end(JSON.stringify({ok:true,user:{id:row.id,username:row.username,is_admin:!!row.is_admin,permissions:row.is_admin?['*']:dashboardPerms(row.permissions)}}));
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao entrar.'});}
      }

      if (req.method === 'GET' && u.pathname === '/api/auth/me') {
        try {
          const user=await dashboardSession(req,false);
          if(user.is_admin){
            const token=dashboardBearer(req);
            if(token){
              await pool.query("UPDATE dashboard_sessions SET expires_at=NOW()+INTERVAL '365 days' WHERE token_hash=$1",[dashboardTokenHash(token)]);
              res.writeHead(200,{
                'Content-Type':'application/json; charset=utf-8',
                'Cache-Control':'no-store',
                'Set-Cookie':dashboardSetCookie(token,365*24*60*60)
              });
              return res.end(JSON.stringify({ok:true,user}));
            }
          }
          return sendJson(res,200,{ok:true,user});
        } catch(e){return sendJson(res,e.status||401,{ok:false,error:e.message||'Sessão inválida.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/auth/logout') {
        try {
          const token=dashboardBearer(req);
          if(token)await pool.query('DELETE FROM dashboard_sessions WHERE token_hash=$1',[dashboardTokenHash(token)]);
        } catch {}
        res.writeHead(200,{
          'Content-Type':'application/json; charset=utf-8',
          'Cache-Control':'no-store',
          'Set-Cookie':dashboardSetCookie('',0)
        });
        return res.end(JSON.stringify({ok:true}));
      }

      if (req.method === 'POST' && u.pathname === '/api/auth/admin-dashboard-token') {
        try {
          const user=await dashboardSession(req,true);
          const token=await dashboardCreateSession(user.id,365);
          return sendJson(res,200,{ok:true,token});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível abrir o dashboard do administrador.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/auth/embed-ticket') {
        try {
          const user=await dashboardSession(req,false);
          const ticket=crypto.randomBytes(24).toString('hex');
          await pool.query('DELETE FROM dashboard_embed_tickets WHERE expires_at<=NOW() OR used_at IS NOT NULL');
          await pool.query("INSERT INTO dashboard_embed_tickets(ticket_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '2 minutes')",[dashboardTokenHash(ticket),user.id]);
          return sendJson(res,200,{ok:true,ticket});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível abrir o módulo.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/auth/embed-exchange') {
        try {
          const body=await readJsonBodyLimited(req,32*1024);
          const ticket=String(body.ticket||'').trim();
          if(!ticket)return sendJson(res,400,{ok:false,error:'Ticket não informado.'});
          const r=await pool.query("UPDATE dashboard_embed_tickets SET used_at=NOW() WHERE ticket_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING user_id",[dashboardTokenHash(ticket)]);
          if(!r.rowCount)return sendJson(res,401,{ok:false,error:'Ticket expirado ou já utilizado.'});
          const ur=await pool.query('SELECT id::text AS id,username,is_admin,active,permissions FROM dashboard_users WHERE id=$1 AND active=TRUE LIMIT 1',[r.rows[0].user_id]);
          if(!ur.rowCount)return sendJson(res,401,{ok:false,error:'Usuário inativo.'});
          const row=ur.rows[0],token=await dashboardCreateSession(row.id);
          return sendJson(res,200,{ok:true,token,user:{id:row.id,username:row.username,is_admin:!!row.is_admin,permissions:row.is_admin?['*']:dashboardPerms(row.permissions)}});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao autorizar módulo.'});}
      }
      if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/painel')) {
        return sendHtml(res, PANEL);
      }

      if (req.method === 'GET' && (u.pathname === '/coletas' || u.pathname === '/coletas/' || u.pathname === '/contas' || u.pathname === '/contas/')) {
        try {
          const user=await dashboardSession(req,false);
          const isContas=u.pathname.startsWith('/contas');
          const isFinanceiro=!isContas&&u.searchParams.get('view')==='financeiro';
          const allowed=isContas?dashboardHas(user,'contas_pagar'):(isFinanceiro?dashboardHas(user,'financeiro'):dashboardHas(user,'coletas'));
          if(!allowed){
            res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
            return res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial;padding:30px;color:#334155}h2{color:#991b1b}</style><h2>Acesso não autorizado</h2><p>Este usuário não possui permissão para este módulo.</p>');
          }
        } catch(e){
          res.writeHead(302,{Location:'/?login=1'+(u.pathname.startsWith('/contas')?'#contas':'#coletas'),'Cache-Control':'no-store'});
          return res.end();
        }
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

      if (req.method === 'POST' && u.pathname === '/api/painel/auth/login') {
        try {
          const body=await readJsonBodyLimited(req,64*1024);
          const username=String(body.username||'').trim();
          const password=String(body.password||'');
          if(!username||!password)return sendJson(res,400,{ok:false,error:'Informe usuário e senha.'});
          const r=await pool.query('SELECT id::text AS id,username,password_salt,password_hash,is_admin,active,permissions FROM dashboard_users WHERE lower(username)=lower($1) LIMIT 1',[username]);
          if(!r.rowCount||!r.rows[0].active||!dashboardVerifyPassword(password,r.rows[0].password_salt,r.rows[0].password_hash))return sendJson(res,401,{ok:false,error:'Usuário ou senha inválidos.'});
          const row=r.rows[0];
          const token=await dashboardCreateSession(row.id);
          return sendJson(res,200,{ok:true,token,user:{id:row.id,username:row.username,is_admin:!!row.is_admin,permissions:row.is_admin?['*']:dashboardPerms(row.permissions)}});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao entrar.'});}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/auth/me') {
        try {const user=await dashboardSession(req,false);return sendJson(res,200,{ok:true,user});}
        catch(e){return sendJson(res,e.status||401,{ok:false,error:e.message||'Sessão inválida.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/auth/logout') {
        try {const token=dashboardBearer(req);if(token)await pool.query('DELETE FROM dashboard_sessions WHERE token_hash=$1',[dashboardTokenHash(token)]);} catch {}
        return sendJson(res,200,{ok:true});
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/auth/users') {
        try {
          await dashboardSession(req,true);
          const r=await pool.query('SELECT id::text AS id,username,is_admin,active,permissions,created_at,updated_at FROM dashboard_users ORDER BY is_admin DESC,lower(username)');
          return sendJson(res,200,{ok:true,rows:r.rows.map(x=>Object.assign({},x,{permissions:x.is_admin?['*']:dashboardPerms(x.permissions)}))});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível carregar os usuários.'});}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/auth/users') {
        try {
          await dashboardSession(req,true);
          const body=await readJsonBodyLimited(req,128*1024);
          const username=String(body.username||'').trim();
          const password=String(body.password||'');
          const permissions=Array.isArray(body.permissions)?Array.from(new Set(body.permissions.map(String))):[];
          const active=body.active!==false;
          if(username.length<2)return sendJson(res,400,{ok:false,error:'Informe um nome de usuário.'});
          if(password.length<4)return sendJson(res,400,{ok:false,error:'A senha deve ter pelo menos 4 caracteres.'});
          const ph=dashboardHashPassword(password);
          const r=await pool.query('INSERT INTO dashboard_users(username,password_salt,password_hash,is_admin,active,permissions,updated_at) VALUES($1,$2,$3,FALSE,$4,$5::jsonb,NOW()) RETURNING id::text AS id,username,is_admin,active,permissions,created_at,updated_at',[username,ph.salt,ph.hash,active,JSON.stringify(permissions)]);
          const user=Object.assign({},r.rows[0],{permissions:dashboardPerms(r.rows[0].permissions)});
          return sendJson(res,201,{ok:true,user});
        } catch(e){
          const msg=e.code==='23505'?'Já existe um usuário com esse nome.':(e.message||'Não foi possível criar o usuário.');
          return sendJson(res,e.code==='23505'?409:(e.status||500),{ok:false,error:msg});
        }
      }

      if (req.method === 'PATCH' && u.pathname.startsWith('/api/painel/auth/users/')) {
        try {
          const admin=await dashboardSession(req,true);
          const id=u.pathname.slice('/api/painel/auth/users/'.length);
          if(!/^[0-9]+$/.test(id))return sendJson(res,404,{ok:false,error:'Usuário não encontrado.'});
          const body=await readJsonBodyLimited(req,128*1024);
          const current=await pool.query('SELECT id::text AS id,is_admin FROM dashboard_users WHERE id=$1 LIMIT 1',[id]);
          if(!current.rowCount)return sendJson(res,404,{ok:false,error:'Usuário não encontrado.'});
          const username=body.username==null?null:String(body.username).trim();
          const active=body.active==null?null:!!body.active;
          const permissions=Array.isArray(body.permissions)?Array.from(new Set(body.permissions.map(String))):null;
          const password=body.password==null?'':String(body.password);
          if(username!==null&&username.length<2)return sendJson(res,400,{ok:false,error:'Nome de usuário inválido.'});
          if(password&&password.length<4)return sendJson(res,400,{ok:false,error:'A senha deve ter pelo menos 4 caracteres.'});
          if(String(admin.id)===String(id)&&active===false)return sendJson(res,400,{ok:false,error:'O administrador não pode desativar a própria conta.'});
          const sets=[];const vals=[];
          const add=(expr,value)=>{vals.push(value);sets.push(expr.replace('?',String.fromCharCode(36)+vals.length));};
          if(username!==null)add('username=?',username);
          if(active!==null)add('active=?',active);
          if(permissions!==null&&!current.rows[0].is_admin)add('permissions=?::jsonb',JSON.stringify(permissions));
          if(password){const ph=dashboardHashPassword(password);add('password_salt=?',ph.salt);add('password_hash=?',ph.hash);}
          sets.push('updated_at=NOW()');
          vals.push(id);
          const r=await pool.query('UPDATE dashboard_users SET '+sets.join(', ')+' WHERE id='+String.fromCharCode(36)+vals.length+' RETURNING id::text AS id,username,is_admin,active,permissions,created_at,updated_at',vals);
          const user=Object.assign({},r.rows[0],{permissions:r.rows[0].is_admin?['*']:dashboardPerms(r.rows[0].permissions)});
          return sendJson(res,200,{ok:true,user});
        } catch(e){
          const msg=e.code==='23505'?'Já existe um usuário com esse nome.':(e.message||'Não foi possível atualizar o usuário.');
          return sendJson(res,e.code==='23505'?409:(e.status||500),{ok:false,error:msg});
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/motoristas-veiculos') {
        try {
          const r = await pool.query(`
            SELECT DISTINCT ON (upper(trim(placa)))
              upper(trim(placa)) AS placa,
              trim(COALESCE(motorista,'')) AS motorista
            FROM coletas
            WHERE trim(COALESCE(placa,'')) <> ''
              AND trim(COALESCE(motorista,'')) <> ''
            ORDER BY upper(trim(placa)), updated_at DESC NULLS LAST, id DESC
          `);
          return sendJson(res, 200, { ok: true, rows: r.rows });
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: e.message || 'Não foi possível carregar motoristas e veículos.' });
        }
      }


      const dadosDocumentaisMatch = u.pathname.match(/^\/api\/painel\/coletas-documentais\/([^/]+)$/);
      if (req.method === 'PATCH' && dadosDocumentaisMatch) {
        try {
          const docUser=await dashboardSession(req,false);
          if(!dashboardHas(docUser,'coletas')) return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});

          const id = decodeURIComponent(dadosDocumentaisMatch[1]);
          const body = await readJsonBodyLimited(req, 256 * 1024);
          const rg = String(body.motorista_rg || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 50);
          const placaCarreta = String(body.placa_carreta || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
          const capacidadeCavalo = String(body.capacidade_carga_cavalo || '').trim().slice(0, 80);
          const capacidadeCarreta = String(body.capacidade_carga_carreta || '').trim().slice(0, 80);
          const intOrNull = v => {
            if (v === '' || v === null || v === undefined) return null;
            const n = Number(v);
            return Number.isInteger(n) && n >= 0 && n <= 20 ? n : null;
          };
          const eixosCavalo = intOrNull(body.eixos_cavalo);
          const eixosCarreta = intOrNull(body.eixos_carreta);
          let eixosTotal = intOrNull(body.eixos_total);
          if (eixosTotal === null && (eixosCavalo !== null || eixosCarreta !== null)) {
            eixosTotal = Number(eixosCavalo || 0) + Number(eixosCarreta || 0);
          }
          const sql = 'UPDATE coletas SET motorista_rg=$1, placa_carreta=$2, capacidade_carga_cavalo=$3, ' +
            'eixos_cavalo=$4, capacidade_carga_carreta=$5, eixos_carreta=$6, ' +
            'eixos=COALESCE($7,eixos), updated_at=NOW() WHERE id::text=$8 ' +
            'RETURNING id::text AS id, motorista, motorista_rg, motorista_cpf, placa, placa_carreta, ' +
            'capacidade_carga_cavalo, eixos_cavalo, capacidade_carga_carreta, eixos_carreta, eixos';
          const r = await pool.query(sql, [
            rg || null, placaCarreta || null, capacidadeCavalo || null, eixosCavalo,
            capacidadeCarreta || null, eixosCarreta, eixosTotal, id
          ]);
          if (!r.rowCount) return sendJson(res, 404, { ok:false, error:'Coleta não encontrada.' });
          return sendJson(res, 200, { ok:true, ...r.rows[0] });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok:false, error:e.message || 'Não foi possível salvar os dados documentais.' });
        }
      }

      const docsListMatch = u.pathname.match(/^\/api\/painel\/coletas-documentos\/([^/]+)$/);
      if (req.method === 'GET' && docsListMatch) {
        try {
          const docUser=await dashboardSession(req,false);
          if(!dashboardHas(docUser,'coletas')) return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});

          const id = decodeURIComponent(docsListMatch[1]);
          const r = await pool.query(
            'SELECT tipo, nome_arquivo, mime, bytes, criado_em, atualizado_em FROM coleta_documentos WHERE coleta_id=$1 ORDER BY tipo',
            [id]
          );
          return sendJson(res, 200, { ok:true, rows:r.rows });
        } catch (e) {
          return sendJson(res, 500, { ok:false, error:e.message || 'Não foi possível consultar os documentos.' });
        }
      }

      if (req.method === 'POST' && docsListMatch) {
        try {
          const docUser=await dashboardSession(req,false);
          if(!dashboardHas(docUser,'coletas')) return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});

          const id = decodeURIComponent(docsListMatch[1]);
          const exists = await pool.query('SELECT 1 FROM coletas WHERE id::text=$1 LIMIT 1',[id]);
          if (!exists.rowCount) return sendJson(res,404,{ok:false,error:'Coleta não encontrada.'});
          const body = await readJsonBodyLimited(req, 10 * 1024 * 1024);
          const tipo = String(body.tipo || '').toLowerCase();
          if (!['motorista','cavalo','carreta'].includes(tipo)) {
            return sendJson(res,400,{ok:false,error:'Tipo de documento inválido.'});
          }
          const doc = parseDocumentDataUrl(body.arquivo);
          const nome = String(body.nome_arquivo || ('documento-'+tipo)).trim().slice(0,180) || ('documento-'+tipo);
          const sql = 'INSERT INTO coleta_documentos(coleta_id,tipo,nome_arquivo,mime,arquivo,bytes) VALUES($1,$2,$3,$4,$5,$6) ' +
            'ON CONFLICT (coleta_id,tipo) DO UPDATE SET nome_arquivo=EXCLUDED.nome_arquivo,mime=EXCLUDED.mime,' +
            'arquivo=EXCLUDED.arquivo,bytes=EXCLUDED.bytes,atualizado_em=NOW()';
          await pool.query(sql,[id,tipo,nome,doc.mime,doc.buffer,doc.buffer.length]);
          return sendJson(res,201,{ok:true,tipo,nome_arquivo:nome,mime:doc.mime,bytes:doc.buffer.length});
        } catch (e) {
          return sendJson(res,e.status || 500,{ok:false,error:e.message || 'Não foi possível salvar o documento.'});
        }
      }

      const docFileMatch = u.pathname.match(/^\/api\/painel\/coletas-documentos\/([^/]+)\/(motorista|cavalo|carreta)$/);
      if (req.method === 'GET' && docFileMatch) {
        try {
          const docUser=await dashboardSession(req,false);
          if(!dashboardHas(docUser,'coletas')) return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});

          const id=decodeURIComponent(docFileMatch[1]),tipo=docFileMatch[2];
          const r=await pool.query(
            'SELECT nome_arquivo,mime,arquivo FROM coleta_documentos WHERE coleta_id=$1 AND tipo=$2 LIMIT 1',
            [id,tipo]
          );
          if(!r.rowCount) return sendJson(res,404,{ok:false,error:'Documento não encontrado.'});
          const row=r.rows[0],safeName=String(row.nome_arquivo||('documento-'+tipo)).replace(/["\r\n]/g,'_');
          res.writeHead(200,{
            'Content-Type':row.mime || 'application/octet-stream',
            'Content-Length':row.arquivo.length,
            'Content-Disposition':'inline; filename="'+safeName+'"',
            'Cache-Control':'private, max-age=300'
          });
          return res.end(row.arquivo);
        } catch(e) {
          return sendJson(res,500,{ok:false,error:e.message || 'Não foi possível abrir o documento.'});
        }
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
            "COUNT(*) FILTER (WHERE lower(trim(COALESCE(status,''))) LIKE 'cancel%')::int AS canceladas, " +
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
            COALESCE(to_jsonb(c)->>'os_numero', to_jsonb(c)->>'numero_os', to_jsonb(c)->>'os', to_jsonb(c)->>'numero_coleta', to_jsonb(c)->>'collection_number', '') AS os,
            COALESCE(to_jsonb(c)->>'cliente', to_jsonb(c)->>'client', to_jsonb(c)->>'nome_cliente', to_jsonb(c)->>'customer', '') AS cliente,
            COALESCE(to_jsonb(c)->>'destinatario', '') AS destinatario,
            COALESCE(to_jsonb(c)->>'destino', to_jsonb(c)->>'cidade_entrega', to_jsonb(c)->>'endereco_entrega', to_jsonb(c)->>'delivery_address', '') AS destino,
            COALESCE(to_jsonb(c)->>'placa', to_jsonb(c)->>'plate', '') AS placa,
            COALESCE(to_jsonb(c)->>'data_carregamento', to_jsonb(c)->>'data_coleta', to_jsonb(c)->>'collection_date', to_jsonb(c)->>'created_at', '') AS data,
            previsao_pagamento_fatura
          FROM coletas c
          LIMIT 500
        `);
        return sendJson(res, 200, result.rows);
      }


      if (req.method === 'GET' && u.pathname === '/api/painel/nf-materiais') {
        try {
          const special = String(u.searchParams.get('special') || '').trim() === '1';
          const limit = Math.max(1, Math.min(3000, Number(u.searchParams.get('limit') || 1500)));
          const where = special ? "WHERE classificacao <> 'normal'" : '';
          const qr = await pool.query(
            'SELECT id::text AS id, chave, nf, emitente_cnpj, emitente_nome, cliente, cidade, uf, classificacao, produtos, importado_em, atualizado_em ' +
            'FROM nf_materiais ' + where + ' ORDER BY atualizado_em DESC LIMIT $1',
            [limit]
          );
          return sendJson(res, 200, { ok: true, rows: qr.rows, count: qr.rows.length });
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: e.message || 'Não foi possível consultar a classificação das notas.' });
        }
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/nf-materiais/import') {
        try {
          const body = await readJsonBodyLimited(req, 4 * 1024 * 1024);
          const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
          if (!rows.length) return sendJson(res, 400, { ok: false, error: 'Nenhuma nota foi enviada para importação.' });
          let imported = 0;
          for (const item of rows) {
            const chave = String(item.chave || '').replace(/\D/g, '').trim();
            const nf = String(item.nf || '').replace(/\D/g, '').replace(/^0+/, '') || '0';
            const classificacao = String(item.classificacao || 'normal').trim().toLowerCase();
            const allowed = ['normal','tubos','caixa_agua','tubos_caixa_agua'];
            if (chave.length !== 44 || !allowed.includes(classificacao)) continue;
            const produtos = Array.isArray(item.produtos) ? item.produtos.map(x=>String(x||'').trim()).filter(Boolean).slice(0,250) : [];
            await pool.query(`
              INSERT INTO nf_materiais
                (chave,nf,emitente_cnpj,emitente_nome,cliente,cidade,uf,classificacao,produtos,atualizado_em)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
              ON CONFLICT (chave) DO UPDATE SET
                nf=EXCLUDED.nf,
                emitente_cnpj=EXCLUDED.emitente_cnpj,
                emitente_nome=EXCLUDED.emitente_nome,
                cliente=EXCLUDED.cliente,
                cidade=EXCLUDED.cidade,
                uf=EXCLUDED.uf,
                classificacao=EXCLUDED.classificacao,
                produtos=EXCLUDED.produtos,
                atualizado_em=NOW()
            `, [
              chave,nf,String(item.emitente_cnpj||'').trim(),String(item.emitente_nome||'').trim(),
              String(item.cliente||'').trim(),String(item.cidade||'').trim(),String(item.uf||'').trim(),
              classificacao,JSON.stringify(produtos)
            ]);
            imported++;
          }
          return sendJson(res, 200, { ok: true, imported });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Não foi possível importar os XMLs.' });
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/carregamentos-finais') {
        try {
          const limit = Math.max(1, Math.min(100, Number(u.searchParams.get('limit') || 30)));
          const motorista = String(u.searchParams.get('motorista') || '').trim();
          const data = String(u.searchParams.get('data') || '').trim();
          const tipo = String(u.searchParams.get('tipo') || '').trim().toLowerCase();
          const where = [];
          const params = [];

          if (motorista) {
            params.push('%' + motorista + '%');
            where.push('motorista ILIKE $' + params.length);
          }
          if (tipo) {
            if (!['carregamento','descarga'].includes(tipo)) {
              return sendJson(res, 400, { ok: false, error: 'Tipo de operação inválido.' });
            }
            params.push(tipo);
            where.push('lower(tipo) = $' + params.length);
          }
          if (data) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
              return sendJson(res, 400, { ok: false, error: 'Data de consulta inválida.' });
            }
            params.push(data);
            where.push("(capturada_em AT TIME ZONE 'America/Sao_Paulo')::date = $" + params.length + '::date');
          }

          params.push(limit);
          const sql =
            'SELECT id::text AS id, tipo, conferente, motorista, quantidade_entregas, ' +
            'capturada_em, criado_em, foto_mime, foto_bytes ' +
            'FROM carregamentos_finais ' +
            (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
            'ORDER BY capturada_em DESC, id DESC LIMIT $' + params.length;
          const qr = await pool.query(sql, params);
          return sendJson(res, 200, { ok: true, motorista: motorista || null, data: data || null, tipo: tipo || null, rows: qr.rows });
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: e.message || 'Não foi possível carregar os registros de carga e descarga.' });
        }
      }

      const carregamentoFotoMatch = u.pathname.match(/^\/api\/painel\/carregamentos-finais\/(\d+)\/foto$/);
      if (req.method === 'GET' && carregamentoFotoMatch) {
        try {
          const r = await pool.query(
            'SELECT foto, foto_mime FROM carregamentos_finais WHERE id=$1 LIMIT 1',
            [carregamentoFotoMatch[1]]
          );
          if (!r.rowCount) return sendJson(res, 404, { ok: false, error: 'Foto não encontrada.' });
          const row = r.rows[0];
          res.writeHead(200, {
            'Content-Type': row.foto_mime || 'image/jpeg',
            'Content-Length': row.foto.length,
            'Cache-Control': 'private, max-age=3600'
          });
          return res.end(row.foto);
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: e.message || 'Não foi possível carregar a foto.' });
        }
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/carregamentos-finais') {
        try {
          const body = await readJsonBodyLimited(req, 2 * 1024 * 1024);
          const tipo = String(body.tipo || 'carregamento').trim().toLowerCase();
          const conferente = String(body.conferente || '').trim();
          const motorista = String(body.motorista || '').trim();
          const quantidade = Number(body.quantidade_entregas);
          const captured = new Date(body.capturada_em || Date.now());

          if (!['carregamento','descarga'].includes(tipo)) return sendJson(res, 400, { ok: false, error: 'Tipo de operação inválido.' });
          if (!conferente) return sendJson(res, 400, { ok: false, error: 'Informe o nome do conferente.' });
          if (!motorista) return sendJson(res, 400, { ok: false, error: 'Informe o nome do motorista.' });
          if (!Number.isInteger(quantidade) || quantidade < 0 || quantidade > 1000) {
            return sendJson(res, 400, { ok: false, error: 'Quantidade de entregas inválida.' });
          }
          if (!Number.isFinite(captured.getTime())) {
            return sendJson(res, 400, { ok: false, error: 'Data/hora da foto inválida.' });
          }

          const photo = parseImageDataUrl(body.foto);
          const r = await pool.query(`
            INSERT INTO carregamentos_finais
              (tipo, conferente, motorista, quantidade_entregas, foto, foto_mime, foto_bytes, capturada_em)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING id::text AS id, tipo, conferente, motorista, quantidade_entregas, capturada_em, criado_em, foto_bytes
          `, [
            tipo, conferente, motorista, quantidade, photo.buffer, photo.mime, photo.buffer.length, captured.toISOString()
          ]);
          return sendJson(res, 201, { ok: true, ...r.rows[0] });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Não foi possível salvar o final do carregamento.' });
        }
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

      if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/painel/')) {
        try {
          const user=await dashboardSession(req,false);
          const p=u.pathname;
          const allowed=p.startsWith('/api/bills')||p==='/api/export.csv'
            ? dashboardHas(user,'contas_pagar')
            : (dashboardHas(user,'coletas')||dashboardHas(user,'financeiro'));
          if(!allowed)return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
        } catch(e){
          return sendJson(res,e.status||401,{ok:false,error:e.message||'Sessão inválida.'});
        }
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
