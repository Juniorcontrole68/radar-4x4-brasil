# J.A.R.V.I.S. — assistente pessoal

Versão inicial privada para um único usuário. Aplicativo web responsivo para computador e Android. **Não publicado. Não é APK.** Sem dados operacionais fictícios.

## Iniciar no computador

1. Instale Python 3.11 ou superior (no Windows, inclua Python no PATH).
2. Extraia o ZIP e abra o terminal na pasta `jarvis`.
3. Copie `.env.example` para `.env`. Preencha `APP_PASSWORD` com uma senha única de pelo menos 12 caracteres. Não inclua aspas. Os demais segredos podem ficar vazios.
4. Execute `python server.py` (em alguns sistemas: `python3 server.py`).
5. Abra **http://localhost:8000** no Chrome/Edge e entre com a senha configurada.
6. Opcional, para leitura de PDFs: `python -m pip install -r requirements.txt`.

Na primeira utilização, clique no microfone para conceder permissão e ativar a voz. Navegadores podem bloquear áudio automático: a saudação escrita aparece ao abrir; a saudação falada ocorre após a interação de login. O idioma e a disponibilidade das vozes dependem do dispositivo. A conversa não tem histórico no servidor. A transcrição aparece apenas na sessão da tela.

## Google Agenda real

A conexão Google desta conversa do ChatGPT **não é transferida** para este app.

1. No Google Cloud Console, crie/selecione um projeto e ative Google Calendar API.
2. Configure a tela de consentimento OAuth para uso pessoal. Em modo teste, inclua seu e-mail entre os usuários de teste.
3. Crie credencial OAuth do tipo **Aplicativo da Web**.
4. Cadastre `http://localhost:8000/oauth/callback` como URI de redirecionamento autorizado. Se usar domínio HTTPS próprio, cadastre a URL equivalente.
5. Preencha `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` em `.env` e reinicie o servidor.
6. Entre no app → Agenda → Conectar Google → autorize sua conta.

Consulta paginada, criação, edição de eventos individuais e exclusão na agenda principal. Data/hora usam America/Sao_Paulo. Conflitos impedem gravação. Compromisso sem convidados é registro pessoal (`sendUpdates=none`). Com e-mails, exige consentimento e envia convites (`sendUpdates=all`). Edição preserva convidados existentes; alteração de convidados e séries recorrentes devem ser feitas no Google. Eventos recorrentes não são excluídos por este app. Edições/exclusões usam ETag para evitar sobrescrever alterações concorrentes.

Tokens ficam em memória no servidor, sem aparecer na página nem no SQLite. Após reinício ou expiração da sessão (12 horas), reconecte. Desconectar remove tokens locais; para revogar a concessão OAuth, use Segurança → conexões com apps terceiros na sua conta Google. Não há login por identidade Google: acesso ao app por senha e autorização Google separada.

## IA e pesquisa

- `OPENAI_API_KEY` habilita conversa livre. `OPENAI_MODEL` é configurável. O cliente envia somente a pergunta atual e as memórias autorizadas; não há continuidade de contexto entre perguntas. A IA não executa ações nem recebe ferramentas: operações passam por formulários validados no servidor. Sem chave, há orientação local para agenda e tarefas.
- `BRAVE_API_KEY` habilita pesquisa web pelo formulário. Resultados incluem links das fontes; não existe busca oculta pela IA.
- Segredos ficam em `.env` no servidor. Nunca coloque chaves no JavaScript. Arquivos enviados são processados em memória, sem persistência. O texto extraído fica na tela; envio à IA exige colar um trecho na conversa. Imagens, OCR e DOCX pendentes.

## Android e acesso seguro

Este pacote pode ser executado localmente no PC. Para usar no Android com microfone, instale/configure uma hospedagem HTTPS ou um túnel privado de confiança — **a publicação ainda depende de sua autorização**. O localhost do celular é o próprio celular, não seu PC. HTTP pelo IP do computador não oferece reconhecimento de voz confiável nem proteção para senha/tokens; não use esse caminho para acesso remoto.

Após configurar HTTPS, ajuste `APP_ORIGIN` e `GOOGLE_REDIRECT_URI` para a origem real. Use proxy reverso, armazenamento persistente para SQLite e proteja `.env`. Configure `HOST=0.0.0.0` apenas no servidor protegido pelo proxy. Este servidor padrão Python é destinado ao uso pessoal controlado e validação; antes de uma operação pública, use servidor/proxy de produção com TLS, limites de conexões e backup. O manifest permite atalho em navegadores compatíveis; não promete instalação PWA plena/offline (não há service worker). Não há APK nem publicação Play Store nesta entrega.

## Avisos e voz

- Lembretes são verificados a cada 30 segundos com a página visível. Atrasados aparecem ao reabrir. Tarefas e memória persistem em SQLite.
- Não há push com app fechado, rotina agendada no servidor ou serviço Android em segundo plano nesta versão.
- Web Speech API tem suporte variável; reconhecimento pode usar servidores do navegador. Não prometemos reconhecimento offline.
- Conversa contínua depende de permissão e app ativo. O filtro “Jarvis” só filtra a transcrição com microfone já ligado. Ele não acorda o dispositivo.
- Interrupção por “parar” funciona enquanto o reconhecimento estiver ativo; o botão Interromper está sempre disponível. Áudio captado do próprio alto-falante pode interferir na fala simultânea; fones ajudam. A saída segue o sistema, inclusive Bluetooth; não forçamos o alto-falante.
- Ao ocultar a página, o microfone para. Tela apagada e palavra de ativação permanente precisam de implementação Android nativa com permissões, serviço em primeiro plano e teste em aparelhos reais. Não implementados aqui.

## Custos e dependências

Execução local e biblioteca padrão não exigem assinatura do app. IA, pesquisa e hospedagem são serviços externos com preços/quotas do provedor e custos conforme uso. Não há promessa de gratuidade. Chaves são opcionais; tarefas, memória e formulários funcionam sem IA. Nenhuma conta paga ou hospedagem foi criada.

## Testes

`python -m unittest discover -s tests -v`

Valida login, CSRF, memória autorizada, persistência, datas, conflitos, confirmação de convites/exclusão e OAuth state. Google e IA são simulados nos testes: eles validam contrato e regras, não conectividade com sua conta real. Sintaxe do frontend: `node --check static/app.js`. Teste visual no navegador e voz no Android devem ser executados no dispositivo; não foram verificados automaticamente nesta entrega.

## Estrutura

```
jarvis/
  server.py
  requirements.txt
  .env.example
  .gitignore
  static/
    index.html
    app.js
    style.css
    manifest.json
    icon.svg
  tests/
    test_app.py
  docs/
    INTEGRACOES.md
    STATUS.md
```

Links de referência: [OAuth Google](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar API](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API), [restrições Android](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).
