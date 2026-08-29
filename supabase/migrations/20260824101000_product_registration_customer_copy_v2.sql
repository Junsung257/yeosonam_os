-- Customer copy V2 keeps canonical facts deterministic and lets AI rewrite
-- presentation only. The exact revision/facts/policy tuple is immutable and
-- cacheable, while a validator blocks new numbers, locations and unsupported
-- commercial claims before a snapshot can consume the copy.

alter table internal_product_registration.copy_revisions
  add column if not exists copy_policy_version text not null default 'facts-template-only-v6',
  add column if not exists deterministic_facts_hash text,
  add column if not exists generation_state text not null default 'legacy_template',
  add column if not exists quality_score smallint,
  add column if not exists validation_failures text[] not null default '{}';

alter table internal_product_registration.copy_revisions
  drop constraint if exists copy_revisions_deterministic_facts_hash_check,
  add constraint copy_revisions_deterministic_facts_hash_check
    check (deterministic_facts_hash is null or deterministic_facts_hash ~ '^[0-9a-f]{64}$'),
  drop constraint if exists copy_revisions_generation_state_check,
  add constraint copy_revisions_generation_state_check
    check (generation_state in ('legacy_template', 'deterministic_fallback', 'ai_rewritten')),
  drop constraint if exists copy_revisions_quality_score_check,
  add constraint copy_revisions_quality_score_check
    check (quality_score is null or quality_score between 0 and 100);

create unique index if not exists idx_product_registration_copy_exact_facts_policy
  on internal_product_registration.copy_revisions (
    product_revision_id,
    locale,
    copy_policy_version,
    deterministic_facts_hash
  )
  where deterministic_facts_hash is not null;

