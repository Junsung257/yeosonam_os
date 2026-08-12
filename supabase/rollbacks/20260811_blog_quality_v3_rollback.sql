-- MANUAL ROLLBACK ONLY. Review retained snapshot/history data before running.
-- This file is not invoked by the application and was not applied in this mission.
begin;

drop trigger if exists trg_enqueue_generate_lead_analytics_event on public.leads;
drop function if exists public.enqueue_generate_lead_analytics_event();
drop table if exists public.analytics_server_event_outbox;
alter table public.leads drop constraint if exists leads_search_query_hash_format;
alter table public.leads
  drop column if exists assisting_content_creative_id,
  drop column if exists search_query_hash;

drop view if exists public.blog_information_claim_ledger_v3;
drop view if exists public.public_blog_content_creatives;
drop function if exists public.refresh_blog_public_snapshots_v3();
drop function if exists public.archive_blog_public_snapshot_v3();
drop function if exists public.evaluate_blog_public_eligibility_v3(uuid,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,text,uuid,text);

drop table if exists public.blog_public_catalog_facets;
drop table if exists public.blog_public_snapshot_history;
drop table if exists public.blog_public_snapshots;
drop table if exists public.blog_content_media;
drop table if exists public.blog_media_assets;
alter table public.content_creatives drop constraint if exists content_creatives_author_profile_id_fkey;
drop table if exists public.blog_author_profiles;
drop table if exists public.blog_quality_evaluations;
drop table if exists public.blog_content_signatures;
drop table if exists public.blog_demand_signals;
drop table if exists public.blog_search_performance;
drop table if exists public.blog_headline_experiments;
drop table if exists public.blog_url_dispositions;
drop table if exists public.blog_publication_decisions;

alter table public.blog_information_sources
  drop column if exists source_title,
  drop column if exists source_domain,
  drop column if exists source_published_at;
alter table public.blog_information_source_versions
  drop column if exists source_title,
  drop column if exists source_domain,
  drop column if exists source_published_at;
alter table public.blog_information_claims
  drop column if exists effective_from,
  drop column if exists expires_at,
  drop column if exists conflict_status;
alter table public.content_reviews drop column if exists review_scope;
alter table public.content_creatives
  drop column if exists content_document,
  drop column if exists content_modified_at,
  drop column if exists fact_checked_at,
  drop column if exists last_verified_at,
  drop column if exists material_update_reason,
  drop column if exists author_profile_id;

drop index if exists public.idx_blog_engagement_funnel;
drop index if exists public.idx_web_vitals_route_metric;
drop index if exists public.idx_analytics_assisting_content;
alter table public.blog_engagement_logs
  drop constraint if exists blog_engagement_logs_event_type_check,
  drop column if exists route,
  drop column if exists device,
  drop column if exists connection_type,
  drop column if exists navigation_type,
  drop column if exists consent_state,
  drop column if exists search_query_hash;
alter table public.blog_engagement_logs add constraint blog_engagement_logs_event_type_check
  check (event_type in ('summary','scroll_25','scroll_50','scroll_75','scroll_90','cta_impression','cta_click'));
alter table public.web_vitals
  drop column if exists route,
  drop column if exists device,
  drop column if exists connection_type,
  drop column if exists navigation_type,
  drop column if exists consent_state;
alter table public.analytics_server_events
  drop column if exists assisting_content_creative_id,
  drop column if exists search_query_hash;

-- Restore the immediately preceding server-only eligibility view.
create view public.public_blog_content_creatives with (security_invoker = true) as
select c.*,
  case
    when c.product_id is not null then 'product'
    when c.published_at < timestamptz '2026-07-15 00:00:00+09' then 'information_legacy'
    else 'information_v2'
  end as public_eligibility_lane
from public.content_creatives c
left join public.blog_information_representatives r on r.canonical_creative_id = c.id
where c.status = 'published' and c.channel = 'naver_blog' and nullif(btrim(c.slug), '') is not null
  and coalesce(c.generation_meta ->> 'noindex', 'false') <> 'true'
  and coalesce(c.generation_meta -> 'seo' ->> 'noindex', 'false') <> 'true'
  and nullif(btrim(coalesce(c.generation_meta ->> 'redirect_to', '')), '') is null
  and nullif(btrim(coalesce(c.generation_meta ->> 'redirectTo', '')), '') is null
  and nullif(btrim(coalesce(c.generation_meta ->> 'canonical_redirect_to', '')), '') is null
  and (
    c.product_id is not null
    or (c.published_at < timestamptz '2026-07-15 00:00:00+09'
      and coalesce(c.quality_gate ->> 'passed', 'false') = 'true'
      and coalesce(c.review_status, 'none') not in ('pending_review','in_review','rejected','changes_requested'))
    or (nullif(btrim(coalesce(c.generation_meta -> 'content_brief' ->> 'destination_id', '')), '') is not null
      and coalesce(c.generation_meta -> 'content_brief' ->> 'destination_id', '') <> 'unknown'
      and coalesce(c.review_status, 'none') not in ('pending_review','in_review','rejected','changes_requested')
      and ((coalesce(c.generation_meta -> 'content_brief' ->> 'requires_human_review', 'false') <> 'true'
        and coalesce(c.generation_meta -> 'content_brief' ->> 'intent_type', '') not in ('entry_requirements','travel_insurance'))
        or c.review_status = 'approved')
      and coalesce(c.quality_gate ->> 'passed', 'false') = 'true'
      and coalesce(c.generation_meta -> 'information_claim_validation' ->> 'passed', 'false') = 'true'
      and r.status = 'active' and r.canonical_creative_id = c.id and r.canonical_slug = c.slug)
  );
revoke all on public.public_blog_content_creatives from public, anon, authenticated;
grant select on public.public_blog_content_creatives to service_role;

commit;

-- Intentionally retained after rollback:
-- - idx_cc_public_blog_list_v2 remains the used equivalent of the removed
--   zero-scan idx_cc_published_blog_nulls_last. Recreating a duplicate index
--   would add write overhead without restoring behavior.
-- - the qualified representative_key reference in
--   replace_blog_information_reviewed_draft_atomically remains because
--   reverting it would reintroduce an ambiguous PL/pgSQL expression.
