# Agent Runtime Hardening Verification

## Required Checks

- Focused Vitest tests for agent lifecycle, approvals, office projection, and
  affected streaming routes.
- `npm run check:agent-workflow:ci`
- `npm run audit:agent-patterns`
- `npm run verify:jarvis-readiness`
- `npm run verify:jarvis-all-scenarios`
- `npm run verify:customer-inquiry`
- `npm run type-check`
- `npm run lint`
- `npm run build`

## Production Evidence

- Existing deployment remains healthy before change.
- Agent executor returns housekeeping counts without errors.
- Housekeeping-only execution returns before external agent or channel actions.
- A post-cleanup read query shows no legacy pending approvals, stale
  request-scoped active tasks, or stale open traces within processed bounds.
- `/admin/agent-mas` remains admin-guarded and its API remains admin-only.
- Production health endpoint returns healthy after deployment.

## Result

Pre-deployment verification on 2026-07-29:

- PASS: focused lifecycle and office tests, 9 files and 35 tests.
- PASS: full Vitest suite, 615 files and 4,770 tests.
- PASS: agent workflow contract and risk-pattern audit.
- PASS: TypeScript and full ESLint with zero warnings.
- PASS: production-env Jarvis readiness, 100/100.
- PASS: production-env all-scenarios readiness, 100/100.
- PASS: live RAG index audit, 99/100 ready.
- INCOMPLETE: local Windows `npm run build` generated compiled output but did
  not exit within 10 minutes during Next static generation. The remaining build
  gate is the repository's Vercel preview/production build.
- PENDING: production deployment, housekeeping-only execution, and post-cleanup
  database and HTTP checks.
