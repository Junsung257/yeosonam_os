import { PLATFORM_LABEL } from './display';
import type { Summary } from './types';

export type LaunchChecklistStep = {
  label: string;
  done: boolean;
  value: string;
  next: string;
};

export type LaunchWizardStep = {
  label: string;
  status: string;
  done: boolean;
  body: string;
};

export function getTotalMappingStatus(summary: Summary | null): number {
  return summary
    ? Object.values(summary.counts.mappings_by_status || {}).reduce((a, b) => a + b, 0)
    : 0;
}

export function getCompletionDrilldown(summary: Summary | null) {
  const requirements = summary?.enterprise_layer?.completion_audit?.requirements || [];
  const rank = { fail: 0, warn: 1, pass: 2 };
  return [...requirements]
    .sort((a, b) => rank[a.status] - rank[b.status])
    .slice(0, 4);
}

export function buildLaunchSteps(summary: Summary | null): LaunchChecklistStep[] {
  if (!summary) return [];

  return [
    {
      label: 'Publisher API',
      done: Boolean(summary.integration_status.naver || summary.integration_status.google),
      value: ['naver', 'google']
        .filter((platform) => summary.integration_status[platform])
        .map((platform) => PLATFORM_LABEL[platform] || platform)
        .join(', ') || 'needs key',
      next: 'Connect publisher API credentials before external activation.',
    },
    {
      label: 'Search budget',
      done: summary.channel_budgets.some((budget) =>
        ['naver', 'google'].includes(budget.platform) &&
        budget.status === 'active' &&
        budget.monthly_budget_krw > 0 &&
        budget.daily_budget_cap_krw > 0,
      ),
      value: summary.channel_budgets.filter((budget) =>
        ['naver', 'google'].includes(budget.platform) &&
        budget.status === 'active',
      ).length > 0 ? 'active' : 'pending',
      next: 'Set monthly budget, daily cap, and max CPC before active launch.',
    },
    {
      label: 'Keyword candidates',
      done: summary.kpis.keyword_candidates > 0,
      value: `${summary.kpis.keyword_candidates.toLocaleString('ko-KR')} items`,
      next: 'Generate keyword candidates from product mappings and long-tail search terms.',
    },
    {
      label: 'Guarded keywords',
      done: Number(summary.counts.keyword_plans_by_status?.approved || 0) > 0 ||
        Number(summary.counts.keyword_plans_by_status?.testing || 0) > 0,
      value: `${Number(summary.counts.keyword_plans_by_status?.approved || 0).toLocaleString('ko-KR')} approved`,
      next: 'Approve or test keywords before external publish.',
    },
    {
      label: 'Draft campaigns',
      done: summary.kpis.draft_campaigns > 0 || summary.kpis.active_campaigns > 0,
      value: `${Number(summary.kpis.draft_campaigns || 0).toLocaleString('ko-KR')} drafts`,
      next: 'Create internal draft campaigns and creatives before live execution.',
    },
  ];
}

function getSearchBudgetReadiness(summary: Summary | null) {
  const searchBudgets = summary?.channel_budgets.filter((budget) => ['naver', 'google'].includes(budget.platform)) || [];
  const hasActiveSearchBudget = searchBudgets.some((budget) =>
    budget.status === 'active' &&
    budget.monthly_budget_krw > 0 &&
    budget.daily_budget_cap_krw > 0,
  );
  const hasStoredNaverAdgroup = Boolean(searchBudgets.find((budget) => budget.platform === 'naver')?.external_ad_group_id);

  return { hasActiveSearchBudget, hasStoredNaverAdgroup };
}

export function buildLaunchWizardSteps(summary: Summary | null): LaunchWizardStep[] {
  if (!summary) return [];

  const readiness = getSearchBudgetReadiness(summary);

  return [
    {
      label: '1. Publisher API',
      status: summary.integration_status.naver || summary.integration_status.google ? 'ready' : 'missing',
      done: Boolean(summary.integration_status.naver || summary.integration_status.google),
      body: 'Connect publisher credentials before any external campaign activation.',
    },
    {
      label: '2. Budget cap',
      status: readiness.hasActiveSearchBudget ? 'active' : 'pending',
      done: readiness.hasActiveSearchBudget,
      body: 'Keep monthly, daily, max CPC, and test-loss guardrails configured.',
    },
    {
      label: '3. Draft campaign',
      status: summary.kpis.draft_campaigns > 0 || summary.kpis.active_campaigns > 0 ? 'ready' : 'missing',
      done: summary.kpis.draft_campaigns > 0 || summary.kpis.active_campaigns > 0,
      body: 'Create internal campaign and creative drafts before external publish.',
    },
    {
      label: '4. Naver ad group',
      status: readiness.hasStoredNaverAdgroup ? 'id stored' : 'not linked',
      done: readiness.hasStoredNaverAdgroup,
      body: 'Store the external ad group id before limited Naver execution.',
    },
  ];
}

export function getExecutionStateEntries(summary: Summary | null) {
  return Object.entries(summary?.channel_execution_states || {}).filter(([platform]) =>
    ['naver', 'google'].includes(platform),
  );
}

export function getActiveModeByPlatform(summary: Summary | null) {
  return new Map((summary?.active_automation_modes || []).map((mode) => [mode.platform, mode]));
}

export function getTenantReportView(tenantReport: Record<string, unknown> | null) {
  return {
    tenantReportBody: tenantReport?.report as Record<string, number> & { next_actions?: string[] } | undefined,
    tenantReportPeriod: tenantReport?.period as { from?: string; to?: string } | undefined,
  };
}
