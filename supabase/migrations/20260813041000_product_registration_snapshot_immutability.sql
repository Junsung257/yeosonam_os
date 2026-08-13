-- Customer proof is valid only for the exact immutable snapshot body that was
-- rendered. Lifecycle columns may advance, but corrections must create a new
-- snapshot instead of rewriting or deleting the proven record.

create or replace function internal_product_registration.guard_public_snapshot_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'REGISTRATION_PUBLIC_SNAPSHOT_DELETE_FORBIDDEN:%', old.id;
  end if;

  if old.package_id is distinct from new.package_id
    or old.package_revision is distinct from new.package_revision
    or old.snapshot_hash is distinct from new.snapshot_hash
    or old.snapshot_version is distinct from new.snapshot_version
    or old.snapshot_json is distinct from new.snapshot_json
    or old.card_projection is distinct from new.card_projection
    or old.lp_projection is distinct from new.lp_projection
    or old.route_text_dump is distinct from new.route_text_dump
    or old.source_raw_text_hash is distinct from new.source_raw_text_hash
    or old.parser_revision is distinct from new.parser_revision
    or old.audit_revision is distinct from new.audit_revision
    or old.mobile_proof_revision is distinct from new.mobile_proof_revision
    or old.app_build_id is distinct from new.app_build_id
    or old.catalog_product_id is distinct from new.catalog_product_id
    or old.tenant_id is distinct from new.tenant_id
    or old.canonical_revision_id is distinct from new.canonical_revision_id
    or old.renderer_build_id is distinct from new.renderer_build_id
    or old.created_at is distinct from new.created_at then
    raise exception 'REGISTRATION_PUBLIC_SNAPSHOT_BODY_IMMUTABLE:%', old.id;
  end if;

  if old.published_at is not null
    and new.published_at is distinct from old.published_at then
    raise exception 'REGISTRATION_PUBLIC_SNAPSHOT_PUBLISHED_AT_IMMUTABLE:%', old.id;
  end if;

  if old.superseded_at is not null
    and new.superseded_at is distinct from old.superseded_at then
    raise exception 'REGISTRATION_PUBLIC_SNAPSHOT_SUPERSEDED_AT_IMMUTABLE:%', old.id;
  end if;

  if old.status = 'published'
    and new.status <> 'published'
    and exists (
      select 1
      from public.product_registration_v5_publication_pointers p
      where p.current_snapshot_id = old.id
        and p.state = 'published'
    ) then
    raise exception 'REGISTRATION_PUBLIC_SNAPSHOT_STILL_REFERENCED:%', old.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_public_package_snapshots_immutable
  on public.public_package_snapshots;
create trigger trg_public_package_snapshots_immutable
before update or delete on public.public_package_snapshots
for each row execute function internal_product_registration.guard_public_snapshot_immutability();

revoke all on function internal_product_registration.guard_public_snapshot_immutability()
  from public, anon, authenticated;
grant execute on function internal_product_registration.guard_public_snapshot_immutability()
  to service_role;

comment on function internal_product_registration.guard_public_snapshot_immutability() is
  'Makes proof-bound public snapshot bodies append-only. Only lifecycle fields may advance; referenced published snapshots cannot be downgraded.';
