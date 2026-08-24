# Public Catalog and Trust Hardening Spec

Date: 2026-08-24

Status: implementation-ready research packet; no application, database, or production mutation has been performed

Research base: `origin/main` at `28fa9f5a19ad6e4bfcc5e22237b938ec234baf22`

## 1. Executive decision

The customer site does not need a visual rewrite. Preserve the mobile-first blue
design system and fix the authority, rendering, trust, and release boundaries
under it.

Do **not** create another generic `public_catalog_view`. Registration V5/V6.1
already has the correct authority chain:

```text
immutable source/revision
  -> exact customer publication pointer
  -> immutable published snapshot + matching browser proof
  -> active availability/visibility overlay
  -> typed departure facts
  -> public-catalog repository
  -> explicit customer DTO
  -> home / list / search / destination / sitemap / recommendations
```

The missing component is one application read contract that applies the same
discovery decision and explicit DTO on every customer surface. The current
problem is not the absence of a published snapshot; it is that each surface
adds different date, deadline, marketing, payload, and cache behavior after
reading that snapshot.

When the user later says **`개발 진행해`**, it means implement this packet's P0
catalog/trust/SSR work and P1 public information-architecture cleanup after the
active V6.1 and destination branches have settled. It does not authorize the
cruise database, booking, quote, payment, or production deployment work.

## 2. Evidence and corrected diagnosis

| Evidence | Current finding | Required conclusion |
|---|---|---|
| `src/lib/package-publication/snapshot-projection.ts` | V5 pointer-bound snapshots, active overlays, and kill switches already exist | Preserve this authority; do not read mutable `travel_packages` as a public fallback |
| `src/app/page.tsx` | `revalidate = 300` and `dynamic = 'force-dynamic'`; empty `price_dates` is treated as alive; expired deadlines can become urgency | Use one render/cache model and the central eligibility decision |
| `src/app/api/packages/search/route.ts` | Spreads the snapshot, uses `any`, returns recommendation and internal-shaped data, and repeats its own eligibility | Return an allowlisted card DTO through `apiResponse` |
| `src/app/packages/page.tsx` and `PackagesClient.tsx` | Initial list is fetched only after hydration by SWR | Server-render the first result set and use the client only for subsequent filters |
| `src/app/destinations/[city]/page.tsx` | Repeats date logic, couples page existence to product rows, and has active SSR hardening work | Merge the destination hardening stack, then read the shared catalog and allow guide-only pages |
| `src/app/sitemap.ts` | Derives destination URLs from snapshots but emits no package detail URLs | Include all and only indexable package and destination URLs from the same catalog decision |
| `src/app/packages/[id]/DetailClient.tsx` | `item.activity.trim()` assumes a nested value exists | Normalize the approved detail DTO at the server boundary and keep client rendering null-safe |
| `/private-tour` and `/group` | Both contain code-defined `MOCK_FEED`; `120+` and response-time claims are hard-coded | Remove mock activity and require evidence for numeric/service claims |
| `/about` | Placeholder representative, registration numbers, address, and a missing `/disclaimer` target | Fail closed: hide unverifiable fields and publish only owner/legal-approved facts |
| 2026-08-24 catalog audit | 7 public products; strict public-readiness PASS `0/7`; 5 have no future departure; one future product has an expired 2026-08-13 ticketing deadline and is not marketing eligible | Quarantine discovery first, then repair and re-publish products through the existing authority workflow |

The external audit evidence is currently in the concurrent workspace at
`docs/audits/2026-08-24-public-product-catalog-deep-audit`. It is an input to
implementation, not a branch to merge blindly. Re-run its inventory after all
concurrent branches land because the audit was taken against a moving workspace.

## 3. Scope

### P0 — must close before adding cruise products

- One public catalog repository and one discovery policy.
- Exact, allowlisted card/search DTOs and normalized detail DTOs.
- Server-rendered initial product list.
- Consistent home, list, API, destination, sitemap, recommendation, blog-link,
  customer-AI, and marketing eligibility.
- Expired/deadline-conflicting/non-marketing products removed from discovery.
- Destination and detail runtime regressions fixed.
- Mock social proof and placeholder legal/business claims removed.
- Metadata, canonical domain, organization copy, and structured data corrected.
- GitHub-main-to-Vercel release identity proof.

