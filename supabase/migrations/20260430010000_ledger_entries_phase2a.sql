-- =============================================================
-- 여소남 OS — Phase 2a: Append-only Ledger (이중쓰기)
-- =============================================================
-- 목적:
--   기존 bookings.paid_amount / total_paid_out 직접 UPDATE 방식을
--   append-only 원장(ledger_entries)으로 이관하기 위한 첫 단계.
--   모든 paid_amount / total_paid_out 변경 경로에 ledger INSERT 를
--   같은 트랜잭션 안에서 병행(double-write).
--
-- Phase 2a (이번 마이그레이션):
--   1) ledger_entries 테이블 + append-only RULE
--   2) record_ledger_entry() helper
--   3) update_booking_ledger / confirm_payment_match / create_land_settlement /
--      reverse_land_settlement RPC 4종에 ledger INSERT 추가
--   4) record_manual_paid_amount_change RPC (직접 UPDATE 경로 대체)
--   5) seed_ledger_from_current_balances() — 1회성 backfill
--   6) reconcile_ledger() — 일일 대조 함수
--
-- Phase 2b (다음 단계, 별도 마이그레이션):
--   - 읽기 경로를 ledger view 로 전환
--   - paid_amount 컬럼을 GENERATED 또는 view 로 전환
--
-- 레퍼런스:
--   - Square Books (immutable double-entry)
--   - Modern Treasury — Enforcing Immutability
--
-- 롤백 트리거 (Phase 2a 모니터링 1주):
--   - 이중쓰기 후 paid_amount ≠ ledger SUM 1건 이상
--   - 매칭 실패율 +5%
-- =============================================================

-- ─── [1] ledger_entries 테이블 ───────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,

  -- 원장 분류
  account TEXT NOT NULL CHECK (account IN ('paid_amount', 'total_paid_out')),
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'deposit',          -- 고객 입금 → paid_amount +
    'refund',           -- 고객 환불 → paid_amount -
    'payout',           -- 랜드사 송금 → total_paid_out +
    'payout_reverse',   -- 랜드사 송금 취소 → total_paid_out -
    'manual_adjust',    -- 어드민 수동 보정 (양/음)
    'seed_backfill'     -- Phase 2a 초기 시드 (1회성)
  )),
  amount BIGINT NOT NULL,      -- signed (원). +면 잔액 증가, -면 감소
  currency TEXT NOT NULL DEFAULT 'KRW',

  -- 출처 추적 (감사·재현용)
  source TEXT NOT NULL CHECK (source IN (
    'slack_ingest',
    'payment_match_confirm',
    'land_settlement_create',
    'land_settlement_reverse',
    'admin_manual_edit',
    'booking_create_softmatch',
    'bank_tx_manual_match',
    'sms_payment',
    'cron_resync',
    'seed_phase2a'
  )),
  source_ref_id TEXT,            -- bank_transactions.id, settlement_id, sms_payments.id 등

  -- 멱등성 — 같은 (source, source_ref_id, entry_type) 가 두번 들어오면 거부
  idempotency_key TEXT UNIQUE,

  -- 메타데이터
  memo TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NOTE: updated_at 없음. Append-only 보장.
);

