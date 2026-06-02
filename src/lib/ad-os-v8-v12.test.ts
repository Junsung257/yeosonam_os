import { describe, expect, it } from 'vitest';
import {
  buildAdOsExperimentPlan,
  buildSearchTermHarvestRows,
  buildTenantAdReport,
  classifyAdOsConversionSignal,
} from './ad-os-v8-v12';

describe('ad-os-v8-v12 enterprise helpers', () => {
  it('quarantines test/admin/bot conversion signals before learning upload', () => {
    const signal = classifyAdOsConversionSignal({
      eventType: 'booking',
      userAgent: 'Playwright Headless',
      isAdmin: true,
      revenueKrw: 1000000,
      marginKrw: 120000,
    });

    expect(signal.quarantineStatus).toBe('quarantined');
    expect(signal.excludedFromLearning).toBe(true);
    expect(signal.excludedFromPlatformUpload).toBe(true);
    expect(signal.reasons).toContain('admin_event');
  });

  it('normalizes winning and waste search terms into action queues', () => {
    const rows = buildSearchTermHarvestRows([
      {
        platform: 'google',
        searchTerm: '부산 부모님 다낭 패키지',
        keywordText: '다낭 패키지',
        matchType: 'broad',
        impressions: 100,
        clicks: 10,
        ctr: 10,
        costKrw: 5000,
        conversions: 2,
      },
      {
        platform: 'google',
        searchTerm: '다낭 호텔 예약',
        keywordText: '다낭 패키지',
        matchType: 'broad',
        impressions: 5000,
        clicks: 5,
        ctr: 0.1,
        costKrw: 25000,
        conversions: 0,
      },
    ]);

    expect(rows[0].action).toBe('add_keyword');
    expect(rows[0].priority).toBe('high');
    expect(rows[1].action).toBe('add_negative');
  });

  it('keeps bandit disabled while creating experiment candidates', () => {
    const plans = buildAdOsExperimentPlan({
      clicks: 180,
      ctaClicks: 50,
      conversions: 3,
      revenueKrw: 2000000,
      marginKrw: 300000,
      platform: 'naver',
    });

    expect(plans.length).toBeGreaterThanOrEqual(3);
    expect(plans.every((plan) => plan.expected_impact.bandit_enabled === false)).toBe(true);
  });

  it('separates revenue ROAS and margin ROAS for tenant reports', () => {
    const report = buildTenantAdReport({
      spendKrw: 100000,
      revenueKrw: 1000000,
      marginKrw: 150000,
      conversions: 5,
      ctaClicks: 20,
      clicks: 100,
      pausedWasteKeywords: 3,
      discoveredCheapKeywords: 7,
      budgetCapKrw: 500000,
    });

    expect(report.revenue_roas_pct).toBe(1000);
    expect(report.margin_roas_pct).toBe(150);
    expect(report.cpa_krw).toBe(20000);
    expect(report.budget_usage_pct).toBe(20);
  });
});
