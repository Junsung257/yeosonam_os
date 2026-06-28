# Marketing Ad OS 95 Scorecard Verification

## Required Checks

- `npx vitest run src/lib/marketing-deep-scorecard.test.ts src/lib/ad-os-ai-director.test.ts`
- `node scripts/verify-marketing-95-scorecard.mjs`
- `npm run verify:marketing-automation -- --json`
- `npm run type-check`
- `npm run audit:api-drift`

## Acceptance

- Deep scorecard has at least 15 domains and 70 subcategories.
- Every subcategory has target score 95+.
- Every subcategory below 95 has a repair action.
- Source review seeds are at least 100 and have unique URLs.
- Safety flags keep external writes false and live spend at 0.
- Migration enables RLS and grants no anon/authenticated access.
