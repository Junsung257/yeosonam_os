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
- The dedicated housekeeping route has no external agent or channel action
  dependency.
- A native Vercel production cron invocation returns housekeeping counts without
  downloading `CRON_SECRET`.
- A post-cleanup read query shows no legacy pending approvals, stale
  request-scoped active tasks, or stale open traces within processed bounds.
- `/admin/agent-mas` remains admin-guarded and its API remains admin-only.
- Production health endpoint returns healthy after deployment.

## Result

Pre-deployment verification on 2026-07-29:

- PASS: focused lifecycle and office tests, including the dedicated cron route,
  authentication short-circuit, failure boundary, and Vercel schedule contract.
- PASS: full Vitest suite, 617 files and 4,782 tests.
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
- ROOT CAUSE: the original manual housekeeping call returned `401` because a
  sensitive production `CRON_SECRET` was absent from the local Vercel env pull.
  The route's production secret remained configured; the local caller sent an
  empty bearer.
- REMEDIATION: `/api/cron/agent-housekeeping` is a dedicated native Vercel cron
  with no external action dependency. Operators invoke it with
  `vercel crons run`, which supplies authentication server-side. Local env-backed
  commands can now require variables and fail before execution when a sensitive
  value is unavailable.
- PASS: the missing-required-variable probe exited before its child command,
  without reading or printing a secret.
- PASS: TypeScript, full ESLint, direct-secret access audit, agent workflow,
  agent risk-pattern, documentation, and Vercel function-budget checks.
- PENDING: execute the dedicated cron after deployment and record the final
  runtime and database evidence.
- NOTE: local Windows `npm run build` generated compiled output but did not exit
  within 10 minutes during static generation. Three Linux/Vercel build paths
  subsequently passed, superseding that local environment limitation.
