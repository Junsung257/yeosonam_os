# Product Registration Active-Learning Loop

Date: 2026-08-14  
Status: private development/calibration learning only; customer publication remains frozen

## Implemented loop

1. Run the full real-source corpus with pinned parser, profile, policy, and build versions.
2. Normalize blockers by field path so repeated section indexes do not inflate distinct error families.
3. Rank development cases by commercial risk, affected source count, lineage coverage, and error-family diversity.
4. Create a blind review queue that contains source identity and review instructions but no engine outcome or blocker text.
5. Create a separate silver-candidate queue for independent Claude/Gemini evidence consensus.
6. Accept a silver candidate only when value, scope, evidence anchors, quote hash, and deterministic replay all agree.
7. Use silver candidates only to design parser/profile fixtures; never use them as ground truth, source evidence, or publication authorization.
8. Change one parser/profile/policy layer at a time, rerun the affected cohort, then rerun the complete corpus.
9. Compare prior and current active sections. Any safe-to-blocked regression prevents promotion.
10. Keep frozen individual cases inaccessible to selection and inspection. Promotion requires independently double-reviewed frozen evidence and two consecutive complete passes.

## Latest private cycle

- Corpus: 1,171 HWP files, 1,047 unique sources, 1,634 travel-product sections
- Development active sections: 809
- Development safe candidates: 649 (80.22%)
- Calibration active sections: 117
- Calibration safe candidates: 95 (81.20%)
- Frozen: aggregate counts only; no individual frozen case inspected
- Selected blind development review sources: 34
- Dual-model silver candidates: 12
- Comparable active sections against the preceding build: 926
- Active safe regressions: 0
- Promotion: blocked (`REVIEWED_BENCHMARK_EVIDENCE_MISSING`)
- Focused regression: 153 test files and 1,059 tests passed
- TypeScript, authority contract, targeted lint, and whitespace validation: passed

## Actual-source corrections from this cycle

- A same-line Korean month/day/weekday and one selling price now produce an evidence-bound date-price row.
- A product header with one explicit Korean departure date and one uniquely labelled selling price now resolves even when HWP reading order places the amount before the label.
- Competing nearby amounts are no longer resolved by taking the first value.
- Source weekday is retained through the price IR and date policy.
- A past intake-year date whose supplied weekday matches is excluded instead of being silently rolled to the next year.
- A future candidate whose weekday conflicts with the source is blocked.
- Two actual Huangshan documents covering four sections now terminate as expired schedules instead of remaining ambiguous or becoming a wrong future sale.

## Historical companion-document experiment

The development shadow scanned 643 sources and classified 502 combined documents, 113 itinerary sheets, 20 price sheets, and 8 terms sheets. It produced zero authoritative bundle candidates. Closest pairs lacked product identity or had transport conflicts. Historical directory proximity therefore remains learning evidence only; production joins still require a real intake upload batch plus deterministic product identity.

## Non-claims

- Silver candidates are not training labels until independently reviewed.
- Frozen exact match remains unmeasured because completed double-reviewed ground truth is still zero.
- The structural active safe rate is not customer-open accuracy.
- No production migration, deployment, publication pointer, or feature flag was changed by this cycle.
