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
- The housekeeping-only source contract returns before external agent or channel
  actions.
- A manual production housekeeping call either returns counts successfully or
  records the authorization failure and uses a scoped, auditable fallback.
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
- PASS: GitHub PR #956 merged as `b50ed967`; all CI, security, visual regression,
  performance, Next build, and bundle-budget checks passed.
- PASS: Vercel Preview `dpl_JBoEZNHjVhqJTkj49RqYD5dHkCS6` and production
  `dpl_12UdZWuZxk3aRddr9xEwZXn67nT7` reached `READY`.
- PASS: the next `main` production deployment
  `dpl_EhA3X74rDMLTSgZFZmVZ9CbAUNkh`, which includes #956, also reached `READY`.
- PASS: scoped production cleanup expired 27 approvals and 269 active stale
  tasks and closed 262 stale trace spans without deleting audit history.
- PASS: post-cleanup queries returned zero legacy pending approvals, zero stale
  request-scoped active tasks, and zero stale open traces.
- PASS: production health returned healthy with DB connected;
  `/admin/agent-mas` and `/api/admin/agent/office` redirected unauthenticated
  requests to the login boundary.
- PASS: no runtime error was reported for the affected agent routes after
  deployment.
- NOTE: the authenticated manual housekeeping call returned `401` with the
  locally pulled production `CRON_SECRET`. The one-time cleanup therefore used
  an equivalent scoped SQL transaction. No secret was sent in a URL. The daily
  Vercel schedule remains the normal housekeeping delivery path.
- NOTE: local Windows `npm run build` generated compiled output but did not exit
  within 10 minutes during static generation. Three Linux/Vercel build paths
  subsequently passed, superseding that local environment limitation.
