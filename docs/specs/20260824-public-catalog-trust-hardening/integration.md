# Product Registration to Public Catalog Integration Decision

Date: 2026-08-24

Status: Gates 0-4 implemented locally; Gates 5-6 require controlled data and release authorization

## 1. Decision

Run the product-registration/mobile-publication plan and the public-catalog/trust
plan as **one release program with two separately owned implementation tracks**.
Do not combine them into one large implementation spec, branch, migration, or
pull request.

```text
Shared Track 0: release authority and read-only reproduction
  |
  +-- Track A: registration and publication authority
  |     source -> revision -> typed commercial facts -> copy -> proof
  |     -> publication request -> pointer -> production canary
  |
  +-- Track B: public catalog and trust
        exact published read model -> eligibility -> DTO -> SSR/SEO
        -> home/list/destination/sitemap -> trust and information architecture
  |
Shared rollout: golden products -> cross-surface parity -> observed release
```

The tracks meet at one versioned, server-only published-product read contract.
Track A owns how an immutable revision becomes a safe published pointer. Track B
owns how that exact published result is discovered, serialized, rendered, and
indexed. A customer page never calls AI and never reconstructs registration
facts from mutable compatibility tables.

## 2. Why a monolithic merge is unsafe

The plans overlap at authority boundaries, but their failure domains are
different:

| Concern | Track A owner | Track B owner |
|---|---|---|
| Source/job/revision/evidence | yes | consume only |
| Typed departures and commercial price facts | yes | consume only |
| Copy generation and claim validation | yes | render approved copy only |
| Signed mobile proof and publication request | yes | consume status only |
| Pointer CAS, fencing, outbox claim, canary compensation | yes | declare invalidation/probe needs |
| Discovery/index/marketing decisions | no | yes |
| Customer DTO and public API payload | no | yes |
| Home/list/destination/sitemap SSR and SEO | no | yes |
| Mock claims, company evidence, navigation and home hierarchy | no | yes |

Putting these in one branch would concentrate migrations, workflow code,
customer routes, SEO, admin UI, and operations into a review unit too large to
reproduce or roll back safely. Keeping them completely independent would be
equally unsafe because they would create competing price/publication/catalog
truths. The correct unit is one program, shared gates, and stacked PRs.

## 3. Code findings that refine the submitted plan

The following findings were reproduced against `origin/main` and the current
V6.1 authority branch.

### 3.1 Keep these submitted findings

- `082c1b0f4c54a568691b791ef417195bffb3bee3` is 11 commits ahead of
  `origin/main` at `28fa9f5a19ad6e4bfcc5e22237b938ec234baf22`.
- The V6.1 branch contains that deployed lineage and later reasserts the safer
  manual one-time release-authorization path. Landing the reviewed V6.1 stack,
  rather than cherry-picking the deployed SHA in isolation, is the intended
  reconciliation path.
- `/admin/packages` still renders approve, reject, edit, delete, clone, bulk
  approve, and optimistic deployment controls while their package mutation
  routes return HTTP 410. The zombie UI finding is reproduced.
- Customer/marketing readers still contain `approved`-compatible conditions.
  The egress audit must remain a shared P0 gate.
- V6 copy generation is deterministic reuse under
  `policy: 'facts-template-only-v6'`; it is not an AI customer-language rewrite.
- The current publication CAS validates the requested revision, snapshot,
  proof, and pointer version, but does not prove that the requested revision is
  the catalog product's newest revision. Latest-revision fencing is required.
- Customer, B2B, and partner pointers are currently published in a nested loop,
  not as one channel bundle transaction.
- Required-surface convergence failure throws after the pointer has already
  been published. No current workflow path changes that pointer to
  `convergence_failed`. Compensating fail-closed transition is required. The
  pointer schema already allows `convergence_failed`; no new state is needed.
- The compatibility projection stamps lineage onto `product_prices`, but its
  inner projection function writes `products` and `travel_packages` and does
  not replace `product_prices` in the same transaction. Atomic commercial
  parity remains a real gap.

### 3.2 Change these implementation details

Do not create `product_registration_price_offers` by default. V6.1 already has
revision-bound `internal_product_registration.departure_instances` and
`price_date_overrides` with selling price, currency, pricing state, booking
state, source references, evidence, and price revision. A fourth price fact
store would recreate the problem being fixed.

