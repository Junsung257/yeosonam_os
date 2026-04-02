/**
 * ══════════════════════════════════════════════════════════
 * Keyword Brain — 여행 특화 키워드 추출 + 빅데이터 학습 엔진
 * ══════════════════════════════════════════════════════════
 */

import { getMinPriceFromDates } from './price-dates';

// ── 타입 ─────────────────────────────────────────────────
export type KeywordTier = 'core' | 'mid' | 'longtail' | 'negative';
export type MatchType = 'broad' | 'phrase' | 'exact';
export type Platform = 'naver' | 'google';

export interface ExtractedKeyword {
  keyword: string;
  matchType: MatchType;
  tier: KeywordTier;
  suggestedBid: number;
  category: string;
}

export interface SearchAdKeyword extends ExtractedKeyword {
  id: string;
  platform: Platform;
  bid: number;
  status: 'active' | 'paused' | 'removed';
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  spend: number;
  roas: number;
  productId?: string;
  createdAt: string;
}

export interface KeywordPerformanceArchive {
  keyword: string;
  destination: string;
  totalImpressions: number;
  totalClicks: number;
  avgCtr: number;
  avgCpc: number;
  totalConversions: number;
  totalSpend: number;
  avgRoas: number;
  sampleCount: number;
  lastUpdated: string;
}

// ── 여행 도메인 지식 (하드코딩) ──────────────────────────

const DESTINATIONS: Record<string, { kr: string; en: string; aliases: string[]; region: string }> = {
  '다낭': { kr: '다낭', en: 'danang', aliases: ['호이안', '다낭/호이안'], region: '동남아' },
  '방콕': { kr: '방콕', en: 'bangkok', aliases: ['파타야', '방콕/파타야'], region: '동남아' },
  '오사카': { kr: '오사카', en: 'osaka', aliases: ['교토', '나라', '오사카/교토'], region: '일본' },
  '도쿄': { kr: '도쿄', en: 'tokyo', aliases: ['하코네', '도쿄/하코네'], region: '일본' },
  '후쿠오카': { kr: '후쿠오카', en: 'fukuoka', aliases: ['유후인', '벳부'], region: '일본' },
  '세부': { kr: '세부', en: 'cebu', aliases: ['보홀', '세부/보홀'], region: '동남아' },
  '발리': { kr: '발리', en: 'bali', aliases: ['우붓', '누사두아'], region: '동남아' },
  '푸꾸옥': { kr: '푸꾸옥', en: 'phuquoc', aliases: ['빈펄'], region: '동남아' },
  '나트랑': { kr: '나트랑', en: 'nhatrang', aliases: ['달랏', '나트랑/달랏'], region: '동남아' },
  '하노이': { kr: '하노이', en: 'hanoi', aliases: ['하롱베이', '사파'], region: '동남아' },
  '장가계': { kr: '장가계', en: 'zhangjiajie', aliases: ['봉황고성', '장사'], region: '중국' },
  '청도': { kr: '청도', en: 'qingdao', aliases: ['칭다오'], region: '중국' },
  '괌': { kr: '괌', en: 'guam', aliases: [], region: '태평양' },
  '사이판': { kr: '사이판', en: 'saipan', aliases: [], region: '태평양' },
  '연길': { kr: '연길', en: 'yanji', aliases: ['백두산', '장백산'], region: '중국' },
  '치앙마이': { kr: '치앙마이', en: 'chiangmai', aliases: ['치앙라이'], region: '동남아' },
  '싱가포르': { kr: '싱가포르', en: 'singapore', aliases: [], region: '동남아' },
  '마카오': { kr: '마카오', en: 'macau', aliases: ['홍콩', '마카오/홍콩'], region: '동남아' },
  '라오스': { kr: '라오스', en: 'laos', aliases: ['루앙프라방', '방비엥'], region: '동남아' },
};

const PRODUCT_TYPES = ['패키지', '자유여행', '노팁노옵션', '노쇼핑', '골프', '실속', '품격', '프리미엄', '허니문', '효도'];
const DEPARTURE_CITIES = ['부산', '인천', '김해', '김포', '대구', '청주', '제주'];
const TRAVEL_MODIFIERS = ['특가', '땡처리', '얼리버드', '조기예약', '마감임박', '출발확정', '소그룹', '단체', '가족', '신혼', '효도', '2인', '4인'];

