@echo off
rem Karaoke API launcher for Windows (Task Scheduler stand-in for pm2).
rem Writes all output to server\logs\api.log and restarts the API if it stops.
rem Point the scheduled task's "Program/script" at this file. See WINDOWS.md.

cd /d "%~dp0"
if not exist logs mkdir logs

where node >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] node.exe not found on PATH for user %USERNAME% >> logs\api.log
  exit /b 1
)

if not exist node_modules (
  echo [%date% %time%] node_modules missing - running npm install >> logs\api.log
  call npm install >> logs\api.log 2>&1
)

:loop
echo [%date% %time%] Starting karaoke API as %USERNAME% >> logs\api.log
node index.js >> logs\api.log 2>&1
echo [%date% %time%] API exited with code %errorlevel% - restarting in 5s >> logs\api.log
rem ping instead of timeout: timeout fails when there is no console window
ping -n 6 127.0.0.1 >nul
goto loop
