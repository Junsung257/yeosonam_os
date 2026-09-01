# Marketing Errors

Last updated: 2026-09-01

Marketing automation, Ad OS, campaign actions, external ad-platform writes, card-news distribution, spend guardrails, and marketing dashboard repeated errors.

## ERR-MARKETING-20260901-CRON-AUTH-DOMINANCE

- **증상:** 일일 마케팅 Cron이 인증 확인 전에 실행 시각을 계산해, 인증 가드보다 먼저 애플리케이션 작업이 시작됐다.
- **원인:** 인증 호출이 존재한다는 사실만 확인하고 첫 실행 경계를 보장하지 않았다.
- **재발 방지:** `withCronLogging`의 실제 핸들러 인수 안에서 신뢰된 인증 가드가 첫 실행문이어야 하며, 실패 시 즉시 반환한다. 데코이 인수·별칭 import·주석은 검증 근거로 인정하지 않는다.
- **검증:** `npm run audit:automation-runtime:ci`의 AST 기반 지배성 검사에서 `src/app/api/cron/daily-marketing/route.ts`가 통과해야 한다.
