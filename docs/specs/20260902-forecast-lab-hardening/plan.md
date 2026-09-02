# Implementation Plan: read-only Forecast Lab

## Approach

Fail closed at data boundaries, evaluate pure deterministic methods, and expose only advisory shadow rows shaped for the existing v2 table.

## Impact Areas

- Code: forecasting library, predictive marketing safety, compatibility cron and Python pipeline
- Data/API: no DB change; internal endpoint now reports data insufficiency and zero writes
- UI: none
- Docs/tests: forecasting SSOT and deterministic policy tests

## Required SSOT

- `CURRENT_STATUS.md`
- `docs/marketing-current-ssot.md`
- `docs/ai-ops-current-ssot.md`

## Data Flow

PII-free daily aggregates → validation → rolling baseline backtest → advisory report → optional v2-shaped shadow rows in memory.

## Risks And Guardrails

- Sparse data: return `data_insufficient`.
- Fake certainty: no fixed confidence or invented intervals.
- Downstream automation: zero write/publish/queue/charter authority.
- Licensing: TimesFM-3 download and use blocked.
