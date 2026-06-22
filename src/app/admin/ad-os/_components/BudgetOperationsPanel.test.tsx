import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Summary } from '../_lib/types';
import type {
  BudgetOperationActionHandlers,
  BudgetOperationActionLoading,
} from './BudgetOperationActionBar';
import { BudgetOperationsPanel } from './BudgetOperationsPanel';

const budget: Summary['channel_budgets'][number] = {
  platform: 'naver',
  configured: true,
  monthly_budget_krw: 100000,
  daily_budget_cap_krw: 10000,
  max_cpc_krw: 500,
  max_test_loss_krw: 10000,
  automation_level: 2,
  status: 'paused',
  external_ad_group_id: 'adgroup-1',
};

describe('Ad OS BudgetOperationsPanel', () => {
  it('composes budget controls and operation result panels', () => {
    const html = renderToStaticMarkup(
      <BudgetOperationsPanel
        budgets={[budget]}
        onBudgetChange={() => {}}
        actions={{} as BudgetOperationActionHandlers}
        loading={{} as BudgetOperationActionLoading}
        tenantReportBody={{
          budget_usage_pct: 25,
          revenue_roas_pct: 140,
          margin_roas_pct: 80,
          cpa_krw: 12000,
          next_actions: ['Review low-margin keywords.'],
        }}
        tenantReportPeriod={{ from: '2026-06-01', to: '2026-06-05' }}
        launchAudit={{
          readiness: {
            pass: 1,
            warn: 0,
            fail: 0,
            total: 1,
            today_launch_ready: true,
            next_action: 'Ready for guarded launch.',
          },
          items: [{
            id: 'budget',
            label: 'Budget guardrail',
            status: 'pass',
            evidence: 'Budget caps configured.',
            next_action: 'Continue.',
          }],
        }}
        opsPlan={{ publisher: { naver: { state: 'ready', defaultMutationMode: 'dry_run' } } }}
        keywordBrainResult={{ summary: { candidates: 1 }, candidates: [{ keyword: 'seoul tour', tier: 'core' }] }}
        naverAssetPlan={{ summary: { inserted_change_requests: 1 }, plan: { mutations: [{ mutationType: 'keyword', title: 'Paused keyword' }] } }}
      />,
    );

    expect(html).toContain('Channel budget guardrails');
    expect(html).toContain('예산 저장');
    expect(html).toContain('광고주 리포트 요약');
    expect(html).toContain('Launch audit result');
    expect(html).toContain('Ops plan result');
    expect(html).toContain('키워드 브레인 결과');
    expect(html).toContain('Naver asset plan');
  });
});
