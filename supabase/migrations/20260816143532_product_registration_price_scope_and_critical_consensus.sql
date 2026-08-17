-- Commercial price scope and dual-provider consensus records are append-only.
-- No customer-facing fact is written by these tables; a verified consensus is
-- consumed by the canonical revision writer, which still replays source evidence.

alter table internal_product_registration.source_document_bundles
  add column if not exists coordinator_job_id uuid references public.upload_jobs(id) on delete restrict,
  add column if not exists coordinator_source_document_id uuid references public.product_source_documents(id) on delete restrict;

-- The original append-only guard predates coordinator lineage. Extend it in
-- the same forward migration so a service-role caller cannot later reassign
-- an eligible bundle to a different upload job or source document.
create or replace function internal_product_registration.protect_source_bundle_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_APPEND_ONLY';
  end if;
  if new.tenant_id is distinct from old.tenant_id
    or new.bundle_hash is distinct from old.bundle_hash
    or new.resolver_version is distinct from old.resolver_version
    or new.supplier_key is distinct from old.supplier_key
    or new.grouping_authority is distinct from old.grouping_authority
    or new.grouping_key is distinct from old.grouping_key
    or new.score is distinct from old.score
    or new.ambiguity_margin is distinct from old.ambiguity_margin
    or new.resolution_metadata is distinct from old.resolution_metadata
    or new.coordinator_job_id is distinct from old.coordinator_job_id
    or new.coordinator_source_document_id is distinct from old.coordinator_source_document_id
    or new.created_at is distinct from old.created_at then
    raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_CONTENT_IMMUTABLE';
  end if;
  if not (
    (old.state = 'shadow_candidate' and new.state in ('shadow_candidate', 'eligible', 'rejected', 'superseded'))
    or (old.state = 'eligible' and new.state in ('eligible', 'superseded'))
    or (old.state = new.state)
  ) then
    raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_STATE_TRANSITION_INVALID';
  end if;
  return new;
end;
$$;

create unique index if not exists uq_pr_source_bundle_coordinator_job
  on internal_product_registration.source_document_bundles(tenant_id, coordinator_job_id)
  where coordinator_job_id is not null;

