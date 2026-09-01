-- V4 can leave a revision in needs_review for non-critical editorial or
-- completeness findings. V6 has a stricter terminal policy and may still
-- approve a safe degraded snapshot after evidence, copy, and mobile proof
-- pass. Promote only that exact degraded path inside the publication
-- transaction; unresolved/verified facts are never made publishable here.
do $migration$
declare
  v_definition text;
  v_old constant text := $old$
  if v_revision.status not in ('candidate', 'verified', 'approved', 'published') then
    raise exception 'REGISTRATION_PUBLICATION_REVISION_NOT_PUBLISHABLE:%', v_revision.status;
  end if;$old$;
  v_new constant text := $new$
  if v_revision.status = 'needs_review' and v_outcome = 'published_degraded' then
    perform public.promote_product_registration_v5_revision(v_revision_id, 'verified');
    v_revision.status := 'verified';
  end if;
  if v_revision.status not in ('candidate', 'verified', 'approved', 'published') then
    raise exception 'REGISTRATION_PUBLICATION_REVISION_NOT_PUBLISHABLE:%', v_revision.status;
  end if;$new$;
begin
  select pg_get_functiondef(
    'internal_product_registration.publish_snapshot_atomic(jsonb)'::regprocedure
  ) into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'REGISTRATION_DEGRADED_REVISION_PROMOTION_CONTRACT_UNKNOWN';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

revoke all on function internal_product_registration.publish_snapshot_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.publish_snapshot_atomic(jsonb)
  to service_role;
