-- 여소남 OS CRM 테이블
-- Supabase SQL Editor에서 실행하세요

-- 고객 마스터
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  passport_no TEXT,
  passport_expiry DATE,
  birth_date DATE,
  mileage INTEGER DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  memo TEXT,
  total_spent INTEGER DEFAULT 0,
  booking_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 예약
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_no TEXT UNIQUE NOT NULL,
  package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  package_title TEXT,
  lead_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  adult_count INTEGER DEFAULT 1,
  child_count INTEGER DEFAULT 0,
  adult_cost INTEGER DEFAULT 0,
  adult_price INTEGER DEFAULT 0,
  child_cost INTEGER DEFAULT 0,
  child_price INTEGER DEFAULT 0,
  fuel_surcharge INTEGER DEFAULT 0,
  total_cost INTEGER GENERATED ALWAYS AS (
    (adult_count * adult_cost) + (child_count * child_cost) + fuel_surcharge
  ) STORED,
  total_price INTEGER GENERATED ALWAYS AS (
    (adult_count * adult_price) + (child_count * child_price) + fuel_surcharge
  ) STORED,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
  departure_date DATE,
  notes TEXT,
  payment_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 동행자 연결 (예약 ↔ 고객 N:M)
CREATE TABLE IF NOT EXISTS booking_passengers (
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  PRIMARY KEY (booking_id, customer_id)
);

-- 마일리지 이력
CREATE TABLE IF NOT EXISTS mileage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 시스템 설정 (마스터 컨트롤)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 기본 설정값 삽입
INSERT INTO app_settings (key, value) VALUES
  ('commission_rate', '{"rate": 9}'),
  ('vacation_mode', '{"enabled": false, "start": null, "end": null, "message": ""}'),
  ('mileage_event', '{"enabled": false, "name": "", "start": null, "end": null, "bonus_rate": 0}'),
  ('mileage_base_rate', '{"rate": 1}')
ON CONFLICT (key) DO NOTHING;

-- 예약번호 자동 생성 함수
CREATE OR REPLACE FUNCTION generate_booking_no()
RETURNS TRIGGER AS $$
DECLARE
  next_no INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(booking_no FROM 4) AS INTEGER)), 0) + 1
  INTO next_no
  FROM bookings;
  NEW.booking_no := 'BK-' || LPAD(next_no::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_booking_no ON bookings;
CREATE TRIGGER set_booking_no
  BEFORE INSERT ON bookings
  FOR EACH ROW
  WHEN (NEW.booking_no IS NULL OR NEW.booking_no = '')
  EXECUTE FUNCTION generate_booking_no();
