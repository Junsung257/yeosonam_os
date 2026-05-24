/**
 * ══════════════════════════════════════════════════════════
 * Keyword Brain — 여행 특화 키워드 추출 + 빅데이터 학습 엔진
 * ══════════════════════════════════════════════════════════
 *
 * Phase 1 (2026):
 *   - localStorage → Supabase 전환
 *   - 캐시/폴백으로 localStorage 유지 (Fallback)
 *   - 핵심 데이터: keyword_performance_daily + keyword_search_terms
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
  monthlySearchVolume?: number;
  competitionLevel?: 'low' | 'medium' | 'high';
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

/**
 * 세세세부 키워드 생성 — 아주 낮은 단위가격으로 입찰 시작
 *
 * 전략:
 *   1. 출발지+목적지+기간+호텔등급+상품유형 조합으로 초세부 키워드 생성
 *   2. suggestedBid = 100~200원 (기존 대비 1/3 수준)
 *   3. matchType = exact (정확히 일치하는 검색어만)
 *   4. 데이터 수집 후 CTR/ROAS 기반 자동 입찰 조정
 */
export function generateMicroKeywords(pkg: {
  destination?: string;
  duration?: number;
  departure_airport?: string;
  product_type?: string;
  display_name?: string;
  title?: string;
  inclusion_hotel_rating?: string;
  inclusions?: string[];
}): ExtractedKeyword[] {
  const microKeywords: ExtractedKeyword[] = [];
  const dest = pkg.destination || '';
  const duration = pkg.duration;
  const durationStr = duration ? `${duration - 1}박${duration}일` : '';
  const departureCity = DEPARTURE_CITIES.find(c =>
    pkg.departure_airport?.includes(c) ||
    pkg.display_name?.includes(c) ||
    pkg.title?.includes(c)
  ) || '';
  const destInfo = Object.values(DESTINATIONS).find(d =>
    dest.includes(d.kr) || pkg.display_name?.includes(d.kr)
  );
  const destName = destInfo?.kr || dest;
  const productType = pkg.product_type || '';

  // 조합별 초세세부 키워드 (입찰가 100~200원)
  if (departureCity && destName && durationStr) {
    microKeywords.push({
      keyword: `${departureCity}출발 ${destName} ${durationStr}`,
      matchType: 'exact',
      tier: 'longtail',
      suggestedBid: 150,
      category: '초세세부-출발기간',
    });
    microKeywords.push({
      keyword: `${departureCity} ${destName} ${durationStr}`,
      matchType: 'exact',
      tier: 'longtail',
      suggestedBid: 130,
      category: '초세세부-출발기간',
    });
  }

  if (destName && durationStr) {
    const hotelTier = pkg.inclusion_hotel_rating || '';
    if (hotelTier) {
      microKeywords.push({
        keyword: `${destName} ${durationStr} ${hotelTier}`,
        matchType: 'exact',
        tier: 'longtail',
        suggestedBid: 120,
        category: '초세세부-호텔기간',
      });
    }

    // 상품 유형 + 기간
    const types = PRODUCT_TYPES.filter(t =>
      productType.includes(t) || pkg.display_name?.includes(t) || pkg.title?.includes(t)
    );
    for (const t of types) {
      microKeywords.push({
        keyword: `${destName} ${t} ${durationStr}`,
        matchType: 'exact',
        tier: 'longtail',
        suggestedBid: 160,
        category: '초세세부-유형기간',
      });
    }

    // 특가 + 목적지 + 기간
    const specialModifiers = TRAVEL_MODIFIERS.filter(m =>
      pkg.display_name?.includes(m) || pkg.title?.includes(m)
    );
    for (const mod of specialModifiers) {
      microKeywords.push({
        keyword: `${destName} ${mod} ${durationStr}`,
        matchType: 'exact',
        tier: 'longtail',
        suggestedBid: 180,
        category: '초세세부-수식어기간',
      });
    }
  }

  // 포함사항 기반 초세세부
  if (destName && pkg.inclusions) {
    if (pkg.inclusions.some(i => i.includes('전일')) || pkg.inclusions.some(i => i.includes('자유'))) {
      microKeywords.push({
        keyword: `${destName} 자유일정`,
        matchType: 'exact',
        tier: 'longtail',
        suggestedBid: 200,
        category: '초세세부-일정',
      });
    }
    if (pkg.inclusions.some(i => i.includes('가이드'))) {
      microKeywords.push({
        keyword: `${destName} 가이드동행`,
        matchType: 'exact',
        tier: 'longtail',
        suggestedBid: 180,
        category: '초세세부-서비스',
      });
    }
    if (pkg.inclusions.some(i => i.includes('공항')) && pkg.inclusions.some(i => i.includes('픽업'))) {
      microKeywords.push({
        keyword: `${destName} 공항픽업포함`,
        matchType: 'exact',
        tier: 'longtail',
        suggestedBid: 150,
        category: '초세세부-서비스',
      });
    }
    if (pkg.inclusions.some(i => i.includes('식사'))) {
      microKeywords.push({
        keyword: `${destName} 식사포함`,
        matchType: 'exact',
        tier: 'longtail',
        suggestedBid: 140,
        category: '초세세부-서비스',
      });
    }
  }

  return microKeywords;
}

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

