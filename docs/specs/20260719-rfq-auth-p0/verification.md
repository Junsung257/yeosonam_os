# RFQ authentication P0 verification

> Release verdict: **DRAFT / MERGE-BLOCKED** pending the coordinated JWT trust-root and tenant membership rollout prerequisites.

## Before implementation (expected RED)

Command:

```text
npx vitest run src/lib/rfq-request-auth.test.ts src/app/api/rfq/rfq-security.test.ts
```

Result: **FAIL as expected** — both suites failed to import the not-yet-created `@/lib/rfq-request-auth`. This established that the new authorization controls did not exist before implementation.

## Focused security regression

Command:

```text
npx vitest run src/lib/rfq-request-auth.test.ts src/lib/db/rfq.security.test.ts src/app/api/rfq/rfq-security.test.ts
```

Final focused result: **PASS — 3 files, 14 tests**.

Controls include:

- administrator recognition;
- verified `app_metadata.tenant_id` acceptance;
- `user_metadata` tenant spoof rejection;
- non-empty timing-safe share-token comparison;
- anonymous customer RFQ creation remains available;
- anonymous proposal/bid collection denial;
- `viewAs=admin` ignored for a share-token customer;
- share-token caller cannot spoof tenant message identity;
- body tenant mismatch denied and matching verified tenant preserved;
- cross-tenant bid/proposal access denied and proposal tenant derived from bid owner;
- authorized tenant lookup uses the service-role client, requires active status, never calls the anonymous client, and fails closed without service-role configuration;
- analysis read/mutation administrator-only;
- stored script/event-handler payloads encoded in contract HTML.

## Changed-file lint and diff integrity

Commands:

```text
npx eslint src/lib/rfq-request-auth.ts src/lib/rfq-request-auth.test.ts src/lib/db/rfq.ts src/lib/db/rfq.security.test.ts src/app/api/rfq/rfq-security.test.ts "src/app/api/rfq/[id]/messages/route.ts" "src/app/api/rfq/[id]/proposals/route.ts" "src/app/api/rfq/[id]/bid/route.ts" "src/app/api/rfq/[id]/bid/[bidId]/proposal/route.ts" "src/app/api/rfq/[id]/analyze/route.ts" "src/app/api/rfq/[id]/contract/route.ts"
git diff --check
```

Final result after the bid-state and message preauthorization adjustments: **PASS**.

## Full type-check

Command:

```text
npm run type-check
```

Final result: **PASS (exit 0)**.

Two actionable test-type failures were found and corrected before the passing run:

1. `rfq-security.test.ts`: global `RequestInit` allowed `signal: null`, while `NextRequest` expects its own non-nullable signal type. The helper now uses `ConstructorParameters<typeof NextRequest>[1]`.
2. `rfq.security.test.ts`: the service-client mock inferred a non-null return and rejected the deliberate fail-closed `null` case. The test-only one-shot null is explicitly typed without weakening production code.

Earlier 60-second and 180-second attempts ended without diagnostics during shared dependency/process contention. Their RFQ-worktree child processes were identified and terminated; no orphan RFQ `tsc` remained before the final serialized run.

## Database / runtime validation

- Remote Supabase mutations: **not run (prohibited without approval)**.
- Remote RLS closure: **not verified/fixed**; the broad `authenticated_access` policies are a documented release blocker.
- Browser end-to-end validation: **not run in this worker**.

## Security outcome

The scoped Next.js RFQ route and contract-HTML boundaries are covered by regression tests. The end-to-end RFQ security finding is **not fully closed for launch** until the out-of-scope tenant RFQ routes and broad authenticated RLS policies are remediated and verified.

## Post-review hardening verification

- Focused regression: **PASS — 3 files, 18 tests**.
- Changed-file ESLint: **PASS — 0 warnings/errors**.
- Full type-check: **PASS — exit 0, 150.8 seconds**.
- Diff integrity: **PASS**.

The added controls cover exact boolean consent, public-input/rate/duplicate defenses, an explicit service-role RFQ repository, uppercase tenant tiers, share-token reaction validation, admin-only selection, authenticated-only message writes, null message-insert failure, and private/no-store sensitive GET responses. Legitimate public RFQ creation, share reads/reactions, authenticated message writes, tenant ownership checks, and administrator operations remain covered.

Release pairing/gates: tenant ownership and RLS commit `9d3df38c` must be included and verified; bid capacity and winner selection need an atomic RPC (P1); customer self-selection stays disabled until a dedicated expiring/revocable owner-action token SSOT exists. No remote Supabase mutation was performed in this lane.

The follow-up customer regression closes the private-tour consent UI/payload gap, removes the share-page selection CTA/call, marks the PII detail response private/no-store, and validates share capability with an `id, share_token` projection before any necessary full-row read. Consent evidence persistence, atomic duplicate prevention, and mandatory distributed rate limiting remain documented P1 schema/infrastructure gates; no migration or remote mutation was created here.

The Phase-B integration follow-up replaces JWT metadata authority with verified-subject membership resolution, covering revoked, suspended, unmapped, stale-metadata, ambiguous, and cross-tenant controls. The RFQ timeout cron now uses the explicit service-role repository for expired bids, bid state, tenant reliability, and system messages. This does not make the branch independently mergeable: the separate fixed JWT trust root and the approved/provisioned membership schema must land first, followed by coordinated Phase-B smoke tests.

Phase-B focused verification: **PASS — 7 files, 31 tests**. Changed-file ESLint and diff integrity: **PASS**. Final serialized full type-check: **PASS — exit 0**. The first attempt found only an integration-test fetch mock tuple type and the corrected rerun passed cleanly.
