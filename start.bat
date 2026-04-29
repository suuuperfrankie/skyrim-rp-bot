@echo off
REM Skyrim RP Bot launcher
REM Double-click this file to start the bot.

cd /d "%~dp0"
title Skyrim RP Bot

if not exist node_modules (
    echo First-time setup: installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Make sure Node.js is installed: https://nodejs.org
        pause
        exit /b 1
    )
)

node src/index.js
echo.
echo Bot stopped. Press any key to close.
pause >nul
