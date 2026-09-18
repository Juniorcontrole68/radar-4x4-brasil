const http = require('http');
const { loadEnv } = require('./src/utils');
loadEnv();
const { initDb } = require('./src/db');
const { initColetasDb } = require('./src/coletas');
const { handler } = require('./src/handler');

const PORT = process.env.PORT || 3000;
if (!process.env.DATABASE_URL) {
  console.error('ERRO: DATABASE_URL nao configurada.');
  process.exit(1);
}

Promise.all([initDb(), initColetasDb()]).then(() => {
  http.createServer(handler).listen(PORT, '0.0.0.0', () => {
    console.log(`Contas A Pagar v3 + Controle de Coletas ativo na porta ${PORT}`);
  });
}).catch(err => {
  console.error('Falha ao iniciar banco:', err);
  process.exit(1);
});
