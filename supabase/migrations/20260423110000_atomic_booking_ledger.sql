-- =============================================================
-- 여소남 OS — Atomic Booking Ledger RPC
-- =============================================================
-- 목적:
--   JS 메모리에서 paid_amount를 +증감하던 "read-modify-write" 패턴을
--   DB atomic UPDATE로 대체. Race condition으로 인한 회계 오류 제거.
--
-- 해결하는 시나리오:
--   - 웹훅 A (+50만) + 웹훅 B (+30만)이 동시 매칭
--   - 기존: 둘 다 paid_amount=0 읽음 → 한쪽 덮어쓰기 → 50만원 증발
--   - 신규: UPDATE ... SET paid_amount = paid_amount + x (row-level lock 내장)
--
-- 사용법:
--   SELECT update_booking_ledger(booking_id, p_paid_delta, p_payout_delta);
--   → 새 payment_status + 새 status 반환
-- =============================================================

CREATE OR REPLACE FUNCTION update_booking_ledger(
  p_booking_id UUID,
  p_paid_delta INTEGER DEFAULT 0,      -- paid_amount 증감분 (음수 가능 = 환불/롤백)
  p_payout_delta INTEGER DEFAULT 0     -- total_paid_out 증감분
)
RETURNS TABLE (
  paid_amount INTEGER,
  total_paid_out INTEGER,
  payment_status TEXT,
  booking_status TEXT,
  auto_status_changed BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_price INTEGER;
  v_total_cost INTEGER;
  v_new_paid INTEGER;
  v_new_payout INTEGER;
  v_new_payment_status TEXT;
  v_cur_status TEXT;
  v_new_status TEXT;
  v_status_changed BOOLEAN := FALSE;
  v_fee_tolerance CONSTANT INTEGER := 5000;  -- payment-matcher.ts FEE_TOLERANCE와 동일
BEGIN
  -- [1] 원자적 UPDATE — Postgres는 UPDATE 대상 row에 자동 row-lock 적용
  UPDATE bookings
  SET
    paid_amount    = GREATEST(0, COALESCE(paid_amount, 0)    + p_paid_delta),
    total_paid_out = GREATEST(0, COALESCE(total_paid_out, 0) + p_payout_delta),
    updated_at     = NOW()
  WHERE id = p_booking_id
  RETURNING
    COALESCE(total_price, 0),
    COALESCE(total_cost, 0),
    paid_amount,
    total_paid_out,
    status
  INTO
    v_total_price,
    v_total_cost,
    v_new_paid,
    v_new_payout,
    v_cur_status;

  IF NOT FOUND THEN
    -- booking 없음 → NULL 반환
    RETURN;
  END IF;

  -- [2] payment_status 재계산 (payment-matcher.ts calcPaymentStatus와 동일 로직)
  IF v_total_cost > 0 AND v_new_payout > v_total_cost + v_fee_tolerance THEN
    v_new_payment_status := '초과지급(경고)';
  ELSIF v_total_price > 0 AND v_new_paid >= v_total_price THEN
    v_new_payment_status := '완납';
  ELSIF v_new_paid > 0 THEN
    v_new_payment_status := '예약금완료';
  ELSE
    v_new_payment_status := '미입금';
  END IF;

  -- [3] booking.status 자동 진행 (취소된 예약은 제외)
  --     pending → confirmed (일부 입금 시)
  --     confirmed → completed (완납 시)
  v_new_status := v_cur_status;
  IF v_cur_status <> 'cancelled' AND p_paid_delta > 0 THEN
    IF v_new_paid >= v_total_price AND v_total_price > 0 AND v_cur_status <> 'completed' THEN
      v_new_status := 'completed';
    ELSIF v_new_paid > 0 AND v_cur_status = 'pending' THEN
      v_new_status := 'confirmed';
    END IF;
  END IF;

  -- [4] payment_status + 변경된 status 반영 (역시 같은 트랜잭션)
  IF v_new_status <> v_cur_status THEN
    UPDATE bookings
    SET
      payment_status = v_new_payment_status,
      status         = v_new_status,
      updated_at     = NOW()
    WHERE id = p_booking_id;
    v_status_changed := TRUE;
  ELSE
    UPDATE bookings
    SET
      payment_status = v_new_payment_status,
      updated_at     = NOW()
    WHERE id = p_booking_id;
  END IF;

  -- [5] 결과 반환
  RETURN QUERY SELECT
    v_new_paid,
    v_new_payout,
    v_new_payment_status,
    v_new_status,
    v_status_changed;
END;
$$;

-- RLS가 있어도 SECURITY DEFINER가 아니므로 service_role만 호출 가능
-- (봇/크론 경로는 supabaseAdmin = service role 사용)

-- 마이그레이션 로그
DO $$
BEGIN
  RAISE NOTICE '[atomic-ledger] update_booking_ledger RPC 생성 완료';
END $$;
