-- Keep Ad OS enterprise automation data server-only. RLS policies already limit
-- rows to service_role; these revokes also remove direct Data API table grants.
revoke all on table public.ad_os_keyword_clusters from anon, authenticated;
revoke all on table public.ad_os_external_mutation_results from anon, authenticated;
revoke all on table public.ad_os_tenant_reports from anon, authenticated;
