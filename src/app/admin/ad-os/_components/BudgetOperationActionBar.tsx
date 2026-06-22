import {
  Bot,
  CalendarX,
  Check,
  CheckCircle2,
  Download,
  Gauge,
  KeyRound,
  Layers,
  MousePointerClick,
  PauseCircle,
  PlayCircle,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Button from '@/components/ui/Button';

type BudgetOperationAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  loading: boolean;
  primary?: boolean;
};

export type BudgetOperationActionKey =
  | 'saveBudgets'
  | 'generateCandidates'
  | 'runDryRun'
  | 'runLaunchAudit'
  | 'probePublisher'
  | 'runGuardedApply'
  | 'runPilotSetup'
  | 'publishDrafts'
  | 'publishNaverPausedKeywords'
  | 'activateNaverPausedKeywords'
  | 'approveNaverCandidates'
  | 'probeNaverAdgroups'
  | 'probeNaverAssets'
  | 'syncNaverAssets'
  | 'harvestLearning'
  | 'harvestSearchTerms'
  | 'syncPerformanceFacts'
  | 'runConversionAttribution'
  | 'applyLearningRules'
  | 'planExperiments'
  | 'optimizePerformance'
  | 'dryRunExternalPublish'
  | 'probeGooglePublisher'
  | 'runBudgetPacing'
  | 'runOptimizationSafePipeline'
  | 'loadTenantReport'
  | 'buildOpsPlan'
  | 'runKeywordBrain'
  | 'createNaverAssets'
  | 'executeNaverGate'
  | 'exportGoogleConversions'
  | 'exportMetaConversions'
  | 'runBidOptimizer'
  | 'runExperimentRunner'
  | 'applyBlogEvolution'
  | 'createCreativeDrafts'
  | 'syncBookingFunnel'
  | 'runExpiryCleanup'
  | 'runKillSwitchDryRun';

export type BudgetOperationActionHandlers = Record<BudgetOperationActionKey, () => void>;
export type BudgetOperationActionLoading = Record<BudgetOperationActionKey, boolean>;

type BudgetOperationActionSpec = {
  key: BudgetOperationActionKey;
  id: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
};

