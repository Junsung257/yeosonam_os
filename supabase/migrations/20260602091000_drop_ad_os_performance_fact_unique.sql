-- Ad OS performance facts are append-only sync snapshots. Repeated syncs should
-- not fail on expression uniqueness while channel connectors are still being
-- normalized.

DROP INDEX IF EXISTS public.idx_ad_os_performance_facts_unique_source;
