# Revenue Rescue P0 Plan

1. Phase A: repository·deployment·database 기준선과 감사 수치를 immutable evidence로 고정한다.
2. Phase B: 모든 cron·외부 mutation을 inventory하고 기존 kill switch를 우선 재사용한다.
3. Phase C: 현재 HEAD에서 재현된 P0 finding만 최소 수정하고 focused regression을 추가한다.
4. Phase D: production 공개 경로와 고객 CTA를 브라우저 및 Playwright로 검증한다.
5. Phase E: 기존 상품·snapshot·lead·booking·ledger 구조를 재사용해 단일 offer 퍼널을 구현한다.
6. 변경을 audit → security → revenue의 세 stacked Draft PR로 분리한다.

각 단계는 이전 단계의 증거를 보존하며, 독립적으로 진행 가능한 작업은 외부 확인 대기 중에도
계속한다.
