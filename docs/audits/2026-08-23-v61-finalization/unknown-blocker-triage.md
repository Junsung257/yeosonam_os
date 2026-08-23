# UNKNOWN_BLOCKER triage queue

Status: `TRIAGE_REQUIRED_NOT_REVALIDATED`

The prior read-only regression observation reported 200 source rows, 155 deduplicated rows, 0 checked rows, and 155 skipped rows with `UNKNOWN_BLOCKER:155`. This is carried forward as a work queue only. It is not a Gold label, a PASS count, a reviewer decision, or benchmark evidence.

Each row must be re-opened against its original source and assigned exactly one evidence-backed disposition:

- `SOURCE_MISSING`
- `PRICE_AMBIGUOUS`
- `VARIANT_AMBIGUOUS`
- `ENTITY_UNRESOLVED`
- `STALE_FIXTURE`
- `TRUE_UNKNOWN`

Until the original source, source hash, evidence anchors, and human disposition exist, the row remains unresolved and cannot enter the 400-section immutable Gold freeze. AI may prepare packets and compare independent submissions, but may not manufacture Reviewer A/B decisions.

Revalidation is currently blocked because the dedicated V6.1 worktree has no Supabase admin runtime configuration; the preflight exited fail-closed with `SUPABASE_ADMIN_UNAVAILABLE`.
