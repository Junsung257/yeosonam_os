-- Product Registration V6 PR-04: human review closure.
--
-- This is a private evidence lane. It does not create revisions, snapshots,
-- publication pointers, or customer-visible facts. Existing upload_review_queue
-- rows remain terminal alerts; these ledgers are needed because one case can
-- have two independent receipts and a separate adjudication receipt.

create schema if not exists internal_product_registration;

create table if not exists internal_product_registration.product_review_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.upload_jobs(id) on delete restrict,
  source_document_id uuid not null references public.product_source_documents(id) on delete restrict,
  parent_extraction_id uuid not null references public.product_document_extractions(id) on delete restrict,
  normalization_id uuid references public.product_registration_v4_normalizations(id) on delete restrict,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  parent_extraction_hash text not null check (parent_extraction_hash ~ '^[0-9a-f]{64}$'),
  packet_hash text not null check (packet_hash ~ '^[0-9a-f]{64}$'),
  candidate_axis_set_hash text not null check (candidate_axis_set_hash ~ '^[0-9a-f]{64}$'),
  packet jsonb not null check (
    jsonb_typeof(packet) = 'object'
    and packet->>'contractVersion' = 'human-review-v1'
    and packet->>'policyVersion' = 'product-registration-v6-review-1'
  ),
  reason_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(reason_codes) = 'array'),
  status text not null default 'queued' check (status in (
    'queued', 'in_review', 'awaiting_second', 'adjudication_required',
    'accepted', 'source_insufficient', 'system_quarantined', 'rejected',
    'expired', 'cancelled'
  )),
  review_mode text not null default 'dual' check (review_mode = 'dual'),
  business_idempotency_key text not null check (btrim(business_idempotency_key) <> ''),
  created_by text not null check (btrim(created_by) <> ''),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, business_idempotency_key),
  check ((status in ('accepted', 'source_insufficient', 'system_quarantined', 'rejected', 'expired', 'cancelled')) = (completed_at is not null))
);

create table if not exists internal_product_registration.product_review_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  case_id uuid not null references internal_product_registration.product_review_cases(id) on delete restrict,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  reviewer_slot text not null check (reviewer_slot in ('first', 'second', 'adjudicator')),
  packet_hash text not null check (packet_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);

