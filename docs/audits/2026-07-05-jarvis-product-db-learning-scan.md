# Jarvis Product DB Learning Scan - 2026-07-05

## Scope

Read-only scan of the live Supabase product catalog for Jarvis product-learning coverage.

Project: `ixaxnvbmhzjvupissmly` (`Yeosonam_OS`)

Tables checked:

- `travel_packages`
- `products`
- `product_prices`
- `jarvis_knowledge_chunks`
- `jarvis_knowledge_entities`

No raw supplier text, internal notes, or secrets were copied into this report.

## Key Findings

Jarvis does not yet have complete product-catalog learning coverage.

Current live catalog shape:

| Metric | Count |
|---|---:|
| `travel_packages` total | 917 |
| `travel_packages` active | 284 |
| `products` total | 790 |
| `product_prices` rows | 18,488 |
| `jarvis_knowledge_chunks` total | 1,434 |
| `jarvis_knowledge_chunks` package rows | 166 |
| distinct package source IDs in RAG | 164 |

Active package learning coverage:

| Metric | Count |
|---|---:|
| Active packages | 284 |
| Active packages with `travel_packages.embedding` | 8 |
| Active packages with package RAG chunks | 8 |
| Active packages with internal code | 284 |
| Active packages with price dates | 284 |
| Active packages with itinerary data | 284 |
| Active packages with product price rows | 284 |
| Active packages with product highlights | 105 |
| Active packages with country | 0 |
| Active packages with short code | 0 |

Initial conclusion: the operational catalog had usable price/date/itinerary data, but Jarvis RAG only covered 8 of 284 active packages. Product-specific customer answers and recommendations were incomplete until package RAG backfill ran.

Post-remediation result:

| Metric | Before | After |
|---|---:|---:|
| Active packages with package RAG chunks | 8 | 284 |
| Active package RAG dry-run candidates | 276 | 0 |
| Package RAG rows | 166 | 444 |
| Distinct package source IDs in RAG | 164 | 440 |

The active product catalog is now covered by package RAG source IDs.

## Active Destination Coverage

Largest active destinations and initial RAG coverage:

| Destination | Active packages | RAG indexed |
|---|---:|---:|
| 연길/백두산 | 85 | 7 |
| 푸꾸옥 | 31 | 0 |
| 장가계 | 27 | 0 |
| 나트랑 | 20 | 0 |
| 서안 | 15 | 0 |
| 다낭 | 10 | 0 |
| 방콕 | 8 | 0 |
| 광저우 | 6 | 0 |
| 연길 | 6 | 0 |
| 부산-계림 실속 | 6 | 0 |

## Table Relationship Notes

- `travel_packages` is the primary customer-facing package table for active product recommendations.
- `products` appears to be a legacy or auxiliary upload table. It has 290 active-ish rows (`ACTIVE` 283, `active` 7), but no embeddings.
- `products.internal_code` overlaps heavily with `travel_packages.internal_code`, but joining can inflate counts where duplicated internal codes exist.
- `product_prices.product_id` maps to active `travel_packages.internal_code`; all 284 active packages had at least one matching price row.

## Existing Pipeline Gap

Existing code paths are not enough for a full historical product learning pass:

- `/api/cron/embed-products` fills `travel_packages.embedding`, but does not create `jarvis_knowledge_chunks`.
- `/api/cron/rag-incremental` indexes package RAG chunks, but only checks recent changed rows and caps per run.
- `src/lib/jarvis/rag/indexer.ts#indexPackage()` can index one package and should be reused for a safe backfill.

## Remediation Added

Added a dry-run-first package RAG backfill tool:

```bash
npm run backfill:jarvis-package-rag -- --json
```

Apply in small batches:

```bash
npm run backfill:jarvis-package-rag -- --apply --limit=25
```

Use production Vercel env when running against the live project:

```bash
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/backfill-jarvis-package-rag.ts --json
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/backfill-jarvis-package-rag.ts --apply --limit=25
```

The script defaults to:

- `status=active`
- dry-run unless `--apply` is present
- missing package RAG chunks only, unless `--all` is present
- `--scan-limit=1000` for candidate discovery, separate from `--limit` processing cap
- no raw text logging
- sequential indexing with a delay to reduce model/API pressure

