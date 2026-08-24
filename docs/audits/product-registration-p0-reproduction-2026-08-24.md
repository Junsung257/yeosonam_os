# Product Registration P0 Reproduction — 2026-08-24

Status: implementation baseline established; production remains `NO-GO`.

This report captures the common Gate 0 baseline for the product-registration/publication track and the public-catalog/trust track. All production checks were read-only. No product, pointer, snapshot, proof, environment variable, migration, deployment, or customer data was changed.

## Scope and authority baseline

Captured between 2026-08-24 16:25 and 16:36 KST.

| Authority | Observed value | Finding |
|---|---|---|
| GitHub `main` | `28fa9f5a19ad6e4bfcc5e22237b938ec234baf22` | Does not reproduce production or V6.1 |
| Production deployment | `8fae909f9911cb25d8a5e4c3470d47c4e222c5d9` | CLI deployment, not protected-main deployment |
| Production deployment ID | `dpl_BexXQ2pFVrGjcPh6fdBU3V4U5a7X` | `www.yeosonam.com` production alias |
| V6.1 authority candidate | `ce5d03dd844ad7305f6899340abfebf3211ae80e` | Clean remote tip; 59 commits ahead of `main` when captured |
| Production/V6.1 merge base | `8f0587ebf678c22ce39071978aa58793a2bb9d09` | Production-only commits must be reconciled, not assumed present |
| Integration worktree | `C:\dev\yeosonam-os-product-public-integration` | Clean worktree created from the V6.1 remote tip |

The production-only commits after the common ancestor are:

- `0e94bbe1a` — product-registration engine/parser/audit build
- `3fc7e4188` — immutable V6 proof recognition in the mobile readiness audit
- `8fae909f9` — proof binding field loading

These commits are not blindly merged. Their patches must be reconciled against V6.1 because V6.1 independently changes the same authority and proof surfaces.

The pre-existing dirty V6.1 worktree contains human-review bridge and Gold finalization evidence changes. It is user-owned and was not modified, deleted, staged, or copied into the integration branch.

## Production control state

Supabase project: `ixaxnvbmhzjvupissmly` (`ACTIVE_HEALTHY`, Seoul).

| Control | Production value | Assessment |
|---|---:|---|
| DB authority mode | `kernel` | Authority boundary active |
| DB publication freeze | `false` | Broad DB freeze is not active |
| Active kill switches | `0` | No runtime emergency block active |
| Source-proof auto-publish environment | `1` | Contrary to the intended manual-review baseline |
| V6 publish enabled | `1` | Publication path enabled |
| V6 workflow enabled | `1` | Workflow path enabled |
| V6 shadow enabled | `0` | Not shadow-only |
| V6 public reader required | `1` | Public reader guard required |
| V6 backfill enabled | `1` | Backfill path enabled |

The temporary encrypted Vercel environment snapshot used to read these eight non-secret control values was deleted immediately after inspection.

Production migrations contain the source-proof auto-publication and open-path migrations, but do not contain the four V6.1 migrations:

- `20260819235142_product_registration_v61_authority`
- `20260819235152_product_registration_v61_workflow`
- `20260819235155_product_registration_v61_surface_lineage`
- `20260820100000_product_registration_v61_knowledge_ledger`

Therefore production currently runs a pre-V6.1 database contract with an older CLI-deployed renderer while the V6.1 implementation exists only on a separate branch.

## Publication ledger snapshot

Read-only production aggregate at 2026-08-24 07:33 UTC:

| Record | Aggregate |
|---|---|
| Customer pointers | 9 `published`, 1 `blocked` |
| Published pointer/latest revision parity | 9/9 exact when joined by `catalog_product_id` |
| Public snapshots | 19 `published`, 8 `approved`, 5 `blocked`, 305 `candidate` |
| Browser proof runs | 247 `passed`, 312 `failed` |
| Convergence runs | 69 `converged`, 28 `failed`, 12 `stale` |
| Publication outbox | 60 `delivered`; no pending/failed rows at capture time |
| Revisions | 18 `verified`, 1 `approved`, 48 `candidate`, 926 `needs_review` |

An initial diagnostic joined the latest revision by legacy `package_id` and falsely classified all nine published pointers as stale because V6 revisions are keyed through `catalog_product_id`. Re-running with the authority key showed 9/9 exact latest revisions. The incorrect result is explicitly discarded.

Current production data therefore does not exhibit an already-stale published pointer. The code still needs a negative characterization test and DB fence proving that a newly-created later revision cannot be bypassed by an older proof/publication request.

## Same-time public surface reproduction

Captured at 2026-08-24 07:34–07:35 UTC.

| Surface | Observed package set | Result |
|---|---:|---|
| Home SSR | 7 distinct package detail links | Mismatch |
| `/api/packages/search` | 2 packages | Mismatch |
| Customer published pointers | 9 packages | Mismatch |
| `sitemap.xml` | `/packages` index only; 0 package detail URLs | Mismatch |
| Destination detail | HTTP 500 for `호이안-다낭` | Fail |

