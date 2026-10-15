# Needs GNU make + a Python 3.11+ on PATH. Windows: use Git Bash, or run the commands by hand.
PY ?= $(if $(wildcard backend/.venv/Scripts/python.exe),.venv/Scripts/python,$(if $(wildcard backend/.venv/bin/python),.venv/bin/python,python))

.PHONY: install seed dev test verify-audit

install:
	cd backend && python -m venv .venv && (.venv/Scripts/python -m pip install -r requirements.txt || .venv/bin/python -m pip install -r requirements.txt)
	cd miniprogram && npm install

seed:
	cd backend && $(PY) -m seed.seed

dev:
	cd backend && $(PY) -m uvicorn app.main:app --reload --port 8000

test:
	cd backend && $(PY) -m pytest -q

verify-audit:
	cd backend && $(PY) -m app.audit.verify
