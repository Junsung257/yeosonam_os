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
      label: '운영 안전장치',
      status: completion && completion.failed === 0 && externalWriteCount === 0 && smokePasses ? 'operational' : externalWriteCount > 0 ? 'blocked' : 'partial',
      evidence: `완료 점검 ${completion?.status || '미확인'}, 사전 점검 ${smoke?.status || '미확인'}, 외부 반영 ${externalWriteCount}건`,
      next_action: smokePasses
        ? 'DB 기반 사전 실행 전에는 읽기 전용 점검을 계속 유지하세요.'
        : '준비 완료로 표시하기 전에 완료 점검과 사전 안전 점검을 복구하세요.',
      risk: externalWriteCount > 0 ? 'high' : 'low',
    }),
    item({
      id: 'operator_ux',
      label: '운영자 화면 근거',
      status: completion && smoke ? 'operational' : 'partial',
      evidence: `완료 점검 항목 ${completion?.requirements.length || 0}개, 사전 점검 통과 ${smoke?.passed_assertions || 0}개`,
      next_action: '완료 점검, 실행 준비, 채널 연결 카드와 함께 운영 근거를 확인하세요.',
      risk: 'medium',
    }),
    item({
      id: 'channel_execution',
      label: '네이버/구글/메타 실행 연결',
      status: channelSnapshots > 0 && channelReady > 0 ? 'operational' : channelSnapshots > 0 ? 'partial' : 'blocked',
      evidence: `채널 점검 ${channelSnapshots}개, 준비 상태 ${channelReady}개`,
      next_action: channelReady > 0
        ? '계정과 전환 설정이 통과될 때까지 네이버는 정지/사전 점검 우선, 구글/메타 실반영은 꺼두세요.'
        : '연결된 채널별 상태 점검과 정지/초안 패킷을 먼저 만드세요.',
      risk: channelReady > 0 ? 'medium' : 'high',
    }),
    item({
      id: 'conversion_quality',
      label: '전환 데이터 품질',
      status: conversionBlocked > 0 ? 'blocked' : conversionUploadable > 0 ? 'operational' : 'partial',
      evidence: `업로드 가능 전환 ${conversionUploadable}개, 막힌 전환 ${conversionBlocked}개`,
      next_action: conversionUploadable > 0
        ? '정상 전환 작업을 예약 마진 귀속의 기준으로 사용하세요.'
        : '동의, 중복 제거, 최신성, 식별 품질이 확인된 전환 후보를 수집하세요.',
      risk: conversionBlocked > 0 ? 'high' : 'medium',
    }),
    item({
      id: 'learning_loop',
      label: '예약 마진 학습 루프',
      status: marginReady ? 'operational' : numberValue(enterprise.portfolio_optimizer?.candidates) > 0 ? 'partial' : 'blocked',
      evidence: `마진 학습 ${marginReady ? '준비' : '미준비'}, 최적화 후보 ${numberValue(enterprise.portfolio_optimizer?.candidates)}개`,
      next_action: marginReady
        ? '마진 ROAS 근거로 중지, 확대, 랜딩 수정, 소재 교체 후보를 만드세요.'
        : '상품/키워드/블로그/소재/채널별 클릭, CTA, 예약, 비용, 매출, 마진, CPA, ROAS 근거를 정리하세요.',
      risk: marginReady ? 'medium' : 'high',
    }),
    item({
      id: 'creative_factory',
      label: '여행 소재 생성',
      status: creativeVariants > 0 && duplicateRisks === 0 ? 'operational' : creativeVariants > 0 ? 'partial' : 'blocked',
      evidence: `소재 변형 ${creativeVariants}개, 중복 위험 ${duplicateRisks}개`,
      next_action: duplicateRisks > 0
        ? '중복 블로그 생성보다 허브 업데이트, CTA 교체, FAQ/내부링크, 카드뉴스를 우선하세요.'
        : '소재 피로도, CTR 하락, CPA 추세 근거와 소재 변형을 연결해 유지하세요.',
      risk: duplicateRisks > 0 ? 'high' : 'medium',
    }),
    item({
      id: 'tenant_saas',
      label: '광고주 운영 패키지',
      status: numberValue(enterprise.saas_packaging?.workspaces) > 0 && numberValue(enterprise.saas_packaging?.active_billing_profiles) > 0 ? 'operational' : 'partial',
      evidence: `워크스페이스 ${numberValue(enterprise.saas_packaging?.workspaces)}개, 과금 프로필 ${numberValue(enterprise.saas_packaging?.active_billing_profiles)}개`,
      next_action: '광고주별 예산, 승인자, 감사 파일, 데이터 보관, 월간 리포트를 분리해 유지하세요.',
      risk: 'medium',
    }),
    item({
      id: 'live_autopilot',
      label: '자동 집행 준비',
      status: livePilotEnabled > 0 || fullAutoEnabled > 0 ? 'blocked' : numberValue(enterprise.limited_write_pilot?.dry_run_succeeded) > 0 ? 'partial' : 'partial',
      evidence: `제한 시범 사전 점검 ${numberValue(enterprise.limited_write_pilot?.dry_run_succeeded)}개, 실집행 ${livePilotEnabled}, 완전 자동 ${fullAutoEnabled}`,
      next_action: livePilotEnabled > 0 || fullAutoEnabled > 0
        ? '광고주 승인, 예산 한도, 긴급 중지 해제, 실험 신뢰도가 확인될 때까지 실집행/완전 자동을 끄세요.'
        : '실제 광고비 사용 전에는 추천 -> 승인 -> 제한 사전 점검 흐름을 기본으로 유지하세요.',
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
    top_gap: topGap?.label || '운영 막힘 없음',
    next_action: topGap?.next_action || '모든 광고 운영 항목에 최신 근거가 있습니다.',
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
    },
  };
}
