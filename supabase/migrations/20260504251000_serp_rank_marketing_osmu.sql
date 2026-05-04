-- 순위 스냅샷(외부 SerpApi 등 연동 시 적재) + OSMU 자산 행
CREATE TABLE IF NOT EXISTS serp_rank_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword     TEXT NOT NULL,
  engine      TEXT NOT NULL CHECK (engine IN ('google', 'naver')),
  url         TEXT NOT NULL,
  position    INTEGER,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_serp_rank_keyword ON serp_rank_snapshots(keyword);
CREATE INDEX IF NOT EXISTS idx_serp_rank_checked ON serp_rank_snapshots(checked_at DESC);

ALTER TABLE serp_rank_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_serp_rank" ON serp_rank_snapshots;
CREATE POLICY "allow_all_serp_rank" ON serp_rank_snapshots FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS marketing_assets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID,
  seed_topic           TEXT NOT NULL,
  channel              TEXT NOT NULL,
  body                 TEXT,
  content_creative_id  UUID REFERENCES content_creatives(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_marketing_assets_seed ON marketing_assets(seed_topic);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_channel ON marketing_assets(channel);

ALTER TABLE marketing_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_marketing_assets" ON marketing_assets;
CREATE POLICY "allow_all_marketing_assets" ON marketing_assets FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE marketing_assets IS 'OSMU — 시드 1회로 채널별 변형(블로그/카페/카드뉴스 등) 저장';
