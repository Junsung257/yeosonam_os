import { describe, expect, it } from 'vitest';
import { classifyProbeMessageStatus, normalizeTenantAdAccountProbe } from './ad-os-tenant-ad-accounts';

describe('classifyProbeMessageStatus', () => {
  it('keeps credential probes separate from executable accounts', () => {
    expect(classifyProbeMessageStatus({
      platform: 'naver',
      probeStatus: 'ready',
      message: 'KeywordTool ready',
    })).toBe('credentials_ready');
  });

  it('marks a channel executable only when campaign and ad group are known', () => {
    expect(classifyProbeMessageStatus({
      platform: 'naver',
      probeStatus: 'ready',
      message: 'assets synced',
      hasCampaign: true,
      hasAdGroup: true,
    })).toBe('ready');
  });

  it('turns permission failures into a blocked permission state', () => {
    expect(classifyProbeMessageStatus({
      platform: 'google',
      probeStatus: 'failed',
      message: 'PERMISSION_DENIED: customer is not enabled',
    })).toBe('permission_denied');
  });
});

describe('normalizeTenantAdAccountProbe', () => {
  it('does not allow ready or publishable without launch assets', () => {
    const normalized = normalizeTenantAdAccountProbe({
      platform: 'naver',
      connectionStatus: 'ready',
      canPublishKeywords: true,
      canChangeBids: true,
      canPauseAssets: true,
    });

    expect(normalized.connectionStatus).toBe('no_campaign');
    expect(normalized.canPublishKeywords).toBe(false);
    expect(normalized.canChangeBids).toBe(false);
    expect(normalized.canPauseAssets).toBe(false);
  });

  it('keeps ready only when campaign and ad group are present', () => {
    const normalized = normalizeTenantAdAccountProbe({
      platform: 'naver',
      connectionStatus: 'ready',
      externalCampaignId: 'cmp-1',
      externalAdGroupId: 'grp-1',
      canPublishKeywords: true,
      canChangeBids: true,
      canPauseAssets: true,
      riskStatus: 'normal',
    });

    expect(normalized.connectionStatus).toBe('ready');
    expect(normalized.canPublishKeywords).toBe(true);
    expect(normalized.canChangeBids).toBe(true);
    expect(normalized.canPauseAssets).toBe(true);
  });
});
