-- 마일리지 소멸 정책 (Phase 1-3)
-- 1) customers.mileage_expire_at 컬럼 추가
-- 2) mileage_transactions.expires_at, expired_at 컬럼 추가
-- 3) 소멸 정책 데이터 추가
-- 4) 소멸 Cron을 위한 인덱스

-- 1. customers 테이블에 소멸일 컬럼 추가
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS mileage_expire_at TIMESTAMPTZ;

-- 2. mileage_transactions 테이블에 소멸 관련 컬럼 추가
ALTER TABLE mileage_transactions
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

-- 3. 소멸 예정 건 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_mileage_tx_expires
  ON mileage_transactions(expires_at)
  WHERE expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mileage_tx_user_expires
  ON mileage_transactions(user_id, expires_at)
  WHERE expired_at IS NULL;

-- 4. 소멸 정책 기본값 설정 (app_settings)
INSERT INTO app_settings (key, value, description)
VALUES
  ('mileage_expiration_months', '24', '마일리지 적립 후 유효 개월 (기본 2년)'),
  ('mileage_expiration_notify_days', '[30,7]', '소멸 예정 알림 발송 시점 (D-30, D-7)'),
  ('mileage_expiration_auto_extend_days', '365', '최근 활동 시 자동 연장 기간 (1년)')
ON CONFLICT (key) DO NOTHING;

-- 5. 만료 처리 함수 (PostgreSQL RPC)
CREATE OR REPLACE FUNCTION expire_customer_mileage()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- expires_at이 지났고 아직 expired_at이 없는 EARNED 트랜잭션을 소멸 처리
  UPDATE mileage_transactions
  SET expired_at = NOW(),
      type = 'EXPIRED'
  WHERE type = 'EARNED'
    AND expires_at IS NOT NULL
    AND expires_at < NOW()
    AND expired_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- customers.mileage 차감 (소멸된 만큼)
  UPDATE customers c
  SET mileage = GREATEST(0, c.mileage - sub.total_expired)
  FROM (
    SELECT user_id, SUM(amount) AS total_expired
    FROM mileage_transactions
    WHERE expired_at = CURRENT_DATE
    GROUP BY user_id
  ) sub
  WHERE c.id = sub.user_id;

  RETURN v_count;
END;
$$;

-- 6. 적립 시 소멸일 자동 설정하는 트리거 함수
CREATE OR REPLACE FUNCTION set_mileage_expires_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_months INTEGER;
BEGIN
  IF NEW.type = 'EARNED' AND NEW.expires_at IS NULL THEN
    -- app_settings에서 소멸 기간 조회
    SELECT COALESCE(
      (SELECT value::INTEGER FROM app_settings WHERE key = 'mileage_expiration_months'),
      24
    ) INTO v_months;

    NEW.expires_at := NEW.created_at + (v_months || ' months')::INTERVAL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mileage_set_expires_at ON mileage_transactions;

CREATE TRIGGER trg_mileage_set_expires_at
BEFORE INSERT ON mileage_transactions
FOR EACH ROW
EXECUTE FUNCTION set_mileage_expires_at();
