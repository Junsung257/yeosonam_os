-- Fail-closed publication guard for revision status.
--
-- The initial CAS function rejects the known non-publishable statuses. This
-- database trigger makes the positive allow-list authoritative as well, so a
-- future publication path cannot accidentally promote a shadow `candidate`
-- revision by omitting a status check.

create or replace function public.product_registration_v5_guard_publication_pointer()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_status text;
begin
  if new.current_revision_id is null then
    return new;
  end if;

  select status
    into v_status
  from public.product_registration_v5_revisions
  where id = new.current_revision_id
    and (package_id is null or package_id = new.package_id);

  if not found then
    raise exception 'V5_PUBLICATION_REVISION_NOT_FOUND';
  end if;

  if v_status not in ('verified', 'approved', 'published') then
    raise exception 'V5_PUBLICATION_REVISION_NOT_PUBLISHABLE:%', v_status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_product_registration_v5_publication_pointer_status
  on public.product_registration_v5_publication_pointers;

create trigger trg_product_registration_v5_publication_pointer_status
before insert or update of current_revision_id
on public.product_registration_v5_publication_pointers
for each row
execute function public.product_registration_v5_guard_publication_pointer();

revoke all on function public.product_registration_v5_guard_publication_pointer() from public, anon, authenticated;
grant execute on function public.product_registration_v5_guard_publication_pointer() to service_role;