### P1 — execute after P0 contract tests pass

- Preserve the design tokens and simplify the home information architecture.
- Broaden brand positioning to package, cruise, golf, and private/group travel.
- Add evidence-backed company/trust information.
- Repair, re-proof, and re-publish currently quarantined products one by one.
- Refresh content/editor picks through the separate blog quality authority.

### Explicitly out of scope

- A full visual redesign.
- A separate cruise website.
- Adding cruise fields to the legacy package table.
- Cruise pricing, inventory, inquiry, quote, booking, terms, or AI copilot tables.
- Inventing business registration, insurance, representative, review, response
  time, popularity, or sales facts.
- Applying a migration, changing production data, deploying, submitting a
  sitemap, or requesting indexing during this research session.

## 4. Authority and vocabulary

These states are deliberately separate.

| State | Meaning |
|---|---|
| `routeAccessible` | The exact pointer/snapshot route may render to a direct visitor |
| `discoveryEligible` | The product may appear in home, list, search, destination, recommendations, blog product links, customer AI, or marketing candidate sets |
| `indexable` | The canonical detail URL may use `index,follow` and appear in the sitemap |
| `marketingEligible` | The product may be used in ads, urgency, popularity, or proactive promotion |

`routeAccessible` must never be used as a synonym for the other three. A direct
detail may remain available as a consultation-only record while being excluded
from discovery, sitemap, Product/Offer structured data, and marketing.

### 4.1 Route access

Preserve the V6.1 route-state contract when it lands:

- `PUBLIC`: resolve the exact pointer and approved snapshot.
- `UNDER_REVIEW`: render the reviewed holding state and `noindex`.
- `NOT_FOUND`: return the existing not-found boundary.
- `UNAVAILABLE`: fail closed; do not fall back to mutable product tables.

Active visibility overlays with `hidden`, or sale overlays with `closed`,
`sold_out`, or `suspended`, are not directly accessible. Active product/global
kill switches also block access.

### 4.2 Discovery eligibility

A product is discovery eligible only when every required condition passes:

1. Exact customer pointer state is `published` for `ko-KR`.
2. Pointer revision, snapshot ID, canonical revision, and snapshot hash match.
3. At least one matching browser proof is `passed`.
4. Active visibility state is `public`.
5. Active package sale state is neither `closed`, `sold_out`, nor `suspended`.
6. No active global, product, or applicable supplier kill switch blocks it.
7. The approved snapshot's `marketing_eligible` is exactly `true`.
8. At least one typed departure date is today or later in `Asia/Seoul`.
9. That departure has `pricing_state` in `PRICED | REQUEST_ONLY`.
10. That departure has `booking_state` in
    `AVAILABLE | MANUAL_CONFIRMATION_REQUIRED`.
11. That departure has `sale_state` in `available | request`.
12. A fixed ticketing deadline is absent or is today/future. A conditional
    deadline may be shown only as live-check/consultation; a conflicting or
    expired deadline is not discovery eligible.
13. Required public title, destination, customer-safe image, booking mode, and
    approved public terms sections are present.

Unknown, missing, malformed, or conflicting states fail closed. In particular,
an empty legacy `price_dates` array is **not** evidence that a product is alive.

### 4.3 Direct-only decisions

| Facts | Direct detail | Discovery/indexing | CTA |
|---|---|---|---|
| Fully eligible, priced departure | public | eligible/indexable | `상담 신청` or the approved inquiry wording |
| Valid request-only/manual-confirmation departure | public | eligible only when `marketing_eligible=true` | `현재 좌석·요금 확인` |
| Expired or conflicting deadline | public only if V6.1 route state remains `PUBLIC` | excluded/noindex | `현재 가능 여부 문의` |
| No future typed departure | public only if policy explicitly preserves archival consultation | excluded/noindex | `비슷한 상품 찾기` |
| Hidden, sold out, suspended, under review, kill-switched, proofless | hidden/holding state | excluded/noindex | none |

The implementation must encode this as pure functions with a fixed Seoul date
input. UI components must not recreate the policy.

## 5. Public contracts

### 5.1 Card DTO

The public API and all card surfaces return only this semantic shape. Exact
TypeScript names may be refined, but fields cannot be added without an egress
review.

