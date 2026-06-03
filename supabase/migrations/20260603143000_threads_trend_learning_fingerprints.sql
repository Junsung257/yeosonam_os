-- ============================================================================
-- Threads trend learning fingerprints
-- ============================================================================
-- Purpose:
--   1) Keep compact, non-PII style fingerprints derived from external trend rows
--      and our own post engagement snapshots.
--   2) Let generation prompts keep using learned signals even when Threads
--      keyword_search permission is not granted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS trend_style_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT 'global',
  audience TEXT NOT NULL DEFAULT 'global',
  hook_type TEXT NOT NULL DEFAULT 'unknown',
  style_key TEXT NOT NULL DEFAULT 'general',
  source_type TEXT NOT NULL DEFAULT 'external_trend',

  sample_count INTEGER NOT NULL DEFAULT 0,
  avg_score NUMERIC(7, 4),
  avg_er NUMERIC(7, 4),
  avg_hook_words NUMERIC(7, 2),
  avg_posting_hour NUMERIC(5, 2),
  avg_emoji_count NUMERIC(7, 2),
  avg_hashtag_count NUMERIC(7, 2),

  sample_first_lines TEXT[] NOT NULL DEFAULT '{}',
  source_breakdown JSONB NOT NULL DEFAULT '{}',
  latest_captured_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_tsf_platform CHECK (platform IN ('threads', 'instagram')),
  CONSTRAINT chk_tsf_source_type CHECK (source_type IN ('external_trend', 'owned_performance', 'mixed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tsf_identity
  ON trend_style_fingerprints (platform, destination, audience, hook_type, style_key, source_type);

CREATE INDEX IF NOT EXISTS idx_tsf_lookup
  ON trend_style_fingerprints (platform, destination, avg_score DESC NULLS LAST, sample_count DESC);

COMMENT ON TABLE trend_style_fingerprints IS
  'Compact non-PII style fingerprints for Threads/IG trend-aware generation prompts.';

CREATE OR REPLACE FUNCTION update_trend_style_fingerprints_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tsf_updated_at ON trend_style_fingerprints;
CREATE TRIGGER trg_tsf_updated_at
  BEFORE UPDATE ON trend_style_fingerprints
  FOR EACH ROW EXECUTE FUNCTION update_trend_style_fingerprints_updated_at();

CREATE OR REPLACE VIEW threads_learning_signals_14d AS
SELECT
  COALESCE(cd.tenant_id, pes.tenant_id) AS tenant_id,
  COALESCE(cd.product_id, NULL) AS product_id,
  COALESCE((cd.generation_config->'brief'->>'target_audience'), 'global') AS audience,
  COALESCE((cd.generation_config->'brief'->>'destination'), 'global') AS destination,
  COALESCE(pes.hook_type, cd.generation_config->>'hook_type', 'unknown') AS hook_type,
  COALESCE(cd.generation_config->>'style', 'general') AS style_key,
  COUNT(DISTINCT pes.external_id) AS sample_count,
  AVG(pes.performance_score) FILTER (WHERE pes.performance_score IS NOT NULL) AS avg_score,
  AVG(
    CASE
      WHEN COALESCE(pes.views, 0) > 0 THEN
        (
          COALESCE(pes.likes, 0)
          + COALESCE(pes.replies, 0)
          + COALESCE(pes.reposts, 0)
          + COALESCE(pes.quotes, 0)
        )::NUMERIC / pes.views
      ELSE NULL
    END
  ) AS avg_er,
  AVG(pes.posting_hour) FILTER (WHERE pes.posting_hour IS NOT NULL) AS avg_posting_hour,
  MAX(pes.captured_at) AS latest_captured_at
FROM post_engagement_snapshots pes
JOIN content_distributions cd ON cd.id = pes.distribution_id
WHERE pes.platform = 'threads'
  AND pes.captured_at >= now() - interval '14 days'
GROUP BY 1, 2, 3, 4, 5, 6
HAVING COUNT(DISTINCT pes.external_id) >= 1;

COMMENT ON VIEW threads_learning_signals_14d IS
  'Owned Threads performance learning signals for prompt context and style fingerprints.';
