-- ============================================================
-- 어필리에이터 커미션 Clawback (환불 시 회수) — 2026-04-26
--
-- 여행업은 SaaS와 달리 출발 직전·여행 중 환불 빈도 높음.
-- 이미 정산된 커미션을 환불 시 자동 회수하기 위한 인프라.
--
-- 모델:
--   1. commission_adjustments — 음수(claw-back) / 양수(보너스) entry
--   2. bookings.refund_amount  — 부분환불 금액
--   3. bookings.commission_clawed_back — boolean (멱등 보장)
--   4. 트리거: booking.status 'refunded' / 'cancelled' (이미 정산된 경우만) → adjustments 자동 INSERT
--   5. settlement-draft cron이 carryover_balance에 음수 가산하여 차차월에 자연 차감
-- ============================================================

BEGIN;

-- ① bookings 환불 메타
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS refund_rate NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commission_clawed_back BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN bookings.refund_rate IS
  '환불 비율 0.00~1.00 — 1.00=전액. 부분환불 시 0.30 같은 값.';
COMMENT ON COLUMN bookings.commission_clawed_back IS
  'true = 이 예약의 커미션이 이미 환불 회수됨 (멱등 보장). 이중 회수 방지.';

-- ② commission_adjustments — 회수/보너스 조정 기록
CREATE TABLE IF NOT EXISTS commission_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN (
    'clawback_refund',          -- 환불 회수 (음수)
    'clawback_chargeback',      -- 카드 chargeback 회수 (음수)
    'clawback_dispute',         -- 분쟁 차감 (음수)
    'bonus_manual',             -- 수기 보너스 (양수)
    'correction'                -- 단순 정정 (양수/음수)
  )),
  amount          INTEGER NOT NULL,  -- 음수=차감, 양수=가산 (KRW)
  reason          TEXT NOT NULL,
  applied_to_period TEXT,            -- 적용된 정산 기간 'YYYY-MM' (NULL=다음 정산까지 미적용)
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'reverted')),
  created_by      TEXT NOT NULL DEFAULT 'system',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  applied_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_adj_affiliate ON commission_adjustments(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_adj_booking ON commission_adjustments(booking_id);
CREATE INDEX IF NOT EXISTS idx_adj_status ON commission_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_adj_period ON commission_adjustments(applied_to_period);

COMMENT ON TABLE commission_adjustments IS
  '어필리에이터 커미션 조정 (clawback / bonus). 정산 시 carryover에 합산.';

-- ③ 트리거: booking.status 변경 시 자동 clawback 생성
CREATE OR REPLACE FUNCTION trigger_commission_clawback()
RETURNS TRIGGER AS $$
DECLARE
  refund_pct NUMERIC;
  claw_amount INTEGER;
  status_changed BOOLEAN;
BEGIN
  -- 이미 처리된 경우 skip (멱등)
  IF NEW.commission_clawed_back THEN RETURN NEW; END IF;

  -- affiliate_id 없으면 skip
  IF NEW.affiliate_id IS NULL THEN RETURN NEW; END IF;

  -- 커미션 0이면 회수할 게 없음
  IF COALESCE(NEW.influencer_commission, 0) = 0 THEN RETURN NEW; END IF;

  -- status 변경 감지
  status_changed := (OLD.status IS DISTINCT FROM NEW.status);

  -- refunded / cancelled 로 전환 시
  IF status_changed AND NEW.status IN ('refunded', 'cancelled') THEN
    -- 환불 비율: refund_rate 우선, 없으면 refund_amount/total_price 계산, 없으면 1.0(전액)
    refund_pct := COALESCE(
      NEW.refund_rate,
      CASE WHEN NEW.total_price > 0 AND NEW.refund_amount IS NOT NULL
           THEN NEW.refund_amount / NEW.total_price
           ELSE 1.0 END
    );
    refund_pct := LEAST(GREATEST(refund_pct, 0), 1);

    claw_amount := -ROUND(COALESCE(NEW.influencer_commission, 0) * refund_pct);

    IF claw_amount < 0 THEN
      INSERT INTO commission_adjustments (
        affiliate_id, booking_id, adjustment_type, amount, reason, status
      ) VALUES (
        NEW.affiliate_id,
        NEW.id,
        CASE WHEN NEW.status = 'refunded' THEN 'clawback_refund' ELSE 'clawback_dispute' END,
        claw_amount,
        format('자동 회수: status %s → %s, 환불율 %s', OLD.status, NEW.status, refund_pct),
        'pending'
      );
      NEW.commission_clawed_back := true;
      NEW.refunded_at := COALESCE(NEW.refunded_at, NOW());
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_commission_clawback ON bookings;
CREATE TRIGGER trg_commission_clawback
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION trigger_commission_clawback();

-- ④ RLS
ALTER TABLE commission_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_all_commission_adjustments ON commission_adjustments
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';
