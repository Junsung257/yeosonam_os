-- G3 quota tracker — Vercel Sandbox playwright 활성 시 월 누적 시간 추적 (2026-05-15)
-- 사장님 비용 0 유지 보장: 임계치 초과 시 자동 stop + 정적 fallback.
-- ENABLE_PLAYWRIGHT_OTA=1 + PLAYWRIGHT_MONTHLY_QUOTA_HOURS=4 (안전 마진) 와 짝.

CREATE TABLE IF NOT EXISTS public.attractions_seed_usage (
  id          bigserial PRIMARY KEY,
  attraction_name text,
  url         text,
  elapsed_ms  integer NOT NULL DEFAULT 0,
  status      text NOT NULL CHECK (status IN ('success','timeout','error','skipped_quota')),
  source      text NOT NULL DEFAULT 'playwright',
  called_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seed_usage_called_at ON public.attractions_seed_usage(called_at DESC);

ALTER TABLE public.attractions_seed_usage ENABLE ROW LEVEL SECURITY;
-- service_role 만 접근 (정책 없음 = anon 차단). admin API 가 supabaseAdmin 으로 적재.

COMMENT ON TABLE public.attractions_seed_usage IS
'Vercel Sandbox playwright fetch 호출 추적. 월 누적 elapsed_ms 임계치 초과 시 호출 측에서 skip (사장님 비용 0 보장). 2026-05-15 박제.';