create or replace function public.claim_product_registration_source_bundle(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_job_id uuid := nullif(p_payload->>'job_id', '')::uuid;
  v_source_document_id uuid := nullif(p_payload->>'source_document_id', '')::uuid;
  v_bundle_id uuid;
  v_coordinator_job_id uuid;
  v_member jsonb;
  v_inserted boolean := true;
  v_price_count integer := 0;
  v_itinerary_count integer := 0;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload->'members') is distinct from 'array'
    or p_payload->>'grouping_authority' <> 'upload_batch' then
    raise exception 'SOURCE_BUNDLE_PAYLOAD_INVALID';
  end if;
  if not exists (
    select 1 from public.upload_jobs j
    where j.id = v_job_id and j.tenant_id = v_tenant_id
      and j.source_document_id = v_source_document_id
  ) then raise exception 'SOURCE_BUNDLE_JOB_LINEAGE_MISMATCH'; end if;
  for v_member in select value from jsonb_array_elements(p_payload->'members') loop
    if v_member->>'document_role' = 'price_sheet' then v_price_count := v_price_count + 1; end if;
    if v_member->>'document_role' = 'itinerary_sheet' then v_itinerary_count := v_itinerary_count + 1; end if;
    if not exists (
      select 1 from public.product_source_documents s
      where s.id = (v_member->>'source_document_id')::uuid
        and s.tenant_id = v_tenant_id
        and s.sha256 = v_member->>'source_hash'
        and s.metadata->'sourceBatch'->>'id' = p_payload->>'grouping_key'
    ) then raise exception 'SOURCE_BUNDLE_MEMBER_LINEAGE_MISMATCH'; end if;
  end loop;
  if v_price_count <> 1 or v_itinerary_count <> 1 then
    raise exception 'SOURCE_BUNDLE_COMPLEMENTARY_ROLES_REQUIRED';
  end if;

  insert into internal_product_registration.source_document_bundles (
    tenant_id, bundle_hash, resolver_version, supplier_key,
    grouping_authority, grouping_key, score, ambiguity_margin,
    state, resolution_metadata, coordinator_job_id, coordinator_source_document_id
  ) values (
    v_tenant_id, p_payload->>'bundle_hash', p_payload->>'resolver_version',
    nullif(p_payload->>'supplier_key', ''), 'upload_batch', p_payload->>'grouping_key',
    (p_payload->>'score')::integer, (p_payload->>'ambiguity_margin')::integer,
    'shadow_candidate', coalesce(p_payload->'resolution_metadata', '{}'::jsonb),
    v_job_id, v_source_document_id
  ) on conflict (tenant_id, bundle_hash, resolver_version) do nothing
  returning id, coordinator_job_id into v_bundle_id, v_coordinator_job_id;

  if v_bundle_id is null then
    v_inserted := false;
    select b.id, b.coordinator_job_id into v_bundle_id, v_coordinator_job_id
    from internal_product_registration.source_document_bundles b
    where b.tenant_id = v_tenant_id
      and b.bundle_hash = p_payload->>'bundle_hash'
      and b.resolver_version = p_payload->>'resolver_version';
  else
    for v_member in select value from jsonb_array_elements(p_payload->'members') loop
      insert into internal_product_registration.source_document_bundle_members (
        tenant_id, bundle_id, source_document_id, source_hash, document_role, evidence_scope
      ) values (
        v_tenant_id, v_bundle_id, (v_member->>'source_document_id')::uuid,
        v_member->>'source_hash', v_member->>'document_role',
        coalesce(v_member->'evidence_scope', '{}'::jsonb)
      );
    end loop;
    insert into internal_product_registration.source_document_bundle_decisions (
      tenant_id, bundle_id, decision, decision_reason, policy_version
    ) values (
      v_tenant_id, v_bundle_id, 'eligible',
      'same upload batch and deterministic complementary identity agreement',
      p_payload->>'resolver_version'
    );
    update internal_product_registration.source_document_bundles
    set state = 'eligible'
    where id = v_bundle_id and tenant_id = v_tenant_id;
  end if;
  return jsonb_build_object(
    'id', v_bundle_id,
    'claimed', v_coordinator_job_id = v_job_id,
    'coordinator_job_id', v_coordinator_job_id,
    'inserted', v_inserted
  );
end;
$$;

