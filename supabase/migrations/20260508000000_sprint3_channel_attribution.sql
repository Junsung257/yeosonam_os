-- Sprint 3-B: 크로스채널 어트리뷰션
-- content_id → event 퍼널 추적 (card_news / blog / email)

CREATE TABLE IF NOT EXISTS content_attribution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  content_id UUID NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('card_news', 'blog', 'email')),
  session_id UUID,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'click', 'inquiry', 'booking')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attribution_content ON content_attribution_events(content_id, event_type);
CREATE INDEX IF NOT EXISTS idx_attribution_tenant  ON content_attribution_events(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_attribution_type    ON content_attribution_events(content_type, event_type, occurred_at);

-- RLS
ALTER TABLE content_attribution_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_attribution" ON content_attribution_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_denied_attribution" ON content_attribution_events
  FOR ALL TO anon USING (false);
