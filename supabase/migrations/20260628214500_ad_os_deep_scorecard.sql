-- Ad OS deep 95 scorecard.
-- Internal-only score snapshots, repair queue, and reviewed source evidence.
-- This migration does not enable any external ad-platform writes.

CREATE TABLE IF NOT EXISTS public.ad_os_subcategory_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  domain_key text NOT NULL,
  subcategory_id text NOT NULL,
  label text NOT NULL,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  target_score integer NOT NULL DEFAULT 95 CHECK (target_score >= 0 AND target_score <= 100),
  post_repair_score integer NOT NULL DEFAULT 95 CHECK (post_repair_score >= 0 AND post_repair_score <= 100),
  status text NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  priority text NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  critical boolean NOT NULL DEFAULT false,
  owner text NOT NULL CHECK (owner IN ('ai_director', 'growth_ops', 'creative_ops', 'data_ops', 'platform_ops')),
  automation_phase text NOT NULL CHECK (automation_phase IN ('score', 'stage', 'pilot', 'live_gate')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  repair_action text NOT NULL DEFAULT '',
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_subcategory_scores_latest
  ON public.ad_os_subcategory_scores(domain_key, subcategory_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_subcategory_scores_tenant
  ON public.ad_os_subcategory_scores(tenant_id, domain_key, generated_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ad_os_repair_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_id text NOT NULL UNIQUE,
  tenant_id uuid NULL,
  domain_key text NOT NULL,
  subcategory_id text NOT NULL,
  title text NOT NULL,
  current_score integer NOT NULL CHECK (current_score >= 0 AND current_score <= 100),
  target_score integer NOT NULL DEFAULT 95 CHECK (target_score >= 0 AND target_score <= 100),
  expected_after_score integer NOT NULL DEFAULT 95 CHECK (expected_after_score >= 0 AND expected_after_score <= 100),
  priority text NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  owner text NOT NULL CHECK (owner IN ('ai_director', 'growth_ops', 'creative_ops', 'data_ops', 'platform_ops')),
  automation_phase text NOT NULL CHECK (automation_phase IN ('score', 'stage', 'pilot', 'live_gate')),
  action text NOT NULL DEFAULT '',
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  can_stage_l3 boolean NOT NULL DEFAULT false,
  approval_required boolean NOT NULL DEFAULT true,
  blocked_reason text NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'staged', 'blocked', 'done', 'archived')),
  safety jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_repair_queue_priority
  ON public.ad_os_repair_queue(status, priority, current_score, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_repair_queue_tenant
  ON public.ad_os_repair_queue(tenant_id, status, priority, updated_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ad_os_source_ledger_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text NOT NULL UNIQUE,
  source_title text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'official_docs',
    'release_notes',
    'open_source',
    'research',
    'runbook'
  )),
  publisher text NOT NULL DEFAULT 'unknown',
  channel text NOT NULL CHECK (channel IN (
    'google',
    'meta',
    'naver',
    'kakao',
    'seo',
    'mcp',
    'cross_channel'
  )),
  accepted_capability text NOT NULL DEFAULT '',
  capability_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  review_status text NOT NULL DEFAULT 'accepted' CHECK (review_status IN ('accepted', 'backlog', 'rejected')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_source_ledger_reviews_channel
  ON public.ad_os_source_ledger_reviews(channel, review_status, reviewed_at DESC);

ALTER TABLE public.ad_os_subcategory_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_os_repair_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_os_source_ledger_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_os_subcategory_scores_service" ON public.ad_os_subcategory_scores;
CREATE POLICY "ad_os_subcategory_scores_service"
  ON public.ad_os_subcategory_scores
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "ad_os_repair_queue_service" ON public.ad_os_repair_queue;
CREATE POLICY "ad_os_repair_queue_service"
  ON public.ad_os_repair_queue
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "ad_os_source_ledger_reviews_service" ON public.ad_os_source_ledger_reviews;
CREATE POLICY "ad_os_source_ledger_reviews_service"
  ON public.ad_os_source_ledger_reviews
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.ad_os_subcategory_scores FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_repair_queue FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_source_ledger_reviews FROM anon, authenticated;
