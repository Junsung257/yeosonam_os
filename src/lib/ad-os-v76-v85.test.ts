import { describe, expect, it } from 'vitest';
import {
  buildChannelAdapterCapability,
  buildGoogleCampaignDraftPacket,
  buildMetaCapiTestPacket,
  buildNaverPausedKeywordPacket,
  summarizeAdapterCapabilities,
} from './ad-os-v76-v85';

describe('ad-os-v76-v85 channel adapters', () => {
  it('marks Naver as paused-write ready without enabling live spend', () => {
    const capability = buildChannelAdapterCapability({
      platform: 'naver',
      credentialsReady: true,
      connectionStatus: 'ready',
      externalCampaignId: 'cmp-1',
      externalAdGroupId: 'grp-1',
      budgetStatus: 'active',
      monthlyBudgetKrw: 100000,
      dailyBudgetCapKrw: 10000,
      maxCpcKrw: 300,
      automationLevel: 2,
      canPublishKeywords: true,
      fullAutoEnabled: false,
    });

    expect(capability.adapter_state).toBe('paused_write_ready');
    expect(capability.capabilities.create_paused_keyword).toBe(true);
    expect(capability.capabilities.live_keyword_activation).toBe(false);
    expect(capability.external_api_write).toBe(false);
  });

  it('builds a Naver paused keyword packet with external writes disabled', () => {
    const capability = buildChannelAdapterCapability({
      platform: 'naver',
      credentialsReady: true,
      connectionStatus: 'ready',
      externalCampaignId: 'cmp-1',
      externalAdGroupId: 'grp-1',
      budgetStatus: 'active',
      monthlyBudgetKrw: 100000,
      dailyBudgetCapKrw: 10000,
      maxCpcKrw: 300,
      automationLevel: 2,
      canPublishKeywords: true,
    });
    const packet = buildNaverPausedKeywordPacket(capability, {
      keyword: '부산 부모님 다낭 여행',
      landingUrl: '/blog/danang-parents',
      maxCpcKrw: 250,
    });

    expect(packet.lifecycle_status).toBe('ready');
    expect(packet.packet_type).toBe('naver_paused_keyword');
    expect(packet.request_payload).toMatchObject({ paused: true, external_api_write: false });
    expect(packet.external_api_write).toBe(false);
  });

  it('keeps Google at draft-ready and blocks live publish semantics', () => {
    const capability = buildChannelAdapterCapability({
      platform: 'google',
      credentialsReady: true,
      connectionStatus: 'credentials_ready',
      budgetStatus: 'active',
      monthlyBudgetKrw: 100000,
      dailyBudgetCapKrw: 10000,
      maxCpcKrw: 500,
      automationLevel: 3,
      fullAutoEnabled: false,
    });
    const packet = buildGoogleCampaignDraftPacket(capability, {
      campaignName: 'Danang draft',
      keyword: '부산출발 에어부산 다낭 패키지',
    });

    expect(capability.adapter_state).toBe('draft_ready');
    expect(packet.lifecycle_status).toBe('ready');
    expect(packet.request_payload).toMatchObject({ live_publish_disabled: true, external_api_write: false });
  });

  it('requires conversion readiness before Meta CAPI test packet is ready', () => {
    const blockedCapability = buildChannelAdapterCapability({
      platform: 'meta',
      credentialsReady: true,
      connectionStatus: 'ready',
      budgetStatus: 'active',
      monthlyBudgetKrw: 100000,
      dailyBudgetCapKrw: 10000,
      maxCpcKrw: 500,
      automationLevel: 2,
      conversionReady: false,
    });
    const readyCapability = buildChannelAdapterCapability({
      platform: 'meta',
      credentialsReady: true,
      connectionStatus: 'ready',
      budgetStatus: 'active',
      monthlyBudgetKrw: 100000,
      dailyBudgetCapKrw: 10000,
      maxCpcKrw: 500,
      automationLevel: 2,
      conversionReady: true,
    });

    expect(buildMetaCapiTestPacket(blockedCapability).lifecycle_status).toBe('blocked');
    expect(buildMetaCapiTestPacket(readyCapability, { eventId: 'evt-1' }).lifecycle_status).toBe('ready');
  });

  it('summarizes adapter states for the admin dashboard', () => {
    const summary = summarizeAdapterCapabilities([
      buildChannelAdapterCapability({ platform: 'naver', credentialsReady: false }),
      buildChannelAdapterCapability({ platform: 'google', credentialsReady: true, connectionStatus: 'ready' }),
      buildChannelAdapterCapability({
        platform: 'naver',
        credentialsReady: true,
        connectionStatus: 'ready',
        externalCampaignId: 'cmp',
        externalAdGroupId: 'grp',
        budgetStatus: 'active',
        monthlyBudgetKrw: 1,
        dailyBudgetCapKrw: 1,
        maxCpcKrw: 1,
        automationLevel: 2,
      }),
    ]);

    expect(summary).toMatchObject({ platforms: 3, paused_write_ready: 1, draft_ready: 1, external_api_write_count: 0 });
  });
});
