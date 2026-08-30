# Blog People-First Editorial Harness V5 — implementation evidence

Date: 2026-08-30

## Incident converted to regression evidence

The public Guam food-budget article answered a daily-budget query with source-domain instructions, internal labels, isolated menu facts, repeated imperatives, and blanket `공식 근거` citations. It did not calculate a daily budget. The exact failure shape is now a committed negative fixture and must fail with `reader_task_unanswered`, `source_label_misleading`, `internal_label_leak`, `commodity_source_stitching`, and `decision_artifact_missing`.

## Implemented boundary

- `blog-decision-artifact-v1` is built before writing and owns the reader promise, source labels, arithmetic operands, assumptions, first-party aggregate eligibility, and evidence gaps.
- Food-budget scenario arithmetic is deterministic. Derived price claims persist the formula, result, operand fingerprints and values; both bundle validation and publication validation recompute the sum and reject mismatch.
- The model receives honest public citation labels. The former source-domain opening repair is a compatibility no-op and the publisher no longer calls it.
- A deterministic gate and an independent DeepSeek Pro semantic judge are both mandatory for low/medium-risk informational autopublish. Semantic dimensions are boolean and cannot be averaged.
- Generation and judge calls have separate atomic reservations under the same daily cap. Missing judge output or evaluation persistence fails closed.
- New approved attempts require exact rendered-prompt, brief and claim-packet SHA-256 trace evidence. The DB constraint is `NOT VALID` only to avoid fabricating or blocking on historical null rows; it enforces new writes.

## Verification evidence

- TypeScript strict check: passed.
- Focused Vitest: 71 tests passed before documentation-only updates.
- Promptfoo offline challenger: 33/33 passed, zero provider/model calls.
- CI workflow: `.github/workflows/blog-editorial-harness-v5.yml`.

## Production boundary

The immutable release manifest pins one forward migration and a non-destructive application-compatibility rollback. An isolated workdir reconstructed all 571 remote migration versions and the exact-set dry-run observed only `20260830011340_blog_editorial_harness_v5.sql`.

The known Guam row was re-read from production on 2026-08-30: creative `311e67a4-8d51-45c9-8224-6155762d62d9` is still `published`. Its existing `URL_UPDATED` job succeeded once and reported Google, global IndexNow, and Naver IndexNow request success; this is request-delivery evidence, not proof that a search engine has indexed the page.

Changing that public article remains an operational corpus mutation. `2026-08-30-blog-editorial-v5-quarantine-preview.csv` fixes the exact creative ID, canonical URL, empty replacement target, failure reasons and `preview_only` state. Per `docs/runbooks/blog-stale-content-and-removal.md`, two distinct reviewers and PITR confirmation are required before `--apply`. A corrected canonical page receives a new `URL_UPDATED` event only after it becomes public-eligible; a quarantined URL requires the separately reviewed removal event.
