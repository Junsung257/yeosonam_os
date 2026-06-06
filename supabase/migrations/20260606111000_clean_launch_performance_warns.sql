-- Clean launch-blocking performance WARNs from duplicate indexes and overlapping
-- permissive RLS policies. These changes preserve the existing effective access.

DROP INDEX IF EXISTS public.idx_attractions_mention_count_desc;
DROP INDEX IF EXISTS public.idx_bank_tx_received_desc;
DROP INDEX IF EXISTS public.idx_pin_attempts_lookup;
DROP INDEX IF EXISTS public.idx_travel_packages_created_at_desc;

DROP POLICY IF EXISTS billing_history_insert ON public.billing_history;
ALTER POLICY billing_history_select ON public.billing_history TO authenticated;

DROP POLICY IF EXISTS push_subs_self_read ON public.push_subscriptions;
