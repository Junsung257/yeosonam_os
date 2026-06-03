import type { CompletionAuditSummary } from '@/lib/ad-os-v361-v380';
import type { AdOsStagingSmokeSummary } from '@/lib/ad-os-v541-v560';

export type AdOsInventoryStatus = 'operational' | 'partial' | 'blocked';
export type AdOsInventoryArea =
  | 'control_plane'
  | 'operator_ux'
  | 'channel_execution'
  | 'conversion_quality'
  | 'learning_loop'
  | 'creative_factory'
  | 'tenant_saas'
  | 'live_autopilot';

export type AdOsInventoryItem = {
  id: AdOsInventoryArea;
  label: string;
  status: AdOsInventoryStatus;
  evidence: string;
  next_action: string;
  risk: 'low' | 'medium' | 'high';
};

export type AdOsOperatingInventory = {
  status: AdOsInventoryStatus;
  readiness_score: number;
  operational: number;
  partial: number;
  blocked: number;
  items: AdOsInventoryItem[];
  top_gap: string;
  next_action: string;
  safety: {
    read_only: true;
    database_mutation: false;
    external_api_write: false;
    live_spend_krw: 0;
  };
};

type EnterpriseSignals = {
  platform_job_queue?: {
    total?: number | null;
    blocked?: number | null;
    approved_or_running?: number | null;
    external_api_write_count?: number | null;
  } | null;
  conversion_data_quality?: Record<string, number | string | null> | null;
  portfolio_optimizer?: {
    candidates?: number | null;
    approved?: number | null;
    applied?: number | null;
  } | null;
  creative_factory?: {
    variants?: number | null;
    duplicate_content_risks?: number | null;
  } | null;
  saas_packaging?: {
    workspaces?: number | null;
    active_billing_profiles?: number | null;
    full_auto_enabled?: number | null;
  } | null;
  runtime_readiness?: {
    checks?: number | null;
    blocked_or_failed?: number | null;
    critical?: number | null;
  } | null;
  runtime_execution?: {
    attempts?: number | null;
    succeeded?: number | null;
    blocked?: number | null;
    external_api_write_count?: number | null;
  } | null;
  agency_reporting?: {
    status?: string | null;
    readiness_score?: number | null;
  } | null;
  channel_adapters?: {
    snapshots?: number | null;
    paused_write_ready?: number | null;
    draft_ready?: number | null;
    executable?: number | null;
    blocked?: number | null;
    external_api_write_count?: number | null;
  } | null;
  execution_gates?: {
    gates?: number | null;
    eligible?: number | null;
    blocked?: number | null;
    external_api_write_count?: number | null;
  } | null;
  limited_write_pilot?: {
    attempts?: number | null;
    dry_run_succeeded?: number | null;
    blocked?: number | null;
    live_external_write_enabled?: number | null;
    external_api_write_count?: number | null;
  } | null;
};

type LearningSignals = {
  status?: Record<string, boolean> | null;
  metrics?: {
    fact_clicks_30d?: number | null;
    fact_cta_clicks_30d?: number | null;
    fact_conversions_30d?: number | null;
    fact_margin_krw_30d?: number | null;
    fact_margin_roas_pct_30d?: number | null;
  } | null;
} | null;

function numberValue(value: unknown): number {
  return Number(value || 0);
}

function item(input: AdOsInventoryItem): AdOsInventoryItem {
  return input;
}

function summarizeStatus(items: AdOsInventoryItem[]): AdOsInventoryStatus {
  if (items.some((row) => row.status === 'blocked')) return 'blocked';
  if (items.some((row) => row.status === 'partial')) return 'partial';
  return 'operational';
}

