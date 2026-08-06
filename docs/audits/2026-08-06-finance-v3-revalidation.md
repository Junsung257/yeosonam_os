# Finance Settlement Center V3 Revalidation Audit

Date: 2026-08-06 KST

Status: production schema and application deployed; authenticated Chrome verification pending browser-extension tab control.

This file is historical evidence. Current operating rules remain in `docs/settlement-current-ssot.md`.

## Release Evidence

- Pull request: `#1073`
- Production application commit: `4989f16c747199952742ea8a28217eae916ae535`
- Vercel production deployment: `dpl_4Mmu8PJbR4MAnsyqcPKzoGQcefGa`
- Vercel state: `READY`
- Supabase project: `ixaxnvbmhzjvupissmly`
- Production migration: `finance_settlement_center_v3_revalidation`
- Production index replay migration: `finance_review_reviewer_index_replay`

## Implemented Controls

- Clobe Shinhan 4128 transactions remain the bank source of truth.
- A bank transaction can be split across booking, refund, fee, company expense, travel, tax, capital, transfer, owner draw, other income, and unassigned targets.
- Active allocations cannot exceed the source transaction amount; confirmed breakdowns must equal it exactly.
- Booking settlement requires an explicit owner review decision. Positive margin is not auto-confirmed.
- A transaction, memo, allocation, booking status, or departure-date change invalidates the prior review fingerprint.
- Monthly close requires reviewed bookings and preserves immutable legacy snapshots.
- Cancelled, invalid, and test bookings are excluded from finance and tax reporting without hard deletion.
- Legacy Slack/SMS records remain evidence only and do not participate in finance calculations.

## Production Reconciliation

Snapshot after migration and audited corrections:

| Check | Result |
|---|---:|
| Active Shinhan 4128 transactions | 465 |
| Total deposits | 156,956,220 KRW |
| Total withdrawals | 140,384,336 KRW |
| Calculated balance | 16,571,884 KRW |
| Over-allocated source transactions | 0 |
| Legacy periods marked for revalidation | 6 |
| Preserved legacy period items | 48 |
| Pending real bookings after BK-0126 cancellation review | 80 |
| Quarantined BK-0080 through BK-0090 tests | 11 |

The migration created 81 pending reviews containing all 48 legacy auto-confirmed items plus other active real bookings. BK-0126 was then reviewed as a customer cancellation, leaving 80 pending. This intentionally prevents unreviewed profit from becoming confirmed or spendable.

The calculated 16,571,884 KRW balance exactly matches the latest Clobe transaction's `balance_after` value.

## Clobe Sync Verification

- The scheduled sync completed successfully at 2026-08-06 04:14:49 KST with 129 source and 129 recognized transactions, 2 matches, and 0 errors.
- BK-0131 Lee Nayoon contains all three memo-keyed transactions: deposit 1,238,000 and withdrawals 9,100 plus 990,100 KRW. Its pending cash margin is 238,800 KRW.
- BK-0133 Lee Jiyeon was automatically created or matched from the `260824_이지연_투어코코넛` memo and currently contains the 800,000 KRW deposit.
- Both bookings remain pending owner review; synchronization did not auto-confirm their profit.

## Case Verification

| Case | Verified result |
|---|---|
| BK-0017 Kim Areumsongi | Deposit 719,000; travel withdrawal 660,100; cash margin 58,900 KRW |
| BK-0124 Changwon University | Deposit 13,550,000; travel withdrawal 11,640,500; cash margin 1,909,500 KRW |
| 9,140,000 KRW mixed transfer | Split into Changwon University 7,640,000 and Kim Doyeon refund 1,500,000 KRW |
| Kim Doyeon cancellation | Deposit 1,500,000 and refund 1,500,000; net 0 KRW |
| BK-0126 Lee Seongsun | Customer refund 600,000; bank fee 500; booking cash result 0 KRW; finance excluded |
| BK-0018 Kim Bongja | Invalid booking, finance excluded and recoverable |
| BK-0109 Hwang Jihyeon | Pending owner choice: owner draw or company travel |
| BK-0110 Park Junseong | Pending owner choice: owner draw or company travel |

## Automated Verification

- Production build passed for all 387 pages and API routes.
- Test suite passed: 648 files and 5,016 tests.
- TypeScript, ESLint, migration safety, dependency, security, bundle, visual-regression, and readiness checks passed.
- The migration compiled from a clean production-schema dump before production application.
- Post-DDL Supabase security advisors reported no finance-related findings.
- Post-DDL performance advisors found one missing reviewer foreign-key index. It was created concurrently and verified valid on production before the replay-safe migration `20260806041405_finance_review_reviewer_index_replay.sql` was recorded.
- Newly deployed settlement-period unused-index notices are expected until production query history accumulates.

## Manual Browser Checklist

The logged-in Chrome tab was discovered, but extension control of that existing tab did not complete. The extension, native host, selected profile, and Chrome process checks all passed. Complete the following before marking this audit final:

- Finance home totals and drill-downs
- Clobe sync and memo-change counts
- Booking detail drawers for BK-0017, BK-0124, and BK-0126
- BK-0080 through BK-0090 absence from normal finance and tax views
- BK-0109 and BK-0110 pending owner-classification state
- June and July revalidation close flow
- Company expense memo and 500 KRW bank-fee display
- Tax common-ledger values and cancellation/test exclusions
- Legacy route compatibility for payments, ledger, and tax
- Console, network, runtime, mobile 390 px, and desktop 1440 px checks