Phase A2 must first extend the existing typed departure/commercial fact model
for any genuinely missing dimensions, such as passenger type, raw price kind,
mandatory local cost, surcharge, optional cost, and total required amount. Add
a child table only when normalization proves the row cardinality cannot fit the
existing departure instance without lossy JSON. Then project `products`,
`product_prices`, and `travel_packages` atomically from those facts.

Do not introduce a second publication authority. Preserve the V5/V6.1 exact
pointer/snapshot/proof chain and the revision-bound typed departure facts. The
implemented `public_catalog_view` is a service-role-only read projection over
those authorities: it cannot publish, repoint, repair, or infer missing facts.
Track B maps that projection through an application repository and allowlisted
DTO; the view itself is not a generic catalog ledger or customer-facing API.

Do not create generic `registration_runs/run_items`. Keep `upload_jobs`, V6
stage runs, immutable revisions, existing proof/publication ledgers, and expose
their combined truth through an admin-only read projection.

`published_verified` is a workflow terminal outcome, not the public pointer
state. Customer authority remains `pointer.state = 'published'` with exact
lineage and active visibility. A failed post-public canary changes the pointer
to the already-supported `convergence_failed` state and emits invalidation.

DeepSeek or another model must be called only through the existing LLM gateway.
The provider/model is runtime policy, while the immutable copy contract and
validator are the domain authority.

## 4. Shared Track 0 — one baseline, not two audits

Track 0 is read-only and produces one release manifest plus one reproduction
report for both plans.

Capture at the same timestamp:

- protected GitHub `main` SHA, deployed code SHA, Vercel deployment/build ID,
  renderer build ID, and migration head;
- authority mode, publication freeze, source-proof auto-publish flag, runtime
  publication switches, and kill switches;
- pointer, snapshot, proof, typed departure, compatibility projection,
  `product_prices`, outbox, convergence, and route-canary state;
- public ID sets for home, list, search API, destination, sitemap,
  recommendations, blog, customer AI, affiliate, and marketing;
- every active worktree, dirty path, branch tip, open PR, merge base, and patch
  equivalence relevant to V6.1, destination SSR, and public egress.

Track 0 rules:

- production writes, deployments, pointer changes, auto-publication, indexing,
  and bulk repair are zero;
- never develop from the dirty root or the dirty V6.1 worktree;
- reproduce from clean worktrees at the deployed SHA and candidate
  authoritative main;
- classify every submitted finding as `REPRODUCED`, `NOT_REPRODUCED`,
  `CODE_CHANGED`, or `LIVE_STATE_UNVERIFIED`;
- use one set of five fixed registration samples and the audited public product
  cohort; do not maintain separate sample inventories for the two tracks.

Track 0 exits only when:

```text
STATIC FINDINGS REPRODUCED: YES/NO
BASELINE SAMPLE RUNS: PASS/FAIL
PUBLIC SET INVENTORY CAPTURED: YES/NO
PRODUCTION WRITES: 0
AUTO-PUBLISH: OFF
AUTHORITATIVE MAIN CANDIDATE: <sha or BLOCKED>
IMPLEMENTATION READY: YES/NO
PRODUCTION READY: NO
```

## 5. Shared interface between tracks

Freeze this contract before either track changes customer surfaces.

### 5.1 Server-only published read envelope

The exact names may change, but the semantics may not:

```ts
type PublishedProductReadEnvelopeV2 = {
  lineage: {
    tenantId: string;
    catalogProductId: string;
    packageId: string;
    revisionId: string;
    revisionNo: number;
    sourceHash: string;
    snapshotId: string;
    snapshotHash: string;
    proofId: string;
    pointerVersion: number;
    rendererBuildId: string;
    releaseManifestHash: string;
  };
  contracts: {
    snapshotSchemaVersion: string;
    renderContractVersion: string;
    copyPolicyVersion: string;
    pricePolicyVersion: string;
  };
  publication: {
    pointerState: 'published';
    routeState: 'PUBLIC';
    customerVisibilityState: 'public';
    saleState: 'available' | 'request';
    publishedAt: string;
    availabilityCheckedAt: string | null;
  };
  customerFacts: Record<string, unknown>;
  departureFacts: Array<Record<string, unknown>>;
};
```

