import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getRevenueRescueCronMode,
  isRevenueRescueCronExecutionAllowed,
  REVENUE_RESCUE_CAPABILITIES,
} from './revenue-rescue-capability-policy';

describe('revenue rescue capability policy', () => {
  it('uses the P0 business defaults', () => {
    expect(REVENUE_RESCUE_CAPABILITIES).toEqual({
      advertising: 'observe_only',
      content_generation: 'draft_only',
      public_publishing: 'human_approval_required',
      price_change: 'disabled',
      refund_settlement_payout: 'human_approval_required',
      agent_autonomous_write: 'disabled',
      reservation_lead_collection: 'enabled',
      audit_logging: 'enabled',
    });
  });

  it.each([
    '/api/cron/meta-optimize',
    '/api/cron/blog-publisher',
    '/api/cron/agent-executor',
    '/api/cron/dynamic-pricing',
    '/api/cron/solapi-review-request',
  ])('disables unapproved mutation cron %s', (pathname) => {
    expect(getRevenueRescueCronMode(pathname)).toBe('disabled');
    expect(isRevenueRescueCronExecutionAllowed(pathname)).toBe(false);
  });

  it.each([
    '/api/cron/booking-tasks-runner',
    '/api/cron/payment-stale-alert',
    '/api/cron/ledger-reconcile',
    '/api/cron/magic-tokens-cleanup',
    '/api/cron/meta-token-refresh',
  ])('keeps revenue or security essential cron %s enabled', (pathname) => {
    expect(getRevenueRescueCronMode(pathname)).toBe('enabled');
    expect(isRevenueRescueCronExecutionAllowed(pathname)).toBe(true);
  });

  it('keeps unclassified cron work observe-only by default', () => {
    expect(getRevenueRescueCronMode('/api/cron/seo-monitor')).toBe('observe_only');
    expect(isRevenueRescueCronExecutionAllowed('/api/cron/seo-monitor')).toBe(true);
  });

  it('blocks every cron classified as PAUSE in the locked inventory', () => {
    const inventory = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          'docs/audits/20260729-revenue-rescue/outputs/cron-inventory.json',
        ),
        'utf8',
      ),
    ) as { inventory: Array<{ route: string; decision: string }> };
    const paused = inventory.inventory.filter((row) => row.decision === 'PAUSE');

    expect(paused).toHaveLength(28);
    for (const row of paused) {
      expect(getRevenueRescueCronMode(row.route), row.route).toBe('disabled');
    }
  });
});
