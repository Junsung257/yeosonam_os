-- free_travel_sessions v2
-- 수동 예약 추적 + 상태 관리 컬럼 추가 (재실행 안전)

ALTER TABLE free_travel_sessions
  ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS mrt_booking_ref TEXT,
  ADD COLUMN IF NOT EXISTS booked_by      TEXT,
  ADD COLUMN IF NOT EXISTS booked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notes    TEXT;

DO $$
BEGIN
  ALTER TABLE free_travel_sessions
    ADD CONSTRAINT fts_status_check CHECK (
      status IN ('new', 'contacted', 'booked', 'cancelled')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_fts_status  ON free_travel_sessions(status);
CREATE INDEX IF NOT EXISTS idx_fts_phone   ON free_travel_sessions(customer_phone) WHERE customer_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fts_created ON free_travel_sessions(created_at DESC);
