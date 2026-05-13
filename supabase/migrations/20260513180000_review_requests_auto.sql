-- ═══════════════════════════════════════════════════════════════════
-- Phase 8-8: 후기 자동 수집
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS review_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid REFERENCES bookings(id) ON DELETE CASCADE,
  customer_phone  text,
  customer_name   text,
  product_id      text,
  departure_date  date,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  channel         text DEFAULT 'kakao' CHECK (channel IN ('kakao','sms','email')),
  message_id      text,
  delivery_status text DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','delivered','failed')),
  responded_at    timestamptz,
  response_url    text,
  retry_count     int DEFAULT 0,
  last_retry_at   timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_review_requests_booking ON review_requests (booking_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_pending ON review_requests (delivery_status, requested_at) WHERE delivery_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_review_requests_unresponded ON review_requests (responded_at) WHERE responded_at IS NULL;

COMMENT ON TABLE review_requests IS
  '후기 자동 수집 — 출발 D+3 cron 이 자동 발송. 응답은 reviews 테이블에 저장.';
