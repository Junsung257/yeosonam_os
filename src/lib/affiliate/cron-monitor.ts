import { supabaseAdmin } from '@/lib/supabase';
import { sanitizeDbError } from '@/lib/error-sanitizer';

type FailureMeta = Record<string, unknown>;
type SuccessMeta = Record<string, unknown>;

export async function reportAffiliateCronFailure(
  cronName: string,
  error: unknown,
  meta: FailureMeta = {},
): Promise<void> {
  const message = sanitizeDbError(error, 'affiliate cron failed');
  const payload = {
    cron: cronName,
    message,
    meta,
    failed_at: new Date().toISOString(),
  };

  // 모니터링 보고 자체가 silent 면 사고를 추적할 수 없음 — stderr 로 최소 가시화.
  await supabaseAdmin.from('agent_actions').insert({
    agent_type: 'ops',
    action_type: 'notify_affiliate_cron_failure',
    summary: `[크론실패] ${cronName} - ${message}`,
    payload: payload as never,
    requested_by: 'jarvis',
    priority: 'critical',
    status: 'pending',
  } as never).then(
    () => {},
    (e: unknown) => console.error(`[cron-monitor] agent_actions insert failed for ${cronName}:`, sanitizeDbError(e)),
  );

  await supabaseAdmin.from('audit_logs').insert({
    action: 'AFFILIATE_CRON_FAILED',
    target_type: 'cron',
    target_id: cronName,
    description: `${cronName} failed: ${message}`,
    after_value: payload as never,
  } as never).then(
    () => {},
    (e: unknown) => console.error(`[cron-monitor] audit_logs insert failed for ${cronName}:`, sanitizeDbError(e)),
  );
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
  } as never).then(
    () => {},
    (e: unknown) => console.error(`[cron-monitor] audit_logs success insert failed for ${cronName}:`, sanitizeDbError(e)),
  );
}