The two public API package IDs were:

- `5958c8cb-7d0f-4267-8ee2-7bd0f6996c20`
- `fbca42ad-50cd-4622-bde0-5dc13009e833`

The customer search API returned 49 fields per package, including internal or coupling-heavy fields such as canonical hashes, revision IDs, raw projections, terms snapshots, commercial verification structures, and internal snapshot markers. This reproduces the oversized public payload finding.

The home response is `no-store, private`, while the search API response advertises `Cache-Control: public` without a coherent catalog generation contract. The sitemap is separately generated and excludes all package detail URLs.

## Trust and runtime reproduction

- `/private-tour` publicly renders hardcoded `120+`, `24시간`, and a recent-intake feed that appears live. Code inspection confirms the feed is not a production inquiry ledger.
- The home visible H1 is still `여소남 프리미엄 패키지 여행`, which does not cover cruise, golf, and private/group travel.
- The public search package media can fall back to the Yeosonam logo as the customer hero image.
- Vercel recorded destination Server Component `DYNAMIC_SERVER_USAGE` errors through the capture time. In the prior 24 hours, the grouped clusters contained 378 and 126 occurrences on `/destinations/[city]` and its RSC route.
- The package-detail `.trim()` TypeError was observed 12 times on 2026-08-18. It was not observed as a current-day recurrence, but the unsafe code path remains a required characterization test.
- Historical registration failures include exhausted retries, browser proof failures, statement timeouts, memory exhaustion, and terminal fencing conflicts. They are evidence for bounded retries, error taxonomy, and compensating convergence behavior.

## Static findings classification

| Finding | Status | Evidence |
|---|---|---|
| Admin approval/bulk approval UI calls retired APIs | `REPRODUCED` | `/api/packages` mutations and `/api/packages/[id]/approve` return 410 while buttons remain |
| `approved` accepted by customer/external readers | `REPRODUCED` | shared customer state helper and advertising, recommendation, QA, influencer, and tracking readers |
| Missing exact pointer/snapshot fails closed everywhere | `PARTIAL` | V6 detail/LP reader is strict; list, marketing, recommendation, and sitemap paths are not unified |
| Current published pointer is stale | `NOT_REPRODUCED` | 9/9 pointers match latest catalog revision |
| Latest-revision DB fencing is complete | `REPRODUCED` as a gap | current CAS validates exact requested lineage but does not prove the request revision is latest at commit time |
| Channel pointer bundle is atomic | `NOT_REPRODUCED` | workflow publishes channels in a loop |
| Canary failure compensates pointer state | `NOT_REPRODUCED` | convergence failure throws after publication without transitioning the pointer |
| Compatibility price projection is fully atomic | `NOT_REPRODUCED` | inner projection writes `products` and `travel_packages`; `product_prices` is not replaced in the same commercial transaction |
| V6 copy is an AI rewrite | `NOT_REPRODUCED` | current policy is deterministic `facts-template-only-v6` |
| Production auto-publication is off | `NOT_REPRODUCED` | production environment value is `1`; V6.1 candidate code hardcodes the workflow option to false |
| Home/API/pointer/sitemap package sets agree | `NOT_REPRODUCED` | observed 7/2/9/0 |
| Destination SSR is stable | `NOT_REPRODUCED` | live 500 and current runtime errors |
| Public API uses a minimal customer DTO | `NOT_REPRODUCED` | 49-field payload |
| Trust feed/numbers are evidence-backed | `NOT_REPRODUCED` | hardcoded public claims and mock feed |

## Fixed baseline sample matrix

The following five samples remain the required deterministic replay matrix:

1. Danang 3 nights/4 days, normal single product
2. Danang 3 nights/5 days, normal single product
3. Multi-product source with a shared price table
4. Blocking source containing internal phone/account/operator data, uncertain price, and unmatched attractions
5. Image-heavy HWP/PDF requiring OCR

Existing audit artifacts prove prior real HWP and mobile-proof runs, but these exact five samples were not replayed against the same release manifest in this Gate 0 because production writes and broad backfill were prohibited and the frozen blind-review source set is incomplete. Classification: `LIVE_STATE_UNVERIFIED` for the exact five-sample end-to-end matrix. Local isolated replay is a release verification task, not permission to mutate production.

## Gate 0 decision

```text
STATIC FINDINGS REPRODUCED: YES
BASELINE SAMPLE RUNS: PARTIAL / EXACT FIVE-SAMPLE REPLAY PENDING
PRODUCTION WRITES: 0
AUTO-PUBLISH: ON IN CURRENT PRODUCTION; OFF IN V6.1 CANDIDATE CODE
P0 IMPLEMENTATION READY: YES, WITH FAIL-CLOSED RELEASE GATE
PRODUCTION READY: NO
```

Implementation may proceed in the clean integration worktree. No production migration, environment change, pointer mutation, bulk repair, deployment, or search-engine reindex request is authorized by this report.
