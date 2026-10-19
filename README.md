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

## Quick start (Windows)

Double-click, or run from a terminal in the repo folder (paths with spaces are fine). Needs Python 3.12 (`py -3.12`) and Node 20.

| Script | What it does |
|---|---|
| `setup.bat` | One time: creates `backend\.venv`, installs backend and npm packages, copies `.env.example` to `.env` if there is none. Then open `.env` in Notepad and add your keys (`LLM_MOCK=1` needs none). |
| `start.bat` | Opens two windows: the backend (reseeds `datapp.db`, then uvicorn on port 8000) and the Mini Program build (`npm run dev:weapp`). Prints the laptop's LAN IP. |
| `test.bat` | pytest with `LLM_MOCK=1`, audit-chain verify, `smoke_llm.py --dry`, then a PASS/FAIL summary. |
| `phone.bat` | Writes `miniprogram\.env.local` (git-ignored) with `TARO_APP_API_BASE_URL=http://<LAN IP>:8000` and prints the real-phone steps. Restart the Mini Program build afterwards. |

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
cp .env.example .env     # optional: TARO_APP_API_BASE_URL (default http://localhost:8000)
npm install
npm run dev:weapp
```

**API base URL.** It is a build-time constant (`API_BASE_URL`, set in `config/index.ts` from `TARO_APP_API_BASE_URL`); the Mini
Program runtime has no `process`, so never read `process.env` in `src/`. Unset means `http://localhost:8000`. For a real phone use the
PC's LAN IP: put `TARO_APP_API_BASE_URL=http://192.168.1.23:8000` in `miniprogram/.env`, start the backend with `--host 0.0.0.0`,
and **rebuild** (`npm run dev:weapp` again), because the value is baked in at build time.

Open `miniprogram/` in WeChat DevTools (AppID is the placeholder `touristappid`).
**During development, untick "不校验合法域名、web-view(业务域名)、TLS 版本以及 HTTPS 证书"** (Details → Local
settings) so the app can call `http://127.0.0.1:8000`. `project.config.json` also sets `urlCheck: false`.
Mini Program is not run in Docker.

Age-friendly (适老化) defaults live in `src/app.css`: 20px+ base font, high contrast, 48px minimum tap targets.

## Mini Program design tokens

All styling reads `miniprogram/src/styles/tokens.scss` (CSS variables on `page`). Nothing else hard-codes a size, colour or timing.

- **Type:** system font stack; scale small 18px / body 20px / title 26px / figure 28px / number 36px, with size-specific
  tracking (large text slightly negative, body 0) and inverse leading. Floors for older users: text >= 18px, key numbers >= 28px.
- **Space and shape:** spacing `--sp-1..6` and radii `--r-*` in rpx (8px grid); tap targets `--tap-min` = 48px.
- **Colour:** one calm accent. Tiers are shape + word + colour, never colour alone: ● 直接做 / ▲ 要您确认 / ■ 要您和家人确认.
- **Motion:** transform + opacity only, one curve (`--ease`, no overshoot), 300ms enter/leave, 100ms press feedback.
  Cards enter from the side of their trigger and leave the same way. `reducedMotion` (`utils/settings.ts`, default off,
  toggle at the bottom of the chat page) swaps slides for a 150ms cross-fade.
- **Chrome:** the header and bottom bar are solid white with a 1px hairline: no blur, no gradients. Demo-only controls sit in a quiet "演示工具" block at the very bottom of the chat page.

## Models: Qwen (production) and Groq (demo stand-in)

Chat (planner, spoken explanations, injection classifier) and speech-to-text go through one OpenAI-compatible client. Pick the
provider with `LLM_PROVIDER` in the repo-root `.env`, set that provider's key, and set `LLM_MOCK=0`:

| | `dashscope` (default) | `groq` |
|---|---|---|
| keys / URL | `DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL` | `GROQ_API_KEY`, `GROQ_BASE_URL` |
| chat models | `QWEN_PLANNER` (qwen-plus), `QWEN_CLASSIFIER` (qwen-flash) | `GROQ_PLANNER`, `GROQ_CLASSIFIER` |
| speech-to-text | `QWEN_ASR` (qwen-audio-3.0-asr-flash), payee names as context | `GROQ_ASR` (Whisper), language zh, payee names as the prompt |
| text-to-speech | `QWEN_TTS`, every clip starts with 元农民助手： | none: `/voice/tts` answers 204 and the app shows the reply as large text labelled 元农民助手（人工智能） |

A key is only ever sent to its own provider. Everything else is identical on both: the DAG schema and tool allow-lists, the grounding
and wording checks, the injection rules, the 10 s timeout, and the template fallback when a model fails. With `LLM_MOCK=1` (or no key)
nothing leaves the machine and every feature uses its template. The tests always run offline.

**Production uses Qwen** (its speech models are the ones built for dialect and elderly speech). **The demo build may use the Groq
stand-in** while the Alibaba account is being verified; Whisper is weaker on dialect and quiet or slow speech, so expect more
"请确认" read-backs there.

`python scripts\smoke_llm.py` (from `backend/`; `--dry` shows the configuration without calling anything) calls each model of the
selected provider once, prints OK/FAIL/SKIP with the latency, lists the provider's models and WARNs about a configured id that is not
in the list. `smoke_qwen.py` is kept as an alias.

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
