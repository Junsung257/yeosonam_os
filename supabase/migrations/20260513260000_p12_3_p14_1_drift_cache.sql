-- P12-3 + P14-1: content_drift_actions + semantic_extraction_cache
-- 박제일: 2026-05-13

CREATE TABLE IF NOT EXISTS content_drift_actions (
  id              bigserial PRIMARY KEY,
  drift_keyword   text NOT NULL,
  drift_ratio     numeric(6,2) NOT NULL,
  related_destination text,
  action_type     text NOT NULL CHECK (action_type IN ('regenerate_card_news','regenerate_blog','flag_for_review')),
  status          text DEFAULT 'pending' CHECK (status IN ('pending','queued','completed','failed','skipped')),
  target_id       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  notes           text
);
CREATE INDEX IF NOT EXISTS idx_drift_actions_pending ON content_drift_actions(status, created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS semantic_extraction_cache (
  id              bigserial PRIMARY KEY,
  raw_text_hash   text UNIQUE NOT NULL,
  raw_text_snippet text NOT NULL,
  destination     text,
  land_operator_id uuid REFERENCES land_operators(id) ON DELETE SET NULL,
  cached_extracted_data jsonb NOT NULL,
  confidence      numeric(4,3),
  hit_count       int DEFAULT 0,
  last_hit_at     timestamptz,
  ttl_expires_at  timestamptz DEFAULT (now() + interval '30 days'),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_hash ON semantic_extraction_cache(raw_text_hash);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_dest ON semantic_extraction_cache(destination) WHERE destination IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_semantic_cache_ttl ON semantic_extraction_cache(ttl_expires_at);
