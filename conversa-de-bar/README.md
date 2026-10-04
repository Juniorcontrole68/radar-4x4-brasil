# Conversa de Bar — V1 funcional

PWA para Android/celular com conversa por voz contínua e três modos: **Conversa**, **Apoio** e **Companhia**.

## Já implementado
- Interface mobile instalável.
- Permissão de microfone na primeira ativação.
- Ciclo automático: **ouvindo → pensando → falando → ouvindo**.
- Reconhecimento de fala em português no navegador compatível.
- Resposta falada com voz pt-BR disponível no aparelho.
- Modos Conversa, Apoio e Companhia.
- Nome da personagem configurável (padrão: Clara).
- Velocidade da voz, silenciar, pausar e limpar.
- Histórico local opcional.
- Backend mantém a chave da IA fora do navegador.
- Prompt de segurança: a personagem se identifica como IA, não como pessoa/namorada real ou profissional de saúde.

## Rodar
```bash
npm install
OPENAI_API_KEY="sua-chave" npm start
```
Abra `http://localhost:3000`.

## Render
Use este diretório como `rootDir` (`conversa-de-bar`) ou o `render.yaml` incluído. Configure `OPENAI_API_KEY` como variável secreta. O modelo pode ser trocado com `OPENAI_MODEL`.

## Uso no Android
Abra o endereço HTTPS no Chrome, autorize o microfone e toque **Começar conversa** uma única vez. A partir daí o app tenta retomar a escuta automaticamente depois de cada resposta. O navegador/Android pode suspender o microfone se a página for para segundo plano ou o sistema encerrar a sessão; uma versão Android nativa pode melhorar esse comportamento com serviço em primeiro plano.

## Privacidade
O histórico pode ser salvo localmente no aparelho ou desativado. A fala reconhecida é enviada ao backend somente para gerar a resposta da IA. Não coloque a chave da API no JavaScript do navegador.
