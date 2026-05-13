-- ═══════════════════════════════════════════════════════════════════
-- ai_quality_log: V2 신뢰도 산식 결과 + leak incidents 적재
-- 컨펌 큐 UI 및 등록 정확도 추세 분석의 SSOT
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_quality_log (
  id              bigserial PRIMARY KEY,
  package_id      uuid REFERENCES travel_packages(id) ON DELETE CASCADE,
  internal_code   text,
  confidence      numeric(4,3) NOT NULL,
  fill_score      numeric(4,3),
  xvalid_score    numeric(4,3),
  leak_score      numeric(4,3),
  auto_gate       text NOT NULL CHECK (auto_gate IN ('auto_publish','confirm_queue','pending_review','rejected')),
  failed_checks   jsonb DEFAULT '[]'::jsonb,
  leak_incidents  jsonb DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_quality_log_pkg
  ON ai_quality_log(package_id);
CREATE INDEX IF NOT EXISTS idx_ai_quality_log_gate
  ON ai_quality_log(auto_gate, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_quality_log_created
  ON ai_quality_log(created_at DESC);

COMMENT ON TABLE ai_quality_log IS
  '상품 등록 시 신뢰도 V2 (fill/xvalid/leak/clean) + auto_gate + 실패 체크 + leak incidents 적재. 컨펌 큐 UI 의 SSOT.';
COMMENT ON COLUMN ai_quality_log.auto_gate IS
  'V2 산식 결과 자동 게이트. auto_publish: confidence≥95%, confirm_queue: 70~95%(사장님 1-click), pending_review: 50~70%, rejected: <50% 또는 critical leak.';