This envelope is service-role-only and can contain lineage needed for policy
and audit. It is never serialized to a browser. Track B maps it through an
allowlist to `PublicCatalogCard` or the normalized detail DTO.

### 5.2 Event ownership

Track A owns event creation, idempotency, database outbox claiming, leases,
retry/dead-letter behavior, and pointer compensation. Track B owns the cache
tags, routes, metadata/SEO surfaces, and convergence probes required by each
event.

Minimum events:

- pointer bundle committed;
- pointer moved to `convergence_failed`;
- pointer withdrawn/blocked;
- availability or price observation changed;
- destination changed from old value to new value.

The final names are registered in one egress/invalidation manifest. Do not add a
second outbox worker for the catalog.

### 5.3 Decision separation

Track A decides only whether the exact revision may be published. Track B
separately decides:

- `routeAccessible`;
- `discoveryEligible`;
- `indexable`;
- `marketingEligible`.

Publication success does not imply marketing or indexing. Conversely, Track B
cannot publish, repoint, rewrite, or repair a revision.

## 6. Execution sequence and gates

### Gate 0 — other-session settlement

1. Let the active V6.1, destination, and root-session work finish.
2. Preserve every dirty change before cleanup; do not delete or reset it.
3. Re-run worktree, branch, PR, patch-equivalence, and deployment inventory.
4. Create a clean integration worktree from protected `main`.

### Gate 1 — authoritative main and freeze

1. Review and land the V6.1 authority lineage that already contains the
   deployed `082c1b0f` history and later freeze/authorization hardening.
2. Land the destination SSR stack through its reviewed PR order.
3. Rebase this catalog packet onto the resulting main and refresh every
   baseline finding.
4. Keep source-proof auto-publish off and record the runtime evidence.
5. Require GitHub protected main -> CI -> Vercel as the only production path.

Exit: one reproducible SHA/migration/build manifest and no unexplained deployed
patch.

### Gate 2 — shared P0 authority safety

Track A implements, in small stacked PRs:

1. characterization tests for all retired mutation routes;
2. removal/disablement of zombie admin controls and optimistic status changes;
3. admin publication-truth projection/RPC over existing ledgers;
4. customer/external egress inventory and removal of `approved` publication
   shortcuts;
5. latest-revision and compatibility-revision fencing;
6. atomic channel pointer bundle or an explicitly narrowed single-customer
   publication contract;
7. canary compensation to `convergence_failed`, cache invalidation, and durable
   evidence;
8. corrected C13 quality/readiness separation.

Exit: no UI or API can mutate legacy publication state; stale proof cannot
publish; failed required canary is not customer-visible.

### Gate 3 — commercial and copy authority

Track A continues:

1. extend existing typed departure/commercial facts instead of creating a
   parallel price ledger;
2. project `products`, `product_prices`, and `travel_packages` in one
   transaction with parity assertions and failure-injection tests;
3. add deterministic customer facts -> gateway-mediated grounded rewrite ->
   deterministic validation -> safe fallback;
4. version the snapshot/render/copy/price contracts;
5. split registration completion from human-approved publication requests.

Exit: one revision produces one reproducible commercial/customer snapshot;
price conflict and copy evidence gaps block publication, not registration.

### Gate 4 — public catalog and trust

After the read envelope is frozen, Track B implements:

1. corrected service-role customer fact views through a forward migration;
2. pure discovery/index/marketing policy and allowlisted DTOs;
3. public-catalog repository and egress manifest;
4. server-rendered home/list, thin search API, normalized detail, destination,
   sitemap, recommendation/blog/AI/marketing consumers;
5. detail null safety, SEO/JSON-LD parity, and cache invalidation mapping;
6. removal of mock activity, unsupported counts, placeholder company facts,
   broken legal links, and unsupported trust claims;
7. the P1 navigation/home hierarchy only after P0 parity is green.

Track B may build pure policy/DTO fixtures in parallel with late Track A work,
but it may not cut over live consumers until Gate 3's envelope and versions are
stable.

### Gate 5 — one recovery lane

