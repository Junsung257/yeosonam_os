-- Blog autopublish recovery application-compatibility rollback.
-- Run only after the application rollback. Preserve the recovery ledger, but
-- freeze publication and disable the newer recovery entry point.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

update public.blog_publication_rollout_state
set status = 'frozen',
    stage = 'pilot_3',
    frozen_at = coalesce(frozen_at, now()),
    freeze_reason = coalesce(freeze_reason, 'application_rollback_after_autopublish_recovery'),
    healthy_window_streak = 0,
    state_version = state_version + 1,
    updated_at = now()
where scope = 'global'
  and status = 'active';

revoke execute on function public.recover_blog_publication_rollout_v1(bigint,uuid,uuid,text,text)
from service_role;

commit;
