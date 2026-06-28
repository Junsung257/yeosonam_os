# Verification

Run the narrowest checks first:

```bash
npx vitest run src/lib/agent-action-registry.test.ts src/lib/jarvis/hitl.test.ts
npx tsc --noEmit -p tsconfig.jarvis-readiness.json
npm run verify:jarvis-readiness -- --json
```

If the environment permits the heavier gate:

```bash
npm run verify:jarvis-readiness:ci
```

Manual browser verification:

- `/admin/jarvis?tab=actions`
- pending action expands with decision packet, dry-run, evidence, and one-click approval controls.

## 2026-06-28 Result

- `npx vitest run src/lib/agent-action-registry.test.ts src/lib/jarvis/hitl.test.ts`: PASS, 2 files / 8 tests.
- `npx tsc --noEmit -p tsconfig.jarvis-readiness.json`: PASS.
- `npm run verify:jarvis-readiness -- --json`: PASS, 100/100, 6 Vitest files / 17 tests plus Jarvis V2 smoke.
- `npm run audit:admin-dashboard`: PASS, 8/8 checks.
- `npm run audit:sensitive-api-guards`: PASS.
