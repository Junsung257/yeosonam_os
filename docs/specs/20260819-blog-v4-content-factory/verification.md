# Verification

## Required Evidence

| Check | Expected proof | Result |
|---|---|---|
| Clean source baseline | branch from current `origin/main`; selected RC commits only | PASS — `codex/blog-v4-content-factory-20260819` from `28fa9f5a`; 12 selected RC commits |
| Migration contract | RLS, explicit grants, constraints, RPC fencing/idempotency | PASS — static migration contract tests and manifest hash |
| Demand materialization | verified signal creates cluster; no signal creates none | PASS — `demand.test.ts`, `materializer.test.ts` |
| Representative decision | same intent becomes material refresh | PASS — materializer fixtures |
| Package snapshot | immutable ID/revision/hash pinned; stale pointer blocked | PASS — package snapshot fixtures and publication recheck |
| Workflow durability | start/retry/resume/duplicate execution fixtures | PASS — claim/start/bind reuse, losing-fence cancellation, event idempotency contract |
| DeepSeek boundary | attempts 1-5 allowed, 6 rejected; truncation fails closed | PASS — 4 focused files, 55 tests |
| Quality routing | soft failures repair; hard factual failures never publish | PASS — orchestrator and finalization contracts |
| Publication modes | draft-only side effects 0; reviewed-only approved only | PASS — controller integration contracts |
| Portfolio limits | stages enforce 3/2, 10/6, and 30/18 | PASS — rollout/quota tests |
| Public surfaces | blocked/non-representative rows absent everywhere | PASS — full Blog public-surface suite |
| Funnel parity | admin counts equal operation-ledger fixtures | PASS — funnel/ops-summary/admin UI contracts |
| Targeted tests | V4 factory and existing V4 contracts | PASS — 18 files, 78 tests |
| Blog V4 required lane | factory, publication, eligibility, indexing, AI control-plane contracts | PASS — 38 files, 235 tests |
| Repository-wide Vitest (diagnostic) | all repository test files | 1,994/2,004 files passed, 6,334/6,352 tests passed; 11 failures are pre-existing product-registration/package-surface contracts outside Blog scope |
| Type safety | `npm run type-check` | PASS |
| Lint | targeted and repository lint | PASS — zero warnings |
| Production build | Next.js 15 production build | PASS locally on Windows — 393 static pages, 3 workflows; Linux job configured but not run without push |
| Migration dry-run | Supabase local/CI verifier without production apply | PARTIAL — exact-set verifier and synthetic contract pass; executable DB dry-run unavailable because local Docker/Supabase is absent |
| Release exact-set | allowed file/commit inventory | PASS — orchestrator and content-factory manifests, SHA-256 verified |
| Patch integrity | `git diff --check` | PASS |

## Verification Notes (2026-08-19 KST)

- `npm run build` completed on Next.js 15.5.21. Build provenance intentionally
  resolved to `missing` because local execution has no Vercel Git metadata; the
  production gate therefore remains fail-closed until runtime/build ref and SHA
  agree with the approved values.
- Static sitemap generation logged that `SUPABASE_SERVICE_ROLE_KEY` was absent,
  then completed through the existing safe fallback. No production data was read
  or written.
- `npm run audit:admin-dashboard` reached its expected authentication gate and
  could not query protected APIs without an admin cookie. UI source contracts and
  the production build passed; authenticated live parity is a later canary gate.
- `npm run check:agent-workflow:ci` reports an unrelated pre-existing product
  registration spec (`20260811-product-registration-authority-convergence`) with
  no `plan.md`. This Blog change does not modify that out-of-scope subsystem.
- No production deployment, database migration, environment mutation, content
  update, push, or PR was performed.

## Manual Production Gates

Not authorized in this implementation:

- production database migration apply;
- Vercel environment changes;
- production deployment or domain changes;
- enabling generation or live publication;
- existing content updates, merges, redirects, or deletion;
- push or PR creation.

## Promotion Evidence Required Later

Promotion must record, in order: merged main SHA, exact allowed SHA, migration
version, snapshot V4 proof, runtime/build provenance parity, ten materialized demand
clusters, three draft-only approved candidates, one reviewed-only publication,
pilot health window, ramp health window, and max-30 qualification metrics.
