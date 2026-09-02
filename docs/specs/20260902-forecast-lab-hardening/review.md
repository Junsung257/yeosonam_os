# Forecast Lab review

## Evidence

- [x] Existing tables confirmed: `demand_forecast`, `demand_forecasts`, `demand_forecast_v2`; no migration added.
- [x] Marketing SSOT records the observed-data and downstream-mutation boundary changed by predictive marketing hardening.
- [x] Forecast and predictive safety tests pass 9/9.
- [x] Policy checker rejects random series, fixed confidence, legacy writers, downstream auto-queue, and unblocked TimesFM-3.
- [x] Forecast core passes a standalone strict TypeScript check and all changed TypeScript files pass targeted ESLint.
- [x] Python legacy pipeline passes an AST parse after the write boundary change.
- [x] Full `check:harness` passes: document audit 0 findings, deterministic contracts 30/30, harness tests 20/20.
- [x] Official TimesFM repository states source and weights through 2.5 are Apache-2.0 while 3.0 weights use the separate non-commercial license.

## Remaining risk

- [x] No live data was read or exported; actual data quality and candidate accuracy remain unproven.
- [x] The old cron now returns `data_insufficient`, so no fresh v2 rows are created until an approved aggregate exists.
- [x] `persistInsights` remains a manual existing insight-ledger helper, but the forecast route does not call it and the content auto-queue boundary always returns disabled.
- [x] A full repository `tsc --noEmit --incremental false` attempt exceeded the existing 4 GB Node heap. This PR therefore reports the passing targeted strict check, targeted ESLint, Vitest, and repository harness instead of claiming a full type-check pass.
