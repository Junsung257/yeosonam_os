# Product registration V138 guide-fee commercial-scope audit

Date: 2026-08-16  
Normalization: `v6-canonical-2026-08-16.38`

## Outcome

The private actual-source replay completed for 1,171 HWP files, 1,047 unique sources, 895 travel-product sources, and 1,711 product sections. All 961 attempted extractions succeeded. The lineage split and 2026-08-16 current-upload simulation date were pinned; no individual frozen source was opened.

This change fixes guide-fee commercial scoping without lowering a publication blocker:

- A thousands comma in a guide fee remains part of the amount, and a single-room charge in the same row cannot become the guide-fee amount.
- Inclusion headings with supplier spacing such as `포 함 사 항` establish the inclusion section.
- A nearby exclusion heading does not invert an amount-less guide benefit that is already inside the inclusion section.
- A guide fee with an explicit amount immediately before a reversed HWP exclusion heading remains an excluded local payment.
- Bullet-separated clauses are independent. A free-day guide/vehicle service clause followed by a separate etiquette-tip clause is not a guide-tip exclusion.
- Massage tips, personal etiquette tips, and guide/driver tips remain separate customer facts.
- If the same product genuinely states both included/no-tip and excluded/local guide payment, publication remains blocked.

## Actual-source development checks

Five non-frozen source families were opened for diagnosis and replayed after the change:

- amount-less guide/driver benefit in an inclusion section;
- USD 50 per-person guide/driver local payment in a reversed table row;
- a spaced inclusion heading followed by a customer-visible guide-tip benefit;
- a free-day guide/vehicle service exclusion next to a separate etiquette-tip exclusion;
- a genuine included-versus-excluded guide-tip contradiction inside one product source.

The first, third, and fourth cases now produce only the included fact. The second produces only the USD 50 excluded/local fact. The genuine contradiction remains blocked, while the sibling product whose source states inclusion remains gate-clean.

## Aggregate replay

| Split | All sections | Past-only | Source-incomplete discard | Publication eligible | Structurally safe | Blocked | Structural safe rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| Development | 1,226 | 573 | 4 | 649 | 508 | 141 | 78.27% |
| Calibration | 158 | 54 | 1 | 103 | 87 | 16 | 84.47% |
| Frozen aggregate only | 327 | 127 | 5 | 195 | 135 | 60 | 69.23% |
| Total | 1,711 | 754 | 10 | 947 | 730 | 217 | 77.09% |

Including past-only and genuinely source-incomplete terminal outcomes, 1,494/1,711 sections (87.32%) terminate safely without customer exposure. All inputs still reach an automatic terminal outcome; a blocked result is not counted as a safe publication candidate.

Compared with the pinned V119 baseline on 757 comparable active non-frozen sections, 595 stayed safe, 162 stayed blocked, 0 recovered, and 0 regressed. The V95 percentage is not directly comparable because later segmentation and terminal-policy changes produced a different product-section denominator and stricter contradiction set.

The largest remaining structural blocker families are guide-tip commercial contradictions, unresolved sale-price evidence, missing sale price, no-shopping/no-option contradictions, price/date applicability, lodging evidence, and inclusion/exclusion coverage. These must be fixed from source evidence or remain blocked; they cannot be recovered by weakening the gate.

## Verification

- Focused canonical/guide/terminal suite: 92/92 passed.
- Full Vitest: 734 files passed; 5,626 tests passed; 7 existing conditional tests skipped.
- Product-registration learning verification: 12 files/137 tests and 157 files/1,224 tests passed.
- TypeScript passed after removing a redundant nullish expression in the nearby minimum-departure-cell lookup.
- Golden registration corpus: 5/5 supplier fixtures and 13/13 customer-deliverability cases passed.
- OCR/PDF candidate proxy: 5/5 passed. This is not an operational OCR accuracy claim.
- Product-registration code/SSOT contract passed.
- Authority boundary passed: `authorized=1`, `legacy=137`, `unapproved=0`.
- Migration-prefix audit reported 0 new/unbaselined collisions.

The live upload-review replay was skipped because Supabase credentials were not configured in this worktree. No production database write, deployment, publication-pointer change, or customer exposure occurred.

## Customer-open decision

This replay is structural shadow evidence, not independently reviewed exact-match accuracy. No reviewed frozen ground truth was supplied to the learning-cycle promotion gate, so promotion correctly remains blocked by `REVIEWED_BENCHMARK_EVIDENCE_MISSING`.

Customer opening still requires all of the following:

1. at least 300 frozen product sections independently reviewed against the source, including critical-field exact match and zero critical false publication;
2. two consecutive frozen benchmark passes on the deployed build;
3. a live upload-to-revision-to-snapshot run with Supabase available;
4. exact snapshot-hash mobile Chrome proof and channel convergence for the launch cohort;
5. cohort rollout under the existing kill switches.

Production must remain `publication_freeze=true` until those gates pass. Private corpus, case-inspection, and replay artifacts remain outside the repository.