/**
 * Naver DataLab + 캐시 기반 실제 검색량/경쟁도 결합.
 * 키 미설정 시 tier 휴리스틱으로 폴백 (랜덤 X — 결정론적).
 */
export async function enrichKeywordsWithNaverVolume(keywords: ExtractedKeyword[]): Promise<ExtractedKeyword[]> {
  if (keywords.length === 0) return keywords;

  // 동적 import — 서버 환경에서만 실행 (이 모듈은 클라이언트에서도 쓰임)
  const researchMap: Map<string, { monthly_search_volume: number | null; competition_level: 'low' | 'medium' | 'high' | null }> = new Map();
  try {
    if (typeof window === 'undefined') {
      const { researchKeywordsBatch } = await import('./keyword-research');
      const targets = keywords.filter(k => k.tier !== 'negative').map(k => k.keyword);
      const results = await researchKeywordsBatch(targets);
      for (const [kw, r] of results) {
        researchMap.set(kw, {
          monthly_search_volume: r.monthly_search_volume,
          competition_level: r.competition_level,
        });
      }
    }
  } catch {
    // 리서치 실패 시 휴리스틱으로 폴백
  }

  return keywords.map(k => {
    const real = researchMap.get(k.keyword);
    if (real?.monthly_search_volume) {
      return {
        ...k,
        monthlySearchVolume: real.monthly_search_volume,
        competitionLevel: real.competition_level || undefined,
      };
    }
    // 결정론적 휴리스틱 폴백 (tier 기준 중앙값)
    const fallback: Record<KeywordTier, { volume: number; comp: 'low' | 'medium' | 'high' }> = {
      core:     { volume: 8000,  comp: 'high'   },
      mid:      { volume: 1500,  comp: 'medium' },
      longtail: { volume: 300,   comp: 'low'    },
      negative: { volume: 0,     comp: 'low'    },
    };
    const f = fallback[k.tier];
    return {
      ...k,
      monthlySearchVolume: f.volume,
      competitionLevel: f.comp,
    };
  });
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

/**
 * 저가 입찰 특화 최적화 — '초세세부' 키워드에 대해 매우 보수적인 입찰 전략
 *
 * 원칙:
 *   1. 최소 입찰가 100원부터 시작 (기존 300~400원 대비)
 *   2. CTR >= 2%면 50원 인상 (천천히 올림)
 *   3. CTR >= 5%면 100원 인상 (안정적 성과 확인 후)
 *   4. 노출 < 100이고 3일 이상 지나면 100원 인상 (데이터 확보 우선)
 *   5. CTR < 1%이고 spend > 5000원이면 즉시 200원 인하 또는 일시정지
 *   6. 최대 입찰가 상한 = 1,000원 (절대 초과 금지)
 */
export function optimizeLowBidKeywords(keywords: SearchAdKeyword[]): BidRecommendation[] {
  const now = Date.now();
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  return keywords
    .filter(k => k.status === 'active' && k.tier === 'longtail' && k.bid <= 1000)
    .map(k => {
      const daysSinceCreated = (now - new Date(k.createdAt).getTime()) / (24 * 60 * 60 * 1000);

      // 성과 좋음: CTR >= 5% → 100원 인상 (최대 1,000원)
      if (k.ctr >= 5) {
        const newBid = Math.min(k.bid + 100, 1000);
        return {
          keywordId: k.id,
          keyword: k.keyword,
          currentBid: k.bid,
          recommendedBid: newBid,
          action: newBid > k.bid ? 'increase' as const : 'maintain' as const,
          reason: `CTR ${k.ctr}% 우수 — ${k.bid}원 → ${newBid}원 (+100원)`,
          confidence: 'high' as const,
        };
      }

      // 성과 보통: CTR >= 2% → 50원 인상 (천천히)
      if (k.ctr >= 2) {
        const newBid = Math.min(k.bid + 50, 1000);
        return {
          keywordId: k.id,
          keyword: k.keyword,
          currentBid: k.bid,
          recommendedBid: newBid,
          action: newBid > k.bid ? 'increase' as const : 'maintain' as const,
          reason: `CTR ${k.ctr}% 안정 — ${k.bid}원 → ${newBid}원 (+50원)`,
          confidence: 'medium' as const,
        };
      }

      // 노출 부족: 노출 < 100, 생성 후 3일 이상 → 100원 인상 (데이터 확보)
      if (k.impressions < 100 && daysSinceCreated >= 3) {
        const newBid = Math.min(k.bid + 100, 1000);
        return {
          keywordId: k.id,
          keyword: k.keyword,
          currentBid: k.bid,
          recommendedBid: newBid,
          action: 'boost' as const,
          reason: `노출 ${k.impressions}회 부족 — ${k.bid}원 → ${newBid}원 (+100원, 데이터 확보 목적)`,
          confidence: 'low' as const,
        };
      }

      // 성과 나쁨: CTR < 1%, 지출 5000원 이상 → 인하
      if (k.ctr < 1 && k.spend > 5000) {
        if (k.bid <= 150) {
          // 최저 입찰가 도달 → 일시정지
          return {
            keywordId: k.id,
            keyword: k.keyword,
            currentBid: k.bid,
            recommendedBid: 0,
            action: 'pause' as const,
            reason: `CTR ${k.ctr}% 저조, 최저입찰 도달 — 일시정지`,
            confidence: 'medium' as const,
          };
        }
        const newBid = Math.max(k.bid - 200, 100);
        return {
          keywordId: k.id,
          keyword: k.keyword,
          currentBid: k.bid,
          recommendedBid: newBid,
          action: 'decrease' as const,
          reason: `CTR ${k.ctr}% 저조 — ${k.bid}원 → ${newBid}원 (-200원)`,
          confidence: 'medium' as const,
        };
      }

      // 데이터 없음: 유지
      return {
        keywordId: k.id,
        keyword: k.keyword,
        currentBid: k.bid,
        recommendedBid: k.bid,
        action: 'maintain' as const,
        reason: daysSinceCreated < 3
          ? `생성 ${Math.round(daysSinceCreated)}일차 — 데이터 수집 중`
          : `CTR ${k.ctr}%, 노출 ${k.impressions}회 — 현재 유지`,
        confidence: 'low' as const,
      };
    });
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

// ── Supabase 저장소 (Phase 1: localStorage와 병행) ──────
//
// Supabase 클라이언트는 서버/API 라우트에서만 사용.
// 클라이언트에서는 localStorage를 계속 사용 (fallback)

interface SupabaseKeywordRow {
  keyword_text: string;
  platform: string;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost_krw: number;
  avg_cpc: number;
  conversions: number;
  conversion_value: number;
  roas: number;
  avg_position: number | null;
  impression_share: number | null;
  campaign_id: string | null;
  ad_group_id: string | null;
  keyword_id: string | null;
  match_type: string | null;
}

/**
 * 서버 환경에서 Supabase에 키워드 성과 저장
 * 클라이언트(브라우저)에서는 localStorage에 저장
 */
export async function savePerformanceToDB(
  destination: string,
  keyword: string,
  platform: 'google' | 'naver',
  metrics: {
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
    conversions: number;
    spend: number;
    roas: number;
  },
): Promise<void> {
  // 브라우저 환경: localStorage에 저장 (기존 방식 유지)
  archivePerformance(destination, keyword, metrics);

  // 서버 환경: Supabase에도 저장
  if (typeof window === 'undefined') {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !supabaseKey) return;

      const supabase = createClient(supabaseUrl, supabaseKey);
      const today = new Date().toISOString().slice(0, 10);

      const data: SupabaseKeywordRow = {
        keyword_text: keyword,
        platform,
        date: today,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        ctr: metrics.ctr,
        cost_krw: metrics.spend,
        avg_cpc: metrics.cpc,
        conversions: metrics.conversions,
        conversion_value: metrics.conversions * 500000, // 추정 전환가치
        roas: metrics.roas,
        avg_position: null,
        impression_share: null,
        campaign_id: null,
        ad_group_id: null,
        keyword_id: null,
        match_type: null,
      };

      await supabase
        .from('keyword_performance_daily')
        .upsert(data, { onConflict: 'keyword_text,platform,date' });
    } catch {
      // Supabase 저장 실패는 무시 (localStorage에 이미 저장됨)
    }
  }
}

