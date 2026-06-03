import { describe, expect, it } from 'vitest';
import {
  buildAttributionSummary,
  buildExternalMutationAuditRow,
  normalizeConversionEventsToPerformanceFacts,
} from '@/lib/ad-os-v26-v30';

describe('Ad OS V26-V30 enterprise helpers', () => {
  it('aggregates clean conversion events into margin-based performance facts', () => {
    const facts = normalizeConversionEventsToPerformanceFacts([
      {
        id: 'e1',
        event_type: 'click',
        event_time: '2026-06-02T01:00:00.000Z',
        platform: 'naver',
        product_id: '11111111-1111-1111-1111-111111111111',
        keyword_text: '부산 부모님 다낭',
        cost_krw: 120,
        quarantine_status: 'clean',
      },
      {
        id: 'e2',
        event_type: 'cta_click',
        event_time: '2026-06-02T01:05:00.000Z',
        platform: 'naver',
        product_id: '11111111-1111-1111-1111-111111111111',
        keyword_text: '부산 부모님 다낭',
        quarantine_status: 'clean',
      },
      {
        id: 'e3',
        event_type: 'booking',
        event_time: '2026-06-02T01:10:00.000Z',
        platform: 'naver',
        product_id: '11111111-1111-1111-1111-111111111111',
        keyword_text: '부산 부모님 다낭',
        revenue_krw: 800000,
        margin_krw: 160000,
        quarantine_status: 'clean',
      },
      {
        id: 'e4',
        event_type: 'booking',
        event_time: '2026-06-02T01:12:00.000Z',
        platform: 'naver',
        product_id: '11111111-1111-1111-1111-111111111111',
        keyword_text: '부산 부모님 다낭',
        revenue_krw: 999999,
        quarantine_status: 'quarantined',
      },
    ]);

    expect(facts).toHaveLength(1);
    expect(facts[0].clicks).toBe(1);
    expect(facts[0].cta_clicks).toBe(1);
    expect(facts[0].conversions).toBe(1);
    expect(facts[0].revenue_krw).toBe(800000);
    expect(facts[0].margin_krw).toBe(160000);
    expect(facts[0].metrics.source_event_count).toBe(3);

    const summary = buildAttributionSummary(facts);
    expect(summary.margin_roas_pct).toBeGreaterThan(1000);
    expect(summary.cpa_krw).toBe(120);
  });

  it('creates idempotent external mutation audit rows without spending externally', () => {
    const row = buildExternalMutationAuditRow({
      runId: 'run-1',
      platform: 'naver',
      mode: 'guarded',
      canPublish: true,
      changeRequest: {
        id: 'cr-1',
        request_type: 'publish_paused_keyword',
        proposed_change: { keyword: '부산출발 다낭' },
      },
      account: {
        external_account_id: 'acct-1',
        external_campaign_id: 'cmp-1',
        external_ad_group_id: 'grp-1',
      },
    });

    expect(row.mutation_type).toBe('create_paused_keyword');
    expect(row.mode).toBe('paused_only');
    expect(row.status).toBe('requested');
    expect(row.idempotency_key).toBe('naver:cr-1:paused_only');
    expect(row.request_payload.external_spend_allowed).toBe(false);
    expect(row.response_payload.external_api_write).toBe(false);
  });

  it('marks mutation audits blocked when channel gates fail', () => {
    const row = buildExternalMutationAuditRow({
      runId: 'run-2',
      platform: 'google',
      mode: 'dry_run',
      canPublish: false,
      errorMessage: 'permission_denied',
      changeRequest: {
        id: 'cr-2',
        request_type: 'create_campaign',
      },
    });

    expect(row.status).toBe('blocked');
    expect(row.error_message).toBe('permission_denied');
  });
});
