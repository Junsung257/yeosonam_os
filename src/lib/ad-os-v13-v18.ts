import { classifyAdOsConversionSignal, type AdOsConversionInput } from '@/lib/ad-os-v8-v12';
import { decideAdOsBudgetPacing, type AdOsBudgetPacingInput } from '@/lib/ad-os-budget-pacing';
import type { AdOsChangeRequestType } from '@/lib/ad-os-change-request';

export type AdOsPublisherPlatform = 'naver' | 'google' | 'meta' | 'kakao';
export type AdOsOpsMode = 'recommend' | 'approve' | 'limited_autopilot' | 'full_autopilot';

export type PublisherReadinessInput = {
  platform: 'naver' | 'google';
  credentialsReady: boolean;
  permissionReady: boolean;
  campaignReady: boolean;
  adGroupReady?: boolean;
  conversionActionReady?: boolean;
  finalUrlPolicyReady?: boolean;
  budgetReady: boolean;
  approvedKeywords: number;
  tenantAllowed: boolean;
  killSwitchActive?: boolean;
};

export type PublisherOpsStep = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  nextAction: string;
};

export type PublisherOpsPlan = {
  platform: 'naver' | 'google';
  state: 'missing_credentials' | 'permission_denied' | 'no_campaign' | 'executable' | 'blocked';
  canCreatePaused: boolean;
  canActivate: boolean;
  defaultMutationMode: 'dry_run' | 'paused_only' | 'active_allowed';
  steps: PublisherOpsStep[];
  requiredChangeRequests: Array<{
    requestType: AdOsChangeRequestType;
    title: string;
    reason: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    proposedChange: Record<string, unknown>;
    rollbackPayload: Record<string, unknown>;
  }>;
};

function step(id: string, done: boolean, label: string, nextAction: string): PublisherOpsStep {
  return {
    id,
    label,
    status: done ? 'pass' : 'fail',
    nextAction: done ? '준비 완료' : nextAction,
  };
}

export function buildPublisherOpsPlan(input: PublisherReadinessInput): PublisherOpsPlan {
  const isGoogle = input.platform === 'google';
  const steps = [
    step('credentials', input.credentialsReady, '계정 연결', isGoogle ? '구글 광고 계정 연결을 완료하세요.' : '네이버 광고 계정 연결을 완료하세요.'),
    step('permission', input.permissionReady, '권한 확인', '광고 계정 권한 또는 대행사 접근 권한을 확인하세요.'),
    step('budget', input.budgetReady, '예산 안전장치', '월예산, 일상한, 최대 클릭단가, 테스트 손실 한도를 설정하세요.'),
    step('campaign', input.campaignReady, '캠페인', '캠페인을 만들거나 기존 캠페인을 연결하세요.'),
    step('ad_group', input.adGroupReady !== false, '광고그룹', '광고그룹을 만들거나 기존 광고그룹을 연결하세요.'),
    step('keywords', input.approvedKeywords > 0, '승인 키워드', '초세부 키워드 후보를 검수하고 승인하세요.'),
    step('tenant_policy', input.tenantAllowed, '광고주 정책', '이 광고주에게 허용된 채널과 자동화 수준을 확인하세요.'),
  ];

  if (isGoogle) {
    steps.push(
      step('conversion_action', Boolean(input.conversionActionReady), '전환 설정', '예약/문의 전환 액션을 설정하세요.'),
      step('final_url_policy', Boolean(input.finalUrlPolicyReady), '랜딩 URL 정책', '승인된 블로그 또는 랜딩 URL만 쓰도록 고정하세요.'),
    );
  }

  const failed = steps.filter((item) => item.status === 'fail');
  const state = input.killSwitchActive
    ? 'blocked'
    : !input.credentialsReady
      ? 'missing_credentials'
      : !input.permissionReady
        ? 'permission_denied'
        : !input.campaignReady || input.adGroupReady === false
          ? 'no_campaign'
          : failed.length > 0
            ? 'blocked'
            : 'executable';

  const canCreatePaused = state === 'executable' || (input.credentialsReady && input.permissionReady && input.campaignReady && input.adGroupReady !== false);
  const canActivate = state === 'executable' && !input.killSwitchActive;

  const requiredChangeRequests: PublisherOpsPlan['requiredChangeRequests'] = [];
  if (canCreatePaused && input.approvedKeywords > 0) {
    requiredChangeRequests.push({
      requestType: 'publish_paused_keyword',
      title: `${input.platform} paused keyword upload`,
      reason: 'Create approved long-tail keywords in a paused/draft state before any external spend.',
      riskLevel: 'high',
      proposedChange: { external_status: 'paused', approved_keywords: input.approvedKeywords },
      rollbackPayload: { external_status: 'removed_or_paused' },
    });
  }
  if (canActivate) {
    requiredChangeRequests.push({
      requestType: 'activate_paused_keyword',
      title: `${input.platform} guarded activation`,
      reason: 'Activate only after approval, budget, tenant policy, and kill switch checks pass.',
      riskLevel: 'high',
      proposedChange: { external_status: 'active' },
      rollbackPayload: { external_status: 'paused' },
    });
  }
  if (isGoogle && input.conversionActionReady) {
    requiredChangeRequests.push({
      requestType: 'upload_conversion_signal',
      title: 'Google clean conversion signal upload',
      reason: 'Upload only clean booking or lead signals after quarantine filtering.',
      riskLevel: 'medium',
      proposedChange: { upload_clean_signals_only: true },
      rollbackPayload: { upload_clean_signals_only: false },
    });
  }

  return {
    platform: input.platform,
    state,
    canCreatePaused,
    canActivate,
    defaultMutationMode: canActivate ? 'active_allowed' : canCreatePaused ? 'paused_only' : 'dry_run',
    steps,
    requiredChangeRequests,
  };
}

