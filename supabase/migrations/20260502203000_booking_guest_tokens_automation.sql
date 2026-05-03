-- 예약 자동화 확장: 고객 포털 토큰 + 계약금 안내 게이트(운영자 승인)
-- full_auto 전환: bookings.deposit_notice_blocked 기본 false (앱 레이어) + env BOOKING_AUTOMATION_TIER

BEGIN;

-- ── bookings: 계약금 안내(DEPOSIT_NOTICE) 상태 전이 전 운영자 승인 필요 여부
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS deposit_notice_blocked BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN bookings.deposit_notice_blocked IS
  'true면 pending→waiting_deposit 전이 차단. assisted 모드 신규 예약은 true, full_auto는 false. 카카오 수기 확정 등은 생성 시 false로 명시.';

-- ── booking_guest_tokens: 앱 없이 예약 요약 페이지 접근용(원문 토큰은 저장하지 않고 SHA-256만)
CREATE TABLE IF NOT EXISTS booking_guest_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'customer_portal',
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_guest_tokens_hash ON booking_guest_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_booking_guest_tokens_booking ON booking_guest_tokens (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_guest_tokens_active
  ON booking_guest_tokens (booking_id, expires_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE booking_guest_tokens IS
  '고객용 예약 요약 URL(/trip/[token]) — 토큰 원문은 DB에 없음. 알림톡·어드민 발급 시마다 행 추가 가능.';

ALTER TABLE booking_guest_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_guest_tokens service role" ON booking_guest_tokens;
CREATE POLICY "booking_guest_tokens service role"
  ON booking_guest_tokens FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

COMMIT;
