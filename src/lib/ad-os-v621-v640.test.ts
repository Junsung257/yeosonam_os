import { describe, expect, it } from 'vitest';
import { buildAdOsLearningEvidence } from './ad-os-v621-v640';

describe('buildAdOsLearningEvidence', () => {
  it('marks learning ready when performance facts include all core dimensions and margin metrics', () => {
    const evidence = buildAdOsLearningEvidence([{
      id: 'fact-1',
      tenant_id: 'tenant-1',
      product_id: 'pkg-1',
      scenario_id: 'family-danang',
      keyword_text: '부산 부모님 다낭 패키지',
      ad_landing_mapping_id: 'landing-1',
      content_creative_id: 'creative-1',
      platform: 'naver',
      clicks: 20,
      cta_clicks: 5,
      conversions: 2,
      cost_krw: 10_000,
      revenue_krw: 1_000_000,
      margin_krw: 100_000,
      sessions: 20,
      bounces: 4,
    }]);

    expect(evidence.status).toBe('ready');
    expect(evidence.readiness_score).toBe(100);
    expect(evidence.metrics.cpa_krw).toBe(5000);
    expect(evidence.metrics.margin_roas_pct).toBe(1000);
    expect(evidence.candidates.some((row) => row.type === 'scale_winner')).toBe(true);
    expect(evidence.safety.external_api_write).toBe(false);
  });

  it('returns partial evidence and asks for missing dimensions when facts are too thin', () => {
    const evidence = buildAdOsLearningEvidence([{
      id: 'fact-thin',
      platform: 'naver',
      clicks: 12,
      cta_clicks: 0,
      cost_krw: 8_000,
    }]);

    expect(evidence.status).toBe('partial');
    expect(evidence.missing_dimensions).toEqual(expect.arrayContaining(['product', 'keyword', 'blog_or_landing', 'creative']));
    expect(evidence.candidates.map((row) => row.type)).toEqual(expect.arrayContaining(['pause_waste', 'collect_dimensions']));
  });

  it('blocks learning when no facts exist', () => {
    const evidence = buildAdOsLearningEvidence([]);

    expect(evidence.status).toBe('blocked');
    expect(evidence.facts).toBe(0);
    expect(evidence.candidates[0]).toMatchObject({ type: 'collect_dimensions' });
  });
});
