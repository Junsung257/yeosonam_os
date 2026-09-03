# Feature Spec: 상품등록 V6 분석 전용 정규화와 복구 대상

## Goal

원문 추출 직후의 첫 정규화를 고객 공개용 Revision 생성과 분리한다. 원문에 실제로 없는 사실과 파서·표 구조·상품축 결박 문제를 구분하고, 후속 이미지/OCR 복구가 처리할 최소 영역을 결정적으로 생성한다.

## Success Criteria

- [x] `analysis_only` 실행은 canonical normalization만 기록하고 Revision·Snapshot·Publication Pointer 권한을 갖지 않는다.
- [x] Recovery Target은 원문 hash, extraction, 표/셀 좌표, 상품축 후보, 값 후보, 사유, context policy를 보존한다.
- [x] 병합셀이라는 이유만으로 OCR하지 않고 구조 충돌·근거 불일치·상품축 모호성이 있을 때만 target을 만든다.
- [x] 복구 대상과 `SOURCE_INSUFFICIENT` 후보를 구분한다.
- [x] 기능 플래그 기본값은 OFF이며 기존 V6 실행은 바뀌지 않는다.
- [x] `docs/product-registration-current-ssot.md`의 현재 계약과 일치한다.

## In Scope

- V4 canonical normalization 실행 정책 분리
- Table price axis의 결정적이고 출처별로 유일한 key
- `RecoveryTargetV1` 및 analysis plan 계약
- 표 좌표·근거·parser warning·canonical field·가격축 문제 탐지
- V6 workflow의 OFF-by-default preview branch
- 단위/계약 테스트와 SSOT·환경변수 문서 갱신

## Out Of Scope

- HWP/PDF 렌더러 실행
- CLOVA·Google·GPT Vision 호출
- Derived Extraction 생성
- 사람 검수 Queue/UI/Receipt
- Supabase schema/migration 또는 운영 DB 변경
- Revision·Snapshot·Publication Pointer 생성·변경

## Users And Risks

- Primary audience: 상품등록 운영자와 후속 evidence recovery worker
- Risk tier: Tier 3
- Sensitive surfaces: 고객 공개, 상품 가격·출발일, immutable revision, Supabase 원장

## Open Questions

- [x] 신규 원장이 필요한가? PR-V6-01에서는 기존 normalization 원장과 V6 stage evidence를 재사용하며 신규 migration을 만들지 않는다.
- [x] 병합셀 전체를 복구 대상으로 보낼 것인가? 아니며, 검증 가능한 구조는 native IR을 권위로 유지한다.
