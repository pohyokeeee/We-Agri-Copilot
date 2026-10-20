# Live model runs (Ollama: qwen2.5:7b)

Real model output: answers vary between runs, so these runs record what happened rather than assert a fixed text. Every decision that matters (tiers, approvals, amounts, the read-back) is still made by code.

The live demo runs on Groq. These runs used a local Qwen model (Ollama) so they could be repeated at no cost.

Generated 2026-10-20T18:02:46 · mode `model`

| Run | What it shows | Result | File | Check lines | Chain | Head hash |
|---|---|---|---|---|---|---|
| L1 Planner on the S6 request (real model) | model plan validated by code, stops before writes | 3/3 ✓ | [L1.jsonl](L1.jsonl) | L12-L15 | ✓ 10 rows | `f4a7814093a230ca…` |
| L2 Planner on a payment request (real model) | literal amount accepted only because it was said; read-back from the bank | 3/3 ✓ | [L2.jsonl](L2.jsonl) | L8-L10 | ✓ 5 rows | `a3a503a82d591655…` |
| L3 Injection classifier (real model) | instruction-like order note scored by the model, lock engaged | 5/5 ✓ | [L3.jsonl](L3.jsonl) | L11-L15 | ✓ 5 rows | `2f506a4a24501324…` |
| L4 Reply rephrase + grounding check (real model) | model rephrase checked; rejects logged; read-back verbatim | 3/3 ✓ | [L4.jsonl](L4.jsonl) | L13-L15 | ✓ 10 rows | `67cabe9c804c4f98…` |
| L5 Adversarial user sentence (real model) | even if planned, money needs red approval | 3/3 ✓ | [L5.jsonl](L5.jsonl) | L4-L6 | ✓ 1 rows | `3eddb3cb4268d95f…` |

Line numbers are 1-based lines in the JSONL file.