```ts
type PublicCatalogCard = {
  id: string;
  slug: string;
  productKind: 'package' | 'golf' | 'private_group';
  title: string;
  destination: string;
  departureAirport: string | null;
  duration: {
    days: number | null;
    nights: number | null;
    label: string;
  };
  heroImage: {
    url: string;
    alt: string;
  };
  priceDisplay: {
    mode: 'confirmed' | 'live_check' | 'request_only';
    amount: number | null;
    currency: 'KRW';
    label: string;
  };
  availableDates: string[];
  badges: Array<
    'direct_flight' | 'no_shopping' | 'no_optional_tour' |
    'departure_confirmed' | 'live_check'
  >;
  bookingMode: 'standard_inquiry' | 'live_check' | 'consultation_only';
  conditions: {
    shoppingCount: number | null;
    optionalTour: 'none' | 'available' | 'unknown';
    guideDriverFee: 'included' | 'excluded' | 'mixed' | 'unknown';
  };
  contentVerifiedAt: string;
  availabilityCheckedAt: string | null;
};
```

Rules:

- Build the DTO with an allowlist. Never spread a snapshot or remove fields by
  denylist after the fact.
- `contentVerifiedAt` comes from exact snapshot/proof lineage, not request time.
- `availabilityCheckedAt` comes only from a persisted availability or price
  observation. If absent, show `예약 전 재확인`; never synthesize “방금 전”.
- An amount is shown only for a typed `PRICED` departure. Request-only and
  unresolved prices have `amount: null`.
- Badges are derived only from approved structured facts. “인기”, “활발”,
  “최근 조회”, “출발 보장”, and equivalent claims are not DTO badges without
  a separately approved metric contract.
- Customer JSON contains no revision ID, snapshot ID/hash, policy/canonical
  hash, proof payload, validation reason, parser structure, supplier cost,
  internal score row, or raw terms hierarchy.

### 5.2 Search response

`GET /api/packages/search` uses the repository and `apiResponse`:

```ts
type PublicCatalogSearchResponse = {
  data: PublicCatalogCard[];
  meta: {
    total: number;
    appliedFilters: string[];
    availableFilters: {
      destinations: string[];
      departureAirports: string[];
      months: string[];
      productKinds: string[];
    };
  };
};
```

Personalized recommendation details and scoring maps move to a separate,
customer-safe contract. They are not embedded in every search response.

### 5.3 Detail DTO

The detail route consumes an approved normalized DTO, not arbitrary
`snapshot_json` in the browser:

- `card`
- `publicSummary`
- `publicItinerary`
- `publicInclusions`
- `publicExclusions`
- `publicNotices`
- `publicTerms`
- `bookingDecision`
- `seoDecision`

Every nested string and array is normalized on the server. Missing itinerary
activity becomes a safe empty/notice state and cannot call `.trim()` in a
client component.

## 6. Surface contract

| Consumer | Allowed set | Render/API rule |
|---|---|---|
| Home product cards | `discoveryEligible` | Server Component repository read; 3–6 cards |
| `/packages` initial 12 | `discoveryEligible` | Server-rendered HTML; DTO passed to client |
| Search/filter API | `discoveryEligible` | Same repository; allowlisted DTO only |
| Destination packages | `discoveryEligible` and matching normalized destination | Destination page may still return 200 with zero products |
| Package sitemap URLs | `indexable` | Canonical detail URLs only |
| Destination sitemap URLs | indexable guide destination or at least one eligible product | Do not manufacture a product count from blog count |
| Recommendations/comparison | `discoveryEligible` | IDs originate from catalog before scoring |
| Blog product links | `discoveryEligible` | Ineligible links fall back to relevant inquiry/guide, not stale product |
| Customer AI/Jarvis | `discoveryEligible` for proactive suggestions | Direct lookups must state consultation/indexing status |
| Ads/marketing | `marketingEligible && discoveryEligible` | No urgency or Offer generation from expired deadlines |
| Detail route | `routeAccessible` | CTA and robots derive from direct decision |

The implementation must keep an egress manifest listing each consumer, owner,
projection, allowed fields, and test. A new consumer fails CI until registered.

## 7. Database and security contract

