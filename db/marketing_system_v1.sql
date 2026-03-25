-- ============================================================
-- 여소남 OS — 마케팅 시스템 엔터프라이즈 개편 v1
-- Supabase Dashboard > SQL Editor 에서 실행하세요.
--
-- 수정 내용:
--   1. user_profiles  — VA 역할 관리 테이블 (admin | va)
--   2. products       — B2C 컬럼 추가 (public_itinerary, highlights, b2b_notes)
--   3. marketing_logs — 플랫폼별 발행 URL 이력 테이블
--
-- ✅ 멱등성 보장 — 이미 실행한 환경에서 재실행해도 안전합니다.
-- ============================================================

-- ── Step 1: user_profiles — VA/Admin 역할 관리 ───────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'va')),
  name       TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_access"     ON user_profiles;
DROP POLICY IF EXISTS "admin_read_all"  ON user_profiles;

-- 본인 프로필만 읽고 수정 가능
CREATE POLICY "self_access"
  ON user_profiles FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ── Step 2: products — B2B/B2C 컬럼 추가 ────────────────────────────────────
-- b2b_notes     : 내부 조건/메모 (VA 접근 차단)
-- public_itinerary: B2C용 정제된 일정표 JSON
-- highlights    : B2C 핵심 소구점 배열
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS b2b_notes        TEXT,
  ADD COLUMN IF NOT EXISTS public_itinerary JSONB   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS highlights       TEXT[]  DEFAULT '{}';

-- ── Step 3: marketing_logs — 플랫폼별 발행 이력 ─────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_logs (
  id                UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        TEXT      REFERENCES products(internal_code) ON DELETE SET NULL,
  travel_package_id UUID      REFERENCES travel_packages(id) ON DELETE SET NULL,
  platform          TEXT      NOT NULL
    CHECK (platform IN ('blog', 'instagram', 'cafe', 'threads', 'other')),
  url               TEXT      NOT NULL,
  va_id             UUID      REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketing_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_access" ON marketing_logs;
CREATE POLICY "authenticated_access"
  ON marketing_logs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 인덱스: 상품/패키지별 빠른 조회
CREATE INDEX IF NOT EXISTS idx_marketing_logs_product_id
  ON marketing_logs (product_id);
CREATE INDEX IF NOT EXISTS idx_marketing_logs_package_id
  ON marketing_logs (travel_package_id);
CREATE INDEX IF NOT EXISTS idx_marketing_logs_platform
  ON marketing_logs (platform);

-- ── Step 4: 검증 쿼리 ────────────────────────────────────────────────────────
-- 아래 결과를 확인하세요:
--   user_profiles.role, products.b2b_notes/highlights/public_itinerary,
--   marketing_logs 테이블 컬럼들이 모두 표시되어야 합니다.

SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'user_profiles')
    OR (table_name = 'products'       AND column_name IN ('b2b_notes', 'public_itinerary', 'highlights'))
    OR (table_name = 'marketing_logs' AND column_name IN ('id', 'platform', 'url', 'va_id'))
  )
ORDER BY table_name, column_name;
