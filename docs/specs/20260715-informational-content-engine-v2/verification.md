# Verification: Informational Content Engine V2

## Automated Checks

Milestone checks:

```bash
npx vitest run <milestone test files>
npm run type-check
npx eslint <changed files>
git diff --check
```

Final checks:

```bash
npx vitest run <all informational engine tests and product-boundary baselines>
npm run type-check
npm run lint
npm run build
```

Migration proof must run against local/test tooling only and must record apply order and rollback/forward-fix behavior.

## Executed Milestone Evidence

### M4 — informational evidence model

- `npx supabase migration new blog_information_evidence_model` created `20260715082549_blog_information_evidence_model.sql` with Supabase CLI 2.109.1.
- `node scripts/migration-safety-checker.js 20260715082549_blog_information_evidence_model.sql`: 1 file, 0 issues.
- Information evidence, migration-contract, boundary, and product baseline tests: 5 files, 31 tests passed.
- `npm run type-check`: passed.
- Local apply was attempted with `npx supabase status -o json`, but the Windows Docker engine was not running (`//./pipe/docker_engine` absent). No remote database fallback is permitted in this goal. Staging must run the migration apply and rollback/forward-fix checks before deployment.

### M5 — claim validator and publish gate

- Claim extraction covers price/currency, movement time, percentage, climate, customs, entry/visa, insurance, policy, and measurable superlative claims while excluding ordinary narration, itinerary day labels, and generic checklist wording.
- Missing evidence, expired evidence, non-official policy evidence, and absent high-risk human approval tests pass.
- Shared runtime gate is present in automatic publisher, blog POST/PATCH/force reindex, content-hub publish, content-queue approve, and zero-click replacement paths.
- Product-content skip regression and product writer/brief baselines pass.

### M6 — representative key, duplicate decision, and canonical sitemap

- Stable key tests prove title/slug year changes do not create a new identity.
- Active representative returns `UPDATE_EXISTING`; competing reservation returns `WAIT_FOR_EXISTING`; same-owner retry resumes idempotently.
- Automatic and manual publish entrypoints enforce the registry before public cache/indexing work.
- Direct POST first inserts a private draft, activates the canonical registry, and only then changes public state.
- New informational sitemap rows require active self-canonical metadata; legacy and product rows remain compatible.
- Existing duplicate analysis is dry-run only and proposes `MERGE_REVIEW` without redirects, merges, deletes, or row mutation.

### M7 — contextual informational related links

- V2 informational links rank same-destination adjacent intents first, then same-country/region same-intent candidates, specific audience matches, and explicit editorial pillar/cluster relationships.
- Unpublished, noindex, redirecting, non-canonical, self, duplicate-slug, and locale-mismatched candidates are excluded before ranking.
- The minimum relevance threshold permits an empty result instead of filling the surface with unrelated recent posts.
- Regression fixtures prove a Sapporo food article does not recommend Phu Quoc or Guangzhou and that repeated titles receive distinct anchor text.
- Product-backed and legacy posts retain the existing related-post path because the new ranker requires a valid informational representative identity.

### M8 — central informational CTA/CRO

- Typed CTA keys are `NAVER_CAFE`, `DEAL_ROOM`, `CONSULTATION`, `RELATED_ARTICLES`, and `OFFICIAL_SOURCE`; selection returns exactly one primary and at most one secondary CTA.
- Missing, ambiguous, non-HTTPS, or disabled external settings are not rendered. The safe fallback is a contextual internal related-article route, and non-Korean locales also remain internal-only.
- High-risk entry/visa and insurance content renders its pinned official source first, a related information article second, and omits sales-oriented external CTAs.
- The information writer no longer emits CTA sections or sales URLs. Publish repair strips package, group-inquiry, and Kakao links from informational body Markdown; product writer behavior is unchanged.
- The bottom CTA hub is mobile-first, keyboard accessible, and adds `target="_blank"` plus `rel="noopener noreferrer"` only to verified external links.
- Dedicated information CTA events store only canonical creative ID, event type, CTA key, placement, locale, a one-way ephemeral deduplication hash, and receipt time. No user, session, visitor, URL, UTM, contact, booking, IP, user-agent, free-form metadata, or product field is accepted.

### M9 — final rendered informational SEO quality

