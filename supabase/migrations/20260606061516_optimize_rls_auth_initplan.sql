-- Optimize RLS policies flagged by Supabase auth_rls_initplan advisor.
-- This preserves policy semantics while evaluating auth.* once per statement.

alter policy "anomaly_alerts_insert" on public.anomaly_alerts
  with check ((select auth.role()) = 'service_role'::text);

alter policy "anomaly_alerts_select" on public.anomaly_alerts
  using ((select auth.role()) = any (array['service_role'::text, 'authenticated'::text]));

alter policy "api_key_usage_insert" on public.api_key_usage
  with check ((select auth.role()) = 'service_role'::text);

alter policy "api_key_usage_select" on public.api_key_usage
  using (
    (
      tenant_id in (
        select affiliates.id
        from public.affiliates
        where affiliates.id = (select auth.uid())
      )
    )
    or ((select auth.role()) = 'service_role'::text)
  );

alter policy "api_keys_delete" on public.api_keys
  using ((select auth.role()) = 'service_role'::text);

alter policy "api_keys_insert" on public.api_keys
  with check ((select auth.role()) = 'service_role'::text);

alter policy "api_keys_select" on public.api_keys
  using (
    (
      tenant_id in (
        select affiliates.id
        from public.affiliates
        where affiliates.id = (select auth.uid())
      )
    )
    or ((select auth.role()) = 'service_role'::text)
  );

alter policy "api_keys_update" on public.api_keys
  using ((select auth.role()) = 'service_role'::text);

alter policy "billing_history_select" on public.billing_history
  using ((select auth.role()) = any (array['service_role'::text, 'authenticated'::text]));

alter policy "billing_invoices_insert" on public.billing_invoices
  with check ((select auth.role()) = 'service_role'::text);

alter policy "billing_invoices_select" on public.billing_invoices
  using ((select auth.role()) = any (array['service_role'::text, 'authenticated'::text]));

alter policy "billing_invoices_update" on public.billing_invoices
  using ((select auth.role()) = 'service_role'::text);

alter policy "billing_settings_insert" on public.billing_settings
  with check ((select auth.role()) = 'service_role'::text);

alter policy "billing_settings_select" on public.billing_settings
  using ((select auth.role()) = any (array['service_role'::text, 'authenticated'::text]));

alter policy "billing_settings_update" on public.billing_settings
  using ((select auth.role()) = 'service_role'::text);

alter policy "customer_events_service_insert" on public.customer_events
  with check ((select auth.role()) = 'service_role'::text);

alter policy "customer_events_tenant_select" on public.customer_events
  using (
    tenant_id is null
    or tenant_id in (
      select affiliates.id
      from public.affiliates
      where affiliates.id = (select auth.uid())
    )
  );

alter policy "demand_forecasts_insert" on public.demand_forecasts
  with check ((select auth.role()) = 'service_role'::text);

alter policy "demand_forecasts_select" on public.demand_forecasts
  using (
    ((select auth.role()) = 'service_role'::text)
    or ((select auth.role()) = 'authenticated'::text)
  );

alter policy "marketing_asset_group_snapshots_service_all" on public.marketing_asset_group_snapshots
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);

alter policy "marketing_recommendations_service_all" on public.marketing_recommendations
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);

alter policy "meta_conversion_events_service_all" on public.meta_conversion_events
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);

alter policy "product_registration_drafts service-role only" on public.product_registration_drafts
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);

alter policy "prompt_registry_service_all" on public.prompt_registry
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);

alter policy "rec_events_insert" on public.recommendation_events
  with check ((select auth.role()) = 'service_role'::text);

alter policy "rec_events_select" on public.recommendation_events
  using (
    tenant_id is null
    or tenant_id in (
      select affiliates.id
      from public.affiliates
      where affiliates.id = (select auth.uid())
    )
  );

alter policy "service_role_serp_rank_snapshots" on public.serp_rank_snapshots
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);

alter policy "upload_jobs service role all" on public.upload_jobs
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);
