-- ============================================================
-- ⚠️  DEPRECATED — 사용 금지 (2026-04-30)
--
-- 이 RPC 는 bookings.paid_amount / total_paid_out 을
-- ledger_entries 우회 직접 UPDATE → silent drift 유발.
--
-- 대체 RPC: `resync_paid_amounts_with_ledger()`
--   - 재계산 결과 + 기존 ledger SUM 차액을 manual_adjust 로 보정 INSERT
--   - 호출 후 reconcile drift = 0 보장
--   - migration: supabase/migrations/20260430020000_resync_paid_amounts_with_ledger.sql
--
-- 이 파일은 이력 보존을 위해 남겨두지만 **DB 에 적용하지 말 것**.
-- ============================================================
-- 입금 재동기화 SQL 함수 (DEPRECATED — Phase 2a 이전 레거시)
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
