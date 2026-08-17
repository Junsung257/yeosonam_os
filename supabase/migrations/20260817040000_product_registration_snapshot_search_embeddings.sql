-- Search embeddings are mutable operational projections of immutable public
-- snapshots. They must never be written back into travel_packages.

create table if not exists internal_product_registration.product_search_embeddings (
  tenant_id uuid not null,
  catalog_product_id uuid not null,
  channel text not null,
  locale text not null,
  snapshot_id uuid not null references public.public_package_snapshots(id) on delete cascade,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  model_version text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (snapshot_id, model_version)
);

create index if not exists idx_product_search_embeddings_catalog
  on internal_product_registration.product_search_embeddings
  (tenant_id, catalog_product_id, channel, locale, updated_at desc);

create index if not exists idx_product_search_embeddings_hnsw
  on internal_product_registration.product_search_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

revoke all on table internal_product_registration.product_search_embeddings
  from public, anon, authenticated;
grant select, insert, update, delete on table internal_product_registration.product_search_embeddings
  to service_role;

create or replace function internal_product_registration.claim_search_embedding_candidates(
  p_limit integer,
  p_model_version text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select coalesce(jsonb_agg(candidate order by candidate->>'snapshot_id'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'tenant_id', pointer.tenant_id,
      'catalog_product_id', pointer.catalog_product_id,
      'channel', pointer.channel,
      'locale', pointer.locale,
      'snapshot_id', snapshot.id,
      'snapshot_hash', snapshot.snapshot_hash,
      'snapshot_json', snapshot.snapshot_json
    ) as candidate
    from public.product_registration_v5_publication_pointers pointer
    join public.public_package_snapshots snapshot
      on snapshot.id = pointer.current_snapshot_id
     and snapshot.catalog_product_id = pointer.catalog_product_id
     and snapshot.tenant_id = pointer.tenant_id
    where pointer.state = 'published'
      and pointer.tenant_id is not null
      and pointer.catalog_product_id is not null
      and pointer.current_snapshot_id is not null
      and not exists (
        select 1
        from internal_product_registration.product_search_embeddings existing
        where existing.snapshot_id = pointer.current_snapshot_id
          and existing.model_version = p_model_version
          and existing.snapshot_hash = snapshot.snapshot_hash
      )
    order by pointer.updated_at desc, snapshot.id
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) rows;
$$;

create or replace function public.claim_product_registration_search_embedding_candidates(
  p_limit integer,
  p_model_version text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.claim_search_embedding_candidates(p_limit, p_model_version);
$$;

create or replace function internal_product_registration.persist_search_embedding(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_snapshot_id uuid := nullif(p_payload->>'snapshot_id', '')::uuid;
  v_channel text := nullif(p_payload->>'channel', '');
  v_locale text := nullif(p_payload->>'locale', '');
  v_snapshot_hash text := nullif(p_payload->>'snapshot_hash', '');
  v_content_hash text := nullif(p_payload->>'content_hash', '');
  v_model_version text := nullif(p_payload->>'model_version', '');
  v_embedding extensions.vector(1536);
begin
  if v_tenant_id is null or v_catalog_product_id is null or v_snapshot_id is null
    or v_channel is null or v_locale is null or v_model_version is null
    or v_snapshot_hash !~ '^[0-9a-f]{64}$' or v_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'PRODUCT_SEARCH_EMBEDDING_LINEAGE_INVALID';
  end if;
  if not exists (
    select 1
    from public.product_registration_v5_publication_pointers pointer
    join public.public_package_snapshots snapshot on snapshot.id = pointer.current_snapshot_id
    where pointer.tenant_id = v_tenant_id
      and pointer.catalog_product_id = v_catalog_product_id
      and pointer.channel = v_channel
      and pointer.locale = v_locale
      and pointer.state = 'published'
      and pointer.current_snapshot_id = v_snapshot_id
      and snapshot.snapshot_hash = v_snapshot_hash
  ) then
    raise exception 'PRODUCT_SEARCH_EMBEDDING_POINTER_STALE';
  end if;
  begin
    v_embedding := (p_payload->'embedding')::text::extensions.vector;
  exception when others then
    raise exception 'PRODUCT_SEARCH_EMBEDDING_VECTOR_INVALID';
  end;
  if extensions.vector_dims(v_embedding) <> 1536 then
    raise exception 'PRODUCT_SEARCH_EMBEDDING_DIMENSION_INVALID';
  end if;

  insert into internal_product_registration.product_search_embeddings (
    tenant_id, catalog_product_id, channel, locale, snapshot_id, snapshot_hash,
    content_hash, model_version, embedding
  ) values (
    v_tenant_id, v_catalog_product_id, v_channel, v_locale, v_snapshot_id,
    v_snapshot_hash, v_content_hash, v_model_version, v_embedding
  ) on conflict (snapshot_id, model_version) do update
    set tenant_id = excluded.tenant_id,
        catalog_product_id = excluded.catalog_product_id,
        channel = excluded.channel,
        locale = excluded.locale,
        snapshot_hash = excluded.snapshot_hash,
        content_hash = excluded.content_hash,
        embedding = excluded.embedding,
        updated_at = now();

  return jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'snapshot_hash', v_snapshot_hash,
    'model_version', v_model_version,
    'persisted', true
  );
end;
$$;

create or replace function public.persist_product_registration_search_embedding(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.persist_search_embedding(p_payload);
$$;

revoke all on function internal_product_registration.claim_search_embedding_candidates(integer, text)
  from public, anon, authenticated;
revoke all on function public.claim_product_registration_search_embedding_candidates(integer, text)
  from public, anon, authenticated;
revoke all on function internal_product_registration.persist_search_embedding(jsonb)
  from public, anon, authenticated;
revoke all on function public.persist_product_registration_search_embedding(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.claim_search_embedding_candidates(integer, text)
  to service_role;
grant execute on function public.claim_product_registration_search_embedding_candidates(integer, text)
  to service_role;
grant execute on function internal_product_registration.persist_search_embedding(jsonb)
  to service_role;
grant execute on function public.persist_product_registration_search_embedding(jsonb)
  to service_role;

comment on table internal_product_registration.product_search_embeddings is
  'Operational search projection bound to one immutable published snapshot; never a product fact writer.';
