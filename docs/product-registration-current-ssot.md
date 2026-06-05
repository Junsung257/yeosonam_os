# Product Registration Current SSOT

Last updated: 2026-06-05

This is the current operating contract for supplier upload registration, customer mobile landing, and A4 poster readiness.

The priority is internal reliability first. Do not design the public API layer until this internal engine consistently registers our own supplier documents without customer-deliverable blockers.

## Document Hierarchy

This document is the single current SSOT for product upload registration.

General documentation automation rules live in `docs/ai-agent-doc-automation.md`. Use that document to decide whether a change needs a fixture, SSOT update, error-registry entry, audit note, or no document change.

Use the documents like this:

- `docs/product-registration-current-ssot.md`: current rules and completion contract.
- `db/error-registry.md`: append-only repeated mistake registry and active checklist.
- `docs/audits/README.md`: archive index for historical evidence, investigation notes, and completed audit reports.
- `.claude/commands/register-product.md` and `.claude/commands/assemble-product.md`: legacy/manual references only.
- `docs/registration-improvement-plan.md` and `docs/register-changelog.md`: historical planning/decision records, not the active upload registration playbook.

Do not create a new planning document for each registration failure. Add the failure to the golden corpus and, if it is a repeated process mistake, add one concise rule to `db/error-registry.md` or this SSOT.

When searching for current product-registration rules, exclude audit history first:

```bash
rg "keyword" docs AGENTS.md .claude --glob "!docs/audits/**"
```

## Current Direction

All supplier raw formats must converge into one registration object:

```text
upload route
  -> parse source
  -> split products
  -> registerProductFromRaw()
       -> deterministic fixes
       -> supplier raw facts
       -> recoverUploadPriceData()
       -> resolve destination/code
       -> normalize itinerary
       -> evaluateUploadDeliverability()
       -> StandardProductRegistrationObject
  -> persist products/product_prices/travel_packages
  -> audit customer mobile/A4 readiness
```

`src/app/api/upload/route.ts` is an HTTP adapter only. It must not contain supplier-specific regexes, price table rescue logic, destination rescue logic, itinerary normalization, or persistence decisions.

## Price Success Definition

Old rule, now forbidden:

```text
price success = price_tiers exists
```

Current rule:

```text
price success =
  product_prices.length > 0
  AND price_dates.length > 0
  AND every price_dates.date has at least one product_prices.target_date
  AND the minimum product_prices.net_price for a date matches price_dates.price
  AND every positive product_prices.net_price has adult_selling_price
```

`price_dates` is the date-level minimum used for calendars and summary pricing.
`product_prices` is the customer option ledger used by mobile landing and A4. Hotel/grade columns, room choices, and other same-date price options must stay as separate `product_prices` rows.

Customer pages must never read or serialize internal `net_price` as the customer selling price. Customer-safe price payloads use `adult_selling_price`.

## Required Persistence Contract

Registration is not complete unless all three stores are consistent:

- `products`: internal ledger row with destination code and base price.
- `product_prices`: customer option rows with `target_date`, `net_price`, `adult_selling_price`, and option label/note when relevant.
- `travel_packages`: customer package row with `price_dates`, itinerary, raw evidence, render-ready fields, and review status.

`product_prices` insert failure is a blocker. It must not be downgraded to a warning after `travel_packages` is saved.

The database guard from migration `20260605121000_product_prices_customer_selling_price_guard.sql` fills `adult_selling_price` from `net_price` when needed and prevents positive customer price rows from remaining customer-invisible.

## Customer Deliverability Gate

`evaluateUploadDeliverability()` is the final pre-persistence customer gate. It blocks before save when any of these are true:

- `product_prices` is empty.
- `price_dates` is empty.
- `product_prices` and `price_dates` disagree.
- destination is unresolved or internal code would become `UNK`.
- itinerary days are missing, duplicated, non-contiguous, or exceed the product duration.
- optional tour, entrance fee, surcharge, cancellation, or guide/tip amounts pollute product price candidates.
- A4/mobile render input cannot be built from the standardized object.

Failure messages should explain the root cause, such as price table type unrecognized, optional-tour-only amount detected, or date range not expanded. Do not return only generic phrases like "price rows missing".

## Golden Corpus Contract

Golden cases are full supplier raw texts, not shortened snippets.

Required current cases:

- Cebu hotel-column matrix.
- Phu Quoc full source.
- Fukuoka golf spot-special plus weekday period table.
- Clark multi-product split source.
- Existing supplier raw fixtures.

Each expected file should check the customer outcome, not only parser internals:

- title and destination.
- internal destination code is not `UNK`.
- minimum price.
- specific date prices.
- `price_dates.length > 0`.
- `product_prices.length > 0`.
- same-date hotel/grade options preserved when present.
- optional tour prices excluded from product price.
- itinerary days valid.
- customer mobile/A4 deliverability not blocked.

## Change Rule

Every new supplier failure must follow this order:

```text
fixture
  -> parser/IR or registration-object improvement
  -> recoverUploadPriceData verification
  -> evaluateUploadDeliverability verification
  -> persistence/audit verification
```

Do not patch new supplier cases directly into `upload/route.ts`.

Do not bypass the engine with one-off `db/insert_*.js` scripts unless the user explicitly asks for a manual legacy insert and accepts that it is outside the upload engine.

## A4/Mobile Contract

Mobile landing and A4 must share a customer-safe render contract. Renderers should consume standardized view/payload helpers rather than reparsing raw `travel_packages` fields.

Customer-visible fields must have one of these sources:

- copied from raw supplier evidence,
- deterministically derived from raw supplier evidence,
- manually approved,
- clearly labeled platform fallback.

Internal commission, supplier memo, net price, B2B terms, and land-operator-only notes must never enter customer render fields.

## Attraction Contract

Do not auto-seed attractions during product registration. If a tourism point is not matched, keep it as text and send it to the unmatched/review path. Attraction DB creation is a separate managed workflow.

## Required Verification

Before declaring the registration engine ready:

```bash
npx vitest run src/lib/parser/deterministic src/lib/product-registration src/lib/upload-validator.test.ts src/lib/price-dates.test.ts src/lib/upload-verify.test.ts
npm run type-check
npm run eval:product-registration:ci
node --check scripts/audit-product-mobile-landing-readiness.mjs
```

After deployment or remote DB/data changes, run the live readiness audit with `npx tsx scripts/audit-product-mobile-landing-readiness.mjs --public-only --strict` using the appropriate filters.

## Agent/Harness Setup

General AI harness and documentation automation rules live in `docs/ai-agent-doc-automation.md`.

This product-registration SSOT only records product-registration behavior. If a generic AI/prompt/eval/memory rule is needed, update `docs/ai-agent-doc-automation.md` instead of duplicating it here.
