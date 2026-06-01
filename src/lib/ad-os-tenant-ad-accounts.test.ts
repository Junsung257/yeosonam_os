import { describe, expect, it } from 'vitest';
import { classifyProbeMessageStatus } from './ad-os-tenant-ad-accounts';

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
