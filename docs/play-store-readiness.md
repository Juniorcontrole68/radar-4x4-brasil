# Conversa de Bar — prontidão para Google Play

Verificação em 2026-10-04. Situação: ainda não está pronto para envio à loja ou venda.

## Evidência atual

- Protótipo web /comercial/ publicado com escolha de nome, voz e perfil.
- Base Android Java/WebView salva no repositório, com targetSdk 36 e microfone limitado à origem HTTPS do app.
- Pipeline Android demo build configurado para compilar APK de desenvolvimento e executar lint. O resultado da compilação e teste físico ainda precisam ser confirmados.
- Proprietário informou não ter conta de desenvolvedor Play Console.
- Assinatura mensal e pacotes avulsos são escopo aprovado; faturamento, login e carteira persistente ainda não estão implementados.

## Bloqueios para envio

1. Criar e verificar conta Play Console e definir titular jurídico. Não assumir conta pessoal: Google exige conta de organização para apps de saúde e exige D-U-N-S para organizações. O perfil de apoio emocional torna necessário avaliar o enquadramento de bem-estar/saúde mental antes do cadastro.
2. Confirmar applicationId definitivo. O identificador Android atual é provisório.
3. Compilar, executar lint, instalar e validar em dispositivo físico: áudio WebRTC, permissão e negação de microfone, escolha de voz, interrupção, retorno à tela, rotação e encerramento. APK debug não é pacote de lançamento.
4. Preparar AAB de lançamento com chave de upload e Play App Signing; não armazenar chave privada no repositório. Nenhuma chave de lançamento foi criada.
5. Implementar autenticação, compras, saldo e limitação de sessões no servidor antes de abrir acesso a clientes. O endpoint pessoal atual não impõe carteira comercial.
6. Publicar política de privacidade factual, termos e canal de suporte com titular/contato reais. Informar processamento de áudio pela OpenAI, tratamento de contas e compras e retenção real dos fornecedores. Não prometer que terceiros nunca retêm dados.
7. Implementar denúncia de respostas no app, sem forçar o usuário a sair. Definir destino e acompanhamento do relato sem registrar conversas completas por padrão.
8. Concluir declarações do Play Console: Segurança dos dados, público-alvo/classificação, anúncio de recursos de saúde e permissões. O produto de teste é para adultos e não oferece diagnóstico ou atendimento psicológico profissional.
9. Completar catálogo comercial, preços, regras de minutos e testes de faturamento. Produtos da loja inexistem no protótipo.

## Requisitos verificados

- Novos apps Android precisam targetSdk 36 desde 31/08/2026. A base atual já usa 36.
- Para novas contas pessoais: teste fechado com pelo menos 12 testadores inscritos por 14 dias consecutivos antes de solicitar acesso à produção. Isso não elimina verificação de conta nem revisão do produto.
- Apps de IA precisam denúncia/relato de respostas ofensivas dentro do app.
- Apps de saúde abrangem bem-estar mental; precisam observar declaração de saúde, política de privacidade e divulgação adequada das permissões. Conta de organização é exigida para apps de saúde conforme a política de tipos de conta.
- Flerte discreto no perfil amigo não é garantia de aprovação; conteúdo/serviços destinados à gratificação sexual são proibidos. Não promover o produto como chat sexual.

## Fontes oficiais

- https://support.google.com/googleplay/android-developer/answer/13634885?hl=pt-BR
- https://support.google.com/googleplay/android-developer/answer/13996367
- https://support.google.com/googleplay/android-developer/answer/14151465?hl=pt-BR
- https://support.google.com/googleplay/android-developer/answer/11926878?hl=pt-BR
- https://support.google.com/googleplay/android-developer/answer/13985936?hl=en
- https://support.google.com/googleplay/android-developer/answer/16679511?hl=en
- https://support.google.com/googleplay/android-developer/answer/9878810?hl=en

Nenhum envio ao Play Console foi realizado e nenhuma aprovação do Google foi obtida.
