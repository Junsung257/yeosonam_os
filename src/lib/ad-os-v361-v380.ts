export type CompletionAuditStatus = 'ready' | 'needs_attention' | 'blocked';
export type CompletionRequirementStatus = 'pass' | 'warn' | 'fail';

export type CompletionRequirement = {
  id: string;
  label: string;
  status: CompletionRequirementStatus;
  evidence: string;
  next_action: string;
};

export type CompletionAuditSummary = {
  status: CompletionAuditStatus;
  readiness_score: number;
  passed: number;
  warnings: number;
  failed: number;
  requirements: CompletionRequirement[];
  top_blocker: string;
  next_action: string;
};

type CountSignal = {
  total?: number | null;
  blocked?: number | null;
  approved_or_running?: number | null;
  external_api_write_count?: number | null;
};

type ConversionQualitySignal = {
  status?: string | null;
  uploadable_conversions?: number | null;
  blocked_conversions?: number | null;
  attribution_coverage?: number | null;
};

type LearningLoopSignal = {
  status?: Record<string, boolean> | null;
  metrics?: {
    fact_clicks_30d?: number | null;
    fact_cta_clicks_30d?: number | null;
    fact_conversions_30d?: number | null;
    fact_spend_krw_30d?: number | null;
    fact_margin_krw_30d?: number | null;
  } | null;
};

type TenantPolicySignal = {
  configured?: boolean | null;
  full_auto_enabled?: boolean | null;
  monthly_budget_cap_krw?: number | null;
  daily_budget_cap_krw?: number | null;
  max_cpc_krw?: number | null;
  max_test_loss_krw?: number | null;
  require_human_approval?: boolean | null;
};

type IncidentSignal = {
  critical?: number | null;
  high?: number | null;
  open?: number | null;
  kill_switch_recommended?: boolean | null;
};

type AgencyReportingSignal = {
  status?: string | null;
  readiness_score?: number | null;
  active_billing_profiles?: number | null;
  ready_or_draft_reports?: number | null;
  ready_audit_exports?: number | null;
  full_auto_enabled?: number | null;
};

type ExperimentSignal = {
  templates?: number | null;
  active?: number | null;
  types?: number | null;
};

type AdapterSignal = {
  snapshots?: number | null;
  paused_write_ready?: number | null;
  draft_ready?: number | null;
  executable?: number | null;
  blocked?: number | null;
  external_api_write_count?: number | null;
};

