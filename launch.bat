@echo off
title DinoClaw Launcher
color 0A

echo.
echo   ====================================
echo     DinoClaw - Desktop AI Agent v0.4
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

REM Stop a stale dev server if launch.bat was run again
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo [CLEANUP] Stopping stale process on port 5173 ^(PID %%a^)...
    taskkill /PID %%a /F /T >nul 2>&1
)

echo [START] Launching DinoClaw...
echo         Wait ~5 seconds for the window to load.
echo         Close this window to stop the app.
echo.

call npm run dev
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] DinoClaw failed to start. See errors above.
    pause
    exit /b 1
)
