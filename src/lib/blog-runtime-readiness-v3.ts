export type BlogRuntimeReadinessScopeV3 = 'publish' | 'delivery' | 'measurement';

export interface BlogRuntimeResourceV3 {
  key: string;
  table: string;
  columns: string;
  scope: BlogRuntimeReadinessScopeV3;
}

export interface BlogRuntimeResourceCheckV3 extends BlogRuntimeResourceV3 {
  ready: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface BlogRuntimeSchemaReadinessV3 {
  version: 'blog-runtime-schema-v3';
  checkedAt: string;
  publishReady: boolean;
  deliveryReady: boolean;
  measurementReady: boolean;
  fullyReady: boolean;
  missing: string[];
  checks: BlogRuntimeResourceCheckV3[];
}

export interface BlogRuntimeProbeResultV3 {
  error?: {
    code?: string | null;
    message?: string | null;
  } | null;
}

export const BLOG_RUNTIME_RESOURCES_V3: readonly BlogRuntimeResourceV3[] = [
  {
    key: 'content_creatives_v3_columns',
    table: 'content_creatives',
    columns: 'id,content_document,content_modified_at,fact_checked_at,last_verified_at,material_update_reason,author_profile_id',
    scope: 'publish',
  },
  {
    key: 'public_eligibility_policy_v3',
    table: 'public_blog_content_creatives',
    columns: 'id,public_eligibility_lane,public_eligibility_reason',
    scope: 'publish',
  },
  {
    key: 'public_slug_registry_v1',
    table: 'public_blog_slug_registry',
    columns: 'id,slug',
    scope: 'delivery',
  },
  { key: 'publication_decisions', table: 'blog_publication_decisions', columns: 'id', scope: 'publish' },
  { key: 'quality_evaluations', table: 'blog_quality_evaluations', columns: 'id', scope: 'publish' },
  {
    key: 'generation_runs_v4',
    table: 'blog_generation_runs',
    columns: 'id,queue_id,status,attempt_count,latest_quality_score,selected_attempt_id,scheduled_publish_at,pipeline_version,deployment_commit_sha,schema_migration_version',
    scope: 'publish',
  },
  {
    key: 'generation_attempts_v4',
    table: 'blog_generation_attempts',
    columns: 'id,run_id,attempt_number,model,route,finish_reason,hard_blockers,failure_reasons',
    scope: 'publish',
  },
  {
    key: 'model_price_catalog_v4',
    table: 'ai_model_price_catalog',
    columns: 'id,provider,model,pricing_version,pricing_tier,effective_from',
    scope: 'publish',
  },
  {
    key: 'ai_budget_reservations_v4',
    table: 'blog_ai_budget_reservations',
    columns: 'id,budget_day_kst,queue_id,attempt_number,provider,model,cap_usd,reserved_usd,actual_usd,status',
    scope: 'publish',
  },
  {
    key: 'publication_rollout_state_v1',
    table: 'blog_publication_rollout_state',
    columns: 'scope,stage,status,healthy_window_streak,unhealthy_window_streak,state_version',
    scope: 'publish',
  },
  {
    key: 'publication_rollout_evaluations_v1',
    table: 'blog_publication_rollout_evaluations',
    columns: 'id,scope,window_key,decision,observation_complete,severe_incident',
    scope: 'publish',
  },
  {
    key: 'demand_signals',
    table: 'blog_demand_signals',
    columns: 'id,queue_id,provider,signal_value,source_reference,verified_at,expires_at',
    scope: 'publish',
  },
  {
    key: 'keyword_families',
    table: 'blog_keyword_families',
    columns: 'id,family_key,canonical_keyword,status',
    scope: 'publish',
  },
  {
    key: 'keyword_family_members',
    table: 'blog_keyword_family_members',
    columns: 'family_id,keyword,role,source,score',
    scope: 'publish',
  },
  { key: 'content_signatures', table: 'blog_content_signatures', columns: 'id', scope: 'publish' },
  {
    key: 'publishing_policy_v4',
    table: 'publishing_policies',
    columns: 'scope,enabled,posts_per_day,slot_times',
    scope: 'publish',
  },
  { key: 'claim_ledger', table: 'blog_information_claim_ledger_v3', columns: 'claim_id', scope: 'publish' },
  { key: 'author_profiles', table: 'blog_author_profiles', columns: 'id', scope: 'delivery' },
  { key: 'media_assets', table: 'blog_media_assets', columns: 'id', scope: 'delivery' },
  { key: 'content_media', table: 'blog_content_media', columns: 'creative_id', scope: 'delivery' },
  { key: 'public_snapshots', table: 'blog_public_snapshots', columns: 'creative_id,is_current', scope: 'delivery' },
  { key: 'public_snapshot_history', table: 'blog_public_snapshot_history', columns: 'id', scope: 'delivery' },
  { key: 'public_catalog_facets', table: 'blog_public_catalog_facets', columns: 'facet_type,facet_key', scope: 'delivery' },
  {
    key: 'indexing_reports_lifecycle_v4',
    table: 'indexing_reports',
    columns: 'id,url,search_lifecycle_status,provider_receipt_status,classification_version,provider_raw_response,pipeline_version,deployment_commit_sha,schema_migration_version',
    scope: 'delivery',
  },
  {
    key: 'visibility_lifecycle_v4',
    table: 'blog_visibility_snapshots',
    columns: 'id,content_creative_id,search_lifecycle_status,provider_receipt_status,classification_version,pipeline_version,deployment_commit_sha,schema_migration_version',
    scope: 'delivery',
  },
  {
    key: 'classification_revisions_v4',
    table: 'blog_indexing_classification_revisions',
    columns: 'id,indexing_report_id,search_lifecycle_status,provider_receipt_status,classification_version',
    scope: 'delivery',
  },
  {
    key: 'search_followups_v4',
    table: 'blog_search_followup_jobs',
    columns: 'id,content_creative_id,milestone_days,due_at,status,attempt_count,next_attempt_at,result',
    scope: 'delivery',
  },
  {
    key: 'search_correction_queue_v4',
    table: 'blog_search_correction_queue',
    columns: 'id,content_creative_id,followup_job_id,correction_type,status',
    scope: 'delivery',
  },
  {
    key: 'seo_audit_runs_v4',
    table: 'blog_seo_audit_runs',
    columns: 'id,audit_key,audit_version,scope,status,pipeline_version,deployment_commit_sha,schema_migration_version',
    scope: 'measurement',
  },
  {
    key: 'seo_observations_v4',
    table: 'blog_seo_observations',
    columns: 'id,run_id,content_creative_id,slug,url,http_status,canonical_url,robots_directive,render_hash,metadata_hash',
    scope: 'measurement',
  },
  {
    key: 'seo_audit_findings_v4',
    table: 'blog_seo_audit_findings',
    columns: 'id,run_id,category,severity,code,action,fingerprint,evidence',
    scope: 'measurement',
  },
  {
    key: 'adapter_benchmarks_v4',
    table: 'blog_adapter_benchmarks',
    columns: 'id,adapter,adapter_version,benchmark_version,sample_size,extraction_success_count,factual_fidelity_count,ssrf_security_passed,latency_p95_ms,precision,recall,passed',
    scope: 'publish',
  },
  { key: 'search_performance', table: 'blog_search_performance', columns: 'id', scope: 'measurement' },
  { key: 'analytics_outbox', table: 'analytics_server_event_outbox', columns: 'id,status', scope: 'measurement' },
  {
    key: 'engagement_dimensions',
    table: 'blog_engagement_logs',
    columns: 'id,route,device,connection_type,navigation_type,consent_state,search_query_hash',
    scope: 'measurement',
  },
  {
    key: 'rum_dimensions',
    table: 'web_vitals',
    columns: 'id,route,device,connection_type,navigation_type,consent_state',
    scope: 'measurement',
  },
  {
    key: 'server_event_attribution',
    table: 'analytics_server_events',
    columns: 'id,assisting_content_creative_id,search_query_hash',
    scope: 'measurement',
  },
] as const;

export async function probeBlogRuntimeSchemaReadinessV3(
  probe: (resource: BlogRuntimeResourceV3) => Promise<BlogRuntimeProbeResultV3>,
  checkedAt = new Date(),
  resources: readonly BlogRuntimeResourceV3[] = BLOG_RUNTIME_RESOURCES_V3,
): Promise<BlogRuntimeSchemaReadinessV3> {
  const checks = await Promise.all(resources.map(async (resource) => {
    try {
      const result = await probe(resource);
      const error = result.error ?? null;
      return {
        ...resource,
        ready: !error,
        errorCode: error?.code ? String(error.code) : null,
        errorMessage: error?.message ? String(error.message).slice(0, 300) : null,
      } satisfies BlogRuntimeResourceCheckV3;
    } catch (error) {
      return {
        ...resource,
        ready: false,
        errorCode: 'probe_exception',
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      } satisfies BlogRuntimeResourceCheckV3;
    }
  }));

  const scopeReady = (scope: BlogRuntimeReadinessScopeV3) => {
    const scoped = checks.filter((check) => check.scope === scope);
    return scoped.length > 0 && scoped.every((check) => check.ready);
  };
  const publishReady = scopeReady('publish');
  const deliveryReady = scopeReady('delivery');
  const measurementReady = scopeReady('measurement');

  return {
    version: 'blog-runtime-schema-v3',
    checkedAt: checkedAt.toISOString(),
    publishReady,
    deliveryReady,
    measurementReady,
    fullyReady: publishReady && deliveryReady && measurementReady,
    missing: checks.filter((check) => !check.ready).map((check) => check.key),
    checks,
  };
}

export async function probeBlogRuntimeSchemaWithSupabaseV3(
  client: {
    from: (table: string) => {
      select: (columns: string) => {
        limit: (count: number) => PromiseLike<BlogRuntimeProbeResultV3>;
      };
    };
  },
  checkedAt = new Date(),
  resources: readonly BlogRuntimeResourceV3[] = BLOG_RUNTIME_RESOURCES_V3,
): Promise<BlogRuntimeSchemaReadinessV3> {
  return probeBlogRuntimeSchemaReadinessV3(
    // PostgREST can return a successful HEAD response for a missing relation,
    // so schema readiness must execute a real, bounded row projection.
    (resource) => Promise.resolve(client.from(resource.table).select(resource.columns).limit(1)),
    checkedAt,
    resources,
  );
}