const BUDGET_OPERATION_ACTIONS: BudgetOperationActionSpec[] = [
  { key: 'saveBudgets', id: 'save-budgets', label: '예산 저장', icon: Save, primary: true },
  { key: 'generateCandidates', id: 'generate-candidates', label: '후보 생성', icon: Bot },
  { key: 'runDryRun', id: 'dry-run', label: '자동화 점검', icon: PlayCircle },
  { key: 'runLaunchAudit', id: 'launch-audit', label: '집행 점검', icon: CheckCircle2 },
  { key: 'probePublisher', id: 'probe-publisher', label: '광고 API 확인', icon: KeyRound },
  { key: 'runGuardedApply', id: 'guarded-apply', label: '안전 적용', icon: ShieldCheck },
  { key: 'runPilotSetup', id: 'pilot-setup', label: '파일럿 준비', icon: Rocket },
  { key: 'publishDrafts', id: 'publish-drafts', label: '초안 반영', icon: Rocket },
  { key: 'publishNaverPausedKeywords', id: 'publish-naver-paused', label: '네이버 중지 키워드 생성', icon: PauseCircle },
  { key: 'activateNaverPausedKeywords', id: 'activate-naver-paused', label: '네이버 키워드 활성화', icon: PlayCircle },
  { key: 'approveNaverCandidates', id: 'approve-naver', label: '네이버 후보 승인', icon: Check },
  { key: 'probeNaverAdgroups', id: 'probe-naver-adgroups', label: '네이버 광고그룹 확인', icon: Search },
  { key: 'probeNaverAssets', id: 'probe-naver-assets', label: '네이버 자산 확인', icon: Layers },
  { key: 'syncNaverAssets', id: 'sync-naver-assets', label: '네이버 자산 동기화', icon: Save },
  { key: 'harvestLearning', id: 'harvest-learning', label: '학습 수집', icon: Gauge },
  { key: 'harvestSearchTerms', id: 'harvest-search-terms', label: '검색어 수집', icon: Search },
  { key: 'syncPerformanceFacts', id: 'sync-performance', label: '성과 데이터 동기화', icon: MousePointerClick },
  { key: 'runConversionAttribution', id: 'conversion-attribution', label: '전환 귀속', icon: Gauge },
  { key: 'applyLearningRules', id: 'apply-learning', label: '학습 규칙 적용', icon: ShieldCheck },
  { key: 'planExperiments', id: 'plan-experiments', label: '실험 설계', icon: Bot },
  { key: 'optimizePerformance', id: 'optimize-performance', label: '성과 최적화 점검', icon: ShieldCheck },
  { key: 'dryRunExternalPublish', id: 'external-publish', label: '외부 반영 드라이런', icon: Rocket },
  { key: 'probeGooglePublisher', id: 'probe-google', label: '구글 API 확인', icon: KeyRound },
  { key: 'runBudgetPacing', id: 'budget-pacing', label: '예산 페이싱', icon: Wallet },
  { key: 'runOptimizationSafePipeline', id: 'optimization-safe-pipeline', label: '최적화 안전 파이프라인', icon: Gauge },
  { key: 'loadTenantReport', id: 'tenant-report', label: '광고주 리포트 불러오기', icon: Download },
  { key: 'buildOpsPlan', id: 'ops-plan', label: '운영 계획 생성', icon: Bot },
  { key: 'runKeywordBrain', id: 'keyword-brain', label: 'Keyword Brain', icon: Search },
  { key: 'createNaverAssets', id: 'create-naver-assets', label: '네이버 자산 생성', icon: Rocket },
  { key: 'executeNaverGate', id: 'execute-naver-gate', label: '네이버 게이트 실행', icon: ShieldCheck },
  { key: 'exportGoogleConversions', id: 'google-export', label: '구글 전환 내보내기', icon: Download },
  { key: 'exportMetaConversions', id: 'meta-export', label: 'Meta 전환 내보내기', icon: Download },
  { key: 'runBidOptimizer', id: 'bid-optimizer', label: '입찰 최적화', icon: Gauge },
  { key: 'runExperimentRunner', id: 'experiment-runner', label: '실험 실행', icon: Bot },
  { key: 'applyBlogEvolution', id: 'blog-evolution', label: '블로그 개선 적용', icon: Layers },
  { key: 'createCreativeDrafts', id: 'creative-drafts', label: '소재 초안 생성', icon: Layers },
  { key: 'syncBookingFunnel', id: 'booking-funnel', label: '예약 퍼널 동기화', icon: MousePointerClick },
  { key: 'runExpiryCleanup', id: 'expiry-cleanup', label: '만료 정리', icon: CalendarX },
  { key: 'runKillSwitchDryRun', id: 'kill-switch', label: '긴급 중지 점검', icon: PauseCircle },
];

const PRIMARY_ACTION_IDS = new Set([
  'save-budgets',
  'generate-candidates',
  'dry-run',
  'launch-audit',
  'harvest-learning',
  'harvest-search-terms',
  'budget-pacing',
  'tenant-report',
]);

export function BudgetOperationActionBar({
  actions: handlers,
  loading,
}: {
  actions: BudgetOperationActionHandlers;
  loading: BudgetOperationActionLoading;
}) {
  const actions: BudgetOperationAction[] = [
    ...BUDGET_OPERATION_ACTIONS.map((action) => ({
      ...action,
      onClick: handlers[action.key],
      loading: loading[action.key],
    })),
  ];
  const primaryActions = actions.filter((action) => action.primary || PRIMARY_ACTION_IDS.has(action.id));
  const advancedActions = actions.filter((action) => !primaryActions.includes(action));

  const renderButton = (action: BudgetOperationAction) => {
    const Icon = action.icon;
    return (
      <Button
        key={action.id}
        size="sm"
        variant={action.primary ? 'primary' : 'secondary'}
        onClick={action.onClick}
        loading={action.loading}
      >
        <Icon size={14} />
        {action.label}
      </Button>
    );
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {primaryActions.map(renderButton)}
      </div>
      <details className="rounded-admin-sm border border-admin-border bg-admin-surface px-3 py-2">
        <summary className="cursor-pointer text-admin-xs font-semibold text-admin-text">
          고급 작업 {advancedActions.length}개
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {advancedActions.map(renderButton)}
        </div>
      </details>
    </div>
  );
}
