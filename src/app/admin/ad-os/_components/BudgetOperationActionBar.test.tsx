import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BudgetOperationActionBar,
  type BudgetOperationActionHandlers,
  type BudgetOperationActionLoading,
} from './BudgetOperationActionBar';

const noop = () => {};

const actions: BudgetOperationActionHandlers = {
  saveBudgets: noop,
  generateCandidates: noop,
  runDryRun: noop,
  runLaunchAudit: noop,
  probePublisher: noop,
  runGuardedApply: noop,
  runPilotSetup: noop,
  publishDrafts: noop,
  publishNaverPausedKeywords: noop,
  activateNaverPausedKeywords: noop,
  approveNaverCandidates: noop,
  probeNaverAdgroups: noop,
  probeNaverAssets: noop,
  syncNaverAssets: noop,
  harvestLearning: noop,
  harvestSearchTerms: noop,
  syncPerformanceFacts: noop,
  runConversionAttribution: noop,
  applyLearningRules: noop,
  planExperiments: noop,
  optimizePerformance: noop,
  dryRunExternalPublish: noop,
  probeGooglePublisher: noop,
  runBudgetPacing: noop,
  runOptimizationSafePipeline: noop,
  loadTenantReport: noop,
  buildOpsPlan: noop,
  runKeywordBrain: noop,
  createNaverAssets: noop,
  executeNaverGate: noop,
  exportGoogleConversions: noop,
  exportMetaConversions: noop,
  runBidOptimizer: noop,
  runExperimentRunner: noop,
  applyBlogEvolution: noop,
  createCreativeDrafts: noop,
  syncBookingFunnel: noop,
  runExpiryCleanup: noop,
  runKillSwitchDryRun: noop,
};

const loading: BudgetOperationActionLoading = Object.fromEntries(
  Object.keys(actions).map((key) => [key, false]),
) as BudgetOperationActionLoading;

const baseProps = {
  actions,
  loading,
};

describe('Ad OS BudgetOperationActionBar', () => {
  it('renders the budget operation controls with readable labels', () => {
    const html = renderToStaticMarkup(<BudgetOperationActionBar {...baseProps} />);

    expect(html).toContain('Save budgets');
    expect(html).toContain('Launch audit');
    expect(html).toContain('Create Naver paused keywords');
    expect(html).toContain('Budget pacing');
    expect(html).toContain('Optimization safe pipeline');
    expect(html).toContain('Kill-switch dry-run');
  });

  it('renders all configured actions as buttons', () => {
    const html = renderToStaticMarkup(
      <BudgetOperationActionBar
        {...baseProps}
        loading={{ ...loading, saveBudgets: true }}
      />,
    );

    expect((html.match(/<button/g) || []).length).toBe(39);
    expect(html).toContain('Save budgets');
  });
});
