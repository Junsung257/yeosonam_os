-- Restore publications that were already public before the informational V2 contract.
-- New publications still require current claim, review, and representative truth.

begin;

create or replace view public.public_blog_content_creatives
with (security_invoker = true)
as
select
  c.id,
  c.tenant_id,
  c.product_id,
  c.angle_type,
  c.target_audience,
  c.channel,
  c.image_ratio,
  c.slides,
  c.blog_html,
  c.ad_copy,
  c.tracking_id,
  c.tone,
  c.extra_prompt,
  c.status,
  c.published_at,
  c.slug,
  c.seo_title,
  c.seo_description,
  c.og_image_url,
  c.created_at,
  c.updated_at,
  c.category,
  c.prompt_version,
  c.ai_model,
  c.ai_temperature,
  c.sub_keyword,
  c.generation_params,
  c.category_id,
  c.publish_scheduled_at,
  c.view_count,
  c.quality_gate,
  c.topic_source,
  c.generation_meta,
  c.destination,
  c.target_ad_keywords,
  c.landing_headline,
  c.landing_subtitle,
  c.landing_enabled,
  c.featured,
  c.featured_order,
  c.content_type,
  c.pillar_for,
  c.readability_score,
  c.readability_issues,
  c.source,
  c.band_post_url,
  c.review_status,
  c.cta_text,
  c.seo_score,
  c.metrics,
  case
    when c.product_id is not null then 'product'
    when c.published_at < timestamptz '2026-07-15 00:00:00+09'
      and coalesce(c.quality_gate ->> 'passed', 'false') = 'true'
      and coalesce(c.review_status, 'none') not in (
        'pending_review', 'in_review', 'rejected', 'changes_requested'
      )
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
      c.published_at < timestamptz '2026-07-15 00:00:00+09'
      and coalesce(c.quality_gate ->> 'passed', 'false') = 'true'
      and coalesce(c.review_status, 'none') not in (
        'pending_review', 'in_review', 'rejected', 'changes_requested'
      )
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
  'Server-only canonical public blog source. Pre-contract quality-passed publications retain public visibility; later information requires current V2 evidence.';

commit;
