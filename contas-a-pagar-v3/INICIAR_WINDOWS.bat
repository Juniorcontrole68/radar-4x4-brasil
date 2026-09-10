@echo off
cd /d %~dp0
if not exist .env (
  echo Crie o arquivo .env copiando .env.example e informe DATABASE_URL.
  pause
  exit /b 1
)
where node >nul 2>nul || (echo Node.js nao encontrado. Instale o Node.js 20 ou superior.& pause & exit /b 1)
if not exist node_modules call npm install
call npm start
pause
