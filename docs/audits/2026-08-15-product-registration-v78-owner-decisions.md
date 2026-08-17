# Product Registration V78 Owner Decisions Audit

Date: 2026-08-15  
Scope: private actual-source shadow replay; no production publication

## Decisions implemented

1. A numeric price on an exception/exclusion date overrides the general range or weekday price for that exact date.
2. An inquiry-only date or date range without a numeric amount receives no inherited price.
3. A source without a saleable departure date remains blocked. No AI, current clock, or another product may invent the date.
4. `A호텔, B호텔 또는 동급` is one product with an unresolved equivalent-hotel pool.
5. Distinct resort hotel axes are distinct products even when their itinerary is the same.
6. A destination option or upcharge such as USJ is an option on the same product unless the source defines a separate package axis.
7. A source with no adult selling price is not a customer product; only the private source is retained.

## Actual-source checks

- Danang numeric exceptions resolved to KRW 869,000 on 9/22, KRW 1,599,000 on 9/23, and KRW 1,169,000 on 9/24. The numeric calendar omits inquiry-only 9/25.
- Narita inquiry-only 8/8–8/16 did not inherit the following general price. The first resolved rows begin on 8/17, and a document-level `2026년 8월 ~ 2027년 3월` period supplies authoritative year evidence.
- A Jin Air Osaka/Nara/Kyoto itinerary with no departure date remains `blocked_action_required` despite having a price and itinerary.
- The final non-frozen comparison recovered three sections: Narita golf, Osaka golf, and Fukuoka golf. Regressions were zero.

## Aggregate result

- Files: 1,171
- Unique sources: 1,047
- Travel sources: 895
- Product sections: 1,636
- Extraction: 961/961
- Past-only safe termination: 713
- Source-incomplete private-only termination: 10
- Publication-eligible: 913
- Structurally safe verified/degraded: 760 (83.24%)
- Blocked: 153
- Total safe terminal handling: 1,483/1,636 (90.65%)
- Development: 533/625 (85.28%)
- Calibration: 85/106 (80.19%)
- Frozen aggregate only: 142/182 (78.02%)

## Verification

- Product-registration tests: 141 files, 911 tests passed
- Focused regression: 3 files, 74 tests passed
- TypeScript: passed
- Targeted lint: passed
- Registration authority: `authorized=1 legacy=140 unapproved=0`
- Comparable non-frozen recovery/regression: 3/0

## Launch decision

HOLD. This is structural shadow evidence, not independently reviewed critical-field exact-match evidence. Reaching the 95% point estimate needs 108 more safe sections; the one-sided 95% Wilson lower-bound gate needs 119 more independently reviewed safe sections. Production remains frozen.

Private corpus, learning-cycle, and review-queue JSON files remain under `C:\Users\admin\Downloads\코덱스테스트` and are not repository artifacts.
