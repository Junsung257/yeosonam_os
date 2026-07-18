# Feature Spec: 출시 직전 P0 보안·고객 신뢰 게이트

## Goal

고객 공개 직전에 확인된 관리자 권한 우회, 인증별 응답 캐시 혼합, 허위 고객 데이터 노출, 오류 정보 노출, 개인정보 동의 위반 가능성을 제거한다. 관리자는 기존 방식으로 정상 업무를 계속할 수 있고, 고객 공개 조회는 승인된 공개 스냅샷만 유지해야 한다.

## Success Criteria

- [ ] 일반 인증 사용자는 `/admin`, `/m/admin` 및 관리자 전용 API·데이터에 접근할 수 없다.
- [ ] `/api/packages`의 관리자용 응답은 공유 캐시에 저장되지 않으며 공개 응답과 섞이지 않는다.
- [ ] 상품 생성·수정·상태 변경·삭제는 route-local 관리자 권한 검사를 통과해야 한다.
- [ ] `/api/dashboard` 재무·운영 KPI는 관리자만 조회하며 공유 캐시를 사용하지 않는다.
- [ ] `/mypage`는 인증·실데이터 없이 가짜 예약/마일리지를 표시하지 않고 존재하지 않는 링크를 만들지 않는다.
- [ ] production 오류 화면은 raw message/stack을 고객에게 노출하지 않는다.
- [ ] 카카오 문의는 명시적 동의 없이 `privacyConsent: true`를 저장하지 않는다.
- [ ] 관리자 정상 흐름과 고객 공개 상품 조회는 기존 응답 계약을 유지한다.

## In Scope

- 관리자 페이지 서버 경계와 `/api/packages`, `/api/dashboard` 권한·캐시 경계
- 고객 마이페이지의 인증/실데이터/빈 상태 계약
- 전역·패키지 오류 화면의 production 정보 노출 방지
- 패키지 상세 카카오 문의의 개인정보 동의 계약
- 각 경계를 증명하는 최소 회귀 테스트

## Out Of Scope

- 관리자 RBAC 체계 전면 재설계
- 상품 공개 스냅샷 아키텍처 변경
- 운영 DB/RLS 변경 또는 원격 마이그레이션 적용
- 디자인 전면 개편
- 이번 감사에서 새로 발견되는 P1/P2 개선

## Users And Risks

- Primary audience: 고객, 플랫폼 관리자, 운영자
- Risk tier: Tier 3
- Sensitive surfaces: PII, money, bookings, admin authorization, service-role reads, authenticated caching

## Open Questions

- [ ] 없음. 기존 `requireAdminRequest`/`ADMIN_EMAILS`, 공개 상품 스냅샷, 명시적 개인정보 동의 정책을 그대로 보존한다.
