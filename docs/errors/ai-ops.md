# AI Ops Errors

Last updated: 2026-07-29

자비스, QA, RAG, LLM 라우팅, 프롬프트, eval, 학습 루프 반복 오류 상세.

_현재 분리된 AI 운영 상세 ERR 항목은 없다. 새 AI 운영 반복 오류는 이 파일에 추가한다._

## ERR-AI-OPS-STREAM-TERMINAL-AFTER-CLOSE

- Symptom: completed customer requests remain `running`; approvals and traces stay
  open for weeks.
- Root cause: the response stream was closed before task/trace terminal persistence.
  V2-to-V1 fallback also left its wrapper task running, and approvals had no default
  expiry.
- Prevention:
  - persist task and trace terminal state before closing a response stream;
  - default approvals to a seven-day expiry;
  - expire request-scoped stale tasks and stale traces in bounded housekeeping;
  - do not mark an approval `resumed` without a persisted resumable run state.
- Regression coverage:
  `src/lib/agent/stream-lifecycle-contract.test.ts` and
  `src/lib/agent/lifecycle-policy.test.ts`.

## ERR-AI-OPS-CRON-SENSITIVE-ENV-PULL

- Symptom: a manual production cron call returns `401` even though
  `CRON_SECRET` is configured in Vercel and scheduled invocations work.
- Root cause: sensitive production variables are not guaranteed to be included
  in a local `vercel env pull`; the caller sent an empty bearer token.
- Prevention:
  - trigger registered production crons with `vercel crons run <path>`;
  - use a dedicated side-effect boundary for manual maintenance operations;
  - declare required local variables with `run-with-vercel-env.mjs --require-env`
    so a missing secret fails before the child command starts;
  - never weaken cron authentication or pass the secret in a query string.
- Regression coverage:
  `src/app/api/cron/agent-housekeeping/route.test.ts` and
  `src/lib/agent/stream-lifecycle-contract.test.ts`.
