BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(12);

SELECT ok(
  NOT has_function_privilege('anon', 'public.cleanup_expired_trend_posts()', 'EXECUTE'),
  'anon cannot execute cleanup_expired_trend_posts'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.cleanup_expired_trend_posts()', 'EXECUTE'),
  'authenticated cannot execute cleanup_expired_trend_posts'
);
SELECT ok(
  has_function_privilege('service_role', 'public.cleanup_expired_trend_posts()', 'EXECUTE'),
  'service_role can execute cleanup_expired_trend_posts'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.expire_mileage_batch(integer)', 'EXECUTE'),
  'anon cannot execute expire_mileage_batch'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.expire_mileage_batch(integer)', 'EXECUTE'),
  'authenticated cannot execute expire_mileage_batch'
);
SELECT ok(
  has_function_privilege('service_role', 'public.expire_mileage_batch(integer)', 'EXECUTE'),
  'service_role can execute expire_mileage_batch'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.extend_mileage_expiry(uuid,integer)', 'EXECUTE'),
  'anon cannot execute extend_mileage_expiry'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.extend_mileage_expiry(uuid,integer)', 'EXECUTE'),
  'authenticated cannot execute extend_mileage_expiry'
);
SELECT ok(
  has_function_privilege('service_role', 'public.extend_mileage_expiry(uuid,integer)', 'EXECUTE'),
  'service_role can execute extend_mileage_expiry'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.increment_ab_metric(bigint,text)', 'EXECUTE'),
  'anon cannot execute increment_ab_metric'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.increment_ab_metric(bigint,text)', 'EXECUTE'),
  'authenticated cannot execute increment_ab_metric'
);
SELECT ok(
  has_function_privilege('service_role', 'public.increment_ab_metric(bigint,text)', 'EXECUTE'),
  'service_role can execute increment_ab_metric'
);

SELECT * FROM finish();

ROLLBACK;
