@echo off
rem Web preview (H5) for teammates on the same Wi-Fi. The submission is the WeChat Mini Program; this is only a click-through.
setlocal
cd /d "%~dp0"

set LAN_IP=
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration).Where({$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'})[0].IPv4Address.IPAddress"`) do set LAN_IP=%%i
if not defined LAN_IP (
  echo [FAIL] No LAN IPv4 address found. Connect to Wi-Fi and try again.
  pause
  exit /b 1
)

rem The browser on a teammate's machine must reach the backend by this laptop's address, not by localhost.
> "miniprogram\.env.local" echo TARO_APP_API_BASE_URL=http://%LAN_IP%:8000
start "H5 preview (dev:h5)" /D "%~dp0miniprogram" cmd /k "npm run dev:h5"

echo.
echo This laptop:     http://localhost:10086
echo Teammates open:  http://%LAN_IP%:10086   ^(first build takes a minute; the backend must be running: start.bat^)
echo API base URL set to http://%LAN_IP%:8000 in miniprogram\.env.local ^(git-ignored^). Allow python and node in Windows Firewall ^(Private^).
echo Remote access: cloudflared tunnel --url http://localhost:10086   ^(also tunnel port 8000, put its URL in
echo   miniprogram\.env.local as TARO_APP_API_BASE_URL, add the H5 tunnel URL to CORS_ORIGINS in .env, restart both^).
pause
