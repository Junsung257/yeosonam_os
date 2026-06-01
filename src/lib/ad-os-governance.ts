export const AD_OS_AUTOMATION_MODES = [
  {
    id: 'recommendation',
    label: '추천',
    levelMin: 0,
    levelMax: 1,
    description: 'AI가 키워드, 랜딩, 예산, DKI 후보만 추천합니다. 외부 광고 계정은 변경하지 않습니다.',
    allowedActions: ['candidate_generation', 'readiness_audit', 'learning_summary'],
  },
  {
    id: 'approval',
    label: '승인형 집행',
    levelMin: 2,
    levelMax: 2,
    description: '운영자가 승인한 후보만 내부 드래프트 또는 정지 키워드 배포 대상으로 이동합니다.',
    allowedActions: ['approve_candidates', 'create_internal_drafts', 'paused_keyword_upload'],
  },
  {
    id: 'limited_auto',
    label: '제한 예산 자동집행',
    levelMin: 3,
    levelMax: 3,
    description: '테넌트, 채널, 상품 예산 캡 안에서 소액 테스트, 자동 정지, 제외어 제안을 실행합니다.',
    allowedActions: ['start_small_tests', 'pause_losers', 'negative_keyword_suggestions', 'budget_pacing'],
  },
  {
    id: 'full_auto',
    label: '완전자동',
    levelMin: 4,
    levelMax: 5,
    description: '목표 CPA/ROAS와 리스크 한도 안에서 생성, 집행, 증액, 중지, 교체를 자동화합니다.',
    allowedActions: ['scale_winners', 'rotate_landings', 'bid_budget_changes', 'create_new_variants'],
  },
] as const;

export type AdOsAutomationModeId = typeof AD_OS_AUTOMATION_MODES[number]['id'];

export type ChannelExecutionStateId =
  | 'missing_credentials'
  | 'integration_ready'
  | 'permission_denied'
  | 'no_campaign'
  | 'executable';

export type ChannelExecutionState = {
  state: ChannelExecutionStateId;
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  canSpend: boolean;
  summary: string;
  nextAction: string;
};

export function automationLevelToMode(level: number | null | undefined): AdOsAutomationModeId {
  const normalized = Math.max(0, Math.min(5, Number(level ?? 1)));
  if (normalized <= 1) return 'recommendation';
  if (normalized === 2) return 'approval';
  if (normalized === 3) return 'limited_auto';
  return 'full_auto';
}

export function getAutomationModeById(id: AdOsAutomationModeId) {
  return AD_OS_AUTOMATION_MODES.find((mode) => mode.id === id) ?? AD_OS_AUTOMATION_MODES[0];
}

export function classifyChannelExecutionState(input: {
  integrationReady: boolean;
  permissionOk: boolean;
  hasCampaign: boolean;
  hasAdGroup: boolean;
  budgetReady: boolean;
  approvedKeywords: number;
  internalDrafts: number;
  platformLabel: string;
}): ChannelExecutionState {
  if (!input.integrationReady) {
    return {
      state: 'missing_credentials',
      label: '연동 미설정',
      tone: 'bad',
      canSpend: false,
      summary: `${input.platformLabel} API 또는 OAuth 정보가 아직 부족합니다.`,
      nextAction: `${input.platformLabel} API 키, OAuth, 계정 ID를 먼저 연결하세요.`,
    };
  }

  if (!input.permissionOk) {
    return {
      state: 'permission_denied',
      label: '권한 없음',
      tone: 'bad',
      canSpend: false,
      summary: `${input.platformLabel} 계정 접근은 시도됐지만 광고 계정 권한 검증을 통과하지 못했습니다.`,
      nextAction: `${input.platformLabel} 광고 계정 권한, customer/account id, OAuth scope를 확인하세요.`,
    };
  }

  if (!input.hasCampaign || !input.hasAdGroup) {
    return {
      state: 'no_campaign',
      label: '캠페인 없음',
      tone: 'warn',
      canSpend: false,
      summary: `${input.platformLabel} 연동은 준비됐지만 캠페인 또는 광고그룹이 확인되지 않았습니다.`,
      nextAction: `${input.platformLabel} 캠페인과 광고그룹을 만들거나 기존 ID를 예산 설정에 저장하세요.`,
    };
  }

  if (input.budgetReady && input.approvedKeywords > 0 && input.internalDrafts > 0) {
    return {
      state: 'executable',
      label: '집행 가능',
      tone: 'good',
      canSpend: true,
      summary: `${input.platformLabel} 캠페인, 광고그룹, 예산, 승인 키워드, 내부 드래프트가 준비됐습니다.`,
      nextAction: '제한 예산 모드에서 소액 테스트를 시작할 수 있습니다.',
    };
  }

  return {
    state: 'integration_ready',
    label: '연동 준비됨',
    tone: 'neutral',
    canSpend: false,
    summary: `${input.platformLabel} 계정 연동은 준비됐지만 예산, 승인 키워드, 내부 드래프트가 아직 부족합니다.`,
    nextAction: '추천 후보를 승인하고 예산 가드레일과 내부 드래프트를 준비하세요.',
  };
}

export function buildTenantRiskGuardrails(input: {
  tenantScopedTables: number;
  monthlyBudgetKrw: number;
  activeBudgetChannels: number;
  maxAutomationLevel: number;
}) {
  const risks: Array<{ id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }> = [];

  risks.push({
    id: 'tenant_scope',
    label: '테넌트 데이터 분리',
    status: input.tenantScopedTables > 0 ? 'warn' : 'fail',
    detail: input.tenantScopedTables > 0
      ? '일부 마케팅/콘텐츠 테이블은 tenant_id 기반 확장 여지가 있습니다. 광고 OS 전용 테이블까지 더 정규화해야 합니다.'
      : '광고 OS 전용 테넌트 스코프 증거가 부족합니다.',
  });
  risks.push({
    id: 'budget_cap',
    label: '테넌트 예산 한도',
    status: input.monthlyBudgetKrw > 0 ? 'pass' : 'fail',
    detail: input.monthlyBudgetKrw > 0
      ? `현재 월 예산 한도 ${input.monthlyBudgetKrw.toLocaleString('ko-KR')}원 안에서만 자동화합니다.`
      : '월 예산 한도가 없으면 외부 집행은 차단해야 합니다.',
  });
  risks.push({
    id: 'automation_cap',
    label: '자동화 권한 제한',
    status: input.maxAutomationLevel <= 3 ? 'pass' : 'warn',
    detail: input.maxAutomationLevel <= 3
      ? '현재 완전자동 이전 단계입니다. 추천, 승인, 제한 예산 테스트 중심으로 운영합니다.'
      : '완전자동 권한이 열려 있습니다. 승인권, 롤백, 손실 한도 검증이 필요합니다.',
  });
  risks.push({
    id: 'active_channels',
    label: '활성 채널 제한',
    status: input.activeBudgetChannels <= 2 ? 'pass' : 'warn',
    detail: input.activeBudgetChannels <= 2
      ? '초기 운영은 제한된 채널 수로 학습합니다.'
      : '여러 채널이 동시에 활성화되어 예산 분산과 원인 분석 난도가 높습니다.',
  });

  return risks;
}
