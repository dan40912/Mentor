@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Mentor needs Node.js 20 or later.
  echo Install it from https://nodejs.org/en/download/ and double-click this file again.
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)"
if errorlevel 1 (
  echo Mentor needs Node.js 20 or later. Your current version is:
  node --version
  echo Install a current version from https://nodejs.org/en/download/
  pause
  exit /b 1
)
start "Mentor" "http://127.0.0.1:4317"
npm start
if errorlevel 1 pause
