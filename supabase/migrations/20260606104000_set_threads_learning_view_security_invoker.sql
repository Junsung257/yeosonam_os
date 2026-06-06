-- Avoid SECURITY DEFINER behavior on the public Threads learning aggregate view.
-- Server-side service-role queries still work, while client roles must satisfy
-- the underlying tables' RLS policies.

ALTER VIEW public.threads_learning_signals_14d SET (security_invoker = true);
