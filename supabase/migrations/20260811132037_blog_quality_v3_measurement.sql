-- Consent-aware, non-PII content funnel and field performance dimensions.
begin;

alter table public.blog_engagement_logs
  drop constraint if exists blog_engagement_logs_event_type_check;
alter table public.blog_engagement_logs
  add constraint blog_engagement_logs_event_type_check check (event_type in (
    'summary','engaged_60_seconds','scroll_25','scroll_50','scroll_75','scroll_90',
    'source_link_click','related_article_click','destination_hub_click',
    'product_click','consultation_click','cta_impression','cta_click'
  ));
alter table public.blog_engagement_logs
  add column if not exists route text null,
  add column if not exists device text null,
  add column if not exists connection_type text null,
  add column if not exists navigation_type text null,
  add column if not exists consent_state text not null default 'unknown'
    check (consent_state in ('unknown','granted','denied')),
  add column if not exists search_query_hash char(64) null;

alter table public.web_vitals
  add column if not exists route text null,
  add column if not exists device text null,
  add column if not exists connection_type text null,
  add column if not exists navigation_type text null,
  add column if not exists consent_state text not null default 'unknown'
    check (consent_state in ('unknown','granted','denied'));

alter table public.analytics_server_events
  add column if not exists assisting_content_creative_id uuid null
    references public.content_creatives(id) on delete set null,
  add column if not exists search_query_hash char(64) null;

create index if not exists idx_blog_engagement_funnel on public.blog_engagement_logs(content_creative_id, event_type, created_at desc);
create index if not exists idx_web_vitals_route_metric on public.web_vitals(route, name, created_at desc);
create index if not exists idx_analytics_assisting_content on public.analytics_server_events(assisting_content_creative_id, occurred_at desc)
  where assisting_content_creative_id is not null;

comment on column public.blog_engagement_logs.search_query_hash is 'Optional one-way hash of an observed query; raw search terms are not collected from visitors.';
comment on column public.analytics_server_events.assisting_content_creative_id is 'Article that assisted the server-side qualified lead, purchase, or booking event.';

commit;
