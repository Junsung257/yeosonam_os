# Verification Record

## 후보 기준

- Worktree: `C:\dev\yeosonam-os-production-release-20260828`
- Base: `origin/main` / `c8c30b21d2c67d434ad6131ae45e389a71b7590b`
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
- live migration 최신 항목은 `20260828103551_media_assets_rls_and_fk_hardening`이며 후보의 `20260828120000`, `20260828130000`은 아직 적용되지 않았다.
- `oauth_states`, `tenant_memberships`, publish claim 컬럼은 live에 아직 없다.
- `content_distributions`, `social_platform_configs`, `tenant_api_tokens`는 RLS가 켜져 있지만 browser role grant가 넓고, `content_distributions_auth_select` 및 `social_platform_configs_auth_select_safe` 같은 historical authenticated policy가 확인됐다.
- 현재 애플리케이션의 해당 접근은 guarded server route와 `supabaseAdmin`으로만 수행되므로 `20260828140000_sensitive_marketing_access_hardening.sql`에서 browser role 권한/정책을 제거하도록 추가했다.
- live project의 tenant/token/content 관련 표본 row 수는 0으로 확인되어 migration 사전 조건 probe는 통과했지만, 실제 적용은 별도 승인 후 수행한다.

## 환경 의존 또는 보류된 검사

- `npm run audit:select-cols:ci` — `NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY` 미설정으로 실행 불가. 운영 credential 환경에서 재실행 필요.
- Supabase CLI — local environment에 설치되어 있지 않아 migration을 CLI로 dry-run하지 못함.
- live Supabase RLS/grant/role/membership probe — 읽기 전용으로 수행했고, pre-migration 상태와 browser-role 권한/historical policy 잔존을 확인했다. 원격 DB 변경 권한/승인이 없으므로 migration은 적용하지 않았다.
- `audit:supabase-client-boundary` 및 `audit:api-response` — clean 기준 branch의 package scripts에 없어 실행 불가.
- Build 중 sitemap — local build에 `SUPABASE_SERVICE_ROLE_KEY`가 없어 pointer-only package catalog를 생략했다는 경고가 있었으나 build/postbuild는 성공했다.
- `pptxgenjs -> image-size` dependency advisory — 사용자 요청으로 보류.

## 배포 상태

코드 후보 구현과 로컬 검증, live read-only probe는 완료했지만 production DB migration 3건, secret/tenant account provisioning, production deploy/push/merge는 아직 실행하지 않았다. 이 항목들이 승인·확인되기 전에는 production 완료로 표시하지 않는다.
