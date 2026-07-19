# Implementation Plan: 출시 직전 P0 보안·고객 신뢰 게이트

## Approach

각 취약 경계의 실제 호출 지점에서 기존 관리자 인증 헬퍼와 비공개 캐시 정책을 강제한다. 고객 화면은 허위 fallback을 제거하고 인증·실데이터·동의 여부를 명시적으로 구분한다. 먼저 실패하는 계약 테스트를 추가하고, 가장 작은 수정으로 경계를 닫은 뒤 우회 경로와 정상 흐름을 함께 검증한다.

## Impact Areas

- Code: `src/app/admin`, `src/app/m/admin`, `src/app/api/packages`, `src/app/api/dashboard`, `src/lib/admin-guard.ts`, `src/app/mypage`, 오류 경계, 패키지 상세 문의 CTA
- Data/API: 스키마 변경 없음. 관리자 API 401/403 및 Cache-Control 계약 강화, lead 생성 동의 의미 보존
- UI: 미인증/미구현 마이페이지 상태, 고객용 오류 메시지, 카카오 문의 동의 흐름
- Docs/tests: 이 feature packet과 보안·고객 신뢰 회귀 테스트

## Required SSOT

- `AGENTS.md`
- `CURRENT_STATUS.md`
- `.claude/CLAUDE.md`
- `docs/agent-workflow-current-ssot.md`
- `docs/product-registration-current-ssot.md`

## Data Flow

요청 쿠키/관리자 토큰은 기존 검증기에서 관리자 여부로 확정된 뒤에만 service-role 조회와 변경 로직으로 이동한다. 공개 상품 조회는 공개 스냅샷으로 제한하고 공개 캐시를 허용하되, 관리자 응답은 `private, no-store`로 분리한다. 고객 마이페이지는 인증된 실데이터만 렌더하며, 문의 lead의 개인정보 동의 값은 실제 고객 선택에서만 생성한다.

## Risks And Guardrails

- 관리자 업무 차단: 기존 관리자 이메일·서버 토큰·개발 전용 우회 계약의 양성 테스트를 유지한다.
- 공개 상품 성능 저하: 공개 응답만 기존 CDN 캐시를 유지한다.
- 캐시 혼합: 인증 상태에 따라 응답 헤더를 명시적으로 분기하고 관리자 응답은 공유 캐시 금지한다.
- PII 오수집: 고객의 명시적 동의 없이는 동의 완료로 기록하지 않는다.
- 범위 팽창: DB/RLS·RBAC 전면 개편 없이 확인된 P0 경계만 수정한다.
