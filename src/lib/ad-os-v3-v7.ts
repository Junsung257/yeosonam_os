import { getSecret } from '@/lib/secret-registry';

export type AdOsPublicAutomationMode = 'recommend' | 'approve' | 'limited_autopilot' | 'full_autopilot';

export type AdOsChannelStateId =
  | 'missing_credentials'
  | 'integration_ready'
  | 'permission_denied'
  | 'no_campaign'
  | 'executable';

export type AdOsChannelState = {
  state: AdOsChannelStateId;
  label: '연동 준비됨' | '권한 없음' | '캠페인 없음' | '집행 가능' | '연동 필요';
  canSpend: boolean;
  reason: string;
  nextAction: string;
};

export type VisibilityPlatform = 'google' | 'naver';
export type VisibilityStatus = {
  platform: VisibilityPlatform;
  requestStatus: 'not_requested' | 'requested' | 'request_failed' | 'unknown';
  indexStatus: 'unknown' | 'inspectable' | 'indexed' | 'not_indexed' | 'blocked' | 'verification_unavailable';
  visibilityStatus: 'unknown' | 'visible' | 'not_visible' | 'ranking_confirmed';
  label: string;
  confidence: number;
  bestRank: number | null;
  bestQuery: string | null;
  source: string;
  checkedAt: string | null;
};

export type PerformanceDecision = {
  action:
    | 'pause_keyword'
    | 'replace_landing'
    | 'create_keyword'
    | 'increase_budget'
    | 'update_blog_cta'
    | 'no_change';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  reason: string;
  confidence: number;
  proposedChange: Record<string, unknown>;
  expectedImpact: Record<string, unknown>;
};

export function automationLevelToPublicMode(level: number | null | undefined): AdOsPublicAutomationMode {
  const normalized = Math.max(0, Math.min(5, Number(level ?? 2)));
  if (normalized <= 1) return 'recommend';
  if (normalized === 2) return 'approve';
  if (normalized === 3) return 'limited_autopilot';
  return 'full_autopilot';
}

export const AD_OS_PUBLIC_AUTOMATION_MODES: Array<{
  id: AdOsPublicAutomationMode;
  label: string;
  description: string;
  externalSpendAllowed: boolean;
}> = [
  {
    id: 'recommend',
    label: '추천',
    description: 'AI가 키워드, 랜딩, 예산, 수정 후보만 만든다. 외부 계정은 변경하지 않는다.',
    externalSpendAllowed: false,
  },
  {
    id: 'approve',
    label: '승인',
    description: '사람이 승인한 변경요청만 내부 드래프트 또는 외부 paused 상태로 반영한다.',
    externalSpendAllowed: false,
  },
  {
    id: 'limited_autopilot',
    label: '제한 예산 자동집행',
    description: '테넌트 예산, 일 상한, CPC, 손실 한도 안에서 소액 테스트만 자동화한다.',
    externalSpendAllowed: true,
  },
  {
    id: 'full_autopilot',
    label: '완전자동',
    description: '충분한 예약/마진 데이터와 운영 승인이 있을 때만 생성, 중지, 증액을 자동화한다.',
    externalSpendAllowed: true,
  },
];

export function hasNaverSearchAdsCredentials(): boolean {
  return Boolean(getSecret('NAVER_ADS_API_KEY') && getSecret('NAVER_ADS_SECRET_KEY') && getSecret('NAVER_ADS_CUSTOMER_ID'));
}

export function hasGoogleAdsCredentials(): boolean {
  return Boolean(
    getSecret('GOOGLE_ADS_DEVELOPER_TOKEN') &&
      getSecret('GOOGLE_ADS_CUSTOMER_ID') &&
      getSecret('GOOGLE_ADS_CLIENT_ID') &&
      getSecret('GOOGLE_ADS_CLIENT_SECRET'),
  );
}

