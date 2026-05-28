-- 마일리지 소멸 정책 + 고객 뱃지 + 기존 테이블 변경
-- Phase 1: 소멸 정책 테이블 및 mileage_transactions.expires_at 추가
-- Phase 3: customer_badges 테이블

-- ═══════════════════════════════════════════════════════════════
-- 1. 마일리지 소멸 정책 테이블
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mileage_expiration_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validity_months INTEGER NOT NULL DEFAULT 24,   -- 적립 후 유효 개월
  notify_before_days INTEGER[] DEFAULT '{30,7}',  -- 알림 발송 시점
  auto_expire BOOLEAN DEFAULT true,
  extend_on_activity BOOLEAN DEFAULT true,         -- 최근 활동 시 자동 연장
  extend_months INTEGER DEFAULT 12,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기본 정책 삽입 (마이그레이션으로 한 번만 실행)
INSERT INTO mileage_expiration_policies (validity_months, notify_before_days, auto_expire, extend_on_activity, extend_months)
VALUES (24, '{30,7}', true, true, 12)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 2. mileage_transactions에 expires_at 컬럼 추가
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE mileage_transactions
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 기존 EARNED 트랜잭션에 만료일 채우기 (적립일 + 24개월)
UPDATE mileage_transactions
SET expires_at = created_at + INTERVAL '24 months'
WHERE type = 'EARNED' AND expires_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. customers 테이블에 mileage_expire_at 컬럼 추가
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS mileage_expire_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════
-- 4. 만료된 마일리지 조회 뷰
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW customer_expiring_mileage AS
SELECT
  mt.user_id,
  c.name AS customer_name,
  c.phone,
  SUM(mt.amount) AS expiring_amount,
  MIN(mt.expires_at) AS earliest_expire_at,
  COUNT(*) AS transaction_count
FROM mileage_transactions mt
JOIN customers c ON c.id = mt.user_id
WHERE mt.type = 'EARNED'
  AND mt.expires_at IS NOT NULL
  AND mt.expires_at <= NOW() + INTERVAL '30 days'
  AND mt.expires_at > NOW()
  AND mt.amount > 0
GROUP BY mt.user_id, c.name, c.phone
HAVING SUM(mt.amount) > 0;

-- ═══════════════════════════════════════════════════════════════
-- 5. 고객 뱃지 테이블 (Phase 3)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customer_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  badge_type TEXT NOT NULL,
  badge_label TEXT,
  badge_description TEXT,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, badge_type)
);

-- 뱃지 표시용 인덱스
CREATE INDEX IF NOT EXISTS idx_customer_badges_customer ON customer_badges(customer_id);

-- ═══════════════════════════════════════════════════════════════
-- 6. 소멸 대상 마일리지 원자적 처리 함수
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION expire_mileage_batch(
  p_batch_size INTEGER DEFAULT 100
) RETURNS TABLE(
  processed_count INTEGER,
  total_expired_amount BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count INTEGER := 0;
  v_total BIGINT := 0;
  v_expired RECORD;
BEGIN
  FOR v_expired IN
    SELECT mt.id, mt.user_id, mt.amount
    FROM mileage_transactions mt
    WHERE mt.type = 'EARNED'
      AND mt.expires_at IS NOT NULL
      AND mt.expires_at <= NOW()
      AND mt.amount > 0
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 만료 트랜잭션 생성 (amount = 음수)
    INSERT INTO mileage_transactions (
      user_id, amount, type, margin_impact,
      base_net_profit, mileage_rate, memo, expires_at
    ) VALUES (
      v_expired.user_id,
      -v_expired.amount,
      'CLAWBACK',
      0, 0, 0,
      '마일리지 소멸 (자동)',
      NULL
    );

    -- 원본 EARNED 트랜잭션 amount 0으로 설정 (이중 차감 방지)
    UPDATE mileage_transactions
    SET amount = 0
    WHERE id = v_expired.id;

    v_count := v_count + 1;
    v_total := v_total + v_expired.amount;
  END LOOP;

  RETURN QUERY SELECT v_count, v_total;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 7. 마일리지 만료일 연장 함수 (최근 활동 시)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION extend_mileage_expiry(
  p_user_id UUID,
  p_extra_months INTEGER DEFAULT 12
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  UPDATE mileage_transactions
  SET expires_at = expires_at + (p_extra_months || ' months')::INTERVAL
  WHERE user_id = p_user_id
    AND type = 'EARNED'
    AND expires_at IS NOT NULL
    AND expires_at > NOW()
    AND amount > 0;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 8. RLS: customer_badges는 고객 본인과 admin만 조회 가능
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE customer_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_badges_select_own"
  ON customer_badges FOR SELECT
  USING (customer_id = auth.uid());

CREATE POLICY "customer_badges_select_admin"
  ON customer_badges FOR SELECT
  USING (EXISTS (SELECT 1 FROM admins WHERE id = auth.uid()));

-- 참고: INSERT는 admin 전용 또는 시스템에서만
CREATE POLICY "customer_badges_insert_admin"
  ON customer_badges FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE id = auth.uid()));
