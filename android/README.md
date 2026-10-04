# Base Android — Conversa de Bar

Projeto inicial de desenvolvimento, não APK/AAB pronto para distribuição.

Abre a página HTTPS /comercial/ existente, com escolhas de nome, perfil e voz. Solicita microfone apenas após a página pedir áudio; libera somente captura de áudio para a origem do app. Não inclui chave de API, ponte JavaScript nativa, permissão de câmera ou tráfego HTTP.

Requisitos para compilar: JDK 17, Gradle 8.13, Android SDK Platform 36, Build Tools 35.0.0 ou versão compatível com AGP 8.11.1. Abrir esta pasta no Android Studio ou executar `gradle :app:assembleDebug` com os requisitos instalados. Não foi compilado neste ambiente, que não possui SDK Android nem Gradle.

Identificador provisório: br.com.conversadebar.app. Confirmar identificador definitivo antes de qualquer publicação: o applicationId da Play Store não pode ser trocado depois mantendo o mesmo aplicativo.

Sem faturamento integrado nesta base. A assinatura mensal e os pacotes avulsos estão especificados em ../docs/commercial-billing-plan.md. Ainda precisam de Play Console, produtos da loja, autenticação, carteira no servidor e validação de compras.

Áudio é somente em primeiro plano; ao sair do app a sessão é encerrada para liberar o microfone e evitar consumo invisível. Funcionamento com tela bloqueada necessita implementação e testes próprios, não está resolvido por este WebView. Nenhum pagamento é simulado nem liberado.

Validação pendente: compilar, instalar em Android físico, testar permissão/negação de microfone, WebRTC, interrupção de fala, rotação, navegação externa, retorno do segundo plano e encerramento. Preparar assinatura de lançamento, ícones finais, privacidade, termos, denúncia de conteúdo e revisão da loja. Esta base WebView não garante aprovação da Play Store.

Fontes: https://developer.android.com/build/releases/agp-8-11-0-release-notes e https://developer.android.com/reference/android/webkit/WebChromeClient.html.
