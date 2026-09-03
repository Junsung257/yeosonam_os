# Verification: 상품등록 V6 분석 전용 정규화와 복구 대상

## Automated Checks

```bash
npx vitest run src/lib/product-registration-v4/canonical-table-axis-binding.test.ts src/lib/product-registration-v6/analysis-recovery.test.ts src/lib/product-registration-v6/runtime-config.test.ts src/lib/product-registration-v6/readiness.test.ts src/lib/product-registration-v6/analysis-recovery-workflow-contract.test.ts
npm run type-check
npm run check:product-registration-contract
npm run check:agent-surfaces -- --spec 20260903-product-registration-v6-analysis-recovery --agent pr-v6-01-owner --base 26d760f2316347bf2f86cbb8ad9fde932835ce5e
npm run check:harness
$env:NEXT_BUILD_MAX_OLD_SPACE_SIZE='10240'; $env:NEXT_BUILD_RECOVERY_WAIT_MS='30000'; npm run build
git diff --name-only origin/main -- supabase/migrations
```

## Manual QA

- [x] 플래그 미설정 시 기존 V6 경로가 유지되는지 확인한다.
- [x] preview 분기가 normalize/revision/snapshot/publication보다 먼저 종료되는지 소스 계약으로 확인한다.

## Evidence To Report

- Test output: focused 25/25; regression 119/119; full 6,707 passed with 7 existing conditional skips
- API response: 해당 없음
- DB/schema check: migration 0, 원격 DB write 0
- Screenshot/browser proof: 고객 UI 변경 없음
- Audit/eval/readiness result: type-check, production build, touched lint, product contract/authority, surface map, harness all passed
- GitHub CI: PR #1257, implementation commit `18e748a3cf6dd54d8bb98706a2330b80f9fc6d6d`, all required and downstream checks passed

## Approval Gates

- [x] 운영 money, booking, PII, credential, DB migration, external publishing mutation을 수행하지 않는다.
