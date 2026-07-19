# Feature Spec: Backend Immediate P0 Boundaries

## Goal

고객 출시 전에 예약 생성, 금융 키 발급, voucher 변경, 외부 webhook 수신의 즉시 악용 가능한 신뢰 경계를 기존 인증 도구로 차단한다. 공개 또는 일반 인증 요청이 관리자/서버 권한 작업과 고객 PII 조회 범위를 넘지 못하게 한다.

## Success Criteria

- [x] `POST /api/bookings`는 rate limit, body parse, DB 접근 전에 관리자 또는 `x-admin-token` 서버 요청을 요구한다.
- [x] Slack은 공식 HMAC 서명을 검증하고 Kakao channel skill은 관리자센터의 정적 `x-api-key`를 검증한다. 운영 환경에서 secret이 없으면 side effect 없이 503을 반환한다.
- [x] Slack URL verification을 포함한 모든 payload는 challenge 응답 전에 서명을 검증한다.
- [x] `POST /api/billing/issue-billing-key`는 Toss 호출과 DB 접근 전에 관리자 또는 서버 요청을 요구한다.
- [x] Voucher POST/PATCH는 관리자 또는 서버 요청만 허용한다.
- [x] Guide-token voucher GET은 token의 booking/voucher scope와 조회 파라미터를 대조해 다른 voucher를 읽을 수 없다.
- [x] 일반 로그인 사용자는 소유권 증거 없이 voucher를 조회할 수 없고, 모바일 guide는 token의 voucher/booking scope를 함께 검증한다.
- [x] 호출자가 보낸 금액·PII 값을 신뢰하던 미사용 checkout complete endpoint는 검증된 결제 레코드 기반 재설계 전까지 503으로 차단한다.
- [x] Middleware는 billing/voucher의 유효한 `x-admin-token`을 route-local guard까지 전달한다.
- [x] 악성 요청과 기존 정상 요청을 같은 route boundary 테스트로 입증한다.
- [x] 관련 SSOT는 `docs/agent-workflow-current-ssot.md`, `.claude/rules/api-routes.md`, `.claude/rules/booking-system.md`를 따른다.

## In Scope

- `src/app/api/bookings/route.ts` POST route-local admin guard
- Slack 공식 HMAC 및 Kakao 정적 `x-api-key` fail-closed 검증
- Billing-key route-local admin guard
- Voucher POST/PATCH admin/server guard와 guide-token/admin-only GET scope 결합 검증
- Checkout complete 임시 fail-closed와 모바일 guide voucher scope 검증
- Billing/voucher server-token middleware pass-through
- 각 경계의 focused regression tests

## Out Of Scope

- RFQ, tenant portal, tracking/mileage 정상화
- DB/RLS/migration 변경
- Guidebook token 서명 구현 또는 secret registry 변경
- Checkout의 결제 공급자 검증 기반 정상 기능 복구

## Users And Risks

- Primary audience: admin, server integration, customer guidebook user
- Risk tier: Tier 3
- Sensitive surfaces: bookings, money, credentials, customer PII, external webhooks

## Open Questions

- [x] None. 이번 변경은 기존 repository-native guard를 부모 작업 경계로 적용하는 즉시 차단 범위로 확정했다.
