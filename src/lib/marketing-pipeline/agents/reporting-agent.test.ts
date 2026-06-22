import { describe, expect, it } from 'vitest';
import { buildAdOsReportPayload } from './reporting-agent';
import type { AgentResult, MarketingContext } from '../base-agent';

const ctx: MarketingContext = { tenantId: 'tenant-1', runDate: '2026-06-22' };

describe('ReportingAgent Ad OS payload', () => {
  it('keeps role contract, evidence, next action, and approval flags in the report payload', () => {
    const agentsRun: Record<string, AgentResult> = {
      content: {
        ok: true,
        elapsed_ms: 10,
        role: 'copywriter',
        input_summary: 'Products for copy.',
        evidence: ['2 drafts'],
        decision: 'draft_content_created',
        next_action: 'Review copy.',
        needs_human_approval: true,
      },
      optimization: {
        ok: false,
        elapsed_ms: 20,
        error: 'GSC failed',
        role: 'performance_analyst',
        input_summary: 'GSC metrics.',
        evidence: ['GSC failed'],
        decision: 'failed',
        next_action: 'Fix GSC.',
        needs_human_approval: true,
      },
    };

    const payload = buildAdOsReportPayload(ctx, agentsRun);

    expect(payload.status).toBe('needs_attention');
    expect(payload.agent_rows).toHaveLength(2);
    expect(payload.agent_rows[0]).toMatchObject({
      name: 'content',
      role: 'copywriter',
      decision: 'draft_content_created',
      next_action: 'Review copy.',
      needs_human_approval: true,
    });
    expect(payload.next_actions).toEqual(['Review copy.', 'Fix GSC.']);
  });
});
