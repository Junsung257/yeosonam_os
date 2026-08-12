# Finance Operational Completion V4.1

Date: 2026-08-12

## Scope

This audit records the implementation and release checks for the selected-departure-month settlement workflow. It does not change bank allocations, booking decisions, period snapshots, classifications, or evidence statuses.

## Implemented Controls

- Workday booking review, booking risk, and month-close blocking are scoped to the selected completed departure month.
- Future, prior-omission, and undated pending bookings are separate non-blocking counts.
- Open work counts are set unions of transaction, booking-review, exception, classification, and month identifiers instead of additive stage totals.
- Workday links preserve month, status, focus mode, sort order, and return context.
- Home sync separates OAuth connection, last success, next schedule, source, recognized, new, auto-match, memo-change, re-review, and error states.
- Booking review offers a non-mutating 500/1,000 won bank-fee split preview.
- Month exceptions default to the selected month; other months remain in a collapsed section.
- Company evidence copy preserves `not_required` and presents it as no evidence check requested.
- Confirmed locked profit and provisional review cash margin are visually and mathematically separate.
- Legacy booking confirmation timestamps do not satisfy the V3 close gate. Only current closed/conditional period snapshots remove a booking from protected cash and provisional review margin.

## Automated Verification

- Finance workday tests cover selected-month scope, future booking isolation, unique overlapping action counts, and KST sync scheduling.
- Settlement tests cover exact 500/1,000 won fee suggestions, existing refunds/fees, split conservation, cancellation, and close decisions.
- Bank reality tests cover exact transaction action IDs and deduplication.
- Type checking, production build, and the finance regression suite are required before release.

## Production Integrity Gate

- Shinhan 4128 bank totals must remain: deposits 170,169,220 won, withdrawals 146,108,610 won, balance 24,060,610 won.
- Active source transaction count must remain 482.
- Allocation drift, duplicate source use, and over-allocation must all remain zero.
- User decisions and evidence statuses are compared before and after deployment and must have zero unexpected changes.

## Browser Gate

- Verify the finance home, transaction review, booking review, month close, company expense, and tax/evidence tabs in the authenticated Chrome session.
- Verify selected July scope, focused mode, ascending departure order, collapsed other-month exceptions, Korean labels, keyboard focus, desktop layout, mobile layout, and browser console errors.
- Run one idempotent Clobe sync only after the pre-deploy integrity snapshot, then compare bank totals and allocation conservation again.