revoke all on function public.claim_product_registration_source_bundle(jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_product_registration_source_bundle(jsonb)
  to service_role;

create or replace function public.link_product_registration_revision_source_bundle(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1
    from public.product_registration_v5_revisions r
    join internal_product_registration.source_document_bundles b
      on b.id = nullif(p_payload->>'source_bundle_id', '')::uuid
      and b.tenant_id = r.tenant_id
    where r.id = nullif(p_payload->>'product_revision_id', '')::uuid
      and r.tenant_id = nullif(p_payload->>'tenant_id', '')::uuid
      and r.job_id = nullif(p_payload->>'job_id', '')::uuid
      and b.bundle_hash = p_payload->>'bundle_hash'
      and b.coordinator_job_id = r.job_id
      and b.state = 'eligible'
  ) then raise exception 'REVISION_SOURCE_BUNDLE_LINEAGE_MISMATCH'; end if;
  insert into internal_product_registration.product_revision_source_bundles (
    tenant_id, product_revision_id, source_bundle_id, bundle_hash
  ) values (
    (p_payload->>'tenant_id')::uuid,
    (p_payload->>'product_revision_id')::uuid,
    (p_payload->>'source_bundle_id')::uuid,
    p_payload->>'bundle_hash'
  ) on conflict (tenant_id, product_revision_id) do nothing;
  v_id := (p_payload->>'source_bundle_id')::uuid;
  return jsonb_build_object('source_bundle_id', v_id);
end;
$$;

revoke all on function public.link_product_registration_revision_source_bundle(jsonb)
  from public, anon, authenticated;
grant execute on function public.link_product_registration_revision_source_bundle(jsonb)
  to service_role;

alter table public.product_registration_v5_price_rules
  add column if not exists list_amount numeric(14,2),
  add column if not exists min_travelers integer,
  add column if not exists max_travelers integer,
  add column if not exists price_relation text;

alter table public.product_registration_v5_price_rules
  drop constraint if exists product_registration_v5_price_rules_list_amount_check,
  add constraint product_registration_v5_price_rules_list_amount_check
    check (list_amount is null or list_amount >= amount),
  drop constraint if exists product_registration_v5_price_rules_traveler_scope_check,
  add constraint product_registration_v5_price_rules_traveler_scope_check
    check (
      (min_travelers is null or min_travelers between 1 and 999)
      and (max_travelers is null or max_travelers between 1 and 999)
      and (min_travelers is null or max_travelers is null or min_travelers <= max_travelers)
    ),
  drop constraint if exists product_registration_v5_price_rules_relation_check,
  add constraint product_registration_v5_price_rules_relation_check
    check (price_relation is null or price_relation in ('final_sale', 'standard_sale'));

create or replace function internal_product_registration.populate_price_commercial_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scope jsonb := coalesce(new.evidence_ref->'commercial_scope', '{}'::jsonb);
begin
  new.list_amount := nullif(v_scope->>'list_amount', '')::numeric;
  new.min_travelers := nullif(v_scope->>'min_travelers', '')::integer;
  new.max_travelers := nullif(v_scope->>'max_travelers', '')::integer;
  new.price_relation := nullif(v_scope->>'price_relation', '');
  return new;
end;
$$;

drop trigger if exists trg_pr_v5_price_commercial_scope
  on public.product_registration_v5_price_rules;
create trigger trg_pr_v5_price_commercial_scope
before insert on public.product_registration_v5_price_rules
for each row execute function internal_product_registration.populate_price_commercial_scope();

create table if not exists internal_product_registration.critical_fact_consensus_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.upload_jobs(id) on delete cascade,
  product_revision_id uuid references public.product_registration_v5_revisions(id) on delete restrict,
  section_index integer not null check (section_index >= 0),
  field_path text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  provider_call_a_id uuid references internal_product_registration.provider_calls(id) on delete restrict,
  provider_call_b_id uuid references internal_product_registration.provider_calls(id) on delete restrict,
  provider_a text not null,
  provider_b text not null,
  candidate_hash text check (candidate_hash is null or candidate_hash ~ '^[0-9a-f]{64}$'),
  candidate jsonb not null default '{}'::jsonb check (jsonb_typeof(candidate) = 'object'),
  evidence_anchor_ids text[] not null default '{}',
  evidence_quote_hashes text[] not null default '{}',
  decision_state text not null
    check (decision_state in ('agreed', 'disagreed', 'provider_unavailable', 'invalid', 'human_required')),
  verifier_result jsonb not null default '{}'::jsonb check (jsonb_typeof(verifier_result) = 'object'),
  policy_version text not null,
  created_at timestamptz not null default now(),
  check (decision_state <> 'agreed' or (
    provider_a <> provider_b
    and provider_call_a_id is not null
    and provider_call_b_id is not null
    and candidate_hash is not null
    and cardinality(evidence_anchor_ids) > 0
    and cardinality(evidence_quote_hashes) = cardinality(evidence_anchor_ids)
  )),
  unique (tenant_id, job_id, section_index, field_path, input_hash, policy_version)
);

create index if not exists idx_pr_critical_fact_consensus_job
  on internal_product_registration.critical_fact_consensus_decisions(job_id, section_index, created_at desc);
create index if not exists idx_pr_critical_fact_consensus_human
  on internal_product_registration.critical_fact_consensus_decisions(tenant_id, created_at)
  where decision_state = 'human_required';

create table if not exists internal_product_registration.critical_fact_exception_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  consensus_decision_id uuid not null references internal_product_registration.critical_fact_consensus_decisions(id) on delete restrict,
  job_id uuid not null references public.upload_jobs(id) on delete restrict,
  product_revision_id uuid references public.product_registration_v5_revisions(id) on delete restrict,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('select_source_evidence', 'reject_unresolved')),
  selected_candidate jsonb not null default '{}'::jsonb check (jsonb_typeof(selected_candidate) = 'object'),
  evidence_anchor_ids text[] not null default '{}',
  evidence_quote_hashes text[] not null default '{}',
  decision_hash text not null check (decision_hash ~ '^[0-9a-f]{64}$'),
  reason text not null,
  created_at timestamptz not null default now(),
  check (decision <> 'select_source_evidence' or (
    cardinality(evidence_anchor_ids) > 0
    and cardinality(evidence_quote_hashes) = cardinality(evidence_anchor_ids)
  )),
  unique (tenant_id, decision_hash)
);

