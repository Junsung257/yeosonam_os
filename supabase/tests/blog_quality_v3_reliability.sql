begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(10);

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

select * from finish();
rollback;
