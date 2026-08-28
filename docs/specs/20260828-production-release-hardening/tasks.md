# Production Release Hardening Tasks

## 완료

- [x] production 기준 clean worktree와 별도 release branch 구성
- [x] 원본 dirty worktree 948개 변경 보존 확인
- [x] OAuth state HMAC/TTL/provider/scope/tenant/one-time consume 구현
- [x] platform OAuth human actor binding 구현
- [x] tenant memberships와 tenant portal authorization 구현
- [x] tenant RFQ sanitization 및 공개 상태 제한 구현
- [x] RFQ bid/proposal exact authorization repository 구현
- [x] generic proposal public leak 차단
- [x] tenant token resolver empty/fallback 경로 차단
- [x] social publishing tenant credential/account boundary 구현
- [x] social queue atomic publishing lease migration/code 구현
- [x] lease 만료 후 자동 재발행 차단 및 수동 reconcile 정책 적용
- [x] 외부 응답 불명확 실패의 `needs_reconcile` 격리 적용
- [x] Twitter fake success 제거
- [x] Meta refresh metadata 보존
- [x] focused security tests 및 전체 Vitest 통과
- [x] type-check, lint, production build/postbuild 통과
- [x] 보안 정적 검사 결과 기록
- [x] live probe에서 확인한 내부 마케팅 테이블의 browser-role grant/policy 잔존을 후보 migration으로 격리

## 배포 전 승인/수동 확인

- [x] live Supabase schema·grant·RLS·tenant membership probe (pre/post migration validation complete)
- [x] 네 forward/reconciliation migration을 production Supabase에 적용 및 단계별 검증
- [x] production `OAUTH_STATE_SECRET` 설정 확인 및 rotation 기록 유지 (64자, 기존 값 변경 없음)
- [ ] tenant별 verified social target account metadata provision
- [x] `NEXT_PUBLIC_DEFAULT_TENANT_ID`를 실제 platform tenant UUID로 Production provision 및 비노출 검증
- [ ] 운영 Supabase credentials로 `audit:select-cols:ci` 재실행
- [ ] preview에서 tenant cross-access/OAuth replay/queue double-worker 시나리오 실행
- [ ] Vercel production deploy 및 health/observability 확인
- [ ] push/PR/merge 승인

## 보류

- [ ] `pptxgenjs -> image-size` advisory — 사용자 보류
- [x] live RLS broad-policy remediation candidate migration 작성·Production 적용 (`20260828140000`)
- [ ] Twitter OAuth user-context publisher 구현
