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
  { key: 'saveBudgets', id: 'save-budgets', label: 'Save budgets', icon: Save, primary: true },
  { key: 'generateCandidates', id: 'generate-candidates', label: 'Generate candidates', icon: Bot },
  { key: 'runDryRun', id: 'dry-run', label: 'Automation dry-run', icon: PlayCircle },
  { key: 'runLaunchAudit', id: 'launch-audit', label: 'Launch audit', icon: CheckCircle2 },
  { key: 'probePublisher', id: 'probe-publisher', label: 'Publisher probe', icon: KeyRound },
  { key: 'runGuardedApply', id: 'guarded-apply', label: 'Guarded apply', icon: ShieldCheck },
  { key: 'runPilotSetup', id: 'pilot-setup', label: 'Prepare pilot', icon: Rocket },
  { key: 'publishDrafts', id: 'publish-drafts', label: 'Publish drafts', icon: Rocket },
  { key: 'publishNaverPausedKeywords', id: 'publish-naver-paused', label: 'Create Naver paused keywords', icon: PauseCircle },
  { key: 'activateNaverPausedKeywords', id: 'activate-naver-paused', label: 'Activate Naver paused keywords', icon: PlayCircle },
  { key: 'approveNaverCandidates', id: 'approve-naver', label: 'Approve Naver candidates', icon: Check },
  { key: 'probeNaverAdgroups', id: 'probe-naver-adgroups', label: 'Probe Naver ad groups', icon: Search },
  { key: 'probeNaverAssets', id: 'probe-naver-assets', label: 'Probe Naver assets', icon: Layers },
  { key: 'syncNaverAssets', id: 'sync-naver-assets', label: 'Sync Naver assets', icon: Save },
  { key: 'harvestLearning', id: 'harvest-learning', label: 'Harvest learning', icon: Gauge },
  { key: 'harvestSearchTerms', id: 'harvest-search-terms', label: 'Harvest search terms', icon: Search },
  { key: 'syncPerformanceFacts', id: 'sync-performance', label: 'Sync performance facts', icon: MousePointerClick },
  { key: 'runConversionAttribution', id: 'conversion-attribution', label: 'Conversion attribution', icon: Gauge },
  { key: 'applyLearningRules', id: 'apply-learning', label: 'Apply learning rules', icon: ShieldCheck },
  { key: 'planExperiments', id: 'plan-experiments', label: 'Plan experiments', icon: Bot },
  { key: 'optimizePerformance', id: 'optimize-performance', label: 'Performance optimize dry-run', icon: ShieldCheck },
  { key: 'dryRunExternalPublish', id: 'external-publish', label: 'External publish dry-run', icon: Rocket },
  { key: 'probeGooglePublisher', id: 'probe-google', label: 'Google publisher probe', icon: KeyRound },
  { key: 'runBudgetPacing', id: 'budget-pacing', label: 'Budget pacing', icon: Wallet },
  { key: 'runOptimizationSafePipeline', id: 'optimization-safe-pipeline', label: 'Optimization safe pipeline', icon: Gauge },
  { key: 'loadTenantReport', id: 'tenant-report', label: 'Load tenant report', icon: Download },
  { key: 'buildOpsPlan', id: 'ops-plan', label: 'Build ops plan', icon: Bot },
  { key: 'runKeywordBrain', id: 'keyword-brain', label: 'Keyword Brain', icon: Search },
  { key: 'createNaverAssets', id: 'create-naver-assets', label: 'Create Naver assets', icon: Rocket },
  { key: 'executeNaverGate', id: 'execute-naver-gate', label: 'Execute Naver gate', icon: ShieldCheck },
  { key: 'exportGoogleConversions', id: 'google-export', label: 'Google conversion export', icon: Download },
  { key: 'exportMetaConversions', id: 'meta-export', label: 'Meta conversion export', icon: Download },
  { key: 'runBidOptimizer', id: 'bid-optimizer', label: 'Bid optimizer', icon: Gauge },
  { key: 'runExperimentRunner', id: 'experiment-runner', label: 'Experiment runner', icon: Bot },
  { key: 'applyBlogEvolution', id: 'blog-evolution', label: 'Apply blog evolution', icon: Layers },
  { key: 'createCreativeDrafts', id: 'creative-drafts', label: 'Create creative drafts', icon: Layers },
  { key: 'syncBookingFunnel', id: 'booking-funnel', label: 'Sync booking funnel', icon: MousePointerClick },
  { key: 'runExpiryCleanup', id: 'expiry-cleanup', label: 'Expiry cleanup', icon: CalendarX },
  { key: 'runKillSwitchDryRun', id: 'kill-switch', label: 'Kill-switch dry-run', icon: PauseCircle },
];

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

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {actions.map((action) => {
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
      })}
    </div>
  );
}
