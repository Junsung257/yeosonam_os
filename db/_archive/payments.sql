-- sms_payments 테이블: 신한은행 SMS 입금 내역 & 예약 매칭
-- Supabase Dashboard > SQL Editor 에서 실행

CREATE TABLE IF NOT EXISTS sms_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_sms TEXT NOT NULL,                          -- SMS 원문
  sender_name TEXT,                               -- 파싱된 입금자명
  amount INTEGER,                                 -- 입금액 (원)
  received_at TIMESTAMPTZ DEFAULT now(),          -- SMS 수신 시각
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,  -- 매칭된 예약
  match_confidence FLOAT DEFAULT 0,               -- 매칭 신뢰도 (0~1)
  status TEXT DEFAULT 'unmatched'                 -- unmatched | review | matched | manual
    CHECK (status IN ('unmatched', 'review', 'matched', 'manual')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sms_payments_status ON sms_payments(status);
CREATE INDEX IF NOT EXISTS idx_sms_payments_received ON sms_payments(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_payments_booking ON sms_payments(booking_id);

-- RLS (Row Level Security) - 인증된 사용자만 접근
ALTER TABLE sms_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "인증된 사용자만 접근" ON sms_payments
  FOR ALL USING (auth.role() = 'authenticated');

-- 웹훅 서비스 계정용 INSERT 허용 (service_role 키 사용 시)
-- CREATE POLICY "서비스 계정 INSERT" ON sms_payments
--   FOR INSERT WITH CHECK (true);

COMMENT ON TABLE sms_payments IS '신한은행 SMS 입금 내역 - 자동 파싱 및 예약 매칭';
COMMENT ON COLUMN sms_payments.match_confidence IS '매칭 신뢰도: 0.9+ 자동처리, 0.5~0.9 검토필요, 0.5미만 미매칭';
