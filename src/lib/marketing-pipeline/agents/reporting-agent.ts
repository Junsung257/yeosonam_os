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
  protected override readonly agentRole = 'reporter' as const;

  // 오케스트레이터가 agentsRun을 주입
  constructor(private readonly input: ReportingInput) {
    super();
  }

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    const webhookUrl = getSecret('SLACK_PAYMENTS_WEBHOOK_URL') ?? getSecret('SLACK_WEBHOOK_URL');
    const summary = buildSummary(ctx, this.input.agentsRun);
    const adOsReport = buildAdOsReportPayload(ctx, this.input.agentsRun);
    if (!webhookUrl) return this.withContract({
      ok: true,
      skipped: true,
      skip_reason: 'SLACK_WEBHOOK_URL not configured',
      data: { slack_sent: false, reason: 'missing_webhook', ad_os_report: adOsReport },
    }, {
      input_summary: `${Object.keys(this.input.agentsRun).length} agent results summarized for local Ad OS reporting.`,
      evidence: adOsReport.agent_rows.map((row) => `${row.name}: ${row.status}`),
      decision: 'report_payload_ready',
      next_action: 'Review the generated Ad OS report payload locally or configure Slack for push reporting.',
      needs_human_approval: adOsReport.agent_rows.some((row) => row.needs_human_approval),
    });

    const result = await notifySlack('info', summary.headline, summary.context);

    return this.withContract({
      ok: result.sent,
      data: { slack_sent: result.sent, reason: result.reason, ad_os_report: adOsReport },
    }, {
      input_summary: `${Object.keys(this.input.agentsRun).length} agent results summarized for reporting.`,
      evidence: adOsReport.agent_rows.map((row) => `${row.name}: ${row.status}`),
      decision: result.sent ? 'report_delivered' : 'report_payload_ready',
      next_action: result.sent ? 'Review Slack report and approve any high-risk next actions.' : 'Inspect report payload and fix Slack delivery if needed.',
      needs_human_approval: adOsReport.agent_rows.some((row) => row.needs_human_approval),
    });
  }
}

export function buildAdOsReportPayload(
  ctx: MarketingContext,
  agentsRun: Record<string, AgentResult>,
) {
  const agentRows = Object.entries(agentsRun).map(([name, result]) => ({
    name,
    role: result.role || result.agent_contract?.role || 'operator',
    status: result.skipped ? 'skipped' : result.ok ? 'ok' : 'failed',
    input_summary: result.input_summary || result.agent_contract?.input_summary || `${name} agent run`,
    evidence: result.evidence || result.agent_contract?.evidence || [],
    decision: result.decision || result.agent_contract?.decision || (result.ok ? 'completed' : 'failed'),
    next_action: result.next_action || result.agent_contract?.next_action || '-',
    needs_human_approval: Boolean(result.needs_human_approval ?? result.agent_contract?.needs_human_approval),
  }));

  const failures = agentRows.filter((row) => row.status === 'failed');
  const approvalRows = agentRows.filter((row) => row.needs_human_approval);

  return {
    tenant_id: ctx.tenantId,
    run_date: ctx.runDate,
    status: failures.length > 0 ? 'needs_attention' : approvalRows.length > 0 ? 'approval_required' : 'ready',
    agent_rows: agentRows,
    client_summary: failures.length > 0
      ? `${failures.length} marketing agents need operator attention before client reporting.`
      : `${agentRows.length} marketing agents completed or skipped safely.`,
    next_actions: agentRows.map((row) => row.next_action).filter(Boolean).slice(0, 6),
  };
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
