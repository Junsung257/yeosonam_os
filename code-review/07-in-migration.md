# Code Review: In-Migration Files (Design System V2)

**Project:** 여소남 OS (Next.js App Router B2B2C travel SaaS)
**Date:** 2026-04-26
**Scope:** files with `M` state in `git status` that are part of the in-flight design migration
**Posture:** bugs / data hazards / canonical-utility bypass only — visual / token decisions are out of scope by user request

---

## 1. Inventory

| File | LOC | State | Render |
|------|-----|-------|--------|
| `src/app/admin/bookings/page.tsx` | 2005 | M | client |
| `src/app/admin/packages/page.tsx` | 1978 | M | client |
| `src/components/admin/YeosonamA4Template.tsx` | 1677 | M | client (admin) |
| `src/app/packages/[id]/DetailClient.tsx` | 1253 | M | client |
| `src/app/api/packages/route.ts` | 666 | M | route |
| `src/app/admin/products/[id]/distribute/page.tsx` | 539 | M | client |
| `src/components/AdminLayout.tsx` | 511 | M | client |
| `src/app/admin/attractions/page.tsx` | 498 | M | client |
| `src/app/globals.css` | 271 | M | css |
| `src/app/api/tracking/route.ts` | 260 | M | route |
| `src/app/api/attractions/route.ts` | 255 | M | route |
| `src/app/admin/settlements/page.tsx` | 250 | M | client |
| `src/app/packages/[id]/page.tsx` | 244 | M | server |
| `src/components/customer/DepartureCalendar.tsx` | 242 | M | client |
| `src/components/admin/InstagramPublishModal.tsx` | 199 | M | client |
| `src/app/admin/blog/page.tsx` | 196 | M | client |
| `src/app/api/unmatched/route.ts` | 187 | M | route |
| `src/app/packages/page.tsx` | 105 | M | server |
| `src/app/api/attractions/photos/route.ts` | 90 | M | route |
| `tailwind.config.js` | 45 | M | config |
| `public/sw.js` | 1 (min) | M | service worker |
| **Total** | **~11.5K LOC** | | |

> Note: `src/app/admin/customers/**` is not in `M` state right now; the user's instruction list mentioned it, but git status shows it as untouched. Skipping unless customers admin work resumes.

---

## 2. Bugs / Crash Risks

### 2.1 CRITICAL — CRC partially adopted but NOT used downstream
- **`src/app/packages/[id]/DetailClient.tsx:231–245`** — `view = renderPackage(pkg)` is computed, but only `view.airlineHeader.airlineName` (line 245) is consumed. Everything below uses raw `pkg.*` parsing:
  - Line 233: `normalizeDays(pkg.itinerary_data)` instead of `view.days`
  - Line 985, 994: `pkg.optional_tours`, `groupOptionalToursByRegion(pkg.optional_tours)` instead of `view.optionalTours`
  - Lines 250–264: flight extraction parses `days[0].schedule` raw rather than reading the canonical flight headers from `view`
- **`src/components/admin/YeosonamA4Template.tsx:172, 175, 209`** — same pattern: `const itinerary = pkg.itinerary_data` (line 172) is captured BEFORE `renderPackage(pkg)` (line 175), and line 209 (`days = Array.isArray(itinerary) ? itinerary : (itinerary?.days || [])`) consumes the raw value. The view is computed but unused for days.
- **`src/app/packages/PackagesClient.tsx:84,248`** — list view uses `normalizeDays(pkg.itinerary_data)` and an inline `AIRLINES` map instead of `getAirlineName()` from `render-contract.ts`.

> Per CLAUDE.md `render-contract.ts` rule: "renderer는 view.* 만 소비, pkg 직접 파싱 금지 — ERR-KUL-05". The CRC migration is half-done. Severity: **Critical** (A4 ↔ Mobile divergence is exactly what CRC was created to prevent).

