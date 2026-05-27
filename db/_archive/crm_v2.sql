-- ============================================================
-- 여소남 OS: CRM v2 마이그레이션
-- 기존 customers 테이블 확장 + 새 테이블 추가
-- Supabase SQL Editor에서 순서대로 실행하세요.
-- ============================================================

-- ─── 1. customers 테이블 컬럼 추가 ───────────────────────────

-- 생애주기 상태: 잠재고객 → 상담중 → 예약완료 → 여행중 → 여행완료
ALTER TABLE customers ADD COLUMN IF NOT EXISTS
  status VARCHAR DEFAULT '잠재고객';

-- 자동 계산 등급: 신규 | 일반 | 우수 | VVIP
ALTER TABLE customers ADD COLUMN IF NOT EXISTS
  grade VARCHAR DEFAULT '신규';

-- 누적 결제 총액 (auto_grade 트리거가 참조)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS
  total_spent INTEGER DEFAULT 0;

-- 네이버 카페 연동 데이터
-- { "nickname": "여행러브", "post_count": 15, "comment_count": 42 }
ALTER TABLE customers ADD COLUMN IF NOT EXISTS
  cafe_sync_data JSONB DEFAULT '{}';


-- ─── 2. 전화번호 UNIQUE 제약 (NULL 제외) ──────────────────────
-- 이미 중복 데이터가 있을 경우 UNIQUE 제약이 실패할 수 있습니다.
-- 먼저 SELECT phone, COUNT(*) FROM customers GROUP BY phone HAVING COUNT(*) > 1
-- 로 중복 확인 후 정리하고 실행하세요.
ALTER TABLE customers ADD CONSTRAINT customers_phone_unique
  UNIQUE (phone) DEFERRABLE INITIALLY DEFERRED;
-- 중복 오류 시: ALTER TABLE customers DROP CONSTRAINT customers_phone_unique;


-- ─── 3. 전화번호 자동 포맷 트리거 ────────────────────────────
-- INSERT / UPDATE 시 010-0000-0000 형식으로 자동 변환

CREATE OR REPLACE FUNCTION format_phone_number()
RETURNS TRIGGER AS $$
DECLARE
  v_digits TEXT;
BEGIN
  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    RETURN NEW;
  END IF;

  -- 숫자만 추출
  v_digits := regexp_replace(NEW.phone, '[^0-9]', '', 'g');

  -- 11자리 (010-XXXX-XXXX)
  IF LENGTH(v_digits) = 11 THEN
    NEW.phone := SUBSTRING(v_digits, 1, 3)
                 || '-' || SUBSTRING(v_digits, 4, 4)
                 || '-' || SUBSTRING(v_digits, 8, 4);
  -- 10자리 (02-XXXX-XXXX 형태 등)
  ELSIF LENGTH(v_digits) = 10 THEN
    NEW.phone := SUBSTRING(v_digits, 1, 3)
                 || '-' || SUBSTRING(v_digits, 4, 3)
                 || '-' || SUBSTRING(v_digits, 7, 4);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_format_phone
  BEFORE INSERT OR UPDATE OF phone ON customers
  FOR EACH ROW EXECUTE FUNCTION format_phone_number();


-- ─── 4. 등급 자동 계산 트리거 ─────────────────────────────────
-- total_spent와 카페 활동량(post+comment)으로 4단계 등급 자동 결정
-- VVIP  : 누적 1000만원↑  또는 카페점수 50점↑
-- 우수  : 누적 300만원↑   또는 카페점수 30점↑
-- 일반  : 누적 50만원↑    또는 카페점수 10점↑
-- 신규  : 그 외

CREATE OR REPLACE FUNCTION auto_calculate_grade()
RETURNS TRIGGER AS $$
DECLARE
  v_spent      INTEGER;
  v_cafe_score INTEGER;
BEGIN
  v_spent      := COALESCE(NEW.total_spent, 0);
  v_cafe_score := COALESCE((NEW.cafe_sync_data->>'post_count')::INTEGER, 0)
                + COALESCE((NEW.cafe_sync_data->>'comment_count')::INTEGER, 0);

  IF    v_spent >= 10000000 OR v_cafe_score >= 50 THEN NEW.grade := 'VVIP';
  ELSIF v_spent >=  3000000 OR v_cafe_score >= 30 THEN NEW.grade := '우수';
  ELSIF v_spent >=   500000 OR v_cafe_score >= 10 THEN NEW.grade := '일반';
  ELSE                                                  NEW.grade := '신규';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_auto_grade
  BEFORE INSERT OR UPDATE OF total_spent, cafe_sync_data ON customers
  FOR EACH ROW EXECUTE FUNCTION auto_calculate_grade();


-- ─── 5. mileage_history 테이블 ────────────────────────────────
-- 마일리지 적립/사용/조정 이력

CREATE TABLE IF NOT EXISTS mileage_history (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  delta          INTEGER      NOT NULL,          -- 양수=적립, 음수=차감
  reason         VARCHAR      NOT NULL,          -- 예약적립 | 수동조정 | 사용 | 만료
  booking_id     UUID         REFERENCES bookings(id) ON DELETE SET NULL,
  transaction_id UUID,                           -- bank_transactions.id (FK 없이 참조)
  balance_after  INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mileage_history_customer
  ON mileage_history (customer_id, created_at DESC);

ALTER TABLE mileage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mileage_history: authenticated all"
  ON mileage_history FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ─── 6. customer_notes 테이블 생성 (없으면) + channel 컬럼 추가 ─
-- 상담 채널: phone | kakao | email | visit | cafe | sms

CREATE TABLE IF NOT EXISTS customer_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  channel     VARCHAR     DEFAULT 'phone',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 이미 테이블이 있었다면 channel 컬럼만 추가
ALTER TABLE customer_notes ADD COLUMN IF NOT EXISTS
  channel VARCHAR DEFAULT 'phone';

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer
  ON customer_notes (customer_id, created_at DESC);

ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'customer_notes' AND policyname = 'customer_notes: authenticated all'
  ) THEN
    CREATE POLICY "customer_notes: authenticated all"
      ON customer_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END
$$;


-- ─── 7. customers RLS 보완 ────────────────────────────────────
-- 이미 설정된 정책이 있다면 아래는 skip 가능
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'customers' AND policyname = 'customers: authenticated all'
  ) THEN
    CREATE POLICY "customers: authenticated all"
      ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END
$$;
