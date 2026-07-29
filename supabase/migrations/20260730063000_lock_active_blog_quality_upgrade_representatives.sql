-- Production creates and verifies this index concurrently before migration
-- replay. Fresh databases replay the same idempotent definition during
-- bootstrap, when no production writes exist.

create unique index if not exists blog_topic_queue_active_quality_upgrade_representative_uidx
  on public.blog_topic_queue ((meta #>> '{quality_upgrade,representative_key}'))
  where status in ('queued', 'generating', 'pending_review')
    and nullif(meta #>> '{quality_upgrade,representative_key}', '') is not null;