CREATE INDEX IF NOT EXISTS idx_ledger_booking_account
  ON ledger_entries(booking_id, account, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_source_ref
  ON ledger_entries(source, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at
  ON ledger_entries(created_at DESC);

-- 0원 entry 차단 (행 낭비 방지). 단 manual_adjust 보정성 0 허용 안함.
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_amount_nonzero CHECK (amount <> 0);

-- Append-only 강제: UPDATE / DELETE 차단 (RULE 사용 — 트리거보다 가벼움)
CREATE OR REPLACE RULE ledger_entries_no_update AS
  ON UPDATE TO ledger_entries DO INSTEAD NOTHING;
CREATE OR REPLACE RULE ledger_entries_no_delete AS
  ON DELETE TO ledger_entries DO INSTEAD NOTHING;

COMMENT ON TABLE ledger_entries IS
  'Phase 2a append-only ledger. paid_amount / total_paid_out 의 모든 변경을 immutable 한 원장으로 누적. UPDATE/DELETE RULE 로 차단. SUM(ledger) = bookings.<account> 가 일일 대조의 기준.';

-- ─── [2] record_ledger_entry() helper ────────────────────────
-- RPC 안에서 호출되는 내부 헬퍼.
-- idempotency_key 충돌 시 INSERT 스킵 + 기존 entry id 반환.

CREATE OR REPLACE FUNCTION record_ledger_entry(
  p_booking_id UUID,
  p_account TEXT,
  p_entry_type TEXT,
  p_amount BIGINT,
  p_source TEXT,
  p_source_ref_id TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_memo TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_amount = 0 THEN
    RETURN NULL;  -- 0원은 ledger 에 기록하지 않음
  END IF;

  -- 멱등성: 같은 idempotency_key 가 이미 있으면 기존 id 반환
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id
    FROM ledger_entries
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO ledger_entries (
    booking_id, account, entry_type, amount,
    source, source_ref_id, idempotency_key,
    memo, created_by
  ) VALUES (
    p_booking_id, p_account, p_entry_type, p_amount,
    p_source, p_source_ref_id, p_idempotency_key,
    p_memo, p_created_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION record_ledger_entry IS
  'Phase 2a 내부 헬퍼. RPC 들이 paid_amount/total_paid_out UPDATE 와 같은 트랜잭션에서 호출. idempotency_key 충돌 시 기존 id 반환 (재시도 안전).';

-- ─── [3] update_booking_ledger v2 — 이중쓰기 추가 ────────────
-- 기존 시그니처 호환 + 선택적 source/idempotency 파라미터.
-- 호출부(slack-ingest applyLedger)는 점진적으로 신규 인자 전달.

CREATE OR REPLACE FUNCTION update_booking_ledger(
  p_booking_id UUID,
  p_paid_delta INTEGER DEFAULT 0,
  p_payout_delta INTEGER DEFAULT 0,
  p_source TEXT DEFAULT 'slack_ingest',
  p_source_ref_id TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_memo TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL
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
  v_fee_tolerance CONSTANT INTEGER := 5000;
  v_paid_idem TEXT;
  v_payout_idem TEXT;
BEGIN
  -- [1] 원자적 UPDATE — Postgres row-lock 자동 적용
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
    RETURN;
  END IF;

  -- [1.5] Ledger 이중쓰기 (Phase 2a) — 같은 트랜잭션
  -- 분할 idempotency: paid 와 payout 을 별도 entry 로 기록
  IF p_paid_delta <> 0 THEN
    v_paid_idem := CASE
      WHEN p_idempotency_key IS NOT NULL
        THEN p_idempotency_key || ':paid'
      ELSE NULL
    END;
    PERFORM record_ledger_entry(
      p_booking_id := p_booking_id,
      p_account := 'paid_amount',
      p_entry_type := CASE WHEN p_paid_delta > 0 THEN 'deposit' ELSE 'refund' END,
      p_amount := p_paid_delta,
      p_source := p_source,
      p_source_ref_id := p_source_ref_id,
      p_idempotency_key := v_paid_idem,
      p_memo := p_memo,
      p_created_by := p_created_by
    );
  END IF;

  IF p_payout_delta <> 0 THEN
    v_payout_idem := CASE
      WHEN p_idempotency_key IS NOT NULL
        THEN p_idempotency_key || ':payout'
      ELSE NULL
    END;
    PERFORM record_ledger_entry(
      p_booking_id := p_booking_id,
      p_account := 'total_paid_out',
      p_entry_type := CASE WHEN p_payout_delta > 0 THEN 'payout' ELSE 'payout_reverse' END,
      p_amount := p_payout_delta,
      p_source := p_source,
      p_source_ref_id := p_source_ref_id,
      p_idempotency_key := v_payout_idem,
      p_memo := p_memo,
      p_created_by := p_created_by
    );
  END IF;

  -- [2] payment_status 재계산
  IF v_total_cost > 0 AND v_new_payout > v_total_cost + v_fee_tolerance THEN
    v_new_payment_status := '초과지급(경고)';
  ELSIF v_total_price > 0 AND v_new_paid >= v_total_price THEN
    v_new_payment_status := '완납';
  ELSIF v_new_paid > 0 THEN
    v_new_payment_status := '예약금완료';
  ELSE
    v_new_payment_status := '미입금';
  END IF;

  -- [3] booking.status 자동 진행
  v_new_status := v_cur_status;
  IF v_cur_status <> 'cancelled' AND p_paid_delta > 0 THEN
    IF v_new_paid >= v_total_price AND v_total_price > 0 AND v_cur_status <> 'completed' THEN
      v_new_status := 'completed';
    ELSIF v_new_paid > 0 AND v_cur_status = 'pending' THEN
      v_new_status := 'confirmed';
    END IF;
  END IF;

  -- [4] payment_status + status 반영
  IF v_new_status <> v_cur_status THEN
    UPDATE bookings
    SET payment_status = v_new_payment_status,
        status         = v_new_status,
        updated_at     = NOW()
    WHERE id = p_booking_id;
    v_status_changed := TRUE;
  ELSE
    UPDATE bookings
    SET payment_status = v_new_payment_status,
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

COMMENT ON FUNCTION update_booking_ledger IS
  'Phase 2a v2 — atomic UPDATE + ledger INSERT 이중쓰기. p_idempotency_key 가 있으면 :paid / :payout 접미로 분할 멱등 보장. 기존 호출부(p_paid_delta, p_payout_delta 만 전달)는 그대로 동작.';

-- ─── [4] confirm_payment_match v2 — 이중쓰기 추가 ────────────

CREATE OR REPLACE FUNCTION confirm_payment_match(
  p_transaction_id UUID,
  p_booking_id UUID,
  p_score NUMERIC,
  p_created_by TEXT DEFAULT 'admin'
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx RECORD;
  v_booking RECORD;
  v_amount_signed INT;
  v_idem TEXT;
BEGIN
  SELECT id, transaction_type, amount, is_refund, match_status
    INTO v_tx
  FROM bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '거래를 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.match_status NOT IN ('unmatched','review','error') THEN
    RAISE EXCEPTION '이미 매칭된 거래입니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.transaction_type = '출금' AND COALESCE(v_tx.is_refund, false) = false THEN
    RAISE EXCEPTION '일반 출금은 booking 직접 매칭 금지 (settlement-bundle 사용)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT id, paid_amount, total_paid_out INTO v_booking
  FROM bookings
  WHERE id = p_booking_id AND COALESCE(is_deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking 을 찾을 수 없거나 삭제됨' USING ERRCODE = 'P0002';
  END IF;

  UPDATE bank_transactions
  SET booking_id = p_booking_id,
      match_status = 'manual',
      match_confidence = p_score,
      matched_by = p_created_by,
      matched_at = now()
  WHERE id = p_transaction_id;

  v_amount_signed := abs(v_tx.amount);
  v_idem := 'pmc:' || p_transaction_id::TEXT;

  IF v_tx.transaction_type = '입금' THEN
    UPDATE bookings
    SET paid_amount = COALESCE(paid_amount, 0) + v_amount_signed,
        updated_at = now()
    WHERE id = p_booking_id;

    PERFORM record_ledger_entry(
      p_booking_id := p_booking_id,
      p_account := 'paid_amount',
      p_entry_type := 'deposit',
      p_amount := v_amount_signed,
      p_source := 'payment_match_confirm',
      p_source_ref_id := p_transaction_id::TEXT,
      p_idempotency_key := v_idem,
      p_memo := format('confirm_payment_match score=%s', p_score),
      p_created_by := p_created_by
    );

  ELSIF v_tx.transaction_type = '출금' AND v_tx.is_refund = true THEN
    UPDATE bookings
    SET paid_amount = GREATEST(0, COALESCE(paid_amount, 0) - v_amount_signed),
        updated_at = now()
    WHERE id = p_booking_id;

    PERFORM record_ledger_entry(
      p_booking_id := p_booking_id,
      p_account := 'paid_amount',
      p_entry_type := 'refund',
      p_amount := -v_amount_signed,
      p_source := 'payment_match_confirm',
      p_source_ref_id := p_transaction_id::TEXT,
      p_idempotency_key := v_idem,
      p_memo := format('confirm_payment_match refund score=%s', p_score),
      p_created_by := p_created_by
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_id', p_transaction_id,
    'booking_id', p_booking_id,
    'amount_applied', v_amount_signed,
    'is_refund', COALESCE(v_tx.is_refund, false),
    'transaction_type', v_tx.transaction_type
  );
END;
$$;

COMMENT ON FUNCTION confirm_payment_match IS
  'Phase 2a v2 — 입금/환불 출금 → booking atomic 매칭 + ledger INSERT 이중쓰기. idempotency_key=pmc:<tx_id>.';

-- ─── [5] create_land_settlement v2 — 이중쓰기 추가 ───────────

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
  v_pair RECORD;
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

  -- bookings.total_paid_out atomic increment + ledger 이중쓰기 (per booking)
  FOR v_pair IN
    SELECT (e->>'booking_id')::UUID AS booking_id, (e->>'amount')::INT AS amount
    FROM jsonb_array_elements(p_booking_amounts) e
  LOOP
    UPDATE bookings
    SET total_paid_out = COALESCE(total_paid_out, 0) + v_pair.amount,
        updated_at = now()
    WHERE id = v_pair.booking_id;

    PERFORM record_ledger_entry(
      p_booking_id := v_pair.booking_id,
      p_account := 'total_paid_out',
      p_entry_type := CASE WHEN COALESCE(p_is_refund, v_tx.is_refund) THEN 'payout_reverse' ELSE 'payout' END,
      p_amount := v_pair.amount,
      p_source := 'land_settlement_create',
      p_source_ref_id := v_settlement_id::TEXT,
      p_idempotency_key := 'lsc:' || v_settlement_id::TEXT || ':' || v_pair.booking_id::TEXT,
      p_memo := format('settlement bundle tx=%s op=%s', p_transaction_id, p_land_operator_id),
      p_created_by := p_created_by
    );
  END LOOP;

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
  'Phase 2a v2 — 출금 거래 1건을 N booking 으로 atomic 묶음 + ledger INSERT 이중쓰기. idempotency_key=lsc:<settlement_id>:<booking_id>.';

-- ─── [6] reverse_land_settlement v2 — 이중쓰기 추가 ──────────

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
  v_pair RECORD;
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

  v_total_reverted := 0;

  FOR v_pair IN
    SELECT booking_id, amount
    FROM land_settlement_bookings
    WHERE settlement_id = p_settlement_id
  LOOP
    UPDATE bookings
    SET total_paid_out = GREATEST(0, COALESCE(total_paid_out, 0) - v_pair.amount),
        updated_at = now()
    WHERE id = v_pair.booking_id;

    PERFORM record_ledger_entry(
      p_booking_id := v_pair.booking_id,
      p_account := 'total_paid_out',
      p_entry_type := 'payout_reverse',
      p_amount := -v_pair.amount,
      p_source := 'land_settlement_reverse',
      p_source_ref_id := p_settlement_id::TEXT,
      p_idempotency_key := 'lsr:' || p_settlement_id::TEXT || ':' || v_pair.booking_id::TEXT,
      p_memo := format('reverse settlement reason=%s', COALESCE(p_reason, '-')),
      p_created_by := p_reversed_by
    );

    v_total_reverted := v_total_reverted + 1;
  END LOOP;

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
  'Phase 2a v2 — settlement atomic reverse + ledger INSERT 이중쓰기. idempotency_key=lsr:<settlement_id>:<booking_id>.';

-- ─── [7] record_manual_paid_amount_change RPC ────────────────
-- 어드민 수동 paid_amount 편집·소급 매칭 등 직접 UPDATE 경로 통합 입구.
-- absolute 값을 받아 delta 를 자동 계산 → ledger INSERT.

CREATE OR REPLACE FUNCTION record_manual_paid_amount_change(
  p_booking_id UUID,
  p_new_paid_amount INT DEFAULT NULL,
  p_new_total_paid_out INT DEFAULT NULL,
  p_source TEXT DEFAULT 'admin_manual_edit',
  p_source_ref_id TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_memo TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'admin'
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_cur RECORD;
  v_paid_delta INT := 0;
  v_payout_delta INT := 0;
BEGIN
  SELECT paid_amount, total_paid_out INTO v_cur
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_new_paid_amount IS NOT NULL THEN
    v_paid_delta := p_new_paid_amount - COALESCE(v_cur.paid_amount, 0);
  END IF;
  IF p_new_total_paid_out IS NOT NULL THEN
    v_payout_delta := p_new_total_paid_out - COALESCE(v_cur.total_paid_out, 0);
  END IF;

  UPDATE bookings
  SET paid_amount    = COALESCE(p_new_paid_amount, paid_amount),
      total_paid_out = COALESCE(p_new_total_paid_out, total_paid_out),
      updated_at     = now()
  WHERE id = p_booking_id;

  IF v_paid_delta <> 0 THEN
    PERFORM record_ledger_entry(
      p_booking_id := p_booking_id,
      p_account := 'paid_amount',
      p_entry_type := 'manual_adjust',
      p_amount := v_paid_delta,
      p_source := p_source,
      p_source_ref_id := p_source_ref_id,
      p_idempotency_key := CASE WHEN p_idempotency_key IS NOT NULL THEN p_idempotency_key || ':paid' ELSE NULL END,
      p_memo := p_memo,
      p_created_by := p_created_by
    );
  END IF;

  IF v_payout_delta <> 0 THEN
    PERFORM record_ledger_entry(
      p_booking_id := p_booking_id,
      p_account := 'total_paid_out',
      p_entry_type := 'manual_adjust',
      p_amount := v_payout_delta,
      p_source := p_source,
      p_source_ref_id := p_source_ref_id,
      p_idempotency_key := CASE WHEN p_idempotency_key IS NOT NULL THEN p_idempotency_key || ':payout' ELSE NULL END,
      p_memo := p_memo,
      p_created_by := p_created_by
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'paid_delta', v_paid_delta,
    'payout_delta', v_payout_delta
  );
END;
$$;

COMMENT ON FUNCTION record_manual_paid_amount_change IS
  'Phase 2a — 직접 UPDATE 경로(어드민 수동 편집·소급 매칭·webhook 매칭) 통합 입구. absolute 값을 받아 delta 자동 계산 + ledger 이중쓰기.';

-- ─── [8] seed_ledger_from_current_balances() — 1회성 backfill ─

CREATE OR REPLACE FUNCTION seed_ledger_from_current_balances()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_paid_count INT := 0;
  v_payout_count INT := 0;
  v_paid_total BIGINT := 0;
  v_payout_total BIGINT := 0;
  v_row RECORD;
BEGIN
  -- 멱등 키: seed:<booking_id>:paid / payout — 재실행 안전
  FOR v_row IN
    SELECT id, COALESCE(paid_amount, 0) AS paid_amount, COALESCE(total_paid_out, 0) AS total_paid_out
    FROM bookings
    WHERE COALESCE(is_deleted, false) = false
  LOOP
    IF v_row.paid_amount <> 0 THEN
      PERFORM record_ledger_entry(
        p_booking_id := v_row.id,
        p_account := 'paid_amount',
        p_entry_type := 'seed_backfill',
        p_amount := v_row.paid_amount,
        p_source := 'seed_phase2a',
        p_source_ref_id := NULL,
        p_idempotency_key := 'seed:' || v_row.id::TEXT || ':paid',
        p_memo := 'Phase 2a 초기 seed (현재 paid_amount 잔액)',
        p_created_by := 'system'
      );
      -- 실제 새로 INSERT 된 경우만 카운트하기 위해 대조
      IF EXISTS (SELECT 1 FROM ledger_entries WHERE idempotency_key = 'seed:' || v_row.id::TEXT || ':paid') THEN
        v_paid_count := v_paid_count + 1;
        v_paid_total := v_paid_total + v_row.paid_amount;
      END IF;
    END IF;

    IF v_row.total_paid_out <> 0 THEN
      PERFORM record_ledger_entry(
        p_booking_id := v_row.id,
        p_account := 'total_paid_out',
        p_entry_type := 'seed_backfill',
        p_amount := v_row.total_paid_out,
        p_source := 'seed_phase2a',
        p_source_ref_id := NULL,
        p_idempotency_key := 'seed:' || v_row.id::TEXT || ':payout',
        p_memo := 'Phase 2a 초기 seed (현재 total_paid_out 잔액)',
        p_created_by := 'system'
      );
      IF EXISTS (SELECT 1 FROM ledger_entries WHERE idempotency_key = 'seed:' || v_row.id::TEXT || ':payout') THEN
        v_payout_count := v_payout_count + 1;
        v_payout_total := v_payout_total + v_row.total_paid_out;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'paid_seed_count', v_paid_count,
    'payout_seed_count', v_payout_count,
    'paid_seed_total', v_paid_total,
    'payout_seed_total', v_payout_total
  );
END;
$$;

COMMENT ON FUNCTION seed_ledger_from_current_balances IS
  'Phase 2a 1회성 backfill. 모든 활성 booking 의 현재 paid_amount/total_paid_out 잔액을 seed_backfill entry 로 시드. idempotent (재실행해도 중복 INSERT 안 됨).';

-- ─── [9] reconcile_ledger() — 일일 대조 ──────────────────────

CREATE OR REPLACE FUNCTION reconcile_ledger()
RETURNS TABLE (
  booking_id UUID,
  account TEXT,
  bookings_balance BIGINT,
  ledger_sum BIGINT,
  drift BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH
    paid_ledger AS (
      SELECT booking_id, COALESCE(SUM(amount), 0) AS s
      FROM ledger_entries
      WHERE account = 'paid_amount'
      GROUP BY booking_id
    ),
    payout_ledger AS (
      SELECT booking_id, COALESCE(SUM(amount), 0) AS s
      FROM ledger_entries
      WHERE account = 'total_paid_out'
      GROUP BY booking_id
    )
  SELECT b.id, 'paid_amount'::TEXT,
         COALESCE(b.paid_amount, 0)::BIGINT,
         COALESCE(pl.s, 0)::BIGINT,
         (COALESCE(b.paid_amount, 0)::BIGINT - COALESCE(pl.s, 0)::BIGINT)
  FROM bookings b
  LEFT JOIN paid_ledger pl ON pl.booking_id = b.id
  WHERE COALESCE(b.is_deleted, false) = false
    AND COALESCE(b.paid_amount, 0)::BIGINT <> COALESCE(pl.s, 0)::BIGINT
  UNION ALL
  SELECT b.id, 'total_paid_out'::TEXT,
         COALESCE(b.total_paid_out, 0)::BIGINT,
         COALESCE(pl.s, 0)::BIGINT,
         (COALESCE(b.total_paid_out, 0)::BIGINT - COALESCE(pl.s, 0)::BIGINT)
  FROM bookings b
  LEFT JOIN payout_ledger pl ON pl.booking_id = b.id
  WHERE COALESCE(b.is_deleted, false) = false
    AND COALESCE(b.total_paid_out, 0)::BIGINT <> COALESCE(pl.s, 0)::BIGINT;
$$;

COMMENT ON FUNCTION reconcile_ledger IS
  'Phase 2a 일일 대조. SUM(ledger_entries.amount per booking, account) vs bookings.<account>. 불일치 행만 반환. 0행 = 완벽 일치.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '[ledger-phase-2a] ledger_entries 테이블 + 4 RPC 이중쓰기 + reconcile 완료';
END $$;
