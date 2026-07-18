BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(20);

SELECT ok(to_regclass('public.blog_information_publications') IS NOT NULL, 'publication audit table exists');
SELECT ok(to_regclass('public.blog_information_cta_events') IS NOT NULL, 'minimal CTA event table exists');
SELECT ok(to_regclass('public.blog_information_source_versions') IS NOT NULL, 'immutable source version table exists');
SELECT ok(to_regclass('public.blog_information_review_cases') IS NOT NULL, 'information review case table exists');
SELECT ok(to_regclass('public.public_blog_content_creatives') IS NOT NULL, 'central public eligibility view exists');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'publish_blog_information_atomically'
    AND pronargs = 14
    AND prosecdef
    AND array_to_string(proconfig, ',') LIKE '%search_path=%'
), 'atomic publisher is a fixed-search-path security definer');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'publish_blog_information_atomically'
    AND (has_function_privilege('anon', oid, 'EXECUTE') OR has_function_privilege('authenticated', oid, 'EXECUTE'))
), 'anonymous and authenticated roles cannot execute the atomic publisher');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'publish_blog_information_atomically'
    AND has_function_privilege('service_role', oid, 'EXECUTE')
), 'service role can execute the atomic publisher');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'record_blog_information_cta_event'
    AND pronargs = 5
    AND prosecdef
    AND array_to_string(proconfig, ',') LIKE '%search_path=%'
), 'CTA recorder is a fixed-search-path security definer');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'record_blog_information_cta_event'
    AND (has_function_privilege('anon', oid, 'EXECUTE') OR has_function_privilege('authenticated', oid, 'EXECUTE'))
), 'anonymous and authenticated roles cannot execute the CTA recorder');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'record_blog_information_cta_event'
    AND has_function_privilege('service_role', oid, 'EXECUTE')
), 'service role can execute the CTA recorder');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.blog_information_publications'::regclass), 'publication table has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.blog_information_cta_events'::regclass), 'CTA event table has RLS enabled');

SELECT ok(
  NOT has_table_privilege('anon', 'public.blog_information_publications', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.blog_information_publications', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.blog_information_cta_events', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.blog_information_cta_events', 'INSERT'),
  'public client roles have no direct publication or CTA table privileges'
);

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid = 'public.blog_information_cta_events'::regclass
    AND attnum > 0
    AND NOT attisdropped
    AND attname = ANY (ARRAY[
      'user_id', 'session_id', 'visitor_id', 'visitor_uid', 'href', 'url',
      'utm_source', 'utm_medium', 'utm_campaign', 'metadata', 'ip', 'user_agent'
    ])
), 'CTA events contain no persistent identity, URL, arbitrary metadata, IP, or user-agent columns');

SELECT ok(to_regclass('public.blog_information_evidence_content_logical_source_version_key') IS NOT NULL, 'versioned evidence uniqueness index exists');
SELECT ok(to_regclass('public.idx_content_review_queue_information_case') IS NOT NULL, 'review queue lookup index exists');
SELECT ok(to_regclass('public.idx_blog_indexing_jobs_idempotency_key') IS NOT NULL, 'indexing outbox idempotency index exists');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_index
  WHERE indexrelid = ANY (ARRAY[
    'public.blog_information_evidence_content_logical_source_version_key'::regclass,
    'public.idx_content_review_queue_information_case'::regclass,
    'public.idx_blog_indexing_jobs_idempotency_key'::regclass
  ])
  AND NOT indisvalid
), 'all concurrently built indexes are valid');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'publish_blog_information_reviewed_draft'
), 'the obsolete split publication function is removed');

SELECT * FROM finish();
ROLLBACK;
