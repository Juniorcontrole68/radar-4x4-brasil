# Contas A Pagar v3.1

Projeto web completo com front-end separado e PostgreSQL persistente.

## Arquivos principais
- `server.js` — inicialização
- `src/db.js` — banco PostgreSQL
- `src/handler.js` — API e rotas
- `src/utils.js` — utilitários
- `public/index.html` — interface principal
- `public/styles.css` — layout
- `public/app.js` — comportamento da tela, recorrências, filtros e pop-ups
- `database/schema.sql` — estrutura do banco
- `render.yaml` — configuração para Render
- `.env.example` — modelo de conexão do banco
- `INICIAR_WINDOWS.bat` — inicialização local no Windows
- `scripts/iniciar-linux.sh` — inicialização Linux/macOS

## Recursos
Cadastro, recorrências, áreas/categorias, pagamento, prorrogação, filtro Em Aberto Até, impressão com check, total filtrado e backup CSV.

## Render
Build: `npm install`
Start: `npm start`
Health check: `/health`

Configure a variável `DATABASE_URL` com a Internal Database URL do PostgreSQL no Render e `PGSSLMODE=require`.
