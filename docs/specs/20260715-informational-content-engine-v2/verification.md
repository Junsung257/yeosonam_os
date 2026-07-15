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
