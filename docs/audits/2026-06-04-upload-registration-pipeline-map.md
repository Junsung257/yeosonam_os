# 업로드 상품등록 파이프라인 지도

Date: 2026-06-04
Updated: 2026-06-05

## 2026-06-05 추가: 표준 등록 객체 1차 도입

`upload/route.ts`의 저장 전 판단권을 `src/lib/product-registration/register-product-from-raw.ts`로 이동하기 시작했다.

현재 1차 연결 구조:

```text
upload route
  -> parse document
  -> split/recover product sections
  -> resolve destination/code
  -> registerProductFromRaw(productRawText)
       -> V3 ledger/render preview
       -> recoverUploadPriceData()
       -> normalizeUploadItinerary()
       -> evaluateUploadDeliverability()
       -> ProductRegistrationResult
  -> persist ProductRegistrationResult pricing/itinerary/extractedData
```

새 경계:

- route는 `recoverUploadPriceData()`, `normalizeUploadItinerary()`, `evaluateUploadDeliverability()`를 직접 호출하지 않는다.
- route는 `registerProductFromRaw()`가 반환한 `ProductRegistrationResult`에서 `pricing`, `itinerary`, `deliverability`, `extractedData`를 소비한다.
- V3가 잡은 `optional_tours`와 표준 notice 후보는 표준 객체 병합 단계에서 `extractedData`에 반영된다.
- `src/lib/product-registration/register-product-from-raw.test.ts`가 세부 호텔 컬럼 가격표 원문 기준으로 `price_dates`, `product_prices`, 일정, 선택관광, 고객용 gate를 함께 검증한다.

아직 남은 작업:

- route의 앞단 deterministic 보정(`bullets`, `catalog post-process`, `critic`, departure/accommodation recovery)을 표준 오케스트레이터 내부 단계로 더 이동해야 한다.
- V3 sidecar 저장은 아직 별도 after task로 남아 있다. 이후에는 `ProductRegistrationResult`와 동일한 결과를 draft/persist에 사용하도록 맞춰야 한다.
- 기존 mojibake golden fixture는 실제 UTF-8 원문 fixture로 교체해야 한다.

## 현재 표준 흐름

`src/app/api/upload/route.ts`는 저장 직전까지 아래 순서로 상품을 만든다.

```text
upload route
  -> parse document
  -> split/recover product sections
  -> normalize extracted product
  -> resolve destination/code
  -> recover price data
  -> normalize itinerary
  -> evaluate deliverability
  -> persist products/product_prices/travel_packages
```

핵심 원칙은 route 안에 랜드사별 가격표 분기를 추가하지 않는 것이다. 새 실패는 먼저 fixture로 고정하고, 표 형태별 parser 또는 복구 모듈을 보강한 뒤, 게이트를 통과해야 저장된다.

## 가격 데이터 생성 경로

가격 복구의 단일 진입점은 `src/lib/product-registration/price-recovery.ts`의 `recoverUploadPriceData()`다.

표준 순서:

```text
recoverUploadPriceData()
  1. existing LLM price_tiers 검사
  2. deterministic price IR 추출
  3. supplier_raw_facts 자유 텍스트 복구
  4. Gemini fallback(optional)
  5. PriceTier[] 정규화
  6. product_prices 생성
  7. price_dates 생성
```

성공 기준:

```text
가격 성공 = price_tiers 있음 아님
가격 성공 = product_prices 1건 이상 + price_dates 1건 이상
```

실패 사유는 `llm:*`, `deterministic:*`, `supplier_raw_facts:*`, `gemini:*` 형태로 구조화된다.

## 표 형태별 Price IR

가격표 parser는 `src/lib/parser/deterministic/price-ir/` 아래에 분리되어 있다.

| 표 형태 | 파일 |
| --- | --- |
| 기간 x 요일 매트릭스 | `period-dow-matrix.ts` |
| 호텔/등급별 가로 컬럼 요금표 | `hotel-column-matrix.ts` |
| 스팟특가 + 기간 요일 요금표 | `spot-weekday-table.ts`, `weekday-period-table.ts` |
| 월/요일/날짜 리스트 표 | `month-dow-table.ts` |
| 세로형 등급/박수/가격표 | `vertical-grade-table.ts` |
| 써차지/비운항/제외일 | `surcharge.ts`, `guards.ts` |

모든 parser는 `PriceIRRow[]`를 만들고, 마지막 변환 단계에서만 `PriceTier[] -> product_prices/price_dates`로 바뀐다.

## 저장 전 단일 게이트

저장 전 고객용 생성 가능성은 `src/lib/product-registration/deliverability-gate.ts`의 `evaluateUploadDeliverability()`가 판단한다.

차단 항목:

- `product_prices` 0건
- `price_dates` 0건
- `product_prices`와 `price_dates` 날짜/가격 불일치
- 목적지 미해결 또는 내부 코드 `UNK`
- 일정 day 없음
- 일정 day 번호 누락/중복/비연속
- 상품 기간보다 일정이 과도하게 많음
- 선택관광/입장권/추가요금 금액이 상품가 후보로 오염됨
- 목적지/V2 등 외부 게이트 실패