### 2.2 High — Booking state-machine bypass on client
- **`src/app/admin/bookings/page.tsx:1029–1040`** — `patchStatus(id, status)` PATCHes `/api/bookings` with arbitrary `status` string with **no** client-side `isValidTransition()` guard from `booking-state-machine.ts`. Buttons elsewhere can offer transitions that the server will reject; current state diverges from server until next `load()`. Add a pre-flight `ALLOWED_TRANSITIONS[currentStatus].includes(target)` check in `patchStatus` and disable invalid buttons in the row UI.

### 2.3 High — Hard DELETE on `attractions`
- **`src/app/api/attractions/route.ts:236–254`** — `DELETE /api/attractions?id=` calls `.delete().eq('id', id)`. Should be soft-delete via `is_active` toggle per CLAUDE.md §2-3. Audit trail lost; FK breakage risk on `unmatched_activities` aliases linked to deleted attractions.

### 2.4 Medium — Bulk PATCH does N sequential `fetch` calls
- **`src/app/admin/bookings/page.tsx:1078–1089`** — `handleBulkCommit` loops `for (const id of ids) await fetch('/api/bookings', PATCH ...)`. Sequential round-trips for bulk edits. Either batch on the server with a single PATCH-many endpoint or `Promise.all`/`Promise.allSettled` here.

### 2.5 Medium — Conversion postback awaited inline (blocks response)
- **`src/app/api/tracking/route.ts:217–245`** — Google Ads + Meta CAPI postbacks are `await`ed inside the request handler. If either provider is slow, the conversion 202 is delayed. Use `void fetch(...)` (fire-and-forget) like the other tracking branches, or push to a queue.

### 2.6 Medium — `/api/unmatched` POST loops RPC per row
- **`src/app/api/unmatched/route.ts:17–49`** — `for (const item of items) { await rpc(...) }` then a fallback `upsert`. Bulk landing-page calls (one item is fine; many is the risk) cause N round-trips. Switch to a single `.upsert(items, { onConflict: 'activity' })` and let the DB increment via trigger or a single RPC accepting an array.

### 2.7 Low — Fresh Supabase client per page render
- **`src/app/packages/page.tsx:40–45`** — `getSupabase()` creates a new client every call instead of using `supabaseAdmin` from `@/lib/supabase`. Wastes connections; harder to centralize tenant scoping later.

---

## 3. CRC Bypass — Detail (already counted above; consolidated for action list)

| File:Line | Symbol | Replace with |
|-----------|--------|--------------|
| `DetailClient.tsx:233` | `normalizeDays(pkg.itinerary_data)` | `view.days` (extend `CanonicalView` if missing) |
| `DetailClient.tsx:245` | `pkg.airline` fallback | `view.airlineHeader.airlineName` only |
| `DetailClient.tsx:985,994` | `pkg.optional_tours`, `groupOptionalToursByRegion(pkg.optional_tours)` | `view.optionalTours` |
| `DetailClient.tsx:250–264` | flight extraction off raw `days` | `view.flightHeader.outbound/return` |
| `YeosonamA4Template.tsx:172,209` | `itinerary = pkg.itinerary_data` then `Array.isArray(...)` | `view.days` |
| `YeosonamA4Template.tsx:381,392,417,435` | `pkg.optional_tours`, `pkg.airline` | `view.optionalTours`, `view.airlineHeader` |
| `PackagesClient.tsx:84` | `normalizeDays(pkg.itinerary_data)` | `view.days` (or list-only summary projection) |
| `PackagesClient.tsx:248` | inline `AIRLINES[pkg.airline]` map | `getAirlineName(pkg.airline)` from `render-contract.ts` |

> **Recommendation:** add the missing fields to `CanonicalView` in `src/lib/render-contract.ts` (e.g., `days`, `optionalToursByRegion`, `flightHeader.outbound/return`) and migrate all four call sites. This is the single most load-bearing fix in this split.

---

## 4. Booking State-Machine Bypass

