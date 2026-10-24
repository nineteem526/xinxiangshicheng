@echo off
rem RealityGlitch one-click start: backend (8011) in its own window, then the frontend (5173).
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.11+ is required: https://www.python.org
  pause
  exit /b 1
)

python -c "import fastapi,uvicorn,httpx,dotenv" >nul 2>nul
if errorlevel 1 (
  echo Installing backend dependencies...
  python -m pip install -r server\requirements.txt
)

if not exist server\.env (
  copy server\.env.example server\.env >nul
  echo Created server\.env - put your API key in LLM_API_KEY, then restart this script.
  echo Without a key the game still works with preset levels.
)

start "RealityGlitch server" cmd /k "server\start.bat"
call app\start.bat
