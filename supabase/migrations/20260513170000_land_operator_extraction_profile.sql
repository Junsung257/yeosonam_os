-- ═══════════════════════════════════════════════════════════════════
-- Phase 5-2 + 6-2: 랜드사별 추출 프로파일 자동 학습
-- 박제일: 2026-05-13
-- 사유: 랜드사마다 원문 형식 다름 (LJ ★특전, 모두투어 ▶ 마커 등).
--       등록 시 자동 누적 → 다음 등록 prompt 에 inject → compound 학습.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS land_operator_extraction_profile (
  land_operator_id    uuid PRIMARY KEY REFERENCES land_operators(id) ON DELETE CASCADE,
  typical_markers     text[]   DEFAULT '{}'::text[],
  typical_inclusions  text[]   DEFAULT '{}'::text[],
  typical_excludes    text[]   DEFAULT '{}'::text[],
  typical_surcharge   text[]   DEFAULT '{}'::text[],
  typical_b2b_terms   text[]   DEFAULT '{}'::text[],
  extraction_hint     text,
  total_registrations int      DEFAULT 0,
  total_rejections    int      DEFAULT 0,
  avg_confidence      numeric(4,3),
  last_updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_landop_profile_updated
  ON land_operator_extraction_profile (last_updated_at DESC);

COMMENT ON TABLE land_operator_extraction_profile IS
  '랜드사별 원문 추출 프로파일. 등록 시 자동 누적 + 다음 등록 prompt 에 inject (parser.ts:options.landOperatorProfile).';
