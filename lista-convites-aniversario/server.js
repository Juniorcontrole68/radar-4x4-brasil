import express from 'express';
import { createClient } from 'redis';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;
const KEY = 'lista-convites-aniversario:v1';
const IMAGE_KEY = 'lista-convites-aniversario:image:v1';

const EMPTY = {
  event: {
    title: 'Meu Aniversário',
    date: '',
    time: '',
    venue: '',
    address: '',
    message: 'Vai ser muito especial ter você comigo!',
    canvaUrl: '',
    hasInviteImage: false
  },
  guests: []
};

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('REDIS_URL não configurada.');
  process.exit(1);
}

const redis = createClient({ url: redisUrl });
redis.on('error', err => console.error('Redis:', err));
await redis.connect();

async function load() {
  const raw = await redis.get(KEY);
  return raw ? JSON.parse(raw) : structuredClone(EMPTY);
}

async function save(data) {
  await redis.set(KEY, JSON.stringify(data));
}

function guestPublic(g) {
  return { id:g.id, name:g.name, invited:g.invited, status:g.status, confirmed:g.confirmed };
}

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/data', async (_req, res, next) => {
  try { res.json(await load()); } catch (e) { next(e); }
});

app.put('/api/event', async (req, res, next) => {
  try {
    const data = await load();
    const body = { ...(req.body || {}) };
    const imageData = body.inviteImageData;
    const removeImage = !!body.removeInviteImage;
    delete body.inviteImageData;
    delete body.removeInviteImage;

    if (imageData) {
      const m = String(imageData).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: 'Imagem inválida' });
      const buffer = Buffer.from(m[2], 'base64');
      if (buffer.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'A imagem deve ter no máximo 2 MB' });
      await redis.hSet(IMAGE_KEY, { mime: m[1], data: m[2] });
      body.hasInviteImage = true;
    } else if (removeImage) {
      await redis.del(IMAGE_KEY);
      body.hasInviteImage = false;
    }

    data.event = { ...data.event, ...body };
    await save(data);
    res.json(data.event);
  } catch (e) { next(e); }
});

app.get('/api/invite-image', async (_req, res, next) => {
  try {
    const img = await redis.hGetAll(IMAGE_KEY);
    if (!img?.data) return res.status(404).send('Imagem não encontrada');
    const buffer = Buffer.from(img.data, 'base64');
    res.setHeader('Content-Type', img.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(buffer);
  } catch (e) { next(e); }
});

app.post('/api/guests', async (req, res, next) => {
  try {
    const data = await load();
    const body = req.body || {};
    const guest = {
      id: crypto.randomUUID(),
      name: String(body.name || '').trim(),
      phone: String(body.phone || '').replace(/\D/g, ''),
      invited: Math.max(1, Number(body.invited || 1)),
      confirmed: null,
      status: 'pendente',
      sentAt: null,
      answeredAt: null,
      note: String(body.note || '').trim()
    };
    if (!guest.name) return res.status(400).json({ error: 'Nome obrigatório' });
    data.guests.push(guest);
    await save(data);
    res.status(201).json(guest);
  } catch (e) { next(e); }
});

app.put('/api/guests/:id', async (req, res, next) => {
  try {
    const data = await load();
    const guest = data.guests.find(g => g.id === req.params.id);
    if (!guest) return res.status(404).json({ error: 'Convidado não encontrado' });
    Object.assign(guest, req.body || {});
    if (req.body?.phone !== undefined) guest.phone = String(req.body.phone).replace(/\D/g, '');
    if (req.body?.invited !== undefined) guest.invited = Math.max(1, Number(req.body.invited || 1));
    await save(data);
    res.json(guest);
  } catch (e) { next(e); }
});

app.delete('/api/guests/:id', async (req, res, next) => {
  try {
    const data = await load();
    const before = data.guests.length;
    data.guests = data.guests.filter(g => g.id !== req.params.id);
    if (data.guests.length === before) return res.status(404).json({ error: 'Convidado não encontrado' });
    await save(data);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/guests/:id/mark-sent', async (req, res, next) => {
  try {
    const data = await load();
    const guest = data.guests.find(g => g.id === req.params.id);
    if (!guest) return res.status(404).json({ error: 'Convidado não encontrado' });
    if (guest.status === 'pendente') guest.status = 'enviado';
    guest.sentAt = new Date().toISOString();
    await save(data);
    res.json(guest);
  } catch (e) { next(e); }
});

app.get('/api/invite/:id', async (req, res, next) => {
  try {
    const data = await load();
    const guest = data.guests.find(g => g.id === req.params.id);
    if (!guest) return res.status(404).json({ error: 'Convite não encontrado' });
    res.json({ event: data.event, guest: guestPublic(guest) });
  } catch (e) { next(e); }
});

app.post('/api/invite/:id/respond', async (req, res, next) => {
  try {
    const data = await load();
    const guest = data.guests.find(g => g.id === req.params.id);
    if (!guest) return res.status(404).json({ error: 'Convite não encontrado' });
    const going = !!req.body?.going;
    guest.status = going ? 'confirmado' : 'nao-vai';
    guest.confirmed = going
      ? Math.min(guest.invited, Math.max(1, Number(req.body?.confirmed || 1)))
      : 0;
    guest.answeredAt = new Date().toISOString();
    await save(data);
    res.json({ ok: true, guest });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err?.message || 'Erro interno' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lista de Convites online na porta ${PORT}`);
});
