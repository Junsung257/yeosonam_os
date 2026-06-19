import { getSecret } from '@/lib/secret-registry';

const SLACK_ALERT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.SLACK_ALERT_TIMEOUT_MS || '5000') || 5000,
);

export function resolveSlackAlertWebhookUrl(): string | null {
  return (
    getSecret('SLACK_ALERT_WEBHOOK_URL') ||
    getSecret('SLACK_ALERTS_WEBHOOK') ||
    getSecret('SLACK_ALERTS_WEBHOOK_URL') ||
    getSecret('SLACK_CWV_WEBHOOK_URL') ||
    getSecret('SLACK_WEBHOOK_URL')
  );
}

/**
 * 운영 경고용 Slack 알림 유틸.
 * env SLACK_ALERT_WEBHOOK_URL 미설정 시 조용히 skip.
 * 사용처: 크론 실패, 토큰 만료, DLQ dead 등.
 */
export async function sendSlackAlert(message: string, context?: Record<string, unknown>): Promise<void> {
  const url = resolveSlackAlertWebhookUrl();
  if (!url) return;
  try {
    const body = context
      ? `${message}\n\`\`\`${JSON.stringify(context, null, 2)}\`\`\``
      : message;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: body }),
      signal: AbortSignal.timeout(SLACK_ALERT_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn('[slack-alert] 실패 (무시):', e instanceof Error ? e.message : e);
  }
}
