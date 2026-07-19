# Admin KPI Accuracy Plan

1. Trace the dashboard UI through API routes, the fast RPC, application fallback, unified KPI views, and booking cash schema.
2. Add the smallest forward-only migration that makes the fast RPC use KST bounds and separates recognized totals from operational counts.
3. Make the fallback query and monthly booking bounds match the same contract.
4. Return an all-time booking cash summary from the existing settlement query and consume it in the owner card without a mixed-period fallback.
5. Add deterministic KST, future-departure, outstanding, active-booking, and cash-scope tests.
6. Run focused tests, lint, type-check, migration safety checks, and diff validation.
7. Close independent-review blockers: guard every financial sub-route, bound the cashflow chart at KST today, and expose settlement load failures rather than zeroes.
