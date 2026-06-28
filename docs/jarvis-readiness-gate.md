# Jarvis Readiness Gate

> Last updated: 2026-06-28

## Purpose

`verify:jarvis-readiness` is the release gate for Jarvis. It combines deterministic agent evals, RAG grounding evals, trace grading, live RAG index audit, TypeScript, Jarvis UI regression tests, and Jarvis V2 smoke tests into one pass/warn/fail score.

`verify:jarvis-all-scenarios` is the broader 95+ automation gate. It wraps the Jarvis release gate, customer inquiry readiness, Autopilot/HITL tests, the executable free-travel 100-scenario corpus, and live RAG evidence into one weighted score.

## Commands

- Local gate: `npm run verify:jarvis-readiness`
- CI gate: `npm run verify:jarvis-readiness:ci`
- JSON output: `npm run verify:jarvis-readiness -- --json`
- Fast signal without heavy child checks: `npm run verify:jarvis-readiness -- --skip-heavy`
- Free-travel 100 corpus: `npm run verify:free-travel-100-scenarios -- --json`
- All-scenario automation gate: `npm run verify:jarvis-all-scenarios -- --json`

## Admin Snapshot

`/api/admin/jarvis/readiness` returns a lightweight runtime snapshot for `/admin/jarvis`. It runs the deterministic, RAG, trace, and live RAG checks, but marks heavy release checks as `skipped` because API requests must not run TypeScript, Vitest, or smoke-test child processes.

`/api/admin/jarvis/scenario-readiness` returns the lightweight all-scenario snapshot. It includes customer inquiry and free-travel corpus evidence, but still marks heavy child-process checks as skipped. Treat the CLI command below as the source of truth before any release or one-click automation rollout:

The admin card should be treated as an operational indicator. The release source of truth remains:

```text
npm run verify:jarvis-readiness:ci
npm run verify:jarvis-all-scenarios -- --json
```

## Scoring

The gate uses a 100-point readiness model:

| Area | Points |
|---|---:|
| Deterministic Jarvis golden set | 20 |
| RAG grounding golden set | 15 |
| Trace grading golden set | 15 |
| Live RAG index audit | 15 |
| Jarvis V2 smoke tests | 10 |
| TypeScript typecheck | 15 |
| Jarvis UI/audit regression tests | 10 |

`PASS` means all hard gates passed. `WARN` means deterministic checks passed but operational evidence is incomplete, such as skipped DB audit. `FAIL` means one or more hard gates failed.

## All-Scenario 95+ Scoring

| Area | Points |
|---|---:|
| Jarvis core release gate | 40 |
| Customer inquiry automation | 20 |
| Autopilot and HITL controls | 15 |
| Free-travel 100 scenarios | 20 |
| Live RAG index | 5 |

`PASS` requires at least 95/100, no P0 free-travel failures, no blocked live RAG evidence, and passing Autopilot/HITL tests. A lightweight admin snapshot can show `CLI Required` because it does not execute child-process tests inside an API request.

## Current Evidence

Latest local result:

```text
Jarvis readiness: PASS 100/100
- PASS deterministic-golden: 20/20
- PASS rag-golden: 15/15
- PASS trace-golden: 15/15
- PASS live-rag-index: 15/15 99/100 ready
- PASS jarvis-v2-smoke: 10/10
- PASS typecheck: 15/15
- PASS ui-regression: 10/10
```

The live RAG audit still recommends one non-blocking next action:

```text
npm run audit:jarvis-rag -- --source=blog
node db/rag_reindex_all.js --source=blogs
```
