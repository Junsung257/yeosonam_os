/**
 * Slack 알림 helper — 결제/정산 운영 이벤트.
 *
 * env:
 *   SLACK_PAYMENTS_WEBHOOK_URL  (전용 채널)
 *   SLACK_WEBHOOK_URL           (폴백)
 *
 * 키 없으면 silent skip (개발 환경 등). 실패도 throw 안 함 — best-effort.
 */

export type SlackKind = 'reverse' | 'rules-learned' | 'stale' | 'critical' | 'info';

const KIND_PREFIX: Record<SlackKind, string> = {
  reverse: '↩',
  'rules-learned': '🎓',
  stale: '⏰',
  critical: '🚨',
  info: 'ℹ️',
};

export async function notifySlack(
  kind: SlackKind,
  message: string,
  context?: Record<string, unknown>,
): Promise<{ sent: boolean; reason?: string }> {
  const url =
    process.env.SLACK_PAYMENTS_WEBHOOK_URL ?? process.env.SLACK_WEBHOOK_URL ?? '';
  if (!url) return { sent: false, reason: 'no webhook configured' };

  const text = `${KIND_PREFIX[kind]} ${message}`;
  const blocks: any[] = [
    { type: 'section', text: { type: 'mrkdwn', text } },
  ];
  if (context && Object.keys(context).length > 0) {
    const fields = Object.entries(context).map(([k, v]) => ({
      type: 'mrkdwn',
      text: `*${k}*: ${formatValue(v)}`,
    }));
    blocks.push({ type: 'section', fields: fields.slice(0, 10) });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
      // 외부 호출 — Vercel timeout 방어
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? { sent: true } : { sent: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : 'unknown' };
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'string') return v.slice(0, 120);
  return JSON.stringify(v).slice(0, 120);
}
