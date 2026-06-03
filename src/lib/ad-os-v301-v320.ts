import { deriveAdOsProductScenarios, scenariosToExtractedKeywords } from '@/lib/ad-os-scenario-engine';
import type { TravelPackageForSearchAds } from '@/lib/search-ads-auto-planner';
import { type ConversionExportEvent, type PerformanceFactForOptimization } from '@/lib/ad-os-v31-v40';
import {
  buildConversionUploadJobRows,
  buildCreativeAssetVariantsForPackage,
  buildDataQualitySnapshot,
  buildPlatformJobRows,
  buildPortfolioBudgetPlans,
  buildTravelIntentSignalsForPackage,
  type ChannelBudgetFact,
  type ConversionUploadJobRow,
  type ExternalMutationForJob,
  type PackageFact,
  type PlatformGuardrailInput,
  type PlatformJobRow,
} from '@/lib/ad-os-v41-v60';
import { decideConversionUploadExecution, decidePlatformJobExecution } from '@/lib/ad-os-v61-v75';
import { decideOpsQueueAction } from '@/lib/ad-os-v281-v300';

type SmokePackage = PackageFact & TravelPackageForSearchAds;

export type AdOsE2ESmokeResult = {
  package: SmokePackage;
  counts: {
    scenarios: number;
    keywords: number;
    intent_signals: number;
    creative_variants: number;
    platform_jobs: number;
    conversion_upload_jobs: number;
    portfolio_plans: number;
  };
  assertions: {
    has_ultra_longtail_keywords: boolean;
    has_creative_assets: boolean;
    platform_job_approved: boolean;
    platform_executor_dry_run_safe: boolean;
    conversion_upload_ready: boolean;
    conversion_executor_dry_run_safe: boolean;
    portfolio_plan_generated: boolean;
    ops_queue_actions_safe: boolean;
    external_api_write_zero: boolean;
  };
  platformJob: PlatformJobRow;
  conversionUploadJob: ConversionUploadJobRow & { id: string };
};

