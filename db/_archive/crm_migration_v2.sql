-- ============================================================
-- 여소남 OS CRM 마이그레이션 v2
-- Supabase > SQL Editor 에서 실행하세요.
-- 기존 데이터는 전혀 건드리지 않습니다. (ADD COLUMN IF NOT EXISTS 방식)
-- ============================================================

-- ① 예약 접수일 (created_at과 별도로 담당자가 직접 입력하는 예약 접수 날짜)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_date DATE DEFAULT CURRENT_DATE;

-- ② 출발 지역 (부산, 인천, 서울 등)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS departure_region TEXT;

-- ③ 랜드사 (현지 행사 진행 업체 이름)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS land_operator TEXT;

-- ④ 입금된 금액 (고객이 실제로 입금한 누적 금액)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS paid_amount INTEGER DEFAULT 0;

-- ⑤ 결제 상태 (미입금 / 일부입금 / 완납)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT '미입금'
    CHECK (payment_status IN ('미입금', '일부입금', '완납'));

-- ⑥ 소프트 삭제 플래그 (true = 휴지통으로 이동, DB에서 실제 삭제 안 함)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- ⑦ total_paid_out 컬럼 (랜드사 등 외부에 지급한 금액, 기존 코드에서 참조 중)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS total_paid_out INTEGER DEFAULT 0;

-- ⑧ actual_payer_name 컬럼 (대리 입금자 이름, 기존 코드에서 참조 중)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS actual_payer_name TEXT;

-- ============================================================
-- 인덱스 추가 (조회 속도 향상)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bookings_departure_date ON bookings(departure_date);
CREATE INDEX IF NOT EXISTS idx_bookings_is_deleted ON bookings(is_deleted);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_date ON bookings(booking_date);

-- ============================================================
-- 잔금 자동 계산을 위한 트리거 함수
-- paid_amount 가 바뀔 때마다 payment_status 를 자동 업데이트합니다.
-- ============================================================
CREATE OR REPLACE FUNCTION update_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  calc_total INTEGER;
BEGIN
  calc_total := COALESCE(NEW.adult_count, 0) * COALESCE(NEW.adult_cost, 0)
              + COALESCE(NEW.child_count, 0) * COALESCE(NEW.child_cost, 0)
              + COALESCE(NEW.infant_count, 0) * COALESCE(NEW.infant_cost, 0);

  IF calc_total > 0 THEN
    IF COALESCE(NEW.paid_amount, 0) >= calc_total THEN
      NEW.payment_status := '완납';
    ELSIF COALESCE(NEW.paid_amount, 0) > 0 THEN
      NEW.payment_status := '일부입금';
    ELSE
      NEW.payment_status := '미입금';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_status ON bookings;
CREATE TRIGGER trg_payment_status
  BEFORE INSERT OR UPDATE OF paid_amount ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_status();

-- ============================================================
-- 실행 확인용 쿼리 (실행 후 아래 결과에 새 컬럼들이 보이면 성공)
-- ============================================================
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'bookings'
ORDER BY ordinal_position;
