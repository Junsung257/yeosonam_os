# Revenue Rescue P0 Tasks

## Phase A

- [x] 독립 worktree와 `codex/revenue-rescue-p0` 브랜치 생성
- [x] main·production SHA, runtime, lockfile, migration 기준선 수집
- [x] core row counts, empty tables, RLS summary, cron 24h, npm audit 수집
- [x] 전체 RLS policy inventory digest·재현 query와 브라우저 증거 저장
- [x] 감사 수치 reconciliation과 query pack 완성

## Phase B

- [x] `vercel.json`, route, log를 대조한 cron classification 작성
- [ ] 기존 외부 mutation guard inventory
- [ ] 중앙 capability policy 또는 기존 정책 확장

## Phase C

- [ ] cron query secret 제거와 regression test
- [ ] reachable JWT fallback 검증·수정
- [ ] confirmed RLS/PII/error exposure 최소 교정
- [ ] `MOCK_FEED`, `120+`, 검증 불가능한 public claim 제거
- [ ] focused security tests

## Phase D/E

- [x] production 홈→단독맞춤 실제 링크 이동 재검증
- [ ] 공개 route E2E
- [ ] 부산·김해 출발 offer 후보 증거·점수화
- [ ] verified snapshot projection과 one-offer landing
- [ ] lead·attribution·Kakao click dedupe
- [ ] 운영자 “오늘 처리할 일” 큐
- [ ] 예약·입금·마진 수동 연결 경로

## Delivery

- [ ] 변경 영역 lint/typecheck/unit/integration/E2E/build
- [ ] audit/security/revenue stacked Draft PR
- [ ] rollback·remaining blocker 정리
