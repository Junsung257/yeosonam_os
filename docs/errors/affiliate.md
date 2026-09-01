# Affiliate Errors

Last updated: 2026-09-01

제휴 귀속, 추천코드, 인플루언서, 커미션 배정 반복 오류 상세.

## ERR-AFF-20260901-CRON-AUTH-DOMINANCE

- **증상:** 제휴 이상탐지 Cron이 인증을 확인하기 전에 환경 설정 상태를 읽고 응답해, 비인가 호출이 내부 구성 상태를 구분할 수 있었다.
- **원인:** 인증 가드가 핸들러의 첫 실행 경계가 아니었다.
- **재발 방지:** 외부에서 호출 가능한 Cron은 신뢰된 인증 가드를 첫 실행문으로 두고 실패 시 즉시 반환한다. 설정 확인, 시간 측정, DB 접근은 인증 뒤에만 수행한다.
- **검증:** `npm run audit:automation-runtime:ci`의 AST 기반 지배성 검사에서 `src/app/api/cron/affiliate-anomaly-detect/route.ts`가 통과해야 한다.
