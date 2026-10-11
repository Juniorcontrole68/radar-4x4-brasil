# Integrações da transportadora — proposta, não conectada

Nenhuma credencial SSW/ESL/Construlog foi usada e não há endpoints inventados como se fossem reais. Antes de conectar, obter documentação e API autorizada do seu sistema.

Contrato sugerido para adaptador no servidor:

| Consulta | Rota sugerida do adaptador | Campos mínimos |
|---|---|---|
| Coletas | GET /coletas?inicio=&fim= | id, cliente, cidade, status, data |
| Entregas | GET /entregas?data= | id, motorista, destino, status, previsão |
| Financeiro | GET /financeiro?inicio=&fim= | recebido, pago, pedágio, saldo |
| Frota | GET /frota | placa, tipo, situação, manutenção prevista |
| Rastreio | GET /rastreio?data= | motorista, latitude, longitude, atualizado_em |

Essas rotas são sugestão de contrato, não APIs existentes. Guardar token somente no servidor, aplicar timeout, paginação e controles de acesso. Exibir horário da última atualização e falhas de origem, sem preencher números fictícios. Primeira fase deve ser somente leitura. Qualquer alteração de status/financeiro exige escopo explícito, trilha de auditoria e confirmação para operações sensíveis. Separar dados por usuário/empresa caso o projeto passe a ter mais de um usuário.
