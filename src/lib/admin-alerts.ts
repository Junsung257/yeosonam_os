/**
 * Admin Alerts — 사장님이 검토할 자동 시그널 큐.
 *
 * 종류:
 *   - policy_winner: 정책 A/B 비교 winner 판정 (활성 전환 추천)
 *   - feature_change: 패키지 features 변경 감지 (호텔 등급↑/↓ 등)
 *   - ltr_ready: LTR 학습 샘플 1000건 도달
 *   - general: 기타
 *
 * 사용:
 *   await postAlert({ category: 'policy_winner', title: '...', ... })
 *
 * 미래: Slack webhook 연동 시 critical은 즉시 푸시
 */
import { supabaseAdmin } from '@/lib/supabase';

export interface AlertInput {
  category: 'policy_winner' | 'feature_change' | 'ltr_ready' | 'general';
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  message?: string;
  ref_type?: string;
  ref_id?: string;
  meta?: Record<string, unknown>;
  /** 같은 ref_type+ref_id 으로 미해결 알림이 있으면 dedupe (재INSERT X) */
  dedupe?: boolean;
}

/** Slack webhook 즉시 푸시 — env SLACK_ALERTS_WEBHOOK 있을 때만, critical/warning만 */
async function pushSlackAlert(input: AlertInput): Promise<void> {
  const url = process.env.SLACK_ALERTS_WEBHOOK;
  if (!url) return;
  if (input.severity === 'info') return; // info는 큐만, push X
  const emoji = input.severity === 'critical' ? '🚨' : '⚠️';
  const text = `${emoji} *${input.title}*\n${input.message ?? ''}\n\`${input.category}\`${input.ref_type && input.ref_id ? ` · ${input.ref_type}=${input.ref_id}` : ''}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.warn('[slack-alert]', e instanceof Error ? e.message : 'failed');
  }
}

export async function postAlert(input: AlertInput): Promise<{ id?: number; deduped?: boolean }> {
  if (input.dedupe && input.ref_type && input.ref_id) {
    const { data: existing } = await supabaseAdmin
      .from('admin_alerts')
      .select('id')
      .eq('category', input.category)
      .eq('ref_type', input.ref_type)
      .eq('ref_id', input.ref_id)
      .is('acknowledged_at', null)
      .limit(1);
    if (existing && existing.length > 0) return { deduped: true };
  }
  const { data, error } = await supabaseAdmin.from('admin_alerts').insert({
    category: input.category,
    severity: input.severity ?? 'info',
    title: input.title,
    message: input.message ?? null,
    ref_type: input.ref_type ?? null,
    ref_id: input.ref_id ?? null,
    meta: input.meta ?? null,
  }).select('id').single();
  if (error) {
    console.error('[admin-alerts]', error.message);
    return {};
  }
  // critical/warning 은 Slack 즉시 푸시 (env 있을 때만)
  await pushSlackAlert(input);
  return { id: data?.id };
}

export async function ackAlert(id: number): Promise<void> {
  await supabaseAdmin.from('admin_alerts')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id);
}
