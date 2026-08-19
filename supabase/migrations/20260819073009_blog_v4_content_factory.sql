-- Blog V4 durable content factory
--
-- Additive only. This migration does not enqueue, generate, publish, update, or
-- delete an existing article. The four ledgers are private service-role control
-- plane records. Existing queue, generation, representative, evidence, public
-- snapshot, and indexing tables remain authoritative domain records.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.blog_demand_clusters (
  id uuid primary key default gen_random_uuid(),
  cluster_key text not null unique,
  normalized_query text not null,
  primary_query text not null,
  intent text not null,
  destination_id text,
  audience text not null default 'general',
  locale text not null default 'ko-KR',
  demand_score numeric(8,3) not null default 0 check (demand_score >= 0),
  risk_level text not null default 'LOW' check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  freshness_expires_at timestamptz,
  representative_key text references public.blog_information_representatives(representative_key)
    on update cascade on delete restrict,
  canonical_creative_id uuid references public.content_creatives(id) on delete set null,
  decision text not null check (decision in (
    'new', 'refresh', 'commercial_companion', 'research_backlog'
  )),
  decision_reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_demand_clusters_key_not_blank check (btrim(cluster_key) <> ''),
  constraint blog_demand_clusters_query_not_blank check (
    btrim(normalized_query) <> '' and btrim(primary_query) <> '' and btrim(intent) <> ''
  ),
  constraint blog_demand_clusters_locale_format check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint blog_demand_clusters_observed_order check (last_observed_at >= first_observed_at),
  constraint blog_demand_clusters_refresh_target check (
    decision <> 'refresh' or canonical_creative_id is not null
  )
);

create table if not exists public.blog_demand_cluster_signals (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.blog_demand_clusters(id) on delete cascade,
  provider text not null check (provider in (
    'google_search_console', 'naver_search_advisor', 'customer_question',
    'consultation_aggregate', 'active_product', 'active_product_question',
    'product_view', 'product_inquiry', 'operator_note', 'editor_seed',
    'search_volume', 'search_trend'
  )),
  signal_key text not null,
  source_reference text not null,
  source_row_hash char(64) not null,
  metric_value numeric,
  metrics jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  expires_at timestamptz,
  verified_at timestamptz not null,
  verifier_type text not null default 'system' check (verifier_type in ('system', 'operator', 'editor')),
  created_at timestamptz not null default now(),
  constraint blog_demand_cluster_signals_key_not_blank check (
    btrim(signal_key) <> '' and btrim(source_reference) <> ''
  ),
  constraint blog_demand_cluster_signals_hash_format check (source_row_hash ~ '^[0-9a-f]{64}$'),
  constraint blog_demand_cluster_signals_expiry_order check (
    expires_at is null or expires_at > observed_at
  ),
  unique (provider, source_row_hash)
);

create table if not exists public.blog_content_operations (
  id uuid primary key default gen_random_uuid(),
  demand_cluster_id uuid not null references public.blog_demand_clusters(id) on delete restrict,
  operation_type text not null check (operation_type in (
    'new_info', 'new_commercial', 'new_seasonal', 'material_refresh',
    'product_refresh', 'merge_review'
  )),
  operation_day_kst date not null default ((timezone('Asia/Seoul', now()))::date),
  publication_day_kst date,
  creates_new_url boolean not null default false,
  risk_level text not null check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  idempotency_key text not null unique,
  workflow_version text not null default 'blog-content-operation-workflow-v1',
  workflow_run_id text,
  queue_id uuid references public.blog_topic_queue(id) on delete set null,
  creative_id uuid references public.content_creatives(id) on delete set null,
  target_creative_id uuid references public.content_creatives(id) on delete restrict,
  representative_key text references public.blog_information_representatives(representative_key)
    on update cascade on delete restrict,
  generation_run_id uuid references public.blog_generation_runs(id) on delete set null,
  package_id uuid references public.travel_packages(id) on delete restrict,
  package_snapshot_id uuid references public.public_package_snapshots(id) on delete restrict,
  package_snapshot_revision bigint,
  package_snapshot_hash text,
  input_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'human_review', 'approved_for_slot', 'research_backlog',
    'quarantined', 'publishing', 'published', 'indexed', 'failed', 'cancelled'
  )),
  current_stage text not null default 'demand_verified' check (current_stage in (
    'demand_verified', 'brief_verified', 'research_ready', 'drafting', 'evaluating',
    'repairing', 'human_review', 'approved_for_slot', 'publishing', 'published',
    'indexed', 'research_backlog', 'quarantined', 'failed', 'cancelled'
  )),
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  skip_reason text,
  failure_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_content_operations_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint blog_content_operations_workflow_version_not_blank check (btrim(workflow_version) <> ''),
  constraint blog_content_operations_package_snapshot_complete check (
    (package_id is null and package_snapshot_id is null and package_snapshot_revision is null and package_snapshot_hash is null)
    or
    (package_id is not null and package_snapshot_id is not null and package_snapshot_revision is not null
      and nullif(btrim(package_snapshot_hash), '') is not null)
  ),
  constraint blog_content_operations_commercial_snapshot_required check (
    operation_type not in ('new_commercial', 'product_refresh') or package_snapshot_id is not null
  ),
  constraint blog_content_operations_refresh_target_required check (
    operation_type not in ('material_refresh', 'product_refresh') or target_creative_id is not null
  ),
  constraint blog_content_operations_terminal_time check (
    status not in ('research_backlog', 'quarantined', 'published', 'indexed', 'failed', 'cancelled')
    or completed_at is not null
  )
);

