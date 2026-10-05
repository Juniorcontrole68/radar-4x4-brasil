const KEY = 'lista-convites-aniversario:v1';

const EMPTY = {
  event: {
    title: 'Meu Aniversário',
    date: '',
    time: '',
    venue: '',
    address: '',
    message: 'Vai ser muito especial ter você comigo!'
  },
  guests: []
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function load(env) {
  const data = await env.STATE.get(KEY, 'json');
  return data || structuredClone(EMPTY);
}

async function save(env, data) {
  await env.STATE.put(KEY, JSON.stringify(data));
}

function guestPublic(g) {
  return { id:g.id, name:g.name, invited:g.invited, status:g.status, confirmed:g.confirmed };
}

export async function onRequest({ request, env, params }) {
  try {
    if (!env.STATE) return json({ error: 'Binding KV STATE não configurado na Cloudflare.' }, 500);
    const method = request.method.toUpperCase();
    const path = Array.isArray(params.path) ? params.path : String(params.path || '').split('/').filter(Boolean);
    const data = await load(env);

    if (method === 'GET' && path.length === 1 && path[0] === 'data') return json(data);

    if (method === 'PUT' && path.length === 1 && path[0] === 'event') {
      const body = await request.json();
      data.event = { ...data.event, ...body };
      await save(env, data);
      return json(data.event);
    }

    if (path[0] === 'guests') {
      if (method === 'POST' && path.length === 1) {
        const body = await request.json();
        const guest = {
          id: crypto.randomUUID(),
          name: String(body.name || '').trim(),
          phone: String(body.phone || '').replace(/D/g, ''),
          invited: Math.max(1, Number(body.invited || 1)),
          confirmed: null,
          status: 'pendente',
          sentAt: null,
          answeredAt: null,
          note: String(body.note || '').trim()
        };
        if (!guest.name) return json({ error: 'Nome obrigatório' }, 400);
        data.guests.push(guest);
        await save(env, data);
        return json(guest, 201);
      }

      const id = path[1];
      const guest = data.guests.find(g => g.id === id);
      if (!guest) return json({ error: 'Convidado não encontrado' }, 404);

      if (method === 'PUT' && path.length === 2) {
        const body = await request.json();
        Object.assign(guest, body);
        if (body.phone !== undefined) guest.phone = String(body.phone).replace(/D/g, '');
        if (body.invited !== undefined) guest.invited = Math.max(1, Number(body.invited || 1));
        await save(env, data);
        return json(guest);
      }

      if (method === 'DELETE' && path.length === 2) {
        data.guests = data.guests.filter(g => g.id !== id);
        await save(env, data);
        return json({ ok: true });
      }

      if (method === 'POST' && path.length === 3 && path[2] === 'mark-sent') {
        if (guest.status === 'pendente') guest.status = 'enviado';
        guest.sentAt = new Date().toISOString();
        await save(env, data);
        return json(guest);
      }
    }

    if (path[0] === 'invite') {
      const id = path[1];
      const guest = data.guests.find(g => g.id === id);
      if (!guest) return json({ error: 'Convite não encontrado' }, 404);

      if (method === 'GET' && path.length === 2) {
        return json({ event: data.event, guest: guestPublic(guest) });
      }

      if (method === 'POST' && path.length === 3 && path[2] === 'respond') {
        const body = await request.json();
        const going = !!body.going;
        guest.status = going ? 'confirmado' : 'nao-vai';
        guest.confirmed = going ? Math.min(guest.invited, Math.max(1, Number(body.confirmed || 1))) : 0;
        guest.answeredAt = new Date().toISOString();
        await save(env, data);
        return json({ ok: true, guest });
      }
    }

    return json({ error: 'Rota não encontrada' }, 404);
  } catch (e) {
    return json({ error: e?.message || 'Erro interno' }, 500);
  }
}
