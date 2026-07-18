BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(10);

CREATE TEMP TABLE information_internal_tables(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO information_internal_tables(name) VALUES
  ('blog_information_sources'),
  ('blog_information_source_versions'),
  ('blog_information_evidence'),
  ('blog_information_claims'),
  ('blog_information_claim_evidence'),
  ('blog_information_review_cases'),
  ('blog_information_review_events'),
  ('blog_information_representatives'),
  ('blog_information_publications'),
  ('blog_indexing_jobs'),
  ('blog_information_cta_events');

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_internal_tables AS target
    JOIN pg_class AS relation ON relation.oid = ('public.' || target.name)::regclass
    WHERE relation.relrowsecurity IS NOT TRUE
  ),
  'all informational internal tables have RLS enabled'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_internal_tables AS target
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS privilege
    WHERE has_table_privilege('anon', 'public.' || target.name, privilege)
  ),
  'anon has no direct internal-table read or write privilege'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_internal_tables AS target
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS privilege
    WHERE has_table_privilege('authenticated', 'public.' || target.name, privilege)
  ),
  'authenticated users have no direct internal-table read or write privilege'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_internal_tables AS target
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT']) AS privilege
    WHERE NOT has_table_privilege('service_role', 'public.' || target.name, privilege)
  ),
  'service_role has required read and append privileges while immutable tables remain non-mutable'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    JOIN information_internal_tables AS target
      ON policy.polrelid = ('public.' || target.name)::regclass
    CROSS JOIN unnest(policy.polroles) AS policy_role
    WHERE policy_role IN ('anon'::regrole, 'authenticated'::regrole)
  ),
  'no informational internal-table policy grants anon or authenticated access'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname IN (
        'publish_blog_information_atomically',
        'decide_blog_information_review',
        'record_blog_information_cta_event'
      )
      AND (
        has_function_privilege('anon', function.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', function.oid, 'EXECUTE')
      )
  ),
  'public client roles cannot execute informational write RPCs'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname IN (
        'publish_blog_information_atomically',
        'decide_blog_information_review',
        'record_blog_information_cta_event'
      )
      AND NOT has_function_privilege('service_role', function.oid, 'EXECUTE')
  ),
  'service_role can execute informational write RPCs'
);

SELECT ok(
  'security_invoker=true' = ANY (
    SELECT unnest(coalesce(reloptions, ARRAY[]::text[]))
    FROM pg_class
    WHERE oid = 'public.public_blog_content_creatives'::regclass
  ),
  'the public eligibility view uses invoker security'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.blog_information_source_versions'::regclass
      AND tgname = 'blog_information_source_versions_immutable'
      AND NOT tgisinternal
  ),
  'source versions have an immutability trigger'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.blog_information_review_events'::regclass
      AND tgname = 'blog_information_review_events_append_only'
      AND NOT tgisinternal
  ),
  'review events have an append-only trigger'
);

SELECT * FROM finish();
ROLLBACK;
