-- These maintenance RPCs mutate server-owned tables under SECURITY DEFINER.
-- PostgreSQL grants EXECUTE to PUBLIC by default, so keep them callable only
-- by the migration owner and the server-side service role.

REVOKE ALL ON FUNCTION public.cleanup_expired_trend_posts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_trend_posts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_trend_posts() TO service_role;

REVOKE ALL ON FUNCTION public.expire_mileage_batch(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_mileage_batch(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_mileage_batch(integer) TO service_role;

REVOKE ALL ON FUNCTION public.extend_mileage_expiry(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extend_mileage_expiry(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_mileage_expiry(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.increment_ab_metric(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_ab_metric(bigint, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_ab_metric(bigint, text) TO service_role;
