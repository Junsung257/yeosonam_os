# Product Registration V6 — Derived Extraction Contract

PR-V6-03 adds an append-only recovery layer between the parser extraction and
canonical product normalization.

## What is guaranteed

- The parser extraction is never updated in place.
- Every recovery patch names one source table/cell, the old text, the new text,
  recovery evidence, and the product-axis binding hash.
- Cell text, its matching IR node, and the quote hash are updated together.
- Repeated text in the document is rejected unless the caller supplies an
  explicit occurrence index. This prevents a price from leaking to a sibling
  product.
- A child extraction carries `parentExtractionId`, `parentExtractionHash`,
  `supersedesExtractionId`, `patchHash`, `contentHash`, source hash, and the
  derivation type (`image_recovery`, `human_review`, or
  `parser_upgrade_replay`).
- The child can be persisted in the existing
  `product_document_extractions` ledger. Lineage is stored under
  `quality_diagnostics.derivedExtraction`; no new public table or customer
  pointer is required.
- The in-memory child starts with a deterministic recovery key. After insert,
  callers must pass the returned `derived` copy (bound to Supabase's UUID) to
  normalization so the existing extraction foreign key remains valid.
- `normalizeDerivedExtraction` re-runs the canonical normalizer with the
  `analysis_only` execution policy. It cannot create a revision, snapshot, or
  publication pointer.

## Why this is still shadow-only

PR-V6-03 does not decide whether OCR or a reviewer is correct, and it does not
publish a product. Provider consensus, reviewer receipts, dual review, mobile
proof, and source-lane canaries remain later gates. A missing or ambiguous cell
therefore fails closed and stays in the recovery/review queue.

## Existing ledger reuse

`product_document_extractions` already has an immutable extraction hash and a
dedupe key. A derived IR uses the same ledger with a dedicated parser engine and
lineage metadata, so deployment does not require a migration or a second source
of truth. The persistence helper verifies the source row and parent extraction
hash before inserting the child.
