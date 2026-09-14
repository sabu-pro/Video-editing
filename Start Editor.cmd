@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 20 or newer from https://nodejs.org and try again.
  pause
  exit /b 1
)
echo Cutline Studio - http://localhost:3000
echo Keep this window open while editing. Press Ctrl+C to stop the server.
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"
node server.js
pause
