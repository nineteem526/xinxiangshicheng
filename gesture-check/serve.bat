@echo off
cd /d "%~dp0"
echo Open http://localhost:8080 in Chrome
where python >nul 2>nul
if %errorlevel%==0 (
  python serve.py
  goto :end
)
where npx >nul 2>nul
if %errorlevel%==0 (
  npx --yes http-server -p 8080 -c-1
  goto :end
)
echo Neither python nor node found. Install one of them.
:end
pause
