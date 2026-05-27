-- ============================================================
-- bookings.status 한글 상태값 추가 패치
-- Supabase > SQL Editor 에서 실행하세요. (1회)
-- '가계약', '상담중' 상태를 허용하도록 CHECK 제약 확장
-- ============================================================

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'bookings'
    AND con.contype = 'c'
    AND con.conname LIKE '%status%'
    AND con.conname NOT LIKE '%payment%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE bookings DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
END $$;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending','confirmed','completed','cancelled','가계약','상담중'));

-- 확인 쿼리
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'bookings' AND con.contype = 'c' AND con.conname LIKE '%status%';
