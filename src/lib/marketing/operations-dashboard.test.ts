import { describe, expect, it } from 'vitest';
import {
  buildMarketingOperationsDashboard,
  type MarketingDashboardInput,
} from './operations-dashboard';

function baseInput(
  overrides: Partial<MarketingDashboardInput> = {},
): MarketingDashboardInput {
  return {
    days: 30,
    collectedAt: '2026-07-25T08:00:00.000Z',
    trafficCount: 0,
    latestTrackingAt: null,
    traffic: [],
    engagements: [],
    leads: [],
    bookings: [],
    settledBookings: [],
    campaigns: [],
    performance: [],
    channelHealth: [],
    accounts: [],
    recommendations: [],
    creatives: [],
    distributions: [],
    ...overrides,
  };
}

describe('buildMarketingOperationsDashboard', () => {
  it('does not turn missing provider performance into zero spend or fake funnel rows', () => {
    const dashboard = buildMarketingOperationsDashboard(baseInput());

    expect(dashboard.kpis.spend.value).toBeNull();
    expect(dashboard.kpis.spend.state).toBe('not_collected');
    expect(dashboard.kpis.costPerBooking.value).toBeNull();
    expect(dashboard.funnel.map((step) => step.count)).toEqual([0, 0, 0, 0, 0]);
    expect(dashboard.issues[0]?.id).toBe('provider-performance-missing');
  });

  it('marks an old health result as stale even when its readiness flags are true', () => {
    const dashboard = buildMarketingOperationsDashboard(baseInput({
      channelHealth: [{
        platform: 'google',
        adapter_state: 'ready',
        credentials_ready: true,
        permission_ready: true,
        campaign_ready: true,
        budget_ready: true,
        conversion_ready: true,
        live_publish_enabled: true,
        external_api_write: true,
        recommended_action: '',
        checked_at: '2026-07-20T08:00:00.000Z',
      }],
      accounts: [{
        platform: 'google',
        connection_status: 'connected',
        external_account_id: 'account-1',
        external_campaign_id: 'campaign-1',
        last_probe_at: '2026-07-20T08:00:00.000Z',
        risk_status: 'ok',
      }],
    }));

    expect(dashboard.channels.find((channel) => channel.channel === 'google')?.status).toBe('stale');
  });

  it('uses provider snapshots for spend and settled bookings for confirmed margin', () => {
    const dashboard = buildMarketingOperationsDashboard(baseInput({
      campaigns: [{
        id: 'campaign-1',
        name: '검색 광고',
        channel: 'google',
        status: 'active',
        daily_budget_krw: 50_000,
        meta_campaign_id: null,
        naver_campaign_id: null,
        google_campaign_id: 'external-1',
        updated_at: '2026-07-25T07:00:00.000Z',
      }],
      performance: [{
        campaign_id: 'campaign-1',
        snapshot_date: '2026-07-25',
        impressions: 1_000,
        clicks: 50,
        spend_krw: 100_000,
        attributed_bookings: 2,
        attributed_margin: 300_000,
      }],
      bookings: [{
        id: 'booking-1',
        utm_source: 'google',
        channel_source: null,
        status: 'confirmed',
        payment_status: '완납',
        margin: 150_000,
        settlement_confirmed_at: '2026-07-25T06:00:00.000Z',
        created_at: '2026-07-25T05:00:00.000Z',
      }],
      settledBookings: [{
        id: 'booking-1',
        utm_source: 'google',
        channel_source: null,
        status: 'confirmed',
        payment_status: '완납',
        margin: 150_000,
        settlement_confirmed_at: '2026-07-25T06:00:00.000Z',
        created_at: '2026-07-25T05:00:00.000Z',
      }],
    }));

    expect(dashboard.kpis.spend.value).toBe(100_000);
    expect(dashboard.kpis.confirmedMargin.value).toBe(150_000);
    expect(dashboard.kpis.costPerBooking.value).toBe(100_000);
    expect(dashboard.kpis.marginReturnRate.value).toBe(300);
  });
});
