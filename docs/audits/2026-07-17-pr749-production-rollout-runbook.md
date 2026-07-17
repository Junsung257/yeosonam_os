# PR #749 Production Rollout Runbook

Date: 2026-07-17

## Verdict

`RUNBOOK ONLY - PRODUCTION NOT CHANGED`

This runbook is executable after staging gates pass. It must not be used to bypass the current verdict:

`STAGING IDENTITY NOT VERIFIED`

## Non-Negotiable Hard Gates

- Do not start production rollout while public snapshot rows are `0`.
- Do not enable projection-only customer reads unless `published_snapshot_id > 0`.
- Do not promote any package without an exact fresh proof for the same `snapshot_id`, `public_snapshot_hash`, `proof_input_hash`, route, viewport, and locale.
- Do not treat historical quarantine as a blocker, but any active unresolved pollution on a publication-eligible package is a blocker.
- Do not apply production migrations before backup/restore point confirmation.
- Do not publish if external raw fallback, blocked external exposure, stale outbound publication, or invalid `selection_only` exception is greater than `0`.

## Rollout Sequence

Activation mode is controlled by `PUBLIC_PACKAGE_EGRESS_MODE`:

- `legacy`: safe default before data readiness.
- `shadow`: projection comparison may run without changing customer responses.
- `canary`: only `PUBLIC_PACKAGE_EGRESS_CANARY_PACKAGE_IDS` may use projection reads.
- `enforced`: blocked unless `npm run verify:public-package-rollout-mode -- --json` passes with complete activation evidence.

| Step | Action | Command / Evidence | Required Input | Success Condition | Failure / Stop Condition | Data Impact |
|---|---|---|---|---|---|---|
| 1 | Confirm production backup / restore point | Supabase dashboard PITR/backup evidence or approved backup ticket | production project ref, backup timestamp | restore point is newer than the rollout start | no restore evidence | read-only |
| 2 | Reconfirm environment identity | `npm run verify:staging-identity -- --json --env-file=<prod-env>` must block; production identity is recorded separately as deny evidence | production API host, DB host, project ref | production ref/host are in denylist and not used as staging | production identity cannot be distinguished | read-only |
| 3 | Confirm staging passed | staging gate report attached to PR | staging report id | staging migration, API, snapshots, proofs, promotion, external routes, security, admin smoke, and 500-audit passed | any staging gate missing or failed | read-only |
| 4 | Review pending migrations | Supabase migration list / SQL review | migration versions | only expected additive/forward-fix migrations are pending | destructive SQL, unexpected migration, unresolved lint error | read-only |
| 5 | Apply additive migrations | approved production migration command from deployment operator | production DB access through approved channel | all migrations apply once with recorded version history | SQLSTATE error, partial apply, schema drift | write |
| 6 | Refresh API schema | PostgREST schema cache refresh evidence | production API/admin channel | projection views/RPCs are visible to service role only | table/view missing, schema cache error | write/metadata |
| 7 | Keep legacy/shadow mode | `PUBLIC_PACKAGE_EGRESS_MODE=legacy` or `shadow`; `npm run verify:public-package-rollout-mode -- --json` | feature flag / env evidence | existing public behavior remains unchanged until snapshots/proofs exist | enforced mode enabled early or canary without allowlist | read-only/config |
| 8 | Re-evaluate eligible packages | public snapshot generation dry run | service role, audit inputs | eligible package set and blockers are reported | raw evidence missing, audit query failed | read-only |
| 9 | Generate candidate snapshots | snapshot generation job in shadow mode | eligible package ids | snapshot rows > 0, gate-pass snapshots > 0 | public snapshots = 0, evidence-less claim detected | write |
| 10 | Quarantine dry-run and apply generic rules | quarantine detector report | detector version | active unresolved pollution is found and quarantined by generic rule only | manual per-product edits needed, missing audit payload | write |
| 11 | Verify pollution metrics | SQL metrics report | package state filters | active unresolved public pollution = 0, quarantined-but-active = 0, snapshot referencing quarantined candidate = 0 | any value > 0 | read-only |
| 12 | Generate render proofs | proof runner for packages/cards/blog/marketing on mobile and desktop | app build id, route config, asset manifest | exact fresh proofs > 0 and required coverage complete | stale/missing/failed proof | write |
| 13 | Promote canary allowlist | atomic promotion RPC for explicit canary package ids | canary package ids, idempotency key | published pointer > 0, duplicate pointer = 0 | non-idempotent retry, stale proof accepted, old published pointer removed by failed candidate | write |
| 14 | Browser/API canary | package, card/list, API, blog, partner, marketing route checks | canary ids | raw fallback = 0, hash mismatch = 0, stale draft publication = 0 | any raw fallback or unexpected exposure | read-only |
| 15 | Enable canary, then enforced | controlled flag change plus rollout-mode verification | canary allowlist, staging gate id, snapshot/proof/pollution/raw fallback metrics | canary packages use projections first; enforced only after activation evidence passes | error rate, missing projection, customer-visible blank, rollout-mode blocker | config/write |
| 16 | Post-deploy 500-package audit | `npm run audit:public-snapshot-generation -- --json --limit=500 --samples=80` | production-safe API env | false-generated = 0, wrong price exposure = 0, blocked external exposure = 0, raw price fallback = 0 | any P0 metric > 0 | read-only |
| 17 | Rollback or expand | rollback checklist or next canary batch | metrics and audit report | expand only after all gates remain green | any rollback trigger below | config/write |

## Rollback Triggers

- public snapshot rows return to `0` after enforced mode is enabled.
- published pointer count is `0` or duplicate current pointer is detected.
- exact fresh proof coverage drops below required route/viewport/locale coverage.
- customer route renders raw `travel_packages` title, price, summary, optional tours, itinerary, or customer notes.
- any outbound publisher uses stale snapshot hash or missing marketing projection.
- active unresolved pollution appears on an approved/published package.
- anon/authenticated can read evidence ledger, quarantine raw value, proof diagnostics, or execute promotion/quarantine/revoke RPCs.
- wrong customer price exposure, false-generated, blocked external exposure, or raw fallback is greater than `0`.

## Rollback Actions

1. Disable enforced mode and return to shadow/read-only mode.
2. Stop promotion jobs and proof writers.
3. Revoke only explicitly defective snapshots; do not clear previously proven published snapshots because a new candidate failed.
4. Keep quarantine records for forensics; do not delete polluted raw fragments without audit payload.
5. Preserve route text dumps, proof artifacts, and audit reports.
6. Open a forward-fix PR; do not patch production with ad hoc SQL unless the rollback plan explicitly requires it.

## Required Final Evidence Before Ready-for-Review

- staging identity verified
- staging migration succeeded
- staging API usable
- gate-pass snapshots > 0
- published pointer > 0
- exact fresh proofs > 0
- required projection coverage 100%
- active unresolved public pollution = 0
- quarantined-but-active = 0
- snapshot referencing quarantined candidate = 0
- invalid `selection_only` exception = 0
- external raw fallback = 0
- blocked external exposure = 0
- stale outbound publication = 0
- new public-surface security blocker = 0
- admin browser smoke passed
- 500-package audit succeeded
- false-generated = 0
- wrong price exposure = 0
- this production rollout/rollback runbook is attached to the PR