const NEGATIVE_KEYWORDS = [
  '자유여행 호텔', '에어비앤비', '호텔 예약', '항공권만', '비자 발급',
  '후기 블로그', '맛집 추천', '환율', '날씨', '코로나', '입국 조건',
  '무료', '공짜', '이벤트 당첨', '여행 보험',
];

// ── 키워드 추출 엔진 ─────────────────────────────────────

export function extractKeywords(pkg: {
  title?: string;
  display_name?: string;
  destination?: string;
  duration?: number;
  airline?: string;
  departure_airport?: string;
  product_type?: string;
  price?: number;
  inclusions?: string[];
  price_tiers?: { adult_price?: number }[];
}): ExtractedKeyword[] {
  const keywords: ExtractedKeyword[] = [];
  const title = pkg.display_name || pkg.title || '';
  const dest = pkg.destination || '';
  const duration = pkg.duration;
  const airline = pkg.airline || '';
  const airport = pkg.departure_airport || '';
  const productType = pkg.product_type || '';
  const lowestPrice = getLowestPrice(pkg);

  // 목적지 감지
  const destInfo = Object.values(DESTINATIONS).find(d =>
    dest.includes(d.kr) || title.includes(d.kr) || d.aliases.some(a => title.includes(a) || dest.includes(a))
  );
  const destName = destInfo?.kr || dest;
  const region = destInfo?.region || '';

  // 출발지 감지
  const departureCity = DEPARTURE_CITIES.find(c => title.includes(c) || airport.includes(c)) || '';

  // 기간 문자열
  const durationStr = duration ? `${duration - 1}박${duration}일` : '';
  const durationShort = duration ? `${duration}일` : '';

  // 상품 유형 감지
  const detectedTypes = PRODUCT_TYPES.filter(t => title.includes(t) || productType.includes(t));

  // ═══ Core 키워드 (높은 입찰가, 높은 검색량) ═══
  if (destName) {
    keywords.push({ keyword: `${destName} 패키지`, matchType: 'broad', tier: 'core', suggestedBid: 1200, category: '목적지+유형' });
    keywords.push({ keyword: `${destName} 여행`, matchType: 'broad', tier: 'core', suggestedBid: 1000, category: '목적지+일반' });
    keywords.push({ keyword: `${destName} 패키지 여행`, matchType: 'phrase', tier: 'core', suggestedBid: 1100, category: '목적지+유형' });
    keywords.push({ keyword: `${destName} 투어`, matchType: 'broad', tier: 'core', suggestedBid: 900, category: '목적지+유형' });
    if (region) {
      keywords.push({ keyword: `${region} 여행`, matchType: 'broad', tier: 'core', suggestedBid: 800, category: '지역' });
    }
  }

  // ═══ Mid 키워드 (중간 입찰가, 중간 검색량) ═══
  if (destName && durationStr) {
    keywords.push({ keyword: `${destName} ${durationStr}`, matchType: 'phrase', tier: 'mid', suggestedBid: 700, category: '목적지+기간' });
    keywords.push({ keyword: `${destName} ${durationShort}`, matchType: 'phrase', tier: 'mid', suggestedBid: 600, category: '목적지+기간' });
  }
  for (const type of detectedTypes) {
    keywords.push({ keyword: `${destName} ${type}`, matchType: 'phrase', tier: 'mid', suggestedBid: 650, category: '목적지+특성' });
  }
  if (airline && destName) {
    keywords.push({ keyword: `${airline} ${destName}`, matchType: 'phrase', tier: 'mid', suggestedBid: 500, category: '항공+목적지' });
  }
  if (lowestPrice && destName) {
    const priceRange = lowestPrice < 500000 ? '50만원 이하' : lowestPrice < 1000000 ? '100만원 이하' : '100만원대';
    keywords.push({ keyword: `${destName} 여행 ${priceRange}`, matchType: 'phrase', tier: 'mid', suggestedBid: 550, category: '가격대' });
  }

  // ═══ Longtail 키워드 (낮은 입찰가, 정확한 타겟) ═══
  if (departureCity && destName) {
    keywords.push({ keyword: `${departureCity}출발 ${destName}`, matchType: 'exact', tier: 'longtail', suggestedBid: 400, category: '출발지+목적지' });
    keywords.push({ keyword: `${departureCity} 출발 ${destName} 패키지`, matchType: 'exact', tier: 'longtail', suggestedBid: 350, category: '출발지+목적지+유형' });
    if (durationStr) {
      keywords.push({ keyword: `${departureCity}출발 ${destName} ${durationStr}`, matchType: 'exact', tier: 'longtail', suggestedBid: 300, category: '초세부' });
    }
  }
  for (const type of detectedTypes) {
    if (durationStr) {
      keywords.push({ keyword: `${destName} ${type} ${durationStr}`, matchType: 'exact', tier: 'longtail', suggestedBid: 280, category: '초세부' });
    }
  }
  // 특수 키워드
  for (const mod of TRAVEL_MODIFIERS) {
    if (title.includes(mod)) {
      keywords.push({ keyword: `${destName} ${mod}`, matchType: 'phrase', tier: 'longtail', suggestedBid: 350, category: '수식어' });
    }
  }
  // 포함사항 기반
  if (pkg.inclusions) {
    if (pkg.inclusions.some(i => i.includes('마사지'))) keywords.push({ keyword: `${destName} 마사지 포함`, matchType: 'exact', tier: 'longtail', suggestedBid: 250, category: '포함사항' });
    if (pkg.inclusions.some(i => i.includes('5성'))) keywords.push({ keyword: `${destName} 5성급 호텔`, matchType: 'exact', tier: 'longtail', suggestedBid: 300, category: '포함사항' });
    if (pkg.inclusions.some(i => i.includes('골프'))) keywords.push({ keyword: `${destName} 골프 패키지`, matchType: 'phrase', tier: 'longtail', suggestedBid: 400, category: '포함사항' });
  }

  // ═══ Negative 키워드 ═══
  for (const neg of NEGATIVE_KEYWORDS) {
    keywords.push({ keyword: neg, matchType: 'exact', tier: 'negative', suggestedBid: 0, category: '제외' });
  }

  return keywords;
}

