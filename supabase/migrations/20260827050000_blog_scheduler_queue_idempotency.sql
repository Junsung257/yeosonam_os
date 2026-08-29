-- Scheduler queue refill idempotency.
-- Existing rows are preserved; only one representative of an already-active
-- duplicate is keyed so this migration does not delete or rewrite content.

begin;

alter table public.blog_topic_queue
  add column if not exists automation_key text;

with ranked as (
  select
    id,
    md5(lower(trim(concat_ws('|',
      coalesce(source, ''),
      coalesce(topic, ''),
      coalesce(destination, ''),
      coalesce(product_id::text, '')
    )))) as derived_key,
    row_number() over (
      partition by md5(lower(trim(concat_ws('|',
        coalesce(source, ''),
        coalesce(topic, ''),
        coalesce(destination, ''),
        coalesce(product_id::text, '')
      ))))
      order by created_at, id
    ) as duplicate_rank
  from public.blog_topic_queue
  where status in ('queued', 'generating', 'deferred', 'pending_review', 'processing')
)
update public.blog_topic_queue queue
set automation_key = ranked.derived_key
from ranked
where queue.id = ranked.id
  and ranked.duplicate_rank = 1
  and queue.automation_key is null;

create unique index if not exists idx_blog_topic_queue_automation_key
  on public.blog_topic_queue (automation_key);

comment on column public.blog_topic_queue.automation_key is
  'Deterministic scheduler identity; duplicate refills are ignored by the database.';

commit;
