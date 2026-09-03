# Tasks: 상품등록 V6 분석 전용 정규화와 복구 대상

- [x] Tier 3, SSOT, 선행 PR merge와 clean worktree를 확인한다.
- [x] 기존 normalization→revision 호출 경로와 재사용 가능한 TableIR/원장을 확인한다.
- [x] analysis-only execution policy와 fail-closed job guard를 구현한다.
- [x] source-scoped price axis binding을 구현한다.
- [x] RecoveryTargetV1/AnalysisRecoveryPlanV1과 결정적 hash를 구현한다.
- [x] 문제 셀·parser warning·canonical field·가격축 탐지를 구현한다.
- [x] 기본 OFF preview workflow를 연결한다.
- [x] focused tests, type-check, surface-map, harness를 실행한다.
- [x] SSOT와 검증 증거를 갱신한다.
- [x] 커밋·푸시·PR·CI를 완료한다.

## Parallel Candidates

- [x] None — 동일 normalization/workflow 경계를 수정하므로 단일 소유자가 순차 검증한다.

## Commit Boundary

- Commit group: backend + tests + docs
