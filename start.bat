@echo off
rem Starts the backend (seeded) and the Mini Program watcher, each in its own window.
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo [FAIL] Run setup.bat first.
  pause
  exit /b 1
)

rem seed.seed REBUILDS data\app.db every time: demo state is reset on each start.
start "Backend (port 8000)" /D "%~dp0backend" cmd /k ".venv\Scripts\activate.bat && python -m seed.seed && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
start "Mini Program (dev:weapp)" /D "%~dp0miniprogram" cmd /k "npm run dev:weapp"

set LAN_IP=
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration).Where({$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'})[0].IPv4Address.IPAddress"`) do set LAN_IP=%%i

echo.
echo Two windows opened: backend ^(http://localhost:8000/docs^) and the Mini Program build.
echo Open the miniprogram folder in WeChat DevTools.
echo.
if defined LAN_IP (
  echo This laptop's LAN IPv4: %LAN_IP%
  echo For phone testing put this line in miniprogram\.env.local ^(or just run phone.bat^):
  echo     TARO_APP_API_BASE_URL=http://%LAN_IP%:8000
) else (
  echo Could not find a LAN IPv4 address. Connect to Wi-Fi and run phone.bat.
)
echo.
pause
