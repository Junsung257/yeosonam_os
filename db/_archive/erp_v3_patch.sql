-- ============================================================
-- 여소남 OS ERP v3 패치
-- Supabase > SQL Editor 에서 실행하세요.
-- ============================================================

-- is_deleted 가 NULL 인 기존 예약 레코드를 false 로 통일
-- (마이그레이션 이전에 생성된 레코드가 NULL 로 남아 있어 목록에서 안 보이는 문제 해결)
UPDATE bookings
SET is_deleted = false
WHERE is_deleted IS NULL;

-- 확인 쿼리
SELECT is_deleted, COUNT(*) AS cnt
FROM bookings
GROUP BY is_deleted
ORDER BY is_deleted;
