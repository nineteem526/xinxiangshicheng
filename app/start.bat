@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
start "" https://localhost:5173
call npm run dev
pause
