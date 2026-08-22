-- The return column cluster_id is also a source column name. Qualify the
-- source column so PL/pgSQL does not resolve it as the output variable.
create or replace function public.materialize_blog_content_operation_v4(
  p_cluster jsonb,
  p_signal jsonb,
  p_operation jsonb
) returns table (
  cluster_id uuid,
  operation_id uuid,
  operation_created boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cluster public.blog_demand_clusters%rowtype;
  v_operation public.blog_content_operations%rowtype;
  v_existing_operation_id uuid;
  v_signal_provider text := nullif(btrim(p_signal ->> 'provider'), '');
  v_signal_hash text := lower(nullif(btrim(p_signal ->> 'source_row_hash'), ''));
  v_observed_at timestamptz := (p_signal ->> 'observed_at')::timestamptz;
  v_verified_at timestamptz := (p_signal ->> 'verified_at')::timestamptz;
  v_expires_at timestamptz := nullif(p_signal ->> 'expires_at', '')::timestamptz;
  v_idempotency_key text := nullif(btrim(p_operation ->> 'idempotency_key'), '');
  v_queue_id uuid := nullif(p_operation ->> 'queue_id', '')::uuid;
  v_signal_cluster_id uuid;
begin
  if nullif(btrim(p_cluster ->> 'cluster_key'), '') is null
    or nullif(btrim(p_cluster ->> 'normalized_query'), '') is null
    or v_signal_provider is null
    or v_signal_hash !~ '^[0-9a-f]{64}$'
    or v_observed_at is null
    or v_verified_at is null
    or v_idempotency_key is null then
    raise exception 'invalid_blog_content_materialization_payload';
  end if;
  if v_expires_at is not null and v_expires_at <= now() then
    raise exception 'expired_blog_demand_signal';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('blog-demand:' || (p_cluster ->> 'cluster_key'), 0));

  insert into public.blog_demand_clusters (
    cluster_key, normalized_query, primary_query, intent, destination_id,
    audience, locale, demand_score, risk_level, freshness_expires_at,
    representative_key, canonical_creative_id, decision, decision_reason,
    metadata, first_observed_at, last_observed_at, updated_at
  ) values (
    p_cluster ->> 'cluster_key', p_cluster ->> 'normalized_query', p_cluster ->> 'primary_query',
    p_cluster ->> 'intent', nullif(p_cluster ->> 'destination_id', ''),
    coalesce(nullif(p_cluster ->> 'audience', ''), 'general'),
    coalesce(nullif(p_cluster ->> 'locale', ''), 'ko-KR'),
    coalesce((p_cluster ->> 'demand_score')::numeric, 0),
    coalesce(nullif(p_cluster ->> 'risk_level', ''), 'LOW'),
    nullif(p_cluster ->> 'freshness_expires_at', '')::timestamptz,
    nullif(p_cluster ->> 'representative_key', ''),
    nullif(p_cluster ->> 'canonical_creative_id', '')::uuid,
    p_cluster ->> 'decision', p_cluster ->> 'decision_reason',
    coalesce(p_cluster -> 'metadata', '{}'::jsonb), v_observed_at, v_observed_at, now()
  )
  on conflict (cluster_key) do update set
    primary_query = excluded.primary_query,
    demand_score = excluded.demand_score,
    risk_level = excluded.risk_level,
    freshness_expires_at = excluded.freshness_expires_at,
    representative_key = excluded.representative_key,
    canonical_creative_id = excluded.canonical_creative_id,
    decision = excluded.decision,
    decision_reason = excluded.decision_reason,
    metadata = public.blog_demand_clusters.metadata || excluded.metadata,
    last_observed_at = greatest(public.blog_demand_clusters.last_observed_at, excluded.last_observed_at),
    updated_at = now()
  returning * into v_cluster;

  insert into public.blog_demand_cluster_signals (
    cluster_id, provider, signal_key, source_reference, source_row_hash,
    metric_value, metrics, observed_at, expires_at, verified_at, verifier_type
  ) values (
    v_cluster.id, v_signal_provider, p_signal ->> 'signal_key',
    p_signal ->> 'source_reference', v_signal_hash,
    nullif(p_signal ->> 'metric_value', '')::numeric,
    coalesce(p_signal -> 'metrics', '{}'::jsonb), v_observed_at, v_expires_at,
    v_verified_at, coalesce(nullif(p_signal ->> 'verifier_type', ''), 'system')
  )
  on conflict (provider, source_row_hash) do nothing;

  select signals.cluster_id into v_signal_cluster_id
  from public.blog_demand_cluster_signals as signals
  where signals.provider = v_signal_provider and signals.source_row_hash = v_signal_hash;
  if v_signal_cluster_id is distinct from v_cluster.id then
    raise exception 'blog_demand_signal_cluster_conflict';
  end if;

  select id into v_existing_operation_id
  from public.blog_content_operations
  where idempotency_key = v_idempotency_key;
  if v_existing_operation_id is not null then
    return query select v_cluster.id, v_existing_operation_id, false;
    return;
  end if;

  insert into public.blog_content_operations (
    demand_cluster_id, operation_type, operation_day_kst, creates_new_url,
    risk_level, idempotency_key, workflow_version, queue_id, creative_id,
    representative_key, target_creative_id, package_id, package_snapshot_id, package_snapshot_revision,
    package_snapshot_hash, input_snapshot, status, current_stage, completed_at
  ) values (
    v_cluster.id, p_operation ->> 'operation_type',
    coalesce(nullif(p_operation ->> 'operation_day_kst', '')::date, (timezone('Asia/Seoul', now()))::date),
    coalesce((p_operation ->> 'creates_new_url')::boolean, false),
    coalesce(nullif(p_operation ->> 'risk_level', ''), v_cluster.risk_level),
    v_idempotency_key,
    coalesce(nullif(p_operation ->> 'workflow_version', ''), 'blog-content-operation-workflow-v1'),
    v_queue_id, nullif(p_operation ->> 'creative_id', '')::uuid,
    nullif(p_operation ->> 'representative_key', ''),
    nullif(p_operation ->> 'target_creative_id', '')::uuid,
    nullif(p_operation ->> 'package_id', '')::uuid,
    nullif(p_operation ->> 'package_snapshot_id', '')::uuid,
    nullif(p_operation ->> 'package_snapshot_revision', '')::bigint,
    nullif(p_operation ->> 'package_snapshot_hash', ''),
    coalesce(p_operation -> 'input_snapshot', '{}'::jsonb),
    case when v_cluster.decision = 'research_backlog' then 'research_backlog' else 'queued' end,
    case when v_cluster.decision = 'research_backlog' then 'research_backlog' else 'demand_verified' end,
    case when v_cluster.decision = 'research_backlog' then now() else null end
  ) returning * into v_operation;

  if v_queue_id is not null then
    insert into public.blog_demand_signals (
      queue_id, provider, signal_key, signal_value, source_reference,
      observed_at, expires_at, verified_at, metadata
    ) values (
      v_queue_id,
      case v_signal_provider
        when 'active_product' then 'active_product_question'
        when 'product_view' then 'active_product_question'
        when 'product_inquiry' then 'active_product_question'
        else v_signal_provider
      end,
      p_signal ->> 'signal_key', nullif(p_signal ->> 'metric_value', '')::numeric,
      p_signal ->> 'source_reference', v_observed_at, v_expires_at, v_verified_at,
      jsonb_build_object('demand_cluster_id', v_cluster.id, 'source_row_hash', v_signal_hash)
    ) on conflict (provider, signal_key, source_reference) do update set
      signal_value = excluded.signal_value,
      observed_at = excluded.observed_at,
      expires_at = excluded.expires_at,
      verified_at = coalesce(excluded.verified_at, public.blog_demand_signals.verified_at),
      metadata = public.blog_demand_signals.metadata || excluded.metadata;
  end if;

  return query select v_cluster.id, v_operation.id, true;
end;
$$;
