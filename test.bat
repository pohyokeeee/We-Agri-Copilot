@echo off
rem Offline checks: pytest (LLM_MOCK=1), audit-chain verify, smoke script dry run.
setlocal
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
  echo [FAIL] Run setup.bat first.
  pause
  exit /b 1
)
set PY=".venv\Scripts\python.exe"
set LLM_MOCK=1

rem audit.verify needs a database; build one only if there is none (start.bat rebuilds it anyway)
if not exist "data\app.db" %PY% -m seed.seed

set T1=PASS& set T2=PASS& set T3=PASS
%PY% -m pytest -q
if errorlevel 1 set T1=FAIL
%PY% -m app.audit.verify
if errorlevel 1 set T2=FAIL
%PY% scripts\smoke_llm.py --dry
if errorlevel 1 set T3=FAIL

echo.
echo ===== Summary =====
echo pytest ^(LLM_MOCK=1^) : %T1%
echo audit chain verify  : %T2%
echo smoke_llm --dry     : %T3%
set RC=0
if "%T1%%T2%%T3%"=="PASSPASSPASS" (echo OVERALL: PASS) else (echo OVERALL: FAIL& set RC=1)
pause
exit /b %RC%
