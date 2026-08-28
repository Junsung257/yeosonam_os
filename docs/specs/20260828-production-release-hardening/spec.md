# Production Release Hardening Specification

## 목적

서로 섞여 있던 기존 작업 폴더를 production 기준에서 분리하고, 테넌트 경계·OAuth state·RFQ 입찰/제안·외부 토큰·소셜 발행 큐의 고위험 경로를 배포 가능한 후보로 정리한다.

## 기준점

- 기준 커밋: `origin/main` = `c8c30b21d2c67d434ad6131ae45e389a71b7590b`
- 후보 브랜치: `codex/production-release-20260828`
- 후보 worktree: `C:\dev\yeosonam-os-production-release-20260828`
- 원본 작업 폴더: `C:\dev\yeosonam-os` — 기존 948개 변경을 수정·삭제하지 않고 보존

## 구현 범위

1. OAuth state를 중앙화하고, 강한 HMAC·provider/scope/tenant 검증·10분 TTL·1회 소비·human actor binding을 적용한다.
2. `tenant_memberships`와 tenant portal authorization을 추가해 RFQ/토큰/OAuth 경로의 tenant ID를 요청 body나 임의 metadata에서 신뢰하지 않도록 한다.
3. RFQ tenant 조회를 공개 상태와 own bid로 제한하고, bid/proposal read-write에 tenant/rfq/bid exact predicate를 적용한다.
4. 공개 proposal collection을 admin-only로 제한하고, 공유 RFQ 응답에서 token·PII·상업/AI 내부 필드를 제거한다.
5. 빈 tenant ID가 전체/첫 tenant로 해석되지 않도록 token resolver와 marketing orchestration을 fail-closed로 정리한다.
6. 소셜 큐에 tenant별 token/account binding과 atomic publishing lease를 적용하고, tenant 발행이 platform credential로 fallback하지 않도록 한다.
7. 구현되지 않은 Twitter user-context 경로는 fake success를 반환하지 않고 재시도 가능한 실패로 남긴다.
8. 외부 요청 후 응답이 불명확한 실패는 `needs_reconcile`에 보존하고 자동 재승인하지 않는다.

## 의도적 비범위

- 원본 dirty worktree의 948개 변경을 자동 병합·삭제·reset하지 않는다.
- 원격 Supabase migration, production deploy, push, PR merge를 이 작업에서 실행하지 않는다.
- `pptxgenjs -> image-size` advisory는 사용자 결정대로 보류한다.
- 기존 전체 RLS 정책의 live schema 검증과 production 환경변수 검증은 원격 승인 게이트로 남긴다.

## 운영 안전 조건

테넌트 소셜 발행은 `tenant_api_tokens.metadata`에 플랫폼별 target account ID가 명시되어 있고 해당 token으로 검증된 경우에만 허용한다. Meta/Instagram/Facebook/Naver 계정 ID를 전역 환경변수에서 재사용하지 않는다. metadata가 없으면 연결 성공으로 간주하지 않고 발행을 중단한다.
