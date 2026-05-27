-- ============================================================
-- payment_status 한글 값 통일 패치
-- Supabase > SQL Editor 에서 실행하세요.
-- 기존 English 값(paid/partial/unpaid)을 한글로 전환합니다.
-- ============================================================

-- ① 기존 CHECK 제약조건 제거 후 한글로 재설정
--    (컬럼이 이미 존재하는 경우 IF NOT EXISTS 가 스킵되므로 직접 처리)
DO $$
DECLARE
  constraint_name text;
BEGIN
  -- payment_status 의 기존 CHECK 제약조건 이름 찾기
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'bookings'
    AND con.contype = 'c'
    AND con.conname LIKE '%payment_status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE bookings DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
END $$;

-- ② 한글 CHECK 제약조건 추가
ALTER TABLE bookings
  ADD CONSTRAINT bookings_payment_status_check
  CHECK (payment_status IN ('미입금', '일부입금', '완납'));

-- ③ 기본값도 한글로 변경
ALTER TABLE bookings
  ALTER COLUMN payment_status SET DEFAULT '미입금';

-- ④ 기존 English 값 → 한글로 데이터 마이그레이션
UPDATE bookings SET payment_status = '완납'    WHERE payment_status = 'paid';
UPDATE bookings SET payment_status = '일부입금' WHERE payment_status = 'partial';
UPDATE bookings SET payment_status = '미입금'  WHERE payment_status = 'unpaid';

-- ⑤ 트리거 함수 한글 버전으로 교체
CREATE OR REPLACE FUNCTION update_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  calc_total INTEGER;
BEGIN
  -- total_price 는 GENERATED ALWAYS 컬럼이므로 직접 계산
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

-- ⑥ 트리거 재등록
DROP TRIGGER IF EXISTS trg_payment_status ON bookings;
CREATE TRIGGER trg_payment_status
  BEFORE INSERT OR UPDATE OF paid_amount ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_status();

-- ============================================================
-- 확인 쿼리
-- ============================================================
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings' AND column_name = 'payment_status';

SELECT payment_status, COUNT(*) FROM bookings GROUP BY payment_status;
