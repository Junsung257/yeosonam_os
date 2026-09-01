# 상품 원문 → 고객 모바일 수렴 복구 V2

- 기준일: 2026-09-01 (Asia/Seoul)
- 기준 브랜치: `codex/product-source-mobile-convergence-v2`
- 기준 main: `abd4afea47e6bac444d47c8d03bfc369f2929eb4`
- 위험 등급: Tier 3

## 목표

랜드사 원문 한 건이 immutable source, exact canonical revision, customer snapshot, real-browser proof, publication pointer를 거쳐 고객 모바일 `/packages/{id}`와 `/lp/{id}`에 같은 판매 사실로 표시되게 한다.

업로드 202, workflow 시작, snapshot 생성, 단위 테스트 통과는 완료가 아니다. 같은 source에서 나온 revision/snapshot이 실제 모바일 두 화면에 노출되고 CTA가 작동하는 하나의 증거 묶음이 완료 조건이다.

## 판정

기술적으로 성공 가능하다. 현재 기반에는 immutable source, durable workflow, typed facts, snapshot, browser proof, pointer-only 공개가 모두 있다. 지난 3개월의 병목은 AI가 여행상품을 이해하지 못한 것이 아니라 다음 경계가 서로 다른 성공 조건을 쓴 데 있다.

1. 코드·배포 환경·실제 운영 URL의 완료 판정이 분리됐다.
2. validation 판단과 persisted revision 상태가 어긋났다.
3. 내부 스키마를 PostgREST에서 직접 읽으려 했다.
4. 브라우저 proof가 데이터 오류와 실행환경 오류를 구분하지 않았다.
5. 작은 fixture 통과를 실제 공급사 원문 정확도로 확대 해석했다.

## 순차 게이트

```text
G0 기준선과 동결
  → G1 고객 경로 복구
    → G2 서비스 전용 읽기 경계
      → G3 revision/supplier 권위 수렴
        → G4 브라우저 proof 분류·증명
          → G5 reviewed corpus + OSS shadow
            → G6 1→5→20→100 canary
```

### G0 — 기준선과 동결

- dirty 원본 작업폴더는 수정하지 않고 최신 main의 clean worktree만 사용한다.
- production deployment, remote migration, authority config, pointer digest, active/missing/sale-blocked cohort를 기록한다.
- global publication freeze를 유지한다.

완료 기준: 고객 공개 증가 0, 기준 증거 모두 고정.

### G1 — 고객 경로 복구

- production 환경을 사용한 staged production deployment를 `--skip-domain`으로 만든다.
- 공개 상품, 미존재, 판매중지 route semantics를 검사한다.
- 390×844에서 상세와 LP의 핵심 사실, 가로 overflow, CTA open을 확인한다.
- 모두 통과한 exact deployment만 promote한다.

완료 기준: 공개 200, 미존재 404, 판매중지 410, 일시 장애 503.

### G2 — 서비스 전용 읽기 경계

- middleware의 pointer/overlay 다중 직접 조회를 단일 typed RPC로 교체한다.
- RPC는 `PUBLIC`, `NOT_FOUND`, `SALE_UNAVAILABLE`, `UNAVAILABLE`과 최소 identity만 반환한다.
- raw revision/snapshot/pointer payload와 hash는 반환하지 않는다.
- server credential이 없으면 anon fallback 없이 fail-closed한다.

완료 기준: service role만 실행 가능하고 anon/authenticated는 거절.

### G3 — revision과 supplier 권위

- 안전한 degraded publication에서 exact `needs_review` revision만 transaction 안에서 `verified`로 승격한다.
- supplier layout profile은 미노출 internal schema 직접 조회가 아니라 service-only RPC로 읽는다.
- replay, price parity, departure conflict, revision count mismatch는 별도 회귀 fixture로 고정한다.

완료 기준: publication state와 snapshot lineage가 일치하고 internal schema 노출 0.

### G4 — 브라우저 proof

- 실패를 lineage, customer content, interaction, visual asset, runtime, infrastructure, contract로 분류한다.
- 데이터 오류는 자동 재시도하지 않고 infrastructure만 bounded retry한다.
- package/LP의 revision/snapshot/build와 CTA 결과를 같은 proof에 묶는다.

완료 기준: 비공개 canary 5건, 이후 20회 연속 runtime/stuck/hash mismatch 0.

### G5 — reviewed corpus와 OSS shadow

- 최소 10개 공급사/문서군에서 30건을 먼저 봉인하고 100건으로 확장한다.
- HWP/HWPX, 붙여넣기, PDF, scan/image, 가격표, 복수 항공, 호텔 후보, 특별약관, 정정본, 깨진/비여행 문서를 포함한다.
- parser 결과는 candidate IR까지만 허용하고 DB publication 권한을 주지 않는다.

완료 기준:

- 가격·출발일 pairing과 critical false publication: 0/100
- 가격·날짜·기간·항공·필수비용 각 정확도: 95% 이상
- 가중 평균: 97% 이상
- source-unbound customer fact: 0
- replay hash: 100% 동일

### G6 — 점진 공개

- global freeze를 즉시 풀지 않는다.
- exact revision/snapshot/proof/release manifest가 있는 대상만 1→5→20→100으로 공개한다.
- 각 단계 24시간 관찰 후 확대한다.

다음 중 하나면 즉시 freeze한다: critical false publish, 공개 503, lineage/build mismatch, stuck workflow, tenant cross-read, raw internal exposure.

## 오픈소스 도입 원칙

- HWP/HWPX: `hwplib`, `hwpxlib`, `hwp2hwpx`를 isolated shadow worker에서 비교한다.
- PDF/Office: Docling을 born-digital 문서 후보로 사용한다.
- Scan/image: PaddleOCR PP-Structure를 해당 cohort에만 사용한다.
- 평가: docling-eval/OmniDocBench의 reading-order/table metric, fast-check fuzz, 기존 pgTAP을 결합한다.
- 사람 정답: Label Studio 또는 기존 admin 중 정확히 하나만 사용한다.
- Promptfoo/BAML은 challenger/eval용이며 DB authority를 대체하지 않는다.
- 새 범용 agent framework, 새 orchestrator, 새 browser MCP는 현재 병목을 해결하지 않으므로 추가하지 않는다.

## 작업 제외

- 기존 backlog 일괄 replay
- 검증 전 상품 일괄 공개
- internal schema의 Data API 노출
- 원문에 없는 사실의 AI 추정
- 관광지·호텔·골프 master 자동 INSERT
- 오래된 PR 전체 merge

## 최종 완료 문장

다음 문장을 증거로 입증할 때만 완료다.

> 검토된 랜드사 원문 100건이 exact source/revision/snapshot lineage를 유지했고, critical false publication 없이 운영 모바일 상세·LP에 동일 facts를 렌더했으며, route/runtime/tenant 오류 없이 CTA까지 동작했다.
