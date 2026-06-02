import { describe, expect, it } from 'vitest';
import {
  assessConversionUploadQuality,
  buildConversionUploadJobRows,
  buildCreativeAssetVariantsForPackage,
  buildDataQualitySnapshot,
  buildPlatformJobRows,
  buildPortfolioBudgetPlans,
  buildTenantWorkspaceDefaults,
  buildTravelIntentSignalsForPackage,
  gatePlatformJob,
} from './ad-os-v41-v60';

describe('ad-os-v41-v60 platform job guard', () => {
  const guardrails = {
    integrationReady: true,
    permissionOk: true,
    campaignReady: true,
    budgetReady: true,
    killSwitchClear: true,
    automationLevel: 3,
    humanApproved: true,
    fullAutoEnabled: false,
  };

  it('blocks platform writes until a requested mutation has a change request', () => {
    const mutation = {
      id: 'mut-1',
      platform: 'naver' as const,
      mutation_type: 'activate_keyword',
      status: 'planned' as const,
      change_request_id: null,
      idempotency_key: 'mut-1',
    };

    expect(gatePlatformJob({ mutation, guardrails })).toMatchObject({
      status: 'blocked',
      blockedReason: 'human_approval_required',
    });
  });

  it('approves a requested audited mutation only after all guardrails pass', () => {
    const jobs = buildPlatformJobRows(
      [{
        id: 'mut-2',
        platform: 'naver',
        mutation_type: 'activate_keyword',
        status: 'requested',
        change_request_id: 'cr-1',
        idempotency_key: 'mut-2',
      }],
      { naver: guardrails },
    );

    expect(jobs[0]).toMatchObject({
      status: 'approved',
      blocked_reason: null,
      external_api_write: false,
    });
  });
});

describe('ad-os-v41-v60 conversion data quality', () => {
  it('rejects raw PII and denied consent before conversion upload', () => {
    const quality = assessConversionUploadQuality(
      {
        event_id: 'evt-1',
        platform: 'google',
        event_name: 'Purchase',
        ready_for_upload: true,
        blocked_reason: null,
        dedupe_key: 'google:evt-1',
        event_time: '2026-06-02T00:00:00.000Z',
        value_krw: 1000000,
        margin_krw: 100000,
        identifiers: { gclid: 'gclid-1' },
        custom_data: {},
      },
      {
        id: 'evt-1',
        event_type: 'booking',
        raw_payload: { email: 'buyer@example.com', marketing_consent: 'denied' },
      },
    );

    expect(quality.status).toBe('blocked');
    expect(quality.blockedReason).toBe('consent_denied');
    expect(quality.rawPiiKeys).toContain('email');
  });

  it('builds upload jobs and a health snapshot from clean and blocked signals', () => {
    const jobs = buildConversionUploadJobRows(
      [
        { id: 'evt-1', event_type: 'booking', gclid: 'gclid-1', raw_payload: { consent_status: 'granted' } },
        { id: 'evt-2', event_type: 'booking', raw_payload: { phone: '01012345678' } },
      ],
      'google',
    );
    const snapshot = buildDataQualitySnapshot({
      events: [{ id: 'evt-1', event_type: 'booking' }, { id: 'evt-2', event_type: 'booking' }],
      uploadJobs: jobs,
      performanceFacts: [{ id: 'fact-1', platform: 'google' }],
      periodStart: '2026-06-01',
      periodEnd: '2026-06-02',
    });

    expect(jobs.map((job) => job.status)).toContain('blocked');
    expect(snapshot.status).toBe('warning');
    expect(snapshot.upload_ready_events).toBe(1);
  });
});

describe('ad-os-v41-v60 optimizer and creative factory', () => {
  it('creates margin-aware portfolio actions', () => {
    const plans = buildPortfolioBudgetPlans(
      [
        { id: 'waste', platform: 'naver', clicks: 12, cta_clicks: 0, cost_krw: 12000, keyword_text: 'waste' },
        { id: 'winner', platform: 'google', clicks: 30, cta_clicks: 5, conversions: 2, cost_krw: 50000, margin_krw: 250000, keyword_text: 'winner' },
      ],
      [{ platform: 'google', monthly_budget_krw: 100000, daily_budget_cap_krw: 10000 }],
      [],
    );

    expect(plans.map((plan) => plan.plan_type)).toEqual(expect.arrayContaining(['pause_waste', 'scale_winner']));
  });

  it('separates duplicate destination intent from new creative variants', () => {
    const pkg = {
      id: 'pkg-1',
      title: 'Busan Air Busan Danang Package',
      destination: 'Danang',
      price: 599000,
      raw_text: 'Air Busan Busan departure parent trip no shopping',
    };
    const signals = buildTravelIntentSignalsForPackage(pkg, [
      { destination: 'Danang' },
      { destination: 'Danang' },
      { destination: 'Danang' },
      { destination: 'Danang' },
    ]);
    const variants = buildCreativeAssetVariantsForPackage(pkg, signals);

    expect(signals.some((signal) => signal.duplicate_content_risk >= 60)).toBe(true);
    expect(variants.map((variant) => variant.asset_type)).toEqual(expect.arrayContaining(['rsa_headline', 'dki_headline', 'instagram_carousel']));
  });

  it('creates conservative tenant workspace defaults for SaaS packaging', () => {
    const defaults = buildTenantWorkspaceDefaults({
      billingPlan: 'agency',
      monthlyBudgetCapKrw: 2000000,
      automationLevel: 5,
    });

    expect(defaults.workspace.require_human_approval).toBe(true);
    expect(defaults.workspace.full_auto_enabled).toBe(false);
    expect(defaults.workspace.automation_level).toBe(3);
    expect(defaults.billing.invoice_status).toBe('active');
  });
});
