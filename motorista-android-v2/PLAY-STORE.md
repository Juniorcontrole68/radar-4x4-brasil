# CONSTRULOG Motorista na Google Play

O mesmo código gera duas versões:

| Versão | Como sai | Para quê |
|---|---|---|
| Site (`debug`/`release`) | APK publicado em `/downloads` pelo workflow "Build CONSTRULOG Motorista" | Link do WhatsApp, como sempre foi |
| Play Store (`play`) | AAB gerado pelo workflow "Teste dos aplicativos (emulador)" | Enviar ao Play Console |

## O que muda na versão da Play Store

A Google Play só aceita algumas permissões com declaração especial. A versão `play`
(`src/play/AndroidManifest.xml` e `BuildConfig.PLAY_STORE`) tira o que o aplicativo
consegue fazer de outro jeito:

- **Sem atualização pelo site**: não avisa de APK novo e o botão de atualizar não aparece; quem atualiza é a Play.
- **Sem alarme exato** (`USE_EXACT_ALARM`, `SCHEDULE_EXACT_ALARM`): o vigia usa a tarefa periódica e o alarme comum.
- **Sem pedido direto de liberar a bateria** (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`): o botão abre a lista de apps e o texto explica o que marcar.
- **Sem o serviço "uso especial"**: fica só o serviço de localização.
- **Rota do dia**: se o MOVIT não estiver instalado, só abre o link se ele for da Play.

As duas versões mostram o aviso de uso da localização antes de pedir a permissão
(exigência da Play para localização em segundo plano) e têm o ícone novo.

## Gerar uma versão nova para a Play

1. Aumente `versionCode` (e `versionName`) em `app/build.gradle`. A Play recusa um código repetido.
2. Envie para uma branch de trabalho. O workflow "Teste dos aplicativos (emulador)" gera o
   artefato `construlog-motorista-play-store` com o AAB sem assinatura e as capturas de tela.
3. Assine o AAB com a chave de upload (guardada fora do GitHub, nos arquivos do projeto):

   ```sh
   jarsigner -keystore upload-key.p12 -storetype PKCS12 \
     -sigalg SHA256withRSA -digestalg SHA-256 \
     CONSTRULOG-Motorista-play-sem-assinatura.aab construlog-motorista-upload
   ```

4. Envie o AAB assinado no Play Console (Testes ou Produção → Criar versão).

Se a chave de upload se perder, o dono da conta pede a troca da chave de upload no Play
Console (Configuração → Integridade do app). A chave que assina o app para os celulares fica
com o Google (Assinatura de apps do Google Play) e não se perde.

## Política de privacidade

`https://controle-coletas-jr.onrender.com/motorista/privacidade` (rota em `controle-coletas-aiven-app/server.js`).
Pedido de exclusão de dados: a mesma página, seção `#exclusao`.
