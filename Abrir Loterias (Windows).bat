@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py loterias.py) || (python loterias.py)
if errorlevel 1 (echo. & echo Instale o Python em https://www.python.org/downloads/ marcando "Add Python to PATH". & pause)
