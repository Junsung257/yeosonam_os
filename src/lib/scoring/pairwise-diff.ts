/**
 * Pairwise Diff — 두 패키지의 차이를 자연어로 합성.
 *
 * 사장님 시나리오 (2026-04-29):
 *   "5/5 상품은 A가 젤 좋아요. 금액은 10만원 더 비싼데
 *    호텔이 5성급이고 마사지가 하나 더 포함돼있어요"
 *
 * 자비스 답변 / 모바일 카드 비교 모달에서 사용.
 */
import type { PackageFeatures } from './types';

export interface PairwiseDiff {
  price_delta: number;            // A.list_price - B.list_price (음수 = A가 저렴)
  effective_delta: number;        // A.effective_price - B.effective_price
  better_axis: string[];          // A가 B보다 나은 점 (자연어)
  worse_axis: string[];           // A가 B보다 못한 점
  summary: string;                // 한 줄 합성 ("10만 비싸지만 5성+마사지")
}

interface ComparisonInput {
  features: PackageFeatures;
  effective_price: number;
  product_highlights?: string[];
}

const fmt만 = (n: number) => `${(Math.abs(n) / 10000).toFixed(0)}만`;

/**
 * A가 B 대비 어떤 차이가 있는지 자연어로 합성.
 * 양쪽 다 1순위라 가정 (rank 안 본다 — features만 비교).
 */
export function comparePackages(a: ComparisonInput, b: ComparisonInput): PairwiseDiff {
  const af = a.features, bf = b.features;
  const better: string[] = [];
  const worse: string[] = [];

  // 호텔 등급
  const hotelDiff = (af.hotel_avg_grade ?? 0) - (bf.hotel_avg_grade ?? 0);
  if (hotelDiff >= 0.5) better.push(`호텔 ${af.hotel_avg_grade}성 (${bf.hotel_avg_grade}성 대비 ↑)`);
  else if (hotelDiff <= -0.5) worse.push(`호텔 ${af.hotel_avg_grade}성 (${bf.hotel_avg_grade}성 대비 ↓)`);

  // 직항 vs 경유
  if (af.is_direct_flight && !bf.is_direct_flight) better.push('직항 (다른 건 경유)');
  else if (!af.is_direct_flight && bf.is_direct_flight) worse.push('경유 (다른 건 직항)');

  // 쇼핑 횟수 (적을수록 ↑)
  const shopDiff = af.shopping_count - bf.shopping_count;
  if (shopDiff <= -2) better.push(`쇼핑 ${af.shopping_count}회 (${bf.shopping_count}회 대비 ↓)`);
  else if (af.shopping_count === 0 && bf.shopping_count > 0) better.push('노쇼핑');
  else if (shopDiff >= 2) worse.push(`쇼핑 ${af.shopping_count}회 (${bf.shopping_count}회 대비 ↑)`);

  // 무료 옵션
  const optDiff = af.free_option_count - bf.free_option_count;
  if (optDiff >= 1) {
    const aHasMassage = a.product_highlights?.some(h => /마사지/.test(h));
    const bHasMassage = b.product_highlights?.some(h => /마사지/.test(h));
    if (aHasMassage && !bHasMassage) better.push('마사지 추가 포함');
    else better.push(`옵션 ${optDiff}개 더 포함`);
  }
  else if (optDiff <= -1) worse.push(`옵션 ${Math.abs(optDiff)}개 적음`);

  // 식사
  const mealDiff = af.meal_count - bf.meal_count;
  if (mealDiff >= 2) better.push(`식사 ${af.meal_count}회 (${bf.meal_count}회 대비 ↑)`);

  // 한식 (P1)
  const koreanDiff = af.korean_meal_count - bf.korean_meal_count;
  if (koreanDiff >= 1) better.push(`한식 ${af.korean_meal_count}회 (${bf.korean_meal_count}회 대비 ↑)`);

  // 특식 (P1)
  const specialDiff = af.special_meal_count - bf.special_meal_count;
  if (specialDiff >= 1) better.push(`특식 ${af.special_meal_count}회 추가`);

  // 자유시간 (P1)
  const freeDiff = af.free_time_ratio - bf.free_time_ratio;
  if (freeDiff >= 0.15) better.push('자유시간 더 많음');

  // 출확정율 (P1)
  const confDiff = af.confirmation_rate - bf.confirmation_rate;
  if (confDiff >= 0.3) better.push(`출확정 ${Math.round(af.confirmation_rate * 100)}% (안정)`);

  // 신뢰도
  const relDiff = af.reliability_score - bf.reliability_score;
  if (relDiff >= 0.15) better.push('랜드사 신뢰도 ↑');

  // P1+ 호텔 위치 (커플 시그널)
  if (af.hotel_location === 'resort' && bf.hotel_location === 'city') better.push('리조트형 (커플)');
  else if (af.hotel_location === 'city' && bf.hotel_location === 'resort') better.push('시내 호텔 (효도 편의)');

  // P1+ 항공 시간대 (가족 시그널)
  if (af.flight_time && bf.flight_time && af.flight_time !== bf.flight_time) {
    if (af.flight_time === 'morning' || af.flight_time === 'day') {
      if (bf.flight_time === 'redeye') better.push('낮 출발 (어린이·노약자)');
    }
    if (af.flight_time === 'redeye' && (bf.flight_time === 'morning' || bf.flight_time === 'day')) {
      worse.push('심야 출발 (현지 시간 ↑)');
    }
  }

  // 계절 적합도 차이 큼
  const climateDiff = af.climate_score - bf.climate_score;
  if (climateDiff >= 15) better.push(`계절 적합도 +${Math.round(climateDiff)}점`);
  else if (climateDiff <= -15) worse.push(`계절 적합도 -${Math.round(-climateDiff)}점`);

  const price_delta = af.list_price - bf.list_price;
  const effective_delta = a.effective_price - b.effective_price;

  // 한 줄 요약 합성
  const summary = synthesizeSummary(price_delta, better, worse);

  return { price_delta, effective_delta, better_axis: better, worse_axis: worse, summary };
}

function synthesizeSummary(priceDelta: number, better: string[], worse: string[]): string {
  const priceWord =
    priceDelta > 5000 ? `${fmt만(priceDelta)}원 더 비싸` :
    priceDelta < -5000 ? `${fmt만(priceDelta)}원 더 저렴해` :
    '비슷한 가격이지만';

  const top2 = better.slice(0, 2).join(' + ');

  if (better.length === 0 && worse.length === 0) {
    return `${priceWord}요. 구성은 비슷해요.`;
  }
  if (better.length > 0 && priceDelta > 5000) {
    return `${priceWord}지만 ${top2} 포함이에요`;
  }
  if (better.length > 0 && priceDelta <= 5000) {
    return `${priceWord}고 ${top2}까지 포함이에요`;
  }
  if (worse.length > 0) {
    return `${priceWord}지만 ${worse[0]}`;
  }
  return `${priceWord}요`;
}

/**
 * 그룹 1위 vs 2위 비교 — 자비스가 자주 쓰는 패턴.
 */
export function compareTopTwo(items: ComparisonInput[]): PairwiseDiff | null {
  if (items.length < 2) return null;
  return comparePackages(items[0], items[1]);
}
