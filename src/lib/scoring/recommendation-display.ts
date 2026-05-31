export interface PackageScoreDisplayRow {
  package_id: string;
  group_key?: string | null;
  departure_date?: string | null;
  list_price?: number | null;
  effective_price?: number | null;
  topsis_score?: number | null;
  rank_in_group?: number | null;
  group_size?: number | null;
  shopping_count?: number | null;
  hotel_avg_grade?: number | null;
  free_option_count?: number | null;
  is_direct_flight?: boolean | null;
  duration_days?: number | null;
  breakdown?: {
    why?: unknown;
    effective_price?: unknown;
    mrt_hotel_quality_score?: unknown;
  } | null;
}

export interface RecommendationDisplay {
  label: string;
  reasons: string[];
  comparisonSummary: string;
  hotelGradeLabel: string | null;
  groupSize: number;
  rankInGroup: number | null;
  effectivePrice: number | null;
  listPrice: number | null;
  hasComparison: boolean;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeWhy(why: unknown): string[] {
  if (!Array.isArray(why)) return [];
  return why
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => !/(환산|차감|보너스|실효|KRW|만원|만\s)/.test(v))
    .filter(Boolean)
    .slice(0, 4);
}

export function hotelGradeLabel(hotelAvgGrade?: number | null): string | null {
  if (hotelAvgGrade == null) return '호텔 확인 필요';
  if (hotelAvgGrade >= 4.5) return '호텔 우수';
  if (hotelAvgGrade >= 3.8) return '호텔 무난';
  return '호텔 확인 필요';
}

export function buildRecommendationDisplay(row?: PackageScoreDisplayRow | null): RecommendationDisplay | null {
  if (!row) return null;
  const groupSize = Math.max(0, Number(row.group_size ?? 0));
  const rank = row.rank_in_group == null ? null : Number(row.rank_in_group);
  const hasComparison = groupSize >= 2;
  const hotelLabel = hotelGradeLabel(toNumber(row.hotel_avg_grade));
  const shoppingCount = toNumber(row.shopping_count);
  const freeOptionCount = toNumber(row.free_option_count);
  const hotelGrade = toNumber(row.hotel_avg_grade);
  const why = normalizeWhy(row.breakdown?.why);

  let label = hasComparison ? '조건을 비교했어요 🔍' : '조건 확인 완료';
  if (hasComparison && rank === 1) {
    if (shoppingCount === 0 && (hotelGrade ?? 0) >= 4.5) label = '편하게 가기 좋은 구성 ✨';
    else if (shoppingCount === 0) label = '쇼핑 부담이 적어요 ✨';
    else if ((hotelGrade ?? 0) >= 4.5) label = '호텔 조건이 좋아요 🏨';
    else if (row.is_direct_flight) label = '이동이 편한 구성이에요 ✈️';
    else label = '같은 날짜 상품 중 추천해요 ✨';
  } else if (hasComparison && rank != null && rank <= 3) {
    label = '비교해볼 만한 선택지예요';
  }

  const generated: string[] = [];
  if (hasComparison) generated.push(`같은 날짜 상품 ${groupSize}개를 비교했어요`);
  if (shoppingCount === 0) generated.push('쇼핑 일정 부담이 적어요');
  else if (shoppingCount != null && shoppingCount > 0) generated.push(`쇼핑 ${shoppingCount}회 포함 여부를 확인했어요`);
  if ((hotelGrade ?? 0) >= 4.5) generated.push('호텔 조건이 좋은 편이에요');
  else if (hotelLabel) generated.push(hotelLabel);
  if (row.is_direct_flight) generated.push('직항 조건을 확인했어요');
  if ((freeOptionCount ?? 0) >= 1) generated.push('포함 옵션이 있어요');

  const reasons = Array.from(new Set([...generated, ...why])).slice(0, 4);
  const comparisonSummary = hasComparison
    ? `같은 날짜 상품 ${groupSize}개를 가격·호텔·쇼핑·옵션 기준으로 비교했어요`
    : '가격·호텔·쇼핑·옵션 조건을 확인했어요';

  return {
    label,
    reasons,
    comparisonSummary,
    hotelGradeLabel: hotelLabel,
    groupSize,
    rankInGroup: rank,
    effectivePrice: toNumber(row.effective_price ?? row.breakdown?.effective_price),
    listPrice: toNumber(row.list_price),
    hasComparison,
  };
}
