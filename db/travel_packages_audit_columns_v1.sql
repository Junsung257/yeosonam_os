-- travel_packages_audit_columns_v1.sql
-- 2026-04-19 · ERR-FUK-rawtext-pollution 후속 조치
--
-- 목적:
--   post_register_audit.js 결과를 DB에 영속화하여, 경고 있는 상품이
--   어드민 검수 없이 고객에게 노출되지 않도록 게이트를 구축.
--
-- 컬럼:
--   audit_status     — 감사 통과 단계. null|'clean'|'warnings'|'blocked'
--                      · null  : 레거시 상품(감사 이전). 기존 동작 유지.
--                      · clean : E0~E4 전부 통과. 즉시 승인 가능.
--                      · warnings : 경고 있음. 어드민 확인 필요.
--                      · blocked : 치명 에러. 수정 전 승인 차단.
--   audit_report     — 감사 결과 전체 JSON (errors, warnings, render 상태)
--   audit_checked_at — 마지막 감사 실행 시각

ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS audit_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS audit_report JSONB,
  ADD COLUMN IF NOT EXISTS audit_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_packages_audit_status
  ON travel_packages(audit_status)
  WHERE audit_status IS NOT NULL;

COMMENT ON COLUMN travel_packages.audit_status IS 'post_register_audit 결과 등급: clean|warnings|blocked (null=미검사)';
COMMENT ON COLUMN travel_packages.audit_report IS '감사 리포트 JSON: { errors[], warnings[], render:{...} }';
COMMENT ON COLUMN travel_packages.audit_checked_at IS '마지막 감사 실행 시각';
