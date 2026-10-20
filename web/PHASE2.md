# Phase 2: the website talks to the backend

At start-up the site asks the backend `/health`. Backend up: money actions go through the real bank approval chain, and the Plan screen, Judge panel and Ask bar use `/agent`, `/trace`, `/audit` and `/voice`. Backend down: the Phase 1 mock path runs unchanged, so UI work never depends on the server.

```bash
web.bat            # from the repo root: backend (seeded) + website, each in its own window
```

Dev proxy: `/api` -> `http://localhost:8000` (`vite.config.ts`). For a built site set `VITE_API_BASE`.
`POST /demo/reset` only works from this machine unless `DEMO_PUBLIC=1` is set on the server.

## Where the code is
- `src/api/client.ts`: fetch client, per-action `X-Trace-Id`, response types.
- `src/state/live.ts`: health check, `syncBank` (balance, reserved, lock), the approval chain for a sheet (start, confirm, PIN, co-sign, token, execute), judge scenario controls.
- `src/state/livePlan.ts`: the agent plan mapped onto the Plan screen, and the five commands.
- `src/state/liveVoice.ts`: hold-to-talk recording and `/voice/asr`.
- `src/components/JudgeLive.tsx`: real trace table, audit verify, resale-payout control.
- `src/state/actions.ts`: each action calls its `live*` hook first and falls back to the mock when it returns false.

## Live
Payments (transfer, confirm, PIN, co-sign, execute), tax pot rule, loan draft / submit / withdraw, the honey-season plan and the pay-six-families plan with the five commands, balance / reserved / lock, judge trace + audit verify + scenario controls (reset, suspicious order, unlock via co-signer, resale payout), hold-to-talk transcription.

## Still mock
- Forecast, policy, compliance and tax numbers on the screens (the endpoints exist: `/analysis/*`).
- Climate and cash plans (the backend planner knows only the honey season, the six families and "pay X N yuan").
- A payee typed in by hand (the bank has no create-payee endpoint).
- Loan review states (approve / needs documents / paid out) and the subsidy applications (Phase 3 backend items).
- English wording of agent replies and step summaries (Phase 3). Spoken replies (`/voice/tts`) are not wired.
- Hold-to-talk needs a speech provider (`LLM_MOCK=0` and a key); without one it offers the stand-in sentence as before.
