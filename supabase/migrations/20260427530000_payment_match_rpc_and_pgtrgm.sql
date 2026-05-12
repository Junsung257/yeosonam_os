-- ============================================================
-- 입출금 채팅식 매칭 — 입금 매칭 atomic RPC + 한글 fuzzy 검색
-- 마이그레이션: 20260427530000
-- ============================================================
-- 1) confirm_payment_match: 입금 거래 1건 → booking 1건 atomic 매칭.
--    - bank_transactions FOR UPDATE 락
--    - bookings.paid_amount 누적 (atomic increment, 분할 입금 일관성 확보)
--    - 출금 거래는 환불(is_refund=true)일 때만 통과 (정책)
-- 2) pg_trgm 확장: similarCustomers 의 fuzzy 검색용. 한글에도 trigram 작동.
-- 3) search_similar_customers: 0.3 threshold similarity 검색 RPC.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING GIN (name gin_trgm_ops);

CREATE OR REPLACE FUNCTION search_similar_customers(
  p_query TEXT,
  p_limit INT DEFAULT 5,
  p_threshold REAL DEFAULT 0.3
) RETURNS TABLE (id UUID, name TEXT, score REAL)
LANGUAGE sql
STABLE
AS $$
  SELECT c.id, c.name, similarity(c.name, p_query) AS score
  FROM customers c
  WHERE c.deleted_at IS NULL
    AND (c.name ILIKE '%' || p_query || '%' OR similarity(c.name, p_query) >= p_threshold)
  ORDER BY score DESC, c.name ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION search_similar_customers IS
  'similarCustomers (분기 D 오타 정정) — pg_trgm similarity + ilike 합집합. 0.3 threshold.';

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
  IF v_tx.transaction_type = '입금' THEN
    UPDATE bookings
    SET paid_amount = COALESCE(paid_amount, 0) + v_amount_signed,
        updated_at = now()
    WHERE id = p_booking_id;
  ELSIF v_tx.transaction_type = '출금' AND v_tx.is_refund = true THEN
    UPDATE bookings
    SET paid_amount = GREATEST(0, COALESCE(paid_amount, 0) - v_amount_signed),
        updated_at = now()
    WHERE id = p_booking_id;
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
  '입금/환불 출금 → booking atomic 매칭. paid_amount 증가/감소 + 거래 락 + 정책(일반 출금 거부) 보장.';

NOTIFY pgrst, 'reload schema';
