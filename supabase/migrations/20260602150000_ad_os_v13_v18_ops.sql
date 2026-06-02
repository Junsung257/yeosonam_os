-- Ad OS V13-V18 operations layer.
-- Extends change request types for guarded publisher activation, measurement sync,
-- creative drafts, and tenant policy operations. External spend remains behind
-- approval, budget, tenant policy, and kill-switch checks.

ALTER TABLE public.ad_os_change_requests
  DROP CONSTRAINT IF EXISTS ad_os_change_requests_request_type_check,
  ADD CONSTRAINT ad_os_change_requests_request_type_check
  CHECK (request_type IN (
    'create_keyword',
    'pause_keyword',
    'increase_bid',
    'decrease_bid',
    'budget_change',
    'pause_channel',
    'replace_landing',
    'create_landing',
    'create_campaign',
    'sync_external_asset',
    'update_blog_cta',
    'create_card_news',
    'create_negative_keyword',
    'create_experiment',
    'publish_paused_keyword',
    'upload_conversion_signal',
    'activate_paused_keyword',
    'sync_performance',
    'create_creative_draft',
    'update_tenant_policy'
  ));

CREATE INDEX IF NOT EXISTS idx_ad_os_change_requests_v13_ops
  ON public.ad_os_change_requests(request_type, status, created_at DESC);
