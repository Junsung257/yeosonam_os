-- Marketing Recommendation Ledger
-- Stores Command Center recommendations and their apply/dismiss lifecycle.

CREATE TABLE IF NOT EXISTS public.marketing_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id TEXT NOT NULL UNIQUE,
  product_id UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('content', 'social', 'ads', 'tracking', 'ops')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  action_url TEXT NOT NULL,
  action_label TEXT NOT NULL,
  automation_level INTEGER NOT NULL DEFAULT 0 CHECK (automation_level BETWEEN 0 AND 3),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'dismissed', 'expired')),
  evidence JSONB NOT NULL DEFAULT '{}',
  expected_impact JSONB NOT NULL DEFAULT '{}',
  realized_impact JSONB NOT NULL DEFAULT '{}',
  applied_target_table TEXT,
  applied_target_id TEXT,
  applied_by TEXT,
  applied_at TIMESTAMPTZ,
  dismissed_by TEXT,
  dismissed_at TIMESTAMPTZ,
  dismissed_reason TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_recommendations_product
  ON public.marketing_recommendations(product_id);

CREATE INDEX IF NOT EXISTS idx_marketing_recommendations_status_severity
  ON public.marketing_recommendations(status, severity, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_recommendations_last_seen
  ON public.marketing_recommendations(last_seen_at DESC);

ALTER TABLE public.marketing_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_recommendations_service_all ON public.marketing_recommendations;

CREATE POLICY marketing_recommendations_service_all
  ON public.marketing_recommendations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.marketing_recommendations IS
  'Audit ledger for Marketing Command Center recommendations: open, applied, dismissed, expired.';

COMMENT ON COLUMN public.marketing_recommendations.action_id IS
  'Stable recommendation key, usually product_id:action-kind.';
