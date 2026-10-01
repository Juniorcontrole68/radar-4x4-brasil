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
const DRIVER_TEST_PAGE = path.join(__dirname, 'motorista-teste.html');
const DRIVER_INSTALL_PAGE = path.join(__dirname, 'motorista-instalar.html');
const DRIVER_TEST_INSTALL_PAGE = path.join(__dirname, 'motorista-teste-instalar.html');
const LOTACAO_PAGE = path.join(__dirname, 'lotacao.html');
const ACCOUNTS_INDEX = path.join(__dirname, '..', 'contas-a-pagar-v3', 'public', 'index.html');
const DRIVER_DOWNLOADS = path.join(__dirname, 'downloads');
const DRIVER_UPDATE_FILE = path.join(DRIVER_DOWNLOADS, 'update.json');
const DRIVER_PUBLIC_BASE = 'https://controle-coletas-jr.onrender.com';

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

function trackingBearer(req){
  const m=String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);
  return m?m[1].trim():'';
}
async function trackingDeviceFromReq(req){
  const token=trackingBearer(req);
  if(!token){const e=new Error('Dispositivo não autenticado.');e.status=401;throw e}
  const q=await pool.query(
    "SELECT id::text AS id, driver_name, vehicle_plate, active FROM driver_tracking_devices WHERE token_hash=$1 AND active=TRUE LIMIT 1",
    [dashboardTokenHash(token)]
  );
  if(!q.rowCount){const e=new Error('Dispositivo não autorizado.');e.status=401;throw e}
  return q.rows[0]
}
function trackingCode(){
  return String(Math.floor(100000+Math.random()*900000))
}
function trackingHistoryDistanceMeters(a,b){
  const lat1=Number(a?.latitude),lon1=Number(a?.longitude),lat2=Number(b?.latitude),lon2=Number(b?.longitude);
  if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return 0;
  const R=6371000,rad=Math.PI/180,dLat=(lat2-lat1)*rad,dLon=(lon2-lon1)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)))
}
function trackingHistoryStops(points,minMinutes=5,radiusMeters=150){
  const pts=(points||[]).filter(p=>Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&p.captured_at);
  const out=[];let i=0;
  while(i<pts.length){
    let j=i,sumLat=Number(pts[i].latitude),sumLon=Number(pts[i].longitude),count=1;
    let center={latitude:sumLat,longitude:sumLon};
    while(j+1<pts.length){
      const next=pts[j+1];
      if(trackingHistoryDistanceMeters(center,next)>radiusMeters)break;
      j++;sumLat+=Number(next.latitude);sumLon+=Number(next.longitude);count++;
      center={latitude:sumLat/count,longitude:sumLon/count};
    }
    if(j>i){
      const start=new Date(pts[i].captured_at),end=new Date(pts[j].captured_at);
      const seconds=Math.max(0,Math.round((end-start)/1000));
      if(seconds>=minMinutes*60){
        out.push({
          latitude:center.latitude,longitude:center.longitude,
          arrived_at:pts[i].captured_at,left_at:pts[j].captured_at,
          duration_seconds:seconds,point_count:j-i+1
        })
      }
    }
    i=Math.max(i+1,j+1)
  }
  return out
}
function trackingHistorySessionSummary(session){
  const points=session.points||[];
  let meters=0;
  for(let i=1;i<points.length;i++){
    const d=trackingHistoryDistanceMeters(points[i-1],points[i]);
    if(Number.isFinite(d)&&d<5000)meters+=d
  }
  const stops=trackingHistoryStops(points);
  return Object.assign(session,{stops,distance_km:Math.round(meters)/1000})
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
  await pool.query(`CREATE TABLE IF NOT EXISTS driver_tracking_test_devices (
    id BIGSERIAL PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    driver_name TEXT NOT NULL,
    vehicle_plate TEXT,
    device_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS driver_tracking_test_points (
    id BIGSERIAL PRIMARY KEY,
    test_device_id BIGINT NOT NULL REFERENCES driver_tracking_test_devices(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy_m DOUBLE PRECISION,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_test_points_device_time ON driver_tracking_test_points(test_device_id,captured_at DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS driver_tracking_assignments (
    id BIGSERIAL PRIMARY KEY,
    invite_token_hash TEXT UNIQUE NOT NULL,
    driver_name TEXT NOT NULL,
    vehicle_plate TEXT,
    romaneios JSONB NOT NULL DEFAULT '[]'::jsonb,
    work_date DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_assignments_plate_date ON driver_tracking_assignments (upper(vehicle_plate),work_date DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_assignments_driver_date ON driver_tracking_assignments (lower(driver_name),work_date DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS driver_tracking_test_assignments (
    id BIGSERIAL PRIMARY KEY,
    invite_token_hash TEXT UNIQUE NOT NULL,
    driver_name TEXT NOT NULL,
    vehicle_plate TEXT,
    romaneios JSONB NOT NULL DEFAULT '[]'::jsonb,
    work_date DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_test_assignments_plate_date ON driver_tracking_test_assignments (upper(vehicle_plate),work_date DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS agendamento_teste (
    id BIGSERIAL PRIMARY KEY,
    nf TEXT NOT NULL,
    ctrc TEXT,
    cliente TEXT,
    cidade TEXT,
    uf TEXT,
    status_ssw TEXT,
    mercadoria TEXT,
    peso NUMERIC(14,3) NOT NULL DEFAULT 0,
    volumes NUMERIC(14,3) NOT NULL DEFAULT 0,
    previsao_ssw TEXT,
    dia_rota TEXT,
    agendado BOOLEAN NOT NULL DEFAULT FALSE,
    data_agendamento DATE,
    criado_por BIGINT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_agendamento_teste_nf ON agendamento_teste (nf)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_agendamento_teste_data ON agendamento_teste (data_agendamento DESC, criado_em DESC)');
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
  await pool.query("ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS conferente_coleta_devolucao TEXT");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS carregamentos_avarias (
      id BIGSERIAL PRIMARY KEY,
      carregamento_id BIGINT NOT NULL REFERENCES carregamentos_finais(id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL CHECK (ordem BETWEEN 1 AND 10),
      foto BYTEA NOT NULL,
      foto_mime TEXT NOT NULL DEFAULT 'image/jpeg',
      foto_bytes INTEGER NOT NULL DEFAULT 0,
      capturada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(carregamento_id, ordem)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_carregamentos_avarias_registro ON carregamentos_avarias (carregamento_id, ordem)');
  for (const n of [2,3,4]) {
    await pool.query(`ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS foto${n} BYTEA`);
    await pool.query(`ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS foto${n}_mime TEXT`);
    await pool.query(`ALTER TABLE carregamentos_finais ADD COLUMN IF NOT EXISTS foto${n}_bytes INTEGER NOT NULL DEFAULT 0`);
  }
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_enrollments (
      id BIGSERIAL PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      driver_name TEXT NOT NULL,
      vehicle_plate TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_enrollments_exp ON driver_tracking_enrollments (expires_at DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_devices (
      id BIGSERIAL PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      driver_name TEXT NOT NULL,
      vehicle_plate TEXT,
      device_name TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_devices_driver ON driver_tracking_devices (lower(driver_name))');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_requests (
      id BIGSERIAL PRIMARY KEY,
      request_token_hash TEXT NOT NULL UNIQUE,
      driver_name TEXT NOT NULL,
      vehicle_plate TEXT,
      device_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      issued_token TEXT,
      approved_device_id BIGINT REFERENCES driver_tracking_devices(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ,
      decided_by BIGINT
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_requests_status ON driver_tracking_requests (status, created_at DESC)');
  await pool.query("ALTER TABLE driver_tracking_requests ADD COLUMN IF NOT EXISTS issued_token TEXT");
  await pool.query("ALTER TABLE driver_tracking_requests ADD COLUMN IF NOT EXISTS approved_device_id BIGINT");
  await pool.query("ALTER TABLE driver_tracking_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE driver_tracking_requests ADD COLUMN IF NOT EXISTS decided_by BIGINT");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_sessions (
      id BIGSERIAL PRIMARY KEY,
      device_id BIGINT NOT NULL REFERENCES driver_tracking_devices(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_sessions_device ON driver_tracking_sessions (device_id, started_at DESC)');
  // Dispositivos recém-aprovados já entram com uma sessão ativa, mesmo se o app
  // ainda não tiver chamado /session/start. Isso evita sumir do mapa após a aprovação.
  await pool.query(`
    INSERT INTO driver_tracking_sessions(device_id,status)
    SELECT d.id,'active'
    FROM driver_tracking_devices d
    JOIN (
      SELECT DISTINCT ON (lower(trim(driver_name)), upper(trim(COALESCE(vehicle_plate,''))))
             id
      FROM driver_tracking_devices
      WHERE active=TRUE
        AND enrolled_at >= NOW()-INTERVAL '1 day'
      ORDER BY lower(trim(driver_name)), upper(trim(COALESCE(vehicle_plate,''))), enrolled_at DESC, id DESC
    ) latest ON latest.id=d.id
    WHERE NOT EXISTS (
      SELECT 1 FROM driver_tracking_sessions s WHERE s.device_id=d.id
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_tracking_points (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL REFERENCES driver_tracking_sessions(id) ON DELETE CASCADE,
      device_id BIGINT NOT NULL REFERENCES driver_tracking_devices(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      accuracy_m REAL,
      speed_mps REAL,
      bearing_deg REAL,
      battery_pct REAL,
      captured_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_points_device_time ON driver_tracking_points (device_id, captured_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tracking_points_session_time ON driver_tracking_points (session_id, captured_at DESC)');

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

      if (req.method === 'GET' && u.pathname === '/motorista-teste') {
        return sendHtml(res, DRIVER_TEST_PAGE);
      }

      if (req.method === 'GET' && u.pathname === '/motorista-instalar') {
        return sendHtml(res, DRIVER_INSTALL_PAGE);
      }

      if (req.method === 'GET' && u.pathname === '/motorista-teste-instalar') {
        return sendHtml(res, DRIVER_TEST_INSTALL_PAGE);
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/test-invite') {
        try {
          const token=String(u.searchParams.get('token')||'').trim();
          if(token.length<20)return sendJson(res,400,{ok:false,error:'Convite de teste inválido.'});
          const q=await pool.query(
            "SELECT driver_name,vehicle_plate,romaneios,work_date,active,created_at FROM driver_tracking_test_assignments WHERE invite_token_hash=$1 AND active=TRUE ORDER BY created_at DESC LIMIT 1",
            [dashboardTokenHash(token)]
          );
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Convite de teste não encontrado ou expirado.'});
          return sendJson(res,200,{ok:true,assignment:q.rows[0],test_only:true});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao consultar convite de teste.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/invite') {
        try {
          const token=String(u.searchParams.get('token')||'').trim();
          if(token.length<20)return sendJson(res,400,{ok:false,error:'Convite inválido.'});
          const q=await pool.query(
            "SELECT driver_name,vehicle_plate,romaneios,work_date,active,created_at FROM driver_tracking_assignments WHERE invite_token_hash=$1 AND active=TRUE ORDER BY created_at DESC LIMIT 1",
            [dashboardTokenHash(token)]
          );
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Convite não encontrado ou expirado.'});
          return sendJson(res,200,{ok:true,assignment:q.rows[0]});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao consultar convite.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/assignment/current') {
        try {
          const device=await trackingDeviceFromReq(req);
          const q=await pool.query(
            `SELECT driver_name,vehicle_plate,romaneios,work_date,updated_at
             FROM driver_tracking_assignments
             WHERE active=TRUE
               AND work_date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
               AND (
                 (COALESCE(vehicle_plate,'')<>'' AND upper(trim(vehicle_plate))=upper(trim(COALESCE($1,''))))
                 OR lower(trim(driver_name))=lower(trim($2))
               )
             ORDER BY
               CASE WHEN COALESCE(vehicle_plate,'')<>'' AND upper(trim(vehicle_plate))=upper(trim(COALESCE($1,''))) THEN 0 ELSE 1 END,
               updated_at DESC
             LIMIT 1`,
            [device.vehicle_plate||'',device.driver_name]
          );
          return sendJson(res,200,{ok:true,assignment:q.rows[0]||null});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar romaneio do motorista.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/test/start') {
        try {
          const body=await readJsonBodyLimited(req,32*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const plate=String(body.vehicle_plate||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Informe o nome do motorista.'});
          if(plate.length<7)return sendJson(res,400,{ok:false,error:'Informe uma placa válida.'});
          const token=crypto.randomBytes(32).toString('hex');
          const q=await pool.query(
            "INSERT INTO driver_tracking_test_devices(token_hash,driver_name,vehicle_plate,device_name,last_seen_at) VALUES($1,$2,$3,$4,NOW()) RETURNING id::text AS id",
            [dashboardTokenHash(token),driver,plate,String(body.device_name||'Celular de teste').slice(0,120)]
          );
          return sendJson(res,201,{ok:true,token,test_device_id:q.rows[0].id,driver_name:driver,vehicle_plate:plate,test_only:true});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao iniciar teste.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/test/point') {
        try {
          const token=trackingBearer(req);
          if(!token)return sendJson(res,401,{ok:false,error:'Teste não autenticado.'});
          const d=await pool.query("SELECT id::text AS id FROM driver_tracking_test_devices WHERE token_hash=$1 LIMIT 1",[dashboardTokenHash(token)]);
          if(!d.rowCount)return sendJson(res,401,{ok:false,error:'Teste inválido.'});
          const body=await readJsonBodyLimited(req,16*1024);
          const lat=Number(body.latitude),lon=Number(body.longitude),acc=Number(body.accuracy_m);
          const captured=new Date(body.captured_at||Date.now());
          if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180)return sendJson(res,400,{ok:false,error:'Coordenadas inválidas.'});
          await pool.query(
            "INSERT INTO driver_tracking_test_points(test_device_id,latitude,longitude,accuracy_m,captured_at) VALUES($1,$2,$3,$4,$5)",
            [d.rows[0].id,lat,lon,Number.isFinite(acc)?acc:null,captured.toISOString()]
          );
          await pool.query("UPDATE driver_tracking_test_devices SET last_seen_at=NOW() WHERE id=$1",[d.rows[0].id]);
          return sendJson(res,200,{ok:true,test_only:true,server_time:new Date().toISOString()});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao registrar ponto de teste.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/test/status') {
        try {
          const token=trackingBearer(req);
          if(!token)return sendJson(res,401,{ok:false,error:'Teste não autenticado.'});
          const q=await pool.query(`
            SELECT d.id::text AS id,d.driver_name,d.vehicle_plate,d.last_seen_at,
                   p.latitude,p.longitude,p.accuracy_m,p.captured_at,
                   (SELECT COUNT(*)::int FROM driver_tracking_test_points x WHERE x.test_device_id=d.id) AS points
            FROM driver_tracking_test_devices d
            LEFT JOIN LATERAL (
              SELECT latitude,longitude,accuracy_m,captured_at
              FROM driver_tracking_test_points
              WHERE test_device_id=d.id
              ORDER BY captured_at DESC LIMIT 1
            ) p ON TRUE
            WHERE d.token_hash=$1 LIMIT 1
          `,[dashboardTokenHash(token)]);
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Teste não encontrado.'});
          return sendJson(res,200,{ok:true,row:q.rows[0],test_only:true});
        } catch(e){return sendJson(res,500,{ok:false,error:e.message||'Falha ao consultar teste.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/app-update') {
        try {
          const channel=String(u.searchParams.get('channel')||'normal').toLowerCase()==='teste'?'teste':'normal';
          const current=Number(u.searchParams.get('version_code')||0);
          if(!fs.existsSync(DRIVER_UPDATE_FILE))return sendJson(res,200,{ok:true,available:false,currentVersionCode:current});
          const meta=JSON.parse(fs.readFileSync(DRIVER_UPDATE_FILE,'utf8'));
          const item=meta[channel]||null;
          if(!item)return sendJson(res,200,{ok:true,available:false,currentVersionCode:current});
          const latest=Number(item.versionCode||0);
          return sendJson(res,200,{
            ok:true,
            available:latest>current,
            currentVersionCode:current,
            latestVersionCode:latest,
            latestVersionName:String(item.versionName||''),
            apkUrl:DRIVER_PUBLIC_BASE+String(item.url||''),
            notes:String(item.notes||'Atualização do CONSTRULOG Motorista.')
          });
        } catch(e){return sendJson(res,500,{ok:false,error:'Não foi possível verificar atualização.'});}
      }

      if (req.method === 'GET' && /^\/downloads\/CONSTRULOG-Motorista-(NORMAL|TESTE)\.apk$/i.test(u.pathname)) {
        try {
          const file=path.join(DRIVER_DOWNLOADS,path.basename(u.pathname));
          if(!fs.existsSync(file))return sendJson(res,404,{ok:false,error:'APK ainda não publicado.'});
          const st=fs.statSync(file);
          res.writeHead(200,{
            'Content-Type':'application/vnd.android.package-archive',
            'Content-Length':st.size,
            'Content-Disposition':'attachment; filename="'+path.basename(file)+'"',
            'Cache-Control':'no-store'
          });
          return fs.createReadStream(file).pipe(res);
        } catch(e){return sendJson(res,500,{ok:false,error:'Falha ao baixar atualização.'});}
      }

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

      if (req.method === 'GET' && (u.pathname === '/lotacao' || u.pathname === '/lotacao/')) {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'lotacao')||dashboardHas(user,'coletas')||dashboardHas(user,'financeiro'))){
            res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
            return res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial;padding:30px;color:#334155}h2{color:#991b1b}</style><h2>Acesso não autorizado</h2><p>Este usuário não possui permissão para Lotação.</p>');
          }
          return sendHtml(res,LOTACAO_PAGE);
        } catch(e){
          res.writeHead(302,{Location:'/?login=1#lotacao','Cache-Control':'no-store'});
          return res.end();
        }
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
        res.writeHead(302, { Location: '/#lotacao', 'Cache-Control': 'no-store' });
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

      if (req.method === 'GET' && u.pathname === '/api/painel/agendamento-teste') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'agendamentos')||dashboardHas(user,'dashboard')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const nf=String(u.searchParams.get('nf')||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');
          const params=[],where=[];
          if(nf){params.push(nf);where.push('nf=$'+params.length)}
          const limit=Math.max(1,Math.min(500,Number(u.searchParams.get('limit')||100)));
          params.push(limit);
          const sql='SELECT id::text AS id,nf,ctrc,cliente,cidade,uf,status_ssw,mercadoria,peso,volumes,previsao_ssw,dia_rota,agendado,data_agendamento,criado_em,atualizado_em FROM agendamento_teste ' +
            (where.length?('WHERE '+where.join(' AND ')+' '):'') + 'ORDER BY criado_em DESC LIMIT $'+params.length;
          const q=await pool.query(sql,params);
          return sendJson(res,200,{ok:true,rows:q.rows});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar agendamentos de teste.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/agendamento-teste') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'agendamentos')||dashboardHas(user,'dashboard')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,64*1024);
          const nf=String(body.nf||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');
          if(!nf)return sendJson(res,400,{ok:false,error:'Informe a nota fiscal.'});
          const agendado=!!body.agendado;
          const data=/^\d{4}-\d{2}-\d{2}$/.test(String(body.data_agendamento||''))?String(body.data_agendamento):null;
          if(agendado&&!data)return sendJson(res,400,{ok:false,error:'Informe a data do agendamento.'});
          const q=await pool.query(
            'INSERT INTO agendamento_teste (nf,ctrc,cliente,cidade,uf,status_ssw,mercadoria,peso,volumes,previsao_ssw,dia_rota,agendado,data_agendamento,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id::text AS id,nf,ctrc,cliente,cidade,uf,status_ssw,mercadoria,peso,volumes,previsao_ssw,dia_rota,agendado,data_agendamento,criado_em',
            [nf,String(body.ctrc||''),String(body.cliente||''),String(body.cidade||''),String(body.uf||''),String(body.status_ssw||''),String(body.mercadoria||''),Number(body.peso||0),Number(body.volumes||0),String(body.previsao_ssw||''),String(body.dia_rota||''),agendado,data,user.id]
          );
          return sendJson(res,201,{ok:true,row:q.rows[0]});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao salvar agendamento de teste.'})}
      }
      if (req.method === 'GET' && u.pathname === '/api/painel/coletas-resumo') {
        const from=String(u.searchParams.get('from')||'').trim();
        const to=String(u.searchParams.get('to')||'').trim();
        const params=[],where=[];
        if(/^\d{4}-\d{2}-\d{2}$/.test(from)){params.push(from);where.push("COALESCE(NULLIF(to_jsonb(c)->>'data_carregamento',''),NULLIF(to_jsonb(c)->>'data_coleta',''),NULLIF(to_jsonb(c)->>'collection_date',''),LEFT(COALESCE(to_jsonb(c)->>'created_at',''),10)) >= $"+params.length)}
        if(/^\d{4}-\d{2}-\d{2}$/.test(to)){params.push(to);where.push("COALESCE(NULLIF(to_jsonb(c)->>'data_carregamento',''),NULLIF(to_jsonb(c)->>'data_coleta',''),NULLIF(to_jsonb(c)->>'collection_date',''),LEFT(COALESCE(to_jsonb(c)->>'created_at',''),10)) <= $"+params.length)}
        const result = await pool.query(`
          SELECT
            id::text AS id,
            COALESCE(to_jsonb(c)->>'os_numero', to_jsonb(c)->>'numero_os', to_jsonb(c)->>'os', to_jsonb(c)->>'numero_coleta', to_jsonb(c)->>'collection_number', '') AS os,
            COALESCE(to_jsonb(c)->>'cliente', to_jsonb(c)->>'client', to_jsonb(c)->>'nome_cliente', to_jsonb(c)->>'customer', '') AS cliente,
            COALESCE(to_jsonb(c)->>'destinatario', '') AS destinatario,
            COALESCE(to_jsonb(c)->>'origem', to_jsonb(c)->>'cidade_coleta', to_jsonb(c)->>'endereco_coleta', '') AS origem,
            COALESCE(to_jsonb(c)->>'destino', to_jsonb(c)->>'cidade_entrega', to_jsonb(c)->>'endereco_entrega', to_jsonb(c)->>'delivery_address', '') AS destino,
            COALESCE(to_jsonb(c)->>'motorista', to_jsonb(c)->>'driver', to_jsonb(c)->>'nome_motorista', '') AS motorista,
            COALESCE(to_jsonb(c)->>'placa', to_jsonb(c)->>'plate', '') AS placa,
            COALESCE(to_jsonb(c)->>'status','') AS status,
            COALESCE(to_jsonb(c)->>'data_carregamento', to_jsonb(c)->>'data_coleta', to_jsonb(c)->>'collection_date', to_jsonb(c)->>'created_at', '') AS data,
            COALESCE(
              NULLIF(to_jsonb(c)->>'frete_receber','')::numeric,
              NULLIF(to_jsonb(c)->>'frete_a_receber','')::numeric,
              NULLIF(to_jsonb(c)->>'frete_cobrado','')::numeric,
              NULLIF(to_jsonb(c)->>'valor_frete','')::numeric,
              0
            ) AS frete_receber,
            COALESCE(
              NULLIF(to_jsonb(c)->>'frete_pago','')::numeric,
              NULLIF(to_jsonb(c)->>'frete_motorista','')::numeric,
              NULLIF(to_jsonb(c)->>'valor_motorista','')::numeric,
              0
            ) AS frete_pago,
            COALESCE(
              NULLIF(to_jsonb(c)->>'pedagio','')::numeric,
              NULLIF(to_jsonb(c)->>'pedágio','')::numeric,
              0
            ) AS pedagio,
            COALESCE(to_jsonb(c)->>'adiantamento', to_jsonb(c)->>'percentual_adiantamento', '') AS adiantamento,
            COALESCE(c.recebido,false) AS recebido,
            c.data_recebimento,
            c.previsao_pagamento_fatura
          FROM coletas c
          ${where.length?'WHERE '+where.join(' AND '):''}
          ORDER BY COALESCE(NULLIF(to_jsonb(c)->>'data_carregamento',''),NULLIF(to_jsonb(c)->>'data_coleta',''),NULLIF(to_jsonb(c)->>'collection_date',''),LEFT(COALESCE(to_jsonb(c)->>'created_at',''),10)) DESC, id DESC
          LIMIT 500
        `,params);
        const rows=result.rows.map(r=>{
          const receber=Number(r.frete_receber||0),pago=Number(r.frete_pago||0),pedagio=Number(r.pedagio||0);
          return {...r,lucro:receber-pago-pedagio,margem:receber>0?((receber-pago-pedagio)/receber*100):0}
        });
        return sendJson(res, 200, {ok:true,rows});
      }



      if (req.method === 'POST' && u.pathname === '/api/tracking/register-request') {
        try {
          const body=await readJsonBodyLimited(req,64*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const plate=String(body.vehicle_plate||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
          const deviceName=String(body.device_name||'Android').trim().slice(0,120);
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Informe o nome do motorista.'});
          if(plate&&plate.length<7)return sendJson(res,400,{ok:false,error:'Informe uma placa válida ou deixe em branco.'});
          const requestToken=crypto.randomBytes(32).toString('hex');
          await pool.query(
            "INSERT INTO driver_tracking_requests(request_token_hash,driver_name,vehicle_plate,device_name,status) VALUES($1,$2,$3,$4,'pending')",
            [dashboardTokenHash(requestToken),driver,plate,deviceName]
          );
          console.log('TRACKING APROVACAO solicitada: '+JSON.stringify({driver,plate,deviceName}));
          return sendJson(res,201,{ok:true,status:'pending',request_token:requestToken,message:'Solicitação enviada. Aguarde a aprovação da central.'});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao solicitar ativação.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/tracking/register-status') {
        try {
          const requestToken=String(u.searchParams.get('request_token')||'').trim();
          if(requestToken.length<20)return sendJson(res,400,{ok:false,error:'Solicitação inválida.'});
          const q=await pool.query(
            "SELECT id::text AS id,driver_name,vehicle_plate,status,issued_token,created_at,decided_at FROM driver_tracking_requests WHERE request_token_hash=$1 LIMIT 1",
            [dashboardTokenHash(requestToken)]
          );
          if(!q.rowCount)return sendJson(res,404,{ok:false,error:'Solicitação não encontrada.'});
          const row=q.rows[0];
          if(row.status==='approved'&&row.issued_token){
            return sendJson(res,200,{ok:true,status:'approved',token:row.issued_token,driver_name:row.driver_name,vehicle_plate:row.vehicle_plate||''});
          }
          return sendJson(res,200,{ok:true,status:row.status,driver_name:row.driver_name,vehicle_plate:row.vehicle_plate||''});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar aprovação.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/enroll') {
        try {
          const body=await readJsonBodyLimited(req,64*1024);
          const code=String(body.code||'').replace(/\D/g,'');
          const deviceName=String(body.device_name||'Android').trim().slice(0,120);
          if(!/^\d{6}$/.test(code))return sendJson(res,400,{ok:false,error:'Código de ativação inválido.'});
          const codeHash=dashboardTokenHash(code);
          const q=await pool.query(
            "SELECT id::text AS id, driver_name, vehicle_plate FROM driver_tracking_enrollments WHERE code_hash=$1 AND used_at IS NULL AND expires_at>NOW() LIMIT 1",
            [codeHash]
          );
          if(!q.rowCount)return sendJson(res,401,{ok:false,error:'Código expirado ou já utilizado.'});
          const row=q.rows[0],token=crypto.randomBytes(32).toString('hex');
          const client=await pool.connect();
          try{
            await client.query('BEGIN');
            await client.query(
              `UPDATE driver_tracking_devices
               SET active=FALSE
               WHERE active=TRUE
                 AND lower(trim(driver_name))=lower(trim($1))
                 AND upper(trim(COALESCE(vehicle_plate,'')))=upper(trim(COALESCE($2,'')))`,
              [row.driver_name,row.vehicle_plate||'']
            );
            const dev=await client.query(
              "INSERT INTO driver_tracking_devices(token_hash,driver_name,vehicle_plate,device_name,last_seen_at) VALUES($1,$2,$3,$4,NOW()) RETURNING id::text AS id",
              [dashboardTokenHash(token),row.driver_name,row.vehicle_plate||'',deviceName]
            );
            await client.query('UPDATE driver_tracking_enrollments SET used_at=NOW() WHERE id=$1',[row.id]);
            await client.query('COMMIT');
            return sendJson(res,200,{ok:true,token,device_id:dev.rows[0].id,driver_name:row.driver_name,vehicle_plate:row.vehicle_plate||''})
          }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao ativar dispositivo.'})}
      }

      async function trackingEnsureTodaySession(deviceId) {
        const active=await pool.query(
          "SELECT id::text AS id,started_at FROM driver_tracking_sessions WHERE device_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",
          [deviceId]
        );
        if(active.rowCount){
          const sameDay=await pool.query(
            "SELECT (($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AS ok",
            [active.rows[0].started_at]
          );
          if(sameDay.rows[0]?.ok)return active.rows[0].id;
          await pool.query(
            "UPDATE driver_tracking_sessions SET status='ended',ended_at=COALESCE(ended_at,NOW()) WHERE id::text=$1",
            [active.rows[0].id]
          );
        }
        const today=await pool.query(
          "SELECT id::text AS id,status FROM driver_tracking_sessions WHERE device_id=$1 AND (started_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY started_at DESC LIMIT 1",
          [deviceId]
        );
        // Se a rota foi encerrada explicitamente hoje, não reabre automaticamente.
        if(today.rowCount&&today.rows[0].status==='ended')return '';
        const q=await pool.query("INSERT INTO driver_tracking_sessions(device_id,status) VALUES($1,'active') RETURNING id::text AS id",[deviceId]);
        return q.rows[0]?.id||'';
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/session/start') {
        try {
          const device=await trackingDeviceFromReq(req);
          await pool.query("UPDATE driver_tracking_sessions SET status='ended',ended_at=COALESCE(ended_at,NOW()) WHERE device_id=$1 AND status='active'",[device.id]);
          const q=await pool.query("INSERT INTO driver_tracking_sessions(device_id,status) VALUES($1,'active') RETURNING id::text AS id,started_at",[device.id]);
          await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
          return sendJson(res,200,{ok:true,session_id:q.rows[0].id,started_at:q.rows[0].started_at,driver_name:device.driver_name,vehicle_plate:device.vehicle_plate||''})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao iniciar rota.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/session/stop') {
        try {
          const device=await trackingDeviceFromReq(req);
          const body=await readJsonBodyLimited(req,32*1024),sessionId=String(body.session_id||'').trim();
          if(sessionId)await pool.query("UPDATE driver_tracking_sessions SET status='ended',ended_at=NOW() WHERE id::text=$1 AND device_id=$2",[sessionId,device.id]);
          else await pool.query("UPDATE driver_tracking_sessions SET status='ended',ended_at=NOW() WHERE device_id=$1 AND status='active'",[device.id]);
          await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
          return sendJson(res,200,{ok:true})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao encerrar rota.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/heartbeat') {
        try {
          const device=await trackingDeviceFromReq(req);
          const body=await readJsonBodyLimited(req,16*1024);
          const sessionId=String(body.session_id||'').trim();
          let effectiveSessionId=sessionId;
          if(sessionId){
            const sess=await pool.query("SELECT id::text AS id FROM driver_tracking_sessions WHERE id::text=$1 AND device_id=$2 AND status='active' LIMIT 1",[sessionId,device.id]);
            if(!sess.rowCount){
              const active=await pool.query("SELECT id::text AS id FROM driver_tracking_sessions WHERE device_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",[device.id]);
              effectiveSessionId=active.rows[0]?.id||'';
              if(!effectiveSessionId)return sendJson(res,409,{ok:false,error:'Sessão de rota não está ativa.'});
            }
          }else{
            effectiveSessionId=await trackingEnsureTodaySession(device.id);
          }
          if(!effectiveSessionId&&!sessionId){
            effectiveSessionId=await trackingEnsureTodaySession(device.id);
          }
          await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
          return sendJson(res,200,{ok:true,session_id:effectiveSessionId||null,server_time:new Date().toISOString()})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao confirmar comunicação do dispositivo.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/tracking/point') {
        try {
          const device=await trackingDeviceFromReq(req);
          const body=await readJsonBodyLimited(req,48*1024);
          const sessionId=String(body.session_id||'').trim(),lat=Number(body.latitude),lon=Number(body.longitude);
          const captured=new Date(body.captured_at||Date.now());
          if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180)return sendJson(res,400,{ok:false,error:'Coordenadas inválidas.'});
          if(!Number.isFinite(captured.getTime()))return sendJson(res,400,{ok:false,error:'Data/hora inválida.'});
          let effectiveSessionId=sessionId;
          if(sessionId){
            const sess=await pool.query("SELECT id::text AS id FROM driver_tracking_sessions WHERE id::text=$1 AND device_id=$2 AND status='active' LIMIT 1",[sessionId,device.id]);
            if(!sess.rowCount)effectiveSessionId='';
          }
          if(!effectiveSessionId){
            effectiveSessionId=await trackingEnsureTodaySession(device.id);
          }
          if(!effectiveSessionId)return sendJson(res,409,{ok:false,error:'Sessão de rota foi encerrada hoje. Inicie uma nova rota para voltar ao mapa.'});
          await pool.query(
            "INSERT INTO driver_tracking_points(session_id,device_id,latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [effectiveSessionId,device.id,lat,lon,Number.isFinite(Number(body.accuracy_m))?Number(body.accuracy_m):null,Number.isFinite(Number(body.speed_mps))?Number(body.speed_mps):null,Number.isFinite(Number(body.bearing_deg))?Number(body.bearing_deg):null,Number.isFinite(Number(body.battery_pct))?Number(body.battery_pct):null,captured.toISOString()]
          );
          await pool.query('UPDATE driver_tracking_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
          return sendJson(res,200,{ok:true,session_id:effectiveSessionId})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao registrar posição.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/requests') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const q=await pool.query(`
            SELECT id::text AS id,driver_name,vehicle_plate,device_name,status,created_at,decided_at
            FROM (
              SELECT r.*,
                     ROW_NUMBER() OVER (
                       PARTITION BY lower(trim(driver_name)), upper(trim(COALESCE(vehicle_plate,'')))
                       ORDER BY created_at DESC,id DESC
                     ) AS rn
              FROM driver_tracking_requests r
              WHERE status='pending'
                 OR (created_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
            ) x
            WHERE rn=1
            ORDER BY (status='pending') DESC,created_at DESC
            LIMIT 100
          `);
          return sendJson(res,200,{ok:true,rows:q.rows});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar solicitações.'})}
      }

      if (req.method === 'POST' && /^\/api\/painel\/tracking\/requests\/\d+\/approve$/.test(u.pathname)) {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const id=(u.pathname.match(/requests\/(\d+)\/approve$/)||[])[1];
          const client=await pool.connect();
          try{
            await client.query('BEGIN');
            const rq=await client.query("SELECT * FROM driver_tracking_requests WHERE id=$1 FOR UPDATE",[id]);
            if(!rq.rowCount){await client.query('ROLLBACK');return sendJson(res,404,{ok:false,error:'Solicitação não encontrada.'})}
            const row=rq.rows[0];
            if(row.status==='approved'){await client.query('COMMIT');return sendJson(res,200,{ok:true,status:'approved'})}
            const token=crypto.randomBytes(32).toString('hex');
            await client.query(
              `UPDATE driver_tracking_devices
               SET active=FALSE
               WHERE active=TRUE
                 AND lower(trim(driver_name))=lower(trim($1))
                 AND upper(trim(COALESCE(vehicle_plate,'')))=upper(trim(COALESCE($2,'')))`,
              [row.driver_name,row.vehicle_plate||'']
            );
            const dev=await client.query(
              "INSERT INTO driver_tracking_devices(token_hash,driver_name,vehicle_plate,device_name,last_seen_at) VALUES($1,$2,$3,$4,NOW()) RETURNING id::text AS id",
              [dashboardTokenHash(token),row.driver_name,row.vehicle_plate||'',row.device_name||'Android']
            );
            await client.query(
              "INSERT INTO driver_tracking_sessions(device_id,status) VALUES($1,'active')",
              [dev.rows[0].id]
            );
            await client.query(
              "UPDATE driver_tracking_requests SET status='approved',issued_token=$1,approved_device_id=$2,decided_at=NOW(),decided_by=$3 WHERE id=$4",
              [token,dev.rows[0].id,user.id,id]
            );
            await client.query('COMMIT');
            console.log('TRACKING APROVACAO aprovada: '+JSON.stringify({id,driver:row.driver_name,plate:row.vehicle_plate||'',deviceId:dev.rows[0].id}));
            return sendJson(res,200,{ok:true,status:'approved',driver_name:row.driver_name,vehicle_plate:row.vehicle_plate||'',device_id:dev.rows[0].id});
          }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao aprovar dispositivo.'})}
      }

      if (req.method === 'POST' && /^\/api\/painel\/tracking\/requests\/\d+\/reject$/.test(u.pathname)) {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const id=(u.pathname.match(/requests\/(\d+)\/reject$/)||[])[1];
          await pool.query("UPDATE driver_tracking_requests SET status='rejected',decided_at=NOW(),decided_by=$1 WHERE id=$2 AND status='pending'",[user.id,id]);
          return sendJson(res,200,{ok:true,status:'rejected'});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao rejeitar dispositivo.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/tracking/test-assignment') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,64*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const plate=String(body.vehicle_plate||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
          const romaneios=[...new Set((Array.isArray(body.romaneios)?body.romaneios:[body.romaneio]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,20);
          const workDate=/^\d{4}-\d{2}-\d{2}$/.test(String(body.work_date||''))?String(body.work_date):(new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}));
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Motorista inválido.'});
          if(plate.length<7)return sendJson(res,400,{ok:false,error:'Placa inválida.'});
          if(!romaneios.length)return sendJson(res,400,{ok:false,error:'Romaneio não informado.'});
          const invite=crypto.randomBytes(32).toString('hex');
          await pool.query(
            "INSERT INTO driver_tracking_test_assignments(invite_token_hash,driver_name,vehicle_plate,romaneios,work_date,active) VALUES($1,$2,$3,$4::jsonb,$5::date,TRUE)",
            [dashboardTokenHash(invite),driver,plate,JSON.stringify(romaneios),workDate]
          );
          const installUrl=DRIVER_PUBLIC_BASE+'/motorista-teste-instalar?i='+encodeURIComponent(invite);
          return sendJson(res,201,{ok:true,driver_name:driver,vehicle_plate:plate,romaneios,work_date:workDate,install_url:installUrl,test_only:true});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao criar convite de teste.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/tracking/assignment') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,64*1024);
          const driver=String(body.driver_name||'').trim().replace(/\s+/g,' ').slice(0,120);
          const plate=String(body.vehicle_plate||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
          const romaneios=[...new Set((Array.isArray(body.romaneios)?body.romaneios:[body.romaneio]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,20);
          const workDate=/^\d{4}-\d{2}-\d{2}$/.test(String(body.work_date||''))?String(body.work_date):(new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}));
          if(driver.length<2)return sendJson(res,400,{ok:false,error:'Motorista inválido.'});
          if(plate.length<7)return sendJson(res,400,{ok:false,error:'Placa inválida.'});
          if(!romaneios.length)return sendJson(res,400,{ok:false,error:'Romaneio não informado.'});
          const invite=crypto.randomBytes(32).toString('hex');
          const client=await pool.connect();
          try{
            await client.query('BEGIN');
            await client.query(
              `UPDATE driver_tracking_assignments SET active=FALSE,updated_at=NOW()
               WHERE work_date=$1::date AND active=TRUE
                 AND (upper(trim(COALESCE(vehicle_plate,'')))=upper(trim($2)) OR lower(trim(driver_name))=lower(trim($3)))`,
              [workDate,plate,driver]
            );
            await client.query(
              "INSERT INTO driver_tracking_assignments(invite_token_hash,driver_name,vehicle_plate,romaneios,work_date,active,created_by) VALUES($1,$2,$3,$4::jsonb,$5::date,TRUE,$6)",
              [dashboardTokenHash(invite),driver,plate,JSON.stringify(romaneios),workDate,user.id]
            );
            await client.query('COMMIT');
          }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
          const installUrl=DRIVER_PUBLIC_BASE+'/motorista-instalar?i='+encodeURIComponent(invite);
          return sendJson(res,201,{ok:true,driver_name:driver,vehicle_plate:plate,romaneios,work_date:workDate,invite_token:invite,install_url:installUrl});
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao associar romaneio ao motorista.'})}
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/tracking/enrollments') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const body=await readJsonBodyLimited(req,32*1024);
          const driver=String(body.driver_name||'').trim(),plate=String(body.vehicle_plate||'').trim().toUpperCase().slice(0,20);
          const hours=Math.max(1,Math.min(168,Number(body.expires_hours||24)));
          if(!driver)return sendJson(res,400,{ok:false,error:'Informe o motorista.'});
          let code='';
          for(let i=0;i<10;i++){
            code=trackingCode();
            const exists=await pool.query('SELECT 1 FROM driver_tracking_enrollments WHERE code_hash=$1 AND used_at IS NULL AND expires_at>NOW() LIMIT 1',[dashboardTokenHash(code)]);
            if(!exists.rowCount)break
          }
          await pool.query(
            "INSERT INTO driver_tracking_enrollments(code_hash,driver_name,vehicle_plate,expires_at,created_by) VALUES($1,$2,$3,NOW()+($4*INTERVAL '1 hour'),$5)",
            [dashboardTokenHash(code),driver,plate,hours,user.id]
          );
          return sendJson(res,201,{ok:true,code,driver_name:driver,vehicle_plate:plate,expires_hours:hours})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao gerar código.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/test-live') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const q=await pool.query(`
            SELECT d.id::text AS device_id,d.driver_name,d.vehicle_plate,d.device_name,d.last_seen_at,
                   p.latitude,p.longitude,p.accuracy_m,p.captured_at,
                   EXTRACT(EPOCH FROM (NOW()-p.captured_at))::int AS age_seconds,
                   EXTRACT(EPOCH FROM (NOW()-d.last_seen_at))::int AS device_age_seconds
            FROM driver_tracking_test_devices d
            LEFT JOIN LATERAL (
              SELECT latitude,longitude,accuracy_m,captured_at
              FROM driver_tracking_test_points
              WHERE test_device_id=d.id
                AND (captured_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              ORDER BY captured_at DESC LIMIT 1
            ) p ON TRUE
            WHERE d.last_seen_at IS NOT NULL
              AND (d.last_seen_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
            ORDER BY COALESCE(p.captured_at,d.last_seen_at) DESC
            LIMIT 100
          `);
          const rows=q.rows.map(r=>({
            ...r,
            original_driver_name:r.driver_name,
            original_vehicle_plate:r.vehicle_plate,
            driver_name:'TESTE - '+r.driver_name,
            vehicle_plate:(String(r.vehicle_plate||'').trim()+' T').trim(),
            session_id:'TEST-'+r.device_id,
            session_status:'active',
            map_active:!!r.captured_at||Number(r.device_age_seconds)<=300,
            test_only:true,
            speed_mps:null,bearing_deg:null,battery_pct:null,trail:[]
          }));
          return sendJson(res,200,{ok:true,rows,test_only:true});
        } catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao carregar GPS de teste.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/live') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const light=String(u.searchParams.get('light')||'')==='1';
          const q=await pool.query(light?`
            SELECT d.id::text AS device_id,d.driver_name,d.vehicle_plate,d.device_name,d.last_seen_at,
                   s.id::text AS session_id,s.started_at,s.ended_at,s.status AS session_status,
                   p.latitude,p.longitude,p.accuracy_m,p.speed_mps,p.bearing_deg,p.battery_pct,p.captured_at,
                   '[]'::json AS trail,
                   EXTRACT(EPOCH FROM (NOW()-p.captured_at))::int AS age_seconds,
                   EXTRACT(EPOCH FROM (NOW()-d.last_seen_at))::int AS device_age_seconds,
                   (p.captured_at IS NOT NULL OR d.last_seen_at >= NOW()-INTERVAL '5 minutes') AS map_active
            FROM driver_tracking_devices d
            LEFT JOIN LATERAL (
              SELECT id,started_at,ended_at,status FROM driver_tracking_sessions
              WHERE device_id=d.id
                AND (started_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              ORDER BY (status='active') DESC,started_at DESC LIMIT 1
            ) s ON TRUE
            LEFT JOIN LATERAL (
              SELECT latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at
              FROM driver_tracking_points
              WHERE device_id=d.id
                AND (captured_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              ORDER BY (s.id IS NOT NULL AND session_id=s.id) DESC,captured_at DESC LIMIT 1
            ) p ON TRUE
            WHERE d.active=TRUE
            ORDER BY COALESCE(p.captured_at,d.last_seen_at) DESC NULLS LAST
            LIMIT 300
          `:`
            SELECT d.id::text AS device_id,d.driver_name,d.vehicle_plate,d.device_name,d.last_seen_at,
                   s.id::text AS session_id,s.started_at,s.ended_at,s.status AS session_status,
                   p.latitude,p.longitude,p.accuracy_m,p.speed_mps,p.bearing_deg,p.battery_pct,p.captured_at,
                   COALESCE(t.trail,'[]'::json) AS trail,
                   EXTRACT(EPOCH FROM (NOW()-p.captured_at))::int AS age_seconds,
                   EXTRACT(EPOCH FROM (NOW()-d.last_seen_at))::int AS device_age_seconds,
                   (p.captured_at IS NOT NULL OR d.last_seen_at >= NOW()-INTERVAL '5 minutes') AS map_active
            FROM driver_tracking_devices d
            LEFT JOIN LATERAL (
              SELECT id,started_at,ended_at,status FROM driver_tracking_sessions
              WHERE device_id=d.id
                AND (started_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              ORDER BY (status='active') DESC,started_at DESC LIMIT 1
            ) s ON TRUE
            LEFT JOIN LATERAL (
              SELECT latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at
              FROM driver_tracking_points
              WHERE device_id=d.id
                AND (captured_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              ORDER BY (s.id IS NOT NULL AND session_id=s.id) DESC,captured_at DESC LIMIT 1
            ) p ON TRUE
            LEFT JOIN LATERAL (
              SELECT json_agg(json_build_object(
                'latitude',x.latitude,'longitude',x.longitude,'accuracy_m',x.accuracy_m,
                'speed_mps',x.speed_mps,'bearing_deg',x.bearing_deg,'battery_pct',x.battery_pct,
                'captured_at',x.captured_at
              ) ORDER BY x.captured_at) AS trail
              FROM (
                SELECT latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at
                FROM driver_tracking_points
                WHERE s.id IS NOT NULL AND session_id=s.id
                ORDER BY captured_at DESC
                LIMIT 1200
              ) x
            ) t ON TRUE
            WHERE d.active=TRUE
            ORDER BY COALESCE(p.captured_at,d.last_seen_at) DESC NULLS LAST
            LIMIT 300
          `);
          const freshest=new Map();
          for(const row of q.rows){
            const plate=String(row.vehicle_plate||'').trim().toUpperCase();
            const driver=String(row.driver_name||'').trim().toLocaleUpperCase('pt-BR');
            const key=plate?('P|'+plate):('D|'+driver);
            const at=Math.max(
              row.captured_at?new Date(row.captured_at).getTime():0,
              row.last_seen_at?new Date(row.last_seen_at).getTime():0,
              row.started_at?new Date(row.started_at).getTime():0
            );
            const prev=freshest.get(key);
            if(!prev||at>prev._freshAt)freshest.set(key,{...row,_freshAt:at});
          }
          const rows=[...freshest.values()].map(({_freshAt,...row})=>row)
            .sort((a,b)=>{
              const ta=Math.max(a.captured_at?new Date(a.captured_at).getTime():0,a.last_seen_at?new Date(a.last_seen_at).getTime():0);
              const tb=Math.max(b.captured_at?new Date(b.captured_at).getTime():0,b.last_seen_at?new Date(b.last_seen_at).getTime():0);
              return tb-ta
            });
          return sendJson(res,200,{ok:true,light,rows,server_time:new Date().toISOString()})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar rastreamento.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/history-drivers') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const date=String(u.searchParams.get('date')||'').trim();
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return sendJson(res,400,{ok:false,error:'Data inválida.'});
          const q=await pool.query(`
            SELECT d.driver_name,d.vehicle_plate,COUNT(*)::int AS points,
                   MIN(p.captured_at) AS first_point,MAX(p.captured_at) AS last_point
            FROM driver_tracking_points p
            JOIN driver_tracking_devices d ON d.id=p.device_id
            WHERE p.captured_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
              AND p.captured_at < (($1::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
            GROUP BY d.driver_name,d.vehicle_plate
            ORDER BY lower(d.driver_name),d.vehicle_plate
          `,[date]);
          return sendJson(res,200,{ok:true,date,rows:q.rows})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao listar motoristas do histórico.'})}
      }

      if (req.method === 'GET' && u.pathname === '/api/painel/tracking/history') {
        try {
          const user=await dashboardSession(req,false);
          if(!(user.is_admin||dashboardHas(user,'tracking')))return sendJson(res,403,{ok:false,error:'Acesso não autorizado.'});
          const sessionId=String(u.searchParams.get('session_id')||'').trim();
          if(sessionId){
            const q=await pool.query(
              "SELECT latitude,longitude,accuracy_m,speed_mps,bearing_deg,battery_pct,captured_at FROM driver_tracking_points WHERE session_id::text=$1 ORDER BY captured_at ASC LIMIT 10000",
              [sessionId]
            );
            return sendJson(res,200,{ok:true,rows:q.rows})
          }
          const date=String(u.searchParams.get('date')||'').trim();
          const driver=String(u.searchParams.get('driver')||'').trim();
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return sendJson(res,400,{ok:false,error:'Data inválida.'});
          const raw=String(u.searchParams.get('raw')||'')==='1';
          if(raw){
            const qr=await pool.query(`
              SELECT p.session_id::text AS session_id,d.driver_name,d.vehicle_plate,
                     p.latitude,p.longitude,p.accuracy_m,p.speed_mps,p.bearing_deg,p.battery_pct,p.captured_at
              FROM driver_tracking_points p
              JOIN driver_tracking_devices d ON d.id=p.device_id
              WHERE p.captured_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
                AND p.captured_at < (($1::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
                AND ($2='' OR lower(d.driver_name)=lower($2))
              ORDER BY p.captured_at ASC
              LIMIT 60000
            `,[date,driver]);
            return sendJson(res,200,{ok:true,date,driver:driver||'',raw:true,rows:qr.rows,points:qr.rows.length})
          }
          const q=await pool.query(`
            SELECT s.id::text AS session_id,d.driver_name,d.vehicle_plate,
                   s.started_at,s.ended_at,s.status,
                   p.latitude,p.longitude,p.accuracy_m,p.speed_mps,p.bearing_deg,p.battery_pct,p.captured_at
            FROM driver_tracking_points p
            JOIN driver_tracking_sessions s ON s.id=p.session_id
            JOIN driver_tracking_devices d ON d.id=p.device_id
            WHERE p.captured_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
              AND p.captured_at < (($1::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
              AND ($2='' OR lower(d.driver_name)=lower($2))
            ORDER BY lower(d.driver_name),s.started_at,p.captured_at
            LIMIT 60000
          `,[date,driver]);
          const map=new Map();
          for(const r of q.rows){
            if(!map.has(r.session_id))map.set(r.session_id,{
              session_id:r.session_id,driver_name:r.driver_name,vehicle_plate:r.vehicle_plate,
              started_at:r.started_at,ended_at:r.ended_at,status:r.status,points:[]
            });
            map.get(r.session_id).points.push({
              latitude:r.latitude,longitude:r.longitude,accuracy_m:r.accuracy_m,
              speed_mps:r.speed_mps,bearing_deg:r.bearing_deg,battery_pct:r.battery_pct,captured_at:r.captured_at
            })
          }
          const sessions=[...map.values()].map(trackingHistorySessionSummary);
          const drivers=new Set(sessions.map(x=>String(x.driver_name||'').trim()).filter(Boolean));
          const totalStops=sessions.reduce((a,x)=>a+(x.stops?.length||0),0);
          const distanceKm=sessions.reduce((a,x)=>a+Number(x.distance_km||0),0);
          return sendJson(res,200,{ok:true,date,driver:driver||'',sessions,summary:{
            drivers:drivers.size,sessions:sessions.length,points:q.rows.length,stops:totalStops,
            distance_km:Math.round(distanceKm*10)/10,stop_min_minutes:5,stop_radius_meters:150
          }})
        }catch(e){return sendJson(res,e.status||500,{ok:false,error:e.message||'Falha ao consultar histórico.'})}
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
            'capturada_em, criado_em, foto_mime, foto_bytes, foto2_bytes, foto3_bytes, foto4_bytes, conferente_coleta_devolucao, ' +
            '(SELECT COUNT(*)::int FROM carregamentos_avarias a WHERE a.carregamento_id=carregamentos_finais.id) AS avaria_count ' +
            'FROM carregamentos_finais ' +
            (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
            'ORDER BY capturada_em DESC, id DESC LIMIT $' + params.length;
          const qr = await pool.query(sql, params);
          return sendJson(res, 200, { ok: true, motorista: motorista || null, data: data || null, tipo: tipo || null, rows: qr.rows });
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: e.message || 'Não foi possível carregar os registros de carga e descarga.' });
        }
      }

      const carregamentoFotoMatch = u.pathname.match(/^\/api\/painel\/carregamentos-finais\/(\d+)\/foto(?:\/(\d))?$/);
      if (req.method === 'GET' && carregamentoFotoMatch) {
        try {
          const slot=Math.max(1,Math.min(4,Number(carregamentoFotoMatch[2]||1)));
          const photoCol=slot===1?'foto':'foto'+slot;
          const mimeCol=slot===1?'foto_mime':'foto'+slot+'_mime';
          const r = await pool.query(
            'SELECT '+photoCol+' AS foto, '+mimeCol+' AS foto_mime FROM carregamentos_finais WHERE id=$1 LIMIT 1',
            [carregamentoFotoMatch[1]]
          );
          if (!r.rowCount || !r.rows[0].foto) return sendJson(res, 404, { ok: false, error: 'Foto não encontrada.' });
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

      const avariaFotoMatch = u.pathname.match(/^\/api\/painel\/carregamentos-finais\/(\d+)\/avaria\/(\d+)$/);
      if (req.method === 'GET' && avariaFotoMatch) {
        try {
          const ordem=Math.max(1,Math.min(10,Number(avariaFotoMatch[2]||1)));
          const r=await pool.query(
            'SELECT foto, foto_mime FROM carregamentos_avarias WHERE carregamento_id=$1 AND ordem=$2 LIMIT 1',
            [avariaFotoMatch[1],ordem]
          );
          if(!r.rowCount)return sendJson(res,404,{ok:false,error:'Foto de avaria não encontrada.'});
          const row=r.rows[0];
          res.writeHead(200,{
            'Content-Type':row.foto_mime||'image/jpeg',
            'Content-Length':row.foto.length,
            'Cache-Control':'private, max-age=3600'
          });
          return res.end(row.foto);
        } catch(e) {
          return sendJson(res,500,{ok:false,error:e.message||'Não foi possível carregar a foto de avaria.'});
        }
      }

      const carregamentoColetaDevMatch = u.pathname.match(/^\/api\/painel\/carregamentos-finais\/(\d+)\/coleta-devolucao$/);
      if (req.method === 'PATCH' && carregamentoColetaDevMatch) {
        try {
          const body=await readJsonBodyLimited(req, 3 * 1024 * 1024);
          const conferente=String(body.conferente_coleta_devolucao||'').trim();
          const captured=new Date(body.capturada_em||Date.now());
          if(!conferente)return sendJson(res,400,{ok:false,error:'Informe o nome do conferente.'});
          if(!Number.isFinite(captured.getTime()))return sendJson(res,400,{ok:false,error:'Data/hora da foto inválida.'});
          const photo=parseImageDataUrl(body.foto);
          const current=await pool.query('SELECT tipo FROM carregamentos_finais WHERE id=$1 LIMIT 1',[carregamentoColetaDevMatch[1]]);
          if(!current.rowCount)return sendJson(res,404,{ok:false,error:'Registro de carregamento não encontrado.'});
          if(String(current.rows[0].tipo||'').toLowerCase()!=='carregamento')return sendJson(res,400,{ok:false,error:'Este registro não é um carregamento.'});
          const r=await pool.query(
            'UPDATE carregamentos_finais SET conferente_coleta_devolucao=$1,foto4=$2,foto4_mime=$3,foto4_bytes=$4 WHERE id=$5 RETURNING id::text AS id,conferente_coleta_devolucao,foto4_bytes',
            [conferente,photo.buffer,photo.mime,photo.buffer.length,carregamentoColetaDevMatch[1]]
          );
          return sendJson(res,200,{ok:true,...r.rows[0],capturada_em:captured.toISOString()});
        } catch(e) {
          return sendJson(res,e.status||500,{ok:false,error:e.message||'Não foi possível atualizar coleta e devolução.'});
        }
      }

      if (req.method === 'POST' && u.pathname === '/api/painel/carregamentos-finais') {
        try {
          const body = await readJsonBodyLimited(req, 14 * 1024 * 1024);
          const tipo = String(body.tipo || 'carregamento').trim().toLowerCase();
          const conferente = String(body.conferente || '').trim();
          const motorista = String(body.motorista || '').trim();
          const conferenteColetaDevolucao = String(body.conferente_coleta_devolucao || '').trim();
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
          const extras=[body.foto2,body.foto3,body.foto4].map(v=>v?parseImageDataUrl(v):null);
          const avarias=(Array.isArray(body.avarias)?body.avarias:[]).slice(0,10).filter(Boolean).map((v,i)=>({
            ordem:i+1,
            photo:parseImageDataUrl(v)
          }));
          const r = await pool.query(`
            INSERT INTO carregamentos_finais
              (tipo, conferente, motorista, quantidade_entregas, foto, foto_mime, foto_bytes,
               foto2, foto2_mime, foto2_bytes, foto3, foto3_mime, foto3_bytes, foto4, foto4_mime, foto4_bytes,
               conferente_coleta_devolucao, capturada_em)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            RETURNING id::text AS id, tipo, conferente, motorista, quantidade_entregas, capturada_em, criado_em,
              foto_bytes, foto2_bytes, foto3_bytes, foto4_bytes, conferente_coleta_devolucao
          `, [
            tipo, conferente, motorista, quantidade, photo.buffer, photo.mime, photo.buffer.length,
            extras[0]?.buffer||null,extras[0]?.mime||null,extras[0]?.buffer?.length||0,
            extras[1]?.buffer||null,extras[1]?.mime||null,extras[1]?.buffer?.length||0,
            extras[2]?.buffer||null,extras[2]?.mime||null,extras[2]?.buffer?.length||0,
            tipo==='carregamento'?(conferenteColetaDevolucao||null):null,
            captured.toISOString()
          ]);
          const registroId=r.rows[0].id;
          for(const av of avarias){
            await pool.query(
              'INSERT INTO carregamentos_avarias(carregamento_id,ordem,foto,foto_mime,foto_bytes,capturada_em) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(carregamento_id,ordem) DO UPDATE SET foto=EXCLUDED.foto,foto_mime=EXCLUDED.foto_mime,foto_bytes=EXCLUDED.foto_bytes,capturada_em=EXCLUDED.capturada_em',
              [registroId,av.ordem,av.photo.buffer,av.photo.mime,av.photo.buffer.length,captured.toISOString()]
            )
          }
          return sendJson(res, 201, { ok: true, ...r.rows[0], avaria_count:avarias.length });
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
