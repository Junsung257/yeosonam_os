# Public Package Egress Boundary Audit

Date: 2026-07-15

## Conclusion

The code now has a fail-closed public package read boundary, but production rollout is not complete. The database migration has not been applied or exercised in this worktree, existing packages have not been promoted through the new gate, and browser visual proof cannot be valid until those two steps happen.

This work changes the process for every future package. It does not manually repair individual products.

## Implemented Boundary

- Exact `candidate_snapshot_id` and `published_snapshot_id` pointers replace latest-snapshot lookup.
- A blocked new candidate preserves the last proven published pointer. Only an explicit revocation flag and reason can remove it.
- Snapshot content and projections are immutable per package revision and visible hash; retries may only promote lifecycle state.
- Card, detail, public API, marketing, and partner projections share one immutable snapshot and provenance.
- Customer detail, LP, A4 print, destinations, blog, package APIs, recommendations, partner/B2B APIs, influencer/meta, ads, and customer Jarvis use the central public read model.
- Missing projection, pointer, hash, schema version, or evidence digest returns no public package. There is no raw copy fallback.
- Field evidence records and deterministic quarantine candidates are persisted in the atomic snapshot transaction.
- Active unresolved quarantine blocks. Historical repaired fragments remain for audit without blocking.
- Render proofs persist `proof_input_hash` per route and surface when proof payload is available.
- Strict title claims cover no-option, no-tip, no-shopping, hotel grade, onsen, core-tour, and free-day claims.
- Ad and content drafts record source snapshot provenance. Ad publication skips stale or missing provenance.
- Both legacy and V2 customer Jarvis dispatch force the public concierge boundary.
- Public review reads require a public detail snapshot; review mutations now require admin authorization.

## Connected Database Read-Only Inventory

The local environment connection returned 917 package rows:

| Metric | Result |
|---|---:|
| Packages | 917 |
| Archived | 491 |
| Pending review | 326 |
| Pending | 100 |
| Publication blocked | 750 |
| Publication draft | 84 |
| Publication needs review | 83 |
| Public snapshots | 0 |
| Publish decisions | 833 |
| Publishable decisions | 0 |
| Legacy backfill decisions | 833 |
| Quarantined fields | 0 |

This connected project currently has no approved/published snapshot to serve. Applying the pointer migration will therefore expose zero packages until packages are reprocessed and approved. That is fail-closed behavior, but it requires an explicit rollout window and must not be deployed as an assumed no-impact migration.

## 917-Row Generation Dry Run

Read-only snapshot generation readiness, not publication approval:

| Outcome | Count |
|---|---:|
| Generated | 880 |
| Repairable | 9 |
| Blocked | 28 |

Primary evidence gaps:

| Gap | Count |
|---|---:|
| Missing usable source-backed price basis | 13 |
| Public title regeneration required | 13 |
| Missing usable DAY itinerary source | 9 |
| Unsafe customer copy | 12 |
| Itinerary reconstruction/quarantine required | 5 |
| Optional-tour reclassification required | 5 |
| Inclusion/exclusion reclassification required | 5 |

Blocked rows must remain blocked when source evidence is absent. The target is zero false publication, not zero blocked products.

## Verification Evidence

- TypeScript project check: passed.
- ESLint over `src`: passed with zero warnings.
- Public boundary, package publication, registration autopilot, approval, proof lifecycle, mixed API, review, and similar-package tests: 277 passed in the final consolidated run.
- `git diff --check`: passed.
- Next production build: no compile error was reported, but the command did not finish within the five-minute local limit. Build completion remains unverified.
- Live database actions: read-only; no package was edited.
- Local Supabase SQL lint and clean migration apply: not executed because no local PostgreSQL service, `psql`, or Docker runtime was reachable. This is a rollout blocker for claiming migration readiness.

## Remaining Release Gates

1. Start an isolated local Supabase/PostgreSQL instance and apply all migrations from a clean database.
2. Re-run SQL lint and test the atomic RPC for approved, blocked, stale-proof, quarantine, and retry/idempotency cases.
3. Deploy the migration before application code, then reprocess eligible packages through the current parser, evidence, snapshot, proof, and gate path.
4. Confirm published pointer count, active unresolved pollution count, and hard-stale proof count with production read-only queries.
5. Capture desktop/mobile browser proof for the ten golden destinations after public rows exist.
6. Add booking-time `public_snapshot_id` so historical partner booking titles remain stable even if a package is later revoked or republished. The current route uses the current partner projection and intentionally returns an empty title when no approved projection exists.
7. Build the Admin source/DB/public three-way diff and blocker explanation UI. The data foundation exists; the reviewer UI is not included in this change.

## Release Decision

Do not merge and deploy as a one-click public release yet. The code boundary is ready for review, while database application, package reprocessing, current proof generation, and visual regression remain mandatory rollout steps.
