-- These rows described cron expressions, but no production scheduler parses
-- trigger_config or dispatches their actions. Mark them inactive so the admin
-- surface does not imply that settlement reports or product expiry are running.
UPDATE public.os_policies
SET
  is_active = false,
  updated_at = now()
WHERE trigger_type = 'cron'
  AND is_active = true
  AND (
    (name = '만료 상품 자동 숨김' AND action_type = 'deactivate_expired')
    OR (name = '자동 정산 리포트' AND action_type = 'slack_notify')
  );
