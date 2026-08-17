# Product Registration Missing Sale Price Discard Policy

Date: 2026-08-15  
Status: repository implementation and private actual-source shadow verification complete; production publication remains frozen

## Decision

A supplier source without an adult selling price is not a sellable product input. It may terminate automatically as `discarded_source_incomplete`.

Discard does not delete the private source. It means:

- no immutable product revision is committed;
- no `products` or `travel_packages` compatibility projection is created;
- no public snapshot, mobile proof, publication pointer, or customer URL is created;
- the job reaches a successful terminal state with the reason visible to the operator.

## False-discard protections

The engine must not confuse a parser failure with a bad source. It keeps the section blocked as `SOURCE_SALE_PRICE_REQUIRES_RESOLUTION` when any of the following exists:

- a canonical positive selling-price candidate;
- an explicit source sale amount;
- a standalone table amount that may have lost its header during HWP extraction;
- supplier shorthand such as `799 특가`, `499 특가`, `1,159,-`, or `399.000원`;
- a `요금표` or equivalent price-table structure marker even when its cells were not recovered;
- a multi-product document with a common or sibling price candidate whose scope is unresolved.

Only the complete absence of these signals permits automatic discard.

## Actual-source shadow result

- Files inventoried: 1,171
- Unique source hashes: 1,047
- Travel sources: 895
- Travel sections: 1,634
- Extraction: 961/961
- Initial local section-only discard candidates: 31
- Final conservative discard candidates: 2
- Recovered from false-discard risk into blocked improvement work: 29
- Known `799`/`499` shorthand or `요금표` documents remaining in discard candidates: 0

The final two cases are in the frozen cohort and were not opened individually during development. They are candidates, not proven bad sources.

## Benchmark requirement

Every independently reviewed product section must explicitly record `sourceSalePricePresent: true|false`. Both blinded reviewers must inspect only the source. A missing decision invalidates the annotation. A reviewed sellable source predicted as discarded is a false discard, and the customer-open gate requires that count to be zero.

## Verification

- The registration/parser regression passes 154 test files and 1,074 tests.
- TypeScript, the strict authority contract, targeted lint, and whitespace validation pass.
- The full actual-source corpus and learning-cycle artifacts were regenerated privately.
- Local SQL application could not run because the local Supabase service was not running. Production migration was not applied and automatic customer publication remains frozen.
