-- travel_packages 조회 성능 인덱스 (실제 스키마 정합)
-- 실제 컬럼: status, destination, price, duration (no is_active / no destination_code)
-- 적용일: 2026-05-10 (v2 — Supabase MCP)

CREATE INDEX IF NOT EXISTS idx_travel_packages_status
  ON public.travel_packages(status)
  WHERE status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_travel_packages_destination_status
  ON public.travel_packages(destination, status)
  WHERE status IN ('active', 'published', 'approved');

CREATE INDEX IF NOT EXISTS idx_travel_packages_price_active
  ON public.travel_packages(price)
  WHERE status IN ('active', 'published', 'approved') AND price IS NOT NULL;