function futureDate(days: number): string {
  const date = new Date('2026-06-03T00:00:00.000Z');
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildDanangAdOsE2ESmoke(): AdOsE2ESmokeResult {
  const pkg: SmokePackage = {
    id: 'fixture-danang-airbusan-parent',
    tenant_id: 'tenant-smoke',
    title: 'Busan Air Busan Danang no-shopping parent package',
    display_name: 'Busan departure Air Busan Danang 3 nights package',
    product_type: 'package',
    destination: 'Danang',
    airline: 'Air Busan',
    departure_airport: 'Busan',
    duration: 5,
    nights: 3,
    price: 699000,
    status: 'active',
    ticketing_deadline: futureDate(10),
    seats_total: 20,
    seats_held: 8,
    seats_confirmed: 4,
    commission_fixed_amount: 90000,
    commission_rate: 0,
    inclusions: ['no shopping', 'Hoi An', 'Ba Na Hills', 'guide'],
    itinerary: ['Danang', 'Hoi An', 'Ba Na Hills', 'free time'],
    parsed_data: {
      destination: 'Danang',
      departure_airport: 'Busan',
      airline: 'Air Busan',
      price: 699000,
    },
  };

  const scenarios = deriveAdOsProductScenarios(pkg);
  const keywords = scenariosToExtractedKeywords(scenarios);
  const intentSignals = buildTravelIntentSignalsForPackage(pkg);
  const creativeVariants = buildCreativeAssetVariantsForPackage(pkg, intentSignals);
  const primaryKeyword = keywords[0]?.keyword || 'Busan Danang parent package';

  const mutation: ExternalMutationForJob = {
    id: 'mutation-danang-paused-keyword',
    tenant_id: pkg.tenant_id,
    platform: 'naver',
    mutation_type: 'create_paused_keyword',
    status: 'requested',
    change_request_id: 'change-request-danang-keyword',
    external_account_id: 'naver-account-smoke',
    external_campaign_id: 'cmp-smoke',
    external_ad_group_id: 'grp-smoke',
    idempotency_key: 'fixture-danang-paused-keyword',
    request_payload: {
      keyword: primaryKeyword,
      max_cpc_krw: 180,
      final_url: '/packages/fixture-danang-airbusan-parent',
      external_api_write: false,
    },
  };
  const guardrails: Record<string, PlatformGuardrailInput> = {
    naver: {
      integrationReady: true,
      permissionOk: true,
      campaignReady: true,
      budgetReady: true,
      killSwitchClear: true,
      automationLevel: 3,
      humanApproved: true,
      fullAutoEnabled: false,
    },
  };
  const [platformJob] = buildPlatformJobRows([mutation], guardrails, { runId: 'run-smoke-platform', execute: false });
  const platformDecision = decidePlatformJobExecution(
    { ...platformJob, id: 'platform-job-danang-paused-keyword' },
    { mode: 'paused_only', runId: 'run-smoke-platform-executor', now: '2026-06-03T01:00:00.000Z' },
  );

  const conversionEvent: ConversionExportEvent = {
    id: 'conversion-event-danang-booking',
    tenant_id: pkg.tenant_id,
    event_type: 'booking',
    event_time: '2026-06-02T12:00:00.000Z',
    platform: 'google',
    session_id: 'session-smoke',
    visitor_id: 'visitor-smoke',
    gclid: 'gclid-smoke',
    product_id: pkg.id,
    keyword_text: primaryKeyword,
    booking_id: 'booking-smoke',
    revenue_krw: 1398000,
    margin_krw: 180000,
    quarantine_status: 'clean',
    raw_payload: {
      consent_status: 'granted',
      event_id: 'event-smoke-dedupe',
    },
  };
  const [conversionJobBase] = buildConversionUploadJobRows([conversionEvent], 'google', { runId: 'run-smoke-conversion' });
  const conversionUploadJob: ConversionUploadJobRow & { id: string } = {
    ...conversionJobBase,
    id: 'conversion-upload-danang-booking',
  };
  const conversionDecision = decideConversionUploadExecution(
    {
      ...conversionUploadJob,
      status: conversionUploadJob.status,
      freshness_status: 'fresh',
      dedupe_status: 'unique',
    },
    { runId: 'run-smoke-conversion-executor', now: new Date('2026-06-03T01:00:00.000Z') },
  );

  const budgets: ChannelBudgetFact[] = [{
    platform: 'naver',
    monthly_budget_krw: 100000,
    daily_budget_cap_krw: 10000,
    max_cpc_krw: 300,
    automation_level: 3,
    status: 'active',
  }];
  const facts: PerformanceFactForOptimization[] = [{
    id: 'fact-danang-winner',
    tenant_id: pkg.tenant_id,
    platform: 'naver',
    product_id: pkg.id,
    keyword_text: primaryKeyword,
    event_date: '2026-06-02',
    impressions: 300,
    clicks: 24,
    cta_clicks: 8,
    conversions: 2,
    cost_krw: 12000,
    revenue_krw: 1398000,
    margin_krw: 180000,
    bounces: 4,
    sessions: 24,
  }];
  const portfolioPlans = buildPortfolioBudgetPlans(facts, budgets, [pkg]);
  const dataQuality = buildDataQualitySnapshot({
    events: [conversionEvent],
    uploadJobs: [conversionUploadJob],
    performanceFacts: facts,
    periodStart: '2026-06-01',
    periodEnd: '2026-06-03',
    tenantId: pkg.tenant_id,
  });

  const opsActionDryRun = decideOpsQueueAction({ source: 'platform_job', action: 'executor_dry_run' });
  const opsActionConfirmFail = decideOpsQueueAction({ source: 'platform_job_confirmation', action: 'confirm_failed' });
  const opsActionRejectLive = decideOpsQueueAction({ source: 'platform_job', action: 'live_write' });

  const externalApiWriteZero = [
    platformJob.external_api_write,
    platformDecision.attempt.external_api_write,
    conversionDecision.attempt.external_api_write,
    opsActionDryRun.externalApiWrite,
    opsActionConfirmFail.externalApiWrite,
    opsActionRejectLive.externalApiWrite,
  ].every((value) => value === false);

  return {
    package: pkg,
    counts: {
      scenarios: scenarios.length,
      keywords: keywords.length,
      intent_signals: intentSignals.length,
      creative_variants: creativeVariants.length,
      platform_jobs: 1,
      conversion_upload_jobs: 1,
      portfolio_plans: portfolioPlans.length,
    },
    assertions: {
      has_ultra_longtail_keywords: keywords.length > 10,
      has_creative_assets: intentSignals.length > 0 && creativeVariants.length > 0,
      platform_job_approved: platformJob.status === 'approved' && platformJob.blocked_reason === null,
      platform_executor_dry_run_safe: platformDecision.attempt.status === 'succeeded' && platformDecision.attempt.dry_run && !platformDecision.attempt.external_api_write,
      conversion_upload_ready: conversionUploadJob.status === 'planned' && dataQuality.upload_ready_events === 1,
      conversion_executor_dry_run_safe: conversionDecision.attempt.status === 'succeeded' && conversionDecision.attempt.dry_run && !conversionDecision.attempt.external_api_write,
      portfolio_plan_generated: portfolioPlans.some((plan) => plan.plan_type === 'scale_winner'),
      ops_queue_actions_safe: opsActionDryRun.allowed && opsActionConfirmFail.allowed && !opsActionRejectLive.allowed,
      external_api_write_zero: externalApiWriteZero,
    },
    platformJob,
    conversionUploadJob,
  };
}