export function buildAdOsOperatingInventory(input: {
  completionAudit?: CompletionAuditSummary | null;
  stagingSmoke?: AdOsStagingSmokeSummary | null;
  enterpriseLayer?: EnterpriseSignals | null;
  learningLoop?: LearningSignals;
}): AdOsOperatingInventory {
  const completion = input.completionAudit;
  const smoke = input.stagingSmoke;
  const enterprise = input.enterpriseLayer || {};
  const learning = input.learningLoop || {};
  const externalWriteCount =
    numberValue(enterprise.platform_job_queue?.external_api_write_count) +
    numberValue(enterprise.runtime_execution?.external_api_write_count) +
    numberValue(enterprise.channel_adapters?.external_api_write_count) +
    numberValue(enterprise.execution_gates?.external_api_write_count) +
    numberValue(enterprise.limited_write_pilot?.external_api_write_count);
  const smokePasses = smoke?.status === 'pass' && smoke.evidence.external_api_write_zero;
  const conversionUploadable = numberValue(enterprise.conversion_data_quality?.uploadable_conversions);
  const conversionBlocked = numberValue(enterprise.conversion_data_quality?.blocked_conversions);
  const marginReady = Boolean(learning.status?.margin_learning_ready || learning.status?.attribution_ready);
  const creativeVariants = numberValue(enterprise.creative_factory?.variants);
  const duplicateRisks = numberValue(enterprise.creative_factory?.duplicate_content_risks);
  const channelSnapshots = numberValue(enterprise.channel_adapters?.snapshots);
  const channelReady =
    numberValue(enterprise.channel_adapters?.paused_write_ready) +
    numberValue(enterprise.channel_adapters?.draft_ready) +
    numberValue(enterprise.channel_adapters?.executable);
  const livePilotEnabled = numberValue(enterprise.limited_write_pilot?.live_external_write_enabled);
  const fullAutoEnabled = numberValue(enterprise.saas_packaging?.full_auto_enabled);

  const items = [
    item({
      id: 'control_plane',
      label: 'Control plane safety',
      status: completion && completion.failed === 0 && externalWriteCount === 0 && smokePasses ? 'operational' : externalWriteCount > 0 ? 'blocked' : 'partial',
      evidence: `completion ${completion?.status || 'unknown'}, smoke ${smoke?.status || 'unknown'}, external writes ${externalWriteCount}`,
      next_action: smokePasses
        ? 'Keep read-only smoke in CI/operator checks before DB-backed staging runs.'
        : 'Restore completion audit and staging smoke before declaring Ad OS readiness.',
      risk: externalWriteCount > 0 ? 'high' : 'low',
    }),
    item({
      id: 'operator_ux',
      label: 'Operator UX evidence',
      status: completion && smoke ? 'operational' : 'partial',
      evidence: `completion requirements ${completion?.requirements.length || 0}, smoke assertions ${smoke?.passed_assertions || 0}`,
      next_action: 'Surface this inventory beside completion audit, runtime readiness, and channel adapter cards.',
      risk: 'medium',
    }),
    item({
      id: 'channel_execution',
      label: 'Naver/Google/Meta execution adapters',
      status: channelSnapshots > 0 && channelReady > 0 ? 'operational' : channelSnapshots > 0 ? 'partial' : 'blocked',
      evidence: `adapter snapshots ${channelSnapshots}, ready states ${channelReady}`,
      next_action: channelReady > 0
        ? 'Continue keeping Naver paused/dry-run first and Google/Meta live publish disabled until credentials and conversion actions pass.'
        : 'Generate channel adapter health snapshots and paused/draft packets for each connected platform.',
      risk: channelReady > 0 ? 'medium' : 'high',
    }),
    item({
      id: 'conversion_quality',
      label: 'First-party conversion quality',
      status: conversionBlocked > 0 ? 'blocked' : conversionUploadable > 0 ? 'operational' : 'partial',
      evidence: `uploadable conversions ${conversionUploadable}, blocked conversions ${conversionBlocked}`,
      next_action: conversionUploadable > 0
        ? 'Use clean conversion jobs as the source for booked margin attribution.'
        : 'Collect consented conversion candidates with dedupe, freshness, and hashed identifier quality.',
      risk: conversionBlocked > 0 ? 'high' : 'medium',
    }),
    item({
      id: 'learning_loop',
      label: 'Booked-margin learning loop',
      status: marginReady ? 'operational' : numberValue(enterprise.portfolio_optimizer?.candidates) > 0 ? 'partial' : 'blocked',
      evidence: `margin ready ${marginReady ? 1 : 0}, optimizer candidates ${numberValue(enterprise.portfolio_optimizer?.candidates)}`,
      next_action: marginReady
        ? 'Generate pause, scale, landing repair, and creative refresh candidates from margin ROAS facts.'
        : 'Normalize click, CTA, booking, spend, revenue, margin, CPA, ROAS, and bounce facts by product/keyword/blog/creative/channel.',
      risk: marginReady ? 'medium' : 'high',
    }),
    item({
      id: 'creative_factory',
      label: 'Travel creative factory',
      status: creativeVariants > 0 && duplicateRisks === 0 ? 'operational' : creativeVariants > 0 ? 'partial' : 'blocked',
      evidence: `creative variants ${creativeVariants}, duplicate risks ${duplicateRisks}`,
      next_action: duplicateRisks > 0
        ? 'Prefer hub updates, CTA swaps, FAQ/internal links, and card news over duplicate blog article generation.'
        : 'Keep scenario creative variants tied to fatigue, CTR decay, and CPA trend evidence.',
      risk: duplicateRisks > 0 ? 'high' : 'medium',
    }),
    item({
      id: 'tenant_saas',
      label: 'Tenant SaaS packaging',
      status: numberValue(enterprise.saas_packaging?.workspaces) > 0 && numberValue(enterprise.saas_packaging?.active_billing_profiles) > 0 ? 'operational' : 'partial',
      evidence: `workspaces ${numberValue(enterprise.saas_packaging?.workspaces)}, billing profiles ${numberValue(enterprise.saas_packaging?.active_billing_profiles)}`,
      next_action: 'Keep tenant budgets, RBAC approvers, audit exports, data retention, and monthly reports separated per tenant.',
      risk: 'medium',
    }),
    item({
      id: 'live_autopilot',
      label: 'Limited/full autopilot readiness',
      status: livePilotEnabled > 0 || fullAutoEnabled > 0 ? 'blocked' : numberValue(enterprise.limited_write_pilot?.dry_run_succeeded) > 0 ? 'partial' : 'partial',
      evidence: `limited pilot dry-run ${numberValue(enterprise.limited_write_pilot?.dry_run_succeeded)}, live enabled ${livePilotEnabled}, full auto ${fullAutoEnabled}`,
      next_action: livePilotEnabled > 0 || fullAutoEnabled > 0
        ? 'Disable live/full auto until explicit tenant approval, budget caps, kill-switch clearance, and experiment confidence are proven.'
        : 'Keep recommend -> approve -> limited dry-run as the default path before any live spend.',
      risk: livePilotEnabled > 0 || fullAutoEnabled > 0 ? 'high' : 'medium',
    }),
  ];

  const operational = items.filter((row) => row.status === 'operational').length;
  const partial = items.filter((row) => row.status === 'partial').length;
  const blocked = items.filter((row) => row.status === 'blocked').length;
  const status = summarizeStatus(items);
  const topGap = items.find((row) => row.status === 'blocked') || items.find((row) => row.status === 'partial');

  return {
    status,
    readiness_score: Math.max(0, Math.min(100, Math.round((operational / items.length) * 100 - blocked * 10 - partial * 2))),
    operational,
    partial,
    blocked,
    items,
    top_gap: topGap?.label || 'No operating gap',
    next_action: topGap?.next_action || 'All Ad OS operating inventory areas have current evidence.',
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
    },
  };
}