// ── 빅데이터 아카이브 ────────────────────────────────────

const ARCHIVE_KEY = 'yeosonam_keyword_archive';

export function archivePerformance(destination: string, keyword: string, metrics: {
  impressions: number; clicks: number; ctr: number; cpc: number; conversions: number; spend: number; roas: number;
}): void {
  try {
    const all = getArchive();
    const key = `${destination}::${keyword}`;
    const existing = all.get(key);

    if (existing) {
      existing.totalImpressions += metrics.impressions;
      existing.totalClicks += metrics.clicks;
      existing.totalConversions += metrics.conversions;
      existing.totalSpend += metrics.spend;
      existing.sampleCount += 1;
      existing.avgCtr = existing.totalClicks > 0 ? (existing.totalClicks / existing.totalImpressions) * 100 : 0;
      existing.avgCpc = existing.totalClicks > 0 ? existing.totalSpend / existing.totalClicks : 0;
      existing.avgRoas = existing.totalSpend > 0 ? (existing.totalConversions * 500000 / existing.totalSpend) * 100 : 0;
      existing.lastUpdated = new Date().toISOString();
      all.set(key, existing);
    } else {
      all.set(key, {
        keyword,
        destination,
        totalImpressions: metrics.impressions,
        totalClicks: metrics.clicks,
        avgCtr: metrics.ctr,
        avgCpc: metrics.cpc,
        totalConversions: metrics.conversions,
        totalSpend: metrics.spend,
        avgRoas: metrics.roas,
        sampleCount: 1,
        lastUpdated: new Date().toISOString(),
      });
    }

    localStorage.setItem(ARCHIVE_KEY, JSON.stringify([...all.values()]));
  } catch { /* */ }
}

export function getArchive(): Map<string, KeywordPerformanceArchive> {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return new Map();
    const arr: KeywordPerformanceArchive[] = JSON.parse(raw);
    return new Map(arr.map(a => [`${a.destination}::${a.keyword}`, a]));
  } catch {
    return new Map();
  }
}

export function getTopKeywords(destination: string, limit = 10): KeywordPerformanceArchive[] {
  const all = [...getArchive().values()];
  return all
    .filter(a => a.destination === destination)
    .sort((a, b) => b.avgCtr - a.avgCtr)
    .slice(0, limit);
}

// ── 입찰 최적화 추천 ────────────────────────────────────

