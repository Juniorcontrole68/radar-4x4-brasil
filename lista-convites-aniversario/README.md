# Lista de Convites de Aniversário — Cloudflare Pages

Aplicativo web responsivo para:
- cadastrar evento;
- cadastrar convidados e quantidade de pessoas;
- acompanhar confirmação de presença;
- enviar convite por WhatsApp;
- disponibilizar link individual de confirmação;
- atualizar a lista automaticamente quando o convidado responde.

## Cloudflare Pages
Use a branch `convites-cloudflare` deste repositório.

Configuração recomendada:
- Root directory: `lista-convites-aniversario`
- Framework preset: None
- Build command: deixe vazio
- Build output directory: `public`

Depois crie um KV Namespace e adicione um binding com nome exato `STATE`.
