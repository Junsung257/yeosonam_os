# 2026-07-20 Launch Readiness Continuation Audit

Status: continuation evidence after the 2026-07-19 launch-readiness audit.

Scope: Git/PR hygiene, public customer surface hardening, automated readiness checks, and remaining launch blockers that can be handled without external provider approval.

## Executive status

Release posture improved, but not final GO.

- Merged P0/P1 hygiene work into `main`:
  - #795 `feat(blog): validate information writer prompt v2`
  - #824 `fix(readiness): reject package not-found pages`
  - #825 `fix(seo): safely serialize package jsonld`
  - #826 `fix(blog): keep private regeneration within time budget`
  - #827 `docs(audit): record launch readiness continuation`
  - #828 `fix(blog): preserve evidence-backed answer structure`
  - #829 `chore(deadcode): hide internal blog destination cta helper`
  - #830 `fix(blog): fill one private image shortfall`
- Updated active draft security boundary PRs against current `main`:
  - #760 RFQ tenant/persistence boundaries: draft, mergeable, checks green.
  - #761 tenant portal membership isolation: draft, mergeable, checks green.
  - #768 checkout completion payment-evidence boundary: draft, mergeable, checks green.
- Old large draft PRs remain unsafe to merge directly:
  - #749 public package egress boundary: draft, conflicting/dirty; large multi-area diff.
  - #352 marketing readiness integration: draft, very old, too large for normal GitHub diff, previous readiness failure.
- Blog private regeneration budget PRs #826 and #830 passed CI and were merged.
- Draft #831 adds a stricter Open Readiness blog-detail guard, but is intentionally not merged because it correctly exposes the current production blocker: discovered public blog slug `phuquoc-kid-friendly` renders HTTP 200 with a not-found/noindex page. This is tracked in issue #332.

## Changes completed

### Public package detail JSON-LD hardening

Public package detail used direct `JSON.stringify(pkgJsonLd)` inside an `application/ld+json` script sink. It now uses the shared `serializeJsonLdForScript` helper.

Files:

- `src/app/packages/[id]/page.tsx`
- `src/lib/json-ld-script-sinks.test.ts`

Effect:

- Removes the package detail exception from the JSON-LD sink inventory test.
- Ensures all in-scope JSON-LD script sinks under `src/app` and `src/components` require the shared script-safe serializer.

Validation:

- `npx vitest run src/lib/json-ld-script-sinks.test.ts src/lib/json-ld.test.tsx` passed.
- `npm run type-check` passed.
- `npx eslint "src/app/packages/[id]/page.tsx" "src/lib/json-ld-script-sinks.test.ts" --max-warnings=0` passed.
- PR #825 CI passed and was merged.

### Open readiness not-found guard

PR #824 was merged after fixing stale discovered probe handling and false positives caused by Next.js `notFound` boundary strings appearing in otherwise valid RSC output.

Validation evidence before merge:

- `node --check scripts/open-readiness-check.mjs` passed.
- `node --check scripts/discover-operational-readiness-inputs.mjs` passed.
- Targeted open-readiness regression passed.
- `npm run verify:operational-inputs -- --self-test ...` passed.
- `node scripts/verify-runtime-env-workflow-wiring.mjs --json` passed.
- `node scripts/verify-operational-apply-scripts.mjs --json` passed.
- `npm run verify:marketing-automation:ci` passed.
- PR CI passed and #824 was merged.

### Blog evidence and private regeneration hardening

PRs #828 and #830 were merged after CI passed.

Effects:

- The informational writer contract now preserves evidence-backed answer structure and FAQ/question headings more safely.
- Private regeneration remains bounded, but the one-image shortfall case can use a tightly limited image recovery path.
- Unused public export drift in `src/lib/blog-cta.ts` was removed by #829.

Validation:

- #828 passed Code Quality, TypeScript/Vitest, Build & Test, Next build, Security, Performance, Vercel, and Open Readiness before merge.
- #829 passed all CI checks before merge.
- #830 passed all CI checks before merge.
- Main follow-up local checks passed:
  - `npx vitest run src/lib/blog-inline-images.test.ts src/app/api/cron/blog-publisher/route.test.ts src/lib/json-ld.test.tsx src/lib/json-ld-script-sinks.test.ts`
  - `npm run verify:readiness-contracts`
  - `npm run audit:sensitive-api-guards`
  - `node scripts/audit-public-critical-pages.mjs --base https://www.yeosonam.com --json`

