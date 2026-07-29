-- Only one active quality-upgrade queue row may own an informational
-- representative key. The partial unique index closes cross-invocation races;
-- rows completed or deliberately skipped no longer hold the key.

create unique index concurrently if not exists blog_topic_queue_active_quality_upgrade_representative_uidx
  on public.blog_topic_queue ((meta #>> '{quality_upgrade,representative_key}'))
  where status in ('queued', 'generating', 'pending_review')
    and nullif(meta #>> '{quality_upgrade,representative_key}', '') is not null;
