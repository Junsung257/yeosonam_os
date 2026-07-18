# Verification: Backend Immediate P0 Boundaries

## Automated Checks

```bash
npx vitest run <focused backend P0 route tests>
npm run type-check
```

## Manual QA

- [x] 모든 새 권한 검사가 body parse, 외부 호출, DB side effect보다 먼저 실행된다.
- [x] Slack의 유효한 서명 challenge는 기존 응답 계약을 유지한다.
- [x] Kakao 관리자센터의 정적 `x-api-key`가 일치하는 메시지만 정상 경로로 전달한다.
- [x] Booking A의 guide token으로 voucher ID를 섞어 Booking B의 voucher를 읽을 수 없다.
- [x] 일반 로그인 사용자의 임의 voucher 조회는 DB 접근 전에 차단된다.
- [x] 유효한 `x-admin-token`은 billing/voucher middleware를 통과한다.
- [x] Checkout complete는 body, 금액, PII를 처리하기 전에 503으로 닫힌다.
- [x] Guide-token voucher GET과 `/m/guide/[token]`은 middleware를 통과하되 route/page 내부 검증을 거친다.
- [x] Voucher CRUD와 알림 조회는 service-role client를 사용하며 anon client를 사용하지 않는다.

## Evidence To Report

- Test output: vulnerable baseline 8 failed/6 passed; final expanded backend/security suite 11 files / 108 tests passed
- Independent integration review: 8 files / 51 tests passed; no remaining release blocker found
- API response: route tests assert 401/403/503 and valid 2xx controls
- DB/schema check: no DB change or live mutation
- Screenshot/browser proof: API-only change; not applicable
- Static checks: `git diff --check`, changed-file ESLint, and full `npm run type-check` passed after the final middleware/client adjustment

## Approval Gates

- [x] Production money, booking, PII, credential, DB migration, or external publishing mutation을 수행하지 않았다.
- [x] 모든 DB 및 외부 side effect는 테스트에서 mock 처리했다.
