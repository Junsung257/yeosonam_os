# Feature Spec: read-only Forecast Lab

## Goal

Replace fabricated predictive signals with deterministic, PII-free, read-only backtesting while preserving existing table compatibility and blocking commercial TimesFM-3 use.

## Success Criteria

- [x] No fourth forecast table or DB migration is introduced.
- [x] `demand_forecast_v2` is the shadow shape; both legacy tables are read-only.
- [x] Forecast Lab requires 180 daily points, 8 cutoffs, and metric values on 60 distinct dates for segment eligibility.
- [x] WAPE, MAE, and sMAPE compare 7/28 seasonal naive, moving averages, and exponential smoothing deterministically.
- [x] Predictive random series, fake confidence, legacy writes, and content auto-queue are disabled.
- [x] TimesFM-3 is pinned as `license_blocked` without downloading weights.
- [ ] A real PII-free 180-day aggregate and important-segment backtest are supplied.

## In Scope

- Pure Forecast Lab, compatibility route, legacy write block, policy manifest, tests, and SSOT.

## Out Of Scope

- New tables, production data export, model weights, advertising/charter/content actions, provider changes, and UI.

## Users And Risks

- Primary audience: analytics and management reviewers
- Risk tier: Tier 2
- Sensitive surfaces: aggregated booking and inquiry counts

## Open Questions

- [x] No model candidate is selected until real data passes the frozen baseline gate.
