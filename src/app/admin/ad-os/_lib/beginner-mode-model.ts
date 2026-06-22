import type { AdOsAgentOperatingModel } from './agent-operating-model';
import type { LaunchActionKey, Summary } from './types';

export type BeginnerAdOpsStatus = 'ready' | 'attention' | 'blocked';

export type BeginnerAdOpsModel = {
  status: BeginnerAdOpsStatus;
  title: string;
  summary: string;
  primaryAction: Summary['launch_action_queue'][number] | null;
  visibleActions: Summary['launch_action_queue'];
  hiddenAdvancedCount: number;
  blockers: string[];
  nextSteps: string[];
  metrics: Array<{ label: string; value: string; tone?: BeginnerAdOpsStatus }>;
  safetyNote: string;
};

const BEGINNER_SAFE_ACTIONS = new Set<LaunchActionKey>([
  'refresh',
  'runPilotSetup',
  'generateNaverSetupPacket',
  'probePublisher',
  'generateCandidates',
  'runKeywordBrain',
  'harvestLearning',
  'runConversionAttribution',
  'runLaunchAudit',
  'runKillSwitchDryRun',
]);

function num(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isBeginnerSafeAction(action: Summary['launch_action_queue'][number]) {
  return BEGINNER_SAFE_ACTIONS.has(action.ui_action);
}

export function buildBeginnerAdOpsModel(
  summary: Summary,
  aiModel: AdOsAgentOperatingModel | null,
): BeginnerAdOpsModel {
  const publisherConnected = Boolean(summary.integration_status.naver || summary.integration_status.google);
  const activeSearchBudgets = summary.channel_budgets.filter((budget) =>
    ['naver', 'google'].includes(budget.platform) &&
    budget.status === 'active' &&
    budget.monthly_budget_krw > 0 &&
    budget.daily_budget_cap_krw > 0,
  );
  const keywordCandidates = num(summary.kpis.keyword_candidates);
  const approvedOrTestingKeywords =
    num(summary.counts.keyword_plans_by_status?.approved) +
    num(summary.counts.keyword_plans_by_status?.testing);
  const draftCampaigns = num(summary.kpis.draft_campaigns) + num(summary.kpis.active_campaigns);
  const readyPublishers = ['naver', 'google'].filter((platform) => summary.external_launch_status?.[platform]?.ready);
  const externalWriteCount = num(summary.enterprise_layer?.platform_job_queue?.external_api_write_count) +
    num(summary.enterprise_layer?.runtime_execution?.external_api_write_count) +
    num(summary.enterprise_layer?.channel_adapters?.external_api_write_count) +
    num(summary.enterprise_layer?.write_packets?.external_api_write_count);
  const policyBlocked = ['restricted', 'blocked'].includes(String(summary.tenant_policy?.risk_status || ''));

  const blockers: string[] = [];
  if (!publisherConnected) blockers.push('네이버/구글 광고 계정 API 연결이 필요합니다.');
  if (activeSearchBudgets.length === 0) blockers.push('월예산, 일한도, 최대 CPC가 설정된 검색광고 예산이 필요합니다.');
  if (keywordCandidates === 0) blockers.push('광고에 쓸 키워드 후보가 아직 없습니다.');
  if (approvedOrTestingKeywords === 0) blockers.push('승인 또는 테스트 상태의 키워드가 필요합니다.');
  if (draftCampaigns === 0) blockers.push('외부 반영 전 내부 캠페인/소재 초안이 필요합니다.');
  if (policyBlocked) blockers.push('현재 테넌트 안전 정책이 제한 또는 차단 상태입니다.');

  const visibleActions = (summary.launch_action_queue || [])
    .filter(isBeginnerSafeAction)
    .slice(0, 3);
  const primaryAction = visibleActions[0] || null;
  const hiddenAdvancedCount = Math.max(0, (summary.launch_action_queue || []).length - visibleActions.length) + 10;
  const ready = readyPublishers.length > 0 && blockers.length === 0 && externalWriteCount === 0;
  const status: BeginnerAdOpsStatus = ready ? 'ready' : blockers.length >= 3 || policyBlocked ? 'blocked' : 'attention';

  const title = status === 'ready'
    ? '광고 시작 준비 완료'
    : status === 'attention'
      ? '광고 시작 전 확인 필요'
      : '아직 광고 시작 불가';

  const nextSteps = blockers.length > 0
    ? blockers.slice(0, 3)
    : [
        'AI 광고팀 진단으로 오늘의 키워드/소재/예산 상태를 확인하세요.',
        '승인 요청까지만 진행하고 실제 외부 반영은 고급 탭에서 검수하세요.',
      ];

  return {
    status,
    title,
    summary: ready
      ? `${readyPublishers.map((platform) => platform === 'naver' ? '네이버' : '구글').join(', ')} 파일럿 집행 조건이 충족됐습니다.`
      : '초보자 화면에서는 진단, 초안 생성, 승인 요청까지만 진행합니다.',
    primaryAction,
    visibleActions,
    hiddenAdvancedCount,
    blockers,
    nextSteps,
    metrics: [
      { label: '광고 계정', value: publisherConnected ? '연결됨' : '미연결', tone: publisherConnected ? 'ready' : 'blocked' },
      { label: '활성 예산', value: `${activeSearchBudgets.length}개`, tone: activeSearchBudgets.length > 0 ? 'ready' : 'blocked' },
      { label: '승인 키워드', value: `${approvedOrTestingKeywords.toLocaleString('ko-KR')}개`, tone: approvedOrTestingKeywords > 0 ? 'ready' : 'attention' },
      { label: 'AI 팀 점수', value: `${aiModel?.teamScore ?? 0}%`, tone: (aiModel?.teamScore ?? 0) >= 80 ? 'ready' : 'attention' },
      { label: '외부 쓰기', value: `${externalWriteCount.toLocaleString('ko-KR')}건`, tone: externalWriteCount === 0 ? 'ready' : 'blocked' },
    ],
    safetyNote: '기본 화면은 승인 전용입니다. 실제 광고비가 나가는 외부 반영은 고급/감사 탭에서만 확인합니다.',
  };
}
