-- ============================================================
-- 여소남 OS — 세무/송금 관리 컬럼 추가
-- 실행: Supabase SQL Editor에 전체 붙여넣기
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS transfer_status         TEXT    DEFAULT 'PENDING'
    CHECK (transfer_status IN ('PENDING','COMPLETED')),
  ADD COLUMN IF NOT EXISTS transfer_receipt_url    TEXT,
  ADD COLUMN IF NOT EXISTS has_tax_invoice         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_receipt_status TEXT    DEFAULT 'NOT_ISSUED'
    CHECK (customer_receipt_status IN ('ISSUED','NOT_ISSUED','NOT_REQUIRED'));

-- 취소된 예약은 NOT_REQUIRED로 일괄 처리
UPDATE bookings
SET customer_receipt_status = 'NOT_REQUIRED'
WHERE status IN ('cancelled')
  AND customer_receipt_status = 'NOT_ISSUED';