export type FunnelEventInput = AdOsConversionInput & {
  platform?: AdOsPublisherPlatform | 'organic' | null;
  sessionId?: string | null;
  clickId?: string | null;
  gclid?: string | null;
  naverClickId?: string | null;
  fbclid?: string | null;
  productId?: string | null;
  blogPostId?: string | null;
  keywordPlanId?: string | null;
  bookingId?: string | null;
};

export function normalizeFunnelEvent(input: FunnelEventInput) {
  const classification = classifyAdOsConversionSignal(input);
  const revenue = Math.max(0, Math.round(Number(input.revenueKrw || 0)));
  const margin = Math.round(Number(input.marginKrw || 0));
  const cost = Math.max(0, Math.round(Number(input.costKrw || 0)));
  return {
    platform: input.platform || null,
    event_type: input.eventType,
    session_id: input.sessionId || null,
    click_id: input.clickId || input.gclid || input.naverClickId || input.fbclid || null,
    gclid: input.gclid || null,
    naver_click_id: input.naverClickId || null,
    fbclid: input.fbclid || null,
    product_id: input.productId || null,
    content_creative_id: input.blogPostId || null,
    keyword_plan_id: input.keywordPlanId || null,
    booking_id: input.bookingId || null,
    revenue_krw: revenue,
    margin_krw: margin,
    cost_krw: cost,
    margin_roas_pct: cost > 0 ? Math.round((margin / cost) * 100) : 0,
    revenue_roas_pct: cost > 0 ? Math.round((revenue / cost) * 100) : 0,
    quarantine_status: classification.quarantineStatus,
    excluded_from_learning: classification.excludedFromLearning,
    excluded_from_platform_upload: classification.excludedFromPlatformUpload,
    quality_flags: classification.qualityFlags,
    quarantine_reasons: classification.reasons,
  };
}

export type ProductKeywordFacts = {
  title?: string | null;
  destination?: string | null;
  departureAirport?: string | null;
  airline?: string | null;
  priceKrw?: number | null;
  departureDate?: string | null;
  ticketDeadline?: string | null;
  productId?: string | null;
};