create table if not exists public.blog_content_stage_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.blog_content_operations(id) on delete restrict,
  event_key text not null,
  fencing_token bigint not null check (fencing_token > 0),
  stage text not null,
  status text not null check (status in ('started', 'succeeded', 'retryable_failure', 'failed', 'skipped')),
  failure_code text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  provider text check (provider is null or provider = 'deepseek'),
  model text,
  attempt_number integer check (attempt_number is null or attempt_number between 1 and 5),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  cached_input_tokens bigint check (cached_input_tokens is null or cached_input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  estimated_cost_usd numeric(14,8) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint blog_content_stage_events_key_not_blank check (btrim(event_key) <> '' and btrim(stage) <> ''),
  unique (operation_id, event_key)
);

create index if not exists idx_blog_demand_clusters_decision_score
  on public.blog_demand_clusters(decision, demand_score desc, last_observed_at desc);
create index if not exists idx_blog_demand_clusters_representative
  on public.blog_demand_clusters(representative_key) where representative_key is not null;
create index if not exists idx_blog_demand_clusters_canonical_creative
  on public.blog_demand_clusters(canonical_creative_id) where canonical_creative_id is not null;
create index if not exists idx_blog_demand_cluster_signals_cluster_fresh
  on public.blog_demand_cluster_signals(cluster_id, observed_at desc, expires_at);
create index if not exists idx_blog_content_operations_inventory
  on public.blog_content_operations(status, operation_day_kst, created_at);
create index if not exists idx_blog_content_operations_publication_day
  on public.blog_content_operations(publication_day_kst, status, created_at)
  where publication_day_kst is not null;
create index if not exists idx_blog_content_operations_stage
  on public.blog_content_operations(current_stage, updated_at desc);
create index if not exists idx_blog_content_operations_generation_run
  on public.blog_content_operations(generation_run_id) where generation_run_id is not null;
create index if not exists idx_blog_content_operations_demand_cluster
  on public.blog_content_operations(demand_cluster_id);
create index if not exists idx_blog_content_operations_queue
  on public.blog_content_operations(queue_id) where queue_id is not null;
create index if not exists idx_blog_content_operations_creative
  on public.blog_content_operations(creative_id) where creative_id is not null;
create index if not exists idx_blog_content_operations_target_creative
  on public.blog_content_operations(target_creative_id) where target_creative_id is not null;
create index if not exists idx_blog_content_operations_representative
  on public.blog_content_operations(representative_key) where representative_key is not null;
create index if not exists idx_blog_content_operations_package
  on public.blog_content_operations(package_id) where package_id is not null;
create index if not exists idx_blog_content_operations_package_snapshot
  on public.blog_content_operations(package_snapshot_id) where package_snapshot_id is not null;
create index if not exists idx_blog_content_stage_events_operation_time
  on public.blog_content_stage_events(operation_id, occurred_at, created_at);

alter table public.blog_demand_clusters enable row level security;
alter table public.blog_demand_cluster_signals enable row level security;
alter table public.blog_content_operations enable row level security;
alter table public.blog_content_stage_events enable row level security;

revoke all on table
  public.blog_demand_clusters,
  public.blog_demand_cluster_signals,
  public.blog_content_operations,
  public.blog_content_stage_events
