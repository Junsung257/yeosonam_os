-- Product registration section cache.
--
-- Stores only exact section parse patches. Similar masked format hashes are
-- kept for analytics/prompt guidance, never as customer-fact cache keys.

CREATE TABLE IF NOT EXISTS public.normalized_intake_section_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label               text NOT NULL,
  exact_hash          text NOT NULL,
  format_hash         text NOT NULL,
  char_length         integer NOT NULL DEFAULT 0 CHECK (char_length >= 0),
  raw_text_hash       text NOT NULL,
  normalizer_version  text NOT NULL,
  patch               jsonb NOT NULL,
  hit_count           integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  last_hit_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT normalized_intake_section_cache_unique
    UNIQUE (label, exact_hash, normalizer_version)
);

CREATE INDEX IF NOT EXISTS idx_normalized_intake_section_cache_exact
  ON public.normalized_intake_section_cache (label, exact_hash, normalizer_version);

CREATE INDEX IF NOT EXISTS idx_normalized_intake_section_cache_raw_text
  ON public.normalized_intake_section_cache (raw_text_hash);

CREATE INDEX IF NOT EXISTS idx_normalized_intake_section_cache_format
  ON public.normalized_intake_section_cache (format_hash);

CREATE INDEX IF NOT EXISTS idx_normalized_intake_section_cache_patch_gin
  ON public.normalized_intake_section_cache USING gin (patch);

ALTER TABLE public.normalized_intake_section_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "normalized_intake_section_cache service role"
  ON public.normalized_intake_section_cache;

CREATE POLICY "normalized_intake_section_cache service role"
  ON public.normalized_intake_section_cache
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.normalized_intake_section_cache TO service_role;

DROP TRIGGER IF EXISTS trg_normalized_intake_section_cache_updated_at
  ON public.normalized_intake_section_cache;

CREATE TRIGGER trg_normalized_intake_section_cache_updated_at
  BEFORE UPDATE ON public.normalized_intake_section_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.normalized_intake_section_cache IS
  'Exact section parse cache for product upload IR. Reuse requires label + exact_hash + normalizer_version match.';

COMMENT ON COLUMN public.normalized_intake_section_cache.exact_hash IS
  'Fact-preserving section hash. Only this hash can drive customer-visible section reuse.';

COMMENT ON COLUMN public.normalized_intake_section_cache.format_hash IS
  'Masked format hash for supplier format analytics and prompt guidance. Must not drive customer-fact reuse.';

COMMENT ON COLUMN public.normalized_intake_section_cache.patch IS
  'Safe per-section NormalizedIntake patch, scoped by label in src/lib/intake-section-cache.ts.';
