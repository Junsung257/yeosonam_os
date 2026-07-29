# Revenue Rescue P0 Verification

검증 결과는 `docs/audits/20260729-revenue-rescue/outputs/`와 각 Draft PR 본문에 누적한다.

필수 게이트:

- finding applicability → unsafe reproduction → patch → negative regression → legitimate flow
- changed-file lint와 관련 typecheck
- cron authentication focused tests
- RLS·tenant isolation integration tests
- public-route Playwright tests
- lead submission, attribution dedupe, offer snapshot tests
- `npm audit --omit=dev --json`
- relevant build 또는 route compilation
- final diff audit

상태 값은 `FIXED`, `NO_CHANGE_ALREADY_SAFE`, `PARTIALLY_FIXED`, `BLOCKED`만 사용한다.