from public, anon, authenticated;

grant select, insert, update on table
  public.blog_demand_clusters,
  public.blog_demand_cluster_signals,
  public.blog_content_operations
to service_role;
grant select, insert on table public.blog_content_stage_events to service_role;

create policy blog_demand_clusters_service_role_all
  on public.blog_demand_clusters for all to service_role using (true) with check (true);
create policy blog_demand_cluster_signals_service_role_all
  on public.blog_demand_cluster_signals for all to service_role using (true) with check (true);
create policy blog_content_operations_service_role_all
  on public.blog_content_operations for all to service_role using (true) with check (true);
create policy blog_content_stage_events_service_role_select
  on public.blog_content_stage_events for select to service_role using (true);
create policy blog_content_stage_events_service_role_insert
  on public.blog_content_stage_events for insert to service_role with check (true);

create or replace function public.prevent_blog_content_stage_event_mutation_v4()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'blog_content_stage_events_append_only';
end;
$$;

drop trigger if exists trg_blog_content_stage_events_append_only on public.blog_content_stage_events;
create trigger trg_blog_content_stage_events_append_only
before update or delete on public.blog_content_stage_events
for each row execute function public.prevent_blog_content_stage_event_mutation_v4();

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

  select cluster_id into v_signal_cluster_id
  from public.blog_demand_cluster_signals
  where provider = v_signal_provider and source_row_hash = v_signal_hash;
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

create or replace function public.claim_blog_content_operation_v4(
  p_operation_id uuid,
  p_lease_owner text,
  p_lease_seconds integer default 300
) returns public.blog_content_operations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.blog_content_operations%rowtype;
begin
  if nullif(btrim(p_lease_owner), '') is null or p_lease_seconds not between 30 and 1800 then
    raise exception 'invalid_blog_content_operation_lease';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('blog-operation:' || p_operation_id::text, 0));
  select * into v_operation
  from public.blog_content_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null then raise exception 'blog_content_operation_not_claimable'; end if;
  if v_operation.status = 'running'
    and v_operation.lease_owner = p_lease_owner
    and v_operation.lease_expires_at >= now() then
    return v_operation;
  end if;
  update public.blog_content_operations
  set status = 'running',
      fencing_token = fencing_token + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = p_operation_id
    and status in ('queued', 'running')
    and (status = 'queued' or lease_expires_at is null or lease_expires_at < now())
  returning * into v_operation;
  if v_operation.id is null then raise exception 'blog_content_operation_not_claimable'; end if;
  return v_operation;
end;
$$;

create or replace function public.bind_blog_content_operation_workflow_v4(
  p_operation_id uuid,
  p_fencing_token bigint,
  p_lease_owner text,
  p_workflow_run_id text
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_updated uuid;
begin
  if nullif(btrim(p_workflow_run_id), '') is null then raise exception 'invalid_workflow_run_id'; end if;
  update public.blog_content_operations
  set workflow_run_id = p_workflow_run_id, updated_at = now()
  where id = p_operation_id and fencing_token = p_fencing_token
    and lease_owner = p_lease_owner and status = 'running'
  returning id into v_updated;
  if v_updated is null then raise exception 'blog_content_operation_fencing_conflict'; end if;
  return true;
end;
$$;

create or replace function public.claim_blog_content_operation_publication_v4(
  p_operation_id uuid,
  p_lease_owner text,
  p_operation_day_kst date,
  p_max_operations integer,
  p_max_new_urls integer,
  p_lease_seconds integer default 180
) returns public.blog_content_operations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.blog_content_operations%rowtype;
  v_run public.blog_generation_runs%rowtype;
  v_publishing_count integer;
  v_new_url_count integer;
begin
  if nullif(btrim(p_lease_owner), '') is null
    or p_max_operations not between 0 and 30
    or p_max_new_urls not between 0 and 18
    or p_lease_seconds not between 30 and 600 then
    raise exception 'invalid_blog_content_publication_lease';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('blog-publication-day:' || p_operation_day_kst::text, 0));
  select * into v_operation from public.blog_content_operations
  where id = p_operation_id for update;
  if v_operation.id is null or v_operation.status <> 'approved_for_slot'
    or p_operation_day_kst <> (timezone('Asia/Seoul', now()))::date then
    raise exception 'blog_content_operation_not_publication_claimable';
  end if;
  select * into v_run from public.blog_generation_runs
  where id = v_operation.generation_run_id for update;
  if v_run.id is null or v_run.status <> 'approved_for_slot'
    or v_run.selected_attempt_id is null
    or v_run.content_creative_id is null
    or coalesce(v_run.latest_quality_score, 0) < 90
    or (v_run.scheduled_publish_at is not null and v_run.scheduled_publish_at > now()) then
    raise exception 'blog_content_operation_generation_run_not_claimable';
  end if;
  select count(*), count(*) filter (where creates_new_url)
  into v_publishing_count, v_new_url_count
  from public.blog_content_operations
  where publication_day_kst = p_operation_day_kst
    and status in ('publishing', 'published', 'indexed');
  if v_publishing_count >= p_max_operations then raise exception 'blog_content_operation_daily_cap_reached'; end if;
  if v_operation.creates_new_url and v_new_url_count >= p_max_new_urls then
    raise exception 'blog_content_operation_new_url_cap_reached';
  end if;
  update public.blog_generation_runs
  set status = 'publishing', lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = v_run.id and status = 'approved_for_slot';
  if not found then raise exception 'blog_content_operation_generation_run_claim_race'; end if;
  update public.blog_content_operations
  set status = 'publishing', current_stage = 'publishing',
      publication_day_kst = p_operation_day_kst,
      fencing_token = fencing_token + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      completed_at = null,
      updated_at = now()
  where id = p_operation_id
  returning * into v_operation;
  return v_operation;
