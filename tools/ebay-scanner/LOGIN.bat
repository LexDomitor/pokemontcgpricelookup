REM Developed for Arcane 9 Labs by Alex Puh and Kyle He
@echo off
title eBay Sign-in (scanner profile)
cd /d "%~dp0"
node login.js
echo.
echo Close the browser window when you are done, then run START.bat.
pause