- **`src/app/admin/bookings/page.tsx:1029–1040`** — see §2.2.
- Status buttons elsewhere in the file (around lines 1860–1990 per earlier sweep) currently don't pre-flight-check the transition; they call `patchStatus` directly. After adding the guard in `patchStatus`, also disable buttons that map to invalid targets given the row's current state.

---

## 5. FIELD_POLICY Leaks (Customer-Facing)

- **`src/app/packages/[id]/DetailClient.tsx`** — verify `pkg.special_notes` rendering: per memory `feedback_product_highlights.md` and `db/FIELD_POLICY.md`, `special_notes` historically held commission/settlement memos (ERR-FUK-customer-leaks). If any branch in `DetailClient` renders `special_notes` to customers, it must filter or be migrated to `product_summary`/`product_highlights`. (Could not confirm in the sampled lines; flag for explicit grep before regression.)
- **`src/components/admin/InstagramPublishModal.tsx`** — modal reads/edits caption text. Confirm the source field is the customer-facing copy (e.g., `product_summary` or AI-generated post body), NOT internal cost notes. If it pulls from `pkg.notes` or admin-only fields, leak risk on publish.

---

## 6. DOMPurify / Sanitization

- In-migration scope itself does not introduce new `dangerouslySetInnerHTML` (verified by grep). The pre-existing risks already flagged in Split 4 (`rfq/[id]/page.tsx:415`, `rfq/[id]/contract/page.tsx:98`, `admin/rfqs/[id]/page.tsx:475`) remain.
- Admin blog editors (`admin/blog/[id]/page.tsx:179`, `admin/blog/write/page.tsx:336`) use `previewHtml` without explicit DOMPurify in the visible chunks — verify a sanitization pass exists in the upstream `previewHtml` builder. Severity: Medium (admin-only surface, but XSS would still execute on the editing user).

---

## 7. Performance

### 7.1 `useEffect` data fetches — server candidates
- **`packages/[id]/DetailClient.tsx`** — already migrated to receive props from server `page.tsx` (good). Confirm no remaining client `useEffect(...fetch(...))`. (CLAUDE.md compliant comment exists at line 224 confirming the migration.)
- **`packages/page.tsx`** is already a server component with ISR (revalidate 300). Good.

### 7.2 Hardcoded `.limit(50)`
- **`packages/page.tsx:67`** — products list capped at 50. With the catalog growing, customer-facing top-50 hides products. Replace with cursor pagination or `range()`-driven infinite scroll on the client side (or per-month chunking).

### 7.3 PACKAGE_FIELDS over-fetch
- **`packages/page.tsx:31–38`** — list view fetches `itinerary_data`, `price_list`, `price_dates`, `price_tiers` (all heavy JSON columns) for every card. The list only needs price min/max + cover. Project a thinner field set (`price`, `price_dates_summary` if available, `display_title`, `airline`, `departure_days`) for the list and load full data on detail.

### 7.4 Attractions GET caches 60s
- **`api/attractions/route.ts:53–55`** — `Cache-Control: public, s-maxage=60, stale-while-revalidate=120`. Good for public, but the same handler is used by admin-only paths (badge filter, `?search=`). Admin pages get stale data after a CSV upload until cache expires. Either branch on `?search`/badge filter to `no-store`, or invalidate the path after `PUT /api/attractions`.

### 7.5 Bookings page is 2005 LOC, all-client
- **`admin/bookings/page.tsx`** — god component. After migration cools, decompose into `BookingsTable`, `BookingDrawer`, `StatusButtons`, `BulkBar`. (Out of scope for this PR — listed under "post-migration" refactors below.)

---

## 8. Soft-Delete / GENERATED-Column Violations

