# Product Registration V6.1 Verification

## Safety path

- Exact freeze-manifest rows render generic HTTP 200 under-review pages.
- HTML/RSC/metadata contains no title, price, schedule, hotel, departure, hero, JSON-LD, or snapshot body.
- Manifest mismatch or pointer-version drift rejects the mutation.
- Cache invalidation covers product detail, LP, list, recommendations, sitemap, metadata, and OG.

## Authority

- Replaying the same source and operation key returns the existing job and current state.
- Ten repeated compiler runs do not duplicate product, departure, itinerary, or projection rows.
- Injected failures leave no partial committed version.
- Stale fencing tokens cannot finalize a stage attempt.
- A succeeded stage input cannot be committed twice.
- Freeze publication fails without an exact unused authorization.
- Successful publish consumes authorization, changes pointer by CAS, and clears the overlay in one transaction.

## Content and surfaces

- Price/departure rows exactly match source-backed inputs.
- `SOURCE_DECLARED_PENDING` renders only approved standard wording.
- `MISSING`, `CONFLICTING`, and `INFERRED_UNSUPPORTED` are blockers.
- Raw supplier markers and incomplete fragments never reach customer text.
- Fuzzy attractions are review candidates only.
- Package detail and LP browser proof bind to exact render hashes; listing card and A4 use deterministic parity tests.

## Rollout

- Gold set labels: `EXPECTED_PUBLISHABLE`, `EXPECTED_REVIEW_REQUIRED`, `EXPECTED_SOURCE_INCOMPLETE`, `EXPECTED_NON_PRODUCT`.
- Critical false publish: 0.
- Price/date/source-span exactness: 100% for critical facts.
- Publishable recall is measured so an all-review engine cannot pass.
- Production database changes and deployment remain a separate approval-gated runbook.

## Local implementation verification (2026-08-20)

- `npx tsc --noEmit --pretty false --incremental false`: passed.
- `npx vitest run --maxWorkers=4`: 841 test files passed; 6,343 tests passed; 7 skipped. The added files cover typed departure facts, authority read models, canonical relation review behavior, Jarvis/blog boundaries, the products-agent boundary, and the Atitaya fixture. A higher-parallelism run produced three resource-related timeouts; the bounded four-worker run is the reproducible green command.
- Skip inventory is fixed at seven legacy publication tests in `src/lib/package-publication/repository.test.ts` (lines 574, 615, 648, 690, 733, 767, 797); they exercise the retired `publish_package_snapshot_atomic` writer and are not evidence for live V6.1 atomicity.
- Changed TypeScript/TSX ESLint with `--max-warnings=0`: passed.
- V6.1 authority, customer preflight, LP fail-closed route, snapshot hygiene, atomic revision RPC, and CAS authorization focused contracts: passed.
- `npm run build` completed with exit code `0` on the integration worktree. Next compiled successfully, generated 392 static pages, and postbuild output/runtime verification passed. The build emitted only the expected sitemap warning because this process has no Supabase service-role credentials. The exact-clean-commit build gate remains `NOT_PROVEN` because the candidate changes are uncommitted.
- Release-evidence preflight: 841 files, 7 static skips, Supabase CLI/psql unavailable, Docker CLI present but daemon unavailable; strict source-integrity result remains expected exit `2` on this dirty integration worktree.

## Operational evidence still required

The source contracts prove the intended SQL/RPC shape only. They do not prove that a live PostgreSQL instance executed the transaction, lock, CAS, or rollback paths. The following remain `NOT_PROVEN` and must be attached to a clean exact-commit release bundle before P0 can close:

- failure-injection rollback for revision/domain/projection writes;
- concurrent one-time authorization consumption and pointer CAS;
- stale fencing worker rejection across every write path;
- disposable Supabase/Postgres migration rehearsal and compatibility checks;
- real `390x844` `/packages` and `/lp` browser proof, CTA, CDN/cache, and rollback evidence;
- 400-section expected-outcome gold set and shadow diff;
- complete production Next build with process exit code `0`.

## Release-candidate gate status (2026-08-20)

| Gate | Status | Evidence boundary |
|---|---|---|
| Source implementation/static contracts | PASS | TypeScript, bounded Vitest, ESLint, authority kernel scan, and diff check passed. |
| Clean exact-commit build | NOT_PROVEN | Dirty integration worktree; candidate build itself passed. |
| Migration rehearsal | NOT_RUN | No Supabase CLI/psql, daemon, or configured database credentials. |
| Atomicity failure injection | NOT_RUN | Requires live PostgreSQL transaction assertions. |
| CAS concurrency | NOT_RUN | Requires live approval/pointer rows and concurrent requests. |
| Fencing | NOT_RUN | Requires live stale-worker write attempts. |
| Multi-variant final snapshot | NOT_RUN | Parser/domain fixture separates variants; aggregate/snapshot runtime path is unproven. |
| RLS/tenant isolation | NOT_RUN | Knowledge tables are in a revoked private schema and read models/RPCs are service-role-only; the knowledge migration does not itself add RLS policies, so cross-tenant runtime assertions remain unexecuted. |
| Atitaya full E2E | NOT_RUN | Fixture-level assertions pass; intake→RPC→views→Jarvis/blog/comparison needs a database. |
| Browser proof / CTA | NOT_RUN | No protected preview or browser proof environment was used. |
| CDN/cache convergence | NOT_RUN | No preview deployment or CDN transition was exercised. |
| 400-section gold set/shadow | NOT_RUN | Corpus and live shadow execution were not run. |
| Production ready | NO | Runtime evidence gates remain open. |
| P0 closed | NO | Production DB, pointers, and deployment remain unchanged. |
