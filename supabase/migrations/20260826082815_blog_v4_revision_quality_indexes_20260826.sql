-- Supporting indexes for the new revision/decision foreign keys.
create index if not exists idx_blog_content_operations_final_decision
  on public.blog_content_operations(final_quality_decision_id)
  where final_quality_decision_id is not null;

create index if not exists idx_blog_content_revisions_parent
  on public.blog_content_revisions(parent_revision_id)
  where parent_revision_id is not null;
