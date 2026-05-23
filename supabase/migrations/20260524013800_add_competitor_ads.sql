CREATE TABLE IF NOT EXISTS competitor_ads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('meta', 'google', 'naver')),
  advertiser_name TEXT NOT NULL,
  headline TEXT,
  description TEXT,
  destination TEXT,
  estimated_spend TEXT,
  first_seen DATE DEFAULT CURRENT_DATE,
  last_seen DATE DEFAULT CURRENT_DATE,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_ads_platform ON competitor_ads(platform);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_advertiser ON competitor_ads(advertiser_name);

ALTER TABLE competitor_ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitor_ads service" ON competitor_ads
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "competitor_ads read" ON competitor_ads
  FOR SELECT
  USING (true);
