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
- Machine-readable M10 evaluation report.
- M11 existing-post dry-run summary.
- Git log showing one commit per milestone and status showing unrelated files untouched.

## Approval Gates

- [x] No production money, booking, PII, credential, DB migration, or external publishing mutation is authorized.
- [x] No push, PR, deployment, remote DB access, or secret output is authorized.
- [x] Existing public content mutation is limited to a read-only dry-run report.