After the final V6.1 branch lands, add a **forward-only** migration. Do not edit
an already-applied V6.1 migration.

The migration must repair the V6.1 customer fact view's overlay join:

- Apply `expires_at` in the `LEFT JOIN` predicate. The draft V6.1 view currently
  applies it in `WHERE`, which can cause an expired overlay row to suppress the
  otherwise valid pointer instead of behaving as no active overlay.
- Exclude active `hidden`, `closed`, `sold_out`, and `suspended` states.
- Append availability state and observation time needed by the repository;
  do not expose them through anon/authenticated grants.
- Preserve `security_invoker = true`.
- Revoke all privileges from `public`, `anon`, and `authenticated`; grant only
  `service_role`.
- Keep supplier raw data, internal evidence, and cost fields out of any customer
  DTO even though the server repository can read the service-role view.
- Retain active kill-switch evaluation in the central repository until it is
  atomically incorporated into an audited service-role read function.
- Use the existing V6.1 departure indexes first. Run `EXPLAIN (ANALYZE, BUFFERS)`
  on staging and add an index only when evidence shows a missing lookup path.

The repository must use the server-only Supabase client. The browser never
queries the service-role views directly.

## 8. Rendering, cache, and SEO contract

- `/packages` renders the first 12 cards as server HTML. The client receives
  serializable `initialData` and takes over only for query/filter changes.
- Server Components call the repository directly; they do not call the site's
  own HTTP API.
- Every card uses a crawlable `<a href="/packages/...">`/Next `Link`.
- A page chooses one cache model. Remove combinations such as
  `force-dynamic` plus `revalidate`.
- Adopt the final V6.1 outbox invalidation for home, list, API, detail, metadata,
  and sitemap. Always invalidate a broad `product:destinations` tag; also
  invalidate old/new destination-specific tags when lineage is available, so a
  renamed product cannot remain on its former destination page.
- Dynamic cold responses must still contain useful HTML. Cache is an
  optimization, not the source of product content.
- Detail metadata, robots, canonical, Product JSON-LD, Offer availability, and
  sitemap inclusion derive from the same `seoDecision`.
- Consultation-only/direct-only products are `noindex,follow`, absent from the
  sitemap, and emit no price Offer.
- A product JSON-LD Offer is emitted only when amount, currency, availability,
  URL, and observation provenance satisfy the public contract.
- A destination with no products may show reviewed evergreen guide content,
  but must not claim a product price/count or use unsupported “direct verified”,
  response-time, or operating-history language.

## 9. Trust and legal display contract

### Immediate fail-closed changes

- Remove both `MOCK_FEED` sections. Do not relabel code-created rows as real
  activity. A clearly marked static “맞춤여행 예시” is allowed only if product
  ownership approves the wording; the default is removal.
- Remove `120+`, `24시간`, `3분 평균 응답`, `출발 보장`, and similar claims unless
  a named data source, definition, sample window, owner, and verification date
  are recorded.
- Remove placeholder representative, business/travel registration numbers,
  address, and nonexistent `/disclaimer` link.
- Replace `.co.kr` with the canonical `.com` only after the canonical origin
  test passes.

### Verified company profile

Create one reviewed public company-profile contract with:

- legal entity name, representative, business registration number;
- tourism business registration jurisdiction/number;
- business address, phone/email, service hours;
- business guarantee and liability insurance provider, policy/coverage display
  fields, validity dates, and a public proof/help link when permitted;
- `verifiedAt`, `verifiedBy`, and evidence reference kept server-side.

Missing or expired evidence hides the badge/field. It never renders a
placeholder. Actual values and policy text require business-owner/legal review;
the implementation agent must not invent them.

The privacy policy, terms, travel terms, cancellation/refund guide, and insurance
display are separate reviewed documents. Use current official guidance as a
checklist, not as permission to copy government text or generate legal promises.

## 10. P1 customer information architecture

Preserve the current spacing, blue palette, rounded cards, mobile tap targets,
1,200 px desktop width, and Kakao access. Change hierarchy and claims:

1. Header: 패키지 / 크루즈 / 해외골프 / 단독·단체 / 여행가이드 / 카카오 상담.
2. Visible H1: `부산에서 떠나는 패키지·크루즈·골프`.
3. Hero description: compare departure date, price, and included conditions;
   availability is checked again before booking.
