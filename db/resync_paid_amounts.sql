-- ============================================================
-- 입금 재동기화 SQL 함수
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

CREATE OR REPLACE FUNCTION resync_paid_amounts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE bookings b
  SET
    paid_amount = GREATEST(0, COALESCE((
      SELECT SUM(CASE
        WHEN bt.transaction_type = '입금'
          AND NOT COALESCE(bt.is_refund, false)
          AND NOT COALESCE(bt.is_fee, false) THEN bt.amount
        WHEN COALESCE(bt.is_refund, false) THEN -bt.amount
        ELSE 0
      END)
      FROM bank_transactions bt
      WHERE bt.booking_id = b.id
        AND bt.match_status IN ('auto', 'manual')
    ), 0)),
    total_paid_out = GREATEST(0, COALESCE((
      SELECT SUM(CASE
        WHEN bt.transaction_type = '출금'
          AND NOT COALESCE(bt.is_refund, false)
          AND NOT COALESCE(bt.is_fee, false) THEN bt.amount
        ELSE 0
      END)
      FROM bank_transactions bt
      WHERE bt.booking_id = b.id
        AND bt.match_status IN ('auto', 'manual')
    ), 0))
  WHERE EXISTS (
    SELECT 1 FROM bank_transactions bt
    WHERE bt.booking_id = b.id
      AND bt.match_status IN ('auto', 'manual')
  );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- 생성 확인
SELECT 'resync_paid_amounts 함수 생성 완료' AS result;