- The publish decision renders Markdown through the same renderer and public-body sanitizer used by `/blog/[slug]`; stored Markdown alone is not accepted as final proof.
- The rendered gate checks one public H1, planned title/H1/description intent, raw Markdown and literal `\n`, empty headings/tables/cells, placeholders, representative canonical/index consistency, JSON-LD identity and reading-time consistency, answer-before-CTA, and duplicate CTA links.
- Information publish evidence stores `quality_gate.rendered_reading_time_minutes`. Blog list and detail both prefer this value, while legacy and product rows retain their existing fallback behavior.
- Automatic publishing, manual publishing, content queue approval, content hub publishing, MRT generation, and zero-click replacement persist the shared quality evidence through the same update helper or equivalent publisher payload.
- Product-backed posts do not run the information-only rendered gate, and their writer, evidence, snapshot, parser, landing, and product-detail contracts are unchanged.
- Component, integration, public-page, publisher, and product-boundary regression set: 13 files, 77 tests passed.
- `npm run type-check`, changed-file ESLint, and `git diff --check`: passed.

### R14 remediation — real-path safety evaluation

- `npm run eval:blog-info-v2` evaluates the required 10 adversarial topics entirely in memory and writes `reports/r14-safety-evaluation.json` plus `reports/r14-safety-summary.md`.
- Every case calls the real intent planner, structure contract, claim scanner, evidence validator, related-link ranker, CTA selector, renderer, and public-eligibility policy. Label-only variants and the same content with numeric claims but no evidence must be blocked.
- Result: 10/10 scenarios passed. Entry/visa and insurance remained `pending_review` and were rejected by the public-eligibility policy until human approval; the other eight valid structured fixtures were publishable.
- The evaluator records and asserts `externalCalls=0` and `publicMutations=0`; it does not call a model, API, database, publisher, cache revalidation, sitemap, or indexing path. Disposable Postgres verification remains a separate required gate.

### M11 — existing-post dry-run and owner handoff

- `npm run audit:blog-info-v2` has no apply mode. It reads the repository fallback snapshot by default or an explicitly supplied local JSON export and writes recommendation-only JSON/Markdown reports.
- The report contains article ID/slug, inferred intent, destination validity, representative duplicate group, missing facts, unsupported claims, render issues, CTA state, one of `KEEP|REWRITE|MERGE|REMOVE|HIGH_RISK_REVIEW`, confidence, and reasons.
- Default local snapshot result: 8 rows audited, 8 `REWRITE`, 0 DB reads, 0 DB writes, 0 external calls. This is an implementation proof, not an operating-database conclusion.
- Classification tests cover all five actions and assert the read-only counters. `--apply` is explicitly rejected.
- `docs/blog-informational-engine-v2-owner-runbook.md` documents CTA settings, sample evaluation, review/approval, tests, migration/staging order, production checklist, rollback, follow-up existing-post cleanup, and product-boundary verification in operator language.

### Final local verification

- Information-focused regression set: 24 files, 216 tests passed.
- Full repository regression set: 511 files, 3,611 tests passed, 0 failed, 0 skipped/todo/only.
- `npm run type-check`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed in 422 seconds; 390 static pages generated and postbuild output verification passed. The build-time blog sitemap read could not see the not-yet-applied eligibility view and was handled by the existing fail-safe path; no write was attempted.
- Migration safety checker: 11 remediation migrations checked, 0 issues. The three existing-table indexes use separate non-transactional `CREATE INDEX CONCURRENTLY` migrations.
- Disposable Postgres apply, RLS role matrix, concurrent publish, and failure injection remain blocked because the Docker command is unavailable. A 20-assertion local-only pgTAP contract is staged for `npx supabase test db --local supabase/tests/blog_information_publication_contract.sql`; no remote DB fallback was attempted.
- `npm run eval:blog-info-v2`: 10/10 PASS, external calls 0, public mutations 0.
- `npm run audit:blog-info-v2`: 8 local fallback rows audited, DB reads 0, DB writes 0, external calls 0.
- `git diff --check`: passed. No push, PR, deployment, remote DB mutation/fallback, public-row mutation, or secret output occurred.

## Manual QA

- [ ] Invalid destination route returns a real 404.
- [ ] Filter/search result pages emit explicit noindex/follow.
- [ ] High-risk draft remains non-public before human approval.
- [ ] CTA with missing/invalid URL is absent.
- [ ] Configured CTA is keyboard accessible and emits one impression/click event.
- [ ] List and detail show the same reading time for the same body.
- [ ] Mobile and desktop informational article layouts render without raw Markdown or overflow.
- [ ] Product detail, product landing, and product generation baselines are unchanged.

## Evidence To Report

- Test output and counts for each milestone.
- Typecheck, lint, build, and `git diff --check` results.
- Local migration apply/dry-run evidence.
- Machine-readable R14 safety evaluation report.
- M11 existing-post dry-run summary.
- Git log showing one commit per milestone and status showing unrelated files untouched.

## Approval Gates

- [x] No production money, booking, PII, credential, DB migration, or external publishing mutation is authorized.
- [x] No push, PR, deployment, remote DB access, or secret output is authorized.
- [x] Existing public content mutation is limited to a read-only dry-run report.
