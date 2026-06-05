# Jarvis Readiness Gate

> Last updated: 2026-06-06

## Purpose

`verify:jarvis-readiness` is the release gate for Jarvis. It combines deterministic agent evals, RAG grounding evals, trace grading, live RAG index audit, TypeScript, Jarvis UI regression tests, and Jarvis V2 smoke tests into one pass/warn/fail score.

## Commands

- Local gate: `npm run verify:jarvis-readiness`
- CI gate: `npm run verify:jarvis-readiness:ci`
- JSON output: `npm run verify:jarvis-readiness -- --json`
- Fast signal without heavy child checks: `npm run verify:jarvis-readiness -- --skip-heavy`

## Admin Snapshot

`/api/admin/jarvis/readiness` returns a lightweight runtime snapshot for `/admin/jarvis`. It runs the deterministic, RAG, trace, and live RAG checks, but marks heavy release checks as `skipped` because API requests must not run TypeScript, Vitest, or smoke-test child processes.

The admin card should be treated as an operational indicator. The release source of truth remains:

```text
npm run verify:jarvis-readiness:ci
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
