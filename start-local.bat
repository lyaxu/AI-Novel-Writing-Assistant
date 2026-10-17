@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-test\start.ps1" %*
if errorlevel 1 (
  echo Startup stopped. Read the error above; no fallback database is used.
  pause
  exit /b 1
)
