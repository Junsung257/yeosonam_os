-- ============================================================
-- 여소남 OS — 전역 랜드사 Soft Delete + 상품-예약 스마트 매칭 v1
-- Supabase Dashboard > SQL Editor 에서 실행하세요.
--
-- 수정 내용:
--   1. land_operators  → is_active 컬럼 추가 (Soft Delete)
--   2. products        → land_operator_id FK 추가 (정규화)
--   3. bookings        → product_id FK 추가 (상품 연결)
--   4. land_operators  → RLS 활성화 + authenticated 정책
--
-- ✅ 멱등성 보장 — 이미 실행한 환경에서 재실행해도 안전합니다.
-- ============================================================

-- ── Step 1: land_operators — Soft Delete 컬럼 추가 ───────────────────────────
ALTER TABLE land_operators
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- ── Step 2: products — 랜드사 FK 추가 (정규화) ──────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS land_operator_id UUID
    REFERENCES land_operators(id) ON DELETE SET NULL;

-- ── Step 3: bookings — 상품 연결 FK 추가 ────────────────────────────────────
-- products.internal_code 는 TEXT PK 이므로 FK도 TEXT
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS product_id TEXT
    REFERENCES products(internal_code) ON DELETE SET NULL;

-- ── Step 4: RLS — land_operators 테이블 보안 정책 ───────────────────────────
ALTER TABLE land_operators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON land_operators;
CREATE POLICY "authenticated_access"
  ON land_operators FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Step 5: 검증 쿼리 ────────────────────────────────────────────────────────
-- 아래 결과에 is_active, land_operator_id, product_id 행이 모두 있어야 합니다.

SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   IN ('land_operators', 'products', 'bookings')
  AND column_name  IN ('is_active', 'land_operator_id', 'product_id')
ORDER BY table_name, column_name;
