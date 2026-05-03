CREATE TABLE IF NOT EXISTS booking_companions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  invite_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  name TEXT DEFAULT NULL,
  email TEXT DEFAULT NULL,
  phone TEXT DEFAULT NULL,
  passport_name TEXT DEFAULT NULL,  -- 여권 영문 이름
  passport_no TEXT DEFAULT NULL,    -- 여권 번호 (마스킹 저장)
  passport_expiry DATE DEFAULT NULL,
  birth_date DATE DEFAULT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_companions_booking ON booking_companions(booking_id);
CREATE INDEX idx_booking_companions_token ON booking_companions(invite_token);
COMMENT ON TABLE booking_companions IS '예약 동행자 여권 정보. 대표예약자가 초대 링크 공유 → 동행자 직접 입력';
