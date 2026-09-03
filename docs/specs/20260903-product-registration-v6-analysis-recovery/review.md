# 상품등록 V6 분석 전용 정규화와 복구 대상 review

## Evidence

- [x] focused/regression: 7 files, 119 tests passed; final focused 5 files, 25 tests passed
- [x] full repository: 904 files passed, 6,707 passed, 7 existing conditional skips
- [x] type-check: passed
- [x] production build: passed with one-process `NEXT_BUILD_MAX_OLD_SPACE_SIZE=10240`; workflow 29 steps/2 workflows and rhwp native/WASM traces verified
- [x] touched-file ESLint: passed
- [x] product registration contract/authority: passed, `authorized=1 legacy=0 unapproved=0`
- [x] surface ownership: passed
- [x] harness: 0 findings, deterministic contracts 30/30, audit tests 29/29
- [x] migration 변경 0, package-lock 변경 0, 원격 DB write 0
- [x] GitHub CI: PR #1257의 Build & Test, Code Quality, Performance Analysis, Security Scan, TypeScript + Vitest, Next build, golden corpus, deterministic rules, SSOT, Vercel을 포함한 전체 게이트 통과

## Remaining risk

- [x] PR-V6-02 전에는 Recovery Target을 실제 렌더·OCR로 처리하지 않는다.
- [x] 플래그는 운영에서 OFF로 유지한다.
- [x] 로컬 build 첫 시도는 기본 6GB heap에서 OOM이었고, 소스/Workflow 컴파일 성공 후 10GB 일회성 검증으로 전체 build를 완료했다. 설정 변경은 저장하지 않았다.
