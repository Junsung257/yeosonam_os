import { describe, expect, it } from 'vitest';
import { automationLevelToPublicMode, classifyAdOsChannelState, decidePerformanceAction, visibilityFromRank } from '@/lib/ad-os-v3-v7';

describe('ad-os-v3-v7 guardrails', () => {
  it('maps automation levels to the four public operation modes', () => {
    expect(automationLevelToPublicMode(0)).toBe('recommend');
    expect(automationLevelToPublicMode(2)).toBe('approve');
    expect(automationLevelToPublicMode(3)).toBe('limited_autopilot');
    expect(automationLevelToPublicMode(5)).toBe('full_autopilot');
  });

  it('classifies channel state with spend blocked until campaign, budget, and assets are ready', () => {
    expect(classifyAdOsChannelState({
      platform: 'naver',
      credentialsReady: false,
      hasCampaign: false,
      hasAdGroup: false,
      budgetReady: false,
      approvedAssets: 0,
    })).toMatchObject({ state: 'missing_credentials', canSpend: false });

    expect(classifyAdOsChannelState({
      platform: 'google',
      credentialsReady: true,
      connectionStatus: 'permission_denied',
      hasCampaign: true,
      hasAdGroup: true,
      budgetReady: true,
      approvedAssets: 3,
    })).toMatchObject({ state: 'permission_denied', label: '권한 없음', canSpend: false });

    expect(classifyAdOsChannelState({
      platform: 'naver',
      credentialsReady: true,
      connectionStatus: 'ready',
      hasCampaign: true,
      hasAdGroup: true,
      budgetReady: true,
      approvedAssets: 5,
    })).toMatchObject({ state: 'executable', label: '집행 가능', canSpend: true });
  });

  it('separates indexing requests from actual ranking visibility', () => {
    expect(visibilityFromRank({
      platform: 'google',
      requestStatus: 'requested',
      rank: null,
    })).toMatchObject({
      label: '요청됨',
      indexStatus: 'unknown',
      visibilityStatus: 'unknown',
    });

    expect(visibilityFromRank({
      platform: 'naver',
      requestStatus: 'requested',
      rank: 4,
      query: '부산 출발 다낭',
    })).toMatchObject({
      label: 'Naver 4위 확인',
      indexStatus: 'indexed',
      visibilityStatus: 'ranking_confirmed',
      bestQuery: '부산 출발 다낭',
    });
  });

  it('creates explainable performance actions without jumping to black-box automation', () => {
    expect(decidePerformanceAction({
      clicks: 40,
      ctaClicks: 0,
      conversions: 0,
      costKrw: 15000,
      revenueKrw: 0,
      marginKrw: 0,
      bounces: 0,
      sessions: 0,
      keywordText: '다낭 특가',
    })).toMatchObject({ action: 'pause_keyword', riskLevel: 'medium' });

    expect(decidePerformanceAction({
      clicks: 12,
      ctaClicks: 3,
      conversions: 2,
      costKrw: 10000,
      revenueKrw: 500000,
      marginKrw: 80000,
      bounces: 2,
      sessions: 12,
      keywordText: '부산 에어부산 다낭',
    })).toMatchObject({ action: 'create_keyword', riskLevel: 'high' });
  });
});