export interface BidRecommendation {
  keywordId: string;
  keyword: string;
  currentBid: number;
  recommendedBid: number;
  action: 'increase' | 'decrease' | 'pause' | 'maintain' | 'boost';
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export function optimizeBids(keywords: SearchAdKeyword[]): BidRecommendation[] {
  return keywords
    .filter(k => k.status === 'active' && k.tier !== 'negative')
    .map(k => {
      // Winner: CTR >= 5% + ROAS >= 200%
      if (k.ctr >= 5 && k.roas >= 200) {
        return {
          keywordId: k.id,
          keyword: k.keyword,
          currentBid: k.bid,
          recommendedBid: Math.round(k.bid * 1.2),
          action: 'increase' as const,
          reason: `CTR ${k.ctr}% + ROAS ${k.roas}% — 입찰가 20% 인상 추천`,
          confidence: 'high' as const,
        };
      }
      // 안정: CTR >= 3% + ROAS >= 100%
      if (k.ctr >= 3 && k.roas >= 100) {
        return {
          keywordId: k.id,
          keyword: k.keyword,
          currentBid: k.bid,
          recommendedBid: k.bid,
          action: 'maintain' as const,
          reason: `CTR ${k.ctr}% — 현재 입찰가 유지`,
          confidence: 'medium' as const,
        };
      }
      // 위험: CTR < 1% + spend > 10,000
      if (k.ctr < 1 && k.spend > 10000) {
        return {
          keywordId: k.id,
          keyword: k.keyword,
          currentBid: k.bid,
          recommendedBid: Math.round(k.bid * 0.7),
          action: 'decrease' as const,
          reason: `CTR ${k.ctr}% + 지출 ₩${k.spend.toLocaleString()} — 입찰가 30% 하향 추천`,
          confidence: 'high' as const,
        };
      }
      // 노출 0 + 7일 이상
      if (k.impressions === 0) {
        return {
          keywordId: k.id,
          keyword: k.keyword,
          currentBid: k.bid,
          recommendedBid: Math.round(k.bid * 1.5),
          action: 'boost' as const,
          reason: '노출 0 — 입찰가 50% 인상 또는 키워드 변경 추천',
          confidence: 'low' as const,
        };
      }
      return {
        keywordId: k.id,
        keyword: k.keyword,
        currentBid: k.bid,
        recommendedBid: k.bid,
        action: 'maintain' as const,
        reason: '데이터 부족 — 추이 관찰',
        confidence: 'low' as const,
      };
    })
    .sort((a, b) => {
      const order = { increase: 0, decrease: 1, boost: 2, pause: 3, maintain: 4 };
      return order[a.action] - order[b.action];
    });
}

// ── 유틸 ─────────────────────────────────────────────────
function getLowestPrice(pkg: { price?: number; price_tiers?: { adult_price?: number }[]; price_dates?: { date: string; price: number; confirmed: boolean }[] }): number {
  if (pkg.price_dates?.length) {
    const min = getMinPriceFromDates(pkg.price_dates as any);
    if (min > 0) return min;
  }
  const prices: number[] = [];
  if (pkg.price && pkg.price > 0) prices.push(pkg.price);
  if (pkg.price_tiers) {
    for (const tier of pkg.price_tiers) {
      if (tier.adult_price && tier.adult_price > 0) prices.push(tier.adult_price);
    }
  }
  return prices.length > 0 ? Math.min(...prices) : 0;
}

export function generateKeywordId(): string {
  return `kw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createSearchAdKeyword(
  extracted: ExtractedKeyword,
  platform: Platform,
  productId?: string,
): SearchAdKeyword {
  return {
    ...extracted,
    id: generateKeywordId(),
    platform,
    bid: extracted.suggestedBid,
    status: extracted.tier === 'negative' ? 'active' : 'active',
    impressions: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    conversions: 0,
    spend: 0,
    roas: 0,
    productId,
    createdAt: new Date().toISOString(),
  };
}

// ── 키워드 로컬 저장소 ───────────────────────────────────
const KEYWORDS_KEY = 'yeosonam_search_ad_keywords';

export function saveKeywords(keywords: SearchAdKeyword[]): void {
  try { localStorage.setItem(KEYWORDS_KEY, JSON.stringify(keywords)); } catch { /* */ }
}

export function loadKeywords(): SearchAdKeyword[] {
  try {
    const raw = localStorage.getItem(KEYWORDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
