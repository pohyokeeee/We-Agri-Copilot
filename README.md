# We-Agri-Copilot 元农民

A voice-first banking agent (WeChat Mini Program) that does the back office for small agricultural
businesses in China selling online, designed for older, low-literacy owners.
WeBank FinTechathon 2026, Topic E (SME Finance Copilot).

> **SIMULATED ACCOUNTS — synthetic data only.** The bank is "Mock Bank — simulated accounts". Uncle Wang and
> Wang Family Apiary are fictional. The county policy table is simulated.
>
> **Information, not tax advice.** The app shows cited rules and numbers from the user's own sales record.
> It never recommends a tax structure, never files anything, and points to 12366.

Three features run on one **sales record** (platform orders matched to bank payouts, tagged
own_produce / resale / processed):

1. Tax structure comparison + compliance check (cited information)
2. Subsidy & loan matching (one simulated county, "may qualify" wording)
3. Pre-procurement forecast + cash gap + plan (reserve, supplier payments, financing)

Chained request (S6): "下个月要收蜂蜜了，帮我准备一下" → task DAG with interrupt and partial rollback.

## Architecture

```
Mini Program (Taro/React) ──HTTP──> FastAPI
                                      ├─ /bank/*   mock bank (SQLite): balance, payees, transfers, reserves,
                                      │            order import, PIN/MFA, co-signer approvals, safety lock
                                      ├─ app/risk  deterministic tier engine (green/yellow/red, only ever raises)
                                      ├─ app/audit SHA-256 hash-chained, append-only audit log
                                      ├─ app/analysis, app/agent, app/llm, app/voice   (stubs - see below)
                                      └─ rule_tax / rule_policy tables (seed JSON, PRC rules only)
```

Principle: **LLMs plan and explain; deterministic code computes.** The LLM never decides tiers, amounts, tax
results or payees. Non-green bank actions return `202` + an approval; they execute only with a single-use token
bound to that exact request (PIN, plus co-signer when the customer has protection mode and the tier is red).

## Run the backend

**Use Python 3.12; 3.13+ is not supported yet (pydantic-core / LangGraph wheels).** Supported range:
`>=3.11,<3.13` (no `pyproject.toml`, so this is documented here; `backend/.python-version` pins 3.12).

Windows (PowerShell):

```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Or without activating, on any OS:

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Linux/macOS: .venv/bin/python
.venv/Scripts/python -m seed.seed                          # builds data/app.db (idempotent: rebuilds everything)
.venv/Scripts/python -m uvicorn app.main:app --reload      # http://127.0.0.1:8000/docs
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m app.audit.verify                   # check the audit hash chain
```

With GNU make: `make install seed dev test verify-audit`. Docker: `docker compose up --build` (seed once with
`docker compose run --rm backend python -m seed.seed`). Copy `.env.example` to `.env` for the Qwen key
(`LLM_MOCK=1` needs no key).

Demo logins (synthetic): Uncle Wang = customer 1, PIN `123456`, protection mode on. Daughter/co-signer =
customer 2, PIN `654321`. Seeded window is 2025-07 to 2026-06 (demo "today" ≈ July 2026).
Demo clock: all date logic uses `app.clock.today()`, which is `DEMO_TODAY` (default `2026-07-25`, so the honey purchase is
about 3 weeks away); set `DEMO_TODAY=` empty for the real date. Re-run `python -m seed.seed` after changing it.
Backtest of the forecast: `python -m scripts.backtest_forecast` (writes `evidence/backtest_forecast.md`).
Sample order exports for `POST /bank/orders/import` are in `backend/seed/orders/`.

## Run the Mini Program

```bash
cd miniprogram
nvm use 20                # Node 20 LTS recommended (engines: >=18 <21; Node 24 is untested with Taro 4.0.9)
cp .env.example .env     # TARO_APP_API_BASE=http://127.0.0.1:8000
npm install
npm run dev:weapp
```

Open `miniprogram/` in WeChat DevTools (AppID is the placeholder `touristappid`).
**During development, untick "不校验合法域名、web-view(业务域名)、TLS 版本以及 HTTPS 证书"** (Details → Local
settings) so the app can call `http://127.0.0.1:8000`. `project.config.json` also sets `urlCheck: false`.
Mini Program is not run in Docker.

Age-friendly (适老化) defaults live in `src/app.css`: 20px+ base font, high contrast, 48px minimum tap targets.

## Status

Implemented and tested: config/db/health, all tables, audit chain + CLI, tier engine, mock bank API
(incl. approvals, co-signer, lock), PRC tax rule seed, simulated county policy seed, Uncle Wang seed data,
VAT threshold helper (`app/tax/vat.py`), `app/llm/qwen.py` client (mock mode + disk cache).

Stubbed (`NotImplementedError` + TODO): `app/analysis/*` (reconcile, compliance, structures, policy_match,
forecast), `app/agent/*` (graph, executor, grounding, roles), `app/voice/asr.py`, `app/voice/tts.py`
(label logic done). Mini Program pages/cards render static mock props; only `api.balance` and the co-signer
calls are wired.

All rule rows have `citation_url: "TODO"`; the co-op row is `status: recall`. Verify every rule against its primary
source before the demo.
