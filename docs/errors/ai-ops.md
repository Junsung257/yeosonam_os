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
