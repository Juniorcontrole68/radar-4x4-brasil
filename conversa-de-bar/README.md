# Conversa de Bar — V1

App Android de conversa por voz contínua, pensado como companhia e apoio conversacional.

## Experiência principal
- Ao abrir, inicia a sessão de conversa após as permissões necessárias.
- Detecção de fala e silêncio: usuário fala, o app detecta o fim da frase, responde em áudio e volta a escutar.
- Sem necessidade de tocar no microfone a cada interação.
- Modos: **Apoio** e **Companhia**.
- Histórico textual opcional.
- Escolha de voz/personagem e controles de memória/privacidade.

## Comportamento da personagem
A personagem é feminina, acolhedora, descontraída e natural. No modo Companhia pode usar humor e afeto, mas deve deixar claro que é uma IA e não uma pessoa ou parceira real. No modo Apoio ajuda o usuário a organizar pensamentos e emoções, sem se apresentar como psicóloga, terapeuta ou profissional de saúde.

## Segurança
Em situações que indiquem risco imediato de autoagressão, suicídio ou violência, o fluxo normal deve ser interrompido para priorizar segurança, incentivar contato com pessoas próximas e serviços de emergência/apoio adequados.

## Arquitetura prevista
- Android nativo (Kotlin + Jetpack Compose)
- Captura de microfone com VAD/detecção de silêncio
- Cancelamento de eco quando disponível
- STT para transcrição
- Serviço de IA para resposta conversacional
- TTS/voz para resposta falada
- Máquina de estados: OUVINDO → PROCESSANDO → FALANDO → OUVINDO
- Armazenamento local seguro para preferências e histórico

## Observação Android
O Android possui regras específicas para acesso contínuo ao microfone e execução em segundo plano. A V1 será projetada para conversa contínua enquanto a sessão estiver ativa, usando serviço em primeiro plano quando necessário e indicação visível de uso do microfone.

## Próximas etapas
1. Criar projeto Android/Compose.
2. Implementar tela principal e estados de áudio.
3. Implementar permissões de microfone.
4. Implementar STT → IA → TTS.
5. Adicionar modos Apoio/Companhia.
6. Adicionar configurações, histórico e privacidade.
7. Testar interrupção da fala, eco e retomada automática da escuta.
