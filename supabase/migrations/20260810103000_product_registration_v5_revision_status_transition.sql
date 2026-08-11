-- V5 content remains append-only, while its review lifecycle has an explicit
-- service-only transition. A reviewer must not rewrite canonical fields just
-- to move candidate -> verified/approved.

create or replace function public.product_registration_v5_reject_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
begin
  if tg_table_name = 'product_registration_v5_revisions'
     and current_setting('product_registration_v5.status_transition', true) = '1'
     and (to_jsonb(old) - 'status') = (to_jsonb(new) - 'status')
     and (
       (old.status = 'candidate' and new.status in ('verified', 'needs_review', 'blocked'))
       or (old.status = 'needs_review' and new.status in ('candidate', 'verified', 'blocked'))
       or (old.status = 'verified' and new.status in ('approved', 'blocked'))
       or (old.status = 'approved' and new.status in ('published', 'blocked'))
       or (old.status = 'published' and new.status in ('superseded', 'blocked'))
     ) then
    return new;
  end if;

  raise exception '% is append-only; create a new revision instead', tg_table_name;
end;
$$;

create or replace function public.promote_product_registration_v5_revision(
  p_revision_id uuid,
  p_target_status text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_current_status text;
  v_revision_id uuid;
begin
  if p_target_status not in ('candidate', 'needs_review', 'verified', 'approved', 'published', 'superseded', 'blocked') then
    raise exception 'V5_REVISION_STATUS_INVALID:%', p_target_status;
  end if;

  select status into v_current_status
  from public.product_registration_v5_revisions
  where id = p_revision_id
  for update;

  if not found then
    raise exception 'V5_REVISION_NOT_FOUND';
  end if;

  if not (
    (v_current_status = 'candidate' and p_target_status in ('verified', 'needs_review', 'blocked'))
    or (v_current_status = 'needs_review' and p_target_status in ('candidate', 'verified', 'blocked'))
    or (v_current_status = 'verified' and p_target_status in ('approved', 'blocked'))
    or (v_current_status = 'approved' and p_target_status in ('published', 'blocked'))
    or (v_current_status = 'published' and p_target_status in ('superseded', 'blocked'))
  ) then
    raise exception 'V5_REVISION_STATUS_TRANSITION_INVALID:%->%', v_current_status, p_target_status;
  end if;

  perform set_config('product_registration_v5.status_transition', '1', true);
  update public.product_registration_v5_revisions
  set status = p_target_status
  where id = p_revision_id
  returning id into v_revision_id;

  return v_revision_id;
end;
$$;

revoke all on function public.product_registration_v5_reject_mutation() from public, anon, authenticated;
revoke all on function public.promote_product_registration_v5_revision(uuid, text) from public, anon, authenticated;
grant execute on function public.promote_product_registration_v5_revision(uuid, text) to service_role;
