-- ============================================================
-- 여소남 OS: 어필리에이트 ERP v1 마이그레이션
-- Supabase > SQL Editor 에서 실행하세요. (1회)
-- ============================================================

-- ① affiliates 테이블 (인플루언서/파트너)
CREATE TABLE IF NOT EXISTS affiliates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,
  referral_code    TEXT UNIQUE NOT NULL,
  grade            INTEGER DEFAULT 1 CHECK (grade BETWEEN 1 AND 5),
  -- 1=브론즈(0%), 2=실버(0.1%), 3=골드(0.2%), 4=플래티넘(0.3%), 5=다이아(0.5%)
  bonus_rate       NUMERIC(5,3) DEFAULT 0,
  payout_type      TEXT DEFAULT 'PERSONAL' CHECK (payout_type IN ('PERSONAL','BUSINESS')),
  encrypted_bank_info TEXT,          -- AES-256-GCM 암호화 저장
  booking_count    INTEGER DEFAULT 0, -- 누적 정산 완료 예약수 (등급 산정 기준)
  total_commission NUMERIC(12,0) DEFAULT 0,
  memo             TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ② bookings 테이블 확장 (어필리에이트 필드)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'DIRECT'
  CHECK (booking_type IN ('DIRECT','AFFILIATE'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cost_snapshot_krw INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS applied_total_commission_rate NUMERIC(5,3) DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS influencer_commission INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS margin INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_date DATE; -- 귀국일 (정산 기준)

-- ③ travel_packages 확장 (USD 원가)
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS usd_cost NUMERIC(10,2);
-- 기존 commission_rate NUMERIC(5,2) 컬럼은 base_commission_rate 로 의미 통일 (코드 레벨 alias)

-- ④ settlements 테이블 (월간 정산)
CREATE TABLE IF NOT EXISTS settlements (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id            UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  settlement_period       TEXT NOT NULL,       -- "2026-03" 형식
  qualified_booking_count INTEGER DEFAULT 0,
  total_amount            INTEGER DEFAULT 0,   -- 해당 월 발생 수수료 합
  carryover_balance       INTEGER DEFAULT 0,   -- 전달 이월 금액
  final_total             INTEGER DEFAULT 0,   -- total_amount + carryover_balance
  tax_deduction           INTEGER DEFAULT 0,   -- 원천세 3.3% (PERSONAL)
  final_payout            INTEGER DEFAULT 0,   -- 실지급액
  status                  TEXT DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','READY','COMPLETED','VOID')),
  settled_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE (affiliate_id, settlement_period)
);

-- ⑤ audit_logs 테이블 (감사 로그)
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT,
  action       TEXT NOT NULL,   -- 'BOOKING_PRICE_EDIT', 'BOOKING_STATUS_CHANGE', 'SETTLEMENT_CLOSE' 등
  target_type  TEXT,            -- 'booking' | 'affiliate' | 'settlement'
  target_id    TEXT,
  description  TEXT,
  before_value JSONB,
  after_value  JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ⑥ 마진 자동 계산 트리거
CREATE OR REPLACE FUNCTION calc_booking_margin()
RETURNS TRIGGER AS $$
BEGIN
  -- total_price 는 GENERATED 컬럼이므로 직접 계산 (adult_count * adult_price + child_count * child_price + fuel_surcharge)
  NEW.margin := (
    COALESCE(NEW.adult_count,0) * COALESCE(NEW.adult_price,0) +
    COALESCE(NEW.child_count,0) * COALESCE(NEW.child_price,0) +
    COALESCE(NEW.fuel_surcharge,0)
  )
  - COALESCE(NEW.cost_snapshot_krw, 0)
  - COALESCE(NEW.influencer_commission, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_booking_margin ON bookings;
CREATE TRIGGER trg_booking_margin
  BEFORE INSERT OR UPDATE OF adult_count, adult_price, child_count, child_price,
    fuel_surcharge, cost_snapshot_krw, influencer_commission ON bookings
  FOR EACH ROW EXECUTE FUNCTION calc_booking_margin();

-- ⑦ 어필리에이트 등급 자동 산정 트리거
CREATE OR REPLACE FUNCTION auto_grade_affiliate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_count >= 100 THEN
    NEW.grade := 5; NEW.bonus_rate := 0.005;
  ELSIF NEW.booking_count >= 50 THEN
    NEW.grade := 4; NEW.bonus_rate := 0.003;
  ELSIF NEW.booking_count >= 30 THEN
    NEW.grade := 3; NEW.bonus_rate := 0.002;
  ELSIF NEW.booking_count >= 10 THEN
    NEW.grade := 2; NEW.bonus_rate := 0.001;
  ELSE
    NEW.grade := 1; NEW.bonus_rate := 0.000;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_grade ON affiliates;
CREATE TRIGGER trg_affiliate_grade
  BEFORE INSERT OR UPDATE OF booking_count ON affiliates
  FOR EACH ROW EXECUTE FUNCTION auto_grade_affiliate();

-- ⑧ affiliates updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_affiliate_timestamp()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_updated_at ON affiliates;
CREATE TRIGGER trg_affiliate_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW EXECUTE FUNCTION update_affiliate_timestamp();

-- ⑨ 인덱스
CREATE INDEX IF NOT EXISTS idx_affiliates_referral_code ON affiliates(referral_code);
CREATE INDEX IF NOT EXISTS idx_affiliates_grade        ON affiliates(grade);
CREATE INDEX IF NOT EXISTS idx_bookings_affiliate_id   ON bookings(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_type   ON bookings(booking_type);
CREATE INDEX IF NOT EXISTS idx_bookings_return_date    ON bookings(return_date);
CREATE INDEX IF NOT EXISTS idx_settlements_affiliate   ON settlements(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_settlements_period      ON settlements(settlement_period);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target       ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created      ON audit_logs(created_at);

-- ⑩ 확인 쿼리
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('affiliates','settlements','audit_logs')
ORDER BY table_name;
