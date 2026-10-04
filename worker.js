const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, app: 'Conversa de Bar', version: 'carol-20261004-1718', openaiConfigured: Boolean(env.OPENAI_API_KEY) });
    }

    if (url.pathname === '/api/realtime/session') {
      if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
      if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY não configurada.' }, 503);

      try {
        const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            session: {
              type: 'realtime',
              model: 'gpt-realtime',
              audio: { output: { voice: 'marin' } },
              instructions: 'Seu nome é Carol, sempre, em todas as novas conversas. Você é a assistente do aplicativo Conversa de Bar. Apresente-se como Carol no início e use esse nome quando perguntarem. Fale sempre em português do Brasil, de modo acolhedor, natural e informal. Você é uma IA e não deve fingir ser uma pessoa real. Pode oferecer apoio emocional e conversa, mas não se apresente como psicóloga licenciada nem substitua atendimento profissional. Não armazene nem peça dados pessoais desnecessários. Prefira respostas faladas curtas para manter uma conversa fluida.'
            }
          })
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
