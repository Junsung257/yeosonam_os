-- 여소남 OS: 고객 여정 상태 머신 v1
-- Supabase SQL Editor에서 실행하세요

-- ① bookings 상태 CHECK 확장 (기존 4개 유지 + 신규 4개 추가)
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'pending', 'confirmed', 'completed', 'cancelled',        -- 레거시 (하위 호환)
    'waiting_deposit', 'deposit_paid', 'waiting_balance', 'fully_paid'  -- 신규
  ));

-- ② 계약금 / 환불 / 위약금 컬럼 추가
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_amount INTEGER DEFAULT 0;   -- 계약금
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_amount  INTEGER DEFAULT 0;   -- 환불액
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS penalty_fee    INTEGER DEFAULT 0;   -- 위약금
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;                -- 취소 사유
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ;         -- 취소 처리 시각

-- ③ message_logs 테이블 (고객 응대 타임라인)
-- event_type 값:
--   DEPOSIT_NOTICE      계약금 안내 발송
--   DEPOSIT_CONFIRMED   계약금 입금 확인
--   BALANCE_NOTICE      잔금 안내 발송 (D-15 자동 or 수동)
--   BALANCE_CONFIRMED   잔금 입금 확인
--   CONFIRMATION_GUIDE  출발 확정서 안내 (D-3 자동)
--   HAPPY_CALL          귀국 해피콜 (D+1 자동)
--   CANCELLATION        예약 취소 처리
--   MANUAL_MEMO         관리자 수동 메모
CREATE TABLE IF NOT EXISTS message_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  log_type   TEXT NOT NULL CHECK (log_type IN ('system', 'kakao', 'mock', 'scheduler', 'manual')),
  event_type TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT,
  is_mock    BOOLEAN DEFAULT false,
  created_by TEXT DEFAULT 'system',   -- 'system' | 'admin' | 'cron'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_logs_booking
  ON message_logs(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_logs_event_type
  ON message_logs(event_type);
