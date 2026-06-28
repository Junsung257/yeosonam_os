import { describe, expect, it } from 'vitest';
import { evaluateAllScenarioReadiness } from './jarvis/eval/all-scenarios-readiness';
import {
  buildMarketingDeepScorecard,
  buildMarketingReadyFixtureSummary,
  MARKETING_DEEP_SOURCE_TARGET,
} from './marketing-deep-scorecard';
import { buildAutomationCommandCenterSnapshot } from './automation-command-center';

function passingJarvisSummary() {
  return evaluateAllScenarioReadiness({
    jarvisReadinessScore: 100,
    jarvisReadinessMaxScore: 100,
    jarvisReadinessStatus: 'pass',
    customerInquiryScore: 100,
    customerInquiryStatus: 'pass',
    autopilotHitlPassed: true,
    freeTravelScore: 100,
    freeTravelStatus: 'pass',
    freeTravelP0Failures: 0,
    liveRagScore: 99,
    liveRagReadiness: 'ready',
  });
}

function readyAdOsScorecard() {
  return buildMarketingDeepScorecard({
    summary: buildMarketingReadyFixtureSummary(),
    sourceLedgerCount: MARKETING_DEEP_SOURCE_TARGET,
  });
}

describe('buildAutomationCommandCenterSnapshot', () => {
  it('returns ready when Jarvis, Ad OS current evidence, and approvals are clean', () => {
    const snapshot = buildAutomationCommandCenterSnapshot({
      generatedAt: '2026-06-29T00:00:00.000Z',
      jarvisSummary: passingJarvisSummary(),
      adOsCurrentScorecard: readyAdOsScorecard(),
      adOsReadyFixtureScorecard: readyAdOsScorecard(),
      approvalQueue: {
        pending_count: 0,
        high_risk_count: 0,
        top_packets: [],
      },
    });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.score).toBeGreaterThanOrEqual(95);
    expect(snapshot.ad_os.current_lowest_score).toBeGreaterThanOrEqual(95);
    expect(snapshot.one_click_recommendation.action_type).toBe('refresh');
    expect(snapshot.safety.external_api_write).toBe(false);
  });

  it('separates reachable 95+ fixture from current Ad OS evidence gaps', () => {
    const currentGapScorecard = buildMarketingDeepScorecard({
      summary: {},
      sourceLedgerCount: 0,
    });
    const readyFixture = readyAdOsScorecard();
    const snapshot = buildAutomationCommandCenterSnapshot({
      generatedAt: '2026-06-29T00:00:00.000Z',
      jarvisSummary: passingJarvisSummary(),
      adOsCurrentScorecard: currentGapScorecard,
      adOsReadyFixtureScorecard: readyFixture,
      approvalQueue: {
        pending_count: 0,
        high_risk_count: 0,
        top_packets: [],
      },
    });

    expect(snapshot.status).toBe('blocked');
    expect(snapshot.ad_os.current_lowest_score).toBeLessThan(95);
    expect(snapshot.ad_os.ready_fixture_lowest_score).toBeGreaterThanOrEqual(95);
    expect(snapshot.ad_os.gap_count).toBeGreaterThan(0);
    expect(snapshot.one_click_recommendation.target_href).toBe('/admin/ad-os');
  });

  it('routes high-risk approval packets to Jarvis actions without enabling execution', () => {
    const snapshot = buildAutomationCommandCenterSnapshot({
      generatedAt: '2026-06-29T00:00:00.000Z',
      jarvisSummary: passingJarvisSummary(),
      adOsCurrentScorecard: readyAdOsScorecard(),
      adOsReadyFixtureScorecard: readyAdOsScorecard(),
      approvalQueue: {
        pending_count: 2,
        high_risk_count: 1,
        top_packets: [{
          id: 'action-1',
          agent_type: 'sales',
          action_type: 'booking_change',
          summary: 'Booking change approval required',
          priority: 'critical',
          status: 'pending',
          created_at: '2026-06-29T00:00:00.000Z',
        }],
      },
    });

    expect(snapshot.status).toBe('watch');
    expect(snapshot.approval_queue.high_risk_count).toBe(1);
    expect(snapshot.one_click_recommendation).toMatchObject({
      target_href: '/admin/jarvis?tab=actions',
      requires_approval: true,
      safe: true,
    });
    expect(snapshot.safety.database_mutation).toBe(false);
  });

  it('keeps operator-facing recommendations readable and action-only', () => {
    const currentGapScorecard = buildMarketingDeepScorecard({
      summary: {},
      sourceLedgerCount: 0,
    });
    const snapshot = buildAutomationCommandCenterSnapshot({
      generatedAt: '2026-06-29T00:00:00.000Z',
      jarvisSummary: passingJarvisSummary(),
      adOsCurrentScorecard: currentGapScorecard,
      adOsReadyFixtureScorecard: readyAdOsScorecard(),
      approvalQueue: {
        pending_count: 0,
        high_risk_count: 0,
        top_packets: [],
      },
    });

    expect(snapshot.one_click_recommendation).toMatchObject({
      label: 'Review Ad OS repair plan',
      action_type: 'navigate',
      safe: true,
    });
    expect(snapshot.jarvis.next_action).toBe('Jarvis is ready to create operator approval packets.');
    expect(snapshot.safety).toMatchObject({
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      full_auto_allowed: false,
    });
  });
});
