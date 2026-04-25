-- ============================================================
-- W-final F3: raw_text_hash 강제 + parser_version 추적
-- ============================================================
-- 목적:
--   1) Rule Zero (ERR-FUK-rawtext-pollution) 를 DB 레벨로 승격.
--      raw_text_hash 가 이제 필수 저장 필드. 없으면 감사가 ERROR.
--   2) parser_version: AI 파서/프롬프트가 바뀌어도 "어떤 버전으로 찍어낸 데이터"
--      인지 추적. 나중에 "2026-04 프롬프트로 생성된 상품만" 같은 쿼리로
--      특정 시점 데이터를 식별/재파싱할 수 있게 함.
--   3) agent_audit_report: Claude Code Agent 가 파싱 직후 수행한 self-audit 결과.
--      Gemini 의존 없이 제로-코스트 감사 증거 보관.
--
-- 안전성: ADD COLUMN IF NOT EXISTS — 재실행 안전. 기존 행에 영향 없음 (NULL 허용).
-- ============================================================

-- 1) parser_version: 파싱 시점의 파서/프롬프트 버전 (예: "register-v2026.04.21-sonnet-4.6")
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS parser_version TEXT;

COMMENT ON COLUMN travel_packages.parser_version IS
  'W-final F3 — 파싱 시점 파서/프롬프트 버전. 예: register-v2026.04.21-sonnet-4.6';

-- 2) raw_text_hash 는 이미 존재하는 것으로 가정 (ERR-FUK 시점에 추가됨).
--    존재하지 않으면 추가.
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS raw_text_hash TEXT;

COMMENT ON COLUMN travel_packages.raw_text_hash IS
  'Rule Zero — raw_text 의 sha256. 사후 변조 탐지용. ERR-FUK-rawtext-pollution';

-- 3) agent_audit_report: Claude Code Agent 가 파싱 직후 수행한 self-audit JSON
--    구조: { claims: [{id, text, field, severity, supported, evidence, note}], overall_verdict, ran_at }
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS agent_audit_report JSONB;

COMMENT ON COLUMN travel_packages.agent_audit_report IS
  'W-final F1 — Agent self-audit CoVe 결과 (제로-코스트, Claude Code 세션에서 생성)';

-- 4) raw_text 원문 길이가 의심스럽게 짧은 상품에 대한 검색 인덱스 (E0 감사 가속)
CREATE INDEX IF NOT EXISTS idx_travel_packages_raw_text_length
  ON travel_packages ((length(raw_text))) WHERE raw_text IS NOT NULL;

-- 5) parser_version 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_travel_packages_parser_version
  ON travel_packages (parser_version) WHERE parser_version IS NOT NULL;

-- 확인 쿼리 (실행 후 참고용):
-- SELECT COUNT(*) FILTER (WHERE raw_text_hash IS NULL) AS missing_hash,
--        COUNT(*) FILTER (WHERE parser_version IS NULL) AS missing_version,
--        COUNT(*) AS total
-- FROM travel_packages;
