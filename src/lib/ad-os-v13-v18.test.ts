import { describe, expect, it } from 'vitest';
import {
  buildBudgetOpsDecision,
  buildCreativeFactoryDrafts,
  buildPublisherOpsPlan,
  buildTenantSaasPackaging,
  decideDuplicateContentAction,
  mineLongtailKeywords,
  normalizeFunnelEvent,
} from '@/lib/ad-os-v13-v18';

describe('ad-os-v13-v18 enterprise ops', () => {
  it('keeps publisher mutations paused until every guardrail passes', () => {
    const naver = buildPublisherOpsPlan({
      platform: 'naver',
      credentialsReady: true,
      permissionReady: true,
      campaignReady: true,
      adGroupReady: true,
      budgetReady: true,
      approvedKeywords: 12,
      tenantAllowed: true,
    });

    expect(naver.state).toBe('executable');
    expect(naver.defaultMutationMode).toBe('active_allowed');
    expect(naver.requiredChangeRequests.map((row) => row.requestType)).toContain('publish_paused_keyword');
    expect(naver.requiredChangeRequests.map((row) => row.requestType)).toContain('activate_paused_keyword');

    const google = buildPublisherOpsPlan({
      platform: 'google',
      credentialsReady: true,
      permissionReady: false,
      campaignReady: false,
      budgetReady: true,
      approvedKeywords: 3,
      tenantAllowed: true,
      conversionActionReady: false,
      finalUrlPolicyReady: false,
    });

    expect(google.state).toBe('permission_denied');
    expect(google.canActivate).toBe(false);
  });

  it('normalizes funnel events and quarantines polluted conversion signals', () => {
    const event = normalizeFunnelEvent({
      eventType: 'booking',
      platform: 'google',
      gclid: 'gclid-1',
      revenueKrw: 500000,
      marginKrw: -1000,
      costKrw: 10000,
      userAgent: 'Mozilla/5.0',
    });

    expect(event.click_id).toBe('gclid-1');
    expect(event.margin_roas_pct).toBe(-10);
    expect(event.quarantine_status).toBe('review');
    expect(event.excluded_from_learning).toBe(true);
  });

  it('mines intent long-tail keywords and excludes known waste terms', () => {
    const rows = mineLongtailKeywords({
      product: {
        destination: '다낭',
        departureAirport: '부산',
        airline: '에어부산',
        priceKrw: 599000,
      },
      winningSearchTerms: ['부모님 다낭'],
      wasteSearchTerms: ['다낭 마감 임박 패키지'],
      existingKeywords: ['에어부산 다낭 패키지'],
    });

    expect(rows.some((row) => row.keyword.includes('부산 출발 다낭'))).toBe(true);
    expect(rows.some((row) => row.keyword === '에어부산 다낭 패키지')).toBe(false);
    expect(rows.some((row) => row.keyword === '다낭 마감 임박 패키지')).toBe(false);
  });

  it('prevents mass duplicate blog generation for similar products', () => {
    expect(
      decideDuplicateContentAction({
        sameDestinationActiveProducts: 500,
        sameScenarioExistingPosts: 2,
        scenarioIsDistinct: false,
      }).action,
    ).toBe('update_hub_or_faq');
  });

  it('blocks budget mutations during cooldown or kill switch', () => {
    const decision = buildBudgetOpsDecision({
      platform: 'naver',
      monthlyBudgetKrw: 100000,
      dailyBudgetCapKrw: 5000,
      actualSpendKrw: 90000,
      automationLevel: 3,
      status: 'active',
      cooldownActive: true,
      now: new Date('2026-06-15T00:00:00.000Z'),
    });

    expect(decision.recommendedAction).toBe('no_change');
    expect(decision.canApplyInternally).toBe(false);
  });

  it('creates draft-only creative packs and tenant packaging labels', () => {
    const drafts = buildCreativeFactoryDrafts({ destination: '다낭', productTitle: '부산출발 다낭 패키지' });
    expect(drafts).toHaveLength(6);
    expect(drafts.every((draft) => draft.publishMode === 'draft_only')).toBe(true);

    const packaging = buildTenantSaasPackaging({
      monthlyBudgetCapKrw: 100000,
      dailyBudgetCapKrw: 5000,
      automationLevel: 2,
      requireHumanApproval: true,
      fullAutoEnabled: false,
      marginRoasPct: 180,
      cpaKrw: 12000,
    });
    expect(packaging.productReadinessLabel).toBe('ready');
    expect(packaging.operatorMetrics.margin_roas_pct).toBe(180);
  });
});
