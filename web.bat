@echo off
rem Starts the backend (seeded) and the website (web/), each in its own window. The website proxies /api to the backend on :8000.
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo [FAIL] Run setup.bat first.
  pause
  exit /b 1
)
if not exist "web\node_modules" (
  echo Installing the website's packages...
  pushd web
  call npm install
  popd
)

rem seed.seed REBUILDS data\app.db every time: demo state is reset on each start.
start "Backend (port 8000)" /D "%~dp0backend" cmd /k ".venv\Scripts\activate.bat && python -m seed.seed && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
start "Website (port 5173)" /D "%~dp0web" cmd /k "npm run dev"

echo.
echo Website:   http://localhost:5173        (farmer)
echo Family:    http://localhost:5173/family (open in a second window)
echo Judge:     http://localhost:5173/judge
echo Backend:   http://localhost:8000/docs
echo If the backend is not running the website still works on its built-in sample data.
pause
