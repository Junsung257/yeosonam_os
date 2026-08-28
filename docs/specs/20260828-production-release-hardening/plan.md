# Production Release Hardening Plan

## 순서

### A. 후보 격리

- `origin/main` exact SHA로 clean worktree를 만든다.
- 원본 worktree의 변경 수와 staged 상태를 기록하고 손대지 않는다.
- 후보 브랜치에서만 수정·검증한다.

### B. 애플리케이션 보안 경계

- 중앙 OAuth state와 actor binding을 먼저 배포한다.
- tenant membership/role authorization을 tenant RFQ와 OAuth start/callback에 연결한다.
- RFQ repository를 service-role 내부 repository로 모으고 모든 호출에 exact predicate를 사용한다.
- 토큰 resolver는 유효한 UUID tenant만 허용하고 platform job은 명시적 default tenant만 사용한다.

### C. DB forward migration

운영 승인 후 아래 migration을 먼저 적용한다.

1. `20260828120000_oauth_states_and_tenant_memberships.sql`
2. `20260828130000_social_publishing_hardening.sql`

적용 전 live schema/role/RLS probe와 migration dry-run을 실행하고, 실패 시 migration을 적용하지 않는다. 두 migration은 아직 원격에 적용하지 않았다.

### D. 소셜 credential 운영 준비

- `OAUTH_STATE_SECRET`을 production secret manager에 고엔트로피 값으로 등록한다.
- 각 tenant의 `tenant_memberships`를 실제 관리자/직원 UUID와 함께 provision한다.
- 각 tenant OAuth token의 metadata에 검증된 `instagram_business_account_id`, `facebook_page_id`, `threads_user_id`, `naver_cafe_id`를 기록한다.
- 계정 ID가 없는 tenant는 social queue를 활성화하지 않는다.
- Twitter user-context publisher를 구현하기 전에는 tenant/platform OAuth token 경로를 성공으로 표시하지 않는다.
- `publishing` lease 만료 행은 자동 재발행하지 않고 외부 계정 결과를 확인한 뒤 수동 reconcile한다.
- 외부 API 요청 후 응답 유실/파싱 실패는 `needs_reconcile`로 격리하고 확정된 외부 결과 확인 뒤에만 `approved`로 되돌린다.

### E. 릴리스 검증

- type-check, lint, focused security tests, full Vitest, sensitive API/env/migration/PII audits를 실행한다.
- 운영 Supabase credentials가 있는 별도 환경에서 select-column audit와 RLS/role probe를 실행한다.
- build와 postbuild artifact verification을 수행한다.
- preview에서 tenant A/B cross-read, OAuth replay/actor mismatch, queue double-worker, credential fallback 시나리오를 확인한다.

### F. 배포 승인 및 rollback

- 현재 후보 브랜치의 분할 커밋을 리뷰 후 push/PR/merge 승인한다.
- DB migration 적용 성공을 확인한 뒤 application release를 promote한다.
- health check, OAuth callback, tenant RFQ, social queue metrics를 관찰한다.
- 이상 시 application을 직전 production commit으로 rollback하고, migration은 forward-compatible이므로 데이터 삭제 없이 기능 flag/queue disable로 완화한다.
