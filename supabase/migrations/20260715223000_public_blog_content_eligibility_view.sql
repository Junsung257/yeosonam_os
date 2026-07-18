-- One server-only read source for every public blog surface.
-- Product-backed rows retain their existing published/channel/slug behavior.
-- Informational V2 rows fail closed unless review, quality, claim, and live representative truth agree.

begin;

alter table public.blog_indexing_jobs
  drop constraint if exists blog_indexing_jobs_status_check;
alter table public.blog_indexing_jobs
  add constraint blog_indexing_jobs_status_check
  check (status in ('pending', 'retry', 'processing', 'succeeded', 'failed', 'skipped'));

create or replace view public.public_blog_content_creatives
with (security_invoker = true)
as
select
  c.*,
  case
    when c.product_id is not null then 'product'
    when c.created_at < timestamptz '2026-07-15 00:00:00+09'
      and c.generation_meta -> 'content_brief' is null
      and coalesce(c.generation_meta ->> 'engine_version', '') <> 'blog-engine-v2'
      then 'information_legacy'
    else 'information_v2'
  end as public_eligibility_lane
from public.content_creatives c
left join public.blog_information_representatives r
  on r.canonical_creative_id = c.id
where c.status = 'published'
  and c.channel = 'naver_blog'
  and nullif(btrim(c.slug), '') is not null
  and coalesce(c.generation_meta ->> 'noindex', 'false') <> 'true'
  and coalesce(c.generation_meta -> 'seo' ->> 'noindex', 'false') <> 'true'
  and nullif(btrim(coalesce(c.generation_meta ->> 'redirect_to', '')), '') is null
  and nullif(btrim(coalesce(c.generation_meta ->> 'redirectTo', '')), '') is null
  and nullif(btrim(coalesce(c.generation_meta ->> 'canonical_redirect_to', '')), '') is null
  and (
    c.product_id is not null
    or (
      c.created_at < timestamptz '2026-07-15 00:00:00+09'
      and c.generation_meta -> 'content_brief' is null
      and coalesce(c.generation_meta ->> 'engine_version', '') <> 'blog-engine-v2'
    )
    or (
      nullif(btrim(coalesce(c.generation_meta -> 'content_brief' ->> 'destination_id', '')), '') is not null
      and coalesce(c.generation_meta -> 'content_brief' ->> 'destination_id', '') <> 'unknown'
      and coalesce(c.review_status, 'none') not in (
        'pending_review', 'in_review', 'rejected', 'changes_requested'
      )
      and (
        coalesce(c.generation_meta -> 'content_brief' ->> 'requires_human_review', 'false') <> 'true'
        and coalesce(c.generation_meta -> 'content_brief' ->> 'intent_type', '') not in (
          'entry_requirements', 'travel_insurance'
        )
        or c.review_status = 'approved'
      )
      and coalesce(c.quality_gate ->> 'passed', 'false') = 'true'
      and coalesce(c.generation_meta -> 'information_claim_validation' ->> 'passed', 'false') = 'true'
      and r.status = 'active'
      and r.canonical_creative_id = c.id
      and r.canonical_slug = c.slug
    )
  );

alter view public.public_blog_content_creatives set (security_invoker = true);
revoke all on public.public_blog_content_creatives from public, anon, authenticated;
grant select on public.public_blog_content_creatives to service_role;

comment on view public.public_blog_content_creatives is
  'Server-only canonical public blog read source. All public surfaces must query this view.';

commit;
