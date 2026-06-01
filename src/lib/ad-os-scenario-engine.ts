import type { ExtractedKeyword } from '@/lib/keyword-brain';
import type { TravelPackageForSearchAds } from '@/lib/search-ads-auto-planner';

export type AdOsScenarioType =
  | 'regional_departure'
  | 'filial'
  | 'family'
  | 'comparison'
  | 'price_objection'
  | 'urgency'
  | 'safety'
  | 'activity'
  | 'seasonal'
  | 'retargeting';

export type AdOsFunnelStage = 'awareness' | 'consideration' | 'conversion' | 'retention';
export type AdOsLandingStrategy = 'product_page' | 'blog_new' | 'blog_update' | 'hub_page' | 'card_news';
export type AdOsRecommendedChannel = 'naver' | 'google' | 'meta' | 'kakao' | 'organic';

export type AdOsProductScenario = {
  scenarioKey: string;
  scenarioType: AdOsScenarioType;
  funnelStage: AdOsFunnelStage;
  targetSegment: string;
  primaryKeyword: string;
  keywordVariants: string[];
  landingStrategy: AdOsLandingStrategy;
  recommendedChannel: AdOsRecommendedChannel;
  priority: number;
  opportunityScore: number;
  riskFlags: Record<string, unknown>;
  learningContext: Record<string, unknown>;
  decisionReason: string;
};

const DEPARTURE_CITIES = ['부산', '인천', '김포', '청주', '대구', '무안', '제주'];
const FAMILY_SIGNALS = ['가족', '아이', '키즈', '어린이', '부모님', '효도', '어버이'];
const PREMIUM_SIGNALS = ['프리미엄', '럭셔리', '특급', '5성', '노쇼핑', '노옵션', '직항'];
const URGENCY_SIGNALS = ['마감', '특가', '땡처리', '출발확정', '얼리버드', '조기예약'];

function clean(value: unknown): string {
  return String(value || '').trim();
}

