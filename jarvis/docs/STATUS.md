# Estado da entrega

| Recurso | Estado |
|---|---|
| Interface PT-BR, dark/azul e responsiva | Implementada, sem QA visual automatizada |
| Login pessoal e CSRF | Implementados e testados |
| Voz, escolha de voz, interrupção e modo contínuo | Implementados com APIs do navegador; não testados em Android real |
| Google OAuth e consultar/criar/editar/excluir eventos individuais | Implementados; precisam de credenciais e autorização. Testes com mock |
| “Mostre meus compromissos de amanhã” | Encaminha para consulta real do Google; falha explícita se desconectado |
| “Marque reunião” / “lembre-me” | Abrem a área de agenda/tarefas; preenchimento e confirmação manuais |
| Tarefas e lembretes por horário | Implementados; avisos só com app aberto |
| Listas dedicadas / rotinas recorrentes / push | Pendentes (lista única de tarefas disponível) |
| Memória opcional, correção e exclusão | Implementadas; uso pela IA só se autorizado |
| Conversa livre | Implementada via API; precisa de chave |
| Pesquisa com fontes | Implementada via Brave; precisa de chave |
| TXT, CSV, MD e PDF textual | Extração implementada; PDF precisa de pypdf |
| Fotos, OCR, DOCX | Pendentes |
| WhatsApp/e-mail | Rascunho, copiar e compartilhar; envio no app escolhido pelo usuário |
| Transportadora | Contrato documentado; conexão real pendente |
| APK, palavra de ativação com tela apagada, alto-falante forçado | Pendentes: precisam de app Android nativo |
| Hospedagem, domínio, Play Store | Não publicados |

Não há simulação de compromissos, clientes, receitas ou posição de motoristas na interface. Memória é opt-in e conversas não são persistidas. Testes não usam a agenda real. Pagamentos não são suportados.
