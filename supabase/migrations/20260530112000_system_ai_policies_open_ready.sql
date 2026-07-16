-- Runtime AI provider policy table used by Jarvis/LLM gateway.
-- Server routes access this with the service role; clients must not read or mutate it.

CREATE TABLE IF NOT EXISTS public.system_ai_policies (
  task TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('deepseek', 'claude', 'gemini')),
  model TEXT,
  fallback_provider TEXT CHECK (fallback_provider IS NULL OR fallback_provider IN ('deepseek', 'claude', 'gemini')),
  fallback_model TEXT,
  timeout_ms INTEGER CHECK (timeout_ms IS NULL OR timeout_ms > 0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_ai_policies_enabled_updated
  ON public.system_ai_policies (enabled, updated_at DESC);

ALTER TABLE public.system_ai_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_ai_policies_service_role_all" ON public.system_ai_policies;
CREATE POLICY "system_ai_policies_service_role_all"
  ON public.system_ai_policies
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.system_ai_policies FROM anon, authenticated;
GRANT ALL ON TABLE public.system_ai_policies TO service_role;
