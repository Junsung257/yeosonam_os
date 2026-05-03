import { supabaseAdmin } from '@/lib/supabase';

type FailureMeta = Record<string, unknown>;
type SuccessMeta = Record<string, unknown>;

export async function reportAffiliateCronFailure(
  cronName: string,
  error: unknown,
  meta: FailureMeta = {},
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error || 'unknown');
  const stack = error instanceof Error ? error.stack : null;
  const payload = {
    cron: cronName,
    message,
    stack,
    meta,
    failed_at: new Date().toISOString(),
  };

  await supabaseAdmin.from('agent_actions').insert({
    agent_type: 'ops',
    action_type: 'notify_affiliate_cron_failure',
    summary: `[크론실패] ${cronName} - ${message}`,
    payload: payload as never,
    requested_by: 'jarvis',
    priority: 'critical',
    status: 'pending',
  } as never).then(() => {}).catch(() => {});

  await supabaseAdmin.from('audit_logs').insert({
    action: 'AFFILIATE_CRON_FAILED',
    target_type: 'cron',
    target_id: cronName,
    description: `${cronName} failed: ${message}`,
    after_value: payload as never,
  } as never).then(() => {}).catch(() => {});
}

export async function reportAffiliateCronSuccess(
  cronName: string,
  meta: SuccessMeta = {},
): Promise<void> {
  const payload = {
    cron: cronName,
    meta,
    succeeded_at: new Date().toISOString(),
  };

  await supabaseAdmin.from('audit_logs').insert({
    action: 'AFFILIATE_CRON_SUCCEEDED',
    target_type: 'cron',
    target_id: cronName,
    description: `${cronName} succeeded`,
    after_value: payload as never,
  } as never).then(() => {}).catch(() => {});
}

