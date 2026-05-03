-- 예약 포털(/trip) 고객 ↔ AI(추후) / 상담 메시지 로그 — 서비스 롤 API 전용(RLS)

BEGIN;

CREATE TABLE IF NOT EXISTS booking_concierge_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'staff', 'system')),
  content     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_concierge_messages_booking_created
  ON booking_concierge_messages (booking_id, created_at DESC);

COMMENT ON TABLE booking_concierge_messages IS
  '알림톡 매직링크 예약 포털 채팅. 클라이언트 직접 접근 없이 Next API(supabaseAdmin)만 사용.';

ALTER TABLE booking_concierge_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_concierge_messages service role" ON booking_concierge_messages;
CREATE POLICY "booking_concierge_messages service role"
  ON booking_concierge_messages FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

COMMIT;