- **§2.3** — `attractions` hard delete.
- **`api/packages/route.ts`** — verify INSERT/UPDATE bodies do not include `selling_price` (DB GENERATED). The route is 666 LOC; spot-check that every `.insert(...)`/`.update(...)` uses an allowlist projection.
- **`api/tracking/route.ts:247`** — `net_profit` is calculated client-side AND comment says it's GENERATED ALWAYS in DB. The route does not pass it to `insertConversionLog`. Good.

---

## 9. API Route Hygiene (Modified Routes Only)

| Route | Auth | Validation | Idempotency | Standard envelope | Notes |
|-------|------|------------|-------------|-------------------|-------|
| `api/packages` | needs grep | mixed | partial | mixed | 666 LOC — sample-read flagged adequately in Split 2; CRC dependency for INSERT. |
| `api/attractions` | none visible | manual normalize | upsert (ON CONFLICT name) | OK | DELETE is hard delete (§2.3); search query does `ilike('name', '%${search}%')` — input is from URL search param, escaped by PostgREST but `%` and `,` not stripped. Low risk. |
| `api/attractions/photos` | none visible | OK | n/a (read) | OK | 503 on missing key is good. |
| `api/tracking` | n/a (public, PIPA-gated) | type-tagged union | n/a | 202 always (good for tracking) | Postback await blocks response (§2.5). |
| `api/unmatched` | none visible | manual | RPC + upsert fallback | mixed | N+1 on POST (§2.6); GET paginates 100k cap. |

---

## 10. Service Worker (`public/sw.js`)

- File is 1 line minified (Serwist bundle). **Cannot audit cache scope from minified output.**
- **Action:** locate the source — likely under `worker/` or generated by Serwist's Next.js plugin in `next.config.js`. Confirm `runtimeCaching` rules:
  - `/api/*` → `NetworkOnly` (or excluded)
  - `/admin/*` → `NetworkOnly`
  - Customer pages → `StaleWhileRevalidate` with short max-age
- If `/api/*` is `CacheFirst` with any TTL, post-logout requests can return stale auth data. Severity: **High** until verified.

---

## 11. Duplication & Dead Code Within Scope

- **Inline `AIRLINES` map** in `PackagesClient.tsx:248` duplicates `getAirlineName` in `render-contract.ts`. Same airline mapping appears in `parser.ts` / `transportParser.ts` per Split 1 findings. Single source: `render-contract.ts`.
- **`SUPPLIER_SUFFIX_RE`, `AIRLINE_PREFIX_RE`, `HASHTAG_TAIL_RE`** in `YeosonamA4Template.tsx:161–163` — same regex set is likely used elsewhere (DetailClient title cleanup?). Hoist to a shared `lib/title-clean.ts` if duplicated.
- **`EXCLUDED_EXACT` / `EXCLUDED_IF_SHORT`** in `YeosonamA4Template.tsx:179–180` — highlight-filter rules. If DetailClient applies a similar filter, share the rule set; otherwise, divergent A4-vs-mobile selling points.

---

## 12. Migration Safety Notes (Per-File)

| File | DO NOT touch in this PR | OK to touch (bug fix) |
|------|--------------------------|------------------------|
| `tailwind.config.js`, `globals.css` | tokens (in active design) | none — defer |
| `AdminLayout.tsx` | layout structure / nav | nothing critical found in scope |
| `bookings/page.tsx` | row visual / chip styling | `patchStatus` guard (§2.2), bulk batching (§2.4) — these are pure-logic |
| `packages/page.tsx`, `PackagesClient.tsx` | card visual | CRC bypass replacement (§3) — logic-only |
| `packages/[id]/DetailClient.tsx` | sticky/hero visual | CRC bypass replacement (§3) — render output unchanged |
| `YeosonamA4Template.tsx` | layout/print CSS | CRC bypass (§3); unify regex with shared utility |
| `api/packages/route.ts` | response shape if UI consumes new fields | INSERT/UPDATE allowlist for GENERATED columns |
| `api/attractions/*` | response shape | hard-delete → soft-delete (§2.3); cache invalidation (§7.4) |
| `api/tracking/route.ts` | response shape | postback to fire-and-forget (§2.5) |
| `api/unmatched/route.ts` | response shape | bulk RPC (§2.6) |
| `public/sw.js` | nothing (regenerated by Serwist) | locate source + audit `runtimeCaching` (§10) |

