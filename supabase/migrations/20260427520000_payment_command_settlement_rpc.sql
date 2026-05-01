-- ============================================================
-- 입출금 채팅식 매칭 — 출금 묶음 atomic RPC
-- 마이그레이션: 20260427520000
-- ============================================================
-- 설계
--  settlement-bundle 라우트에서 다단계 UPDATE/INSERT 가 진행되는데,
--  Postgres 트랜잭션 경계가 라우트 안에서 깨질 위험 + booking.total_paid_out
--  read-modify-write 경쟁이 있어서 RPC 함수 1건으로 묶음.
--  - bank_transactions FOR UPDATE 로 거래 단위 락
--  - bookings.total_paid_out 은 atomic increment (read-modify-write 제거)
--  - 모든 검증·INSERT·UPDATE·audit 가 같은 트랜잭션 — 중간 실패 시 전체 롤백
-- 정책: 출금 자동매칭 절대 금지. 함수 진입 시 transaction_type='출금' 만 허용.
-- ============================================================

CREATE OR REPLACE FUNCTION create_land_settlement(
  p_transaction_id UUID,
  p_land_operator_id UUID,
  p_booking_amounts JSONB,
  p_notes TEXT DEFAULT NULL,
  p_is_refund BOOLEAN DEFAULT NULL,
  p_created_by TEXT DEFAULT 'admin',
  p_fee_tolerance INT DEFAULT 5000
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx RECORD;
  v_total_abs INT;
  v_bundled INT;
  v_fee INT;
  v_settlement_id UUID;
  v_input_count INT;
  v_existing_count INT;
  v_distinct_count INT;
BEGIN
  SELECT id, transaction_type, amount, is_refund, match_status
    INTO v_tx
  FROM bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '거래를 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.transaction_type <> '출금' THEN
    RAISE EXCEPTION '출금 거래만 settlement 로 묶을 수 있습니다' USING ERRCODE = 'P0001';
  END IF;
  IF v_tx.match_status NOT IN ('unmatched','review','error') THEN
    RAISE EXCEPTION '이미 매칭된 거래입니다 (match_status=%)', v_tx.match_status
      USING ERRCODE = 'P0002';
  END IF;

  v_total_abs := abs(v_tx.amount);
  v_input_count := jsonb_array_length(p_booking_amounts);
  IF v_input_count = 0 THEN
    RAISE EXCEPTION 'booking 1개 이상 필요' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM((e->>'amount')::INT), 0) INTO v_bundled
  FROM jsonb_array_elements(p_booking_amounts) e;
  v_fee := v_total_abs - v_bundled;
  IF abs(v_fee) > p_fee_tolerance THEN
    RAISE EXCEPTION '합계 불일치 — 출금 % ≠ 묶음 % (차액 %, 허용 ±%)',
      v_total_abs, v_bundled, v_fee, p_fee_tolerance
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM land_operators WHERE id = p_land_operator_id) THEN
    RAISE EXCEPTION '랜드사를 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(DISTINCT (e->>'booking_id')::UUID) INTO v_distinct_count
  FROM jsonb_array_elements(p_booking_amounts) e;
  IF v_distinct_count <> v_input_count THEN
    RAISE EXCEPTION '입력에 중복된 booking 이 있습니다' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_existing_count
  FROM bookings
  WHERE id IN (SELECT (e->>'booking_id')::UUID FROM jsonb_array_elements(p_booking_amounts) e)
    AND COALESCE(is_deleted, false) = false;
  IF v_existing_count <> v_input_count THEN
    RAISE EXCEPTION '존재하지 않거나 삭제된 booking 포함' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO land_settlements (
    land_operator_id, bank_transaction_id, total_amount, bundled_total,
    fee_amount, is_refund, status, notes, created_by
  )
  VALUES (
    p_land_operator_id, p_transaction_id, v_total_abs, v_bundled,
    v_fee, COALESCE(p_is_refund, v_tx.is_refund),
    'pending', p_notes, p_created_by
  )
  RETURNING id INTO v_settlement_id;

  INSERT INTO land_settlement_bookings (settlement_id, booking_id, amount)
  SELECT v_settlement_id, (e->>'booking_id')::UUID, (e->>'amount')::INT
  FROM jsonb_array_elements(p_booking_amounts) e;

  UPDATE bookings b
  SET total_paid_out = COALESCE(b.total_paid_out, 0) + sub.amount,
      updated_at = now()
  FROM (
    SELECT (e->>'booking_id')::UUID AS booking_id, (e->>'amount')::INT AS amount
    FROM jsonb_array_elements(p_booking_amounts) e
  ) sub
  WHERE b.id = sub.booking_id;

  UPDATE bank_transactions
  SET match_status = 'manual',
      match_confidence = 1.0,
      matched_by = p_created_by,
      matched_at = now()
  WHERE id = p_transaction_id;

  INSERT INTO payment_command_log (
    raw_input, resolved_branch, resolved_outflow_tx_id, resolved_settlement_id,
    user_corrected, action, score, reasons, created_by
  )
  VALUES (
    format('[settlement] tx=%s op=%s bookings=%s',
      p_transaction_id, p_land_operator_id, v_input_count),
    'B', p_transaction_id, v_settlement_id,
    true, 'confirm', 1.0,
    jsonb_build_array(format('묶음 %s건 / 수수료 %s', v_input_count, v_fee)),
    p_created_by
  );

  RETURN jsonb_build_object(
    'ok', true,
    'settlement_id', v_settlement_id,
    'bundled_total', v_bundled,
    'fee_amount', v_fee,
    'booking_count', v_input_count
  );
END;
$$;

COMMENT ON FUNCTION create_land_settlement IS
  '출금 거래 1건을 N booking 으로 atomic 하게 묶음. 검증·INSERT·UPDATE·audit 모두 같은 트랜잭션. 자동매칭 금지 정책: transaction_type=출금만 허용.';

NOTIFY pgrst, 'reload schema';
