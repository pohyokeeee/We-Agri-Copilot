@echo off
rem Points the Mini Program at this laptop's LAN IP so a real phone can reach the backend.
rem Writes miniprogram\.env.local (git-ignored). The value is baked in at build time: restart the Mini Program build afterwards.
setlocal
cd /d "%~dp0"

set LAN_IP=
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration).Where({$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'})[0].IPv4Address.IPAddress"`) do set LAN_IP=%%i
if not defined LAN_IP (
  echo [FAIL] No LAN IPv4 address found. Connect this laptop to Wi-Fi and try again.
  pause
  exit /b 1
)

> "miniprogram\.env.local" echo TARO_APP_API_BASE_URL=http://%LAN_IP%:8000
echo [OK] miniprogram\.env.local now has: TARO_APP_API_BASE_URL=http://%LAN_IP%:8000
echo.
echo Phone testing steps:
echo  1. Phone and laptop on the SAME Wi-Fi.
echo  2. Close the "Mini Program (dev:weapp)" window if it is open, then run start.bat
echo     ^(the new address is only picked up when the build restarts^).
echo  3. First backend run: Windows Firewall asks about python.exe: allow "Private networks".
echo  4. Check from the phone browser: http://%LAN_IP%:8000/health must show status ok.
echo  5. WeChat DevTools: open the miniprogram folder, click Preview ^(or Real-device debugging^), scan the QR code with WeChat.
echo  6. If requests are blocked: DevTools Details - Local settings - tick "do not verify valid domain names"
echo     and turn on Debugging on the phone ^(the "..." menu in the Mini Program^).
echo.
echo To go back to localhost: delete miniprogram\.env.local and restart the build.
pause
