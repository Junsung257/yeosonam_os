# Verification: external tool safety foundation

## Automated Checks

```bash
npm run check:agent-surfaces
npm run check:agent-surfaces -- --spec 20260902-external-tool-foundation --agent foundation-owner --base origin/main
npm run check:external-skill-sources
npm run check:agent-skill-sync
npm run test:harness-audit
npm run check:harness
```

## Manual QA

- [x] No production, credential, external publish, or global agent config mutation is in scope.

## Evidence To Report

- Test output: `review.md`
- API response: none
- DB/schema check: none
- Screenshot/browser proof: none
- Audit/eval/readiness result: `review.md`

## Approval Gates

- [x] No production money, booking, PII, credential, DB migration, or external publishing mutation is performed.
