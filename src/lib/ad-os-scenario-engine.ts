import type { ExtractedKeyword } from '@/lib/keyword-brain';
import type { TravelPackageForSearchAds } from '@/lib/search-ads-auto-planner';

export type AdOsScenarioType =
  | 'regional_departure'
  | 'airline'
  | 'filial'
  | 'family'
  | 'comparison'
  | 'price_objection'
  | 'urgency'
  | 'safety'
  | 'activity'
  | 'seasonal'
  | 'differentiator'
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
const PREMIUM_SIGNALS = ['프리미엄', '럭셔리', '고급', '5성', '직항', '리조트', '노쇼핑'];
const URGENCY_SIGNALS = ['마감', '특가', '출발확정', '조기예약', '발권', '잔여석'];
const DIFFERENTIATOR_SIGNALS = ['노쇼핑', '노옵션', '자유시간', '가이드', '마사지', '호이안', '바나힐', '리조트'];
const COMMON_COMPARISONS: Record<string, string[]> = {
  다낭: ['나트랑', '푸꾸옥', '세부'],
  나트랑: ['다낭', '푸꾸옥', '세부'],
  세부: ['다낭', '보홀', '나트랑'],
  오사카: ['도쿄', '후쿠오카', '교토'],
  도쿄: ['오사카', '후쿠오카'],
};

function clean(value: unknown): string {
  return String(value || '').trim();
}

