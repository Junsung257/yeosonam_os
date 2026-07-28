# Verification

## Required Evidence

| Check | Command or proof | Result |
|---|---|---|
| Focused tests | `npx vitest run` for projection, page, admin API, and approval boundary | PASS - 4 files, 17 tests |
| Full test suite | `npm test` | PASS - 602 files, 4,689 tests |
| Type safety | `npm run type-check` | PASS |
| Full lint | `npm run lint` | PASS - zero warnings |
| Production build | `npm run build` | PASS - `/admin/agent-mas` 10.5 kB, 115 kB first load |
| Bundle budget | `npm run check:bundle:ci` | PASS - all 256 routes under budget |
| Dependency audit | `npm ci` audit | PASS - 0 vulnerabilities |
| Agent risk rules | `npm run audit:agent-patterns` | PASS |
| Admin dashboard rules | `npm run audit:admin-dashboard` | PASS - 8/8 live contract checks |
| PII surface | `npm run audit:pii-surface:strict` | PASS - 0 strict blockers |
| Sensitive API guards | `npm run audit:sensitive-api-guards` | PASS |
| Agent workflow packet | `node scripts/check-agent-workflow-contract.mjs --strict` | FEATURE PASS; repository still has 3 pre-existing feature packets missing `plan.md` |
| Patch integrity | `git diff --check origin/main...HEAD` | PASS |
| Admin API boundary | route test rejects unauthenticated access before DB use and enforces `private, no-store` | PASS |
| API behavior | authenticated local `GET /api/admin/agent/office` | PASS — 200, no source issues, autonomous loop false |
| Desktop layout | Playwright/Chrome at 1440 x 1000 | PASS - loaded data, no overlay or console errors |
| Mobile layout | Playwright/Chrome at 390 x 844 | PASS - no overlay, console errors, or horizontal overflow |
| Projection privacy | projection test removes raw reason/message and masks phone/email | PASS |

## Manual Gates

- Remote Supabase migrations: not required and not authorized.
- Background autonomous execution: not included.
- Production deploy: requested in the follow-up release task; record deployment proof
  after the clean branch is promoted.
- Booking, money, customer, or external publishing mutations: not included.

## Known Baseline

- The working tree contains unrelated in-progress changes.
- `npm run audit:agent-patterns` currently reports unrelated direct JSON responses in
  `src/app/api/admin/products/source-drift/route.ts`; this feature must not modify or
  conceal those findings.
- The authenticated local snapshot returned the bounded current window: tasks 240,
  approvals 27, incidents 126, traces 320, workrooms 24, source issues 0.
- Freshness analysis corrected the misleading stored state: active workrooms 0,
  stale workrooms 5, pending approvals 27, overdue approvals 27, and latest task age
  about 1,402 hours.
- The live payload contains redacted `safeReason` and `safeMessage` fields but does
  not expose raw approval `reason`, raw incident `message`, or task context.
- Browser evidence was captured after data load for desktop, mobile, and the
  observation-only approval tab. All 27 pending approvals displayed both
  `기한 경과` and `처리 잠금`.
