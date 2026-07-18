# Tasks: 출시 직전 P0 보안·고객 신뢰 게이트

- [x] Tier 3, SSOT, 출시 차단 수용 기준을 확인한다.
- [x] 관리자 페이지·상품 변경 API·대시보드 API의 실패/성공 회귀 테스트를 먼저 추가한다.
- [x] 관리자 페이지 서버 경계와 route-local 권한 검사를 적용한다.
- [x] 관리자용 상품·대시보드 응답을 `private, no-store`로 분리한다.
- [x] 마이페이지의 하드코딩 데이터와 깨진 voucher 링크를 제거하고 안전한 인증/빈 상태를 제공한다.
- [x] production 오류 화면에서 raw message/stack 노출을 제거한다.
- [x] 카카오 문의의 명시적 개인정보 동의 계약을 복구한다.
- [x] 변경 경계별 집중 테스트와 전체 type-check/build 관련 검증을 수행한다.
- [x] 보안 우회 재검토와 정상 관리자·고객 공개 흐름 보존을 확인한다.
- [x] 검증 증거와 수동/승인 게이트 잔여 항목을 기록한다.

## Parallel Candidates

- [x] Lane A: 관리자 페이지·상품/대시보드 API 권한과 캐시
- [x] Lane B: 마이페이지·오류 경계
- [x] Lane C: 카카오 문의 개인정보 동의와 lead 계약

## Commit Boundary

- Commit group: tests, backend-security, frontend-trust, docs
