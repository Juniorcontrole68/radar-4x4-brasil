import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json({ limit: '350kb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function readJson(name, fallback = []) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, name), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(name, value) {
  const file = path.join(DATA_DIR, name);
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temp, file);
}

const text = (value, max = 160) => String(value ?? '').trim().slice(0, max);
const maybeUrl = value => {
  const v = text(value, 600);
  if (!v) return '';
  try {
    const u = new URL(v);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
};
const maybeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';
const maybeNumber = value => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function normalizeSubmission(body = {}) {
  const tags = Array.isArray(body.tags)
    ? body.tags.map(v => text(v, 30)).filter(Boolean).slice(0, 8)
    : text(body.tags, 240).split(',').map(v => v.trim()).filter(Boolean).slice(0, 8);
  const vehicles = Array.isArray(body.vehicles)
    ? body.vehicles.map(v => text(v, 40)).filter(Boolean).slice(0, 8)
    : [];
  return {
    title: text(body.title, 140),
    category: text(body.category, 60),
    region: text(body.region, 40),
    state: text(body.state, 30).toUpperCase(),
    city: text(body.city, 80),
    country: text(body.country || 'Brasil', 80),
    start: maybeDate(body.start),
    end: maybeDate(body.end) || maybeDate(body.start),
    organizer: text(body.organizer, 120),
    source: text(body.organizer || body.source, 120),
    sourceUrl: maybeUrl(body.sourceUrl),
    registrationUrl: maybeUrl(body.registrationUrl),
    photoUrl: maybeUrl(body.photoUrl),
    summary: text(body.summary, 800),
    whatsapp: text(body.whatsapp, 30).replace(/[^0-9+]/g, ''),
    price: text(body.price, 60),
    difficulty: text(body.difficulty, 40),
    meetingPoint: text(body.meetingPoint, 180),
    camping: text(body.camping, 140),
    lodging: text(body.lodging, 140),
    vehicles,
    tags,
    latitude: maybeNumber(body.latitude),
    longitude: maybeNumber(body.longitude),
    statusLabel: text(body.statusLabel || 'Aguardando confirmação', 60),
    contactName: text(body.contactName, 120),
    contactEmail: text(body.contactEmail, 160),
  };
}

function validateSubmission(s) {
  const errors = [];
  if (!s.title) errors.push('Informe o nome do evento.');
  if (!s.category) errors.push('Informe a categoria.');
  if (!s.region) errors.push('Informe a região.');
  if (!s.city) errors.push('Informe a cidade/localidade.');
  if (!s.start) errors.push('Informe a data inicial.');
  if (!s.organizer) errors.push('Informe o organizador.');
  if (!s.summary) errors.push('Inclua uma descrição curta.');
  if (!s.sourceUrl && !s.registrationUrl) errors.push('Inclua ao menos um link público do evento ou da inscrição.');
  if (s.end && s.start && s.end < s.start) errors.push('A data final não pode ser anterior à inicial.');
  return errors;
}

function publicEventFromSubmission(s) {
  return {
    id: `community-${s.id}`,
    title: s.title,
    category: s.category,
    region: s.region,
    state: s.state || '—',
    city: s.city,
    country: s.country,
    start: s.start,
    end: s.end,
    status: s.statusLabel || 'Programado',
    source: s.organizer,
    sourceUrl: s.sourceUrl || s.registrationUrl,
    registrationUrl: s.registrationUrl,
    photoUrl: s.photoUrl,
    summary: s.summary,
    tags: s.tags,
    difficulty: s.difficulty,
    price: s.price,
    whatsapp: s.whatsapp,
    meetingPoint: s.meetingPoint,
    camping: s.camping,
    lodging: s.lodging,
    vehicles: s.vehicles,
    latitude: s.latitude,
    longitude: s.longitude,
    community: true
  };
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'Administração não configurada. Defina ADMIN_TOKEN no servidor.' });
  const token = req.get('x-admin-token') || '';
  if (!crypto.timingSafeEqual(Buffer.from(token.padEnd(ADMIN_TOKEN.length, '\0').slice(0, ADMIN_TOKEN.length)), Buffer.from(ADMIN_TOKEN))) {
    return res.status(401).json({ error: 'Token de administrador inválido.' });
  }
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, app: 'Radar 4x4 Brasil', adminConfigured: Boolean(ADMIN_TOKEN) }));

app.get('/api/events', async (_req, res) => {
  try {
    const [base, submissions] = await Promise.all([
      readJson('events.json', []),
      readJson('submissions.json', [])
    ]);
    const approved = submissions.filter(x => x.reviewStatus === 'approved').map(publicEventFromSubmission);
    res.json([...base, ...approved].sort((a, b) => a.start.localeCompare(b.start)));
  } catch {
    res.status(500).json({ error: 'Falha ao carregar eventos.' });
  }
});

app.get('/api/sources', async (_req, res) => {
  try { res.json(await readJson('sources.json', [])); }
  catch { res.status(500).json({ error: 'Falha ao carregar fontes.' }); }
});

app.post('/api/submissions', async (req, res) => {
  try {
    const normalized = normalizeSubmission(req.body);
    const errors = validateSubmission(normalized);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    const submissions = await readJson('submissions.json', []);
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      ...normalized,
      reviewStatus: 'pending',
      createdAt: now,
      updatedAt: now,
      reviewNote: ''
    };
    submissions.unshift(item);
    await writeJson('submissions.json', submissions);
    res.status(201).json({ id: item.id, status: item.reviewStatus, message: 'Evento enviado para revisão.' });
  } catch {
    res.status(500).json({ error: 'Não foi possível salvar o envio.' });
  }
});

app.get('/api/submissions/:id/status', async (req, res) => {
  try {
    const submissions = await readJson('submissions.json', []);
    const item = submissions.find(x => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Envio não encontrado.' });
    res.json({ id: item.id, title: item.title, status: item.reviewStatus, reviewNote: item.reviewNote || '', updatedAt: item.updatedAt });
  } catch {
    res.status(500).json({ error: 'Falha ao consultar envio.' });
  }
});

app.get('/api/admin/submissions', requireAdmin, async (_req, res) => {
  try { res.json(await readJson('submissions.json', [])); }
  catch { res.status(500).json({ error: 'Falha ao carregar envios.' }); }
});

app.patch('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const action = text(req.body.action, 20);
    if (!['approved', 'rejected', 'pending'].includes(action)) return res.status(400).json({ error: 'Ação inválida.' });
    const submissions = await readJson('submissions.json', []);
    const index = submissions.findIndex(x => x.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Envio não encontrado.' });
    submissions[index].reviewStatus = action;
    submissions[index].reviewNote = text(req.body.note, 300);
    submissions[index].updatedAt = new Date().toISOString();
    await writeJson('submissions.json', submissions);
    res.json({ ok: true, id: submissions[index].id, status: action });
  } catch {
    res.status(500).json({ error: 'Falha ao atualizar envio.' });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Radar 4x4 Brasil em http://0.0.0.0:${PORT}`));
