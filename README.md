# We-Agri-Copilot 元农民

**Live demo:** https://we-agri-copilot.onrender.com/ (farmer `/`, family `/family`, judge panel `/judge`)

- Free hosting: the first load may take up to a minute (the instance sleeps when idle).
- It may be slow or unreachable from mainland China. **The demo video is the primary demo:** VIDEO_LINK
- Simulated accounts, synthetic data. Demo PINs: `123456` (farmer, Uncle Wang) and `654321` (daughter, co-signer).
- Use 重置演示 (judge panel, 演示工具) to start over.

A voice-first banking agent that does the back office for small agricultural businesses in China selling online, designed for older,
low-literacy owners. WeBank FinTechathon 2026, Topic E (SME Finance Copilot).

The prelim demo is the **website** (`web/`). The **WeChat Mini Program** (`miniprogram/`) is the production channel; both talk to the same backend.
Documentation: [Technical documentation](docs/TECHNICAL_DOCUMENTATION.md) · [Security self-assessment](docs/SECURITY_SELF_ASSESSMENT.md) ·
[Project report](docs/full-project-report.md) · [Build plan](docs/build-plan.md) · [Forecast backtest evidence](evidence/backtest_forecast.md).

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

## Screenshots

| Screen | What it shows |
|---|---|
| <img src="docs/screenshots/01-home.png" alt="01-home" width="320"> | Home: balance, the plan in progress, and what the farmer can ask |
| <img src="docs/screenshots/02-plan.png" alt="02-plan" width="320"> | One sentence ("下个月要收蜂蜜了，帮我准备一下") becomes a step-by-step plan; risky steps wait for confirmation |
| <img src="docs/screenshots/03-tax-check.png" alt="03-tax-check" width="320"> | Tax compliance check: own produce vs resale, with the rule cited |
| <img src="docs/screenshots/04-my-tax.png" alt="04-my-tax" width="320"> | Tax overview: 61% own produce / 39% resale, and why the platform figure is higher |
| <img src="docs/screenshots/05-purchase-forecast.png" alt="05-purchase-forecast" width="320"> | Purchase forecast: spend and cash as ranges, with the likely gap |
| <img src="docs/screenshots/06-subsidies.png" alt="06-subsidies" width="320"> | Subsidies and loans the business may qualify for, with documents and deadlines |
| <img src="docs/screenshots/07-applications.png" alt="07-applications" width="320"> | Applications: drafts prepared, submission needs the farmer's and family's confirmation |
| <img src="docs/screenshots/08-pay.png" alt="08-pay" width="320"> | Payments: daily 1,000 CNY limit, known payees, a new payee flagged |
| <img src="docs/screenshots/09-family.png" alt="09-family" width="320"> | Family view (daughter's phone): approve or decline a risky payment, with the reason and a time limit |

## Architecture

```
web/ (Vite, React)  ─┐
                     ├──HTTP──> FastAPI  (the website is served by the backend in the Docker image; its calls go to /api)
miniprogram/ (Taro) ─┘            ├─ /bank/*   mock bank (SQLite): balance, payees, transfers, reserves,
                                  │            order import, PIN/MFA, co-signer approvals, safety lock
                                  ├─ app/risk  deterministic tier engine (green/yellow/red, only ever raises)
                                  ├─ app/audit SHA-256 hash-chained, append-only audit log, trace view
                                  ├─ app/analysis, app/agent, app/llm, app/voice   (sales record, compliance, forecast,
                                  │            policy match, planner + executor, Qwen/Groq client, ASR/TTS)
                                  └─ rule_tax / rule_policy tables (seed JSON, PRC rules only)
```

Principle: **LLMs plan and explain; deterministic code computes.** The LLM never decides tiers, amounts, tax
results or payees. Non-green bank actions return `202` + an approval; they execute only with a single-use token
bound to that exact request (PIN, plus co-signer when the customer has protection mode and the tier is red).

## Live demo (Render)

The Docker image at the repo root serves the website and the API from one URL (`/api/...`; the old paths still work for the Mini Program).

Deploy: push the repo to GitHub, in Render choose **New > Blueprint**, pick the repo (it reads `render.yaml`: one free web service, Singapore),
then fill in the environment variables in the dashboard: `LLM_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_PLANNER`, `GROQ_CLASSIFIER`, `GROQ_ASR`,
`LLM_MOCK=0`, `DEMO_PUBLIC=1`, `DEMO_TODAY=2026-07-25`. Check `https://<your-service>.onrender.com/health`.

With `DEMO_PUBLIC=1` the service shows a "演示环境 · 模拟账户 · 数据会重置" banner, turns off `/docs` and CORS, allows `POST /demo/reset`, and limits paid model
calls (20 per minute per IP, 500 per day; past that, answers come from fixed templates). The database is rebuilt on every start.

Things to know:
- The free instance sleeps when idle: the first load after a pause takes about a minute.
- The site can be slow or unreachable from mainland China. **The video is the primary demo**; the live link is a backup for judges outside China.
- Run locally with no key: `LLM_MOCK=1`. Backend: `cd backend && python -m seed.seed && uvicorn app.main:app`; website: `cd web && npm run dev`
  (or build it with `npm run build` and the backend serves it at http://localhost:8000). Or `docker build -t wac . && docker run -p 8000:8000 -e LLM_MOCK=1 wac`.

## Quick start (Windows)

Double-click, or run from a terminal in the repo folder (paths with spaces are fine). Needs Python 3.12 (`py -3.12`) and Node 20.

| Script | What it does |
|---|---|
| `setup.bat` | One time: creates `backend\.venv`, installs backend and npm packages, copies `.env.example` to `.env` if there is none. Then open `.env` in Notepad and add your keys (`LLM_MOCK=1` needs none). |
| `start.bat` | Opens two windows: the backend (reseeds `data/app.db`, then uvicorn on port 8000) and the Mini Program build (`npm run dev:weapp`). Prints the laptop's LAN IP. |
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

## Web preview (H5)

The Mini Program code also builds for the browser, so teammates can click through the production channel without WeChat. (The prelim demo itself is the website in `web/`; this H5 build is the same Mini Program UI.)
Push-to-talk records with the browser's microphone (and falls back to typing if it is blocked). Spoken replies are WeChat-only, so the web version shows replies as text.

```bash
cd miniprogram
npm run dev:h5      # http://localhost:10086 (listens on 0.0.0.0)
npm run build:h5    # static files in miniprogram/dist-h5
```

On Windows, `h5.bat` does the setup for the same Wi-Fi: it points the API base URL at this laptop's LAN IP, starts `dev:h5` and prints
`http://<LAN IP>:10086` (start the backend with `start.bat`). The API base URL is the same build-time variable as for the Mini Program
(`TARO_APP_API_BASE_URL`, default `http://localhost:8000`). The backend allows cross-origin calls only from localhost and private-LAN
addresses on port 10086; add other origins (such as a tunnel) with `CORS_ORIGINS` in `.env`. For remote access:
`cloudflared tunnel --url http://localhost:10086`, tunnel the backend too (`--url http://localhost:8000`), set `TARO_APP_API_BASE_URL` to the
backend tunnel URL, add the H5 tunnel URL to `CORS_ORIGINS`, and restart both.

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

Matches [docs/SECURITY_SELF_ASSESSMENT.md](docs/SECURITY_SELF_ASSESSMENT.md) (status words are used strictly: Implemented = code plus a test).
`LLM_MOCK=1 pytest -q`: **261 tests pass** (the self-assessment was written at 239).

**Implemented**
- Permission tiers and raise rules (new payee, 2x median, over half the balance, night time, daily 1,000 CNY); the tier only ever goes up.
- Typed 6-digit PIN (salted PBKDF2), family co-signer on its own phone, single-use approval tokens bound to the exact request, 5-minute expiry.
- Safety lock (3 wrong PINs, injection detected, manual); locked = reads work, money cannot move; unlock always needs the co-signer.
- Prompt-injection defence: untrusted-text wrapper, rule and model score, lock on detection, no payees or amounts from model text.
- Grounding and wording checkers on model replies and tax/policy output (no advice, no filing words).
- Hash-chained audit log with trace ids, verify command and endpoint, masked trace view.
- Mock bank, sales record and reconciliation, compliance check, structure comparison, policy matching, procurement forecast, plan DAG with
  approval, pause, partial rollback and human handover; Qwen/Groq provider switch with offline template fallback.
- Mini Program pages (chat, co-signer, judge trace) wired to the backend; the website's live parts are listed under Partial.

**Partial**
- Speech-recognition guard: a heuristic read-back for doubtful audio; no list of known silence hallucinations.
- AI labelling: spoken and on-screen label; no machine-readable audio metadata.
- Personal data: synthetic only; no consent screen, no encryption at rest.
- Injection scan covers order notes and product titles only.
- Rule citations: every `citation_url` is still `"TODO"` and six tax rules are `recall` (shown as 待核实). No URL has been invented.
- Website: some screens (forecast, policy, compliance and tax numbers) still show sample numbers; see `web/PHASE2.md` for what is live.
- Model quality is only tested with fakes; the demo may run on a Groq stand-in instead of Qwen.

**Not implemented**
- Device binding and spoken PIN; anomaly detection and an anomaly-triggered lock.
- Sandboxed code execution for open-ended questions, and the monthly spending report.
- Proactive triggers, automatic handover after failed clarifications, tax-text explainer, exported evidence logs (`make evidence`).
- Real bank or platform APIs, a real AppID and ICP-filed domain, generative-AI service registration, audio watermark.
- Detection of a deleted audit-log tail (tamper-evident, not tamper-proof).
