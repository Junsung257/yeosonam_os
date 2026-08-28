# Verification Record

## 후보 기준

- Worktree: `C:\dev\yeosonam-os-production-release-20260828`
- Base: `origin/main` / `75aba6248ff3ef997561c2e28ce3ee3fcc432037`
- Original worktree preservation: 948 status lines confirmed

## 통과한 검사

- `npm ci --ignore-scripts` — 성공; npm audit reported 0 vulnerabilities. 기존 deprecation notices는 별도 정리 대상이다.
- `npm run type-check` — 성공
- `npm run lint` — 성공, max warnings 0
- `npx vitest run --testTimeout=30000` — 855 files passed; 6,393 tests passed; 7 skipped
- focused OAuth/RFQ/security tests — 3 files, 13 tests passed
- `npm run build` with `NODE_OPTIONS=--max-old-space-size=12288` — 성공; 396 static pages; postbuild `.next`, shim, server aliases, rhwp runtime verification 성공
- `git diff --check` — 성공
- `npm run audit:sensitive-api-guards` — 성공; unguarded sensitive API route 없음
- `npm run lint:secrets:all` — 성공; direct `process.env` key access violation 없음
- `npm run audit:migration-prefix:ci` — 성공; 16 historical collisions, 0 new/unbaselined collisions
- `npm run audit:pii-surface:strict` — 성공; strict blockers 0
- `npm run check:deps:circular` — exit 0; 0 errors/0 warnings, 39 informational dependency violations
- 독립 읽기 전용 보안 재검토 — High 0; tenant fallback, actorless OAuth, fake Twitter success, metadata loss, concurrent claim, lease replay, ambiguous-response replay 항목 확인. 최종 후보에서 ambiguous external failure는 `needs_reconcile`로 격리.

## 추가 live readiness probe

- 연결된 Supabase active project `ixaxnvbmhzjvupissmly`를 읽기 전용으로 확인했다.
- pre-migration live migration 최신 항목은 `20260828103551_media_assets_rls_and_fk_hardening`이었다.
- pre-migration에는 `oauth_states`, `tenant_memberships`, publish claim 컬럼이 없었다.
- pre-migration의 `content_distributions`, `social_platform_configs`, `tenant_api_tokens`는 RLS가 켜져 있지만 browser role grant가 넓고, `content_distributions_auth_select` 및 `social_platform_configs_auth_select_safe` 같은 historical authenticated policy가 확인됐다.
- 현재 애플리케이션의 해당 접근은 guarded server route와 `supabaseAdmin`으로만 수행되므로 `20260828140000_sensitive_marketing_access_hardening.sql`에서 browser role 권한/정책을 제거하도록 추가했다.
- live project의 tenant/token/content 관련 표본 row 수는 0으로 확인되어 migration 사전 조건 probe를 통과했다.

## Production migration 적용 결과

- Supabase active project `ixaxnvbmhzjvupissmly`에 네 migration을 순서대로 적용했다.
- 원격 migration history에는 `oauth_states_and_tenant_memberships`, `social_publishing_hardening`, `sensitive_marketing_access_hardening`이 기록됐다.
- 후속 `oauth_states_service_role_policy` migration도 적용했고, `oauth_states`에 `service_role` 전용 `FOR ALL` RLS policy가 확인됐다.
- post-migration probe에서 `oauth_states`, `tenant_memberships`, publish claim 컬럼, `needs_reconcile`, Twitter provider 제약, claim index가 모두 확인됐다.
- 대상 내부 테이블 5개는 RLS가 활성화됐고 `content_distributions`, `social_platform_configs`, `tenant_api_tokens`에는 anon/authenticated grant와 browser-role policy가 없으며 service-role policy만 유지된다.
- Supabase security advisor는 저장소 전체의 기존 INFO/WARN/ERROR 항목을 반환했다. 이번 migration 대상에 새로 발생한 browser-access finding은 확인되지 않았다.

## Production runtime environment

- Vercel project `yeosonam` Production에서 `OAUTH_STATE_SECRET` 존재와 64자 길이를 확인했다.
- 운영 DB의 `Product Registration Platform` tenant UUID를 `NEXT_PUBLIC_DEFAULT_TENANT_ID`로 provision했고, 실제 값은 문서·로그에 기록하지 않았다.

## 환경 의존 또는 보류된 검사

- `npm run audit:select-cols:ci` — `NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY` 미설정으로 실행 불가. 운영 credential 환경에서 재실행 필요.
- Supabase CLI — local environment에 설치되어 있지 않아 migration을 CLI로 dry-run하지 못함.
- live Supabase RLS/grant/role/membership probe — 읽기 전용 pre/post 검증을 완료했다.
- `audit:supabase-client-boundary` 및 `audit:api-response` — clean 기준 branch의 package scripts에 없어 실행 불가.
- Build 중 sitemap — local build에 `SUPABASE_SERVICE_ROLE_KEY`가 없어 pointer-only package catalog를 생략했다는 경고가 있었으나 build/postbuild는 성공했다.
- `pptxgenjs -> image-size` dependency advisory — 사용자 요청으로 보류.

## 배포 상태

코드 후보 구현, 로컬 검증, production DB migration 4건, 필수 runtime env provision은 완료했다. 아직 production deploy와 push/PR/merge, tenant별 verified social target metadata provision, preview 시나리오 검증은 남아 있다.
