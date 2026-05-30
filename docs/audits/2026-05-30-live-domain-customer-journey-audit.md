# www.yeosonam.com Live Customer Journey Audit (2026-05-30)

## Scope
- Sitemap page-load audit: 233 public customer-facing URLs from `https://www.yeosonam.com/sitemap.xml`.
- Customer CTA audit: 8 core customer journey pages, 22 CTA clicks.
- Production-safe rule: destructive or lead-creating mutations were blocked during CTA testing.

## Live Findings
1. `/destinations/다낭` and `/destinations/계림%2F양삭` returned HTTP 500 in production.
2. Package detail pages emitted repeated `user_actions` Supabase RLS 401 errors from the browser.
3. CSP used invalid `https://o*.sentry.io` source, ignored by browsers on 228/233 pages.
4. Customer CTA clicks mostly navigated, but destination page interactions were polluted by broken `/destinations/다낭` prefetch responses.

## Fixes Applied Locally
1. Moved recent/similar package tracking behind `/api/user-actions` so the browser no longer writes directly to `user_actions`.
2. Hardened `TravelFitnessCard` against non-array climate JSON, preventing destination pages from crashing on data-shape drift.
3. Added slash-safe destination path encoding and applied it to sitemap/home/destination/blog links and destination canonical/RSS URLs.
4. Replaced invalid Sentry CSP source with valid wildcard hosts.
5. Cleared lint-blocking regressions in mileage/admin/gamification route files.

## Verification
- `npm run type-check`: pass.
- `npm run lint`: pass with pre-existing warnings only.
- `npm run test`: pass, 80 files, 1015 passed, 1 skipped.
- `npm run build`: timed out after 5 minutes in this session, no conclusive pass/fail.
- `npm run audit:route-policy`: unavailable because the script is not present in the current `package.json`.

## 2026-05-30 Follow-up Implementation

- `src/components/customer/PackageCard.tsx` now shows a stable `상세 보기` action on every package card, including ranked/recommended cards where the previous subtle `일정 보기` hint could disappear.
- Price, rating, rank badge, and seat scarcity are grouped as information; the right side is reserved for the primary next action. This improves mobile scanability and keeps the conversion cue in a predictable place across desktop and mobile card variants.

Follow-up verification:

- `npx eslint src/components/customer/PackageCard.tsx --max-warnings=0` passed.
- Local warm public journey smoke passed with `BASE_URL=http://localhost:3043 npm run audit:public-critical`: 7/7 pages passed.
- `npm run audit:event-taxonomy` passed after the card CTA change.
- `npm run type-check -- --pretty false` timed out while other `next build` processes were running on the machine; no TypeScript error was observed before timeout, but this needs a quiet-machine rerun.
- `scripts/audit-public-critical-pages.mjs` now performs local-only sequential warm-up before measurement, matching the admin dashboard contract audit pattern and avoiding false over-budget failures from Next dev first compilation.
- Fresh local server verification with `BASE_URL=http://localhost:3044 npm run audit:public-critical` passed on first run: 7/7 pages passed.

## 2026-05-30 Batch Follow-up

- Restored `src/pages/_document.tsx` so Next generated type validation does not reference a missing Pages Router document file.
- Aligned package detail CTA wording with the real lead flow: bottom and calendar CTAs now say `예약 문의` instead of implying immediate booking.
- Updated the package FAQ booking answer from the old `카톡 예약하기` wording to `예약 문의` / `카톡 상담`, matching the consultation-first B2B2C flow.

Batch verification:

- `npx eslint src/app/packages/[id]/DetailClient.tsx src/components/customer/PackageCard.tsx src/components/customer/PackageFAQ.tsx --max-warnings=0` passed.
- `npm run type-check -- --pretty false` passed.
- `npm run audit:event-taxonomy` passed.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0`.
- `node --check scripts/audit-public-critical-pages.mjs` and `node --check scripts/audit-admin-dashboard-contract.mjs` passed.
- `git diff --check` passed for the touched batch.

## 2026-05-30 CTA Wording Batch

- Removed remaining customer-facing `예약하기` / `바로 예약 가능` wording from blog sticky CTA, share pages, OG affiliate image copy, A4 itinerary templates, and card-news default outro copy.
- Kept actual payment/escrow steps unchanged, but changed pre-payment discovery and shared-itinerary actions to `예약 문의`, `상담하기`, or `상담 담기` so the UX matches the consultation-first B2B2C flow.
- Updated the admin content-hub CTA label from `여행 예약하기` to `여행 상담하기` while preserving the existing `BOOK_TRAVEL` value for compatibility.

Batch verification:

- `rg -n "예약하기|카톡 예약하기|바로 예약|자세히 보기 / 예약하기|이 구성으로 예약하기|예약 가능 날짜|바로 예약 가능|여행 예약하기" src/app src/components -g "*.tsx"` returned no matches.
- `npx eslint src/app/admin/marketing/content-hub/[cardNewsId]/page.tsx src/components/blog/StickyMobileCta.tsx src/app/share/[code]/page.tsx src/components/admin/CardNewsStudio.tsx src/app/api/og/affiliate/route.tsx src/components/admin/YeosonamA4Template.tsx src/components/itinerary/A4PosterLayout.tsx --max-warnings=0` passed.
- `git diff --check` passed for the touched CTA wording files.

## Artifacts
- `docs/audits/2026-05-30-live-domain-page-audit.json`
- `docs/audits/2026-05-30-live-domain-customer-cta-audit.json`
