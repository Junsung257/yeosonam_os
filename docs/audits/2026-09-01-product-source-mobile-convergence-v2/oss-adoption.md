# 상품등록 정확도용 GitHub OSS 선별

- 조사일: 2026-09-01
- 목적: HWP/HWPX/PDF/이미지 원문에서 고객 모바일 판매 사실까지 정확도를 높일 수 있는 도구만 선별
- 원칙: star 수가 아니라 실제 supplier corpus 정확도, provenance, 라이선스, 격리 실행, fail-closed 여부로 결정한다.

## 우선순위

| 순위 | 프로젝트 | 가져올 것 | 결정 |
|---:|---|---|---|
| 1 | [hwplib](https://github.com/neolord0/hwplib) | HWP 문단·표·control 구조 추출 | isolated shadow PoC |
| 1 | [hwpxlib](https://github.com/neolord0/hwpxlib) | HWPX XML·표·text 구조 추출 | isolated shadow PoC |
| 1 | [hwp2hwpx](https://github.com/neolord0/hwp2hwpx) | HWP→HWPX secondary representation | direct 결과와 구조 diff |
| 2 | [docling-eval](https://github.com/docling-project/docling-eval) | text/layout/reading-order/table 평가 | 평가 방식 흡수 |
| 2 | [OmniDocBench](https://github.com/opendatalab/OmniDocBench) | 문서 parsing metric 구조 | metric reference |
| 2 | [fast-check](https://github.com/dubzzz/fast-check) | TypeScript property fuzz, seed replay, shrinking | parser 회귀 PoC |
| 2 | [pgTAP](https://github.com/theory/pgtap) | DB grant/state/idempotency 계약 | 기존 설치를 상품에 확장 |
| 3 | [Label Studio](https://github.com/HumanSignal/label-studio) | source span/table-cell 정답 annotation | 내부 corpus에만 사용 |
| 3 | [Docling](https://github.com/docling-project/docling) | PDF/Office unified IR + provenance | born-digital shadow 후보 |
| 3 | [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Korean OCR + table/layout | scan/image cohort 후보 |
| 4 | [Promptfoo](https://github.com/promptfoo/promptfoo) | provider/prompt 비교와 CI report | 보조 challenger |
| 4 | [BAML](https://github.com/BoundaryML/baml) | typed extraction/eval 패턴 | full runtime 전 비교 |

## 가장 높은 ROI

HWP를 먼저 이미지로 바꿔 OCR하지 않는다. 표·셀·문단 구조를 버리기 때문이다. 원본 bytes에서 current extractor, direct HWP/HWPX parser, HWP→HWPX secondary parser를 독립 실행하고 disagreement를 남긴다.

```text
source bytes
  ├─ current extractor
  ├─ hwplib/hwpxlib direct extraction
  └─ hwp2hwpx → hwpxlib extraction
       ↓
candidate IR + source coordinates
       ↓
reviewed travel benchmark
       ↓
문서 cohort별 승격 또는 격리
```

Java parser는 Next.js request path에 넣지 않는다. 파일 크기, 압축 해제량, CPU, 메모리, wall time을 제한한 별도 worker에서 실행하고 production DB credential을 주지 않는다. encrypted/unsupported HWP는 자동 우회하지 않고 review/quarantine한다.

## 여행상품 전용 평가

일반 OCR 문자 정확도만으로 parser를 고르지 않는다. 최종 점수는 다음 판매 사실 보존으로 계산한다.

- 가격 cell exact match
- 출발일과 가격 row pairing
- nights/days consistency
- outbound/return flight separation
- hotel candidate/confirmed separation
- 포함/불포함/현지필수비용 separation
- itinerary day order
- source span recoverability
- customer snapshot fact parity

`fast-check`는 공백·줄바꿈·제로폭 문자, 날짜 구분자, 천 단위 표기, 병합/빈 셀, 열 순서, 정정 행, OCR 혼동 문자를 생성한다. 의미를 바꾸지 않는 변형은 동일 canonical rows와 payload hash를 만들어야 한다.

pgTAP에는 anon/auth raw read 거절, service-only RPC, freeze, exact revision/snapshot/proof, 실패 시 pointer 보존, 동일 replay idempotency를 넣는다.

## 채택하지 않을 것

- 범용 agent framework 추가: 현재 실패는 agent 수가 아니라 권위·증거·release gate 문제다.
- 세 번째 workflow orchestrator: Vercel Workflow와 Inngest가 이미 있다.
- 새 browser/GitHub MCP: 기존 Browser, Playwright, GitHub CLI로 충분하다.
- parser 결과의 직접 DB INSERT: candidate IR만 만들고 V6 kernel과 DB authority를 통과시킨다.
- 관광지 자동 seed/scraper: attraction SSOT와 충돌한다.

## 승격 기준

| 항목 | 기준 |
|---|---:|
| 가격·출발일 pairing | 100% |
| 기간·항공·필수비용 high-risk fact | 100% |
| 표 구조·일정 day order | 98% 이상 |
| source span recoverable | 100% |
| crash/hang | 0/100 |
| unsupported/encrypted 격리 | 100% |
| 동일 입력 replay hash | 100% |
| source-unbound customer fact | 0 |
| parser의 자동 공개 권한 | 항상 없음 |

큰 프레임워크를 통째로 가져오는 것보다 `HWP dual parser + reviewed benchmark + property fuzz + pgTAP + 실제 모바일 proof` 조합이 현재 시스템에 가장 높은 효과를 낸다.
