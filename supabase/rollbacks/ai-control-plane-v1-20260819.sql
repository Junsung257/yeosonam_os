-- Apply only as a migration rollback, after the workload has been frozen.
drop function if exists public.freeze_ai_workload_v1(text,date);
drop function if exists public.expire_stale_ai_reservations_v1(integer);
drop function if exists public.settle_ai_budget_v1(uuid,boolean,text,integer,integer,integer,numeric,integer,text,text,text,text);
drop function if exists public.reserve_ai_budget_v1(text,text,text,text,text,text,text,text,text,text,integer,integer,numeric);
drop table if exists public.ai_call_receipts;
drop table if exists public.ai_call_reservations;
drop table if exists public.ai_budget_buckets;
