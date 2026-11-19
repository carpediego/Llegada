@echo off
setlocal
cd /d "%~dp0"
title Llegada - servidor local

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo No se encontro Node.js. Instala Node.js 20 o superior desde https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)

call npm run build
if errorlevel 1 (
  echo No se pudo compilar la app.
  pause
  exit /b 1
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4173'"
node server.js
pause
