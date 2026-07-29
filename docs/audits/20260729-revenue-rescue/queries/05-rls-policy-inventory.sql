-- Immutable RLS inventory. Store the complete result before any policy change.
select
  now() as observed_at,
  p.schemaname,
  p.tablename,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
from pg_policies p
where p.schemaname = 'public'
order by p.tablename, p.policyname;

with canonical as (
  select
    jsonb_build_object(
      'schemaname', schemaname,
      'tablename', tablename,
      'policyname', policyname,
      'permissive', permissive,
      'roles', roles,
      'cmd', cmd,
      'qual', qual,
      'with_check', with_check
    )::text as line
  from pg_policies
  where schemaname = 'public'
  order by tablename, policyname
)
select
  now() as observed_at,
  count(*) as row_count,
  encode(digest(string_agg(line, E'\n'), 'sha256'), 'hex') as sha256
from canonical;

with public_tables as (
  select c.oid, n.nspname, c.relname, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
)
select
  count(*) as public_tables,
  count(*) filter (where relrowsecurity) as rls_enabled_tables,
  (select count(*) from pg_policies where schemaname = 'public') as policy_count,
  count(*) filter (
    where relrowsecurity
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = public_tables.nspname
          and p.tablename = public_tables.relname
      )
  ) as rls_enabled_no_policy_tables
from public_tables;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and (roles && array['authenticated'::name, 'public'::name])
  and coalesce(btrim(qual), '') = 'true'
order by tablename, policyname;