Backfill executed against production in batches:

| Batch | Processed packages | Inserted chunks | Failed |
|---|---:|---:|---:|
| 1 | 25 | 25 | 0 |
| 2 | 75 | 75 | 0 |
| 3 | 100 | 101 | 0 |
| 4 | 76 | 77 | 0 |

Final verification:

```bash
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/backfill-jarvis-package-rag.ts --json --sample=5
```

Result: `candidates=0`.

```bash
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/audit-jarvis-rag.ts --json --require-db --source=package --limit=500
```

Result: package RAG `qualityScore=98`, `totalRows=444`, `readinessLevel=watch`. Remaining warnings are historical stale/thin chunks, not missing active package coverage.

## Follow-Up Gates

Remaining follow-up:

Completed follow-up in this pass:

1. Added a Jarvis readiness threshold so active package RAG coverage below 95% fails readiness.
2. Fixed source-filtered RAG audits so `--source=package` expects package rows only.
3. Raised default live RAG audit sampling from 250 to 500 rows to avoid false source-coverage warnings after large single-source reindex jobs.
4. Backfilled active package answerability fields: `country`, `short_code`, and missing `product_highlights`.
5. Reindexed all active package RAG chunks after data backfill.
6. Added explicit product scoping for customer QA so package link, UUID, short code, internal code, or exact title mentions pin the answer context to the selected product.
7. Added exact package-id lookup in the Jarvis RAG retriever so `/packages/{id}` questions return that package chunk before hybrid retrieval can mix neighboring products.
8. Added package identity metadata to RAG chunks and updated skip-path indexing so metadata refreshes even when content hash is unchanged.

Final verification:

| Command | Result |
|---|---|
| `npm run type-check` | PASS |
| `node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/verify-jarvis-readiness.ts --json --require-db --skip-heavy` | PASS, product catalog 100% coverage/data quality |
| `npm run audit:jarvis-rag -- --json` | PASS, live RAG 99/100 ready |
| `npm run verify:customer-inquiry` | PASS, 44/44 |
| `npm run verify:jarvis-all-scenarios` | PASS, 100/100 |
| `npx vitest run src/lib/qa-product-scope.test.ts` | PASS, 4/4 |

Final live DB coverage:

| Metric | Result |
|---|---:|
| Active packages | 284 |
| Active packages with country | 284 |
| Active packages with short_code | 284 |
| Active packages with product_highlights | 284 |
| Active packages with package RAG chunks | 284 |
| Active package chunk rows with short_code metadata | 327/327 |
| Active package chunk rows with internal_code metadata | 327/327 |

Exact package retrieval smoke:

```json
{
  "packageId": "e74c84d6-b327-4126-a853-c05db18fea47",
  "title": "7~10월 BX시즈오카 3박4일 일정",
  "count": 1,
  "sourceIds": ["e74c84d6-b327-4126-a853-c05db18fea47"],
  "titles": ["7~10월 BX시즈오카 3박4일 일정"]
}
```

## Follow-Up Hardening Pass

Additional changes completed after the first product learning pass:

1. Added `scripts/audit-active-product-answerability.ts` and `npm run audit:active-product-answerability`.
2. Added answerability checks for active product coverage, duplicate `short_code`, duplicate `internal_code`, duplicate exact titles, weak highlights, missing package RAG rows, and mismatched RAG metadata.
3. Hardened exact product scoping so exact-title or token-overlap matches that resolve to multiple products become `ambiguous_product`, not `explicit_product`.
4. Added ambiguous-product guards to QA chat and QA v2 so Jarvis asks for a product code/link or separates facts by product instead of merging price, dates, itinerary, inclusions, exclusions, airline, hotel, or option facts.
5. Added code/display title/summary/highlight/price-date fields to QA package context.
6. Replaced encoding-fragile product-scope tests with stable fixtures and expanded regression coverage from 4 to 7 cases.

Latest product answerability audit:

```bash
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/audit-active-product-answerability.ts --limit=2000
```

Result:

