# Product registration V5 implementation recheck

Checked: 2026-08-11 KST

## Verification

- `npm run type-check`: PASS
- `npm run lint -- --max-warnings=0`: PASS
- Full Vitest: 665 files / 5,079 tests passed (`--testTimeout=15000`)
- `npm run build`: PASS (387 static pages; postbuild output verification PASS)
- Production V5 strict verifier: PASS (14 tables, CAS lineage guard, 0 failures)
- Production customer-open operational gate: PASS for public screens (4/4) and pre-public screens (38/40; 2 safe-fixable supplier-notation findings, 0 blocking)
- Latest Preview deployment: [Ready](https://os-84s5jlzsc-zzbaa0317-4596s-projects.vercel.app)
- Preview `/packages` + `/lp` mobile audit: 4/4 passed (same snapshot proof header, hydration and CTA checks)
- Live V5 sample snapshot: `61f3975a-c771-4090-9111-6db2f2bf93f9`, hash `05440a94c09a597b1a66fea55d7dcc8eb1a4a7afab2237ab094def0e06cfcf95`, pointer version 8

## Direct customer-style review

The sample package was opened in Chrome at a 390x844 mobile viewport and reviewed as a customer would: hero, price/date selection, reservation CTA, inclusion/exclusion, surcharge, day-by-day schedule, FAQ, notices, and the landing route were clicked and read against the original HWP.

Confirmed source alignment:

- title, destination, 2 nights / 3 days, airline, minimum 4 people, price-date display, included golf baggage (23KG), Korean guide, hotel/green-fee/cart inclusion, and excluded meals/personal expenses
- product-specific passport, Visit Japan Web, unused-service refund, sunset/locker, and double/twin-room notices are now shown under a separate `상품 일정표 기준 안내` section
- FAQ no longer invents cancellation percentages, generic 20KG/10KG baggage limits, or “one-person participation” when the source says 4+ people
- The latest Preview landing page sorts departure cards by actual date (`8/12`, `8/13`, ...) and uses a year-qualified label for dates outside the current year.
- The latest Preview landing page shows source-backed golf-course names and the 18-hole fact, and the inquiry sheet opens, accepts a date choice, and exposes adult/child/contact/consent fields.

Remaining content-quality limits (not hidden by the structural gate):

- The sample HWP has no product photos, so the hero is a destination/catalog reference image. The UI now labels it `참고 이미지`; it must not be read as proof of the exact course or hotel.
- The stored itinerary previously reduced golf rows to transfer summaries. The normalizer now preserves source-backed course names and the 18-hole fact as remarks; course-by-course day placement still depends on the source table being parsed into typed schedule items.
- Platform-wide reservation/cancellation policy remains separate from source-specific facts so customers can distinguish “상품 일정표 기준 안내” from “공통 예약·취소 안내”.
- The common notice block now renders one customer-facing business-hours line without repeating the same heading as a nested notice title.

This means the sample is customer-readable and safe for a controlled Preview/canary review, but it is not evidence that every future supplier document is fully automatic. OCR, ambiguous multi-variant price tables, missing source images, and unparsed complex tables remain fail-closed or review-required.

## Direct interaction evidence (latest Preview)

- Chrome mobile viewport: `/packages/{id}` loaded the published snapshot with title, `₩1,349,000~`, `8/12 출발`, 2026 calendar, BX501/BX516, source notices, golf-course/18-hole remarks, and the `참고 이미지` fallback label.
- The package reservation CTA opened the inquiry dialog with name, phone, departure date, and request fields. The baggage FAQ opened and displayed the source-safe answer without inventing a baggage allowance.
- `/lp/{id}` loaded the same snapshot lineage, displayed sorted upcoming dates, the full source price bands, BX501/BX516, three day itinerary, source notices, golf-course/18-hole remarks, and the `참고 이미지` label.
- The landing sticky CTA opened the three-step inquiry sheet; selecting the `8/12` priced date produced the expected selected state and preserved the adult/child/contact/consent steps.

The product photo conclusion is explicit: the HWP contains no product/course/hotel photo. The customer surface therefore uses a clearly labelled destination/catalog reference image, not an unverified supplier image.

The V5 publication pointer is live in the database, while the latest code is verified on Preview only; no Production Vercel promotion was performed in this review. The cache-convergence observer for the protected Preview returned HTTP 302, so convergence was verified by direct Chrome and browser-proof checks rather than by that observer endpoint.

## Live sample decision

The live recheck processed 100 recent products: 98 passed and 2 remained blocked. Both blocked rows are the same source catalog (`백두산(26하계) 통합 TW(8월유류) 15T0723`) with two package variants. The source contains a conflicting price for `2026-06-27` (1,280,000 vs 1,380,000) without a stable variant key.

This is an intentional fail-closed result. The engine must not choose the lower price, higher price, or a generic minimum when the source does not identify which variant applies. The rows remain pending review until the land operator confirms the variant or supplies a split source document.

## Packaging fix

`.vercelignore` now excludes every local `.next-*` build directory. This prevents stale local verification artifacts from being uploaded with future deployments; the next preview deployment completed successfully after the rule was added.
