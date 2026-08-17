# Product Registration V95 Grade, Duration, And Customer-Fact Audit

Date: 2026-08-16  
Scope: private actual-source shadow replay only  
Normalization: `v6-canonical-2026-08-16.27`

## Decision

The engine now handles an important monthly grade-and-duration catalog family without cross-product customer-fact contamination. It is not approved for customer-wide opening. Production remains frozen, and no production database, deployment, publication pointer, or customer-visible page was changed.

The percentages below measure deterministic structural publication eligibility. They do not establish reviewed 99.5% critical-field exact match.

## Corpus replay

| Measure | V95 result |
|---|---:|
| Files inventoried | 1,171 |
| Unique sources | 1,047 |
| Duplicate files | 124 |
| Extraction | 961/961 |
| Travel sources | 895 |
| Product sections | 1,641 |
| Past-only safe terminal | 737 |
| Source-incomplete safe terminal | 10 |
| Publication-eligible sections | 894 |
| Verified/degraded candidates | 797 |
| Blocked | 97 |
| Structural publication-eligible safety | 89.15% |
| Total automatic safe-terminal handling | 94.09% |

Publication-eligible split results are development 567/615 (92.20%), calibration 89/103 (86.41%), and frozen aggregate-only 141/176 (80.11%). No frozen individual case was inspected.

## Actual-source defect corrected

The development source `1) 26년 서안 PKG 0730 선발 (0730).hwp` contains four products:

- Economy, 3-night/5-day
- Premium, 3-night/5-day
- Economy, 4-night/6-day
- Premium, 4-night/6-day

Its HWP price tables use monthly date rosters, blank departure headers, grade columns, and status text attached to day numbers. Its itinerary cards have bracketed grade headings but do not always contain the literal `PKG`. Its shared prefix also contains commercial facts for multiple grades.

V95 makes the following corrections:

1. Narrative text such as `37년에 걸쳐` cannot establish departure year 2037. The source filename/title commercial context establishes 2026.
2. Date rosters such as `22, 29품격확정일` retain days 22 and 29 while the status suffix remains non-date text.
3. Long merged footer cells describing ticketing, passport, inclusions, or exclusions cannot become product-grade headers.
4. Bracketed grade plus duration identifies each itinerary card even without `PKG`.
5. The selected table calendar assigns its grade to the canonical product.
6. The customer title comes from the local product heading, not a minimum-departure note.
7. Shared document context remains available for price extraction, while customer-visible guide, option, shopping, notice, and matching facts are re-projected from the local product section.
8. A ticketing deadline without a year is resolved against the first active/future departure when historical rows are also retained.

The final real-source replay has four distinct products with matching 5-day or 6-day itineraries, local date-price calendars, and local customer facts. Economy products retain their source-stated guide/driver fee exclusion. Premium products retain guide-fee inclusion, no optional tours, and no shopping. All four are structurally degraded only because lodging is source-stated as an unresolved equivalent hotel.

## Rejected intermediate design

Replacing the entire shared-prefix legacy parse with a local-only parse prevented customer-fact contamination but lost shared price context and caused 285 comparable regressions. That design was rejected.

The accepted design keeps the shared parse only for compatibility price extraction, then replaces a limited set of customer-facing facts from exactly one local parse. V95 versus V94 reports 723 comparable non-frozen sections, 0 recoveries, 0 regressions, and 0 safety-tightened transitions.

## Defense-in-depth publication gates

The publication gate now rejects:

- guide fee simultaneously included and locally payable;
- a no-option claim with customer-visible optional tours; and
- a no-shopping claim with shopping visits.

These gates did not change the V95 aggregate because the scoped projection already removed the current contradictions. They prevent a future parser or profile regression from reaching a customer snapshot.

## Remaining blocker clusters

Counts overlap.

| Cluster | Findings | Sources |
|---|---:|---:|
| Price/date scope ambiguity | 17 | 15 |
| Price relationship | 16 | 15 |
| Source sale price resolution | 16 | 15 |
| Missing adult sale price | 14 | 14 |
| Itinerary | 11 | — |
| Lodging | 11 | — |
| Exclusions | 10 | — |
| Inclusions | 9 | — |
| Exact price evidence | 8 | — |
| Flight | 7 | — |

The next recovery target remains deterministic price ownership and date applicability. Values must not be borrowed from sibling products or inferred by AI without source evidence.

## Verification

- Focused regression: 5 files, 101 tests passed.
- Full regression: 734 files passed, 5,590 tests passed, 7 existing conditional skips.
- TypeScript check passed.
- Product-registration contract check passed.
- Authority contract passed: `authorized=1`, `legacy=137`, `unapproved=0`.
- Whitespace check passed.

Private development inspection, full-corpus, learning-cycle, review-queue, and silver-candidate artifacts remain outside the repository under `C:\Users\admin\Downloads\코덱스테스트`.

## Customer-open blockers

Customer-wide opening remains prohibited until all of the following are true:

1. At least 300 frozen product sections have independent blinded double review.
2. Critical-field exact match reaches the launch contract and critical false publication is zero.
3. Two consecutive frozen benchmark runs pass without active regression.
4. A production-equivalent upload produces the immutable revision, snapshot, proof, and pointer with matching hashes.
5. Real 390×844 Chrome checks pass for list, detail, mobile landing, images, terms, and consultation CTA.
6. Customer surfaces converge to one snapshot and the kill-switch rollback is demonstrated.
7. The remaining 137 legacy writers are retired or reduced to audited compatibility projections.

Until then, `publication_freeze=true` remains the only safe state.