## Audit results from this continuation

### Green checks

- Production public critical page audit passed 6/6 after #830; package detail remains skipped because no active package URL was resolved.
- Production structured-data audit passed with 6 scanned products and zero failures during the continuation.
- Production site indexability sample passed 10/10 during the continuation.
- `npm run lint` passed earlier in the continuation after #824 fixes.
- `npm run type-check` passed after #824 and after #825.
- `npm run audit:sensitive-api-guards` passed.
- `npm run lint:secrets:all` passed.
- `npm run check:deps:circular` passed with zero errors/warnings.
- Non-attraction `<button>` missing explicit `type` scan returned zero remaining findings after the button-type PR series.

### Known incomplete or blocked checks

- `npm run test:regression` still fails across many historical ERR cases. The failures are broader than the changes in this continuation and include blog gates, destination active-view drift, package ACL expectations, and attraction-related cases.
- `npm run check:deadcode` still fails against the baseline:
  - current: 1193
  - baseline: 1029
  - new: 195
  - resolved: 31
- `npm run audit:pii-surface` exits 0 with no strict blockers, but reports a large review surface:
  - high: 275
  - medium: 786
  - low: 727
  - total: 1788
- `npm run audit:api-drift` and `npm run audit:select-cols` exited 0 locally but did not perform live DB comparison because Supabase URL/service-role env vars were not configured in the local shell.
- Full screenshot-based visual/design QA was not completed in this continuation. Do not treat this document as visual sign-off.
- Public blog list/detail inventory is not launch-ready:
  - `https://www.yeosonam.com/api/blog?limit=5` returned `posts: []`.
  - `https://www.yeosonam.com/blog` returned HTTP 200 but no crawlable `/blog/...` detail links in the server HTML.
  - Open Readiness discovered `phuquoc-kid-friendly`, but the page rendered HTTP 200 with not-found/noindex content.
  - Draft #831 is parked as the stricter guard until a real public blog slug is available and renderable.

## Risk register

| Priority | Area | Status | Recommended next action |
|---|---|---|---|
| P0 | Checkout completion evidence | Draft #768 green/mergeable | Review final product decision, undraft, merge if intended for launch. |
| P0 | Tenant/RFQ isolation | Draft #760/#761 green/mergeable | Review final product decision, undraft, merge if intended for launch. |
| P0 | Old public egress boundary | Draft #749 conflicting | Do not merge directly. Rebase/cherry-pick only the still-relevant pieces onto current `main`. |
| P1 | Blog private regeneration budget | #826 merged | Monitor next private-regeneration canary for runtime duration and output-quality parity. |
| P0 | Public blog runtime sample | Blocked; #831 draft guard proves current slug is noindex/not-found | Publish/repair a real canonical public blog post, then rerun #831 Open Readiness and merge the guard. |
| P0 | Public package inventory/sample | Blocked/skipped; public package API returned no active package URL during continuation | Select/approve a real public package and set readiness `OPEN_CHECK_PACKAGE_ID`/ref probe inputs. |
| P1 | Regression suite | Failing | Split by domain. Avoid attraction changes without the attraction SSOT workflow. |
| P1 | Dead code drift | Failing | Baseline review or remove/mark new unused exports in small domain PRs. |
| P1 | PII surface | High-volume findings, no strict blockers | Role-matrix review for admin/product-registration/ad-os raw text surfaces. |
| P2 | Visual QA | Not completed | Run browser/screenshot pass over customer, admin, checkout/RFQ, blog, and package detail flows. |

## Git notes

- `main` at latest audit continuation includes `f3e70a9d fix(blog): fill one private image shortfall (#830)`.
- Draft #831 is intentionally left open/draft with a PR comment explaining that its readiness failure is a real production data/content blocker, not a code failure.
- Root worktree `C:\dev\yeosonam-os` has separate dirty user/session changes and was intentionally not modified.
- Main audit worktree used: `C:\dev\yeosonam-os-travel-history-p1`.