create or replace function public.persist_product_registration_v6_copy_revision(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_revision public.product_registration_v5_revisions%rowtype;
  v_source_hash text;
  v_copy internal_product_registration.copy_revisions%rowtype;
  v_link jsonb;
  v_policy text := nullif(btrim(p_payload->>'copy_policy_version'), '');
  v_facts_hash text := nullif(p_payload->>'deterministic_facts_hash', '');
  v_generation_state text := nullif(p_payload->>'generation_state', '');
  v_quality_score smallint := nullif(p_payload->>'quality_score', '')::smallint;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or v_policy is null
    or v_facts_hash !~ '^[0-9a-f]{64}$'
    or p_payload->>'copy_hash' !~ '^[0-9a-f]{64}$'
    or p_payload->>'source_hash' !~ '^[0-9a-f]{64}$'
    or p_payload->>'revision_hash' !~ '^[0-9a-f]{64}$'
    or v_generation_state not in ('deterministic_fallback', 'ai_rewritten')
    or v_quality_score not between 0 and 100 then
    raise exception 'V6_COPY_V2_PAYLOAD_INVALID';
  end if;

  select * into v_revision
  from public.product_registration_v5_revisions
  where id = nullif(p_payload->>'product_revision_id', '')::uuid
  for share;
  if not found then raise exception 'V6_COPY_REVISION_NOT_FOUND'; end if;

  select source_document.sha256 into v_source_hash
  from public.product_source_documents source_document
  where source_document.id = v_revision.source_document_id
    and source_document.tenant_id = v_revision.tenant_id
  for share;
  if v_source_hash is null then raise exception 'V6_COPY_SOURCE_DOCUMENT_NOT_FOUND'; end if;

  if v_revision.payload_hash is distinct from p_payload->>'revision_hash'
    or v_source_hash is distinct from p_payload->>'source_hash' then
    raise exception 'V6_COPY_REVISION_HASH_MISMATCH';
  end if;
  if v_revision.tenant_id is distinct from nullif(p_payload->>'tenant_id', '')::uuid then
    raise exception 'V6_COPY_TENANT_MISMATCH';
  end if;

  insert into internal_product_registration.copy_revisions (
    tenant_id,
    catalog_product_id,
    product_revision_id,
    locale,
    copy_payload,
    copy_hash,
    source_hash,
    revision_hash,
    model_id,
    prompt_hash,
    validation_state,
    copy_policy_version,
    deterministic_facts_hash,
    generation_state,
    quality_score,
    validation_failures,
    created_version
  ) values (
    v_revision.tenant_id,
    v_revision.catalog_product_id,
    v_revision.id,
    coalesce(nullif(p_payload->>'locale', ''), 'ko-KR'),
    p_payload->'copy_payload',
    p_payload->>'copy_hash',
    p_payload->>'source_hash',
    v_revision.payload_hash,
    nullif(p_payload->>'model_id', ''),
    nullif(p_payload->>'prompt_hash', ''),
    p_payload->>'validation_state',
    v_policy,
    v_facts_hash,
    v_generation_state,
    v_quality_score,
    coalesce(array(
      select jsonb_array_elements_text(coalesce(p_payload->'copy_payload'->'rewrite_validation_failures', '[]'::jsonb))
    ), '{}'),
    coalesce(nullif(p_payload->>'created_version', ''), 'product-registration-customer-copy-v2')
  )
  on conflict do nothing
  returning * into v_copy;

  if v_copy.id is null then
    select * into v_copy
    from internal_product_registration.copy_revisions copy
    where copy.product_revision_id = v_revision.id
      and copy.locale = coalesce(nullif(p_payload->>'locale', ''), 'ko-KR')
      and copy.copy_policy_version = v_policy
      and copy.deterministic_facts_hash = v_facts_hash
    order by copy.created_at desc
    limit 1;
  end if;
  if v_copy.id is null then raise exception 'V6_COPY_V2_PERSISTENCE_LOST'; end if;

  for v_link in
    select value from jsonb_array_elements(coalesce(p_payload->'claim_links', '[]'::jsonb))
  loop
    if not exists (
      select 1
      from public.product_registration_v5_claims claim
      where claim.id = nullif(v_link->>'claim_id', '')::uuid
        and claim.revision_id = v_revision.id
    ) then
      raise exception 'V6_COPY_CLAIM_LINEAGE_MISMATCH';
    end if;
    insert into internal_product_registration.copy_claim_links (
      tenant_id,
      catalog_product_id,
      copy_revision_id,
      claim_id,
      copy_path,
      source_hash,
      revision_hash
    ) values (
      v_revision.tenant_id,
      v_revision.catalog_product_id,
      v_copy.id,
      nullif(v_link->>'claim_id', '')::uuid,
      v_link->>'copy_path',
      v_source_hash,
      v_revision.payload_hash
    )
    on conflict do nothing;
  end loop;

  return jsonb_build_object(
    'copy_revision_id', v_copy.id,
    'copy_hash', v_copy.copy_hash,
    'copy_policy_version', v_copy.copy_policy_version,
    'deterministic_facts_hash', v_copy.deterministic_facts_hash,
    'reused', v_copy.copy_hash is distinct from p_payload->>'copy_hash'
  );
end;
$$;

create or replace function public.get_product_registration_v6_cached_copy(
  p_revision_id uuid,
  p_locale text,
  p_copy_policy_version text,
  p_deterministic_facts_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select jsonb_build_object(
    'copy_revision_id', copy.id,
    'copy_hash', copy.copy_hash,
    'copy_payload', copy.copy_payload,
    'revision_hash', copy.revision_hash,
    'copy_policy_version', copy.copy_policy_version,
    'deterministic_facts_hash', copy.deterministic_facts_hash,
    'generation_state', copy.generation_state,
    'quality_score', copy.quality_score,
    'model_id', copy.model_id,
    'prompt_hash', copy.prompt_hash
  )
  from internal_product_registration.copy_revisions copy
  where copy.product_revision_id = p_revision_id
    and copy.locale = p_locale
    and copy.copy_policy_version = p_copy_policy_version
    and copy.deterministic_facts_hash = p_deterministic_facts_hash
    and copy.validation_state = 'verified'
    and copy.quality_score >= 72
  order by copy.created_at desc
  limit 1
$$;

create or replace function public.get_product_registration_v6_verified_copy(
  p_revision_id uuid,
  p_locale text default 'ko-KR'
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select jsonb_build_object(
    'copy_revision_id', copy.id,
    'copy_hash', copy.copy_hash,
    'copy_payload', copy.copy_payload,
    'revision_hash', copy.revision_hash,
    'source_hash', copy.source_hash,
    'copy_policy_version', copy.copy_policy_version,
    'deterministic_facts_hash', copy.deterministic_facts_hash,
    'generation_state', copy.generation_state,
    'quality_score', copy.quality_score,
    'model_id', copy.model_id,
    'prompt_hash', copy.prompt_hash
  )
  from internal_product_registration.copy_revisions copy
  join public.product_registration_v5_revisions revision
    on revision.id = copy.product_revision_id
  join public.product_source_documents source_document
    on source_document.id = revision.source_document_id
   and source_document.tenant_id = revision.tenant_id
  where copy.product_revision_id = p_revision_id
    and copy.locale = p_locale
    and copy.validation_state = 'verified'
    and copy.copy_policy_version = 'product-registration-customer-copy-v2'
    and copy.quality_score >= 72
    and copy.revision_hash = revision.payload_hash
    and copy.source_hash = source_document.sha256
  order by copy.created_at desc
  limit 1
$$;

revoke all on function public.persist_product_registration_v6_copy_revision(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_product_registration_v6_cached_copy(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_product_registration_v6_verified_copy(uuid, text)
  from public, anon, authenticated;
grant execute on function public.persist_product_registration_v6_copy_revision(jsonb)
  to service_role;
grant execute on function public.get_product_registration_v6_cached_copy(uuid, text, text, text)
  to service_role;
grant execute on function public.get_product_registration_v6_verified_copy(uuid, text)
  to service_role;

comment on function public.get_product_registration_v6_cached_copy(uuid, text, text, text) is
  'Returns only an exact verified revision/locale/copy-policy/deterministic-facts result so workflow retries never make another billable rewrite.';
