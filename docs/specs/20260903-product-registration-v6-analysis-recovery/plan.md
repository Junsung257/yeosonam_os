# Implementation Plan: 상품등록 V6 분석 전용 정규화와 복구 대상

## Approach

기존 canonical normalization의 계산과 저장은 재사용하되 실행 정책을 `revision_commit`과 `analysis_only`로 나눈다. 분석 전용 정책은 Revision 쓰기 권한이 없고, 기존 Revision이 이미 연결된 job에는 적용하지 않는다.

그 결과와 immutable DocumentIR을 순수 함수에 넣어 표 구조, 근거 hash, parser warning, canonical completeness, 가격축 일대일 결박을 검사한다. 복구 가능한 모호성은 Recovery Target으로, 원문 자체에 신호가 없는 필수 사실은 source-insufficient 후보로 분리한다.

V6 workflow에는 기본 OFF인 preview 분기만 연결한다. 켜진 경우 분석과 target 탐지만 수행하고 안전하게 `blocked_action_required`로 종료하며, 기존 Revision/고객 공개 경로로 진행하지 않는다.

## Impact Areas

- Code: `src/lib/product-registration-v4/**`, `src/lib/product-registration-v6/**`, `src/workflows/product-registration-v6.ts`
- Data/API: 기존 `product_registration_v4_normalizations`, V6 stage/terminal RPC만 재사용; schema 변경 없음
- UI: 없음
- Docs/tests: 상품등록 SSOT, 환경변수 레퍼런스, Tier 3 spec packet, focused tests

## Required SSOT

- `AGENTS.md`
- `CURRENT_STATUS.md`
- `docs/product-registration-current-ssot.md`
- `docs/agent-workflow-current-ssot.md`
- `docs/ai-agent-doc-automation.md`
- `docs/git-commit-handoff.md`
- `db/FIELD_POLICY.md`

## Data Flow

`DocumentIR + job lineage` → analysis-only canonical normalization → table/cell validation + price-axis binding → `AnalysisRecoveryPlanV1` → V6 stage evidence → preview-only blocked terminal.

`analysis_only` 경로에서는 product revision, compatibility projection, candidate snapshot, mobile proof, publication pointer를 호출하지 않는다.

## Risks And Guardrails

- 기존 workflow 회귀: 새 플래그 기본값 OFF, 기존 commit 경로 기본값 유지
- 같은 가격의 다른 상품 오결박: tableId·기간·항공·등급을 포함한 source axis key와 one-to-one binding 사용
- 정상 병합표 과잉 OCR: 병합만으로 target 생성 금지
- 원문 부족을 parser 장애로 오판: field별 source signal이 없으면 별도 source-insufficient 목록으로 분리
- 대량 stage payload: target 수를 상한으로 제한하고 truncation을 명시
- 운영 DB drift: migration 0, 원격 write/apply 0