type RuntimeReadinessSignal = {
  checks?: number | null;
  blocked_or_failed?: number | null;
  critical?: number | null;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function requirement(input: CompletionRequirement): CompletionRequirement {
  return input;
}

function countByStatus(requirements: CompletionRequirement[], status: CompletionRequirementStatus): number {
  return requirements.filter((row) => row.status === status).length;
}

export function buildAdOsCompletionAuditSummary(input: {
  platformJobQueue?: CountSignal | null;
  runtimeExecution?: CountSignal | null;
  channelAdapters?: AdapterSignal | null;
  writePackets?: CountSignal | null;
  executionGates?: CountSignal | null;
  rollbackDrills?: CountSignal | null;
  limitedWritePilot?: CountSignal | null;
  conversionDataQuality?: ConversionQualitySignal | null;
  learningLoop?: LearningLoopSignal | null;
  tenantPolicy?: TenantPolicySignal | null;
  tenantGuardrails?: Array<{ status?: string | null }> | null;
  tenantAdReadiness?: Array<{ status?: string | null }> | null;
  incidentResponse?: IncidentSignal | null;
  agencyReporting?: AgencyReportingSignal | null;
  experimentStandards?: ExperimentSignal | null;
  runtimeReadiness?: RuntimeReadinessSignal | null;
  creativeFactory?: { variants?: number | null; duplicate_content_risks?: number | null } | null;
}): CompletionAuditSummary {
  const externalWrites =
    Number(input.platformJobQueue?.external_api_write_count || 0) +
    Number(input.runtimeExecution?.external_api_write_count || 0) +
    Number(input.channelAdapters?.external_api_write_count || 0) +
    Number(input.writePackets?.external_api_write_count || 0) +
    Number(input.executionGates?.external_api_write_count || 0) +
    Number(input.rollbackDrills?.external_api_write_count || 0) +
    Number(input.limitedWritePilot?.external_api_write_count || 0);

  const tenantPolicy = input.tenantPolicy || {};
  const fullAutoEnabled =
    Boolean(tenantPolicy.full_auto_enabled) ||
    Number(input.agencyReporting?.full_auto_enabled || 0) > 0;
  const budgetReady =
    Number(tenantPolicy.monthly_budget_cap_krw || 0) > 0 &&
    Number(tenantPolicy.daily_budget_cap_krw || 0) > 0 &&
    Number(tenantPolicy.max_cpc_krw || 0) > 0 &&
    Number(tenantPolicy.max_test_loss_krw || 0) > 0 &&
    tenantPolicy.require_human_approval !== false;
  const learningStatus = input.learningLoop?.status || {};
  const marginLearningReady = Boolean(learningStatus.margin_learning_ready || learningStatus.attribution_ready);
  const blockedConversions = Number(input.conversionDataQuality?.blocked_conversions || 0);
  const uploadableConversions = Number(input.conversionDataQuality?.uploadable_conversions || 0);
  const guardrailFailures = (input.tenantGuardrails || []).filter((row) => row.status === 'fail').length;
  const readinessFailures = (input.tenantAdReadiness || []).filter((row) => row.status === 'fail').length;
  const adapterReadyCount =
    Number(input.channelAdapters?.paused_write_ready || 0) +
    Number(input.channelAdapters?.draft_ready || 0) +
    Number(input.channelAdapters?.executable || 0);
  const runtimeBlocked =
    Number(input.runtimeReadiness?.blocked_or_failed || 0) +
    Number(input.platformJobQueue?.blocked || 0) +
    Number(input.runtimeExecution?.blocked || 0);

  const requirements: CompletionRequirement[] = [
    requirement({
      id: 'external_write_zero',
      label: '승인 전 외부 광고비 지출 차단',
      status: externalWrites === 0 ? 'pass' : 'fail',
      evidence: `external write flags ${externalWrites}`,
      next_action: externalWrites === 0
        ? '외부 write 안전 상태를 유지합니다.'
        : '즉시 kill switch 검토 후 외부 mutation 결과와 실제 광고비를 대조하세요.',
    }),
    requirement({
      id: 'full_auto_default_off',
      label: '완전자동 기본 비활성',
      status: fullAutoEnabled ? 'fail' : 'pass',
      evidence: `full auto enabled ${fullAutoEnabled ? 1 : 0}`,
      next_action: fullAutoEnabled
        ? 'full_auto_enabled를 끄고 별도 운영 승인 정책으로 격리하세요.'
        : '승인형 또는 제한 예산 자동집행 모드를 기본값으로 유지합니다.',
    }),
    requirement({
      id: 'tenant_budget_guardrails',
      label: '테넌트 예산/승인 가드',
      status: tenantPolicy.configured && budgetReady && guardrailFailures === 0 ? 'pass' : tenantPolicy.configured ? 'warn' : 'fail',
      evidence: `policy ${tenantPolicy.configured ? 'configured' : 'missing'}, guardrail failures ${guardrailFailures}`,
      next_action: budgetReady
        ? '테넌트 예산 가드를 승인 큐와 실행 큐에 계속 연결합니다.'
        : '월/일 예산, max CPC, test-loss cap, human approval을 모두 설정하세요.',
    }),
    requirement({
      id: 'channel_adapter_readiness',
      label: '네이버/구글/Meta 실행 상태 가시화',
      status: Number(input.channelAdapters?.snapshots || 0) > 0 && adapterReadyCount > 0 ? 'pass' : 'warn',
      evidence: `adapter snapshots ${Number(input.channelAdapters?.snapshots || 0)}, ready ${adapterReadyCount}`,
      next_action: adapterReadyCount > 0
        ? '채널별 권한/캠페인/집행 가능 상태를 운영 화면에서 계속 노출합니다.'
        : '채널 health snapshot을 생성하고 권한 없음/캠페인 없음/집행 가능 상태를 채우세요.',
    }),
    requirement({
      id: 'platform_job_queue',
      label: '승인/실행/차단 큐',
      status: Number(input.platformJobQueue?.total || 0) > 0 ? 'pass' : 'warn',
      evidence: `platform jobs ${Number(input.platformJobQueue?.total || 0)}, blocked ${Number(input.platformJobQueue?.blocked || 0)}`,
      next_action: Number(input.platformJobQueue?.total || 0) > 0
        ? 'change request와 실행 큐의 before/after, rollback payload를 유지합니다.'
        : '상품 파이프라인에서 paused/draft platform job 후보를 생성하세요.',
    }),
    requirement({
      id: 'conversion_quality_layer',
      label: 'Google/Meta 전환 품질 게이트',
      status: blockedConversions === 0 && uploadableConversions > 0 ? 'pass' : blockedConversions > 0 ? 'fail' : 'warn',
      evidence: `uploadable ${uploadableConversions}, blocked ${blockedConversions}`,
      next_action: blockedConversions > 0
        ? 'consent, PII, dedupe, freshness blocker를 해소한 뒤 업로드 후보를 재계산하세요.'
        : 'clean conversion 후보를 performance fact와 예약/마진 attribution에 연결하세요.',
    }),
    requirement({
      id: 'learning_loop_margin_fact',
      label: '클릭/CTA/예약/마진 학습 루프',
      status: marginLearningReady ? 'pass' : 'warn',
      evidence: `margin learning ready ${marginLearningReady ? 1 : 0}`,
      next_action: marginLearningReady
        ? 'CPA와 margin ROAS 기준 pause/scale/repair 후보를 생성합니다.'
        : '클릭, CTA, 예약, 광고비, 마진 fact를 tenant/product/scenario/keyword 단위로 동기화하세요.',
    }),
    requirement({
      id: 'creative_and_duplicate_control',
      label: 'Creative Factory와 중복 글 제어',
      status: Number(input.creativeFactory?.variants || 0) > 0 && Number(input.creativeFactory?.duplicate_content_risks || 0) === 0 ? 'pass' : Number(input.creativeFactory?.variants || 0) > 0 ? 'warn' : 'warn',
      evidence: `variants ${Number(input.creativeFactory?.variants || 0)}, duplicate risks ${Number(input.creativeFactory?.duplicate_content_risks || 0)}`,
      next_action: Number(input.creativeFactory?.duplicate_content_risks || 0) > 0
        ? '새 글 생성 대신 허브 업데이트, CTA 교체, FAQ/내부링크/카드뉴스로 전환하세요.'
        : '상품별 검색광고/블로그/카드뉴스/리타겟팅 소재 후보를 계속 생성합니다.',
    }),
    requirement({
      id: 'experiment_standards',
      label: '증분성/AB 실험 표준',
      status: Number(input.experimentStandards?.templates || 0) > 0 ? 'pass' : 'warn',
      evidence: `experiment templates ${Number(input.experimentStandards?.templates || 0)}, active ${Number(input.experimentStandards?.active || 0)}`,
      next_action: Number(input.experimentStandards?.templates || 0) > 0
        ? '충분한 표본 전 자동 승패 판정 금지 정책을 유지합니다.'
        : 'holdout, date split, landing/creative/keyword match type 실험 템플릿을 생성하세요.',
    }),
    requirement({
      id: 'agency_saas_reporting',
      label: 'SaaS/광고사 리포팅 패키지',
      status: input.agencyReporting?.status === 'ready' ? 'pass' : input.agencyReporting?.status === 'blocked' ? 'fail' : 'warn',
      evidence: `agency status ${input.agencyReporting?.status || 'unknown'}, score ${Number(input.agencyReporting?.readiness_score || 0)}`,
      next_action: input.agencyReporting?.status === 'ready'
        ? '월간 리포트와 audit export를 운영자 검토 후 테넌트별로 배포합니다.'
        : 'billing profile, monthly report draft, audit export, incident clearance를 채우세요.',
    }),
    requirement({
      id: 'incident_response_clear',
      label: 'Incident/Kill switch 대응',
      status: Number(input.incidentResponse?.critical || 0) > 0 ? 'fail' : Number(input.incidentResponse?.high || 0) > 0 || runtimeBlocked > 0 ? 'warn' : 'pass',
      evidence: `critical ${Number(input.incidentResponse?.critical || 0)}, high ${Number(input.incidentResponse?.high || 0)}, runtime blocked ${runtimeBlocked}`,
      next_action: Number(input.incidentResponse?.critical || 0) > 0
        ? 'critical incident를 해소하고 kill switch 권고를 우선 처리하세요.'
        : 'blocked/high 항목을 failed queue에서 확인하고 dry-run 재검증하세요.',
    }),
    requirement({
      id: 'readiness_signal_health',
      label: '런타임 readiness 증거',
      status: Number(input.runtimeReadiness?.checks || 0) > 0 && readinessFailures === 0 ? 'pass' : Number(input.runtimeReadiness?.checks || 0) > 0 ? 'warn' : 'warn',
      evidence: `runtime checks ${Number(input.runtimeReadiness?.checks || 0)}, tenant readiness failures ${readinessFailures}`,
      next_action: Number(input.runtimeReadiness?.checks || 0) > 0
        ? 'runtime readiness snapshot을 staging과 운영 DB에서 주기적으로 갱신하세요.'
        : 'summary smoke와 runtime readiness route를 실행해 현재 증거를 수집하세요.',
    }),
  ];

  const failed = countByStatus(requirements, 'fail');
  const warnings = countByStatus(requirements, 'warn');
  const passed = countByStatus(requirements, 'pass');
  const score = clampScore((passed / requirements.length) * 100 - failed * 10 - warnings * 2);
  const topBlocker = requirements.find((row) => row.status === 'fail') || requirements.find((row) => row.status === 'warn');
  const status: CompletionAuditStatus = failed > 0 ? 'blocked' : warnings > 0 ? 'needs_attention' : 'ready';

  return {
    status,
    readiness_score: score,
    passed,
    warnings,
    failed,
    requirements,
    top_blocker: topBlocker?.label || 'No blocker',
    next_action: topBlocker?.next_action || 'All audited requirements have current supporting evidence.',
  };
}
