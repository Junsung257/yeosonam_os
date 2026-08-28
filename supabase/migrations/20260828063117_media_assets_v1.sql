-- Yeosonam shared media asset ledger.
-- Runtime writes are service-role only. Public pages receive immutable bucket URLs,
-- while the table itself stays unavailable to anon/authenticated Data API roles.

CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('blog', 'home', 'package', 'card_news', 'marketing')),
  owner_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN (
    'blog_cover',
    'blog_inline_summary',
    'blog_inline_cta',
    'home_campaign_hero',
    'card_news_background',
    'social_og',
    'brand_fallback'
  )),
  asset_class text NOT NULL CHECK (asset_class IN (
    'reality_required',
    'conceptual_allowed',
    'deterministic_graphic'
  )),
  source_kind text NOT NULL CHECK (source_kind IN (
    'supplier',
    'official',
    'licensed_stock',
    'openai_generated',
    'code_rendered',
    'brand_static'
  )),
  storage_bucket text NULL,
  storage_path text NULL,
  public_url text NULL,
  variants jsonb NOT NULL DEFAULT '{}'::jsonb,
  mime_type text NULL,
  width integer NULL CHECK (width IS NULL OR width > 0),
  height integer NULL CHECK (height IS NULL OR height > 0),
  sha256 text NULL CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  provider text NULL CHECK (provider IS NULL OR provider IN ('openai', 'code')),
  model text NULL,
  prompt_version text NOT NULL,
  brief_digest text NOT NULL CHECK (brief_digest ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  qa_report jsonb NULL,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  disclosure text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'failed',
    'superseded'
  )),
  approval_note text NULL,
  approved_by text NULL,
  approved_at timestamptz NULL,
  superseded_by uuid NULL REFERENCES public.media_assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_assets_owner_idx
  ON public.media_assets (owner_type, owner_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS media_assets_review_idx
  ON public.media_assets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS media_assets_provider_cost_idx
  ON public.media_assets (provider, created_at DESC)
  WHERE provider IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_assets_sha256_idx
  ON public.media_assets (sha256)
  WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_assets_superseded_by_idx
  ON public.media_assets (superseded_by)
  WHERE superseded_by IS NOT NULL;

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_assets TO service_role;

DROP POLICY IF EXISTS media_assets_service_role_all ON public.media_assets;
CREATE POLICY media_assets_service_role_all
  ON public.media_assets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'media-assets',
  'media-assets',
  true,
  6291456,
  ARRAY['image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON TABLE public.media_assets IS
  'Immutable AI/code/sourced media provenance ledger. Service-role only; public delivery uses content-hashed Storage URLs.';
COMMENT ON COLUMN public.media_assets.asset_class IS
  'reality_required forbids generative imagery; conceptual_allowed permits disclosed AI; deterministic_graphic is code-rendered.';
COMMENT ON COLUMN public.media_assets.idempotency_key IS
  'SHA-256(owner, purpose, brief digest, prompt version) prevents duplicate paid generation.';