create table if not exists internal_product_registration.product_review_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  case_id uuid not null references internal_product_registration.product_review_cases(id) on delete restrict,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  reviewer_session_id uuid not null references internal_product_registration.product_review_sessions(id) on delete restrict,
  reviewer_slot text not null check (reviewer_slot in ('first', 'second', 'adjudicator')),
  packet_hash text not null check (packet_hash ~ '^[0-9a-f]{64}$'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  parent_extraction_hash text not null check (parent_extraction_hash ~ '^[0-9a-f]{64}$'),
  candidate_axis_set_hash text not null check (candidate_axis_set_hash ~ '^[0-9a-f]{64}$'),
  policy_version text not null check (policy_version = 'product-registration-v6-review-1'),
  decision text not null check (decision in (
    'accept_auto_candidate', 'select_axis', 'correct_value_with_evidence',
    'mark_source_insufficient', 'mark_system_defect', 'defer_need_more_context'
  )),
  decision_payload jsonb not null check (jsonb_typeof(decision_payload) = 'object'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  reason text not null check (char_length(btrim(reason)) >= 5),
  receipt_hash text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (case_id, reviewer_slot),
  unique (case_id, receipt_hash),
  unique (case_id, reviewer_id)
);

create table if not exists internal_product_registration.product_review_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  case_id uuid not null references internal_product_registration.product_review_cases(id) on delete restrict,
  receipt_id uuid references internal_product_registration.product_review_receipts(id) on delete restrict,
  event_type text not null check (event_type = 'review_completed'),
  idempotency_key text not null unique check (btrim(idempotency_key) <> ''),
  from_status text not null,
  to_status text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists idx_product_review_cases_queue
  on internal_product_registration.product_review_cases(tenant_id, status, created_at)
  where status in ('queued', 'in_review', 'awaiting_second', 'adjudication_required');
create index if not exists idx_product_review_sessions_case
  on internal_product_registration.product_review_sessions(case_id, reviewer_slot, created_at desc);
create index if not exists idx_product_review_receipts_case
  on internal_product_registration.product_review_receipts(case_id, reviewer_slot, created_at);
create index if not exists idx_product_review_events_pending
  on internal_product_registration.product_review_events(tenant_id, created_at);

create or replace function internal_product_registration.reject_product_review_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'PRODUCT_REGISTRATION_REVIEW_HISTORY_IMMUTABLE';
end;
$$;

drop trigger if exists trg_product_review_receipts_immutable
  on internal_product_registration.product_review_receipts;
create trigger trg_product_review_receipts_immutable
before update or delete on internal_product_registration.product_review_receipts
for each row execute function internal_product_registration.reject_product_review_history_mutation();

drop trigger if exists trg_product_review_events_immutable
  on internal_product_registration.product_review_events;
create trigger trg_product_review_events_immutable
before update or delete on internal_product_registration.product_review_events
for each row execute function internal_product_registration.reject_product_review_history_mutation();

alter table internal_product_registration.product_review_cases enable row level security;
alter table internal_product_registration.product_review_cases force row level security;
alter table internal_product_registration.product_review_sessions enable row level security;
alter table internal_product_registration.product_review_sessions force row level security;
alter table internal_product_registration.product_review_receipts enable row level security;
alter table internal_product_registration.product_review_receipts force row level security;
alter table internal_product_registration.product_review_events enable row level security;
alter table internal_product_registration.product_review_events force row level security;

revoke all on table internal_product_registration.product_review_cases from public, anon, authenticated, service_role;
revoke all on table internal_product_registration.product_review_sessions from public, anon, authenticated, service_role;
revoke all on table internal_product_registration.product_review_receipts from public, anon, authenticated, service_role;
revoke all on table internal_product_registration.product_review_events from public, anon, authenticated, service_role;

create or replace function public.create_product_registration_review_case(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_case_id uuid := nullif(p_payload->>'case_id', '')::uuid;
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_job_id uuid := nullif(p_payload->>'job_id', '')::uuid;
  v_source_id uuid := nullif(p_payload->>'source_document_id', '')::uuid;
  v_extraction_id uuid := nullif(p_payload->>'parent_extraction_id', '')::uuid;
  v_normalization_id uuid := nullif(p_payload->>'normalization_id', '')::uuid;
  v_source_hash text := nullif(p_payload->>'source_hash', '');
  v_extraction_hash text := nullif(p_payload->>'parent_extraction_hash', '');
  v_packet jsonb := p_payload->'packet';
  v_packet_hash text := nullif(p_payload->>'packet_hash', '');
  v_axis_hash text := nullif(p_payload->>'candidate_axis_set_hash', '');
  v_key text := nullif(btrim(p_payload->>'business_idempotency_key'), '');
  v_case internal_product_registration.product_review_cases%rowtype;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or v_case_id is null
    or v_tenant_id is null
    or v_job_id is null
    or v_source_id is null
    or v_extraction_id is null
    or jsonb_typeof(v_packet) is distinct from 'object'
    or v_key is null
    or v_source_hash is null or v_source_hash !~ '^[0-9a-f]{64}$'
    or v_extraction_hash is null or v_extraction_hash !~ '^[0-9a-f]{64}$'
    or v_packet_hash is null or v_packet_hash !~ '^[0-9a-f]{64}$'
    or v_axis_hash is null or v_axis_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_payload->'reason_codes', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'PRODUCT_REVIEW_CASE_PAYLOAD_INVALID';
  end if;
  if v_packet->>'contractVersion' is distinct from 'human-review-v1'
    or v_packet->>'policyVersion' is distinct from 'product-registration-v6-review-1'
    or v_packet->>'caseId' is distinct from v_case_id::text
    or v_packet->>'sourceDocumentId' is distinct from v_source_id::text
    or v_packet->>'parentExtractionId' is distinct from v_extraction_id::text
    or v_packet->>'sourceHash' is distinct from v_source_hash
    or v_packet->>'parentExtractionHash' is distinct from v_extraction_hash
    or v_packet->>'packetHash' is distinct from v_packet_hash
    or v_packet->>'candidateAxisSetHash' is distinct from v_axis_hash then
    raise exception 'PRODUCT_REVIEW_CASE_PACKET_LINEAGE_MISMATCH';
  end if;
  if not exists (select 1 from public.upload_jobs j where j.id = v_job_id and j.tenant_id = v_tenant_id) then
    raise exception 'PRODUCT_REVIEW_CASE_JOB_TENANT_MISMATCH';
  end if;
  if not exists (select 1 from public.product_source_documents d where d.id = v_source_id and d.tenant_id = v_tenant_id and d.sha256 = v_source_hash) then
    raise exception 'PRODUCT_REVIEW_CASE_SOURCE_LINEAGE_MISMATCH';
  end if;
  if not exists (select 1 from public.product_document_extractions e where e.id = v_extraction_id and e.tenant_id = v_tenant_id and e.source_document_id = v_source_id and e.extraction_hash = v_extraction_hash) then
    raise exception 'PRODUCT_REVIEW_CASE_EXTRACTION_LINEAGE_MISMATCH';
  end if;
  if v_normalization_id is not null and not exists (
    select 1 from public.product_registration_v4_normalizations n
    where n.id = v_normalization_id and n.tenant_id = v_tenant_id and n.job_id = v_job_id
      and n.source_document_id = v_source_id and n.extraction_id = v_extraction_id
  ) then
    raise exception 'PRODUCT_REVIEW_CASE_NORMALIZATION_LINEAGE_MISMATCH';
  end if;

  insert into internal_product_registration.product_review_cases (
    id, tenant_id, job_id, source_document_id, parent_extraction_id, normalization_id,
    source_hash, parent_extraction_hash, packet_hash, candidate_axis_set_hash,
    packet, reason_codes, business_idempotency_key, created_by
  ) values (
    v_case_id, v_tenant_id, v_job_id, v_source_id, v_extraction_id, v_normalization_id,
    v_source_hash, v_extraction_hash, v_packet_hash, v_axis_hash,
    v_packet, p_payload->'reason_codes', coalesce(v_key, ''),
    coalesce(nullif(btrim(p_payload->>'created_by'), ''), 'v6-review')
  )
  on conflict (tenant_id, business_idempotency_key) do nothing
  returning * into v_case;

  if v_case.id is null then
    select * into v_case
    from internal_product_registration.product_review_cases c
    where c.tenant_id = v_tenant_id and c.business_idempotency_key = v_key;
    if v_case.id is null or v_case.packet_hash <> v_packet_hash or v_case.parent_extraction_hash <> v_extraction_hash then
      raise exception 'PRODUCT_REVIEW_CASE_IDEMPOTENCY_CONFLICT';
    end if;
  end if;
  return jsonb_build_object('caseId', v_case.id, 'status', v_case.status, 'packetHash', v_case.packet_hash);
end;
$$;

create or replace function public.get_product_registration_review_queue(
  p_tenant_id uuid,
  p_reviewer_id uuid,
  p_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
begin
  if not exists (
    select 1 from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id and m.user_id = p_reviewer_id and m.is_active
      and m.role in ('tenant_admin', 'tenant_staff') and t.status = 'active'
  ) then
    raise exception 'PRODUCT_REVIEW_REVIEWER_MEMBERSHIP_REQUIRED';
  end if;
  return (
    select coalesce(jsonb_agg(item order by item->>'createdAt'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'caseId', c.id,
        'status', c.status,
        'reviewerSlot', case
          when count(r.id) filter (where r.reviewer_slot = 'first') = 0 then 'first'
          when count(r.id) filter (where r.reviewer_slot = 'second') = 0 then 'second'
          else 'adjudicator'
        end,
        'sourceDocumentId', c.source_document_id,
        'jobId', c.job_id,
        'sourceFilename', d.original_filename,
        'sourceHash', c.source_hash,
        'parentExtractionId', c.parent_extraction_id,
        'parentExtractionHash', c.parent_extraction_hash,
        'packetHash', c.packet_hash,
        'candidateAxisSetHash', c.candidate_axis_set_hash,
        'reasonCodes', c.reason_codes,
        'packet', c.packet,
        'createdAt', c.created_at
      ) as item
      from internal_product_registration.product_review_cases c
      join public.product_source_documents d on d.id = c.source_document_id and d.tenant_id = c.tenant_id
      left join internal_product_registration.product_review_receipts r on r.case_id = c.id
      where c.tenant_id = p_tenant_id
        and c.status in ('queued', 'in_review', 'awaiting_second', 'adjudication_required')
        and not exists (select 1 from internal_product_registration.product_review_receipts own where own.case_id = c.id and own.reviewer_id = p_reviewer_id)
      group by c.id, d.original_filename
      order by c.created_at
      limit least(greatest(coalesce(p_limit, 10), 1), 50)
    ) queued
  );
end;
$$;

create or replace function public.begin_product_registration_review_session(
  p_case_id uuid,
  p_reviewer_id uuid,
  p_reviewer_slot text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_case internal_product_registration.product_review_cases%rowtype;
  v_session internal_product_registration.product_review_sessions%rowtype;
  v_expected_slot text;
  v_first_reviewer uuid;
begin
  if p_reviewer_slot not in ('first', 'second', 'adjudicator') then raise exception 'PRODUCT_REVIEW_SLOT_INVALID'; end if;
  select * into v_case from internal_product_registration.product_review_cases c where c.id = p_case_id for update;
  if not found then raise exception 'PRODUCT_REVIEW_CASE_NOT_FOUND'; end if;
  if v_case.status not in ('queued', 'in_review', 'awaiting_second', 'adjudication_required') then
    raise exception 'PRODUCT_REVIEW_CASE_NOT_REVIEWABLE';
  end if;
  if not exists (
    select 1 from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = v_case.tenant_id and m.user_id = p_reviewer_id and m.is_active
      and m.role in ('tenant_admin', 'tenant_staff') and t.status = 'active'
  ) then raise exception 'PRODUCT_REVIEW_REVIEWER_MEMBERSHIP_REQUIRED'; end if;
  if exists (select 1 from internal_product_registration.product_review_receipts r where r.case_id = p_case_id and r.reviewer_id = p_reviewer_id) then
    raise exception 'PRODUCT_REVIEW_REVIEWER_ALREADY_USED';
  end if;
  select r.reviewer_id into v_first_reviewer
  from internal_product_registration.product_review_receipts r
  where r.case_id = p_case_id and r.reviewer_slot = 'first'
  order by r.created_at
  limit 1;
  select case
    when count(*) filter (where r.reviewer_slot = 'first') = 0 then 'first'
    when count(*) filter (where r.reviewer_slot = 'second') = 0 then 'second'
    else 'adjudicator'
  end into v_expected_slot
  from internal_product_registration.product_review_receipts r
  where r.case_id = p_case_id;
  if p_reviewer_slot <> v_expected_slot then raise exception 'PRODUCT_REVIEW_SLOT_STALE'; end if;
  if p_reviewer_slot in ('second', 'adjudicator') and v_first_reviewer = p_reviewer_id then raise exception 'PRODUCT_REVIEW_REVIEWERS_MUST_BE_INDEPENDENT'; end if;
  if p_reviewer_slot = 'adjudicator' and exists (
    select 1 from internal_product_registration.product_review_receipts r where r.case_id = p_case_id and r.reviewer_id = p_reviewer_id
  ) then raise exception 'PRODUCT_REVIEW_REVIEWERS_MUST_BE_INDEPENDENT'; end if;
  if exists (
    select 1
    from internal_product_registration.product_review_sessions s
    where s.case_id = p_case_id
      and s.reviewer_slot = p_reviewer_slot
      and s.consumed_at is null
      and s.expires_at > now()
      and s.reviewer_id <> p_reviewer_id
  ) then
    raise exception 'PRODUCT_REVIEW_SLOT_IN_PROGRESS';
  end if;
  select * into v_session
  from internal_product_registration.product_review_sessions s
  where s.case_id = p_case_id and s.tenant_id = v_case.tenant_id and s.reviewer_id = p_reviewer_id
    and s.reviewer_slot = p_reviewer_slot and s.packet_hash = v_case.packet_hash
    and s.consumed_at is null and s.expires_at > now()
  order by s.created_at desc limit 1;
  if v_session.id is null then
    insert into internal_product_registration.product_review_sessions (
      tenant_id, case_id, reviewer_id, reviewer_slot, packet_hash, expires_at
    ) values (v_case.tenant_id, p_case_id, p_reviewer_id, p_reviewer_slot, v_case.packet_hash, now() + interval '10 minutes')
    returning * into v_session;
  end if;
  if v_case.status in ('queued', 'awaiting_second', 'adjudication_required', 'in_review') then
    update internal_product_registration.product_review_cases
    set status = 'in_review', updated_at = now()
    where id = p_case_id;
  end if;
  return jsonb_build_object(
    'caseId', p_case_id,
    'sessionId', v_session.id,
    'reviewerSlot', p_reviewer_slot,
    'packetHash', v_case.packet_hash,
    'sourceHash', v_case.source_hash,
    'parentExtractionHash', v_case.parent_extraction_hash,
    'candidateAxisSetHash', v_case.candidate_axis_set_hash,
    'expiresAt', v_session.expires_at
  );
end;
$$;

create or replace function public.submit_product_registration_review_receipt(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_case internal_product_registration.product_review_cases%rowtype;
  v_receipt jsonb := p_payload->'receipt';
  v_case_id uuid := nullif(v_receipt->>'caseId', '')::uuid;
  v_reviewer_id uuid := nullif(v_receipt->>'reviewerUserId', '')::uuid;
  v_session_id uuid := nullif(v_receipt->>'reviewerSessionId', '')::uuid;
  v_slot text := nullif(v_receipt->>'reviewerSlot', '');
  v_receipt_hash text := nullif(v_receipt->>'receiptHash', '');
  v_existing internal_product_registration.product_review_receipts%rowtype;
  v_new internal_product_registration.product_review_receipts%rowtype;
  v_first_count integer;
  v_second_count integer;
  v_next_status text;
  v_first_decision text;
  v_second_decision text;
  v_first_payload jsonb;
  v_second_payload jsonb;
  v_first_evidence jsonb;
  v_second_evidence jsonb;
  v_event_id uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(v_receipt) is distinct from 'object' then raise exception 'PRODUCT_REVIEW_RECEIPT_PAYLOAD_INVALID'; end if;
  if v_case_id is null or v_reviewer_id is null or v_session_id is null
    or v_slot not in ('first', 'second', 'adjudicator')
    or v_receipt_hash is null or v_receipt_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'PRODUCT_REVIEW_RECEIPT_IDENTITY_INVALID';
  end if;
  select * into v_case from internal_product_registration.product_review_cases c where c.id = v_case_id for update;
  if not found then raise exception 'PRODUCT_REVIEW_CASE_NOT_FOUND'; end if;
  if v_case.status not in ('queued', 'in_review', 'awaiting_second', 'adjudication_required') then
    raise exception 'PRODUCT_REVIEW_CASE_NOT_REVIEWABLE';
  end if;
  if v_receipt->>'contractVersion' is distinct from 'human-review-v1'
    or v_receipt->>'policyVersion' is distinct from 'product-registration-v6-review-1'
    or v_receipt->>'packetHash' <> v_case.packet_hash
    or v_receipt->>'sourceHash' <> v_case.source_hash
    or v_receipt->>'parentExtractionHash' <> v_case.parent_extraction_hash
    or v_receipt->>'candidateAxisSetHash' <> v_case.candidate_axis_set_hash then
    raise exception 'PRODUCT_REVIEW_RECEIPT_LINEAGE_MISMATCH';
  end if;
  select * into v_existing
  from internal_product_registration.product_review_receipts r
  where r.case_id = v_case_id and r.receipt_hash = v_receipt_hash;
  if v_existing.id is not null then
    if v_existing.reviewer_id <> v_reviewer_id or v_existing.reviewer_slot <> v_slot then raise exception 'PRODUCT_REVIEW_RECEIPT_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('caseId', v_case_id, 'receiptId', v_existing.id, 'status', v_case.status, 'idempotent', true);
  end if;
  update internal_product_registration.product_review_sessions s
  set consumed_at = now()
  where s.id = v_session_id and s.case_id = v_case_id and s.tenant_id = v_case.tenant_id
    and s.reviewer_id = v_reviewer_id and s.reviewer_slot = v_slot
    and s.packet_hash = v_case.packet_hash and s.consumed_at is null and s.expires_at > now();
  if not found then raise exception 'PRODUCT_REVIEW_SESSION_INVALID'; end if;
  if exists (select 1 from internal_product_registration.product_review_receipts r where r.case_id = v_case_id and r.reviewer_id = v_reviewer_id) then raise exception 'PRODUCT_REVIEW_REVIEWERS_MUST_BE_INDEPENDENT'; end if;
  insert into internal_product_registration.product_review_receipts (
    tenant_id, case_id, reviewer_id, reviewer_session_id, reviewer_slot,
    packet_hash, source_hash, parent_extraction_hash, candidate_axis_set_hash,
    policy_version, decision, decision_payload, evidence, reason, receipt_hash
  ) values (
    v_case.tenant_id, v_case_id, v_reviewer_id, v_session_id, v_slot,
    v_case.packet_hash, v_case.source_hash, v_case.parent_extraction_hash, v_case.candidate_axis_set_hash,
    coalesce(v_receipt->>'policyVersion', ''), v_receipt->>'decision',
    coalesce(v_receipt->'decisionPayload', '{}'::jsonb), coalesce(v_receipt->'evidence', '[]'::jsonb),
    coalesce(v_receipt->>'reason', ''), v_receipt_hash
  ) returning * into v_new;

  select count(*) filter (where r.reviewer_slot = 'first'), count(*) filter (where r.reviewer_slot = 'second')
    into v_first_count, v_second_count
  from internal_product_registration.product_review_receipts r where r.case_id = v_case_id;
  if v_slot = 'adjudicator' then
    v_next_status := case v_new.decision
      when 'mark_source_insufficient' then 'source_insufficient'
      when 'mark_system_defect' then 'system_quarantined'
      when 'accept_auto_candidate' then 'accepted'
      when 'select_axis' then 'accepted'
      when 'correct_value_with_evidence' then 'accepted'
      else 'adjudication_required'
    end;
  elsif v_first_count = 1 and v_second_count = 1 then
    select r.decision, r.decision_payload, r.evidence into v_first_decision, v_first_payload, v_first_evidence
    from internal_product_registration.product_review_receipts r where r.case_id = v_case_id and r.reviewer_slot = 'first';
    select r.decision, r.decision_payload, r.evidence into v_second_decision, v_second_payload, v_second_evidence
    from internal_product_registration.product_review_receipts r where r.case_id = v_case_id and r.reviewer_slot = 'second';
    if v_first_decision = v_second_decision and v_first_payload = v_second_payload and v_first_evidence = v_second_evidence then
      v_next_status := case v_first_decision
        when 'mark_source_insufficient' then 'source_insufficient'
        when 'mark_system_defect' then 'system_quarantined'
        when 'accept_auto_candidate' then 'accepted'
        when 'select_axis' then 'accepted'
        when 'correct_value_with_evidence' then 'accepted'
        else 'adjudication_required'
      end;
    else
      v_next_status := 'adjudication_required';
    end if;
  else
    v_next_status := 'awaiting_second';
  end if;
  update internal_product_registration.product_review_cases c
  set status = v_next_status,
      completed_at = case when v_next_status in ('accepted', 'source_insufficient', 'system_quarantined', 'rejected') then now() else null end,
      updated_at = now()
  where c.id = v_case_id;
  insert into internal_product_registration.product_review_events (
    tenant_id, case_id, receipt_id, event_type, idempotency_key, from_status, to_status, payload
  ) values (
    v_case.tenant_id, v_case_id, v_new.id, 'review_completed',
    'product-review:' || v_case_id::text || ':' || v_new.id::text,
    v_case.status, v_next_status,
    jsonb_build_object('caseId', v_case_id, 'receiptId', v_new.id, 'reviewerSlot', v_slot, 'status', v_next_status)
  ) on conflict (idempotency_key) do nothing
  returning id into v_event_id;
  if v_event_id is null then
    select e.id into v_event_id from internal_product_registration.product_review_events e
    where e.idempotency_key = 'product-review:' || v_case_id::text || ':' || v_new.id::text;
  end if;
  return jsonb_build_object('caseId', v_case_id, 'receiptId', v_new.id, 'status', v_next_status, 'eventId', v_event_id, 'idempotent', false);
end;
$$;

revoke all on function public.create_product_registration_review_case(jsonb) from public, anon, authenticated;
grant execute on function public.create_product_registration_review_case(jsonb) to service_role;
revoke all on function public.get_product_registration_review_queue(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_product_registration_review_queue(uuid, uuid, integer) to service_role;
revoke all on function public.begin_product_registration_review_session(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_product_registration_review_session(uuid, uuid, text) to service_role;
revoke all on function public.submit_product_registration_review_receipt(jsonb) from public, anon, authenticated;
grant execute on function public.submit_product_registration_review_receipt(jsonb) to service_role;

comment on table internal_product_registration.product_review_cases is
  'Private V6 human-review case packets. Mutable workflow status only through service-role RPCs; never a publication authority.';
comment on table internal_product_registration.product_review_receipts is
  'Append-only independent reviewer receipts. A second reviewer and adjudicator must be distinct accounts.';
comment on table internal_product_registration.product_review_events is
  'Append-only review-completed outbox events for the later derived-extraction resume step.';
