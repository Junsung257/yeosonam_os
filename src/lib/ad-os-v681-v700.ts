import type { AdOsStagingValidationPackage } from '@/lib/ad-os-v641-v660';

export type AdminSurfaceQaStatus = 'pass' | 'warn' | 'fail';
export type AdminSurfaceId =
  | 'ad_os'
  | 'marketing'
  | 'search_ads'
  | 'blog_ads'
  | 'blog_rankings'
  | 'blog_topical';

export type AdminSurfaceQaItem = {
  id: AdminSurfaceId;
  path: string;
  label: string;
  status: AdminSurfaceQaStatus;
  evidence: string;
  data_sources: string[];
  expected_states: string[];
  drilldown_url: string;
  next_action: string;
};

export type AdminSurfaceQaMatrix = {
  status: AdminSurfaceQaStatus;
  readiness_score: number;
  passed: number;
  warnings: number;
  failed: number;
  surfaces: AdminSurfaceQaItem[];
  top_gap: string | null;
  next_action: string;
  safety: {
    read_only: true;
    database_mutation: false;
    external_api_write: false;
    live_spend_krw: 0;
  };
};

type ChannelState = {
  state?: string | null;
  label?: string | null;
  summary?: string | null;
};

type CompletionAudit = {
  status?: string | null;
  failed?: number | null;
  warnings?: number | null;
  readiness_score?: number | null;
  next_action?: string | null;
};

type EnterpriseLayer = {
  completion_audit?: CompletionAudit | null;
  creative_factory?: {
    variants?: number | null;
    duplicate_content_risks?: number | null;
  } | null;
  platform_job_queue?: {
    total?: number | null;
    blocked?: number | null;
    external_api_write_count?: number | null;
  } | null;
  conversion_data_quality?: Record<string, number | string | null> | null;
};

export type AdminSurfaceQaInput = {
  stagingValidation?: AdOsStagingValidationPackage | null;
  channelExecutionStates?: Record<string, ChannelState | undefined> | null;
  enterpriseLayer?: EnterpriseLayer | null;
  counts?: Record<string, Record<string, number> | undefined> | null;
  learningLoop?: {
    status?: Record<string, boolean> | null;
    metrics?: Record<string, number | null | undefined> | null;
  } | null;
};

function numberValue(value: unknown): number {
  return Number(value || 0);
}

function summarizeStatus(items: AdminSurfaceQaItem[]): AdminSurfaceQaStatus {
  if (items.some((item) => item.status === 'fail')) return 'fail';
  if (items.some((item) => item.status === 'warn')) return 'warn';
  return 'pass';
}

function item(input: AdminSurfaceQaItem): AdminSurfaceQaItem {
  return input;
}

function channelEvidence(channelExecutionStates?: AdminSurfaceQaInput['channelExecutionStates']): {
  status: AdminSurfaceQaStatus;
  evidence: string;
  next_action: string;
} {
  const naver = channelExecutionStates?.naver?.state || 'unknown';
  const google = channelExecutionStates?.google?.state || 'unknown';
  const states = [naver, google];
  const hasExecutable = states.includes('executable');
  const hasDenied = states.includes('permission_denied');
  const hasMissing = states.includes('missing_credentials') || states.includes('unknown');

  if (hasExecutable) {
    return {
      status: 'pass',
      evidence: `Naver ${naver}, Google ${google}`,
      next_action: 'Keep Naver/Google state labels visible with campaign, permission, and budget blockers separated.',
    };
  }
  if (hasDenied || hasMissing) {
    return {
      status: 'fail',
      evidence: `Naver ${naver}, Google ${google}`,
      next_action: 'Resolve missing credentials or permission_denied before operators trust search-ad launch readiness.',
    };
  }
  return {
    status: 'warn',
    evidence: `Naver ${naver}, Google ${google}`,
    next_action: 'Connect campaign/ad group evidence so search-ad screens can distinguish no_campaign from executable.',
  };
}

