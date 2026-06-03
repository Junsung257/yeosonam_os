import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAMPLE_LIMIT = 5000;

type PackageAuditRow = {
  id: string;
  title: string | null;
  destination: string | null;
  status: string | null;
  price_dates: unknown;
};

type ScoreAuditRow = {
  package_id: string;
  group_key: string | null;
  group_size: number | null;
  rank_in_group: number | null;
  hotel_avg_grade: number | null;
  shopping_count: number | null;
  free_option_count: number | null;
  is_direct_flight: boolean | null;
  computed_at: string | null;
};

type HotelIntelAuditRow = {
  package_id: string;
  matched_mrt_gid: string | null;
  match_score: number | null;
  composite_mrt_score: number | null;
};

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function topCounts(values: Array<string | null | undefined>, limit = 8) {
  const map = new Map<string, number>();
  for (const raw of values) {
    const key = raw?.trim() || '미지정';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function hasPriceDates(v: unknown): boolean {
  return Array.isArray(v) && v.some((d) => {
    if (!d || typeof d !== 'object') return false;
    const row = d as { date?: unknown; price?: unknown };
    return typeof row.date === 'string' && typeof row.price === 'number' && row.price > 0;
  });
}

function buildWarnings(input: {
  activeCount: number;
  scoredActiveRate: number;
  comparisonReadyRate: number;
  hotelMissingRate: number;
  hotelIntelMatchedRate: number;
  shoppingMissingRate: number;
  optionMissingRate: number;
}) {
  const warnings: string[] = [];
  if (input.activeCount === 0) warnings.push('감사 대상 상품 샘플이 없습니다.');
  if (input.scoredActiveRate < 80) warnings.push('활성 상품 중 점수 보유율이 낮습니다. 재계산 또는 등록 파이프라인 연결을 확인하세요.');
  if (input.comparisonReadyRate < 50) warnings.push('비교군 2개 이상인 점수 row가 부족합니다. 목적지·출발일 정규화 품질을 확인하세요.');
  if (input.hotelMissingRate > 30) warnings.push('호텔 등급 누락이 많습니다. 호텔 추출/매칭 보강이 필요합니다.');
  if (input.hotelIntelMatchedRate < 30) warnings.push('외부 호텔 매칭률이 낮습니다. 호텔명 alias 또는 MRT 매칭 큐를 보강하세요.');
  if (input.shoppingMissingRate > 20) warnings.push('쇼핑 횟수 누락이 많아 고객 비교 문구의 신뢰도가 떨어질 수 있습니다.');
  if (input.optionMissingRate > 20) warnings.push('포함 옵션 누락이 많아 실효가 비교가 약해질 수 있습니다.');
  return warnings;
}

const getHandler = async () => {
  if (!isSupabaseConfigured) {
    return apiResponse({ configured: false });
  }

  const [pkgCountRes, scoreCountRes, packagesRes, scoresRes, hotelIntelRes] = await Promise.all([
    supabaseAdmin.from('travel_packages').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('package_scores').select('package_id', { count: 'exact', head: true }),
    supabaseAdmin
      .from('travel_packages')
      .select('id,title,destination,status,price_dates')
      .order('created_at', { ascending: false })
      .limit(SAMPLE_LIMIT),
    supabaseAdmin
      .from('package_scores')
      .select('package_id,group_key,group_size,rank_in_group,hotel_avg_grade,shopping_count,free_option_count,is_direct_flight,computed_at')
      .order('computed_at', { ascending: false })
      .limit(SAMPLE_LIMIT),
    supabaseAdmin
      .from('mrt_package_hotel_intel')
      .select('package_id,matched_mrt_gid,match_score,composite_mrt_score')
      .order('computed_at', { ascending: false })
      .limit(SAMPLE_LIMIT),
  ]);

  if (packagesRes.error) {
    return apiResponse({ error: sanitizeDbError(packagesRes.error) }, { status: 500 });
  }
  if (scoresRes.error) {
    return apiResponse({ error: sanitizeDbError(scoresRes.error) }, { status: 500 });
  }

  const packages = (packagesRes.data ?? []) as PackageAuditRow[];
  const scores = (scoresRes.data ?? []) as ScoreAuditRow[];
  const hotelIntel = (hotelIntelRes.data ?? []) as HotelIntelAuditRow[];

  const packageIds = new Set(packages.map((p) => p.id));
  const scoredPackageIds = new Set(scores.map((s) => s.package_id).filter(Boolean));
  const hotelIntelPackageIds = new Set(hotelIntel.map((h) => h.package_id).filter(Boolean));
  const matchedHotelIntelPackageIds = new Set(
    hotelIntel.filter((h) => Boolean(h.matched_mrt_gid)).map((h) => h.package_id),
  );

  const activeLikePackages = packages.filter((p) => {
    const status = (p.status ?? '').toLowerCase();
    return !['archived', 'deleted', 'rejected'].includes(status);
  });
  const activeLikeIds = new Set(activeLikePackages.map((p) => p.id));
  const scoredActiveCount = [...activeLikeIds].filter((id) => scoredPackageIds.has(id)).length;

  const scoreRowsForVisiblePackages = scores.filter((s) => packageIds.has(s.package_id));
  const comparisonReadyRows = scoreRowsForVisiblePackages.filter((s) => (s.group_size ?? 0) >= 2);
  const singleGroupRows = scoreRowsForVisiblePackages.filter((s) => (s.group_size ?? 0) < 2);
  const hotelMissingRows = scoreRowsForVisiblePackages.filter((s) => s.hotel_avg_grade == null);
  const shoppingMissingRows = scoreRowsForVisiblePackages.filter((s) => s.shopping_count == null);
  const optionMissingRows = scoreRowsForVisiblePackages.filter((s) => s.free_option_count == null);
  const directFlightMissingRows = scoreRowsForVisiblePackages.filter((s) => s.is_direct_flight == null);

  const missingScoreExamples = activeLikePackages
    .filter((p) => !scoredPackageIds.has(p.id))
    .slice(0, 12)
    .map((p) => ({
      id: p.id,
      title: p.title,
      destination: p.destination,
      status: p.status,
      hasPriceDates: hasPriceDates(p.price_dates),
    }));

  const weakScoreExamples = scoreRowsForVisiblePackages
    .filter((s) => (s.group_size ?? 0) < 2 || s.hotel_avg_grade == null || s.shopping_count == null || s.free_option_count == null)
    .slice(0, 12)
    .map((s) => ({
      package_id: s.package_id,
      group_key: s.group_key,
      group_size: s.group_size,
      rank_in_group: s.rank_in_group,
      hotel_avg_grade: s.hotel_avg_grade,
      shopping_count: s.shopping_count,
      free_option_count: s.free_option_count,
    }));

  const hotelIntelMatchedCount = [...activeLikeIds].filter((id) => matchedHotelIntelPackageIds.has(id)).length;
  const hotelIntelSeenCount = [...activeLikeIds].filter((id) => hotelIntelPackageIds.has(id)).length;

  const scoredActivePackageRate = pct(scoredActiveCount, activeLikePackages.length);
  const comparisonReadyRate = pct(comparisonReadyRows.length, scoreRowsForVisiblePackages.length);
  const hotelMissingRate = pct(hotelMissingRows.length, scoreRowsForVisiblePackages.length);
  const shoppingMissingRate = pct(shoppingMissingRows.length, scoreRowsForVisiblePackages.length);
  const optionMissingRate = pct(optionMissingRows.length, scoreRowsForVisiblePackages.length);
  const hotelIntelMatchedRate = pct(hotelIntelMatchedCount, activeLikePackages.length);

  return apiResponse({
    configured: true,
    sampled: {
      packageLimit: SAMPLE_LIMIT,
      scoreLimit: SAMPLE_LIMIT,
      packageSampled: (pkgCountRes.count ?? 0) > SAMPLE_LIMIT,
      scoreSampled: (scoreCountRes.count ?? 0) > SAMPLE_LIMIT,
    },
    totals: {
      packages: pkgCountRes.count ?? packages.length,
      scoreRows: scoreCountRes.count ?? scores.length,
      sampledPackages: packages.length,
      sampledActiveLikePackages: activeLikePackages.length,
      sampledScoreRows: scores.length,
    },
    coverage: {
      scoredActivePackages: scoredActiveCount,
      scoredActivePackageRate,
      comparisonReadyRows: comparisonReadyRows.length,
      comparisonReadyRate,
      singleGroupRows: singleGroupRows.length,
      singleGroupRate: pct(singleGroupRows.length, scoreRowsForVisiblePackages.length),
      hotelMissingRows: hotelMissingRows.length,
      hotelMissingRate,
      shoppingMissingRows: shoppingMissingRows.length,
      shoppingMissingRate,
      optionMissingRows: optionMissingRows.length,
      optionMissingRate,
      directFlightMissingRows: directFlightMissingRows.length,
      directFlightMissingRate: pct(directFlightMissingRows.length, scoreRowsForVisiblePackages.length),
      hotelIntelSeenPackages: hotelIntelSeenCount,
      hotelIntelSeenRate: pct(hotelIntelSeenCount, activeLikePackages.length),
      hotelIntelMatchedPackages: hotelIntelMatchedCount,
      hotelIntelMatchedRate,
    },
    warnings: buildWarnings({
      activeCount: activeLikePackages.length,
      scoredActiveRate: scoredActivePackageRate,
      comparisonReadyRate,
      hotelMissingRate,
      hotelIntelMatchedRate,
      shoppingMissingRate,
      optionMissingRate,
    }),
    topDestinations: topCounts(activeLikePackages.map((p) => p.destination)),
    topScoreGroups: topCounts(scores.map((s) => s.group_key)),
    examples: {
      missingScore: missingScoreExamples,
      weakScore: weakScoreExamples,
    },
    generatedAt: new Date().toISOString(),
  });
};

export const GET = withAdminGuard(getHandler);
