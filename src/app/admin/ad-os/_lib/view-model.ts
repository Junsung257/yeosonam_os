import { PLATFORM_LABEL } from './display';
import { buildAdOsAgentOperatingModel } from './agent-operating-model';
import { buildBeginnerAdOpsModel } from './beginner-mode-model';
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

export function getAdOsAgentOperatingModel(summary: Summary | null) {
  return summary ? buildAdOsAgentOperatingModel(summary) : null;
}

export function getBeginnerAdOpsModel(summary: Summary | null) {
  if (!summary) return null;
  return buildBeginnerAdOpsModel(summary, getAdOsAgentOperatingModel(summary));
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
      label: '광고 API',
      done: Boolean(summary.integration_status.naver || summary.integration_status.google),
      value: ['naver', 'google']
        .filter((platform) => summary.integration_status[platform])
        .map((platform) => PLATFORM_LABEL[platform] || platform)
        .join(', ') || '키 필요',
      next: '외부 광고를 켜기 전에 네이버/구글 API 키를 연결하세요.',
    },
    {
      label: '검색광고 예산',
      done: summary.channel_budgets.some((budget) =>
        ['naver', 'google'].includes(budget.platform) &&
        budget.status === 'active' &&
        budget.monthly_budget_krw > 0 &&
        budget.daily_budget_cap_krw > 0,
      ),
      value: summary.channel_budgets.filter((budget) =>
        ['naver', 'google'].includes(budget.platform) &&
        budget.status === 'active',
      ).length > 0 ? '활성' : '대기',
      next: '월예산, 일한도, 최대 CPC를 먼저 설정하세요.',
    },
    {
      label: '키워드 후보',
      done: summary.kpis.keyword_candidates > 0,
      value: `${summary.kpis.keyword_candidates.toLocaleString('ko-KR')}개`,
      next: '상품 매핑과 롱테일 검색어에서 키워드 후보를 생성하세요.',
    },
    {
      label: '승인 키워드',
      done: Number(summary.counts.keyword_plans_by_status?.approved || 0) > 0 ||
        Number(summary.counts.keyword_plans_by_status?.testing || 0) > 0,
      value: `${Number(summary.counts.keyword_plans_by_status?.approved || 0).toLocaleString('ko-KR')}개 승인`,
      next: '외부 반영 전에 키워드를 승인하거나 테스트 상태로 두세요.',
    },
    {
      label: '캠페인 초안',
      done: summary.kpis.draft_campaigns > 0 || summary.kpis.active_campaigns > 0,
      value: `${Number(summary.kpis.draft_campaigns || 0).toLocaleString('ko-KR')}개 초안`,
      next: '실집행 전에 내부 캠페인/소재 초안을 만드세요.',
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
      label: '1. 광고 API',
      status: summary.integration_status.naver || summary.integration_status.google ? '준비' : '미연결',
      done: Boolean(summary.integration_status.naver || summary.integration_status.google),
      body: '외부 캠페인을 켜기 전에 광고 계정 인증을 연결합니다.',
    },
    {
      label: '2. 예산 한도',
      status: readiness.hasActiveSearchBudget ? '활성' : '대기',
      done: readiness.hasActiveSearchBudget,
      body: '월예산, 일한도, 최대 CPC, 테스트 손실 한도를 유지합니다.',
    },
    {
      label: '3. 캠페인 초안',
      status: summary.kpis.draft_campaigns > 0 || summary.kpis.active_campaigns > 0 ? '준비' : '부족',
      done: summary.kpis.draft_campaigns > 0 || summary.kpis.active_campaigns > 0,
      body: '외부 반영 전 내부 캠페인과 소재 초안을 만듭니다.',
    },
    {
      label: '4. 네이버 광고그룹',
      status: readiness.hasStoredNaverAdgroup ? 'ID 저장' : '미연결',
      done: readiness.hasStoredNaverAdgroup,
      body: '네이버 제한 실행 전에 외부 광고그룹 ID를 저장합니다.',
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
