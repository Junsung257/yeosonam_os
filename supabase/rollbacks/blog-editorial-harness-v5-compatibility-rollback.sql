-- Blog editorial harness V5 emergency application-compatibility rollback.
--
-- Run only after the application has been rolled back. The additive trace
-- columns, call_kind ledger and V5 budget function are retained so no audit
-- evidence is destroyed and the V4 wrapper can continue to reserve generation
-- spend. Removing the approval constraint is enough for the previous
-- application version to write an approved attempt without V5 trace fields.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.blog_generation_attempts
  drop constraint if exists blog_generation_attempts_approved_prompt_trace_v1;

commit;
