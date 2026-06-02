import { describe, expect, it } from 'vitest';
import {
  buildEnterpriseKeywordBrain,
  buildEnterpriseTenantReport,
  buildNaverExternalAssetPlan,
} from '@/lib/ad-os-v19-v25';

describe('Ad OS V19-V25 enterprise helpers', () => {
  it('mines distinct longtail keywords from travel product facts', () => {
    const candidates = buildEnterpriseKeywordBrain({
      product: {
        id: 'pkg-1',
        title: 'Busan Air Busan Danang package',
        destination: '다낭',
        departureAirport: '부산',
        airline: '에어부산',
        priceKrw: 599000,
        ticketDeadline: '2026-06-10',
      },
      winningSearchTerms: ['부산 부모님 다낭 여행'],
      wasteSearchTerms: ['다낭 항공권만'],
      existingKeywords: ['다낭 패키지'],
      limit: 20,
      maxCpcGuardKrw: 500,
    });

    expect(candidates.some((row) => row.keyword.includes('부산'))).toBe(true);
    expect(candidates.some((row) => row.keyword.includes('부모님'))).toBe(true);
    expect(candidates.some((row) => row.tier === 'negative')).toBe(true);
    expect(candidates.every((row) => row.suggestedBidKrw <= 500)).toBe(true);
    expect(candidates.some((row) => row.keyword === '다낭 패키지')).toBe(false);
  });

  it('blocks Naver external asset requests until credentials and guardrails are ready', () => {
    const blocked = buildNaverExternalAssetPlan({
      campaignName: 'YSN_Danang',
      adGroupName: 'YSN_Danang_longtail',
      dailyBudgetKrw: 0,
      monthlyBudgetKrw: 100000,
      maxCpcKrw: 500,
      approvedKeywordCount: 10,
      existingCampaigns: 0,
      existingAdgroups: 0,
      existingChannels: 0,
      integrationReady: false,
      tenantAllowed: true,
    });

    expect(blocked.canRequest).toBe(false);
    expect(blocked.blockers).toContain('naver_credentials_missing');

    const ready = buildNaverExternalAssetPlan({
      campaignName: 'YSN_Danang',
      adGroupName: 'YSN_Danang_longtail',
      dailyBudgetKrw: 10000,
      monthlyBudgetKrw: 100000,
      maxCpcKrw: 500,
      approvedKeywordCount: 10,
      existingCampaigns: 0,
      existingAdgroups: 0,
      existingChannels: 0,
      integrationReady: true,
      tenantAllowed: true,
    });

    expect(ready.canRequest).toBe(true);
    expect(ready.mutations.map((row) => row.requestType)).toContain('create_campaign');
    expect(ready.mutations.map((row) => row.requestType)).toContain('publish_paused_keyword');
  });

  it('summarizes tenant advertising economics on margin basis', () => {
    const report = buildEnterpriseTenantReport({
      spendKrw: 100000,
      revenueKrw: 800000,
      marginKrw: 180000,
      conversions: 4,
      ctaClicks: 20,
      clicks: 100,
      budgetCapKrw: 500000,
      pausedWasteKeywords: 3,
      discoveredCheapKeywords: 8,
      externalMutations: 2,
      keywordClusters: 25,
    });

    expect(report.budget_usage_pct).toBe(20);
    expect(report.margin_roas_pct).toBe(180);
    expect(report.cpa_krw).toBe(25000);
    expect(report.next_actions.length).toBe(3);
  });
});
