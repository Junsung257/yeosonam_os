# V6.1 Gold 모집단 수치 대조

작성일: 2026-08-23
목적: 과거 감사의 `231`, `155`, `1131`과 최신 최종화 컨트롤러의 source inventory를 서로 다른 모집단으로 고정한다.

## 결론

현재 레포와 최신 corpus에서 `누락 원본 231건`이라는 수치는 독립적인 source inventory로 입증되지 않았다. 따라서 231건을 확보 완료나 Gold 대상 수로 사용하지 않는다.

최신 컨트롤러 실행의 전체 corpus 모집단은 다음과 같다.

| 항목 | 최신 측정값 | 해석 |
|---|---:|---|
| corpus entries | 1,171 | 전체 metadata row |
| exact path present | 40 | 지정 경로에서 원본 확인 |
| filename-based hash verified | 26 | filename 후보 중 hash 일치로 복구 확인 |
| source hash verified | 66 | 40 + 26 |
| source corrupt / hash mismatch | 13 | 원본 후보는 있으나 검증 불일치 |
| source missing | 1,092 | 현재 검색 범위에서 원본 미확보 |
| searched files | 6,068 | 최신 컨트롤러 검색 파일 수 |

산식은 `66 + 13 + 1,092 = 1,171`이다. 이전 감사의 `1,131 missing`은 filename recovery를 아직 반영하지 않은 시점의 `1,171 - 40`으로 보존한다. 과거 원장을 덮어쓰지 않고 최신 측정값을 별도 run evidence로 기록한다.

## 155 UNKNOWN_BLOCKER의 모집단

`155`는 전체 corpus의 source missing 수가 아니다.

- historical queue: 200 rows → deduped 155 cases
- corpus development / `needs_review`: 155 rows, 289 sections
- 그 하위 큐의 source path metadata: present 18, missing 137
- 기계적 1차 분류: `SOURCE_MISSING 137`, `PRICE_AMBIGUOUS 1`, `VARIANT_AMBIGUOUS 1`, `TRUE_UNKNOWN 16`
- human review: 0

전체 corpus의 `needs_review`는 222 rows / 429 sections이며, development 155-row 큐는 그 하위 집합이다. 그러므로 155를 Gold label, PASS, 또는 1092 missing의 대체 수치로 사용하지 않는다.

## 231 수치 처리 규칙

현재 확인 가능한 audit/source artifact에는 동일 모집단을 가리키는 `231건` 정의와 row-level 목록이 없다. 231을 실제 작업 큐로 사용하려면 다음 증거가 추가되어야 한다.

1. 231개 원본의 immutable file inventory
2. 각 원본의 expected source hash와 실제 SHA-256
3. corpus/Gold candidate와의 명시적 join key
4. 중복·손상·누락 처리 결과

그 전까지 Gold controller는 전체 corpus 측정값과 historical 155-row triage를 분리해 유지한다. 원본 metadata, parser output, synthetic text는 missing original을 대체할 수 없다.

## 현재 Gold 판정 영향

- Gold source candidate: 40 source rows / 69 sections / 10 frozen candidate sections
- target: 400 sections
- Reviewer A/B: 0 / 0
- adjudication: 0
- certificate: NOT_ISSUED
- production writes: 0
- pointer changes: 0

따라서 최종 상태는 `WAITING_EXTERNAL_SOURCE`이며, 이 문서는 원본 확보·hash 검증·human dual review가 완료됐다고 주장하지 않는다.
