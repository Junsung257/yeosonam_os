# Finance Integrity And UX Audit - 2026-08-11

## Scope

- Production Clobe OAuth MCP sync for Shinhan account ending 4128
- Bank transaction conservation and booking review persistence
- Owner safe-to-withdraw calculation
- Finance home, transaction review, booking review, period close, company expense, and tax/evidence surfaces

## Production Evidence Before Change

| Check | Result |
|---|---:|
| Active Clobe transactions | 479 |
| Deposits | 162,032,220 KRW |
| Withdrawals | 146,108,610 KRW |
| Computed balance | 15,923,610 KRW |
| Exact allocations | 479 |
| Under/over allocations | 0 / 0 |
| Current booking reviews | 93 |
| Stored/live fingerprint drift | 26 |
| Cancelled bookings still pending | 2 |
| V3 closed periods | 0 |

## Corrections

- Replaced timestamp-sensitive review fingerprints with business-evidence v4 fingerprints.
- Added service-role-only live booking review snapshots and made review APIs return the live optimistic-concurrency fingerprint.
- Preserved the pre-change queue in immutable `finance_migration_snapshots`.
- Reconciled cancelled bookings without deleting their evidence.
- Changed open-trip reserve from customer funds plus supplier payable to the per-booking maximum, preventing double protection of the same cash.
- Added explicit mobile booking review cards, detail buttons, next-pending navigation, exception identity, full Clobe company memo display, and complete tax/evidence todo states.
- Raised bounded Clobe pagination to 1,000 rows, added a fail-closed truncation guard, and changed scheduled sync to every four hours.
- Prevented the legacy review page from rendering fetch failures as valid zero values.

## Production Evidence After Database Migration

| Check | Result |
|---|---:|
| Active Clobe transactions | 479 |
| Computed balance | 15,923,610 KRW |
| Under/over allocations | 0 / 0 |
| Stored/live fingerprint drift | 0 |
| Cancelled bookings still pending | 0 |
| BK-0124 cash margin | 1,909,500 KRW |
| BK-0126 cancellation result / bank fee | 0 KRW / 500 KRW |
| Live snapshot RPC anonymous access | denied |
| Live snapshot RPC authenticated access | denied |
| Live snapshot RPC service-role access | allowed |
| New RPC security/performance advisor findings | 0 / 0 |
| Pre-change immutable snapshot | present |
| Integrity migrations applied | 2 / 2 |

## Automated Verification

- TypeScript project check: passed.
- Finance unit, contract, scheduler, loading-state, and migration-safety tests: 67 passed across 12 files.
- Changed-file ESLint: passed.
- Next.js production build: passed, including type validation, 387 static pages, server bundles, and final output verification.
- Production post-migration bank and allocation conservation: passed.

## Remaining Release Evidence

- Pull request CI result.
- Preview and production Chrome verification for all finance tabs at desktop and mobile widths.
