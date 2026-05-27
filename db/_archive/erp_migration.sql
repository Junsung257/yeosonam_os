-- ERP 정산 시스템 마이그레이션
-- Supabase Dashboard > SQL Editor 에서 실행

-- 1. sms_payments: 입금 출처 구분 (SMS / 슬랙 Clobe.ai)
ALTER TABLE sms_payments
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'sms'
  CHECK (source IN ('sms', 'slack'));

-- 2. bookings: 입금 누적액 + 결제 상태 추가
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS paid_amount INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT '미입금'
    CHECK (payment_status IN ('미입금', '예약금완료', '완납'));

-- 3. 인덱스
CREATE INDEX IF NOT EXISTS idx_sms_payments_source ON sms_payments(source);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);

-- 4. 기존 matched/manual 상태 행은 paid_amount 재계산 (선택 실행)
-- UPDATE bookings b
-- SET paid_amount = (
--   SELECT COALESCE(SUM(amount), 0)
--   FROM sms_payments sp
--   WHERE sp.booking_id = b.id
--     AND sp.status IN ('matched', 'manual')
--     AND sp.amount > 0
-- );

COMMENT ON COLUMN sms_payments.source IS '입금 수신 채널: sms(신한은행 SMS) | slack(Clobe.ai 슬랙 알림)';
COMMENT ON COLUMN bookings.paid_amount IS '누적 입금액 (원) — sms_payments 매칭 완료 시 자동 증가';
COMMENT ON COLUMN bookings.payment_status IS '결제 상태: 미입금 | 예약금완료 | 완납';
