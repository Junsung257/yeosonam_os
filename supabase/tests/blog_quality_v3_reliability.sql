begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(23);

select has_table('public', 'analytics_server_event_outbox', 'analytics outbox exists');
select has_column('public', 'leads', 'assisting_content_creative_id', 'lead assist column exists');
select has_column('public', 'leads', 'search_query_hash', 'lead query hash column exists');
select has_trigger('public', 'leads', 'trg_enqueue_generate_lead_analytics_event', 'lead insert outbox trigger exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.analytics_server_event_outbox'::regclass),
  'analytics outbox has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.analytics_server_event_outbox', 'SELECT'),
  'anon cannot read analytics outbox'
);
select ok(
  not has_table_privilege('authenticated', 'public.analytics_server_event_outbox', 'SELECT'),
  'authenticated cannot read analytics outbox'
);
select ok(
  has_table_privilege('service_role', 'public.analytics_server_event_outbox', 'SELECT'),
  'service_role can read analytics outbox'
);
select ok(
  not has_function_privilege('anon', 'public.enqueue_generate_lead_analytics_event()', 'EXECUTE'),
  'anon cannot execute lead outbox trigger function'
);
select ok(
  has_function_privilege('service_role', 'public.enqueue_generate_lead_analytics_event()', 'EXECUTE'),
  'service_role can execute lead outbox trigger function'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in (
     'decide_blog_information_review',
     'publish_blog_information_atomically',
     'record_blog_information_cta_event',
     'replace_blog_information_reviewed_draft_atomically'
   )),
  4::bigint,
  'exactly four privileged blog RPCs are hardened'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'decide_blog_information_review','publish_blog_information_atomically',
      'record_blog_information_cta_event','replace_blog_information_reviewed_draft_atomically'
    ) and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon cannot execute privileged blog RPCs'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'decide_blog_information_review','publish_blog_information_atomically',
      'record_blog_information_cta_event','replace_blog_information_reviewed_draft_atomically'
    ) and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'authenticated cannot execute privileged blog RPCs'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'decide_blog_information_review','publish_blog_information_atomically',
      'record_blog_information_cta_event','replace_blog_information_reviewed_draft_atomically'
    ) and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  ),
  'service_role can execute every privileged blog RPC'
);
select ok(
  position(
    'where blog_information_representatives.representative_key = p_representative_key;'
    in lower(pg_get_functiondef('public.replace_blog_information_reviewed_draft_atomically(uuid,uuid,uuid,uuid,character,jsonb,jsonb,text,text)'::regprocedure))
  ) > 0,
  'reviewed replacement function uses a qualified representative key'
);
select ok(
  to_regclass('public.idx_cc_published_blog_nulls_last') is null,
  'unused duplicate public blog index is absent'
);
select ok(
  to_regclass('public.idx_cc_public_blog_list_v2') is not null,
  'used public blog list index remains present'
);
select is(
  (select ordinal_position from information_schema.columns
   where table_schema = 'public' and table_name = 'public_blog_content_creatives'
     and column_name = 'public_eligibility_lane'),
  51,
  'public eligibility lane retains ordinal 51'
);
select is(
  (select ordinal_position from information_schema.columns
   where table_schema = 'public' and table_name = 'public_blog_content_creatives'
     and column_name = 'title'),
  52,
  'title retains ordinal 52 after the V3 view migration'
);
select is(
  (select ordinal_position from information_schema.columns
   where table_schema = 'public' and table_name = 'public_blog_content_creatives'
     and column_name = 'public_eligibility_reason'),
  60,
  'public eligibility reason is appended at ordinal 60'
);
select ok(
  coalesce((select reloptions from pg_class where oid = 'public.public_blog_content_creatives'::regclass), '{}')
    @> array['security_invoker=true'],
  'public blog view uses security invoker'
);
select ok(
  not has_function_privilege('anon', 'public.refresh_blog_public_snapshots_v3()', 'EXECUTE'),
  'anon cannot refresh public blog snapshots'
);
select ok(
  has_function_privilege('service_role', 'public.refresh_blog_public_snapshots_v3()', 'EXECUTE'),
  'service_role can refresh public blog snapshots'
);

select * from finish();
rollback;
