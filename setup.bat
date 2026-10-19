@echo off
rem One-time setup: Python 3.12 venv, backend requirements, npm packages, .env from the example.
setlocal
cd /d "%~dp0"

py -3.12 --version >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Python 3.12 not found. Install it from python.org, then run this again. ^(3.13+ is not supported.^)
  goto :fail
)
node --version >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Node.js not found. Install Node 20 LTS from nodejs.org, then run this again.
  goto :fail
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating backend\.venv with Python 3.12 ...
  py -3.12 -m venv "backend\.venv"
  if errorlevel 1 goto :fail
)

echo Installing backend requirements ...
"backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
if errorlevel 1 goto :fail

echo Installing Mini Program packages ...
pushd "miniprogram"
call npm install
set NPM_RC=%errorlevel%
popd
if not "%NPM_RC%"=="0" goto :fail

if exist ".env" (
  echo .env already exists, left as it is.
) else (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example.
)

echo.
echo [OK] Setup done. Next: open the .env file in this folder with Notepad, add your keys, save, then run start.bat
echo      ^(LLM_MOCK=1 needs no keys.^)
echo      notepad "%~dp0.env"
pause
exit /b 0

:fail
echo.
echo [FAIL] Setup stopped. Fix the message above and run setup.bat again.
pause
exit /b 1
