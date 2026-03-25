-- ============================================================
-- 여소남 OS — 수동 원가 오버라이드 잠금(Lock) 아키텍처 마이그레이션
-- Supabase Dashboard > SQL Editor 에서 실행하세요.
--
-- ⚠️  코드 배포 전 반드시 이 SQL을 먼저 실행해야 합니다.
-- ✅  멱등성 보장 — 이미 실행한 환경에서 재실행해도 안전합니다.
-- ============================================================

-- ── Step 1-A: total_cost GENERATED ALWAYS AS 제거 ────────────────────────────
-- crm.sql 초기 스키마에서 total_cost 는 GENERATED ALWAYS AS (계산식) STORED 로
-- 정의되어 있다. Postgres는 이 컬럼에 대한 직접 UPDATE를 거부하므로
-- BookingDrawer에서 total_cost를 저장하면 500 에러가 발생한다.
-- 이 블록은 GENERATED 제약을 제거하고 일반 INTEGER 컬럼으로 전환한다.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name   = 'bookings'
      AND column_name  = 'total_cost'
      AND is_generated = 'ALWAYS'
  ) THEN
    -- GENERATED ALWAYS AS 표현식 제거
    ALTER TABLE bookings ALTER COLUMN total_cost DROP EXPRESSION;
    -- 기본값 설정 (NULL 방지)
    ALTER TABLE bookings ALTER COLUMN total_cost SET DEFAULT 0;
    -- 기존 레코드 중 NULL인 것을 계산 공식으로 백필
    UPDATE bookings
       SET total_cost = (adult_count * adult_cost)
                      + (child_count * child_cost)
                      + COALESCE(fuel_surcharge, 0)
     WHERE total_cost IS NULL;

    RAISE NOTICE '[마이그레이션] total_cost: GENERATED 제약 제거 완료';
  ELSE
    RAISE NOTICE '[마이그레이션] total_cost: 이미 일반 컬럼 — 스킵';
  END IF;
END $$;

-- ── Step 1-B: total_price GENERATED ALWAYS AS 제거 ───────────────────────────
-- total_price 역시 동일한 GENERATED ALWAYS AS 패턴. 같은 이유로 제거한다.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name   = 'bookings'
      AND column_name  = 'total_price'
      AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE bookings ALTER COLUMN total_price DROP EXPRESSION;
    ALTER TABLE bookings ALTER COLUMN total_price SET DEFAULT 0;
    UPDATE bookings
       SET total_price = (adult_count * adult_price)
                       + (child_count * child_price)
                       + COALESCE(fuel_surcharge, 0)
     WHERE total_price IS NULL;

    RAISE NOTICE '[마이그레이션] total_price: GENERATED 제약 제거 완료';
  ELSE
    RAISE NOTICE '[마이그레이션] total_price: 이미 일반 컬럼 — 스킵';
  END IF;
END $$;

-- ── Step 1-C: is_manual_cost 컬럼 추가 ───────────────────────────────────────
-- TRUE  = 관리자가 total_cost를 수동으로 덮어씀 (다이내믹 빌더 재계산 Lock)
-- FALSE = total_cost는 adult_count×adult_cost + child_count×child_cost + fuel_surcharge 로 자동 계산

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS is_manual_cost BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN bookings.is_manual_cost IS
  'TRUE = 관리자가 total_cost를 수동 설정 (자동 계산 Lock). '
  'FALSE = 자동계산 (adult_count×adult_cost + child_count×child_cost + fuel_surcharge). '
  '다이내믹 견적 빌더에서 인원/단가 변경 시 TRUE인 예약은 total_cost를 덮어쓰지 않는다.';

-- ── Step 1-D: 인덱스 ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_is_manual_cost
  ON bookings (is_manual_cost)
  WHERE is_manual_cost = TRUE;

-- ── 검증 쿼리 ────────────────────────────────────────────────────────────────
-- 실행 후 아래 결과를 확인하세요:
--   column_name     | is_generated | data_type
--   total_cost      | NEVER        | integer
--   total_price     | NEVER        | integer
--   is_manual_cost  | NEVER        | boolean

SELECT
  column_name,
  is_generated,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name  = 'bookings'
  AND column_name IN ('total_cost', 'total_price', 'is_manual_cost')
ORDER BY column_name;
