@echo off
title DinoClaw Launcher
color 0A

echo.
echo   ====================================
echo     DinoClaw - Desktop AI Agent v0.2
echo   ====================================
echo.

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Download from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [SETUP] First run detected. Installing dependencies...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] npm install failed. Check the output above.
        pause
        exit /b 1
    )
    echo.
    echo [SETUP] Dependencies installed successfully.
    echo.
)

echo [START] Launching DinoClaw in dev mode...
echo         Close this window to stop the app.
echo.

call npm run dev
