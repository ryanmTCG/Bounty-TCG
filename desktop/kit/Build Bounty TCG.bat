@echo off
rem Double-click to build and start the Bounty TCG desktop app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1"
if errorlevel 1 (
  echo.
  echo Something went wrong. The message above says what.
)
pause
