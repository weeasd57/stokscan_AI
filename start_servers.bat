@echo off
echo ==============================================
echo       Starting AI Stocks Servers
echo ==============================================

echo [1/2] Starting FastAPI Backend on port 8000...
start "FastAPI Backend" cmd /k "venv\Scripts\python -m uvicorn api.main:app --reload --host 127.0.0.1 --port 8000"

echo Waiting 5 seconds for the backend to initialize...
timeout /t 5 /nobreak >nul

echo [2/2] Starting Next.js Frontend on port 3000...
start "Next.js Frontend" cmd /k "cd web && npm run dev" 
        or 
        "node node_modules/next/dist/bin/next dev"
echo Waiting 5 seconds for the frontend to initialize...
timeout /t 5 /nobreak >nul

echo Opening browser...
start http://127.0.0.1:3000/login

echo.
echo Servers are running in separate windows.
echo You can safely close this main window.
