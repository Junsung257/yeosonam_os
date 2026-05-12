-- ============================================================
-- Solapi 리뷰 자동요청 + GSC 색인/순위 추적 인프라
--
-- 포함:
--   1. solapi_review_sent_log — D+7 리뷰 요청 발송 멱등성/감사 로그
--
-- 참고:
--   - rank_history / rank_alerts 는 20260514000000_blog_seo_v5_missing_schemas.sql 에 이미 정의됨
--     → gsc-index-rank 크론은 source='gsc-page' 로 page-level aggregate 를 누적
--   - GSC service account credential 은 env 변수(GSC_SERVICE_ACCOUNT_JSON)에 저장
-- ============================================================

BEGIN;

-- ─── solapi_review_sent_log ────────────────────────────────────
-- 예약 출발일 D+7 시점에 알림톡 발송 이력. (booking_id) UNIQUE 로 중복 발송 차단.
CREATE TABLE IF NOT EXISTS solapi_review_sent_log (
  id               BIGSERIAL PRIMARY KEY,
  booking_id       UUID NOT NULL,
  customer_id      UUID,
  phone            TEXT,
  template_id      TEXT,
  status           TEXT NOT NULL DEFAULT 'sent'
                   CHECK (status IN ('sent','skipped','failed')),
  response         JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message    TEXT,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT solapi_review_sent_log_booking_unique UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_solapi_review_sent_log_sent_at
  ON solapi_review_sent_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_solapi_review_sent_log_status
  ON solapi_review_sent_log(status);

ALTER TABLE solapi_review_sent_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "solapi_review_sent_log service" ON solapi_review_sent_log;
CREATE POLICY "solapi_review_sent_log service" ON solapi_review_sent_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

-- ───────── 검증 쿼리 (수동) ─────────
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema='public' AND table_name='solapi_review_sent_log';
-- SELECT booking_id, status, sent_at FROM solapi_review_sent_log
--  ORDER BY sent_at DESC LIMIT 20;
