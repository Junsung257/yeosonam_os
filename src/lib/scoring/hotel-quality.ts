export interface HotelQualityInput {
  hotelAvgGrade?: number | null;
  brandWithinStarScore?: number | null;
  mrtCompositeScore?: number | null;
  mrtMatchScore?: number | null;
  pricePercentile?: number | null;
}

export interface HotelQualityResult {
  score: number;
  label: '호텔 우수' | '호텔 무난' | '호텔 확인 필요';
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

function validNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

/**
 * Hotel quality V1.5 deterministic score.
 *
 * Customer-facing UI should expose only `label` and short reasons. The numeric
 * score is for ranking/debugging/admin use.
 */
export function scoreHotelQuality(input: HotelQualityInput): HotelQualityResult {
  const grade = validNumber(input.hotelAvgGrade);
  const brand = validNumber(input.brandWithinStarScore);
  const mrt = validNumber(input.mrtCompositeScore);
  const match = validNumber(input.mrtMatchScore);
  const pricePct = validNumber(input.pricePercentile);

  const reasons: string[] = [];
  let score = 45;
  let evidence = 0;

  if (grade != null) {
    score += clamp((grade - 3) / 2, 0, 1) * 28;
    evidence += 1;
    if (grade >= 4.5) reasons.push('호텔 등급 조건이 좋아요');
    else if (grade >= 3.8) reasons.push('호텔 조건은 무난해요');
    else reasons.push('호텔 등급 확인이 필요해요');
  } else {
    reasons.push('호텔 등급 정보가 부족해요');
  }

  if (brand != null) {
    score += clamp(brand, 0, 1) * 14;
    evidence += 1;
    if (brand >= 0.8) reasons.push('동급 안에서 선호도가 높은 호텔이에요');
  }

  if (mrt != null) {
    score += clamp(mrt, 0, 100) * 0.2;
    evidence += 1;
    if (mrt >= 75) reasons.push('외부 호텔 데이터도 양호해요');
  }

  if (match != null) {
    const matchPenalty = match < 0.45 ? 10 : match < 0.65 ? 4 : 0;
    score -= matchPenalty;
    evidence += 1;
    if (match < 0.45) reasons.push('호텔명 매칭 신뢰도가 낮아요');
  }

  if (pricePct != null) {
    score += (1 - clamp(pricePct, 0, 1)) * 6;
    evidence += 1;
    if (pricePct <= 0.35) reasons.push('동급 호텔 대비 가격 위치가 좋아요');
  }

  const finalScore = Math.round(clamp(score));
  const label =
    finalScore >= 76 && evidence >= 2 ? '호텔 우수'
      : finalScore >= 58 && evidence >= 1 ? '호텔 무난'
        : '호텔 확인 필요';

  const confidence =
    evidence >= 4 ? 'high'
      : evidence >= 2 ? 'medium'
        : 'low';

  return {
    score: finalScore,
    label,
    confidence,
    reasons: Array.from(new Set(reasons)).slice(0, 4),
  };
}