export function buildAdOsAdminSurfaceQaMatrix(input: AdminSurfaceQaInput): AdminSurfaceQaMatrix {
  const staging = input.stagingValidation;
  const enterprise = input.enterpriseLayer || {};
  const completion = enterprise.completion_audit;
  const channel = channelEvidence(input.channelExecutionStates);
  const externalWrites =
    numberValue(enterprise.platform_job_queue?.external_api_write_count) +
    numberValue(staging?.safety.external_api_write ? 1 : 0);
  const creativeVariants = numberValue(enterprise.creative_factory?.variants);
  const duplicateContentRisks = numberValue(enterprise.creative_factory?.duplicate_content_risks);
  const factClicks = numberValue(input.learningLoop?.metrics?.fact_clicks_30d);
  const factConversions = numberValue(input.learningLoop?.metrics?.fact_conversions_30d);
  const rankingSnapshots =
    numberValue(input.counts?.blog_rankings?.total) +
    numberValue(input.counts?.blog_keyword_rankings?.total) +
    numberValue(input.counts?.blog_visibility_snapshots?.total);
  const adMappings =
    numberValue(input.counts?.blog_ad_mappings?.total) +
    numberValue(input.counts?.ad_landing_mappings?.total) +
    numberValue(input.counts?.ad_keyword_mappings?.total);
  const topicRows =
    numberValue(input.counts?.blog_topic_authority?.total) +
    numberValue(input.counts?.content_topic_authority?.total) +
    numberValue(input.counts?.blog_topic_clusters?.total);

  const surfaces = [
    item({
      id: 'ad_os',
      path: '/admin/ad-os',
      label: 'Ad OS control center',
      status: staging ? staging.status : 'fail',
      evidence: staging
        ? `staging validation ${staging.status}, score ${staging.readiness_score}%, failed ${staging.failed}`
        : 'staging validation missing',
      data_sources: [
        '/api/admin/ad-os/summary',
        '/api/admin/ad-os/staging-validation',
        '/api/admin/ad-os/operating-inventory',
        '/api/admin/ad-os/live-spend-preflight',
      ],
      expected_states: ['not checked', 'pass', 'warn', 'fail', 'live spend 0 KRW', 'full auto off'],
      drilldown_url: '/admin/ad-os?panel=completion-audit',
      next_action: staging?.next_action || 'Load staging validation before declaring Ad OS operator readiness.',
    }),
    item({
      id: 'marketing',
      path: '/admin/marketing',
      label: 'Marketing dashboard',
      status: completion?.status === 'blocked' || numberValue(completion?.failed) > 0 ? 'fail' : completion ? 'pass' : 'warn',
      evidence: completion
        ? `completion ${completion.status || 'unknown'}, score ${numberValue(completion.readiness_score)}%, failed ${numberValue(completion.failed)}`
        : 'completion audit missing',
      data_sources: ['/api/admin/ad-os/summary', '/api/admin/marketing/system-health'],
      expected_states: ['권한 없음', '연동 필요', '캠페인 없음', '집행 가능', 'Ad OS completion visible'],
      drilldown_url: '/admin/marketing',
      next_action: completion?.next_action || 'Show Ad OS completion evidence before scaling campaign recommendations.',
    }),
    item({
      id: 'search_ads',
      path: '/admin/search-ads',
      label: 'Search ads',
      status: channel.status,
      evidence: channel.evidence,
      data_sources: ['/api/admin/ad-os/summary', '/api/admin/search-ads/auto-plan'],
      expected_states: ['missing_credentials', 'integration_ready', 'permission_denied', 'no_campaign', 'executable'],
      drilldown_url: '/admin/search-ads',
      next_action: channel.next_action,
    }),
    item({
      id: 'blog_ads',
      path: '/admin/blog/ads',
      label: 'Blog ad mapping',
      status: externalWrites > 0 ? 'fail' : adMappings > 0 ? 'pass' : 'warn',
      evidence: `mappings ${adMappings}, external writes ${externalWrites}`,
      data_sources: ['/api/admin/ad-os/summary', '/api/admin/blog/ads', '/api/admin/ad-os/learning-evidence'],
      expected_states: ['candidate', 'approved', 'testing', 'active', 'paused', 'expired', 'rejected'],
      drilldown_url: '/admin/blog/ads',
      next_action: adMappings > 0
        ? 'Keep mappings tied to product expiry, UTM/DKI, learning evidence, and paused/expired state transitions.'
        : 'Generate AI mapping candidates so operators approve or reject instead of manually creating every mapping.',
    }),
    item({
      id: 'blog_rankings',
      path: '/admin/blog/rankings',
      label: 'Blog rankings and visibility',
      status: rankingSnapshots > 0 ? 'pass' : factClicks > 0 || factConversions > 0 ? 'warn' : 'warn',
      evidence: `ranking/visibility snapshots ${rankingSnapshots}, fact clicks ${factClicks}, conversions ${factConversions}`,
      data_sources: ['/api/admin/blog/visibility', '/api/admin/ad-os/learning-evidence'],
      expected_states: ['Google requested', 'Google indexed', 'Google exposed', 'Naver IndexNow requested', 'Naver exposed', 'rank checked'],
      drilldown_url: '/admin/blog/rankings',
      next_action: rankingSnapshots > 0
        ? 'Keep Google and Naver index/exposure/rank timestamps separate from request-only status.'
        : 'Collect channel-specific visibility snapshots; request submitted is not the same as indexed or exposed.',
    }),
    item({
      id: 'blog_topical',
      path: '/admin/blog/topical',
      label: 'Topical authority map',
      status: duplicateContentRisks > 0 ? 'fail' : topicRows > 0 || creativeVariants > 0 ? 'pass' : 'warn',
      evidence: `topic rows ${topicRows}, creative variants ${creativeVariants}, duplicate risks ${duplicateContentRisks}`,
      data_sources: ['/api/admin/ad-os/summary', '/api/admin/ad-os/operating-inventory'],
      expected_states: ['hub gap', 'comparison gap', 'product gap', 'FAQ/internal link gap', 'duplicate risk'],
      drilldown_url: '/admin/blog/topical',
      next_action: duplicateContentRisks > 0
        ? 'Prefer hub updates, CTA swaps, FAQ/internal links, and card news before creating another near-duplicate article.'
        : 'Show topical authority as a content gap map, not as an unexplained SEO score.',
    }),
  ];
  const status = summarizeStatus(surfaces);
  const passed = surfaces.filter((row) => row.status === 'pass').length;
  const warnings = surfaces.filter((row) => row.status === 'warn').length;
  const failed = surfaces.filter((row) => row.status === 'fail').length;
  const readinessScore = Math.max(0, Math.min(100, Math.round((passed / surfaces.length) * 100 - warnings * 4 - failed * 12)));
  const topGap = surfaces.find((row) => row.status === 'fail') || surfaces.find((row) => row.status === 'warn') || null;

  return {
    status,
    readiness_score: readinessScore,
    passed,
    warnings,
    failed,
    surfaces,
    top_gap: topGap?.label || null,
    next_action: topGap?.next_action || 'All admin surfaces have current evidence. Continue browser QA on the Vercel preview or staging server.',
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
    },
  };
}
