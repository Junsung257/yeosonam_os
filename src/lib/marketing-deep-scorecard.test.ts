import { describe, expect, it } from 'vitest';
import {
  MARKETING_DEEP_SCORE_TARGET,
  MARKETING_DEEP_SOURCE_TARGET,
  MARKETING_SOURCE_LEDGER_REVIEWS,
  buildMarketingDeepRepairQueue,
  buildMarketingDeepScorecard,
  summarizeMarketingDeepScoreGate,
} from './marketing-deep-scorecard';

function readySummary() {
  return {
    ok: true,
    degraded: false,
    kpis: {
      keyword_candidates: 40,
      keyword_clusters: 8,
      search_term_candidates: 12,
      tracked_cta_clicks: 24,
      change_requests_proposed: 4,
    },
    recent_decisions: [{ id: 'decision-1' }],
    integration_status: { naver: true, google: true, meta: true, kakao: true },
    tenant_policy: {
      configured: true,
      max_automation_level: 3,
      full_auto_enabled: false,
      risk_status: 'normal',
    },
    channel_budgets: ['naver', 'google', 'meta', 'kakao'].map((platform) => ({
      platform,
      status: 'active',
      monthly_budget_krw: 100000,
      daily_budget_cap_krw: 10000,
      max_cpc_krw: 500,
      max_test_loss_krw: 20000,
      automation_level: 3,
    })),
    enterprise_layer: {
      runtime_execution: { external_api_write_count: 0 },
      write_packets: { external_api_write_count: 0 },
      channel_adapters: { rollback_drills: 'pass' },
      admin_surface_qa: { status: 'pass' },
    },
    learning_loop: {
      metrics: {
        clicks: 50,
        cta_clicks: 8,
        fact_clicks_30d: 50,
        fact_margin_krw_30d: 200000,
        fact_margin_roas_pct_30d: 400,
        attribution_events_30d: 6,
      },
    },
    samples: {
      keyword_plans: [{ id: 'kw-1' }],
      keyword_clusters: [{ id: 'cluster-1' }],
      search_term_candidates: [{ id: 'term-1' }],
      change_requests: [{ id: 'cr-1' }],
      creative_asset_variants: [{ id: 'creative-1' }],
      performance_facts: [{ id: 'fact-1' }],
      conversion_events: [{ id: 'conversion-1' }],
    },
  };
}

describe('MARKETING_SOURCE_LEDGER_REVIEWS', () => {
  it('contains at least 100 unique reviewed source records', () => {
    const urls = new Set(MARKETING_SOURCE_LEDGER_REVIEWS.map((source) => source.source_url));

    expect(MARKETING_SOURCE_LEDGER_REVIEWS.length).toBeGreaterThanOrEqual(MARKETING_DEEP_SOURCE_TARGET);
    expect(urls.size).toBe(MARKETING_SOURCE_LEDGER_REVIEWS.length);
    expect(MARKETING_SOURCE_LEDGER_REVIEWS.every((source) => source.status === 'accepted')).toBe(true);
  });
});

describe('buildMarketingDeepScorecard', () => {
  it('builds a 15-domain, 70+ subcategory scorecard with 95+ targets', () => {
    const scorecard = buildMarketingDeepScorecard({
      summary: readySummary(),
      sourceLedgerCount: MARKETING_DEEP_SOURCE_TARGET,
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    const subcategories = scorecard.domains.flatMap((domain) => domain.subcategories);

    expect(scorecard.summary.domain_count).toBeGreaterThanOrEqual(15);
    expect(scorecard.summary.subcategory_count).toBeGreaterThanOrEqual(70);
    expect(subcategories.every((item) => item.target_score >= MARKETING_DEEP_SCORE_TARGET)).toBe(true);
    expect(subcategories.every((item) => item.post_repair_score >= MARKETING_DEEP_SCORE_TARGET)).toBe(true);
  });

  it('keeps source ledger readiness tied to imported reviewed sources', () => {
    const low = buildMarketingDeepScorecard({ summary: readySummary(), sourceLedgerCount: 10 });
    const ready = buildMarketingDeepScorecard({
      summary: readySummary(),
      sourceLedgerCount: MARKETING_DEEP_SOURCE_TARGET,
    });

    expect(low.source_ledger.ready).toBe(false);
    expect(ready.source_ledger.ready).toBe(true);
  });

  it('creates repair rows for every subcategory below 95 with safe defaults', () => {
    const scorecard = buildMarketingDeepScorecard({ summary: {}, sourceLedgerCount: 0 });
    const gaps = scorecard.domains
      .flatMap((domain) => domain.subcategories)
      .filter((item) => item.score < MARKETING_DEEP_SCORE_TARGET);

    expect(scorecard.repair_queue).toHaveLength(gaps.length);
    expect(scorecard.repair_queue.every((item) => item.action.length > 0)).toBe(true);
    expect(scorecard.repair_queue.every((item) => item.safety.external_api_write === false)).toBe(true);
    expect(scorecard.repair_queue.every((item) => item.safety.live_spend_krw === 0)).toBe(true);
  });

  it('sorts repair queue by priority and current score', () => {
    const scorecard = buildMarketingDeepScorecard({ summary: {}, sourceLedgerCount: 0 });
    const queue = buildMarketingDeepRepairQueue(scorecard);
    const order = { P0: 0, P1: 1, P2: 2, P3: 3 };

    for (let index = 1; index < queue.length; index += 1) {
      const prev = queue[index - 1];
      const current = queue[index];
      expect(order[prev.priority]).toBeLessThanOrEqual(order[current.priority]);
      if (prev.priority === current.priority) {
        expect(prev.current_score).toBeLessThanOrEqual(current.current_score);
      }
    }
  });

  it('summarizes the 95 gate from deep subcategories', () => {
    const scorecard = buildMarketingDeepScorecard({ summary: {}, sourceLedgerCount: 0 });
    const gate = summarizeMarketingDeepScoreGate(scorecard);

    expect(gate.target).toBe(MARKETING_DEEP_SCORE_TARGET);
    expect(gate.passed).toBe(false);
    expect(gate.blockers.length).toBeGreaterThan(0);
  });
});