4. Two CTAs: `여행상품 찾기`, `카카오로 문의`.
5. Hide slide counter/autoplay when only one hero exists.
6. Four business cards: package, cruise, overseas golf, private/group.
7. One `지금 확인할 수 있는 여행` section using only eligible DTOs.
8. Keep cruise as a descriptive link/empty-safe landing point until its
   independent module is approved; do not mix fake cruise inventory into cards.
9. Replace mock activity with approved real reviews later.
10. Show 3–4 reviewed/current guide posts only.
11. Show verified company/insurance information, then reviewed legal links.
12. Bottom tabs: 홈 / 상품찾기 / 실시간견적 / 카카오 / 내 여행.

## 11. Concurrency and branch prerequisites

The research snapshot found overlapping active work:

| Work | Important overlap | Rule |
|---|---|---|
| V6.1 authority branch `ce5d03dd8…` | snapshot projection, detail route, destination, outbox, migrations | Let the owning session finish; use its final landed content as the base |
| V6.1 RC2.1 branch `1eec9ad6d…` | home, package list/detail, preview guards, migrations | Reconcile with the authority branch; do not assume either divergent tip is final |
| Destination PR stack #1141/#1143, tip `2e5caedf6…` | destination SSR and malformed climate normalization | Preserve its normalizers/tests before catalog refactor |
| Closed public-egress branch `9b9c6e0aa…` | home/API/destination/sitemap/DTO concepts | Do not merge/cherry-pick; selectively recreate only manifest/test ideas on current authority |

Before implementation, fetch remote state, inspect worktrees/open PRs, confirm
patch equivalence, and rebase a fresh implementation branch on the resulting
protected `main`. If V6.1 is not on `main`, this packet is blocked rather than
allowed to recreate V6.1.

## 12. Acceptance summary

P0 is complete only when:

- All customer discovery surfaces derive IDs from the same repository decision.
- The 7 audited regression fixtures are not discoverable until individually
  repaired and re-approved.
- Expired, deadline-conflicting, non-marketing, proofless, hidden, suspended,
  sold-out, and no-future-departure products have zero discovery/sitemap/ad
  exposure.
- Initial `/packages` HTML contains its cards and canonical detail links without
  running client JavaScript.
- The card API contains only the allowlisted fields, has no `any`, and is at most
  2.5 KB uncompressed per card / 30 KB for the initial 12-card payload.
- Destination pages return 200 with malformed optional climate data and with
  zero products; no destination SSR runtime error remains.
- Detail fixtures with missing/null nested activity render without TypeError.
- Mock feeds, placeholder registrations, unsupported claims, and broken legal
  links are absent.
- Sitemap URLs and detail robots/JSON-LD decisions are identical by policy.
- A product publication/visibility event invalidates every affected surface.
- Preview and production evidence proves the deployed Git SHA; production SHA
  equals protected GitHub `main` SHA.

If the strict catalog result is empty, the correct P0 result is an honest empty
state plus inquiry CTA. Product count is recovered only through P1 source repair,
review, immutable snapshot proof, and pointer publication.

## 13. External primary references

- [Supabase database migrations](https://supabase.com/docs/guides/local-development/database-migrations)
- [Supabase local development and branching workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js Incremental Static Regeneration](https://nextjs.org/docs/app/guides/incremental-static-regeneration)
- [Vercel Git deployments](https://vercel.com/docs/git)
- [Google JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google ecommerce site structure](https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google Product structured data](https://developers.google.com/search/docs/appearance/structured-data/product-snippet)
- [Personal Information Protection Commission 2026 policy-writing guide](https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=&nttId=12018)
- [Personal Information Protection Commission travel-industry policy template](https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=G010030000&nttId=11838)
- [Ministry of Government Legislation travel contract and guarantee guidance](https://www.easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=1&cciNo=2&cnpClsNo=1&csmSeq=1662&popMenu=ov)
- [Korean travel guarantee insurance standard](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000241570)
- [Korea Fair Trade Commission standard terms list](https://www.ftc.go.kr/www/selectBbsNttList.do?bordCd=201&key=202&pageIndex=1&pageUnit=10&searchCnd=all)
