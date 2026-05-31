-- Section-cache telemetry for product registration token savings.

ALTER TABLE public.ai_quality_log
  ADD COLUMN IF NOT EXISTS section_cache_hit_count int NOT NULL DEFAULT 0 CHECK (section_cache_hit_count >= 0),
  ADD COLUMN IF NOT EXISTS section_cache_reduced_chars int NOT NULL DEFAULT 0 CHECK (section_cache_reduced_chars >= 0),
  ADD COLUMN IF NOT EXISTS section_cache_reduce_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS section_cache_replaced_labels text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.ai_quality_log.section_cache_hit_count IS
  'Number of exact section-cache hits observed during upload normalization.';

COMMENT ON COLUMN public.ai_quality_log.section_cache_reduced_chars IS
  'Approximate source characters replaced by SECTION_CACHE_HIT markers before the LLM call.';

COMMENT ON COLUMN public.ai_quality_log.section_cache_reduce_ready IS
  'True only when exact section-cache hits cover every required customer-visible field.';

COMMENT ON COLUMN public.ai_quality_log.section_cache_replaced_labels IS
  'Section labels replaced by cache-hit markers in the LLM input.';
