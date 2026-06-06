-- Keyword family registry for semantic dedupe and cannibalization control.

BEGIN;

CREATE TABLE IF NOT EXISTS blog_keyword_families (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  family_key TEXT NOT NULL UNIQUE,
  canonical_keyword TEXT NOT NULL,
  destination TEXT,
  intent TEXT CHECK (intent IS NULL OR intent IN ('informational', 'commercial', 'mixed')),
  representative_slug TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'watch', 'merged', 'archived')),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_keyword_family_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES blog_keyword_families(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  slug TEXT,
  topic_queue_id UUID REFERENCES blog_topic_queue(id) ON DELETE SET NULL,
  content_creative_id UUID REFERENCES content_creatives(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'candidate' CHECK (role IN ('representative', 'supporting', 'candidate', 'archived')),
  source TEXT NOT NULL DEFAULT 'system',
  score NUMERIC(8,2),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (family_id, keyword, source)
);

CREATE INDEX IF NOT EXISTS idx_blog_keyword_families_destination ON blog_keyword_families(destination);
CREATE INDEX IF NOT EXISTS idx_blog_keyword_families_status ON blog_keyword_families(status);
CREATE INDEX IF NOT EXISTS idx_blog_keyword_family_members_family ON blog_keyword_family_members(family_id);
CREATE INDEX IF NOT EXISTS idx_blog_keyword_family_members_queue ON blog_keyword_family_members(topic_queue_id);
CREATE INDEX IF NOT EXISTS idx_blog_keyword_family_members_creative ON blog_keyword_family_members(content_creative_id);
CREATE INDEX IF NOT EXISTS idx_blog_keyword_family_members_slug ON blog_keyword_family_members(slug);

ALTER TABLE blog_keyword_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_keyword_family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_blog_keyword_families" ON blog_keyword_families;
CREATE POLICY "allow_all_blog_keyword_families"
  ON blog_keyword_families FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_blog_keyword_family_members" ON blog_keyword_family_members;
CREATE POLICY "allow_all_blog_keyword_family_members"
  ON blog_keyword_family_members FOR ALL
  USING (true)
  WITH CHECK (true);

COMMIT;
