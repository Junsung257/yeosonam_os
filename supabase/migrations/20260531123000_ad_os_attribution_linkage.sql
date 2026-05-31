-- Ad OS attribution linkage
-- Connect blog landing visits, CTA clicks, and conversions back to ad_landing_mappings.

ALTER TABLE content_attribution_events
  ADD COLUMN IF NOT EXISTS ad_landing_mapping_id uuid REFERENCES ad_landing_mappings(id) ON DELETE SET NULL;

ALTER TABLE blog_engagement_logs
  ADD COLUMN IF NOT EXISTS ad_landing_mapping_id uuid REFERENCES ad_landing_mappings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_term text;

ALTER TABLE ad_conversion_logs
  ADD COLUMN IF NOT EXISTS ad_landing_mapping_id uuid REFERENCES ad_landing_mappings(id) ON DELETE SET NULL;

ALTER TABLE ad_landing_mappings
  ADD COLUMN IF NOT EXISTS cta_clicks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_value_krw integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_click_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_cta_click_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_conversion_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_content_attribution_events_mapping
  ON content_attribution_events(ad_landing_mapping_id, event_type, occurred_at DESC)
  WHERE ad_landing_mapping_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_blog_engagement_logs_mapping
  ON blog_engagement_logs(ad_landing_mapping_id, created_at DESC)
  WHERE ad_landing_mapping_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_mapping
  ON ad_conversion_logs(ad_landing_mapping_id, created_at DESC)
  WHERE ad_landing_mapping_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_landing_mappings_utm_lookup
  ON ad_landing_mappings(content_creative_id, utm_source, utm_campaign, utm_term);
