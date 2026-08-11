# Product Registration V6 Implementation Audit

Date: 2026-08-11

## Scope

This audit records the V6 implementation baseline. The operating contract remains `docs/product-registration-current-ssot.md`.

## Verified locally

- TypeScript full type check passed after the final fail-closed and tenant-lineage changes.
- Product-registration regression suite passed: 31 files, 177 tests.
- Targeted ESLint and the strict product-registration contract check passed.
- Production build passed: 20 durable steps, 1 workflow, and 389 generated pages.
- `rhwp 0.8.2` was installed through the repository installer, not a machine-specific manual path.
- The 40 HWP files in `C:\Users\admin\Downloads\코덱스테스트` extracted 40/40.
- Extraction totals: 129 pages, 229 tables, 172,737 characters.
- Shadow normalization produced 66 product sections, 865 price rules, 3,729 itinerary items, and 602 claims.
- Critical/high evidence coverage was 100% and render contract passed 66/66.
- The pre-V6 shadow decision remained 4 candidates, 44 review, 18 blocked. This number is evidence that extraction is stable but automatic public eligibility still needs cohort proof; it is not a launch percentage.

## Verified in production Supabase

- Existing state before V6: 989 `travel_packages`, 2 customer-visible statuses, 1 published snapshot pointer.
- Existing V5 revision, claim, proof, pointer, outbox, policy, and kill-switch objects were present.
- Applied additive `product_registration_v6_automation_core` migration.
- Created private `internal_product_registration` tables for workflow stages, typed departures/transport/lodging/golf, copy revisions, shared facts, provider cost ledger, and dead letters.
- All 13 `internal_product_registration` tables have RLS enabled.
- V6 publication RPC execution is denied to `anon` and `authenticated`; `service_role` retains execution.
- The existing published pointer count remained 1 after migration.

## Not yet a customer-open approval

The implementation intentionally keeps V6 publish disabled. Production still needs a browser/CDP proof runtime and paid provider credentials/policies for OAG, Cirium, CLOVA OCR, and Google Document AI before a verified cohort can auto-publish. Missing providers fail closed; they never silently fabricate data.

The Vercel Production project is explicitly configured with V6 workflow disabled, shadow enabled, publication disabled, publication freeze enabled, the legacy reader retained, and OCR disabled. A strong proof-signing secret is installed. These settings protect the current customer surface until a preview/canary deployment has real Chrome proof and provider credentials.

The repository/remote migration history contains substantial historical drift predating V6. The V6 migration is stored locally and applied remotely, but the older migration ledger still needs a separate non-destructive reconciliation. This does not authorize resetting production history.
