# MOVIT — Checklist Play Store

## Build de produção
- Pacote: br.com.movit.rotas
- Versão: 1.0.0
- versionCode: 1
- targetSdk: 36
- compileSdk: 36
- minSdk: 26
- AAB esperado: app-play-release.aab
- Recursos de teste CONSTRULOG ficam ocultos no flavor Play.

## Assinatura de upload
Configurar estes GitHub Secrets antes do AAB final:
- MOVIT_KEYSTORE_B64
- MOVIT_KEYSTORE_PASSWORD
- MOVIT_KEY_ALIAS
- MOVIT_KEY_PASSWORD

O workflow gera MOVIT-PLAYSTORE.aab somente quando a chave estiver configurada.

## Play Console
1. Criar o app MOVIT.
2. Idioma principal: Português (Brasil).
3. Tipo: App.
4. Categoria sugerida: Mapas e navegação.
5. Informar política de privacidade:
   https://controle-coletas-jr.onrender.com/movit/privacidade
6. Preencher Segurança dos dados de acordo com o comportamento real do app.
7. Declarar acesso à localização em primeiro plano, usado quando o usuário escolhe a localização atual.
8. Enviar ícone, screenshots e gráfico de destaque.
9. Subir o AAB assinado em teste interno primeiro.
10. Validar instalação, links compartilhados, Maps/Waze e otimização antes da produção.

## Observação
A versão Play não deve declarar rastreamento contínuo em segundo plano enquanto esse recurso não existir nela.
