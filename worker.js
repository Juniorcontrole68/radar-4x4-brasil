import { buildSession } from './session-config.js';
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, app: 'Conversa de Bar', version: 'memory-20261004-v1', openaiConfigured: Boolean(env.OPENAI_API_KEY) });
    }

    if (url.pathname === '/api/realtime/session') {
      if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
      if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY não configurada.' }, 503);

      let session;
      try {
        const body = await request.text();
        if (body.length > 12000) return json({ error: 'Escolhas muito extensas.' }, 400);
        session = buildSession(body ? JSON.parse(body) : {});
      } catch (error) {
        return json({ error: error instanceof SyntaxError ? 'Escolhas inválidas.' : error.message }, 400);
      }
      try {
        const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ session })
        });
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' }
        });
      } catch (error) {
        return json({ error: 'Não foi possível iniciar a conversa por voz.' }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
