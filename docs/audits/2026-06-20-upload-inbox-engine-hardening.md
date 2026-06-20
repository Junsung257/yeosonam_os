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

## Interpretation

This is not a customer-ready completion proof. `customerReadyOffline=0` means the current batch still has mobile/A4 review blockers, especially missing itineraries and media/review warnings.

The important completed improvement is that price/date and flight evidence failures are now reduced without using paid model fallback and without opening unsafe customer payloads.

## Remaining Work

- Reduce `itinerary missing` by adding source-backed OCR/PDF day-block reconstruction rules only where day boundaries can be proven.
- Classify the remaining 21 price-missing products into true no-price sources, shared matrix mapping cases, and parser-rule candidates.
- Run live mobile/A4 browser verification only after DB resource pressure is normal and the offline source audit has no customer-critical blockers.

