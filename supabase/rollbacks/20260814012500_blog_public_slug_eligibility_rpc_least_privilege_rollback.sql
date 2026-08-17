-- Manual rollback. Restore only if an authenticated client adopts this RPC.
begin;
grant execute on function public.is_blog_public_slug_eligible_v3(text) to authenticated;
commit;
