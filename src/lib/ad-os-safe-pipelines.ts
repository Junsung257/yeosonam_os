export type AdOsSafePipelineKey = 'google' | 'conversion' | 'optimization' | 'meta_creative';

export type AdOsSafePipelineStep = {
  key: string;
  url: string;
  body: Record<string, unknown>;
  description: string;
};

export const AD_OS_SAFE_PIPELINE_KEYS: AdOsSafePipelineKey[] = [
  'google',
  'conversion',
  'optimization',
  'meta_creative',
];

const auditExportStep: AdOsSafePipelineStep = {
  key: 'tenant_audit_export',
  url: '/api/admin/ad-os/tenant-audit-export',
  body: { apply: true },
  description: 'Create tenant audit export draft after the safe pipeline finishes.',
};

export function isAdOsSafePipelineKey(value: unknown): value is AdOsSafePipelineKey {
  return AD_OS_SAFE_PIPELINE_KEYS.includes(value as AdOsSafePipelineKey);
}

export function buildAdOsSafePipelineSteps(pipeline: AdOsSafePipelineKey): AdOsSafePipelineStep[] {
  if (pipeline === 'google') {
    return [
      {
        key: 'google_rsa_drafts',
        url: '/api/admin/ad-os/creative-factory/search-rsa',
        body: { apply: true, limit: 3 },
        description: 'Generate Google RSA draft sets from approved product and intent signals.',
      },
      {
        key: 'google_draft_packets',
        url: '/api/admin/ad-os/channel-adapters/google/draft-from-rsa',
        body: { apply: true, include_drafts: false, limit: 20 },
        description: 'Convert RSA drafts into Google draft-only platform write packets.',
      },
      {
        key: 'google_execution_gate',
        url: '/api/admin/ad-os/channel-adapters/execution-gate',
        body: { apply: true, platform: 'google', requested_mode: 'approve', human_approved: false, limit: 20 },
        description: 'Evaluate Google packets through approval-mode execution gates.',
      },
      {
        key: 'google_platform_jobs',
        url: '/api/admin/ad-os/channel-adapters/google/jobs-from-packets',
        body: { apply: true, limit: 50 },
        description: 'Prepare Google platform jobs from gated packets without live publishing.',
      },
      {
        key: 'google_platform_dry_run',
        url: '/api/admin/ad-os/platform-jobs/execute',
        body: { apply: true, mode: 'dry_run', platform: 'google', limit: 50 },
        description: 'Execute Google platform jobs in dry-run mode only.',
      },
      auditExportStep,
    ];
  }

  if (pipeline === 'conversion') {
    return [
      {
        key: 'google_conversion_jobs',
        url: '/api/admin/ad-os/conversion-upload/run',
        body: { apply: true, platform: 'google', limit: 100 },
        description: 'Prepare Google conversion upload jobs.',
      },
      {
        key: 'meta_conversion_jobs',
        url: '/api/admin/ad-os/conversion-upload/run',
        body: { apply: true, platform: 'meta', limit: 100 },
        description: 'Prepare Meta conversion upload jobs.',
      },
      {
        key: 'google_conversion_dry_run',
        url: '/api/admin/ad-os/conversion-upload/execute',
        body: { apply: true, platform: 'google', limit: 50 },
        description: 'Validate Google conversion uploads in dry-run mode.',
      },
      {
        key: 'meta_conversion_dry_run',
        url: '/api/admin/ad-os/conversion-upload/execute',
        body: { apply: true, platform: 'meta', limit: 50 },
        description: 'Validate Meta conversion uploads in dry-run mode.',
      },
      {
        key: 'conversion_data_quality',
        url: '/api/admin/ad-os/data-quality',
        body: { apply: true, days: 14 },
        description: 'Persist conversion data-quality snapshot.',
      },
      auditExportStep,
    ];
  }

  if (pipeline === 'optimization') {
    return [
      {
        key: 'performance_sync',
        url: '/api/admin/ad-os/performance-sync',
        body: { days: 30, apply: true },
        description: 'Sync recent performance facts.',
      },
      {
        key: 'conversion_attribution',
        url: '/api/admin/ad-os/conversion-attribution',
        body: { days: 30, apply: true, limit: 3000 },
        description: 'Build paid and organic-assisted conversion attribution.',
      },
      {
        key: 'bid_optimizer',
        url: '/api/admin/ad-os/bid-optimizer/apply',
        body: { apply: true, limit: 200 },
        description: 'Create bid optimization candidates.',
      },
      {
        key: 'portfolio_plan',
        url: '/api/admin/ad-os/optimizer/portfolio-plan',
        body: { apply: true, days: 30 },
        description: 'Create portfolio budget optimization plan.',
      },
      {
        key: 'budget_pacing',
        url: '/api/admin/ad-os/budget-pacing',
        body: { mode: 'dry_run' },
        description: 'Validate budget pacing in dry-run mode.',
      },
      auditExportStep,
    ];
  }

  return [
    {
      key: 'meta_asset_group',
      url: '/api/admin/ad-os/creative-factory/asset-group',
      body: { apply: true, limit: 20 },
      description: 'Generate Meta-ready intent signals and creative asset variants.',
    },
    {
      key: 'meta_creative_seed',
      url: '/api/admin/ad-os/channel-adapters/meta/creative-seed',
      body: {
        apply: true,
        creative_name: 'Meta creative seed',
        landing_url: '/blog/danang-family-package',
        headline: 'Family travel comparison',
        primary_text: 'Compare itinerary, inclusions, and booking fit before inquiry.',
        call_to_action: 'LEARN_MORE',
      },
      description: 'Create Meta creative seed packet without live publishing.',
    },
    {
      key: 'meta_execution_gate',
      url: '/api/admin/ad-os/channel-adapters/execution-gate',
      body: { apply: true, platform: 'meta', requested_mode: 'approve', human_approved: false, limit: 20 },
      description: 'Evaluate Meta creative seed packets through approval-mode gates.',
    },
    auditExportStep,
  ];
}
