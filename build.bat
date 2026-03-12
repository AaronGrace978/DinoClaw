@echo off
title DinoClaw Builder
color 0A

echo.
echo   ====================================
echo     DinoClaw - Build Portable .exe
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
    echo [SETUP] Installing dependencies...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo.
)

echo [BUILD] Compiling TypeScript + Vite...
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed. Check the output above.
    pause
    exit /b 1
)

echo.
echo [PACK]  Packaging with electron-builder...
call npx electron-builder
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Packaging failed. Check the output above.
    pause
    exit /b 1
)

echo.
echo   ====================================
echo     BUILD COMPLETE
echo     Output: release\
echo   ====================================
echo.

explorer release
pause
