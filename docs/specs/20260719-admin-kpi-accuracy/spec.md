# Admin KPI Accuracy Spec

## Goal

Make the `/admin` owner dashboard safe to use at launch by removing three known accounting ambiguities: an open-ended monthly query, future departures entering recognized-month totals, and a card that subtracts all-time land payables from a current-month customer-paid amount.

## KPI contract

- Business date and month boundaries use `Asia/Seoul`.
- Current-month recognized totals use non-deleted, non-cancelled bookings whose `departure_date` is between the KST month start and KST today, both inclusive.
- `totalOutstanding` is the sum of each booking's non-negative outstanding balance. An overpayment on one booking must not erase another booking's receivable.
- Active bookings are operational, not revenue: all non-deleted bookings in `pending` or `confirmed` status remain counted even when their departure is in the future.
- D-7 unpaid counts use KST today through KST today + 7 days, inclusive, and only count `pending` or `confirmed` bookings with `paid_amount < total_price`.
- Monthly new-booking data groups `created_at` in KST and excludes timestamps after the request time.
- The owner card is named **booking cash balance** and uses one all-time basis: for every non-deleted booking, including cancelled bookings, `sum(paid_amount) - sum(total_paid_out)`. It is not a bank balance and does not include capital or unrelated expenses.
- Settlement receivable/payable definitions remain separate from booking cash: receivable is the non-negative unpaid customer amount on non-cancelled bookings; payable is the non-negative unpaid land cost after departure.

## Source of truth

- Fast path: `public.get_admin_dashboard_stats()`.
- Application fallback and richer KPI queries: `src/lib/db/dashboard.ts`.
- Existing unified definitions: `v_bookings_kpi`, `v_monthly_recognized_revenue`, and `v_monthly_new_bookings` in `20260428000000_v_bookings_kpi_unified_views.sql`.
- Cash evidence fields: `bookings.paid_amount`, `bookings.total_paid_out`, and generated `bookings.net_cashflow` from `20260418010000_add_cancellation_refund_columns.sql`.

The fast RPC and application fallback must return the same current-month recognized and operational counts. This change does not modify stored money, ledger evidence, booking state, or RLS.

## Acceptance criteria

1. Both fast RPC and fallback include an explicit current-month upper bound.
2. A future departure never changes recognized sales, cost, paid, outstanding, margin, or recognized booking count.
3. A future `pending` or `confirmed` booking still changes the operational active-booking count.
4. KST midnight/month boundaries do not depend on the Vercel process timezone.
5. The cash card uses all-time received and all-time paid-out amounts from the same row scope and explains that basis in the UI.
6. Direct boundary tests and type/lint checks pass.

## Out of scope

- Applying the migration to a remote Supabase project.
- Changing booking, payment, payout, refund, settlement, or ledger records.
- Redesigning the dashboard or changing unrelated KPI/chart formulas.
- Treating booking cash balance as a reconciled bank balance.
