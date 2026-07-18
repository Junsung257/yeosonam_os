# Verification: 출시 직전 P0 보안·고객 신뢰 게이트

## Automated Checks

```bash
npm run type-check
npm run lint
npx vitest run src/lib/admin-guard.test.ts src/app/api/packages/route.test.ts
```

추가되는 경계별 테스트를 같은 실행에 포함한다.

## Manual QA

- [ ] 익명 요청: 관리자 페이지/API 차단
- [ ] 일반 로그인 요청: 관리자 페이지/API 403 또는 로그인 경계로 차단
- [ ] 관리자 로그인/서버 토큰: 기존 관리자 업무 정상
- [ ] 공개 상품 GET: 공개 스냅샷 응답과 public cache 유지
- [ ] 관리자 상품 GET 및 dashboard: `private, no-store`
- [ ] 미인증 마이페이지: 허위 예약·마일리지·깨진 링크 없음
- [ ] production 오류 화면: raw message/stack 없음
- [ ] 카카오 문의: 실제 동의 전 `privacyConsent: true` 저장 없음

## Evidence To Report

- Test output: 통합 집중 테스트 8개 파일 40개 통과, 미들웨어·가드 회귀 4개 파일 44개 통과
- API response: 익명/만료 세션은 로그인 재인증, 일반 사용자는 403, 관리자는 통과; 민감 응답은 `private, no-store`
- DB/schema check: 변경 없음
- Screenshot/browser proof: 브라우저 연결 가능 시 현재 실행 캡처, 불가 시 미검증으로 명시
- Audit/eval/readiness result: `audit:sensitive-api-guards`, 변경 파일 ESLint, 전체 type-check, `git diff --check` 통과; 독립 통합 재검토에서 커밋 가능 판정

## Approval Gates

- [x] 원격 DB, 운영 money/booking/PII 데이터, 자격 증명, 외부 발행을 변경하지 않는다.
- [ ] 실제 운영 계정 수동 QA나 배포는 별도 명시 승인 후 수행한다.
