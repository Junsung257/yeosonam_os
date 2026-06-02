import { describe, expect, it } from 'vitest';
import {
  buildBidOptimizerCandidates,
  buildGoogleConversionExportPackets,
  buildMetaConversionExportPackets,
  decideExperimentRun,
  gateNaverChangeRequests,
  summarizeConversionPackets,
} from './ad-os-v31-v40';

describe('ad-os-v31-v40 conversion exports', () => {
  it('builds Google-ready packets only for clean exportable conversion signals', () => {
    const packets = buildGoogleConversionExportPackets([
      {
        id: 'evt-1',
        event_type: 'booking',
        gclid: 'gclid-123',
        revenue_krw: 1000000,
        margin_krw: 120000,
        raw_payload: { email: 'Buyer@Example.com' },
      },
      {
        id: 'evt-2',
        event_type: 'click',
        gclid: 'gclid-456',
      },
    ]);

    expect(packets[0].ready_for_upload).toBe(true);
    expect(packets[0].identifiers.email_sha256).toHaveLength(64);
    expect(packets[1].ready_for_upload).toBe(false);
    expect(packets[1].blocked_reason).toBe('event_type_not_exportable');
    expect(summarizeConversionPackets(packets)).toMatchObject({ total: 2, ready_for_upload: 1, blocked: 1 });
  });

  it('uses Meta first-party or click identifiers and blocks quarantined signals', () => {
    const packets = buildMetaConversionExportPackets([
      { id: 'evt-1', event_type: 'cta_click', session_id: 's-1' },
      { id: 'evt-2', event_type: 'booking', fbclid: 'fb-1', quarantine_status: 'quarantined' },
    ]);

    expect(packets[0].ready_for_upload).toBe(true);
    expect(packets[0].event_name).toBe('Contact');
    expect(packets[1].ready_for_upload).toBe(false);
    expect(packets[1].blocked_reason).toBe('signal_quarantined');
  });
});

describe('ad-os-v31-v40 bid optimizer', () => {
  it('creates pause, scale, and landing candidates from performance facts', () => {
    const candidates = buildBidOptimizerCandidates([
      {
        id: 'waste',
        platform: 'naver',
        clicks: 15,
        cta_clicks: 0,
        cost_krw: 12000,
        keyword_text: 'expensive no cta',
        ad_landing_mapping_id: 'map-1',
      },
      {
        id: 'winner',
        platform: 'google',
        clicks: 30,
        cta_clicks: 5,
        conversions: 2,
        cost_krw: 50000,
        margin_krw: 200000,
        keyword_text: 'winner',
        ad_landing_mapping_id: 'map-2',
      },
      {
        id: 'bounce',
        platform: 'meta',
        sessions: 20,
        bounces: 16,
        cta_clicks: 0,
        content_creative_id: 'blog-1',
      },
    ]);

    expect(candidates.map((candidate) => candidate.request_type)).toEqual(['pause_keyword', 'increase_bid', 'update_blog_cta']);
  });
});

describe('ad-os-v31-v40 experiment runner', () => {
  it('starts approved experiments and completes running experiments with enough clicks', () => {
    expect(decideExperimentRun({ id: 'exp-1', status: 'approved', experiment_type: 'landing_ab', name: 'A/B' }, [])).toMatchObject({
      next_status: 'running',
    });

    const completed = decideExperimentRun(
      { id: 'exp-2', status: 'running', experiment_type: 'landing_ab', name: 'A/B', minimum_sample: { clicks: 20 } },
      [{ id: 'fact-1', platform: 'naver', clicks: 25, cost_krw: 10000, conversions: 1, margin_krw: 40000 }],
      '2026-06-02T00:00:00.000Z',
    );

    expect(completed.next_status).toBe('completed');
    expect(completed.patch.result_summary).toMatchObject({ clicks: 25, margin_roas_pct: 400 });
  });
});

describe('ad-os-v31-v40 naver execution gate', () => {
  it('allows paused keyword publishing but blocks active mutations in paused_only mode', () => {
    const gates = gateNaverChangeRequests(
      [
        { id: 'cr-1', status: 'approved', request_type: 'publish_paused_keyword' },
        { id: 'cr-2', status: 'approved', request_type: 'activate_paused_keyword' },
      ],
      'paused_only',
      { integrationReady: true, permissionOk: true, campaignReady: true, budgetReady: true, automationLevel: 3 },
    );

    expect(gates[0]).toMatchObject({ allowed: true, mutation_type: 'create_paused_keyword' });
    expect(gates[1]).toMatchObject({ allowed: false, reason: 'paused_only_blocks_active_mutation' });
  });
});
