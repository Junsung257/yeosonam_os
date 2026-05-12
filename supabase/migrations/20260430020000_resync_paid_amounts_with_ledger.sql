-- =============================================================
-- 여소남 OS — Phase 2a: resync_paid_amounts_with_ledger
-- =============================================================
-- 목적:
--   기존 resync_paid_amounts 는 bookings.paid_amount/total_paid_out 을
--   bank_transactions 합계로 직접 UPDATE → ledger 우회 → silent drift.
--
--   신규 RPC 는:
--     1) booking 별 recomputed_paid / recomputed_payout 계산 (bank_transactions 기준)
--     2) 기존 ledger SUM 과 비교 → 차액을 manual_adjust source='cron_resync' 로 INSERT
--     3) bookings.paid_amount / total_paid_out 을 recomputed 값으로 UPDATE
--   모두 같은 트랜잭션 → resync 후 reconcile drift = 0 보장.
--
-- 호출자: /api/bank-transactions?action=resync (어드민 "입금 재동기화" 버튼)
-- =============================================================

CREATE OR REPLACE FUNCTION resync_paid_amounts_with_ledger()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_row RECORD;
  v_updated INT := 0;
  v_paid_adj_count INT := 0;
  v_payout_adj_count INT := 0;
  v_paid_adj_total BIGINT := 0;
  v_payout_adj_total BIGINT := 0;
  v_run_id TEXT;
BEGIN
  v_run_id := to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');

  FOR v_row IN
    WITH agg AS (
      SELECT
        bt.booking_id AS bid,
        GREATEST(0, COALESCE(SUM(CASE
          WHEN bt.transaction_type = '입금' AND NOT COALESCE(bt.is_refund, false) AND NOT COALESCE(bt.is_fee, false) THEN bt.amount
          WHEN COALESCE(bt.is_refund, false) THEN -bt.amount
          ELSE 0
        END), 0)) AS recomputed_paid,
        GREATEST(0, COALESCE(SUM(CASE
          WHEN bt.transaction_type = '출금' AND NOT COALESCE(bt.is_refund, false) AND NOT COALESCE(bt.is_fee, false) THEN bt.amount
          ELSE 0
        END), 0)) AS recomputed_payout
      FROM bank_transactions bt
      WHERE bt.booking_id IS NOT NULL
        AND bt.match_status IN ('auto', 'manual')
      GROUP BY bt.booking_id
    ),
    ledger AS (
      SELECT booking_id AS bid, account, COALESCE(SUM(amount), 0) AS s
      FROM ledger_entries
      GROUP BY booking_id, account
    ),
    paid_l AS (SELECT bid, s FROM ledger WHERE account = 'paid_amount'),
    payout_l AS (SELECT bid, s FROM ledger WHERE account = 'total_paid_out')
    SELECT
      a.bid AS booking_id,
      a.recomputed_paid,
      a.recomputed_payout,
      COALESCE(pl.s, 0)::BIGINT AS ledger_paid,
      COALESCE(pol.s, 0)::BIGINT AS ledger_payout
    FROM agg a
    LEFT JOIN paid_l pl ON pl.bid = a.bid
    LEFT JOIN payout_l pol ON pol.bid = a.bid
  LOOP
    -- paid_amount 보정 entry
    IF v_row.recomputed_paid::BIGINT <> v_row.ledger_paid THEN
      PERFORM record_ledger_entry(
        v_row.booking_id, 'paid_amount', 'manual_adjust',
        (v_row.recomputed_paid::BIGINT - v_row.ledger_paid),
        'cron_resync', NULL,
        'resync:' || v_run_id || ':' || v_row.booking_id::TEXT || ':paid',
        format('resync_paid_amounts_with_ledger run=%s', v_run_id),
        'system'
      );
      v_paid_adj_count := v_paid_adj_count + 1;
      v_paid_adj_total := v_paid_adj_total + (v_row.recomputed_paid::BIGINT - v_row.ledger_paid);
    END IF;

    -- total_paid_out 보정 entry
    IF v_row.recomputed_payout::BIGINT <> v_row.ledger_payout THEN
      PERFORM record_ledger_entry(
        v_row.booking_id, 'total_paid_out', 'manual_adjust',
        (v_row.recomputed_payout::BIGINT - v_row.ledger_payout),
        'cron_resync', NULL,
        'resync:' || v_run_id || ':' || v_row.booking_id::TEXT || ':payout',
        format('resync_paid_amounts_with_ledger run=%s', v_run_id),
        'system'
      );
      v_payout_adj_count := v_payout_adj_count + 1;
      v_payout_adj_total := v_payout_adj_total + (v_row.recomputed_payout::BIGINT - v_row.ledger_payout);
    END IF;

    -- bookings 갱신
    UPDATE bookings
    SET paid_amount = v_row.recomputed_paid,
        total_paid_out = v_row.recomputed_payout,
        updated_at = now()
    WHERE id = v_row.booking_id;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'updated', v_updated,
    'paid_adj_count', v_paid_adj_count,
    'payout_adj_count', v_payout_adj_count,
    'paid_adj_total', v_paid_adj_total,
    'payout_adj_total', v_payout_adj_total,
    'run_id', v_run_id
  );
END;
$$;

COMMENT ON FUNCTION resync_paid_amounts_with_ledger IS
  'Phase 2a — bookings.paid_amount/total_paid_out 을 bank_transactions 합계로 재계산 + 기존 ledger 와의 차액을 manual_adjust(source=cron_resync) 로 보정 INSERT. 같은 트랜잭션 → 호출 후 reconcile drift=0 보장.';

NOTIFY pgrst, 'reload schema';
