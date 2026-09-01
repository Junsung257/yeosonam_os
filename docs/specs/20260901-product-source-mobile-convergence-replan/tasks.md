# Tasks: Supplier Source To Customer Mobile Convergence

- [x] 현재 main, 기존 history, 상품등록 SSOT와 authority 경계를 다시 감사한다.
- [x] 고객 상세와 LP preflight를 단일 service-only RPC로 수렴한다.
- [x] active sale suspension과 unknown UUID를 각각 410과 404로 분리한다.
- [x] safe degraded publication, supplier profile reader, typed browser-proof failure를 보강한다.
- [x] 지난 출발일·가격을 현재 재고와 상담 기본값에서 제거하고 mapped cache contract를 갱신한다.
- [x] 운영 migration을 freeze 유지 상태로 적용하고 pointer invariant, grants, advisor를 검증한다.
- [x] production-environment staging에서 200/410/404 matrix를 통과한 exact source만 운영 승격한다.
- [x] 운영 390×844 브라우저에서 LP와 CTA를 검증하고 실제 상담 제출은 하지 않는다.
- [x] 고정 골든 코퍼스와 auto-QA fixture의 wall-clock 의존을 제거한다.
- [x] GitHub OSS·현재 Skills/MCP를 비교하고 shadow-only 도입 후보와 금지 항목을 기록한다.
- [ ] 최소 30건을 봉인한 뒤 100건 reviewed corpus로 확장한다.
- [ ] 가격·날짜 pairing, critical false publication, source-bound fact, deterministic replay 게이트를 통과한다.
- [ ] publication freeze를 유지한 채 1→5→20→100 canary와 단계별 24시간 관찰을 수행한다.

## Commit Boundary

- customer authority and DB boundary
- current inventory and mobile CTA
- deterministic historical evaluation
- production evidence and OSS adoption record
