@echo off
title SolarBeam eBay Scanner
cd /d "%~dp0"
if not exist node_modules\playwright-core (
  echo Installing dependencies, one moment...
  call npm install --silent
  if errorlevel 1 (
    echo.
    echo Install failed. Make sure Node.js is installed, then run this again.
    pause
    exit /b 1
  )
)
node server.js
pause
