import { describe, expect, it } from 'vitest';
import {
  AD_OS_SECTION_SCORE_TARGET,
  AD_OS_SOURCE_LEDGER_TARGET,
  buildAdDirectorRun,
  buildMarketingSectionScores,
  classifyMcpQuery,
} from './ad-os-ai-director';

function readySummary() {
  return {
    ok: true,
    generated_at: '2026-06-28T00:00:00.000Z',
    kpis: {
      keyword_candidates: 40,
      keyword_clusters: 8,
      search_term_candidates: 12,
      landing_blogs: 6,
      published_blogs: 6,
      tracked_cta_clicks: 24,
      change_requests_proposed: 4,
    },
    counts: {},
    readiness_audit: { score: 108, maxScore: 108 },
    recent_decisions: [{ id: 'decision-1' }],
    launch_action_queue: [{ id: 'audit' }],
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
      completion_audit: { readiness_score: 100 },
      runtime_readiness: { blocked_or_failed: 0 },
      runtime_execution: { external_api_write_count: 0 },
      channel_adapters: { snapshots: 4 },
      write_packets: { packets: 4, external_api_write_count: 0 },
      conversion_data_quality: { status: 'ready', blocked_conversions: 0 },
      creative_factory: { variants: 8, duplicate_content_risks: 0 },
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
      change_requests: [{ id: 'cr-1', request_type: 'create_card_news' }],
      platform_write_packets: [{ platform: 'kakao' }],
      creative_asset_variants: [{ id: 'creative-1' }],
      blog_versions: [{ id: 'blog-1' }],
      travel_intent_signals: [{ id: 'intent-1' }],
      performance_facts: [{ id: 'fact-1' }],
      conversion_events: [{ id: 'conversion-1' }],
    },
  };
}

describe('buildMarketingSectionScores', () => {
  it('passes all sections when evidence, caps, integrations, and source ledger are ready', () => {
    const scores = buildMarketingSectionScores(readySummary(), AD_OS_SOURCE_LEDGER_TARGET);

    expect(scores.every((score) => score.score >= AD_OS_SECTION_SCORE_TARGET)).toBe(true);
    expect(scores.every((score) => score.status === 'pass')).toBe(true);
  });

  it('blocks data attribution when performance facts and source ledger are missing', () => {
    const summary = readySummary();
    summary.samples.performance_facts = [];
    summary.learning_loop.metrics.fact_clicks_30d = 0;
    summary.learning_loop.metrics.fact_margin_krw_30d = 0;
    summary.learning_loop.metrics.fact_margin_roas_pct_30d = 0;

    const scores = buildMarketingSectionScores(summary, 10);
    const dataScore = scores.find((score) => score.section_key === 'data_attribution');

    expect(dataScore?.status).not.toBe('pass');
    expect(dataScore?.blockers).toContain('Performance facts exist');
    expect(dataScore?.recommendations).toEqual(expect.arrayContaining([
      'Import and review at least 100 official/open-source/research sources.',
    ]));
  });
});

describe('buildAdDirectorRun', () => {
  it('keeps dry-run read-only and creates no external-write packets', () => {
    const run = buildAdDirectorRun({
      summary: readySummary(),
      mode: 'dry_run',
      sourceLedgerCount: AD_OS_SOURCE_LEDGER_TARGET,
    });

    expect(run.safety.read_only).toBe(true);
    expect(run.safety.external_api_write).toBe(false);
    expect(run.write_packets.every((packet) => packet.external_api_write === false && packet.dry_run === true)).toBe(true);
  });

  it('allows guarded L3 database staging but still forbids live spend and external writes', () => {
    const run = buildAdDirectorRun({
      summary: readySummary(),
      mode: 'guarded_l3',
      apply: true,
      sourceLedgerCount: AD_OS_SOURCE_LEDGER_TARGET,
    });

    expect(run.safety.database_mutation).toBe(true);
    expect(run.safety.live_spend_krw).toBe(0);
    expect(run.safety.full_auto_allowed).toBe(false);
    expect(run.decisions.some((decision) => decision.can_auto_apply_l3)).toBe(true);
  });
});

describe('classifyMcpQuery', () => {
  it('allows known read-only MCP queries', () => {
    const result = classifyMcpQuery({
      provider: 'google_ads_mcp',
      toolName: 'list_campaigns',
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe('allowed_read_only');
  });

  it('blocks mutating MCP tools', () => {
    const result = classifyMcpQuery({
      provider: 'google_ads_mcp',
      toolName: 'create_campaign',
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('blocked_mutation');
    expect(result.safety.external_api_write).toBe(false);
  });
});
