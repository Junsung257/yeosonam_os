/**
 * ReportingAgent — 파이프라인 결과를 Slack으로 보고
 *
 * 재사용: src/lib/slack-notifier.ts (notifySlack)
 * SLACK_WEBHOOK_URL 미설정 시 skip (best-effort)
 */
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { notifySlack } from '@/lib/slack-notifier';
import { getSecret } from '@/lib/secret-registry';

interface ReportingInput {
  agentsRun: Record<string, AgentResult>;
}

export class ReportingAgent extends BaseMarketingAgent {
  readonly name = 'reporting';

  // 오케스트레이터가 agentsRun을 주입
  constructor(private readonly input: ReportingInput) {
    super();
  }

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    const webhookUrl = getSecret('SLACK_PAYMENTS_WEBHOOK_URL') ?? getSecret('SLACK_WEBHOOK_URL');
    if (!webhookUrl) return this.skip('SLACK_WEBHOOK_URL 미설정');

    const summary = buildSummary(ctx, this.input.agentsRun);

    const result = await notifySlack('info', summary.headline, summary.context);

    return {
      ok: result.sent,
      data: { slack_sent: result.sent, reason: result.reason },
    };
  }
}

function buildSummary(
  ctx: MarketingContext,
  agentsRun: Record<string, AgentResult>,
): { headline: string; context: Record<string, unknown> } {
  const statusIcons: Record<string, string> = {
    ok_true: '✅',
    ok_skipped: '⏭️',
    ok_false: '❌',
  };

  const context: Record<string, unknown> = {
    테넌트: ctx.tenantId.slice(0, 8),
    날짜: ctx.runDate,
  };

  for (const [name, result] of Object.entries(agentsRun)) {
    let icon: string;
    if (result.skipped) icon = statusIcons.ok_skipped;
    else if (result.ok) icon = statusIcons.ok_true;
    else icon = statusIcons.ok_false;

    const detail = result.skipped
      ? result.skip_reason
      : result.ok
      ? summarizeData(result.data)
      : result.error?.slice(0, 80);

    context[`${icon} ${name}`] = detail ?? '-';
  }

  const failCount = Object.values(agentsRun).filter(r => !r.ok && !r.skipped).length;
  const headline =
    failCount === 0
      ? `데일리 마케팅 파이프라인 완료 (${ctx.runDate})`
      : `데일리 마케팅 파이프라인 ${failCount}건 실패 (${ctx.runDate})`;

  return { headline, context };
}

function summarizeData(data: unknown): string {
  if (!data || typeof data !== 'object') return '완료';
  const d = data as Record<string, unknown>;
  const parts: string[] = [];
  if ('generated' in d) parts.push(`생성 ${d.generated}건`);
  if ('sent' in d) parts.push(`발송 ${d.sent}건`);
  if ('actions_generated' in d) parts.push(`추천 ${d.actions_generated}건`);
  return parts.join(', ') || '완료';
}