function uniq(values: Array<string | null | undefined>, limit = 10): string[] {
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

function parsedValue(pkg: TravelPackageForSearchAds, key: string): unknown {
  return pkg.parsed_data && typeof pkg.parsed_data === 'object' ? pkg.parsed_data[key] : null;
}

function getDestination(pkg: TravelPackageForSearchAds): string {
  const raw = clean(pkg.destination || parsedValue(pkg, 'destination') || pkg.title);
  return raw.split(/[\/,·|]/)[0] || '여행';
}

function getTitleText(pkg: TravelPackageForSearchAds): string {
  return [
    pkg.title,
    pkg.display_name,
    pkg.product_type,
    pkg.airline,
    pkg.departure_airport,
    ...(Array.isArray(pkg.inclusions) ? pkg.inclusions : []),
    ...(Array.isArray(pkg.itinerary) ? pkg.itinerary : []),
  ].map(clean).join(' ');
}

function getDepartureCity(pkg: TravelPackageForSearchAds, titleText: string): string {
  const airport = clean(pkg.departure_airport || parsedValue(pkg, 'departure_airport'));
  return DEPARTURE_CITIES.find((city) => airport.includes(city) || titleText.includes(city)) || '';
}

function durationText(pkg: TravelPackageForSearchAds): string {
  const duration = Number(pkg.duration || 0);
  if (duration > 1) return `${duration - 1}박 ${duration}일`;
  const nights = Number(pkg.nights || 0);
  return nights > 0 ? `${nights}박 ${nights + 1}일` : '';
}

function priceBand(price: number): string | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const band = Math.max(10, Math.floor(price / 100000) * 10);
  return `${band}만원대`;
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

function comparisonDestination(destination: string): string | null {
  const found = Object.entries(COMMON_COMPARISONS).find(([key]) => destination.includes(key));
  return found?.[1]?.[0] ?? null;
}

function differentiator(text: string): string | null {
  return DIFFERENTIATOR_SIGNALS.find((signal) => text.includes(signal)) ?? null;
}

export function deriveAdOsProductScenarios(pkg: TravelPackageForSearchAds): AdOsProductScenario[] {
  const destination = getDestination(pkg);
  const text = getTitleText(pkg);
  const departureCity = getDepartureCity(pkg, text);
  const duration = durationText(pkg);
  const airline = clean(pkg.airline || parsedValue(pkg, 'airline'));
  const price = Number(pkg.price || parsedValue(pkg, 'price') || 0);
  const band = priceBand(price);
  const compareTo = comparisonDestination(destination);
  const diff = differentiator(text);
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
        `${departureCity}에서 출발하는 ${destination}`,
        `${departureCity} ${destination} 패키지`,
        duration ? `${departureCity} ${destination} ${duration}` : null,
        airline ? `${departureCity} ${airline} ${destination}` : null,
        `${departureCity} 부모님 ${destination} 여행`,
      ]),
      landingStrategy: 'product_page',
      recommendedChannel: 'naver',
      priority: 94,
      opportunityScore: 92,
      riskFlags: { low_cpc_longtail: true, duplicate_risk: 'low' },
      learningContext: { source: 'product_feed', departure_city: departureCity, airline },
      decisionReason: '출발지와 목적지 조합은 구매 직전 검색 의도가 강해 상품 페이지로 바로 연결한다.',
    }));
  }

  if (airline) {
    scenarios.push(buildScenario({
      packageId: pkg.id,
      scenarioType: 'airline',
      funnelStage: 'conversion',
      targetSegment: '항공사와 출발 편의를 함께 확인하는 고객',
      primaryKeyword: `${airline} ${destination} 패키지`,
      keywordVariants: uniq([
        `${airline} ${destination}`,
        departureCity ? `${departureCity} ${airline} ${destination} 패키지` : null,
        `${airline} 타고 ${destination}`,
        `${destination} 직항 패키지`,
      ]),
      landingStrategy: 'product_page',
      recommendedChannel: 'naver',
      priority: 90,
      opportunityScore: 86,
      riskFlags: { airline_claim_requires_product_fact: true },
      learningContext: { source: 'airline_fact', airline },
      decisionReason: '항공사 기반 키워드는 CPC가 낮고 구매 의도가 높아 상품 랜딩에 붙인다.',
    }));
  }

  scenarios.push(buildScenario({
    packageId: pkg.id,
    scenarioType: isFamily ? 'filial' : 'family',
    funnelStage: 'consideration',
    targetSegment: isFamily ? '부모님/가족 동반 여행 고객' : '가족 여행 후보를 찾는 고객',
    primaryKeyword: isFamily ? `부모님 ${destination} 여행 추천` : `가족 ${destination} 패키지`,
    keywordVariants: uniq([
      `${destination} 부모님 여행`,
      `${destination} 효도여행`,
      `${destination} 가족 패키지`,
      `부모님 여행은 어디가 좋을까 ${destination}`,
      duration ? `${destination} ${duration} 가족여행` : null,
    ]),
    landingStrategy: 'blog_update',
    recommendedChannel: 'naver',
    priority: isFamily ? 88 : 82,
    opportunityScore: isFamily ? 86 : 78,
    riskFlags: { seo_duplicate_risk: 'medium', requires_unique_angle: true },
    learningContext: { source: 'scenario_matrix', family_signal: isFamily },
    decisionReason: '고민형 검색어는 비교/불안 해소 블로그를 거쳐 CTA로 예약을 유도한다.',
  }));

  if (compareTo) {
    scenarios.push(buildScenario({
      packageId: pkg.id,
      scenarioType: 'comparison',
      funnelStage: 'consideration',
      targetSegment: '여행지를 비교한 뒤 예약하려는 고객',
      primaryKeyword: `${destination} vs ${compareTo}`,
      keywordVariants: uniq([
        `${destination} ${compareTo} 비교`,
        `${destination} 패키지 비교`,
        `${destination} 말고 ${compareTo}`,
        `${destination} 여행지 비교`,
      ]),
      landingStrategy: 'hub_page',
      recommendedChannel: 'google',
      priority: 80,
      opportunityScore: 76,
      riskFlags: { evergreen_hub_preferred: true },
      learningContext: { source: 'destination_comparison', compare_to: compareTo },
      decisionReason: '비교 의도는 같은 목적지 글을 반복 생성하지 않고 허브/비교 글로 누적한다.',
    }));
  }

  if (price > 0 || isPremium) {
    scenarios.push(buildScenario({
      packageId: pkg.id,
      scenarioType: 'price_objection',
      funnelStage: 'consideration',
      targetSegment: '가격 차이와 포함사항을 확인하는 고객',
      primaryKeyword: band ? `${destination} ${band} 패키지` : `${destination} 패키지 가격`,
      keywordVariants: uniq([
        `${destination} 여행 비용`,
        `${destination} 패키지 가격`,
        `${destination} 포함사항 비교`,
        band ? `${destination} ${band} 여행` : null,
        isPremium ? `${destination} 프리미엄 패키지` : null,
      ]),
      landingStrategy: 'blog_update',
      recommendedChannel: 'google',
      priority: 76,
      opportunityScore: 72,
      riskFlags: { needs_price_freshness: true, stale_price_risk: price > 0 },
      learningContext: { source: 'price_signal', price, price_band: band },
      decisionReason: '가격/포함사항 검색은 블로그에서 조건을 비교한 뒤 최신 상품 CTA로 연결한다.',
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

  if (diff) {
    scenarios.push(buildScenario({
      packageId: pkg.id,
      scenarioType: 'differentiator',
      funnelStage: 'consideration',
      targetSegment: '패키지 조건의 차이를 따지는 고객',
      primaryKeyword: `${destination} ${diff} 패키지`,
      keywordVariants: uniq([
        `${destination} ${diff}`,
        `${destination} ${diff} 여행`,
        departureCity ? `${departureCity} ${destination} ${diff}` : null,
        `${destination} 패키지 일정 비교`,
      ]),
      landingStrategy: 'blog_update',
      recommendedChannel: 'naver',
      priority: 78,
      opportunityScore: 74,
      riskFlags: { claim_requires_itinerary_evidence: true },
      learningContext: { source: 'product_differentiator', differentiator: diff },
      decisionReason: '상품 차별점 키워드는 같은 목적지라도 별도 구매 이유가 있으므로 블로그 섹션/FAQ로 확장한다.',
    }));
  }

  scenarios.push(buildScenario({
    packageId: pkg.id,
    scenarioType: 'safety',
    funnelStage: 'awareness',
    targetSegment: '첫 해외여행 또는 불안 해소가 필요한 고객',
    primaryKeyword: `${destination} 패키지 괜찮을까`,
    keywordVariants: uniq([
      `${destination} 패키지 괜찮을까`,
      `${destination} 첫 해외여행`,
      `${destination} 부모님 모시고`,
      `${destination} 여행 주의사항`,
      `${destination} 환전 팁`,
      `${destination} 팁 문화`,
      `${destination} 날씨`,
    ]),
    landingStrategy: 'blog_new',
    recommendedChannel: 'organic',
    priority: 70,
    opportunityScore: 68,
    riskFlags: { low_direct_conversion: true, useful_for_retargeting: true },
    learningContext: { source: 'question_intent' },
    decisionReason: '사람들이 실제로 묻는 질문형 초세부 키워드는 SEO와 리타겟팅 자산으로 만든다.',
  }));

  scenarios.push(buildScenario({
    packageId: pkg.id,
    scenarioType: 'retargeting',
    funnelStage: 'retention',
    targetSegment: '블로그는 읽었지만 예약 CTA를 누르지 않은 고객',
    primaryKeyword: `${destination} 카드뉴스 리타겟팅`,
    keywordVariants: uniq([
      `${destination} 여행 핵심정리`,
      `${destination} 패키지 한눈에 보기`,
      `${destination} 부모님 여행 카드뉴스`,
    ]),
    landingStrategy: 'card_news',
    recommendedChannel: 'meta',
    priority: 62,
    opportunityScore: 64,
    riskFlags: { draft_only_initially: true, requires_creative_review: true },
    learningContext: { source: 'retargeting_asset' },
    decisionReason: 'Meta/Instagram은 초기에는 검색 성과가 확인된 시나리오를 카드뉴스 초안으로 재활용한다.',
  }));

  return scenarios;
}

export function scenariosToExtractedKeywords(scenarios: AdOsProductScenario[]): ExtractedKeyword[] {
  return scenarios.flatMap((scenario) =>
    uniq([scenario.primaryKeyword, ...scenario.keywordVariants], 12).map((keyword): ExtractedKeyword => ({
      keyword,
      matchType: scenario.funnelStage === 'conversion' ? 'exact' : 'phrase',
      tier: scenario.funnelStage === 'conversion' ? 'longtail' : 'mid',
      suggestedBid: scenario.funnelStage === 'conversion' ? 180 : 260,
      category: `ad_os_scenario:${scenario.scenarioType}`,
    })),
  );
}
