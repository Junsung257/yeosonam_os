# Code Review: Customer-Facing Pages & Shared Components

**Project:** 여소남 OS (Next.js App Router B2B2C travel SaaS)
**Date:** 2026-04-25
**Scope:** `src/app/(customer)/**`, home/landing, blog, public flows, sitemap/robots, `src/components/*.tsx`, `public/sw.js`

---

## 1. Inventory

### Files Reviewed
**Total in scope:** 113 app routes (page.tsx/layout.tsx) + 10 root components + 2 meta files + 1 service worker

**Customer-facing pages reviewed:**
- `src/app/page.tsx` (376 LOC, SSR, currently modified)
- `src/app/blog/page.tsx` (455 LOC, SSR)
- `src/app/blog/[slug]/page.tsx` (800+ LOC, SSR, sanitized HTML)
- `src/app/destinations/page.tsx` (161 LOC, SSR)
- `src/app/destinations/[city]/page.tsx` (300+ LOC, SSR, pillar content)
- `src/app/concierge/page.tsx` (536 LOC, **'use client'** — CRITICAL)
- `src/app/group-inquiry/page.tsx` (278 LOC, **'use client'** — HIGH)
- `src/app/share/[code]/page.tsx` (**'use client'**, on-mount fetch — HIGH)
- `src/app/rfq/[id]/page.tsx` (400+ LOC, **'use client'** — HIGH)
- `src/app/influencer/[code]/page.tsx` (**'use client'**, useEffect — MEDIUM)
- `src/app/robots.ts` (41 LOC, well-structured)
- `src/app/sitemap.ts` (171 LOC, 45k limit enforced)
- `src/components/BlogTracker.tsx` (108 LOC)
- `src/components/MetaPixel.tsx` (80 LOC)
- `src/components/{ChatWidget, JarvisFloatingWidget, CommandPalette, ProductCard, RecommendationSection}` — 10 root components total

### Excluded (Design Migration in progress)
- `src/app/packages/**`
- `src/components/AdminLayout.tsx`
- `src/components/admin/InstagramPublishModal.tsx`
- `src/components/admin/YeosonamA4Template.tsx`
- `src/components/customer/DepartureCalendar.tsx`
- `src/app/globals.css`, `tailwind.config.js`

### Top 10 Largest
1. blog/[slug] (800+ LOC)
2. concierge (536)
3. blog/page (455)
4. rfq/[id] (400+)
5. page (376)
6. destinations/[city] (300+)
7. group-inquiry (278)
8. destinations (161)
9. BlogTracker (108)
10. MetaPixel (80)

---

## 2. Server vs Client Boundary Violations

**CRITICAL — Pages marked 'use client' that violate SSR/ISR requirement (CLAUDE.md §4-4):**

- **`src/app/concierge/page.tsx:1,76`** — `'use client'` + `useEffect` fetches `/api/concierge/cart?session_id={sessionId}` on mount. Should be SSR with ISR. Cart state not dynamic per-visitor at the shell level.
- **`src/app/group-inquiry/page.tsx:1,58`** — `'use client'` + `useEffect` for auto-scroll. Could be SSG form shell with a small client hydration boundary.
- **`src/app/share/[code]/page.tsx:1,67`** — `'use client'` + `useEffect` fetches `/api/share?code={code}` on mount. Should be SSR/ISR. Share links are time-sensitive (expires_at) — server pre-render is faster and SEO-friendly.
- **`src/app/rfq/[id]/page.tsx:1,~100+`** — `'use client'` + useEffect for RFQ data fetch. Public RFQ pages should be SSR/ISR for cacheability.
- **`src/app/influencer/[code]/page.tsx:1,90`** — `'use client'` + useEffect. Could benefit from server-side layout caching.

> Per CLAUDE.md §4-4: "고객 페이지에서 매 조회마다 API를 호출하는 useEffect는 서버사이드(SSR/ISR)로 옮겨주세요."

---

## 3. DOMPurify / Sanitization Gaps

**Correct (isomorphic-dompurify on server):**
- `src/app/blog/[slug]/page.tsx:453,547,574` — `DOMPurify.sanitize()` with `ADD_TAGS`
- `src/app/destinations/[city]/page.tsx:206` — `DOMPurify.sanitize(colored)`

**CRITICAL gaps (unsanitized HTML):**
- **`src/app/rfq/[id]/page.tsx:415`** — `dangerouslySetInnerHTML={{ __html: report.report_html }}` with NO DOMPurify. `report_html` is AI-generated → XSS risk if upstream pipeline doesn't sanitize.
- **`src/app/rfq/[id]/contract/page.tsx:98`** — `dangerouslySetInnerHTML={{ __html: html }}` with NO DOMPurify detected.