A4/모바일 렌더 입력은 이 게이트를 통과한 뒤에만 저장된다.

## route 경계 감시

`src/lib/product-registration/upload-route-boundary.test.ts`가 다음을 고정한다.

- route에서 `recoverUploadPriceData()`는 1회만 호출한다.
- route에서 `priceTiersToRows`, `tiersToDatePrices`, `extractPriceMatrix` 같은 가격 변환 함수를 직접 호출하지 않는다.
- `evaluateUploadDeliverability()`는 `product_prices`/`price_dates` 저장보다 먼저 실행된다.
- 일정 정규화는 deliverability gate보다 먼저 실행된다.
- `products` ledger는 복구된 대표가(`netPrice`)로 upsert한다.
- 기존 상품 upsert는 신규 생성 상품처럼 롤백하지 않는다.
- 운영 감사는 `products.net_price`와 `travel_packages.price` 불일치를 strict 실패로 잡는다.

## Golden Corpus

현재 고정된 대표 케이스:

- 세부 호텔 컬럼 매트릭스
- 푸꾸옥 전체 원문
- 후쿠오카 골프 스팟특가 + 현금영수증 안내 오염 케이스
- 클락 4개 다중상품 원문
- 기존 supplier raw fixture 5건

검증 항목:

- title
- destination
- internal destination code
- min price
- specific date price
- `price_dates` count > 0
- 선택관광/입장권 가격이 상품가에 포함되지 않음
- 일정 day 유효
- customer deliverable not blocked
- A4/mobile render input 가능

검증 명령:

```bash
npm run eval:product-registration:ci
npx vitest run src/lib/product-registration...
npx vitest run src/lib/parser/deterministic/...
npx vitest run src/lib/upload-validator.test.ts src/lib/price-dates.test.ts src/lib/upload-verify.test.ts
npm run type-check
```

## 2026-06-05 deliverability gate recovery note

During the Ad OS validation batch, full `npm run type-check` exposed malformed untracked deliverability-gate files. The gate was restored with parse-safe English blocker messages while preserving the documented contract:

- block when `product_prices` is empty,
- block when `price_dates` is empty,
- block when `product_prices` and `price_dates` disagree,
- block unresolved destination or destination code,
- block missing, duplicate, non-contiguous, or duration-overflow itinerary days,
- block optional-tour, surcharge, cancellation, or fee amounts when they pollute product price candidates.

Focused verification:

- `npx vitest run src/lib/product-registration/deliverability-gate.test.ts`
- included in the combined validation slice with Ad OS tests: 17 files, 57 tests
- `npm run type-check`
- `npm run build`

## 등록 실패 유형 TOP 6

1. `price_tiers`는 있으나 `price_dates`가 0건인 label-only tier.
2. 가격표 유형 미인식으로 `product_prices`가 0건인 경우.
3. 선택관광/입장권/추가요금 금액이 상품가 후보로 오염되는 경우.
4. 목적지 미해결 또는 내부 코드 `UNK`.
5. 일정 day 누락, 중복, 비연속, 기간 초과.
6. 저장 후 `travel_packages.price_dates`와 `product_prices`가 서로 달라 A4/모바일 기준 가격이 어긋나는 경우.

## 최근 실전 검증 메모

클락 다중상품 4건은 실제 DB 기준으로 각각 통과했다.

| code | 상품 | product_prices | price_dates | 일정 | V3 |
| --- | --- | ---: | ---: | ---: | --- |
| `PUS-ETC-CRK-05-0001` | 알뜰 3박5일 | 32 | 32 | 5일 | ready_to_publish |
| `PUS-ETC-CRK-06-0001` | 알뜰 4박6일 | 40 | 40 | 6일 | ready_to_publish |
| `PUS-ETC-CRK-05-0002` | 품격 3박5일 | 32 | 32 | 5일 | ready_to_publish |
| `PUS-ETC-CRK-06-0002` | 품격 4박6일 | 40 | 40 | 6일 | ready_to_publish |

푸꾸옥 선택관광 19건은 옵션 검토 경고로 남지만, 상품가 오염이나 A4/모바일 생성 차단 사유는 아니다.

## 새 실패 처리 규칙

```text
fixture 추가
  -> price-ir parser 또는 product-registration module 보강
  -> recoverUploadPriceData 결과 검증
  -> evaluateUploadDeliverability 통과
  -> golden corpus / strict audit 통과
  -> route는 그대로 둔다
```

route에 랜드사별 정규식이나 가격표 fallback을 직접 추가하면 안 된다.

## 2026-06-05 additional note: itinerary normalizer syntax recovery

Full repo type-check found `src/lib/itinerary-normalizer.ts` malformed after meal normalization helpers were inserted inside `normalizeRegions()`. The function boundary was repaired without changing the intended normalization rules.

Added regression coverage:

- string meal values normalize to boolean meal slots while preserving notes;
- unavailable meal text such as self-meal/free-meal markers counts as excluded;
- `meta.total_meals` is recounted after normalization;
- first/last day departure rows can receive `meta.flight_out` / `meta.flight_in` hints.
