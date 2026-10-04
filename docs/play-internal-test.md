# Preparação de teste interno — Conversa de Bar

Estado: preparação técnica. Nenhum envio à Play Store foi feito.
Data: 04/10/2026.

## Versão que será testada

Conversa por áudio em português brasileiro, escolha de nome, voz e perfil.
Perfis: Amigo ou amiga; Conversa e companhia.
Memória opcional: resumo neste aparelho, visualização/edição, exclusão e conversa privada.
Publicação da memória confirmada em /health (memory-20261004-v1), /comercial/ e /memory.js em 04/10/2026. Os controles de privacidade passaram nos testes locais; conversa real por voz no Android físico ainda precisa ser testada.
A base Android carrega /comercial/ e encerra a conversa ao ir ao segundo plano.
Áudio com tela bloqueada ainda não está implementado.
Sem assinatura mensal, compras de minutos, login ou carteira nesta versão.
O teste interno deve ficar restrito aos testadores definidos; não oferecer venda antes do faturamento e controle de uso.

## Pacotes

O workflow Android compilou APK debug, AAB release sem assinatura e executou lint das duas variantes com sucesso em 04/10/2026: https://github.com/Juniorcontrole68/radar-4x4-brasil/actions/runs/37224151289 .
O AAB sem assinatura é apenas validação técnica: não enviar ao Play Console.
O APK debug serve para teste direto no aparelho: não é versão para publicar na loja.
Identificador atual ainda provisório: br.com.conversadebar.app.
Confirmar titular, identificador e chave de upload antes do primeiro envio.

Para produzir AAB assinado em ambiente seguro, configurar:
- CDB_UPLOAD_STORE_FILE: caminho absoluto da chave de upload.
- CDB_UPLOAD_STORE_PASSWORD: senha da chave.
- CDB_UPLOAD_KEY_ALIAS: alias.
- CDB_UPLOAD_KEY_PASSWORD: senha do alias.

Não colocar chaves/senhas no repositório, logs ou chat.
Executar: gradle -p android --no-daemon :app:verifyPlaySigning :app:bundleRelease :app:lintRelease
Conferir assinatura do AAB e guardar backup da chave fora do repositório.
O workflow público atual NÃO recebe nem gera a chave privada.

## Ficha da loja — texto preparado para a versão de teste

Nome: Conversa de Bar
Descrição curta: Converse por voz com uma companhia de IA do seu jeito.

Descrição completa:
Conversa de Bar é uma companhia de inteligência artificial para conversar por voz em português.
Escolha o nome, a apresentação e a voz do seu assistente. Tenha um papo descontraído ou converse sobre ideias e situações do dia a dia.
Toque em iniciar uma vez e converse naturalmente, podendo interromper a resposta.
A memória é opcional: salva um resumo neste aparelho, sem guardar áudio ou transcrição completa no app. Você pode consultar, editar ou apagar o resumo, ou usar conversa privada.
É necessário acesso à internet e permissão de microfone. Nesta versão, o áudio funciona com o app em primeiro plano.
O assistente é uma IA; não é uma pessoa real nem oferece atendimento psicológico, diagnósticos ou tratamento.
Versão de teste destinada a adultos. Pagamentos e pacotes de minutos ainda não estão disponíveis.

Revisar a descrição conforme o comportamento da versão efetivamente publicada.
Não anunciar memória enquanto o servidor ainda servir a versão anterior.

## Privacidade — minuta, não publicar sem completar os campos

Responsável: [confirmar nome civil ou razão social do titular]
Contato de privacidade e suporte: [confirmar e-mail real]
Vigência: [data de publicação]

O Conversa de Bar solicita o microfone para permitir conversas por voz. O áudio é enviado à OpenAI para reconhecimento e geração de respostas. O tráfego web também passa pela infraestrutura Cloudflare.
O código do app não grava arquivos de áudio nem guarda uma transcrição completa das conversas em seu banco de dados. O tratamento e eventual retenção pelos fornecedores dependem dos serviços e configurações contratados; essas condições precisam ser verificadas antes da publicação desta política.
As escolhas de nome, voz e perfil são armazenadas localmente no aparelho. Quando a pessoa ativa Lembrar de mim, o app também salva um resumo local, com preferências e contexto relevante.
O resumo pode ser visualizado, editado ou apagado em Minha memória e Esquecer tudo. Desativar a memória conserva o resumo até a exclusão. Conversa privada não consulta nem salva resumo.
Não há sincronização entre dispositivos. Apagar os dados do app/navegador ou desinstalar pode remover as informações locais. Num aparelho compartilhado, outras pessoas podem acessar o resumo.
A versão atual não possui cadastro, compras ou publicidade. Se esses recursos forem incluídos, atualizar esta política e a declaração Segurança dos dados antes de disponibilizá-los.
O responsável deverá informar finalidades, bases legais, fornecedores, retenção, transferência internacional, direitos e contato para pedidos de privacidade com base na operação efetiva. Esta minuta não é a política final.

## Antes de enviar

1. Criar/verificar conta Play Console e confirmar tipo de conta conforme função real do produto.
2. Confirmar nome do titular, contato de suporte e applicationId definitivo.
3. Publicar a versão do servidor e verificar áudio/memória no Android físico.
4. Implementar denúncia de respostas dentro do app, destino de recebimento e tratamento de relatos.
5. Publicar política final, preencher Segurança dos dados e classificação indicativa conforme comportamento real.
6. Gerar chave de upload e AAB assinado; cadastrar Play App Signing.
7. Subir em teste interno e conferir acesso dos testadores.
8. Para nova conta pessoal, atender ao teste fechado exigido antes de solicitar produção.

Fontes oficiais:
https://developer.android.com/studio/publish/app-signing
https://support.google.com/googleplay/android-developer/answer/6112435?hl=pt-BR
https://support.google.com/googleplay/android-developer/answer/14151465?hl=pt-BR
https://support.google.com/googleplay/android-developer/answer/13985936?hl=pt-BR
