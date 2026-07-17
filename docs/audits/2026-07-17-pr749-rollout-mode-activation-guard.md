# PR #749 Rollout Mode Activation Guard

Date: 2026-07-17

## Verdict

`DEFAULT-OFF ACTIVATION GUARD ADDED - PRODUCTION NOT CHANGED`

This change does not mark PR #749 ready, does not deploy, and does not write to staging or production.

## Why This Exists

PR #749 introduces public package snapshots and projection-only publication paths, but the connected production database currently has no proven public snapshots or render proofs. If projection-only reads are accidentally enabled before data readiness, customer-facing package surfaces can become empty or fail closed.

The guard makes that activation explicit:

- missing `PUBLIC_PACKAGE_EGRESS_MODE` defaults to `legacy`
- unknown mode values also default to `legacy`
- `shadow` may compute or record projection diffs, but must not change customer responses
- `canary` requires an explicit package allowlist
- `enforced` is blocked unless staging evidence and production safety metrics are present

It does not add raw `travel_packages` fallback to customer projections.

## Runtime Contract

Allowed mode values:

| Mode | Meaning |
|---|---|
| `legacy` | Existing customer behavior remains the safe default. No projection-only activation is implied. |
| `shadow` | Projection work may run as a non-customer-impacting comparison path. |
| `canary` | Only package ids in `PUBLIC_PACKAGE_EGRESS_CANARY_PACKAGE_IDS` may use the projection path. |
| `enforced` | Projection-only public egress is active; raw fallback remains forbidden. |

Unknown values are treated as `legacy`.

## Enforced Mode Evidence

`PUBLIC_PACKAGE_EGRESS_MODE=enforced` is blocked unless all of these are present:

- `PUBLIC_PACKAGE_EGRESS_ACTIVATION_READY=true`
- `PUBLIC_PACKAGE_EGRESS_STAGING_GATE_ID` is set
- `PUBLIC_PACKAGE_EGRESS_SNAPSHOT_ROWS > 0`
- `PUBLIC_PACKAGE_EGRESS_GATE_PASS_SNAPSHOTS > 0`
- `PUBLIC_PACKAGE_EGRESS_FRESH_PROOFS > 0`
- `PUBLIC_PACKAGE_EGRESS_PROJECTION_COVERAGE >= 100`
- `PUBLIC_PACKAGE_EGRESS_ACTIVE_POLLUTION = 0`
- `PUBLIC_PACKAGE_EGRESS_EXTERNAL_RAW_FALLBACK = 0`
- `PUBLIC_PACKAGE_EGRESS_BLOCKED_EXPOSURE = 0`

These are intentionally environment-level release facts. They should be written only after the staging data gate and production rollout checklist have evidence.

## Verification Added

- `src/lib/public-packages/rollout-mode.ts`
- `src/lib/public-packages/rollout-mode.test.ts`
- `scripts/verify-public-package-rollout-mode.mjs`
- `npm run verify:public-package-rollout-mode`
- `npm run verify:readiness-contracts`
- `npm run build` prebuild guard

## Current Status

The local environment has no activation mode set, so the guard resolves to `legacy` and passes. Staging identity remains unverified, so enforced activation remains blocked by process and cannot be recommended.
