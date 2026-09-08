# Radar 4x4 Brasil — v2 colaborativa

Portal/PWA em Node.js + Express para reunir encontros, trilhas, expedições 4x4, overlanding, treinamentos, provas e feiras por categoria e região.

## O que esta versão inclui

- Agenda nacional com filtros por categoria, região, mês, dificuldade e busca livre.
- Favoritos (“Quero ir”) salvos no aparelho.
- Tela de detalhes com inscrição, WhatsApp, mapa, camping, hospedagem, nível de dificuldade, veículos aceitos e fonte original.
- Cadastro colaborativo de eventos por organizadores e Jeep Clubes.
- Moderação: enviados ficam `pending` e só aparecem na agenda depois de `approved`.
- Área Admin protegida por `ADMIN_TOKEN`.
- Acompanhamento do status dos próprios envios no aparelho.
- Cadastro local de novas fontes (Instagram, Facebook, sites e grupos).
- PWA instalável no celular.

## Rodar localmente

```bash
npm install
ADMIN_TOKEN="crie-um-token-forte" npm start
```

Abra `http://localhost:3000`.

## Render

O `render.yaml` já está incluído. Para habilitar a área de moderação, crie no serviço uma variável de ambiente:

- `ADMIN_TOKEN` = um token longo e privado.

### Importante sobre persistência

Nesta versão, os envios colaborativos ficam em `data/submissions.json`. Isso funciona em servidor Node tradicional, porém o filesystem de instâncias web do Render pode ser efêmero. Para uso público permanente, a próxima etapa recomendada é migrar os envios para PostgreSQL/Supabase/Neon ou outro banco persistente.

## Fontes sociais

Instagram e Facebook podem exigir login ou bloquear leitura automatizada. O projeto não contorna esses bloqueios. A agenda só publica dados verificáveis e mantém links para a fonte original.