export function classifyAdOsChannelState(input: {
  platform: 'naver' | 'google';
  credentialsReady: boolean;
  connectionStatus?: string | null;
  hasCampaign?: boolean;
  hasAdGroup?: boolean;
  budgetReady?: boolean;
  approvedAssets?: number;
}): AdOsChannelState {
  const platformLabel = input.platform === 'naver' ? '네이버' : '구글';
  const connectionStatus = input.connectionStatus || null;
  const permissionDenied = connectionStatus === 'permission_denied';
  const permissionOk = !permissionDenied && ['credentials_ready', 'no_campaign', 'ready'].includes(connectionStatus || '');
  const integrationReady = input.credentialsReady || permissionOk || permissionDenied;

  if (!integrationReady) {
    return {
      state: 'missing_credentials',
      label: '연동 필요',
      canSpend: false,
      reason: `${platformLabel} API/OAuth 정보가 부족합니다.`,
      nextAction: `${platformLabel} 광고 계정 키와 고객 ID를 연결하세요.`,
    };
  }

  if (permissionDenied) {
    return {
      state: 'permission_denied',
      label: '권한 없음',
      canSpend: false,
      reason: `${platformLabel} 계정 접근은 시도됐지만 광고 계정 권한 검증을 통과하지 못했습니다.`,
      nextAction: `${platformLabel} 광고 계정 권한, customer/account id, OAuth scope를 확인하세요.`,
    };
  }

  if (!input.hasCampaign || (input.platform === 'naver' && !input.hasAdGroup)) {
    return {
      state: 'no_campaign',
      label: '캠페인 없음',
      canSpend: false,
      reason: `${platformLabel} 연동은 준비됐지만 집행 대상 캠페인 또는 광고그룹이 없습니다.`,
      nextAction: '캠페인/광고그룹을 만들거나 기존 외부 ID를 저장하세요.',
    };
  }

  if (input.budgetReady && Number(input.approvedAssets || 0) > 0) {
    return {
      state: 'executable',
      label: '집행 가능',
      canSpend: true,
      reason: `${platformLabel} 캠페인, 예산, 승인 자산이 준비되었습니다.`,
      nextAction: '승인 모드 또는 제한 예산 자동집행 모드에서 실행할 수 있습니다.',
    };
  }

  return {
    state: 'integration_ready',
    label: '연동 준비됨',
    canSpend: false,
    reason: `${platformLabel} 계정 연결은 준비됐지만 예산 또는 승인 자산이 부족합니다.`,
    nextAction: '예산 가드레일과 승인 키워드/드래프트를 준비하세요.',
  };
}

export function buildVisibilityLabel(status: Pick<VisibilityStatus, 'platform' | 'requestStatus' | 'indexStatus' | 'visibilityStatus' | 'bestRank'>): string {
  if (status.visibilityStatus === 'ranking_confirmed' && status.bestRank) {
    return `${status.platform === 'google' ? 'Google' : 'Naver'} ${Math.round(status.bestRank)}위 확인`;
  }
  if (status.visibilityStatus === 'visible') return '검색 노출 확인';
  if (status.indexStatus === 'indexed') return '색인됨';
  if (status.indexStatus === 'inspectable') return status.platform === 'google' ? '검사 가능' : '수집 확인 필요';
  if (status.requestStatus === 'requested') return status.platform === 'google' ? '요청됨' : 'IndexNow 요청됨';
  if (status.indexStatus === 'verification_unavailable') return '검증 불가';
  if (status.indexStatus === 'not_indexed') return '색인 안됨';
  return '확인 필요';
}

export function visibilityFromRank(input: {
  platform: VisibilityPlatform;
  requestStatus?: VisibilityStatus['requestStatus'];
  rank?: number | null;
  query?: string | null;
  checkedAt?: string | null;
  source?: string | null;
}): VisibilityStatus {
  const rank = Number(input.rank || 0);
  const hasRank = Number.isFinite(rank) && rank > 0;
  const status: VisibilityStatus = {
    platform: input.platform,
    requestStatus: input.requestStatus || 'unknown',
    indexStatus: hasRank ? 'indexed' : input.platform === 'naver' ? 'verification_unavailable' : 'unknown',
    visibilityStatus: hasRank ? 'ranking_confirmed' : 'unknown',
    label: '',
    confidence: hasRank ? 0.9 : 0.35,
    bestRank: hasRank ? rank : null,
    bestQuery: input.query || null,
    source: input.source || (input.platform === 'google' ? 'gsc/rank_history' : 'naver_serp/rank_history'),
    checkedAt: input.checkedAt || null,
  };
  status.label = buildVisibilityLabel(status);
  return status;
}

