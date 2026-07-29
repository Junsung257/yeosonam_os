# Agent Runtime Hardening Plan

1. Encode approval TTL, request-scope timeout, and stale-trace policy as pure,
   deterministic lifecycle rules.
2. Add bounded, idempotent housekeeping around the existing agent executor cron.
3. Repair QA V1/V2 and Jarvis stream ordering so terminal persistence precedes
   response completion.
4. Remove the unused approval-decision endpoint that cannot resume a persisted run.
5. Add regression tests for lifecycle policy, stream completion ordering,
   approval fail-closed behavior, and housekeeping integration.
6. Update the agent office SSOT and verification evidence.
7. Run focused tests, AI readiness gates, type-check, lint, build, and production
   smoke checks.

## Rollback

Revert the scoped application commit. Housekeeping only moves already stale agent
metadata to terminal states; those historical status corrections are intentionally
not automatically reversed.
