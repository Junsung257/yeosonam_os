-- 마케팅 발행 URL 이력 (/api/marketing-logs)
-- 이전에는 db/marketing_system_v1.sql 수동 실행에만 있었음 → 프로덕션 누락 시 GET 500
BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        text REFERENCES public.products(internal_code) ON DELETE SET NULL,
  travel_package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  platform          text NOT NULL
    CHECK (platform IN ('blog', 'instagram', 'cafe', 'threads', 'other')),
  url               text NOT NULL,
  va_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);

-- 구버전 테이블(컬럼 누락) 보정
ALTER TABLE public.marketing_logs
  ADD COLUMN IF NOT EXISTS travel_package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_logs_product_id
  ON public.marketing_logs (product_id);
CREATE INDEX IF NOT EXISTS idx_marketing_logs_package_id
  ON public.marketing_logs (travel_package_id);
CREATE INDEX IF NOT EXISTS idx_marketing_logs_platform
  ON public.marketing_logs (platform);

ALTER TABLE public.marketing_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_access" ON public.marketing_logs;
CREATE POLICY "authenticated_access"
  ON public.marketing_logs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.marketing_logs IS '플랫폼별 마케팅 발행 URL 이력 (카드뉴스/인스타 등)';

COMMIT;
