-- Read-only verification of the Supabase Advisor WARN.
-- Project: ixaxnvbmhzjvupissmly
select
  p.oid::regprocedure as signature,
  p.proconfig,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'match_bank_transaction_allocations';
