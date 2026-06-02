export type AdOsPacingStatus = 'under_pacing' | 'on_track' | 'over_pacing' | 'loss_limit_near' | 'blocked';
export type AdOsPacingAction =
  | 'no_change'
  | 'increase_tests'
  | 'decrease_daily_cap'
  | 'pause_channel'
  | 'require_budget_review';

export type AdOsBudgetPacingInput = {
  platform: string;
  monthlyBudgetKrw: number;
  dailyBudgetCapKrw: number;
  actualSpendKrw: number;
  automationLevel: number;
  status: string;
  now?: Date;
};

export type AdOsBudgetPacingDecision = {
  platform: string;
  periodStart: string;
  periodEnd: string;
  daysElapsed: number;
  daysTotal: number;
  monthlyBudgetKrw: number;
  expectedSpendKrw: number;
  actualSpendKrw: number;
  paceRatio: number;
  status: AdOsPacingStatus;
  recommendedAction: AdOsPacingAction;
  reason: string;
  canApplyInternally: boolean;
  nextDailyBudgetCapKrw: number;
};

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function decideAdOsBudgetPacing(input: AdOsBudgetPacingInput): AdOsBudgetPacingDecision {
  const now = input.now ?? new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  const daysTotal = end.getUTCDate();
  const daysElapsed = clamp(now.getUTCDate(), 1, daysTotal);
  const monthlyBudget = Math.max(0, Math.round(input.monthlyBudgetKrw || 0));
  const actualSpend = Math.max(0, Math.round(input.actualSpendKrw || 0));
  const expectedSpend = monthlyBudget > 0 ? Math.round((monthlyBudget * daysElapsed) / daysTotal) : 0;
  const paceRatio = expectedSpend > 0 ? Math.round((actualSpend / expectedSpend) * 1000) / 1000 : 0;
  const currentDailyCap = Math.max(0, Math.round(input.dailyBudgetCapKrw || 0));
  const automationLevel = Math.max(0, Math.min(5, Math.round(input.automationLevel || 0)));
  const remainingBudget = Math.max(0, monthlyBudget - actualSpend);
  const lossLimitNear = monthlyBudget > 0 && remainingBudget <= Math.max(currentDailyCap, Math.round(monthlyBudget * 0.1));
  const canApplyInternally = input.status === 'active' && automationLevel >= 3 && monthlyBudget > 0;

  if (monthlyBudget <= 0 || input.status !== 'active') {
    return {
      platform: input.platform,
      periodStart: toDateOnly(start),
      periodEnd: toDateOnly(end),
      daysElapsed,
      daysTotal,
      monthlyBudgetKrw: monthlyBudget,
      expectedSpendKrw: expectedSpend,
      actualSpendKrw: actualSpend,
      paceRatio,
      status: 'blocked',
      recommendedAction: 'no_change',
      reason: monthlyBudget <= 0
        ? '월 예산이 없어 집행과 자동 페이싱을 차단합니다.'
        : '채널 예산이 paused 상태라 페이싱 적용을 보류합니다.',
      canApplyInternally: false,
      nextDailyBudgetCapKrw: currentDailyCap,
    };
  }

  if (actualSpend >= monthlyBudget || lossLimitNear) {
    return {
      platform: input.platform,
      periodStart: toDateOnly(start),
      periodEnd: toDateOnly(end),
      daysElapsed,
      daysTotal,
      monthlyBudgetKrw: monthlyBudget,
      expectedSpendKrw: expectedSpend,
      actualSpendKrw: actualSpend,
      paceRatio,
      status: actualSpend >= monthlyBudget ? 'blocked' : 'loss_limit_near',
      recommendedAction: 'pause_channel',
      reason: actualSpend >= monthlyBudget
        ? '월 예산이 이미 소진되었으므로 해당 채널 예산을 정지해야 합니다.'
        : '월 잔여 예산이 손실 한도에 근접했습니다. 새 외부 집행을 막고 채널 정지를 검토합니다.',
      canApplyInternally,
      nextDailyBudgetCapKrw: 0,
    };
  }

  if (paceRatio >= 1.35) {
    const reduced = Math.max(1000, Math.floor(currentDailyCap * 0.7));
    return {
      platform: input.platform,
      periodStart: toDateOnly(start),
      periodEnd: toDateOnly(end),
      daysElapsed,
      daysTotal,
      monthlyBudgetKrw: monthlyBudget,
      expectedSpendKrw: expectedSpend,
      actualSpendKrw: actualSpend,
      paceRatio,
      status: 'over_pacing',
      recommendedAction: 'decrease_daily_cap',
      reason: '현재 소진 속도가 계획보다 빠릅니다. 일 예산 상한을 낮춰 월 예산 초과를 막습니다.',
      canApplyInternally,
      nextDailyBudgetCapKrw: Math.min(currentDailyCap, reduced),
    };
  }

  if (paceRatio <= 0.55 && daysElapsed >= 5) {
    const catchupCap = Math.ceil(monthlyBudget / Math.max(1, daysTotal - daysElapsed + 1));
    const increased = Math.min(catchupCap, Math.max(currentDailyCap, Math.ceil(currentDailyCap * 1.2)));
    return {
      platform: input.platform,
      periodStart: toDateOnly(start),
      periodEnd: toDateOnly(end),
      daysElapsed,
      daysTotal,
      monthlyBudgetKrw: monthlyBudget,
      expectedSpendKrw: expectedSpend,
      actualSpendKrw: actualSpend,
      paceRatio,
      status: 'under_pacing',
      recommendedAction: automationLevel >= 3 ? 'increase_tests' : 'require_budget_review',
      reason: '예산 소진이 계획보다 느립니다. 승인 후보가 있으면 소액 테스트를 늘릴 수 있습니다.',
      canApplyInternally,
      nextDailyBudgetCapKrw: increased,
    };
  }

  return {
    platform: input.platform,
    periodStart: toDateOnly(start),
    periodEnd: toDateOnly(end),
    daysElapsed,
    daysTotal,
    monthlyBudgetKrw: monthlyBudget,
    expectedSpendKrw: expectedSpend,
    actualSpendKrw: actualSpend,
    paceRatio,
    status: 'on_track',
    recommendedAction: 'no_change',
    reason: '월 예산 대비 소진 속도가 허용 범위 안에 있습니다.',
    canApplyInternally,
    nextDailyBudgetCapKrw: currentDailyCap,
  };
}