---

## 13. Quick Wins (Top 10 — Safe During Migration)

| # | Action | File | Effort | Impact |
|---|--------|------|--------|--------|
| 1 | Add `view.days`, `view.optionalToursByRegion`, `view.flightHeader` to `CanonicalView`; replace `pkg.itinerary_data`/`pkg.optional_tours`/`pkg.flight_info` reads in `DetailClient`, `YeosonamA4Template`, `PackagesClient` | `lib/render-contract.ts`, 3 components | M | Critical (A4↔Mobile parity) |
| 2 | Add `isValidTransition()` guard in `bookings/page.tsx:1029` `patchStatus` | `admin/bookings/page.tsx`, `lib/booking-state-machine.ts` | S | High |
| 3 | Convert `attractions` DELETE to `is_active` soft-delete | `api/attractions/route.ts:236` | S | High (audit trail) |
| 4 | `void fetch(...)` for Google/Meta postbacks in tracking | `api/tracking/route.ts:217,229` | S | Medium |
| 5 | Replace `/api/unmatched` POST loop with single bulk upsert | `api/unmatched/route.ts:17` | S | Medium |
| 6 | Replace `getSupabase()` with shared `supabaseAdmin` import | `packages/page.tsx:40` | S | Low |
| 7 | Trim `PACKAGE_FIELDS` for list view; load heavy JSON only on detail | `packages/page.tsx:31` | S | Medium (TTFB) |
| 8 | Replace inline `AIRLINES` map with `getAirlineName()` | `PackagesClient.tsx:248` | S | Low |
| 9 | Inline `await fetch` chain in `handleBulkCommit` → `Promise.allSettled` | `admin/bookings/page.tsx:1080` | S | Medium |
| 10 | Confirm `previewHtml` upstream sanitization in admin blog editors | `admin/blog/[id]/page.tsx:179`, `admin/blog/write/page.tsx:336` | S | Medium |

All 10 are pure-logic; none touch design tokens, color, spacing, or component visuals.

---

## 14. Larger Refactors

| # | Refactor | Scope | Schedule |
|---|----------|-------|----------|
| 1 | Decompose `admin/bookings/page.tsx` (2005 LOC) into `BookingsTable`, `BookingDrawer`, `StatusButtons`, `BulkBar` | client only | **POST-MIGRATION** (visual is being unified now) |
| 2 | Decompose `admin/packages/page.tsx` (1978 LOC) similarly | client only | **POST-MIGRATION** |
| 3 | Decompose `YeosonamA4Template.tsx` (1677 LOC) into per-section subcomponents driven by `view.*` | client only | **POST-MIGRATION**, but the CRC wiring (Quick Win #1) is **PRE-MIGRATION** |
| 4 | Service worker source audit + `runtimeCaching` rules for `/api/`, `/admin/` | `next.config.js` / Serwist config | **EITHER** — independent of design |
| 5 | Unify title-cleanup regex (`SUPPLIER_SUFFIX_RE`, `AIRLINE_PREFIX_RE`, `HASHTAG_TAIL_RE`) into `lib/title-clean.ts` | shared lib | **EITHER** |

---

## Severity Roll-Up

| Critical | High | Medium | Low |
|----------|------|--------|-----|
| 1 (CRC half-adoption) | 3 (state-machine bypass, hard delete, SW unaudited) | 6 | 3 |

**Top action:** finish wiring `renderPackage()` output through `DetailClient`, `YeosonamA4Template`, `PackagesClient`. The CRC was set up but not consumed for the day-by-day schedule and optional tours — exactly the surface where A4 and Mobile silently diverge today. Quick Win #1 closes the loop.