create or replace function internal_product_registration.reject_critical_fact_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'PRODUCT_REGISTRATION_CRITICAL_FACT_HISTORY_IMMUTABLE';
end;
$$;

drop trigger if exists trg_pr_critical_fact_consensus_immutable
  on internal_product_registration.critical_fact_consensus_decisions;
create trigger trg_pr_critical_fact_consensus_immutable
before update or delete on internal_product_registration.critical_fact_consensus_decisions
for each row execute function internal_product_registration.reject_critical_fact_history_mutation();

drop trigger if exists trg_pr_critical_fact_review_immutable
  on internal_product_registration.critical_fact_exception_reviews;
create trigger trg_pr_critical_fact_review_immutable
before update or delete on internal_product_registration.critical_fact_exception_reviews
for each row execute function internal_product_registration.reject_critical_fact_history_mutation();

alter table internal_product_registration.critical_fact_consensus_decisions enable row level security;
alter table internal_product_registration.critical_fact_consensus_decisions force row level security;
alter table internal_product_registration.critical_fact_exception_reviews enable row level security;
alter table internal_product_registration.critical_fact_exception_reviews force row level security;

revoke all on table internal_product_registration.critical_fact_consensus_decisions from public, anon, authenticated;
revoke all on table internal_product_registration.critical_fact_exception_reviews from public, anon, authenticated;
grant all on table internal_product_registration.critical_fact_consensus_decisions to service_role;
grant all on table internal_product_registration.critical_fact_exception_reviews to service_role;

create or replace function public.record_product_registration_critical_fact_consensus(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_job_id uuid := nullif(p_payload->>'job_id', '')::uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'CRITICAL_FACT_CONSENSUS_PAYLOAD_INVALID';
  end if;
  if not exists (
    select 1 from public.upload_jobs j
    where j.id = v_job_id and j.tenant_id = v_tenant_id
  ) then
    raise exception 'CRITICAL_FACT_CONSENSUS_TENANT_JOB_MISMATCH';
  end if;
  insert into internal_product_registration.critical_fact_consensus_decisions (
    tenant_id, job_id, product_revision_id, section_index, field_path,
    source_hash, input_hash, provider_call_a_id, provider_call_b_id,
    provider_a, provider_b, candidate_hash, candidate,
    evidence_anchor_ids, evidence_quote_hashes, decision_state,
    verifier_result, policy_version
  ) values (
    v_tenant_id, v_job_id, nullif(p_payload->>'product_revision_id', '')::uuid,
    (p_payload->>'section_index')::integer, p_payload->>'field_path',
    p_payload->>'source_hash', p_payload->>'input_hash',
    nullif(p_payload->>'provider_call_a_id', '')::uuid,
    nullif(p_payload->>'provider_call_b_id', '')::uuid,
    p_payload->>'provider_a', p_payload->>'provider_b', nullif(p_payload->>'candidate_hash', ''),
    coalesce(p_payload->'candidate', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(p_payload->'evidence_anchor_ids')), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(p_payload->'evidence_quote_hashes')), '{}'::text[]),
    p_payload->>'decision_state', coalesce(p_payload->'verifier_result', '{}'::jsonb),
    p_payload->>'policy_version'
  ) on conflict (tenant_id, job_id, section_index, field_path, input_hash, policy_version)
  do nothing returning id into v_id;
  if v_id is null then
    select c.id into v_id
    from internal_product_registration.critical_fact_consensus_decisions c
    where c.tenant_id = v_tenant_id
      and c.job_id = v_job_id
      and c.section_index = (p_payload->>'section_index')::integer
      and c.field_path = p_payload->>'field_path'
      and c.input_hash = p_payload->>'input_hash'
      and c.policy_version = p_payload->>'policy_version';
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.record_product_registration_critical_fact_consensus(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_product_registration_critical_fact_consensus(jsonb)
  to service_role;

create or replace function public.get_product_registration_critical_fact_consensus(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'job_id', c.job_id,
    'section_index', c.section_index,
    'field_path', c.field_path,
    'source_hash', c.source_hash,
    'input_hash', c.input_hash,
    'candidate_hash', c.candidate_hash,
    'candidate', c.candidate,
    'decision_state', c.decision_state,
    'verifier_result', c.verifier_result,
    'policy_version', c.policy_version,
    'provider_a', c.provider_a,
    'provider_b', c.provider_b,
    'provider_a_result', a.result,
    'provider_b_result', b.result,
    'created_at', c.created_at
  ) order by c.section_index, c.created_at desc), '[]'::jsonb)
  from internal_product_registration.critical_fact_consensus_decisions c
  left join internal_product_registration.provider_calls a on a.id = c.provider_call_a_id
  left join internal_product_registration.provider_calls b on b.id = c.provider_call_b_id
  where c.job_id = p_job_id