| Metric | Result |
|---|---:|
| Active packages | 284 |
| Active packages with country | 284 |
| Active packages with short_code | 284 |
| Active packages with product_highlights | 284 |
| Active packages with package RAG chunks | 284 |
| Package chunk rows | 327 |
| Duplicate short_code groups | 0 |
| Duplicate internal_code groups | 0 |
| Duplicate exact title groups | 43 |
| Weak highlight rows | 0 |
| Missing RAG rows | 0 |
| Mismatched RAG metadata rows | 0 |

Interpretation: duplicate exact titles are expected for product families that differ by code/date/option. They are now handled as ambiguous product references instead of being answered as one product.

Latest customer-visible product text audit:

```bash
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/audit-customer-visible-product-text.ts --scope=active --limit=2000
```

Result: `scanned_packages=284`, `affected_packages=0`, `blocking_packages=0`.

Blog RAG follow-up was read-only because blog work is protected by the active blog recovery stream:

```bash
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/audit-jarvis-rag.ts --json --require-db --source=blog --limit=500
```

Result: blog-only RAG `qualityScore=99`, `readinessLevel=ready`, with `short_chunk_text=5`, `short_contextual_text=5`, and `stale_chunk=70`. Defer refresh/reindex to the protected blog session.

## Root-Cause Identity Fix

The duplicate-title issue is not a set of one-off bad rows. Travel products can legitimately share the same customer title while differing by date, public code, airline, class, option, or package family. The root cause was that Jarvis and QA contexts treated `title` as if it were a unique product identity.

Root fix:

1. Added a deterministic product answer identity utility: `buildProductAnswerIdentity()`.
2. The identity label combines title with public code, destination/country, airline, duration, product type, trip style, price/date hints, and top highlights.
3. QA package context now exposes `Answer identity` and `Answer identity key` before product facts.
4. QA v2 context now carries the same `answer_identity` object.
5. RAG package chunks now store `answer_identity_key`, `answer_identity_label`, and `base_title` metadata, and use the identity label as `source_title`.
6. RAG indexing was changed from conflict-based upsert to deterministic update/insert by `source_type + source_id + chunk_index`, with duplicate chunk cleanup and obsolete chunk deletion. This avoids duplicate rows when `tenant_id` is null.
7. `audit-active-product-answerability` now fails on duplicate answer identities and mismatched identity metadata, not on duplicate plain titles.
8. Added `scripts/prune-jarvis-package-rag.ts` to remove package RAG chunks whose source package is no longer customer-visible (`active`, `approved`, or `published`).
9. Live RAG source coverage now checks DB-wide source presence instead of only the latest sample window, so large package reindex jobs do not create false missing-source warnings.

Latest root-cause audit:

```bash
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/audit-active-product-answerability.ts --limit=2000
```

Result:

| Metric | Result |
|---|---:|
| Active packages | 284 |
| Active packages with package RAG chunks | 284 |
| Package chunk rows for active packages | 474 |
| Duplicate exact title groups | 43 |
| Duplicate answer identity groups | 0 |
| Mismatched RAG metadata rows | 0 |
| Missing RAG rows | 0 |
| Audit status | PASS |

Package RAG duplicate check:

```bash
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/audit-jarvis-rag.ts --json --require-db --source=package --limit=800
```

Result: package RAG `duplicate_source_chunk=0`, `qualityScore=98`, `readinessLevel=ready`.

After pruning stale non-visible package RAG chunks:

```bash
node scripts/run-with-vercel-env.mjs --environment=production -- node node_modules/tsx/dist/cli.mjs scripts/prune-jarvis-package-rag.ts --apply --json
```

Result: `deleted=158`.

Final package RAG audit:

| Metric | Result |
|---|---:|
| Package RAG rows | 474 |
| Quality score | 100 |
| Readiness level | ready |
| Duplicate source chunks | 0 |
| Stale chunks | 0 |
| Short chunks | 0 |

Final all-scenarios gate:

```bash
npm run verify:jarvis-all-scenarios
```

Result: `PASS 100/100`, live RAG `100/100 ready`.

Remaining product-data quality work:

1. Product duplicate-title groups can remain when they represent real product variants. The operational quality gate is now duplicate answer identity, not duplicate title.
2. Refresh stale/thin blog RAG chunks only inside the protected blog session.