export function decidePerformanceAction(input: {
  clicks: number;
  ctaClicks: number;
  conversions: number;
  costKrw: number;
  revenueKrw: number;
  marginKrw: number;
  bounces: number;
  sessions: number;
  keywordText?: string | null;
  targetCpaKrw?: number | null;
  targetRoas?: number | null;
}): PerformanceDecision {
  const clicks = Number(input.clicks || 0);
  const ctaClicks = Number(input.ctaClicks || 0);
  const conversions = Number(input.conversions || 0);
  const costKrw = Number(input.costKrw || 0);
  const revenueKrw = Number(input.revenueKrw || 0);
  const marginKrw = Number(input.marginKrw || 0);
  const sessions = Number(input.sessions || 0);
  const ctaRate = clicks > 0 ? ctaClicks / clicks : 0;
  const cpa = conversions > 0 ? costKrw / conversions : null;
  const roas = costKrw > 0 ? revenueKrw / costKrw : null;
  const bounceRate = sessions > 0 ? input.bounces / sessions : 0;
  const keyword = input.keywordText || '키워드';

  if (costKrw >= 10000 && clicks >= 30 && ctaClicks === 0 && conversions === 0) {
    return {
      action: 'pause_keyword',
      riskLevel: 'medium',
      title: '비효율 키워드 정지 후보',
      reason: `${keyword}는 비용과 클릭이 쌓였지만 CTA/예약 신호가 없어 예산 누수를 막아야 합니다.`,
      confidence: 0.82,
      proposedChange: { operational_status: 'paused', active: false },
      expectedImpact: { clicks, cost_krw: costKrw, avoided_waste_krw: Math.round(costKrw * 0.7) },
    };
  }

  if (clicks >= 20 && ctaRate < 0.02 && conversions === 0) {
    return {
      action: 'replace_landing',
      riskLevel: 'medium',
      title: '랜딩/CTA 개선 후보',
      reason: `${keyword}는 클릭 이후 CTA 전환이 낮아 제목, 도입부, CTA 위치를 먼저 개선해야 합니다.`,
      confidence: 0.72,
      proposedChange: { status: 'candidate', action: 'update_blog' },
      expectedImpact: { clicks, cta_rate: ctaRate },
    };
  }

  if (sessions >= 20 && bounceRate >= 0.65 && ctaClicks === 0) {
    return {
      action: 'update_blog_cta',
      riskLevel: 'low',
      title: '블로그 이탈률 개선 후보',
      reason: '블로그 유입은 있으나 이탈률이 높아 도입부, FAQ, CTA를 성과형으로 재정렬해야 합니다.',
      confidence: 0.68,
      proposedChange: { change_type: 'seo_refresh', status: 'candidate' },
      expectedImpact: { sessions, bounce_rate: bounceRate },
    };
  }

  if (conversions > 0 && (marginKrw > costKrw || (roas != null && roas >= Number(input.targetRoas || 2)))) {
    return {
      action: 'create_keyword',
      riskLevel: 'high',
      title: '성과 키워드 확장 후보',
      reason: `${keyword}는 예약/마진 신호가 있어 유사 초세부 키워드와 형제 랜딩을 만들 가치가 있습니다.`,
      confidence: 0.84,
      proposedChange: { autopilot_status: 'approved', source_keyword: keyword },
      expectedImpact: { conversions, revenue_krw: revenueKrw, margin_krw: marginKrw, roas },
    };
  }

  if (cpa != null && input.targetCpaKrw && cpa <= input.targetCpaKrw) {
    return {
      action: 'increase_budget',
      riskLevel: 'high',
      title: '예산 증액 후보',
      reason: `${keyword}의 CPA가 목표 이하라 제한 예산 모드에서 소액 증액 테스트를 제안합니다.`,
      confidence: 0.76,
      proposedChange: { budget_delta_pct: 15 },
      expectedImpact: { cpa_krw: Math.round(cpa), target_cpa_krw: input.targetCpaKrw },
    };
  }

  return {
    action: 'no_change',
    riskLevel: 'low',
    title: '추가 학습 필요',
    reason: '아직 클릭, CTA, 예약, 비용 신호가 부족해 자동 변경하지 않습니다.',
    confidence: 0.55,
    proposedChange: {},
    expectedImpact: { clicks, cta_clicks: ctaClicks, conversions, cost_krw: costKrw },
  };
}
