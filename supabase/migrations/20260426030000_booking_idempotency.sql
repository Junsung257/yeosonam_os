-- ============================================================
-- bookings.idempotency_key — 멱등성 보장 (2026-04-26)
--
-- 클라이언트 재시도/네트워크 재발사 시 동일 booking 중복 생성 방지.
-- 어필리에이트 커미션 중복 계상 사고 방어 (Tapfiliate 2026 가이드 핵심).
--
-- 사용:
--   클라이언트가 booking POST 직전 UUID v4 생성 → idempotency_key 동봉
--   서버는 INSERT 실패(UNIQUE 위반) 시 기존 row 반환
-- ============================================================

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency_key
  ON bookings(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN bookings.idempotency_key IS
  '클라이언트 발급 UUID v4. 동일 키로 두 번 INSERT 시도 시 두 번째는 실패하여 커미션 중복 방지.';

COMMIT;

NOTIFY pgrst, 'reload schema';
