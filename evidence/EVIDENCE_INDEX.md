# Execution evidence index

Simulated accounts, synthetic data. Reproducible: fixed seed, fixed demo clock (2026-07-25 12:00 CST), templates instead of the model (`LLM_MOCK=1`). Replay with `make evidence` (or `cd backend && python -m scripts.evidence`). Each file is JSON Lines: `call` = request + bank answer, `audit` = hash-chained audit row, `check` = expectation + result, `summary` = state before/after and the chain's head hash (anchor: a deleted tail would no longer match it).

Generated 2026-10-20T18:08:18 · mode `templates`

| Run | What it shows | Result | File | Check lines | Chain | Head hash |
|---|---|---|---|---|---|---|
| E02 Procurement forecast + cash gap | history, calendar row, range, gap, assumptions; nothing executed | 6/6 ✓ | [E02.jsonl](E02.jsonl) | L4-L9 | ✓ 2 rows | `9bee32dfdcabf0fd…` |
| E04 Pay Old Li 200 | payee, read-back, confirm, balance before -> after, no token replay | 6/6 ✓ | [E04.jsonl](E04.jsonl) | L5-L16 | ✓ 5 rows | `8b97345725f6f70e…` |
| E05 Daily total crosses 1,000 | running total, red, PIN + co-sign, executed | 6/6 ✓ | [E05.jsonl](E05.jsonl) | L12-L29 | ✓ 10 rows | `bf6693d49afeab5e…` |
| E06 New payee / tier raising | new payee red + reason; a yellow reserve raised to red (>50% balance) | 5/5 ✓ | [E06.jsonl](E06.jsonl) | L5-L26 | ✓ 9 rows | `bffed79e7d4fe55a…` |
| E07 Sales record: import + payout matching | import, idempotent re-import, statement, reconcile gap | 6/6 ✓ | [E07.jsonl](E07.jsonl) | L6-L16 | ✓ 5 rows | `08b5970f46ca4b7f…` |
| E08 S6 chain: interrupt, partial and full rollback | plan, approvals, pause, loan undone only, then all undone | 10/10 ✓ | [E08.jsonl](E08.jsonl) | L12-L62 | ✓ 37 rows | `d257745a0b492520…` |
| E09 Injection in a platform order note | flagged, lock, no action created, normal note passes | 6/6 ✓ | [E09.jsonl](E09.jsonl) | L6-L14 | ✓ 5 rows | `4ca40a2bb7fc9254…` |
| E10 Safety lock (3 bad PINs) | lock, yellow/red refused, green allowed, unlock needs co-signer | 8/8 ✓ | [E10.jsonl](E10.jsonl) | L16-L38 | ✓ 11 rows | `a37066cefebec0fe…` |
| E11 Hallucinated number blocked | grounding checker rejects, one regeneration, read-back verbatim | 5/5 ✓ | [E11.jsonl](E11.jsonl) | L14-L18 | ✓ 10 rows | `bbeb36f2be0b71a6…` |
| E12 Human takeover | handover record with plan state; nothing runs after | 5/5 ✓ | [E12.jsonl](E12.jsonl) | L32-L38 | ✓ 22 rows | `a77a4171fcba9091…` |
| E13 Declines and timeouts | decline and 5-minute expiry: nothing executed, state unchanged | 5/5 ✓ | [E13.jsonl](E13.jsonl) | L15-L34 | ✓ 12 rows | `0855332063909c7b…` |
| E14 Compliance check + structure table | flags with rule ids, cells with citations, wording check | 7/7 ✓ | [E14.jsonl](E14.jsonl) | L4-L12 | ✓ 3 rows | `1a89855edbb4609b…` |
| E15 Policy match + pre-fill | rules met, subsidised cost, pre-fill yellow, submit refused without red | 9/9 ✓ | [E15.jsonl](E15.jsonl) | L4-L24 | ✓ 8 rows | `441abdc90c6695ee…` |
| E16 New supplier payment | new payee + daily total, PIN + co-sign, balance before -> after | 4/4 ✓ | [E16.jsonl](E16.jsonl) | L5-L20 | ✓ 7 rows | `e8ea3040aab1defb…` |
| X01 Audit chain tamper detection | edit one stored row: /audit/verify names that row; restore: ok again | 4/4 ✓ | [X01.jsonl](X01.jsonl) | L10-L17 | ✓ 4 rows | `b20b52b5d9b2985f…` |

Line numbers are 1-based lines in the JSONL file.
