-- Blog V4 unattended lane state contract.
-- Additive: permits explicit skipped generation and quality-blocked
-- publication projections without conflating them with human review.

begin;

alter table public.blog_content_operations
  drop constraint if exists blog_content_operations_generation_status_check,
  drop constraint if exists blog_content_operations_publication_status_check;

alter table public.blog_content_operations
  add constraint blog_content_operations_generation_status_check
  check (generation_status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  add constraint blog_content_operations_publication_status_check
  check (publication_status in (
    'not_eligible', 'quality_blocked', 'suppressed_by_policy', 'not_attempted',
    'queued', 'publishing', 'published', 'failed'
  ));

comment on column public.blog_content_operations.generation_status is
  'V4 generation lifecycle; skipped means policy discarded before any model call.';
comment on column public.blog_content_operations.publication_status is
  'V4 publication lifecycle; quality_blocked is distinct from policy suppression.';

commit;