**Action:** Wrap RFQ HTML in `DOMPurify.sanitize()` immediately. This is a one-line fix per file and removes a real XSS surface.

---

## 4. Image / Font / Bundle Performance

**Raw `<img>` tags (should use next/image):**
- `src/app/page.tsx:276–280` — Pillar cards use raw `<img src={d.image} ... loading="lazy">`. No AVIF, no responsive srcset.
- `src/app/destinations/[city]/page.tsx:166,237,274` — Hero + grid images raw `<img>`. Hero LCP penalty likely.
- `src/app/destinations/page.tsx:127` — Destination cards raw `<img>`.
- `src/app/blog/destination/[dest]/page.tsx:142,184` — Blog grid raw `<img>`.

**Good:**
- `src/app/page.tsx:323–330` — Hero destination cards use `next/image` with `priority: true` for first 4, lazy for rest.

**Bundle & fonts:**
- No evidence of `next/dynamic` for heavy widgets (`ChatWidget`, `JarvisFloatingWidget`). Recommend lazy-load to keep landing TTI clean.
- Font loading not deeply audited; verify `src/app/layout.tsx` uses `next/font`.

**Action:** Replace raw `<img>` with `next/image` across customer pages — expect 20–30% image-load improvement.

---

## 5. Customer Copy / FIELD_POLICY Leaks

**No leaks detected:**
- Brand "여소남" used consistently
- No "랜드사명" surfaced to customer pages
- Concrete selling points present:
  - "부산 출발 해외여행 패키지 전문"
  - "운영팀이 직접 답사·검증"
  - "가치있는 여행"
- Internal cost fields (`cost`, `real_total_price`) hidden from customer view

**Note:** Earlier review flagged `/rfq/[id]:326` for cost-delta exposure — re-verify on a fresh read of the current `report_html` shape (the field policy depends on whether the AI-generated report ever surfaces `hidden_cost_estimate`/`real_total_price` as plain text).

---

## 6. Component Duplication

**HIGH reuse opportunity:**
- **Destination cards:**
  - `src/app/page.tsx:269–304` (TOP 4)
  - `src/app/page.tsx:316–351` (popular)
  - `src/app/destinations/page.tsx:121–150` (hub)
  - `src/app/destinations/[city]/page.tsx:220–260` (related)
  - All share the same overlay + metadata pattern → extract `<DestinationCard>`.
- **Blog cards:** `src/app/blog/destination/[dest]/page.tsx` and `src/app/blog/angle/[angle]/page.tsx` duplicate grid scaffolding → extract `<BlogPostCard>`.
- **Price display inconsistency:**
  - `src/app/page.tsx:344` — won
  - `src/app/destinations/[city]/page.tsx:190` — 만원
  - Different formatting/units on the same surface → extract `<PriceDisplay>` (use `fmt만`/`fmtK` from `admin-utils.ts`).

---

## 7. Dead Components

Potentially unused (verify with grep across `src/`, `tests/`):
- `src/components/CommandPalette.tsx` (143 LOC)
- `src/components/RecommendationSection.tsx` (120 LOC)

If not mounted in any layout/page, archive or remove.

---

## 8. Service Worker (`public/sw.js`)

**Status:** Minified bundle (Serwist library, cache versioning `precache-v2` detected). Source-level audit not possible from minified file.

**Cannot verify without source map:**
- `/api/` bypass (HIGH risk if missing — would serve stale auth state)
- `/admin` bypass (HIGH risk — would cache admin shells)
- User-data caching policy

**Action:** Locate the original `sw.ts`/Serwist config (likely `next.config.js` plugin or similar) to audit `runtimeCaching` entries.

---

## 9. sitemap.ts / robots.ts

**Good:**
- `robots.ts:18–20` — Disallows `/api/`, `/admin/`, `/login`, `/review/`, `/share/`
- `robots.ts:10–17` — Allows public routes
- `sitemap.ts:13–21` — Static routes correct
- `sitemap.ts:37–73` — Dynamic packages + destinations filtered
- `sitemap.ts:58–76` — RFQ filtered to `awaiting_selection`
- 45k hard limit enforced

**Minor:**
- `/packages` and `/destinations` entries use `new Date()` for `lastModified` instead of querying `max(updated_at)` from DB. Pull from DB for accurate freshness signals (sub-S effort).
- Missing from sitemap: `/concierge`, `/group-inquiry` (verify whether they should be indexed; if yes, add at priority 0.8).

