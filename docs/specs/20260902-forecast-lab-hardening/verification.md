# Verification: read-only Forecast Lab

## Automated Checks

```bash
npm run check:forecast-lab
npx vitest run src/lib/forecast-lab.test.ts src/lib/predictive-marketing.safety.test.ts
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext src/lib/forecast-lab.ts
npx eslint src/lib/forecast-lab.ts src/lib/forecast-lab.test.ts src/lib/predictive-marketing.ts src/lib/predictive-marketing.safety.test.ts src/app/api/cron/demand-forecast/route.ts src/app/api/marketing/run-predictive/route.ts scripts/run-forecast-lab.ts
npm run generate:system-inventory
npm run check:harness
```

## Manual QA

- [x] Confirm no migration, model download, provider change, DB insert, content queue insert, charter action, or publish action was added.
- [ ] Review a real 180-day aggregate and important-segment report.

## Evidence To Report

- Test output: `review.md`
- API response: compatibility cron reports zero writes
- DB/schema check: migration count unchanged
- Live backtest: pending approved aggregate
- Full repository type-check: attempted, but the process exceeded the current 4 GB Node heap; no pass is claimed

## Approval Gates

- [x] All model outputs remain advisory and cannot mutate production.
