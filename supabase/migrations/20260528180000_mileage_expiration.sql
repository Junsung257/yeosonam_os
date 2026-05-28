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
-- 20260528170000에 정의된 expire_mileage_batch(p_batch_size) 사용.
-- expire_customer_mileage()는 expire_mileage_batch로 통일되어 제거됨.
-- expire_mileage_batch는 CLAWBACK 트랜잭션 생성 + FOR UPDATE SKIP LOCKED 방식으로
-- 동시성 충돌 없이 배치 처리합니다.

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
