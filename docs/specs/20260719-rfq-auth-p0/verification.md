# RFQ authentication P0 verification

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