---

## 10. Hydration / SEO

**Good:**
- No `Date()` or `Math.random()` in SSR render paths
- Client-only pages (`'use client'`) correctly localize `Date`/`Math`
- Canonicals present
- JSON-LD comprehensive (TravelAgency, TouristDestination, BreadcrumbList, BlogPosting, FAQPage)

**Missing metadata exports:**
- `src/app/concierge/page.tsx` — No `export const metadata`. Add title/description/robots for SEO.
- `src/app/group-inquiry/page.tsx` — No metadata export.

---

## 11. Accessibility

**Good:**
- Alt text present and descriptive
- Mobile CTA nav labeled: `aria-label="문의하기"`
- Meta Pixel uses non-blocking `lazyOnload`

**Medium:**
- Contrast test needed: semi-transparent buttons (`bg-white/20`, `bg-white/15`) likely fail WCAG AA on light backgrounds.
- Form labels: `src/app/group-inquiry/page.tsx` textarea missing explicit `<label>` or `aria-label`.

---

## 12. Tracking / Privacy

**HIGH RISK — Analytics fired without consent gate:**
- `src/components/MetaPixel.tsx:29` — `fbq('init', 'PIXEL_ID')` fires for all visitors, no consent check.
- `src/components/BlogTracker.tsx:19` — `trackContentView()` fires without consent gate.

**Action:** Implement a consent manager (CMP) and wrap analytics behind `if (window.__consent?.analytics)`. Without this, EU/KR PIPA exposure exists if a customer ever lands on the site.

---

## 13. Quick Wins (Top 10)

| # | Action | Files | Effort | Impact |
|---|--------|-------|--------|--------|
| 1 | Sanitize RFQ HTML with DOMPurify | `rfq/[id]/page.tsx:415`, `rfq/[id]/contract/page.tsx:98` | S | Critical |
| 2 | Replace raw `<img>` with `next/image` | `page.tsx`, `destinations/*`, `blog/*` | M | High |
| 3 | Add consent gate to Meta Pixel + BlogTracker | `MetaPixel.tsx`, `BlogTracker.tsx` | M | Critical |
| 4 | Add `metadata` exports to concierge/group-inquiry | `concierge/page.tsx`, `group-inquiry/page.tsx` | S | Medium |
| 5 | Extract `<DestinationCard>` | `page.tsx`, `destinations/page.tsx`, `destinations/[city]/page.tsx` | M | Medium |
| 6 | Migrate concierge/group-inquiry/share/rfq to SSR | 4 pages | L | High |
| 7 | Pull `lastModified` from DB in sitemap | `sitemap.ts` | S | Low |
| 8 | Add explicit form labels | `group-inquiry/page.tsx` | S | Medium |
| 9 | Lazy-load heavy widgets via `next/dynamic` | `ChatWidget`, `JarvisFloatingWidget` | S | Medium |
| 10 | Audit service worker source / runtimeCaching | locate `sw.ts`/Serwist config | S | Medium |

---

## 14. Larger Refactors (Top 5)

1. **Server vs Client Boundary Cleanup** (L) — Convert 5 customer `'use client'` pages to SSR/ISR with Suspense islands. Est. 3–5 days.
2. **Component Library Consolidation** (M) — Extract `DestinationCard`, `BlogPostCard`, `PriceDisplay`, `RatingBadge`. Removes ~400 LOC of duplication. Est. 1–2 days.
3. **Analytics & Consent System** (M) — Implement consent manager, wrap all tracking calls. Required for KR PIPA compliance. Est. 2–3 days.
4. **Image Optimization Sweep** (M) — Replace all raw `<img>` with `next/image` across customer pages, regression-test Core Web Vitals. Est. 1–2 days.
5. **Dynamic Import for Widgets** (S) — Lazy-load `ChatWidget`, `JarvisFloatingWidget`, `CommandPalette` via `next/dynamic`. Est. 1 day.

---

## Summary

| Category | Count | Priority |
|----------|-------|----------|
| Critical | 4 | XSS (RFQ HTML), analytics-no-consent, service worker unaudited, SSR/ISR boundary violations |
| High | 6 | Raw images, missing metadata, duplication, form labels, sitemap dates |
| Medium | 5 | Contrast testing, consent system, dynamic imports, price inconsistency, dead components |
| **Files reviewed** | 21 | 15 pages + 4 components + 2 meta + 1 service worker |

**Immediate actions:** sanitize RFQ HTML (#1), gate analytics on consent (#3). Schedule SSR migration (#6) and image sweep (#2/#4) for next sprint.
