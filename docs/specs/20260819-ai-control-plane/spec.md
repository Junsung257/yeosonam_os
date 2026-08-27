# AI Control Plane P0

## Objective

Route durable blog AI calls through one explicit control point that reserves a
conservative budget before calling a provider, enforces a single retry owner,
deduplicates concurrent calls, and settles a receipt for both success and
failure.

## Scope

- DeepSeek Flash/Pro calls used by the durable blog V4 generation path.
- A provider-neutral reservation/receipt ledger with workload and candidate
  caps.
- Deterministic task registry and direct-provider-call guard script.
- A compatibility adapter for the existing `blog-ai-caller` receipt API.

## Out of scope

- Applying the migration to Supabase or changing production environment
  variables.
- Rewriting product registration, Jarvis, QA, or marketing callers in this
  change. Those callers remain on the legacy gateway until an equivalent
  adapter is tested and migrated separately.
- Provider fallback, advisor loops, or automatic model escalation in durable
  blog calls.

## Safety invariants

1. A durable blog candidate may reserve at most one Flash call and one Pro
   repair call. A retry is a provider retry owned by the control plane and does
   not create an additional reservation.
2. A duplicate idempotency key returns the existing reservation/receipt and
   never calls a provider twice.
3. Budget RPC failure blocks a paid call (fail closed).
4. Provider errors and incomplete responses still settle a receipt, including
   the deterministic caller `trace_id` for reconciliation.
5. Publication and already-approved inventory do not depend on AI budget state.
6. No model/provider fallback is permitted for `blog-production`.

## Durable records

The migration adds private service-role tables `ai_budget_buckets`,
`ai_call_reservations`, and `ai_call_receipts`, plus atomic reserve/settle/
expire/freeze RPCs. Raw prompts and article bodies are never persisted.

## Verification

- Unit tests for registry, retry ownership, cost reservation, idempotency, and
  provider failure settlement.
- Static guard rejects direct DeepSeek URL/OpenAI client construction outside
  approved provider modules.
- Migration dry-run and exact release manifest are required before apply.
