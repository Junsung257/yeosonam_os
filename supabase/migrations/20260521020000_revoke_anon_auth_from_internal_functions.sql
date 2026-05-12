-- ============================================================================
-- Revoke EXECUTE on internal/admin SECURITY DEFINER functions from anon + authenticated
-- ============================================================================
-- Context:
--   Supabase advisor flagged 44 functions executable by anon/authenticated.
--   Many are internal admin/cron/RAG helpers that should never be reachable
--   from the public surface. service_role retains EXECUTE (BYPASS), so server
--   code (supabaseAdmin) is unaffected.
--
--   Verified each callsite in `src/` uses `supabaseAdmin.rpc(...)`.
--
--   Postgres function default ACL is `=X/postgres` (PUBLIC has EXECUTE) and
--   anon/authenticated are PUBLIC members. Direct REVOKE FROM anon/authenticated
--   silently no-ops when the privilege is inherited via PUBLIC, so we REVOKE
--   FROM PUBLIC instead. service_role retains EXECUTE (explicit grant).
--
-- Functions in scope (this PR — most clearly server-only):
--   - get_admin_badge_counts          (admin sidebar counters)
--   - get_unmatched_summary           (admin reconciliation)
--   - merge_customer_tags             (admin bulk action)
--   - refresh_mv_destination_aggregates (nightly cron)
--   - resync_paid_amounts             (admin maintenance)
--   - cleanup_expired_semantic_cache  (cron)
--   - calculate_rfm_scores            (cron / segmentation)
--   - track_price_changes             (cron)
--   - bump_customer_facts_access      (jarvis internal — fact-extractor)
--   - jarvis_hybrid_search            (jarvis RAG — server only)
--   - set_jarvis_request_context      (jarvis internal)
--   - increment_semantic_cache_hit    (server-side after lookup)
--
-- Public RPCs (kept open intentionally — not in this list):
--   increment_package_view_count, increment_package_inquiry_count,
--   get_destinations_aggregate, get_trending_packages,
--   get_simple_recommendations, get_personalized_by_destination,
--   increment_affiliate_booking_count, increment_customer_mileage,
--   lookup_semantic_cache, update_customer_profile_on_booking (trigger).
--   These will be evaluated in follow-up PRs after wider caller analysis.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.get_admin_badge_counts()                              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_unmatched_summary(integer)                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_customer_tags(uuid[], text)                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_mv_destination_aggregates()                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resync_paid_amounts()                                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_semantic_cache()                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.calculate_rfm_scores()                                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.track_price_changes()                                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bump_customer_facts_access(uuid[])                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.jarvis_hybrid_search(vector, text, uuid, text[], integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_jarvis_request_context(uuid, text, uuid)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_semantic_cache_hit(uuid)                    FROM PUBLIC;