function uniq(values: Array<string | null | undefined>, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = clean(value).replace(/\s+/g, ' ');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function getDestination(pkg: TravelPackageForSearchAds): string {
  const parsed = pkg.parsed_data ?? {};
  return clean(pkg.destination || parsed.destination || pkg.title).split(/[\/,·]/)[0] || '여행';
}

function getTitleText(pkg: TravelPackageForSearchAds): string {
  return [
    pkg.title,
    pkg.display_name,
    pkg.product_type,
    pkg.airline,
    pkg.departure_airport,
    ...(Array.isArray(pkg.inclusions) ? pkg.inclusions : []),
  ].map(clean).join(' ');
}

function getDepartureCity(pkg: TravelPackageForSearchAds, titleText: string): string {
  return DEPARTURE_CITIES.find((city) => clean(pkg.departure_airport).includes(city) || titleText.includes(city)) || '';
}

function durationText(pkg: TravelPackageForSearchAds): string {
  const duration = Number(pkg.duration || 0);
  return duration > 1 ? `${duration - 1}박${duration}일` : '';
}

function hasAny(text: string, signals: string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function buildScenario(input: Omit<AdOsProductScenario, 'scenarioKey'> & { packageId: string }): AdOsProductScenario {
  return {
    ...input,
    scenarioKey: normalizeKey(`${input.packageId}_${input.scenarioType}_${input.primaryKeyword}`),
  };
}

export function deriveAdOsProductScenarios(pkg: TravelPackageForSearchAds): AdOsProductScenario[] {
  const destination = getDestination(pkg);
  const text = getTitleText(pkg);
  const departureCity = getDepartureCity(pkg, text);
  const duration = durationText(pkg);
  const airline = clean(pkg.airline);
  const price = Number(pkg.price || 0);
  const isFamily = hasAny(text, FAMILY_SIGNALS);
  const isPremium = hasAny(text, PREMIUM_SIGNALS);
  const isUrgent = hasAny(text, URGENCY_SIGNALS);
  const scenarios: AdOsProductScenario[] = [];

  if (departureCity) {
    scenarios.push(buildScenario({
      packageId: pkg.id,
      scenarioType: 'regional_departure',
      funnelStage: 'conversion',
      targetSegment: `${departureCity} 출발 직항/근거리 여행 수요`,
      primaryKeyword: `${departureCity} 출발 ${destination} 패키지`,
      keywordVariants: uniq([
        `${departureCity}출발 ${destination} 패키지`,
        `${departureCity} ${destination} ${duration}`,
        airline ? `${departureCity} ${airline} ${destination}` : null,
        `${departureCity} 부모님 ${destination} 여행`,
      ]),
      landingStrategy: 'product_page',
      recommendedChannel: 'naver',
      priority: 92,
      opportunityScore: 90,
      riskFlags: { low_cpc_longtail: true, duplicate_risk: 'low' },
      learningContext: { source: 'product_feed', departure_city: departureCity, airline },
      decisionReason: '출발지와 목적지 조합은 구매 직전 검색 의도가 강해 상품 페이지로 바로 연결한다.',
    }));
  }

  scenarios.push(buildScenario({
    packageId: pkg.id,
    scenarioType: isFamily ? 'filial' : 'comparison',
    funnelStage: 'consideration',
    targetSegment: isFamily ? '부모님/가족 동반 여행 검색 고객' : '비슷한 패키지를 비교하는 고객',
    primaryKeyword: isFamily ? `부모님 ${destination} 여행 추천` : `${destination} 패키지 비교`,
    keywordVariants: uniq([
      `${destination} 부모님 여행`,
      `${destination} 효도여행`,
      `${destination} 패키지 추천`,
      `${destination} 패키지 비교`,
      duration ? `${destination} ${duration} 비교` : null,
    ]),
    landingStrategy: 'blog_update',
    recommendedChannel: 'naver',
    priority: isFamily ? 88 : 82,
    opportunityScore: isFamily ? 86 : 78,
    riskFlags: { seo_duplicate_risk: 'medium', requires_unique_angle: true },
    learningContext: { source: 'scenario_matrix', family_signal: isFamily },
    decisionReason: '고민형 검색어는 바로 상품보다 비교/불안 해소 블로그가 설득력이 높아 기존 허브 업데이트를 우선한다.',
  }));

  if (price > 0 || isPremium) {
    scenarios.push(buildScenario({
      packageId: pkg.id,
      scenarioType: 'price_objection',
      funnelStage: 'consideration',
      targetSegment: '가격 차이와 포함사항을 확인하는 고객',
      primaryKeyword: `${destination} 패키지 가격`,
      keywordVariants: uniq([
        `${destination} 여행 비용`,
        `${destination} 패키지 가격`,
        `${destination} 포함사항 비교`,
        isPremium ? `${destination} 노쇼핑 패키지` : null,
      ]),
      landingStrategy: 'blog_update',
      recommendedChannel: 'google',
      priority: 76,
      opportunityScore: 72,
      riskFlags: { needs_price_freshness: true, stale_price_risk: price > 0 },
      learningContext: { source: 'price_signal', price },
      decisionReason: '가격/포함사항 검색은 블로그에서 조건을 비교한 뒤 CTA로 예약을 유도하는 편이 안전하다.',
    }));
  }

  if (isUrgent || duration) {
    scenarios.push(buildScenario({
      packageId: pkg.id,
      scenarioType: 'urgency',
      funnelStage: 'conversion',
      targetSegment: '출발확정/마감임박/발권기한이 가까운 고객',
      primaryKeyword: `${destination} 출발확정 패키지`,
      keywordVariants: uniq([
        `${destination} 출발확정`,
        `${destination} 마감임박`,
        duration ? `${destination} ${duration} 특가` : null,
        `${destination} 지금 예약`,
      ]),
      landingStrategy: 'product_page',
      recommendedChannel: 'naver',
      priority: 84,
      opportunityScore: 80,
      riskFlags: { expiry_sensitive: true, requires_ticketing_deadline_check: true },
      learningContext: { source: 'urgency_signal', duration },
      decisionReason: '마감/출발확정 의도는 상품 만료와 직접 연결되므로 상품 랜딩과 만료 정리 루프를 함께 건다.',
    }));
  }

  scenarios.push(buildScenario({
    packageId: pkg.id,
    scenarioType: 'safety',
    funnelStage: 'awareness',
    targetSegment: '첫 해외여행/불안 해소형 고객',
    primaryKeyword: `${destination} 패키지 괜찮을까`,
    keywordVariants: uniq([
      `${destination} 패키지 괜찮을까`,
      `${destination} 첫 해외여행`,
      `${destination} 부모님 모시고`,
      `${destination} 여행 주의사항`,
    ]),
    landingStrategy: 'blog_new',
    recommendedChannel: 'organic',
    priority: 70,
    opportunityScore: 68,
    riskFlags: { low_direct_conversion: true, useful_for_retargeting: true },
    learningContext: { source: 'question_intent' },
    decisionReason: '사람들이 실제로 묻는 질문에 답하는 키워드는 SEO/리타겟팅 자산으로 만들 가치가 있다.',
  }));

  return scenarios;
}

export function scenariosToExtractedKeywords(scenarios: AdOsProductScenario[]): ExtractedKeyword[] {
  return scenarios.flatMap((scenario) =>
    uniq([scenario.primaryKeyword, ...scenario.keywordVariants], 10).map((keyword): ExtractedKeyword => ({
      keyword,
      matchType: scenario.funnelStage === 'conversion' ? 'exact' : 'phrase',
      tier: scenario.funnelStage === 'conversion' ? 'longtail' : 'mid',
      suggestedBid: scenario.funnelStage === 'conversion' ? 180 : 260,
      category: `ad_os_scenario:${scenario.scenarioType}`,
    })),
  );
}
