# Ativar no serviço existente contas-jr

Repositório: Juniorcontrole68/radar-4x4-brasil
Branch: contas-a-pagar-temp
Root Directory: contas-a-pagar-v3
Build Command: npm install --omit=dev
Start Command: npm start
Health Check Path: /health

Preservar a variável DATABASE_URL apontando para o banco existente. Não criar outro banco e não substituir as variáveis existentes. Se DATABASE_URL estiver ausente, configurar no painel com a Internal Database URL do banco existente, sem registrar o segredo no GitHub.

O banco contas-a-pagar-db foi encontrado no plano free, com expiresAt em 2026-10-10. Para uso permanente, seu plano deve ser alterado no painel, preservando a instância e os dados.

A versão antiga grava contas em arquivo local. Antes de reiniciar, exportar eventuais registros existentes e planejar sua importação no PostgreSQL. Esta versão não importa nem apaga registros antigos automaticamente.

Depois do ajuste, executar Manual Deploy > Deploy latest commit e validar /health, cadastro, recorrência, prorrogação, pagamento, relatório e exportação CSV. A consulta ao schema do banco pelo conector falhou; a compatibilidade deve ser verificada antes da ativação.