$$;

revoke all on function public.get_product_registration_critical_fact_consensus(uuid)
  from public, anon, authenticated;
grant execute on function public.get_product_registration_critical_fact_consensus(uuid)
  to service_role;

create or replace function public.record_product_registration_critical_fact_exception_review(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consensus internal_product_registration.critical_fact_consensus_decisions%rowtype;
  v_reviewer_id uuid := nullif(p_payload->>'reviewer_id', '')::uuid;
  v_id uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'CRITICAL_FACT_REVIEW_PAYLOAD_INVALID';
  end if;
  select * into v_consensus
  from internal_product_registration.critical_fact_consensus_decisions c
  where c.id = nullif(p_payload->>'consensus_decision_id', '')::uuid
    and c.job_id = nullif(p_payload->>'job_id', '')::uuid
    and c.tenant_id = nullif(p_payload->>'tenant_id', '')::uuid
  for share;
  if not found then raise exception 'CRITICAL_FACT_REVIEW_CONSENSUS_NOT_FOUND'; end if;
  if v_consensus.decision_state not in ('human_required', 'provider_unavailable', 'invalid', 'disagreed') then
    raise exception 'CRITICAL_FACT_REVIEW_NOT_REQUIRED';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_reviewer_id) then
    raise exception 'CRITICAL_FACT_REVIEWER_NOT_AUTHENTICATED';
  end if;
  insert into internal_product_registration.critical_fact_exception_reviews (
    tenant_id, consensus_decision_id, job_id, product_revision_id, reviewer_id,
    decision, selected_candidate, evidence_anchor_ids, evidence_quote_hashes,
    decision_hash, reason
  ) values (
    v_consensus.tenant_id, v_consensus.id, v_consensus.job_id,
    v_consensus.product_revision_id, v_reviewer_id,
    p_payload->>'decision', coalesce(p_payload->'selected_candidate', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'evidence_anchor_ids', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'evidence_quote_hashes', '[]'::jsonb))), '{}'::text[]),
    p_payload->>'decision_hash', p_payload->>'reason'
  ) on conflict (tenant_id, decision_hash) do nothing
  returning id into v_id;
  if v_id is null then
    select r.id into v_id
    from internal_product_registration.critical_fact_exception_reviews r
    where r.tenant_id = v_consensus.tenant_id
      and r.decision_hash = p_payload->>'decision_hash';
  end if;
  return jsonb_build_object('id', v_id, 'consensus_decision_id', v_consensus.id);
end;
$$;

revoke all on function public.record_product_registration_critical_fact_exception_review(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_product_registration_critical_fact_exception_review(jsonb)
  to service_role;

comment on table internal_product_registration.critical_fact_consensus_decisions is
  'Independent-provider critical fact agreement. Agreed rows still require deterministic source replay before revision creation.';
comment on table internal_product_registration.critical_fact_exception_reviews is
  'One-person evidence selection for facts unresolved by dual providers; immutable and followed by a new correction revision.';
