-- Ad OS paid-assisted organic attribution support.
-- Nullable additive columns only; existing tracking rows remain valid.

ALTER TABLE public.ad_traffic_logs
  ADD COLUMN IF NOT EXISTS gbraid text,
  ADD COLUMN IF NOT EXISTS wbraid text;

ALTER TABLE public.ad_conversion_logs
  ADD COLUMN IF NOT EXISTS attributed_gbraid text,
  ADD COLUMN IF NOT EXISTS attributed_wbraid text,
  ADD COLUMN IF NOT EXISTS first_touch_ad_landing_mapping_id uuid REFERENCES public.ad_landing_mappings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_touch_gclid text,
  ADD COLUMN IF NOT EXISTS first_touch_gbraid text,
  ADD COLUMN IF NOT EXISTS first_touch_wbraid text,
  ADD COLUMN IF NOT EXISTS first_touch_fbclid text,
  ADD COLUMN IF NOT EXISTS first_touch_n_keyword text,
  ADD COLUMN IF NOT EXISTS paid_assisted_organic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attribution_path text;

CREATE INDEX IF NOT EXISTS idx_ad_traffic_logs_gbraid
  ON public.ad_traffic_logs(gbraid)
  WHERE gbraid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_traffic_logs_wbraid
  ON public.ad_traffic_logs(wbraid)
  WHERE wbraid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_paid_assisted
  ON public.ad_conversion_logs(paid_assisted_organic, created_at DESC)
  WHERE paid_assisted_organic = true;

CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_first_touch_mapping
  ON public.ad_conversion_logs(first_touch_ad_landing_mapping_id, created_at DESC)
  WHERE first_touch_ad_landing_mapping_id IS NOT NULL;
