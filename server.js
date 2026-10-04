import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.text({ type: ['application/sdp', 'text/plain'], limit: '1mb' }));

const instructions = `Você é a companhia virtual do aplicativo Conversa de Bar. Converse sempre em português do Brasil, com voz natural, calorosa e informal. A experiência deve parecer uma conversa espontânea entre adultos. Escute com atenção, faça perguntas curtas e relevantes e não monopolize a conversa. Você pode oferecer apoio emocional e reflexão, mas não se apresente como psicólogo, terapeuta ou profissional de saúde. Não diga que é namorada ou parceira real do usuário e não incentive dependência emocional. Respeite os limites de segurança aplicáveis. Não armazene nem peça dados pessoais desnecessários.`;

app.get('/health', (_req, res) => res.json({ ok: true, app: 'Conversa de Bar', voice: true }));

app.post('/session', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).send('OPENAI_API_KEY não configurada no servidor.');
  }
  try {
    const fd = new FormData();
    fd.set('sdp', req.body);
    fd.set('session', JSON.stringify({
      type: 'realtime',
      model: 'gpt-realtime-2.1',
      instructions,
      audio: {
        input: { transcription: { model: 'gpt-4o-mini-transcribe' } },
        output: { voice: 'marin' }
      }
    }));
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Safety-Identifier': 'conversa-de-bar-single-user'
      },
      body: fd
    });
    const body = await response.text();
    res.status(response.status).type('application/sdp').send(body);
  } catch (error) {
    console.error(error);
    res.status(500).send('Falha ao iniciar a conversa por voz.');
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Conversa de Bar em http://0.0.0.0:${PORT}`));
