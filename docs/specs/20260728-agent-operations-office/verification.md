# Verification

## Required Evidence

| Check | Command or proof | Result |
|---|---|---|
| Projection unit tests | `npx vitest run src/lib/agent-office.test.ts src/app/admin/agent-mas/page.test.tsx` | PASS — 2 files, 7 tests |
| Type safety | `npm run type-check` | PASS |
| Agent risk rules | `npm run audit:agent-patterns` | FAIL - pre-existing unrelated direct JSON responses in `src/app/api/admin/products/source-drift/route.ts` |
| Admin dashboard rules | `npm run audit:admin-dashboard` | FAIL - 7 of 10 existing latency and KPI consistency checks outside this feature |
| Focused lint | `npx eslint` on the new projection, route, page, and tests | PASS |
| Patch integrity | `git diff --check` | PASS; unrelated existing CRLF warnings only |
| API behavior | authenticated local `GET /api/admin/agent/office` | PASS — 200, no source issues, autonomous loop false |
| Desktop layout | browser around 1440 x 1000 | BLOCKED — browser reached local login but local dev-session endpoint was blocked by browser client |
| Mobile layout | browser around 390 x 844 | BLOCKED — same authentication constraint |
| PII surface | projection test removes raw reason/message and masks phone/email | PASS |

## Manual Gates

- Remote Supabase migrations: not required and not authorized.
- Background autonomous execution: not included.
- Production deploy: not included unless separately requested.
- Booking, money, customer, or external publishing mutations: not included.

## Known Baseline

- The working tree contains unrelated in-progress changes.
- `npm run audit:agent-patterns` currently reports unrelated direct JSON responses in
  `src/app/api/admin/products/source-drift/route.ts`; this feature must not modify or
  conceal those findings.
- The authenticated local snapshot returned the bounded current window: tasks 240,
  approvals 27, incidents 126, traces 320, workrooms 24, source issues 0.
- The live payload contains redacted `safeReason` and `safeMessage` fields but does
  not expose raw approval `reason`, raw incident `message`, or task context.
- Static rendering tests, type checks, focused lint, and the authenticated live API
  check cover the implemented surface. No screenshot evidence is claimed while the
  local browser authentication constraint remains.