Do not run separate “registration legacy repair” and “catalog product repair”
projects. Maintain one repair ledger with classifications, source linkage,
revision, price/copy/proof status, pointer status, catalog eligibility, owner
decision, and canary result.

1. Re-run the production inventory at one timestamp.
2. Restore the two Da Nang golden products from source to production-like
   canary.
3. Require two deterministic runs against the same release manifest.
4. Expand supplier/document cohorts only after gates pass.
5. Never bulk-convert `approved` to `published` or bulk-enable marketing.

### Gate 6 — release and observation

1. Deploy an unaliased preview for the exact reviewed SHA.
2. Prove mobile `/packages`, `/lp`, CTA, initial HTML, API schema, sitemap,
   robots/JSON-LD, and all egress set relations.
3. Exercise freeze, kill switch, canary failure, pointer compensation, cache
   invalidation, and recovery in staging.
4. Obtain explicit approval for production migration/deployment/data repair.
5. Deploy only from protected main and prove production SHA equality.
6. Observe 4-hour and 24-hour error, public-set, and convergence gates before
   indexing requests or broader automation.

## 7. Branch, PR, and file ownership

Use one clean worktree per PR and allocate migration timestamps centrally.
Recommended stack:

| PR | Scope | Main owner |
|---|---|---|
| 0 | release manifest, characterization tests, no production behavior change | integration |
| A1 | admin truth, zombie UI retirement, approved egress removal | Track A |
| A2 | revision fencing, pointer bundle, canary compensation, outbox hardening | Track A |
| A3 | typed commercial facts and atomic three-table projection | Track A |
| A4 | grounded copy V2 and publication-request workflow | Track A |
| B1 | customer fact-view correction, catalog policy/repository/DTO | Track B |
| B2 | SSR list/search/detail/destination/sitemap and egress cutover | Track B |
| B3 | trust cleanup and current-design information architecture | Track B |
| R1 | golden product repair and controlled rollout evidence | operations |

Primary ownership:

- Track A: `src/workflows/product-registration-v6.ts`,
  `src/lib/product-registration-*`, product-registration/admin workflow routes,
  publication/price migrations, outbox claim and pointer compensation.
- Track B: `src/lib/public-catalog/**`, home/list/search/destination/sitemap,
  public DTOs, customer navigation, trust/company presentation.
- Integration-owned hot seams: `src/lib/package-publication/**`,
  `src/app/packages/[id]/page.tsx`, `src/app/layout.tsx`, migration ordering,
  outbox invalidation manifest, and release evidence.

The destination page remains owned by the destination SSR stack until that PR
lands. Track B edits the resulting file, not its older base. No track commits to
the dirty root or rewrites another session's work.

## 8. Combined completion criteria

The program is complete only when all are true:

- production SHA equals protected-main SHA and the applied migration/build
  manifest is reproducible;
- source-proof auto-publish is off until the explicit automation gate is met;
- legacy mutation UI/API cannot change publication truth;
- `approved` alone exposes zero customer/external products;
- stale revision/proof publication and channel partial publication are zero;
- canary failure immediately fails closed and leaves recoverable evidence;
- all three compatibility price stores have atomic, reproducible parity;
- customer copy contains no unsupported facts or internal information;
- home/list/search/destination/sitemap and downstream consumers use one catalog
  decision and explicit DTO;
- internal hashes, revisions, proof data, validation reasons, net price, margin,
  and supplier facts have zero public API exposure;
- `/packages` initial cards are server-rendered and detail/destination runtime
  errors are zero;
- mock feeds, unsupported counters, and placeholder trust facts are zero;
- the two golden products pass source-to-live canary twice on one final build;
- production observation gates pass before cruise implementation starts.

## 9. Immediate next command meaning

The user authorized sequential implementation on 2026-08-24 while settlement
and blog work continued in non-overlapping areas. Gates 0-4 were implemented in
the clean worktree `C:\dev\yeosonam-os-product-public-integration` on branch
`codex/product-publication-catalog-integration-20260824`, with production writes
and deployment kept at zero. The next authorized release action remains a fresh
concurrent-session reconciliation, followed by a protected PR/preview; Gates
5-6 must not be inferred from the local implementation authorization.
