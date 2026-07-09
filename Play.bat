@echo off
title PokeTCG EX Simulator
cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed. Make sure Node.js is installed.
        pause
        exit /b 1
    )
)

echo Starting PokeTCG EX Simulator...
start "" http://localhost:5173
npm run dev
