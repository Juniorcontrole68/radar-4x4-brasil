# Conversa de Bar — plano de comercialização

Atualizado em 2026-10-04.

## Decisões confirmadas pelo proprietário

- Oferecer assinatura mensal e pacotes avulsos de minutos.
- Permitir comprar pacotes sem assinatura e recarregar uma conta com assinatura.
- Escolha de nome do assistente, voz feminina/masculina e perfil amigo/amiga ou apoio emocional por IA.
- Conversas por áudio sem transcrição visível e sem armazenamento de histórico pelo aplicativo.
- Tom informal, acolhedor e encorajador. Flerte leve opcional no modo amigo; apoio emocional sem flerte e sem alegação de atendimento psicológico profissional.

## Proposta para revisão (ainda não aprovada)

| Produto | Franquia sugerida | Preço |
| --- | --- | --- |
| Assinatura mensal | Definir após medir custo e uso | Pendente |
| Pacote pequeno | 30 minutos | Pendente |
| Pacote médio | 60 minutos | Pendente |
| Pacote grande | 120 minutos | Pendente |

A quantidade de minutos da assinatura, preços, validade dos pacotes e acúmulo de franquia mensal ainda precisam ser definidos. Não anunciar renovação, expiração ou acúmulo antes de estabelecer essas condições.

## Fluxo a implementar

1. Cadastro/autenticação do cliente; carteira vinculada à conta, independente do aparelho.
2. Catálogo da Play Store: assinatura mensal e produtos avulsos consumíveis. Exibir preços retornados pela loja, sem inventar preços no cliente.
3. Validar cada compra no servidor com Google Play Developer API, conferindo aplicativo, produto, estado da compra e vínculo com a conta. Processar tokens de compra de forma idempotente para impedir crédito duplicado. Compras pendentes não liberam minutos.
4. Manter dois saldos distintos: franquia da assinatura e minutos comprados. A proposta é usar a franquia mensal primeiro; confirmar regra antes da venda.
5. Medir e debitar por segundos no servidor, com regra transparente de início, pausa e encerramento. Proposta: tempo conectado e disponível para conversa; não debitar enquanto conecta ou quando falha. A decisão final deve estar nos termos e na interface.
6. Exibir saldo e aviso próximo do fim; permitir recarga, sem comprar automaticamente. Encerrar sessão de áudio no servidor quando crédito permitido acabar. Não confiar em contador do navegador nem liberar credencial de sessão sem autorização e limite aplicável.
7. Tratar renovação, cancelamento, período de carência, suspensão, reembolso e revogação com notificações da loja e verificação periódica. Cancelamento de assinatura não elimina indevidamente minutos avulsos.
8. Antes de abrir vendas: banco persistente, controle de concorrência e lançamentos de saldo, limites de sessão, autenticação e proteção contra acesso anônimo ao endpoint comercial de voz.

## Preço e custo

O app de teste usa gpt-realtime. A API cobra tokens de áudio/texto; não existe um custo fixo garantido por minuto de conversa. Histórico/contexto reenviado e cache também afetam o custo.

Medir sessões curtas e longas com diferentes proporções de fala e calcular custo médio e cenários de maior consumo. A medição deve guardar somente duração e totais de uso agregados, sem áudio nem conteúdo das conversas. Considerar câmbio, tarifas aplicáveis da loja, infraestrutura, impostos, suporte e margem antes de publicar preços.

Fontes consultadas em 2026-10-04:
- https://developers.openai.com/api/docs/models/gpt-realtime
- https://developers.openai.com/api/docs/guides/voice-latency-cost
- https://support.google.com/googleplay/android-developer/answer/9858738?hl=en

## Estado atual e bloqueios

A página /comercial/ é um protótipo publicado de escolha do assistente. Não há compras, saldo de créditos, assinatura ou desconto de minutos operacionais. O endpoint atual de voz pertence ao teste pessoal; não deve ser tratado como sistema comercial com limite de gastos.

Para ativar compras Android: confirmar disponibilidade da conta Play Console do proprietário, preparar aplicativo Android assinado e identificador definitivo, configurar produtos da loja, conectar validação de compras e persistência no servidor, testar faturamento e concluir privacidade, termos, denúncia de respostas e revisão da loja. Avatar 3D e funcionamento confiável com tela bloqueada continuam pendentes.
