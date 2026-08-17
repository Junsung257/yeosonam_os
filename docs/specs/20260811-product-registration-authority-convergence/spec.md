# Feature Spec: Product Registration Authority Convergence

## Goal

모든 상품 입력 채널이 하나의 EvidenceIR/Registration Kernel을 거쳐 불변 revision을 먼저 만들고, 검증된 snapshot과 CAS publication pointer만 고객 공개 권한을 갖게 한다. HWP·HWPX·PDF·OCR·Band·IR 처리 방식은 adapter로 유지하되 `products`, `product_prices`, `travel_packages`, public snapshot을 직접 쓰는 병렬 엔진은 제거한다.

## Success Criteria

- [ ] 신규 입력은 `published_verified`, `published_degraded`, `discarded_source_incomplete`, `blocked_action_required` 중 하나로 자동 종결된다.
- [ ] 권위 writer 이외의 상품 사실·snapshot 직접 DML은 정적 검사와 DB 권한으로 차단된다.
- [ ] canonical revision이 호환 projection보다 먼저 원자적으로 저장된다.
- [ ] 모든 고객 채널은 동일 publication pointer의 immutable snapshot을 읽는다.
- [ ] tenant·source·revision·snapshot 계보가 끊기거나 충돌하면 공개되지 않는다.
- [ ] 기존 989개 상품은 강제 공개 없이 shadow backfill 결과로 분류할 수 있다.
- [ ] `docs/product-registration-current-ssot.md`와 테스트가 최종 동작을 함께 고정한다.

## In Scope

- 상품 identity와 tenant-scoped source 계약
- 단일 revision commit/publication authority
- V6 workflow의 legacy-first 저장 제거
- IR·Band·scan·reextract·관리자 수정의 공통 workflow 수렴
- 약관·미디어 provenance·호텔/골프 observation·항공 재검증·cohort 품질 원장
- B2C·B2B·제휴 채널별 pointer snapshot reader
- authority boundary·idempotency·tenant·모바일 proof 회귀검증

## Out Of Scope

- 검증되지 않은 관광지·호텔·골프 master 자동 생성
- 운영 DB migration 즉시 적용 또는 자동 공개 flag 즉시 활성화
- 원문에 없는 가격·날짜·운항시간·호텔등급의 AI 추정
- 기존 989개 상품의 검증 전 일괄 고객 공개

## Users And Risks

- Primary audience: 고객, 관리자, 랜드사, 제휴 여행사
- Risk tier: Tier 3
- Sensitive surfaces: DB/RLS, private source, AI/OCR provider, customer publication, multi-tenancy

## Open Questions

- [x] None. 사용자 승인 계획의 확정 기본값을 따른다.
