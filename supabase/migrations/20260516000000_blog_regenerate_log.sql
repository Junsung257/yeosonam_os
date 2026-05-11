-- ============================================================
-- Blog Regenerate Log — GSC zero-click 자동 재생성 추적
--   /api/cron/blog-regenerate-zero-click 이 매주 1회 실행되며
--   rank_history.clicks=0 AND impressions=0 (최근 14일) slug 를
--   재생성한다. 본문 교체 시 본 테이블에 양쪽 hash + reason 기록.
--
-- Why: 재생성 효과 측정 + 동일 글 재 재생성 방어 (cooldown 7일).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS blog_regenerate_log (
  id              BIGSERIAL PRIMARY KEY,
  post_id         UUID NOT NULL,
  slug            TEXT NOT NULL,
  old_html_hash   TEXT NOT NULL,
  new_html_hash   TEXT,
  reason          TEXT NOT NULL DEFAULT 'zero_click'
                  CHECK (reason IN ('zero_click','rank_drop','manual','quality_gate_fail')),
  gate_passed     BOOLEAN NOT NULL DEFAULT FALSE,
  gate_summary    TEXT,
  model           TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_regenerate_log_post   ON blog_regenerate_log(post_id);
CREATE INDEX IF NOT EXISTS idx_blog_regenerate_log_slug   ON blog_regenerate_log(slug);
CREATE INDEX IF NOT EXISTS idx_blog_regenerate_log_recent ON blog_regenerate_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_regenerate_log_reason ON blog_regenerate_log(reason, created_at DESC);

-- 동일 글 재 재생성 방어 — slug+reason 단위 최근 7일 1회 (애플리케이션 레이어에서 cooldown 체크)

ALTER TABLE blog_regenerate_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blog_regenerate_log service" ON blog_regenerate_log;
CREATE POLICY "blog_regenerate_log service" ON blog_regenerate_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE blog_regenerate_log IS 'GSC zero-click 또는 rank-drop 슬러그 자동 재생성 이력 — cron blog-regenerate-zero-click 가 작성';
COMMENT ON COLUMN blog_regenerate_log.gate_passed IS 'runQualityGates() 통과 여부. false 면 본문 교체 안 됨';

COMMIT;
