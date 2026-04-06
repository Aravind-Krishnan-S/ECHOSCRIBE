@echo off
title EchoScribe Launcher
color 0A

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║       EchoScribe — Starting Up...        ║
echo  ╚══════════════════════════════════════════╝
echo.

:: Navigate to the project directory
cd /d "%~dp0"

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Please install Node.js first.
    echo          https://nodejs.org/
    pause
    exit /b 1
)

:: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo  [WARNING] Python not found. SpeechBrain will be unavailable.
    echo            The app will still work using Deepgram fallback.
    echo.
    set SKIP_SPEECHBRAIN=1
)

:: Check if node_modules exists
if not exist "node_modules" (
    echo  [Setup] Installing Node.js dependencies...
    call npm install
    echo.
)

:: Start SpeechBrain in a separate window (optional)
if not defined SKIP_SPEECHBRAIN (
    echo  [1/3] Starting SpeechBrain service...
    start "EchoScribe - SpeechBrain" /min cmd /c "python src\python\start_speechbrain.py"
    echo        SpeechBrain launching in background window.
) else (
    echo  [1/3] Skipping SpeechBrain (Python not found)
)

:: Wait a moment for SpeechBrain to begin initializing
echo  [2/3] Waiting for services to initialize...
timeout /t 3 /nobreak >nul

:: Open the browser
echo  [3/3] Opening browser...
timeout /t 2 /nobreak >nul
start http://localhost:3000

:: Start the Node.js server (this keeps the window open)
echo.
echo  ════════════════════════════════════════════
echo   EchoScribe is running at http://localhost:3000
echo   Press Ctrl+C to stop the server.
echo  ════════════════════════════════════════════
echo.

npm run dev