end;
$$;

create or replace function public.record_blog_content_stage_event_v4(
  p_operation_id uuid,
  p_fencing_token bigint,
  p_lease_owner text,
  p_event jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.blog_content_operations%rowtype;
  v_event_id uuid;
  v_event_status text := p_event ->> 'status';
  v_next_status text := nullif(p_event ->> 'operation_status', '');
  v_next_stage text := p_event ->> 'stage';
begin
  select * into v_operation from public.blog_content_operations
  where id = p_operation_id for update;
  if v_operation.id is null or v_operation.fencing_token <> p_fencing_token then
    raise exception 'blog_content_operation_fencing_conflict';
  end if;
  select id into v_event_id from public.blog_content_stage_events
  where operation_id = p_operation_id and event_key = p_event ->> 'event_key';
  if v_event_id is not null then
    if v_operation.status in ('running', 'publishing') then
      if v_operation.lease_owner is distinct from p_lease_owner then
        raise exception 'blog_content_operation_fencing_conflict';
      end if;
      update public.blog_content_operations
      set lease_expires_at = now() + interval '15 minutes', updated_at = now()
      where id = p_operation_id and fencing_token = p_fencing_token;
    end if;
    return v_event_id;
  end if;
  if v_operation.lease_owner is distinct from p_lease_owner
    or v_operation.status not in ('running', 'publishing') then
    raise exception 'blog_content_operation_fencing_conflict';
  end if;

  insert into public.blog_content_stage_events (
    operation_id, event_key, fencing_token, stage, status, failure_code,
    duration_ms, provider, model, attempt_number, input_tokens,
    cached_input_tokens, output_tokens, estimated_cost_usd, evidence, occurred_at
  ) values (
    p_operation_id, p_event ->> 'event_key', p_fencing_token, v_next_stage,
    v_event_status, nullif(p_event ->> 'failure_code', ''),
    nullif(p_event ->> 'duration_ms', '')::integer,
    nullif(p_event ->> 'provider', ''), nullif(p_event ->> 'model', ''),
    nullif(p_event ->> 'attempt_number', '')::integer,
    nullif(p_event ->> 'input_tokens', '')::bigint,
    nullif(p_event ->> 'cached_input_tokens', '')::bigint,
    nullif(p_event ->> 'output_tokens', '')::bigint,
    nullif(p_event ->> 'estimated_cost_usd', '')::numeric,
    coalesce(p_event -> 'evidence', '{}'::jsonb),
    coalesce(nullif(p_event ->> 'occurred_at', '')::timestamptz, now())
  ) on conflict (operation_id, event_key) do nothing returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id from public.blog_content_stage_events
    where operation_id = p_operation_id and event_key = p_event ->> 'event_key';
  else
    update public.blog_content_operations
    set current_stage = v_next_stage,
        status = coalesce(v_next_status, status),
        failure_code = coalesce(nullif(p_event ->> 'failure_code', ''), failure_code),
        skip_reason = coalesce(nullif(p_event ->> 'skip_reason', ''), skip_reason),
        generation_run_id = coalesce(nullif(p_event ->> 'generation_run_id', '')::uuid, generation_run_id),
        creative_id = coalesce(nullif(p_event ->> 'creative_id', '')::uuid, creative_id),
        lease_expires_at = case
          when coalesce(v_next_status, status) in ('human_review', 'approved_for_slot', 'research_backlog', 'quarantined', 'published', 'indexed', 'failed', 'cancelled') then null
          else now() + interval '15 minutes'
        end,
        lease_owner = case
          when coalesce(v_next_status, status) in ('human_review', 'approved_for_slot', 'research_backlog', 'quarantined', 'published', 'indexed', 'failed', 'cancelled') then null
          else lease_owner
        end,
        completed_at = case
          when coalesce(v_next_status, status) in ('human_review', 'approved_for_slot', 'research_backlog', 'quarantined', 'published', 'indexed', 'failed', 'cancelled') then now()
          else completed_at
        end,
        updated_at = now()
    where id = p_operation_id;
  end if;
  return v_event_id;
end;
$$;

create or replace function public.publish_blog_commercial_operation_v4(
  p_operation_id uuid,
  p_fencing_token bigint,
  p_lease_owner text,
  p_generation_run_id uuid,
  p_selected_attempt_id uuid,
  p_creative_id uuid,
  p_publication_mode text,
  p_published_at timestamptz default now()
) returns table (
  creative_id uuid,
  slug text,
  published_at timestamptz,
  indexing_job_id uuid,
  idempotent boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.blog_content_operations%rowtype;
  v_run public.blog_generation_runs%rowtype;
  v_attempt public.blog_generation_attempts%rowtype;
  v_creative public.content_creatives%rowtype;
  v_target public.content_creatives%rowtype;
  v_pointer public.product_registration_v5_publication_pointers%rowtype;
  v_snapshot public.public_package_snapshots%rowtype;
  v_job_id uuid;
  v_event_id uuid;
  v_url text;
  v_published_creative_id uuid;
  v_published_slug text;
  v_effective_published_at timestamptz;
  v_now timestamptz := coalesce(p_published_at, now());
  v_idempotency_key text := 'content-operation-publish-v4:' || p_operation_id::text;
begin
  if nullif(btrim(p_lease_owner), '') is null
    or p_publication_mode not in ('reviewed_only', 'live') then
    raise exception 'invalid_blog_commercial_publication_contract';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('blog-operation:' || p_operation_id::text, 0));
  select * into v_operation
  from public.blog_content_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    raise exception 'blog_content_operation_missing';
  end if;

  if v_operation.status in ('published', 'indexed') then
    select * into v_creative from public.content_creatives where id = v_operation.creative_id;
    select id into v_job_id from public.blog_indexing_jobs
    where idempotency_key = v_idempotency_key
    order by created_at desc limit 1;
    if v_creative.id is null or v_creative.status <> 'published' or v_job_id is null then
      raise exception 'blog_commercial_publication_idempotency_state_invalid';
    end if;
    return query select v_creative.id, v_creative.slug, v_creative.published_at, v_job_id, true;
    return;
  end if;

  if v_operation.status <> 'publishing'
    or v_operation.operation_type not in ('new_commercial', 'product_refresh')
    or v_operation.fencing_token <> p_fencing_token
    or v_operation.lease_owner is distinct from p_lease_owner
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at < now()
    or v_operation.generation_run_id is distinct from p_generation_run_id
    or v_operation.creative_id is distinct from p_creative_id
    or v_operation.package_id is null
    or v_operation.package_snapshot_id is null then
    raise exception 'blog_commercial_publication_fencing_or_lineage_invalid';
  end if;

  select * into v_pointer
  from public.product_registration_v5_publication_pointers
  where package_id = v_operation.package_id and channel = 'customer' and locale = 'ko-KR'
  for share;
  select * into v_snapshot
  from public.public_package_snapshots
  where id = v_operation.package_snapshot_id
  for share;
  if v_pointer.package_id is null or v_snapshot.id is null
    or v_pointer.state not in ('approved', 'published')
    or v_snapshot.status not in ('approved', 'published')
    or v_pointer.current_snapshot_id is distinct from v_operation.package_snapshot_id
    or v_snapshot.package_id is distinct from v_operation.package_id
    or v_snapshot.package_revision is distinct from v_operation.package_snapshot_revision
    or v_snapshot.snapshot_hash is distinct from v_operation.package_snapshot_hash then
    raise exception 'blog_commercial_package_snapshot_stale';
  end if;

  select * into v_run from public.blog_generation_runs
  where id = p_generation_run_id for update;
  select * into v_attempt from public.blog_generation_attempts
  where id = p_selected_attempt_id and run_id = p_generation_run_id;
  if v_run.id is null or v_run.status <> 'publishing'
    or v_run.selected_attempt_id is distinct from p_selected_attempt_id
    or v_run.content_creative_id is distinct from p_creative_id
    or coalesce(v_run.latest_quality_score, 0) < 90
    or v_attempt.id is null or v_attempt.status <> 'completed'
    or v_attempt.route <> 'approved_for_slot'
    or coalesce(v_attempt.quality_score_after, 0) < 90
    or jsonb_array_length(coalesce(v_attempt.hard_blockers, '[]'::jsonb)) <> 0
    or jsonb_array_length(coalesce(v_attempt.failure_reasons, '[]'::jsonb)) <> 0 then
    raise exception 'blog_commercial_selected_attempt_not_publishable';
  end if;

  select * into v_creative from public.content_creatives
  where id = p_creative_id for update;
  if v_creative.id is null or v_creative.status <> 'draft'
    or v_creative.channel <> 'naver_blog'
    or nullif(btrim(v_creative.slug), '') is null
    or v_creative.product_id is distinct from v_operation.package_id
    or coalesce(v_creative.quality_gate ->> 'passed', 'false') <> 'true'
    or coalesce(v_creative.review_status, 'none') in ('pending_review', 'in_review', 'rejected', 'changes_requested')
    or (p_publication_mode = 'reviewed_only' and coalesce(v_creative.review_status, 'none') <> 'approved')
    or (v_operation.risk_level = 'HIGH' and coalesce(v_creative.review_status, 'none') <> 'approved')
    or coalesce(v_creative.generation_meta ->> 'noindex', 'false') = 'true'
    or coalesce(v_creative.generation_meta -> 'seo' ->> 'noindex', 'false') = 'true'
    or nullif(btrim(coalesce(v_creative.generation_meta ->> 'redirect_to', '')), '') is not null
    or nullif(btrim(coalesce(v_creative.generation_meta ->> 'redirectTo', '')), '') is not null
    or nullif(btrim(coalesce(v_creative.generation_meta ->> 'canonical_redirect_to', '')), '') is not null then
    raise exception 'blog_commercial_creative_not_public_eligible';
  end if;

  if v_operation.operation_type = 'product_refresh' then
    select * into v_target from public.content_creatives
    where id = v_operation.target_creative_id for update;
    if v_target.id is null or v_target.status <> 'published'
      or v_target.product_id is distinct from v_operation.package_id
      or v_target.channel <> 'naver_blog'
      or nullif(btrim(v_target.slug), '') is null then
      raise exception 'blog_commercial_refresh_target_not_publishable';
    end if;
    update public.content_creatives
    set blog_html = v_creative.blog_html,
        title = v_creative.title,
        description = v_creative.description,
        seo_title = v_creative.seo_title,
        seo_description = v_creative.seo_description,
        og_image_url = v_creative.og_image_url,
        category = v_creative.category,
        angle_type = v_creative.angle_type,
        content_type = v_creative.content_type,
        topic_source = v_creative.topic_source,
        destination = v_creative.destination,
        quality_gate = v_creative.quality_gate,
        seo_score = v_creative.seo_score,
        readability_score = v_creative.readability_score,
        readability_issues = v_creative.readability_issues,
        landing_enabled = v_creative.landing_enabled,
        target_ad_keywords = v_creative.target_ad_keywords,
        review_status = v_creative.review_status,
        generation_meta = coalesce(v_creative.generation_meta, '{}'::jsonb)
          || jsonb_build_object('commercial_product_refresh', jsonb_build_object(
            'operation_id', p_operation_id,
            'replacement_draft_id', p_creative_id,
            'package_snapshot_id', v_operation.package_snapshot_id,
            'package_snapshot_hash', v_operation.package_snapshot_hash,
            'applied_at', v_now
          )),
        content_modified_at = v_now,
        material_update_reason = 'immutable_product_snapshot_refresh',
        updated_at = now()
    where id = v_target.id and status = 'published';
    if not found then raise exception 'blog_commercial_refresh_target_race'; end if;

    update public.content_creatives
    set status = 'archived', published_at = null,
        generation_meta = coalesce(generation_meta, '{}'::jsonb)
          || jsonb_build_object('commercial_product_refresh', jsonb_build_object(
            'operation_id', p_operation_id,
            'target_creative_id', v_target.id,
            'canonical_slug', v_target.slug,
            'applied_at', v_now
          )),
        updated_at = now()
    where id = p_creative_id and status = 'draft';
    if not found then raise exception 'blog_commercial_refresh_draft_archive_race'; end if;
    v_published_creative_id := v_target.id;
    v_published_slug := v_target.slug;
    v_effective_published_at := coalesce(v_target.published_at, v_now);
  else
    update public.content_creatives
    set status = 'published', published_at = v_now,
        content_modified_at = coalesce(content_modified_at, v_now), updated_at = now()
    where id = p_creative_id and status = 'draft';
    if not found then raise exception 'blog_commercial_draft_promotion_race'; end if;
    v_published_creative_id := p_creative_id;
    v_published_slug := v_creative.slug;
    v_effective_published_at := v_now;
  end if;

  v_url := concat('https://www.yeosonam.com/blog/', v_published_slug);
  insert into public.blog_indexing_jobs (
    content_creative_id, slug, url, source, type, status,
    next_attempt_at, updated_at, idempotency_key
  ) values (
    v_published_creative_id, v_published_slug, v_url, 'content_factory_commercial_atomic_publish',
    'URL_UPDATED', 'pending', now(), now(), v_idempotency_key
  ) on conflict do nothing returning id into v_job_id;
  if v_job_id is null then
    select id into v_job_id from public.blog_indexing_jobs
    where idempotency_key = v_idempotency_key
      or (url = v_url and type = 'URL_UPDATED' and status in ('pending', 'retry', 'processing'))
    order by case when idempotency_key = v_idempotency_key then 0 else 1 end, created_at desc
    limit 1 for update;
  end if;
  if v_job_id is null then raise exception 'blog_commercial_indexing_outbox_failed'; end if;

  insert into public.blog_content_stage_events (
    operation_id, event_key, fencing_token, stage, status, evidence
  ) values (
    p_operation_id, 'publication:commercial-atomic:v1', p_fencing_token,
    'published', 'succeeded', jsonb_build_object(
      'creative_id', v_published_creative_id,
      'generation_run_id', p_generation_run_id,
      'selected_attempt_id', p_selected_attempt_id,
      'indexing_job_id', v_job_id,
      'package_snapshot_id', v_operation.package_snapshot_id,
      'package_snapshot_hash', v_operation.package_snapshot_hash
    )
  ) on conflict (operation_id, event_key) do nothing returning id into v_event_id;
  if v_event_id is null then raise exception 'blog_commercial_publication_event_conflict'; end if;

  update public.blog_content_operations
  set status = 'published', current_stage = 'published', creative_id = v_published_creative_id,
      lease_owner = null, lease_expires_at = null, completed_at = now(), updated_at = now()
  where id = p_operation_id and status = 'publishing'
    and fencing_token = p_fencing_token and lease_owner = p_lease_owner;
  if not found then raise exception 'blog_commercial_operation_publication_race'; end if;

  update public.blog_generation_runs
  set status = 'published', disposition = case
        when v_operation.operation_type = 'product_refresh' then 'published_product_refresh'
        else 'published'
      end,
      content_creative_id = v_published_creative_id, published_at = v_now,
      last_error = null, lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = p_generation_run_id and status = 'publishing';
  if not found then raise exception 'blog_commercial_generation_run_publication_race'; end if;

  update public.blog_topic_queue
  set status = 'published', last_error = null, attempts = 0, content_creative_id = v_published_creative_id
  where id = v_run.queue_id;
  if not found then raise exception 'blog_commercial_queue_publication_race'; end if;

  return query select v_published_creative_id, v_published_slug, v_effective_published_at, v_job_id, false;
end;
$$;

create or replace function public.mark_blog_content_operation_indexed_v4(
  p_indexing_job_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.blog_indexing_jobs%rowtype;
  v_operation public.blog_content_operations%rowtype;
begin
  select * into v_job from public.blog_indexing_jobs
  where id = p_indexing_job_id and status = 'succeeded';
  if v_job.id is null or v_job.content_creative_id is null then return false; end if;

  select * into v_operation from public.blog_content_operations
  where creative_id = v_job.content_creative_id and status in ('published', 'indexed')
  order by completed_at desc nulls last, created_at desc limit 1 for update;
  if v_operation.id is null then return false; end if;
  if v_operation.status = 'indexed' then return true; end if;

  insert into public.blog_content_stage_events (
    operation_id, event_key, fencing_token, stage, status, evidence
  ) values (
    v_operation.id, 'indexing:succeeded:' || p_indexing_job_id::text,
    v_operation.fencing_token, 'indexed', 'succeeded',
    jsonb_build_object('indexing_job_id', p_indexing_job_id, 'url', v_job.url)
  ) on conflict (operation_id, event_key) do nothing;

  update public.blog_content_operations
  set status = 'indexed', current_stage = 'indexed', completed_at = now(), updated_at = now()
  where id = v_operation.id and status = 'published';
  return true;
end;
$$;

revoke all on function public.materialize_blog_content_operation_v4(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.claim_blog_content_operation_v4(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.bind_blog_content_operation_workflow_v4(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.claim_blog_content_operation_publication_v4(uuid, text, date, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.record_blog_content_stage_event_v4(uuid, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.publish_blog_commercial_operation_v4(uuid, bigint, text, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_blog_content_operation_indexed_v4(uuid) from public, anon, authenticated;
grant execute on function public.materialize_blog_content_operation_v4(jsonb, jsonb, jsonb) to service_role;
grant execute on function public.claim_blog_content_operation_v4(uuid, text, integer) to service_role;
grant execute on function public.bind_blog_content_operation_workflow_v4(uuid, bigint, text, text) to service_role;
grant execute on function public.claim_blog_content_operation_publication_v4(uuid, text, date, integer, integer, integer) to service_role;
grant execute on function public.record_blog_content_stage_event_v4(uuid, bigint, text, jsonb) to service_role;
grant execute on function public.publish_blog_commercial_operation_v4(uuid, bigint, text, uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.mark_blog_content_operation_indexed_v4(uuid) to service_role;

comment on table public.blog_demand_clusters is
  'Canonical query-intent demand inventory derived only from observed, verifiable signals.';
comment on table public.blog_demand_cluster_signals is
  'Observed GSC, Naver, customer, product, operator, editor, volume, or trend evidence. No inferred volume.';
comment on table public.blog_content_operations is
  'Single durable ledger for new, refresh, commercial, seasonal, product-refresh, and merge-review work.';
comment on table public.blog_content_stage_events is
  'Append-only workflow stage, failure, latency, token, and cost evidence. Full competitor/source bodies are prohibited.';

commit;

-- Read-only pre-apply / post-apply checks:
-- select to_regclass('public.blog_demand_clusters'), to_regclass('public.blog_content_operations');
-- select table_name, row_security_active(format('public.%I', table_name)::regclass)
-- from information_schema.tables
-- where table_schema = 'public' and table_name in (
--   'blog_demand_clusters','blog_demand_cluster_signals','blog_content_operations','blog_content_stage_events'
-- );
-- select status, current_stage, count(*) from public.blog_content_operations group by 1,2 order by 1,2;
-- select count(*) from public.blog_content_operations where status in ('queued','running','publishing');

-- Rollback SQL (manual only, after application rollback and only when the last
-- query above returns 0; evidence export is required before dropping ledgers):
-- begin;
-- drop function if exists public.record_blog_content_stage_event_v4(uuid,bigint,text,jsonb);
-- drop function if exists public.mark_blog_content_operation_indexed_v4(uuid);
-- drop function if exists public.publish_blog_commercial_operation_v4(uuid,bigint,text,uuid,uuid,uuid,text,timestamptz);
-- drop function if exists public.bind_blog_content_operation_workflow_v4(uuid,bigint,text,text);
-- drop function if exists public.claim_blog_content_operation_publication_v4(uuid,text,date,integer,integer,integer);
-- drop function if exists public.claim_blog_content_operation_v4(uuid,text,integer);
-- drop function if exists public.materialize_blog_content_operation_v4(jsonb,jsonb,jsonb);
-- drop function if exists public.prevent_blog_content_stage_event_mutation_v4();
-- drop table if exists public.blog_content_stage_events;
-- drop table if exists public.blog_content_operations;
-- drop table if exists public.blog_demand_cluster_signals;
-- drop table if exists public.blog_demand_clusters;
-- commit;
