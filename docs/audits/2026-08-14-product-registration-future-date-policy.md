# Product Registration Future-Date Policy Validation

Date: 2026-08-14  
Status: repository and private shadow validation only; production publication remains frozen

## Implemented contract

- Every new operational upload receives one pinned Korea reference date (`Asia/Seoul`).
- A yearless month/day normally resolves to the nearest non-past occurrence relative to that date.
- If the source weekday matches an already-past intake-year occurrence, that occurrence is treated as expired and is not rolled to the next year. If the upcoming candidate conflicts with the source weekday, publication is blocked.
- Explicit source years always win. Explicit past dates are excluded and never rolled.
- Entry-local year evidence wins over document-level fallback.
- Retry and watchdog recovery preserve the original reference date. Explicit reprocess receives a new date.
- Archive and legacy backfill cannot use rolling inference.
- A past-only source ends as `ALL_DEPARTURES_PAST` without revision, snapshot, proof, pointer, or customer URL.
- Application and deferred database guards reject past departure instances and price ranges.
- The admin job screen reports the reference date, future inference count, past exclusion count, future sale count, and the completed past-only outcome.

The policy also separates a departure-period year from unrelated legal or informational years. A shared notice such as `25년 전자담배 반입 금지` no longer conflicts with `26년 3~6월 출발`. Genuine multiple departure years remain blocked unless each price entry carries its own explicit year evidence.

## Private actual-source shadow result

Input inventory:

- Files: 1,171
- Unique sources: 1,047
- Travel sources: 895
- Product sections: 1,634
- Extraction: 961/961 attempted sources succeeded
- Frozen aggregate: 303 sections; no individual frozen case was inspected

Reference date: 2026-08-14, Korea time.

| Split | All sections | Past-only excluded | Active sections | Active verified/degraded | Active safe rate |
|---|---:|---:|---:|---:|---:|
| Development | 1,173 | 364 | 809 | 649 | 80.22% |
| Calibration | 158 | 41 | 117 | 95 | 81.20% |
| Frozen aggregate | 303 | 60 | 243 | 171 | 70.37% |
| Total | 1,634 | 465 | 1,169 | 915 | 78.27% |

The combined automatically safe result is 1,380/1,634 (84.46%): 915 potential verified/degraded publications plus 465 completed past-only exclusions. The section count is three lower because conservative same-document continuation matching removed false price-card/itinerary-card splits.

Price-calendar policy totals from the earlier date-policy-only run:

- Explicit past entries excluded: 21,099
- Eligible yearless entries assigned a future year: 7,735
- Future entries retained: 18,929

These counts include repeated calendar rows across source sections and were not recomputed in the later table-layout correction pass. They measure deterministic policy behavior, not independently reviewed correctness.

## Remaining customer-open blockers

The top development cohorts after past-only exclusion are:

- Price/departure applicability unresolved: 35 sources
- Adult sale price unavailable: 32 sources
- Exact amount evidence unresolved: 16 sources
- Exclusions unavailable: 14 sources
- DAY itinerary unavailable: 12 sources
- Inclusions unavailable: 11 sources

Unresolved year conflicts remain grouped by source cohort rather than counted once per repeated product section. They must bind each price row to the appropriate explicit year rather than using a document-wide guess.

## What this does not prove

- Completed independent double-reviewed ground truth remains zero.
- Critical exact match and critical false-publication remain unmeasured.
- The simulation does not move any production publication pointer.
- The new migration remains repository-only and has not been applied to production.
- Production remains `authority_mode=shadow` with `publication_freeze=true`.

Therefore 78.27% is a structural safe-publication candidate rate for active schedules, not a customer-open accuracy rate and not evidence that the 95% target has been achieved.

## Software verification

- Latest product-registration/parser regression: 153 test files, 1,059 tests passed
- TypeScript: passed
- Authority contract: `authorized=1`, `legacy=143`, `unapproved=0`
- Targeted ESLint for the latest registration changes: passed
- The V3 forward migration is covered by the authority-contract test. Local SQL application was not run because local Supabase was not running; the pass did not deploy or apply production migrations.
