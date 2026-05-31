-- Link internal keyword performance rows to platform-side ad entities.
-- Required before cron jobs can safely mutate live search-ad bids/status.

ALTER TABLE public.keyword_performances
  ADD COLUMN IF NOT EXISTS external_keyword_id TEXT,
  ADD COLUMN IF NOT EXISTS external_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS external_ad_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_keyword_performances_external_keyword_id
  ON public.keyword_performances (platform, external_keyword_id)
  WHERE external_keyword_id IS NOT NULL;
