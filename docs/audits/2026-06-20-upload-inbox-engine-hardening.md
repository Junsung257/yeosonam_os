# 2026-06-20 Upload Inbox Engine Hardening Audit

This audit records the current evidence after hardening the supplier upload engine against the 2026-06-20 upload-inbox extracted source batch.

## Scope

- Source report: `scratch/upload-inbox-batch-reports/2026-06-20T12-08-52-357Z/report.json`
- Offline audit output: `scratch/upload-inbox-batch-reports/2026-06-20T12-08-52-357Z/offline-source-audit.json`
- Mode: offline source audit only. Live DB/mobile browser verification was not used because Supabase resource pressure was visible during this session.

## Fixes Promoted Into Engine Rules

- Date-scoped supplier price rows now preserve per-date adult/child amounts instead of copying the first price across every date.
- OCR/PDF flight rows now skip airport gathering/meeting times and recover source-backed outbound/inbound flight segments from mixed rows such as `BX181 12:30` followed by `15:25`.
- Flight candidate merging now combines adjacent, stacked, inline, and loose OCR rows so one partial extractor does not discard a better extractor result.
- Return rows such as `다낭출발 부산 향발` preserve the departure city instead of collapsing both airports to Busan.
- Price recovery can now use source-backed human-reader price/date pairs when deterministic price tiers fail, but it rejects bare document issue dates and supports departure context such as `출 발 일 26년 4/29 판 매 가`.
- Korean day-line OCR/PDF schedules now recover reversed or split day markers such as `일1`, `제2일차`, and `제 일3치앙마이`.
- Catalog split recovery now drops title-only fragments when sibling sections contain customer schedule evidence, preventing false products with no itinerary.
- Human-reader price recovery now handles broken supplier rows such as `월 일 55,12,19,26` followed by `인 849,000/`, and nearby Korean travel-day rows such as `3월 / 여행일 23일, 24일 / 상품가 299,000원/인`.
- Golf weekday/month matrix rows now recover date-scoped prices from tables such as `3/1~3/18` with `월,화,수 1,349,- 1,409,-`, using the product title to choose the 정통/품격 column.
- Destination resolution now includes constrained aliases for `나가사키`, `칠채산`, `황하석림`, `바단지린`, and `란주` so clear supplier catalog destinations do not remain `UNK`.

## Current Offline Audit Metrics

After the hardening pass:

```text
products: 132
priceRows recovered: 111
product_prices missing: 21
publishableOffline: 47
customerReadyOffline: 0
flight time source mismatch: 0
itinerary missing: 40
itinerary duplicate day: 2
itinerary day sequence: 7
price source audit failed: 0
```

After the follow-up itinerary and price-pattern hardening pass:

```text
products: 124
publishableOffline: 50
customerReadyOffline: 0
product_prices missing: 19
itinerary missing: 7
destination code unresolved: 12
mobile/A4 live verification: not run in this offline audit
```

After the constrained destination alias hardening pass:

```text
products: 124
publishableOffline: 61
customerReadyOffline: 0
product_prices missing: 9
destination code unresolved: 8
mobile/A4 live verification: not run in this offline audit
```

After the golf weekday/month matrix hardening pass:

```text
products: 124
publishableOffline: 57
customerReadyOffline: 0
product_prices missing: 9
itinerary missing: 7
destination code unresolved: 12
mobile/A4 live verification: not run in this offline audit
```

## Interpretation

This is not a customer-ready completion proof. `customerReadyOffline=0` means the current batch still has mobile/A4 review blockers, especially missing itineraries and media/review warnings.

The important completed improvement is that price/date and flight evidence failures are now reduced without using paid model fallback and without opening unsafe customer payloads.

## Remaining Work

- Reduce the remaining `itinerary missing` 7 cases by adding source-backed OCR/PDF day-block reconstruction rules only where day boundaries can be proven.
- Classify the remaining 9 price-missing products into true no-price sources, shared matrix mapping cases, and parser-rule candidates.
- Continue destination-code hardening for the remaining 8 destination unresolved blockers. Do not add broad `화산` global mapping until raw route evidence proves it is the Xian/Huashan product context, because that can collide with non-Xian phrases such as volcano/waterfall descriptions.
- Run live mobile/A4 browser verification only after DB resource pressure is normal and the offline source audit has no customer-critical blockers.

