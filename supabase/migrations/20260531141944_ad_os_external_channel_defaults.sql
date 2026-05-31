-- Store default external ad account/campaign/ad group ids per channel so operators
-- can configure Ad OS from the dashboard instead of editing environment variables.

ALTER TABLE public.ad_os_channel_budgets
  ADD COLUMN IF NOT EXISTS external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS external_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS external_ad_group_id TEXT,
  ADD COLUMN IF NOT EXISTS external_config_note TEXT;
