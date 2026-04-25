-- 20260427200000_split_customer_internal_notes.sql
--
-- ERR-special-notes-leak (2026-04-27): special_notes 한 컬럼이 고객노출 fallback과
-- 운영 메모 양쪽 역할을 하면서 회색지대 텍스트가 쇼핑센터 섹션에 누출됨.
--
-- 해결: customer_notes(고객 노출 OK) ↔ internal_notes(운영 전용) 두 컬럼으로 분리.
-- 기존 special_notes는 LLM 컨텍스트·어드민 표시용으로 유지 (호환성).
-- 고객 노출 fallback 경로(A4·모바일)는 코드에서 제거됨.
--
-- 보수적 마이그레이션: 기존 special_notes 데이터는 internal_notes 로 모두 이관.
-- customer_notes 는 빈 상태로 시작 — 운영팀이 명시적으로 고객 노출 텍스트만 옮길 것.

ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS customer_notes TEXT,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

UPDATE travel_packages
   SET internal_notes = COALESCE(internal_notes, special_notes)
 WHERE special_notes IS NOT NULL
   AND special_notes <> ''
   AND internal_notes IS NULL;

COMMENT ON COLUMN travel_packages.customer_notes IS
  '고객 노출 OK 메모 (모바일·A4 노출 가능). 운영성 텍스트 절대 금지. validatePackage W21 검증 적용.';
COMMENT ON COLUMN travel_packages.internal_notes IS
  '운영 전용 메모 (커미션·정산·랜드사 협의사항 등). 고객 노출 차단. 어드민에서만 표시.';
COMMENT ON COLUMN travel_packages.special_notes IS
  '[DEPRECATED 2026-04-27] LLM 컨텍스트·어드민 호환용. 신규 등록은 customer_notes/internal_notes 사용. 고객 노출 fallback 경로는 모두 제거됨.';
