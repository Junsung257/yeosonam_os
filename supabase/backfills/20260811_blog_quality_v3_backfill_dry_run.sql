-- Read-only preflight. This file intentionally contains no mutation.
begin transaction read only;

select 'content_timestamp_candidates' check_name,
       count(*) filter (where content_modified_at is null) missing_content_modified_at,
       count(*) filter (where fact_checked_at is null) missing_fact_checked_at,
       count(*) filter (where last_verified_at is null) missing_last_verified_at
from public.content_creatives
where channel = 'naver_blog' and slug is not null;

select 'review_blocked_published' check_name, count(*) rows
from public.content_creatives
where channel = 'naver_blog' and status = 'published'
  and review_status in ('pending_review','in_review','rejected','changes_requested');

select 'active_queue_without_observed_demand' check_name, count(*) rows
from public.blog_topic_queue q
where q.status in ('queued','generating','pending_review')
  and not exists (
    select 1 from public.blog_demand_signals d
    where d.queue_id = q.id and d.verified_at is not null
      and (d.expires_at is null or d.expires_at > now())
  );

select 'claim_expiry_missing' check_name, risk_level, count(*) rows
from public.blog_information_claims
where risk_level in ('HIGH','MEDIUM') and expires_at is null
group by risk_level;

select 'snapshot_candidate_count' check_name, count(*) rows
from public.public_blog_content_creatives;

select 'media_metadata_missing' check_name,
       count(*) filter (where perceptual_hash is null) missing_phash,
       count(*) filter (where license is null) missing_license,
       count(*) filter (where width is null or height is null) missing_dimensions
from public.blog_media_assets;

rollback;
