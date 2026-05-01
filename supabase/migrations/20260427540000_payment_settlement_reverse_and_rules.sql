-- ============================================================
-- 입출금 채팅식 매칭 — settlement reverse RPC + 학습 룰 테이블
-- 마이그레이션: 20260427540000
-- ============================================================
-- 1) reverse_land_settlement: settlement 1건 atomic 되돌림.
--    - bookings.total_paid_out 차감
--    - bank_transactions.match_status='unmatched' 복원
--    - settlements.status='reversed' + audit
-- 2) payment_command_rules: 3회+ 반복된 매칭 패턴 자동 학습 저장소.
--    cron 이 payment_command_log 를 GROUP BY 해서 INSERT/UPDATE.
-- ============================================================

CREATE OR REPLACE FUNCTION reverse_land_settlement(
  p_settlement_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_reversed_by TEXT DEFAULT 'admin'
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_settle RECORD;
  v_total_reverted INT;
BEGIN
  SELECT id, status, bank_transaction_id, land_operator_id, total_amount, bundled_total
    INTO v_settle
  FROM land_settlements
  WHERE id = p_settlement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement 을 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_settle.status = 'reversed' THEN
    RAISE EXCEPTION '이미 reverse 된 settlement 입니다' USING ERRCODE = 'P0001';
  END IF;

  WITH revert AS (
    SELECT booking_id, amount
    FROM land_settlement_bookings
    WHERE settlement_id = p_settlement_id
  )
  UPDATE bookings b
  SET total_paid_out = GREATEST(0, COALESCE(b.total_paid_out, 0) - revert.amount),
      updated_at = now()
  FROM revert
  WHERE b.id = revert.booking_id;

  GET DIAGNOSTICS v_total_reverted = ROW_COUNT;

  UPDATE bank_transactions
  SET match_status = 'unmatched',
      match_confidence = 0,
      matched_by = NULL,
      matched_at = NULL
  WHERE id = v_settle.bank_transaction_id;

  UPDATE land_settlements
  SET status = 'reversed',
      reversed_at = now(),
      reversed_by = p_reversed_by,
      reversal_reason = p_reason
  WHERE id = p_settlement_id;

  INSERT INTO payment_command_log (
    raw_input, resolved_branch, resolved_outflow_tx_id, resolved_settlement_id,
    user_corrected, action, score, reasons, created_by
  )
  VALUES (
    format('[settlement_reverse] settlement=%s reason=%s', p_settlement_id, COALESCE(p_reason, '-')),
    'B', v_settle.bank_transaction_id, p_settlement_id,
    true, 'dismiss', 0,
    jsonb_build_array(format('reverse %s booking', v_total_reverted)),
    p_reversed_by
  );

  RETURN jsonb_build_object(
    'ok', true,
    'settlement_id', p_settlement_id,
    'bookings_reverted', v_total_reverted,
    'amount_reverted', v_settle.bundled_total
  );
END;
$$;

COMMENT ON FUNCTION reverse_land_settlement IS
  'settlement 1건 atomic reverse. bookings.total_paid_out 차감 + bank_tx unmatched 복원 + audit.';

CREATE TABLE IF NOT EXISTS payment_command_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_signature TEXT NOT NULL,
  parsed_operator_alias TEXT,
  resolved_operator_id UUID REFERENCES land_operators(id) ON DELETE SET NULL,
  learn_count INT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id UUID,
  UNIQUE (pattern_signature, parsed_operator_alias, resolved_operator_id)
);

CREATE INDEX IF NOT EXISTS idx_pcr_pattern ON payment_command_rules(pattern_signature);
CREATE INDEX IF NOT EXISTS idx_pcr_operator ON payment_command_rules(resolved_operator_id);
CREATE INDEX IF NOT EXISTS idx_pcr_count ON payment_command_rules(learn_count DESC);

COMMENT ON TABLE payment_command_rules IS
  '⌘K 매칭 학습 룰. 같은 (pattern_signature, alias, operator_id) 가 입금 + user_corrected=false + 3회+ 인 패턴이 자동 등록됨.';

CREATE OR REPLACE FUNCTION learn_payment_rules(
  p_min_count INT DEFAULT 3,
  p_lookback_days INT DEFAULT 90
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_row RECORD;
  v_existing_id UUID;
BEGIN
  FOR v_row IN
    SELECT
      l.pattern_signature,
      l.parsed_operator_alias,
      b.land_operator_id AS resolved_operator_id,
      count(*) AS occurrences,
      max(l.created_at) AS last_seen
    FROM payment_command_log l
    LEFT JOIN bookings b ON b.id = l.resolved_booking_id
    WHERE l.action = 'confirm'
      AND l.user_corrected = false
      AND l.resolved_branch = 'A'
      AND l.resolved_inflow_tx_id IS NOT NULL
      AND l.created_at >= now() - (p_lookback_days || ' days')::INTERVAL
      AND l.pattern_signature IS NOT NULL
    GROUP BY l.pattern_signature, l.parsed_operator_alias, b.land_operator_id
    HAVING count(*) >= p_min_count
  LOOP
    SELECT id INTO v_existing_id
    FROM payment_command_rules
    WHERE pattern_signature = v_row.pattern_signature
      AND parsed_operator_alias IS NOT DISTINCT FROM v_row.parsed_operator_alias
      AND resolved_operator_id IS NOT DISTINCT FROM v_row.resolved_operator_id;

    IF v_existing_id IS NULL THEN
      INSERT INTO payment_command_rules (
        pattern_signature, parsed_operator_alias, resolved_operator_id,
        learn_count, first_seen_at, last_seen_at
      ) VALUES (
        v_row.pattern_signature, v_row.parsed_operator_alias, v_row.resolved_operator_id,
        v_row.occurrences, v_row.last_seen, v_row.last_seen
      );
      v_inserted := v_inserted + 1;
    ELSE
      UPDATE payment_command_rules
      SET learn_count = v_row.occurrences,
          last_seen_at = v_row.last_seen
      WHERE id = v_existing_id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'min_count', p_min_count,
    'lookback_days', p_lookback_days
  );
END;
$$;

COMMENT ON FUNCTION learn_payment_rules IS
  'payment_command_log 의 입금+user_corrected=false+분기A 매칭을 GROUP BY 해서 3회+ 패턴을 payment_command_rules 에 누적. 일별 cron 호출.';

NOTIFY pgrst, 'reload schema';
