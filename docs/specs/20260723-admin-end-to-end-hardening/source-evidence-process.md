# Source evidence operating contract

상품 등록의 기준은 `원문 → 근거 → 구조화 사실 → 사람 검수 → 공개 스냅샷`의 단일 흐름이다. 각 단계가 제목·목적지·과거 값으로 추정한 값을 다시 신뢰하지 않도록 다음 불변식을 적용한다.

1. `travel_packages.raw_text`는 변경하지 않고 `raw_text_hash`를 함께 보관한다.
2. 선택관광의 지역처럼 고객에게 노출되는 모호한 값은 원문 인용, 원문 위치, 해시, 근거 유형을 가진다.
3. 원문에서 직접 확인되지 않고 일정 문맥으로만 추정된 값은 `review`이며 자동 공개하지 않는다.
4. 원문이 없거나 해시가 달라졌거나 근거가 없는 값은 `blocked`이며 제목·목적지 fallback을 금지한다.
5. 관리자 승인도 `optional_tour_source_evidence` 감사 기록을 남기고, 공개 스냅샷 게이트가 동일 계약을 다시 평가한다.
6. 공개는 검수 결과가 포함된 불변 스냅샷으로만 수행한다. 운영자가 값을 수정한 뒤에는 등록 검증과 모바일 proof를 다시 실행한다.

구현 기준:

- 공통 계약: `src/lib/product-registration/source-evidence-contract.ts`
- 등록·자동 공개 연결: `src/lib/product-registration/upload-to-open-autopilot.ts`
- 공개 차단: `src/lib/package-publication/publish-gate.ts`
- 관리자 검수 API/화면: `/api/admin/products/source-drift`, `/admin/products/source-drift`
- 원문 드리프트 감사/수리: `db/audit_schema_drift.js`, `scripts/fix-optional-tours-region-drift.mjs`

운영 순서는 `dry-run 감사 → 관리자 근거 검수 → source evidence 감사 확인 → 등록 검증 재실행 → 공개 스냅샷/모바일 proof 재생성`이다. 미해결 항목이 남아 있으면 공개하지 않는다.
