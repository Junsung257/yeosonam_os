-- A published pointer is the only customer-visible publication authority.
-- Validate the final transaction state so publish_snapshot_atomic may update
-- the pointer before the immutable snapshot inside the same transaction, but
-- no direct or legacy writer can commit a split-brain publication.

create or replace function internal_product_registration.assert_published_pointer_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_valid boolean;
begin
  if new.state <> 'published' then
    return null;
  end if;
  if new.current_revision_id is null or new.current_snapshot_id is null then
    raise exception 'REGISTRATION_PUBLISHED_POINTER_LINEAGE_REQUIRED';
  end if;

  select exists (
    select 1
    from public.public_package_snapshots s
    join public.product_registration_v5_revisions r
      on r.id = new.current_revision_id
     and r.id = s.canonical_revision_id
     and r.tenant_id = new.tenant_id
     and r.catalog_product_id = new.catalog_product_id
    join public.product_registration_v5_proof_runs p
      on p.public_snapshot_id = s.id
     and p.revision_id = r.id
     and p.package_id = new.package_id
     and p.catalog_product_id = new.catalog_product_id
     and p.tenant_id = new.tenant_id
     and p.snapshot_hash = s.snapshot_hash
     and p.renderer_build_id = s.renderer_build_id
     and p.status = 'passed'
    where s.id = new.current_snapshot_id
      and s.package_id = new.package_id
      and s.catalog_product_id = new.catalog_product_id
      and s.tenant_id = new.tenant_id
      and s.status = 'published'
      and s.renderer_build_id is not null
      and lower(s.renderer_build_id) !~ '^(local|dev|development|unknown)(?:[-_:]|$)'
  ) into v_valid;

  if not v_valid then
    raise exception 'REGISTRATION_PUBLISHED_POINTER_INTEGRITY_VIOLATION';
  end if;
  return null;
end;
$$;

revoke all on function internal_product_registration.assert_published_pointer_integrity()
  from public, anon, authenticated;

-- Existing split-brain pointers predate this invariant. Quarantine them
-- without deleting their revision/snapshot history, and leave an authority
-- event that explains why the customer route stayed closed.
do $$
begin
  perform set_config('app.product_registration_writer', 'publication-kernel', true);

  insert into internal_product_registration.registration_authority_events (
    tenant_id, catalog_product_id, revision_id, package_id, operation_key,
    writer_id, authority_mode, event_type, input_hash, result
  )
  select
    ptr.tenant_id, ptr.catalog_product_id, ptr.current_revision_id, ptr.package_id,
    'pointer-integrity-reconcile:' || ptr.package_id::text || ':' || ptr.channel || ':' || ptr.locale,
    'publication-kernel', cfg.authority_mode, 'publication_pointer_quarantined',
    encode(extensions.digest(convert_to(concat_ws('|', ptr.package_id::text,
      ptr.current_revision_id::text, ptr.current_snapshot_id::text, ptr.pointer_version::text), 'UTF8'), 'sha256'), 'hex'),
    jsonb_build_object('previous_state', ptr.state, 'reason', 'PUBLISHED_POINTER_INTEGRITY_VIOLATION')
  from public.product_registration_v5_publication_pointers ptr
  cross join internal_product_registration.registration_authority_config cfg
  where cfg.singleton = true
    and ptr.state = 'published'
    and ptr.tenant_id is not null
    and not exists (
      select 1
      from public.public_package_snapshots s
      join public.product_registration_v5_revisions r
        on r.id = ptr.current_revision_id and r.id = s.canonical_revision_id
      join public.product_registration_v5_proof_runs p
        on p.public_snapshot_id = s.id and p.revision_id = r.id
       and p.snapshot_hash = s.snapshot_hash and p.renderer_build_id = s.renderer_build_id
       and p.status = 'passed'
      where s.id = ptr.current_snapshot_id and s.package_id = ptr.package_id
        and s.catalog_product_id = ptr.catalog_product_id and s.tenant_id = ptr.tenant_id
        and s.status = 'published'
        and lower(coalesce(s.renderer_build_id, 'unknown')) !~ '^(local|dev|development|unknown)(?:[-_:]|$)'
    )
  on conflict (tenant_id, operation_key, event_type) do nothing;

  update public.product_registration_v5_publication_pointers ptr
  set state = 'blocked', pointer_version = pointer_version + 1, updated_at = now()
  where ptr.state = 'published'
    and not exists (
      select 1
      from public.public_package_snapshots s
      join public.product_registration_v5_revisions r
        on r.id = ptr.current_revision_id and r.id = s.canonical_revision_id
       and r.tenant_id = ptr.tenant_id and r.catalog_product_id = ptr.catalog_product_id
      join public.product_registration_v5_proof_runs p
        on p.public_snapshot_id = s.id and p.revision_id = r.id
       and p.package_id = ptr.package_id and p.catalog_product_id = ptr.catalog_product_id
       and p.tenant_id = ptr.tenant_id and p.snapshot_hash = s.snapshot_hash
       and p.renderer_build_id = s.renderer_build_id and p.status = 'passed'
      where s.id = ptr.current_snapshot_id and s.package_id = ptr.package_id
        and s.catalog_product_id = ptr.catalog_product_id and s.tenant_id = ptr.tenant_id
        and s.status = 'published'
        and lower(coalesce(s.renderer_build_id, 'unknown')) !~ '^(local|dev|development|unknown)(?:[-_:]|$)'
    );
end;
$$;

drop trigger if exists trg_product_registration_published_pointer_integrity
  on public.product_registration_v5_publication_pointers;
create constraint trigger trg_product_registration_published_pointer_integrity
after insert or update of state, current_revision_id, current_snapshot_id,
  tenant_id, catalog_product_id, package_id
on public.product_registration_v5_publication_pointers
deferrable initially deferred
for each row
execute function internal_product_registration.assert_published_pointer_integrity();

comment on function internal_product_registration.assert_published_pointer_integrity() is
  'Deferred invariant: every published pointer must end the transaction bound to one published immutable snapshot, exact revision, passed proof, tenant/catalog identity, and deploy renderer build.';