/**
 * DB에서 키워드 성과 조회
 * 서버 환경에서만 작동, 브라우저에서는 localStorage 사용
 */
export async function loadPerformanceFromDB(
  keyword: string,
  platform: 'google' | 'naver',
  days = 30,
): Promise<SupabaseKeywordRow[]> {
  if (typeof window !== 'undefined') return [];

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return [];

    const supabase = createClient(supabaseUrl, supabaseKey);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data } = await supabase
      .from('keyword_performance_daily')
      .select('*')
      .eq('keyword_text', keyword)
      .eq('platform', platform)
      .gte('date', since.toISOString().slice(0, 10))
      .order('date', { ascending: false });

    return (data ?? []) as SupabaseKeywordRow[];
  } catch {
    return [];
  }
}

/**
 * Search Terms 저장 (서버 환경)
 */
export async function saveSearchTerm(params: {
  searchTerm: string;
  keywordText: string;
  matchType: string;
  impressions: number;
  clicks: number;
  costKrw: number;
  conversions: number;
  platform: 'google' | 'naver';
}): Promise<void> {
  if (typeof window !== 'undefined') return;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const today = new Date().toISOString().slice(0, 10);

    // 기존 레코드 확인
    const { data: existing } = await supabase
      .from('keyword_search_terms')
      .select('id, impressions, clicks, cost_krw, conversions, last_seen')
      .eq('search_term', params.searchTerm)
      .eq('keyword_text', params.keywordText)
      .eq('platform', params.platform)
      .single();

    if (existing) {
      // 누적 업데이트
      await supabase
        .from('keyword_search_terms')
        .update({
          impressions: (existing.impressions ?? 0) + params.impressions,
          clicks: (existing.clicks ?? 0) + params.clicks,
          cost_krw: (existing.cost_krw ?? 0) + params.costKrw,
          conversions: (existing.conversions ?? 0) + params.conversions,
          ctr: existing.clicks + params.clicks > 0
            ? ((existing.clicks + params.clicks) / (existing.impressions + params.impressions)) * 100
            : 0,
          last_seen: today,
        })
        .eq('id', existing.id);
    } else {
      // 새 레코드
      await supabase
        .from('keyword_search_terms')
        .insert({
          search_term: params.searchTerm,
          keyword_text: params.keywordText,
          match_type: params.matchType,
          impressions: params.impressions,
          clicks: params.clicks,
          ctr: params.clicks > 0 ? (params.clicks / params.impressions) * 100 : 0,
          cost_krw: params.costKrw,
          conversions: params.conversions,
          first_seen: today,
          last_seen: today,
          platform: params.platform,
        });
    }
  } catch {
    // 저장 실패는 무시
  }
}

/**
 * 최적화 액션 로그 저장
 */
export async function logOptimization(params: {
  action: string;
  platform: 'google' | 'naver';
  keywordText?: string;
  campaignId?: string;
  keywordId?: string;
  oldValue?: string;
  newValue?: string;
  reason: string;
  triggeredBy: 'rule' | 'ai' | 'manual';
  success?: boolean;
  errorMessage?: string;
}): Promise<void> {
  if (typeof window !== 'undefined') return;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from('optimization_log').insert({
      action: params.action,
      platform: params.platform,
      keyword_text: params.keywordText,
      campaign_id: params.campaignId,
      keyword_id: params.keywordId,
      old_value: params.oldValue,
      new_value: params.newValue,
      reason: params.reason,
      triggered_by: params.triggeredBy,
      success: params.success ?? true,
      error_message: params.errorMessage,
    });
  } catch {
    // 로그 저장 실패는 무시
  }
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