function cleanToken(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function mineLongtailKeywords(input: {
  product: ProductKeywordFacts;
  winningSearchTerms?: string[];
  wasteSearchTerms?: string[];
  existingKeywords?: string[];
  limit?: number;
}) {
  const destination = cleanToken(input.product.destination || '여행지');
  const departure = cleanToken(input.product.departureAirport || '');
  const airline = cleanToken(input.product.airline || '');
  const price = Number(input.product.priceKrw || 0);
  const priceBand = price > 0 ? `${Math.floor(price / 10000)}만원대` : '';
  const roots = [
    `${departure} 출발 ${destination} 패키지`,
    `${airline} ${destination} 패키지`,
    `${destination} 부모님 여행`,
    `${destination} 가족 여행 패키지`,
    `${destination} 환전 팁 패키지`,
    `${destination} 날씨 좋은 시기 패키지`,
    `${destination} 자유시간 있는 패키지`,
    `${destination} 노쇼핑 패키지`,
    `${destination} 마감 임박 패키지`,
    priceBand ? `${priceBand} ${destination} 패키지` : '',
    ...((input.winningSearchTerms || []).map((term) => `${term} 예약`)),
  ].filter(Boolean).map(cleanToken);

  const waste = new Set((input.wasteSearchTerms || []).map((term) => cleanToken(term).toLowerCase()));
  const existing = new Set((input.existingKeywords || []).map((term) => cleanToken(term).toLowerCase()));
  const seen = new Set<string>();
  const candidates = roots
    .filter((keyword) => {
      const key = keyword.toLowerCase();
      if (seen.has(key) || existing.has(key) || waste.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, input.limit || 30));

  return candidates.map((keyword, index) => ({
    keyword,
    matchType: index < 6 ? 'exact' : 'phrase',
    tier: 'longtail',
    bidKrw: 50 + Math.min(250, index * 10),
    intent: keyword.includes('환전') || keyword.includes('날씨') ? 'anxiety_resolution' : keyword.includes('부모님') ? 'filial' : 'conversion',
    rationale: 'Generated from product facts, intent patterns, and clean search-term expansion.',
  }));
}

export function decideDuplicateContentAction(input: {
  sameDestinationActiveProducts: number;
  sameScenarioExistingPosts: number;
  scenarioIsDistinct: boolean;
  productExpired?: boolean;
}) {
  if (input.productExpired) return { action: 'replace_cta', noindex: false, reason: 'Expired product should route CTA to a fresh product.' };
  if (input.sameScenarioExistingPosts >= 1 && !input.scenarioIsDistinct) {
    return { action: 'update_hub_or_faq', noindex: false, reason: 'Avoid duplicate blog posts; update hub, FAQ, CTA, or internal links.' };
  }
  if (input.sameDestinationActiveProducts >= 100 && !input.scenarioIsDistinct) {
    return { action: 'landing_section_only', noindex: false, reason: 'High-volume similar products should not create thin duplicate posts.' };
  }
  return { action: 'create_blog_candidate', noindex: false, reason: 'Search intent is distinct enough for a new candidate.' };
}

export function buildBudgetOpsDecision(input: AdOsBudgetPacingInput & {
  cooldownActive?: boolean;
  killSwitchActive?: boolean;
  marginRoasPct?: number;
  targetMarginRoasPct?: number;
}) {
  const pacing = decideAdOsBudgetPacing(input);
  if (input.killSwitchActive) {
    return { ...pacing, status: 'blocked' as const, recommendedAction: 'pause_channel' as const, canApplyInternally: false, reason: 'Kill switch is active.' };
  }
  if (input.cooldownActive) {
    return { ...pacing, recommendedAction: 'no_change' as const, canApplyInternally: false, reason: 'Cooldown window prevents frequent budget mutations.' };
  }
  if (Number(input.marginRoasPct || 0) < Number(input.targetMarginRoasPct || 0) && input.automationLevel < 4) {
    return { ...pacing, recommendedAction: 'require_budget_review' as const, canApplyInternally: false, reason: 'Margin ROAS is below target; require approval before spend expansion.' };
  }
  return pacing;
}

export function buildCreativeFactoryDrafts(input: {
  destination: string;
  productTitle?: string | null;
  landingUrl?: string | null;
}) {
  const destination = cleanToken(input.destination || 'destination');
  const product = cleanToken(input.productTitle || destination);
  const angles = [
    ['price', `${destination} price-sensitive package`, 'Lead with price band, deadline, and included items.'],
    ['filial', `${destination} trip for parents`, 'Reduce anxiety with flight, hotel, guide, meals, and local tips.'],
    ['family', `${destination} family package`, 'Show child-friendly schedule, hotel, and free-time balance.'],
    ['comparison', `${destination} vs nearby destination`, 'Compare itinerary, price, weather, and traveler fit.'],
    ['anxiety', `${destination} exchange, tips, weather`, 'Answer pre-booking concerns and connect to the package CTA.'],
    ['deadline', `${destination} ticketing deadline`, 'Use scarcity only when ticket deadline or inventory data supports it.'],
  ] as const;

  return angles.map(([angle, headline, brief]) => ({
    angle,
    channel: angle === 'price' || angle === 'deadline' ? 'naver_search' : 'blog_meta_draft',
    headline,
    brief,
    product,
    landingUrl: input.landingUrl || null,
    publishMode: 'draft_only',
    guardrails: ['human_review_required', 'no_auto_meta_publish', 'avoid_duplicate_blog_post'],
  }));
}

export function buildTenantSaasPackaging(input: {
  monthlyBudgetCapKrw: number;
  dailyBudgetCapKrw: number;
  automationLevel: number;
  requireHumanApproval: boolean;
  fullAutoEnabled: boolean;
  forbiddenPhrases?: string[];
  marginRoasPct?: number;
  cpaKrw?: number;
}) {
  const missing: string[] = [];
  if (input.monthlyBudgetCapKrw <= 0) missing.push('monthly_budget_cap');
  if (input.dailyBudgetCapKrw <= 0) missing.push('daily_budget_cap');
  if (input.automationLevel >= 4 && !input.fullAutoEnabled) missing.push('full_auto_disabled');
  if (!input.requireHumanApproval && input.automationLevel < 3) missing.push('approval_policy_conflict');
  return {
    productReadinessLabel: missing.length === 0 ? 'ready' : missing.length <= 2 ? 'needs_setup' : 'risky',
    operatorMetrics: {
      margin_roas_pct: Math.round(Number(input.marginRoasPct || 0)),
      cpa_krw: Math.max(0, Math.round(Number(input.cpaKrw || 0))),
      automation_level: input.automationLevel,
      human_approval: input.requireHumanApproval,
    },
    tenantControls: {
      monthly_budget_cap_krw: input.monthlyBudgetCapKrw,
      daily_budget_cap_krw: input.dailyBudgetCapKrw,
      forbidden_phrases: input.forbiddenPhrases || [],
      full_auto_enabled: input.fullAutoEnabled,
    },
    missing,
  };
}
