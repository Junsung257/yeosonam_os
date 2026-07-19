# Implementation Plan: Backend Immediate P0 Boundaries

## Approach

관리자 전용 route의 가장 앞단에 기존 `requireAdminRequest`를 적용한다. Webhook은 공급자가 실제로 지원하는 인증 계약과 secret 존재 여부를 분리해 검증하고, 운영 환경의 설정 누락은 fail-closed로 처리한다. Voucher guide token은 요청 방식별 scope를 계산하고 조회 결과가 token의 booking/voucher와 연결되는지 다시 검증한다.

## Impact Areas

- Code: bookings, Slack/Kakao webhook, billing key, voucher, checkout complete, guide page, middleware
- Data/API: 인증 실패 401/403, 안전하지 않은 checkout 503, guide scope 불일치 차단
- UI: guide-token 진입 경로 외 시각 변경 없음
- Docs/tests: feature packet과 route/middleware/DB regression tests

## Required SSOT

- `AGENTS.md`
- `CURRENT_STATUS.md`
- `.claude/rules/api-routes.md`
- `.claude/rules/booking-system.md`
- `docs/agent-workflow-current-ssot.md`

## Data Flow

1. 관리자/서버 mutation 요청은 기존 admin guard를 통과한 뒤에만 body parsing과 외부/DB side effect로 진행한다.
2. Webhook은 raw body와 공급자 지원 인증값을 검증한 뒤에만 payload 처리와 DB ingest로 진행한다.
3. Voucher guide GET은 token scope와 조회 방식을 대조하고, 조회된 row가 token의 booking/voucher와 정확히 연결되는지 재검증한다.
4. Voucher 서버 작업은 service-role client를 사용하되 route/page의 token 또는 admin 검증 이후에만 호출한다.

## Risks And Guardrails

- 정상 admin UI/서버 호출 회귀: cookie와 `x-admin-token` 경로를 모두 regression test로 보존한다.
- Slack challenge 회귀: 유효하게 서명된 challenge의 기존 응답을 유지한다.
- 개발 webhook 회귀: 설정 누락 허용 범위는 localhost로만 제한한다.
- Voucher token 혼합 조회: ID 조회와 booking 조회를 별도로 검증하고 결과 row까지 재확인한다.
- Checkout 신뢰 경계: 공급자/DB 기반 결제 검증이 구현될 때까지 endpoint를 비활성화한다.