## 2026-06-20 Follow-up: Micro QA Final-State Accounting

The offline source audit had a process bug: it was counting the initial micro Auto QA triggers as final blockers even after the three-phase micro repair loop had produced a repaired registration. This made fixed items look blocked and hid the real remaining work.

The audit now uses:

- `autoQA.repairedRegistration` for final product shape.
- `autoQA.packagesAudit` and `autoQA.a4Audit` for final render payload checks.
- `autoQA.remainingTriggers` instead of initial triggers for final blockers.

Result on the same source batch:

```text
products: 124
publishableOffline: 98
customerReadyOffline: 0
blocked: 26
mobile/A4 live verification: not run in this offline audit
```

## 2026-06-20 Follow-up: Split Product Context Preservation

Split catalog products were being audited with only their local section text. For fragments whose local heading was only a date/price/title snippet, destination context from the full document or filename was lost. The audit now passes the full document text and filename-derived destination evidence into each split product registration.

Result on the same source batch:

```text
products: 124
publishableOffline: 105
customerReadyOffline: 0
blocked: 19
product_prices missing: 5
itinerary missing: 7
destination code unresolved: 2
mobile/A4 live verification: not run in this offline audit
```

Remaining blockers must not be auto-opened unless source evidence exists. In particular, confirmation letters, fam-tour notices, standalone price tables, or itinerary-less golf/fee documents must stay blocked or review-needed until the original source contains customer-visible itinerary and sale-price evidence.

## 2026-06-21 Follow-up: Itinerary Table Pollution And Duration Repair

Additional source-batch replay showed that some OCR/PDF tables still leaked non-schedule rows into itinerary days:

- Month/date price rows such as `5월 23, 30일 1,099,000`.
- Admin rows such as `3월 30일(월)까지 항공권 발권하는 조건입니다.`
- Sparse numeric rows such as `314M` that were misread as day `10`.
- Bad one-day duration inference on otherwise clean 3-day itineraries.

The itinerary normalizer now:

- Prunes late outlier days when a strong contiguous day sequence already exists and the outlier is price/admin/noise-shaped.
- Does not prune near-gap days such as `1,2,4`, because that may represent a real missing day that must remain blocked.
- Does not trust `durationDays=1` enough to prune multi-day schedules.
- Repairs a bad one-day duration from a clean, duplicate-free 2-8 day itinerary.

Result on the same source batch:

```text
products: 124
publishableOffline: 109
customerReadyOffline: 0
blocked: 15
product_prices missing: 5
itinerary missing: 7
destination code unresolved: 1
mobile/A4 live verification: not run in this offline audit
```

The remaining blocked products still need source-backed price, itinerary, destination, or catalog-section separation. They must not be auto-opened by inventing missing sale prices or missing customer itinerary days.

## 2026-06-21 Follow-up: Source Evidence Recovery Pass

The next source-batch replay found three recurring, source-backed failure classes and promoted them into deterministic engine rules:

- PDF/OCR day headers split at the first day, including `제1`/`일` fragments and inline `1일 ...` rows.
- Same-line catalog package starts such as `PKG [실속] CA 북경/만리장성 3박4일`.
- Compact Macau/Hong Kong catalog price matrices where a shared period table appears before the individual `PKG` sections.
- Bridgeable OCR day markers such as `3 * , , .` only when explicit neighboring days already prove the missing day sequence.
- Air Busan charter flight hints such as `BX7395/BX7305` for Hanoi when OCR drops the city name but source flight evidence remains.

Result on the same source batch:

```text
products: 128
publishableOffline: 119
customerReadyOffline: 0
blocked: 9
mobile/A4 live verification: not run in this offline audit
```

Remaining blocked products are intentionally blocked:

- Documents with itinerary but no sale-price/date evidence, such as confirmation letters or cruise schedules.
- Documents with price tables but no customer itinerary, such as standalone fare sheets.
- Fam-tour or notice documents without both price and itinerary.
- Domestic/free-rent documents where the extracted source does not yet contain enough package structure.

Do not mark these customer-publishable unless a future source-backed rule proves the missing price, date, destination, and itinerary fields. The next live registration pass must still run mobile landing and A4 browser verification after Supabase resource pressure is stable.
