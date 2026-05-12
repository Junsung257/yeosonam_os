import { supabaseAdmin } from '@/lib/supabase';
import type {
  PackageFeatures, ScoreBreakdown, ScoringPolicy,
} from './types';
import { getActivePolicy } from './policy';
import {
  extractPackageFeatures,
  pickPackageRepresentativeDate,
  type RawPackageRow,
} from './extract-features';
import { loadMrtHotelQualityMap } from '@/lib/mrt-hotel-intel';
import { computeEffectivePrice, type EffectivePriceResult } from './effective-price';
import { topsis, type CriterionType } from './topsis';
import { loadBrandEntries, type HotelBrandEntry } from './hotel-brands';

export interface RecommendBestInput {
  destination: string;
  departure_date?: string | null;
  departure_window_days?: number;
  duration_days?: number | null;
  limit?: number;
  policy?: ScoringPolicy;
}

export interface RankedPackage {
  package_id: string;
  title: string;
  destination: string;
  departure_date: string | null;
  duration_days: number;
  list_price: number;
  effective_price: number;
  topsis_score: number;
  rank: number;
  features: PackageFeatures;
  breakdown: ScoreBreakdown;
}

export interface RecommendBestResult {
  group_key: string;
  group_size: number;
  policy_version: string;
  ranked: RankedPackage[];
}

// 실 스키마 (2026-04-29 schema drift fix): price · duration · price_dates
const PACKAGE_SELECT_COLS =
  'id, title, destination, price, price_dates, duration, status, itinerary_data, land_operator_id, created_at';

// v3.2 (2026-04-30): TOPSIS 10 criteria (기존 6 + P1 4개)
const TOPSIS_CRITERIA: CriterionType[] = [
  'cost',     // effective_price
  'benefit',  // hotel_avg_grade
  'benefit',  // meal_count
  'benefit',  // free_option_count
  'benefit',  // -shopping_count
  'benefit',  // reliability
  'benefit',  // climate_fit (계절 적합도)
  'benefit',  // popularity (한국인 인기도)
  'benefit',  // korean_meal_count
  'benefit',  // free_time_ratio
];

/** 일정 등급 + MRT(리뷰·상대가격) 블렌딩 — 동일 등급 호텔 간 미세 구분 */
function blendedHotelBenefit(f: PackageFeatures): number {
  const label = f.hotel_avg_grade ?? 3.0;
  const m = f.mrt_hotel_quality_score;
  if (m == null || Number.isNaN(m)) return label;
  const mrtPart = 2 + (m / 100) * 3;
  return 0.5 * label + 0.5 * mrtPart;
}

function buildMatrixRow(f: PackageFeatures, ep: EffectivePriceResult): number[] {
  return [
    ep.effective_price,
    blendedHotelBenefit(f),
    f.meal_count,
    f.free_option_count,
    -f.shopping_count,         // benefit (적을수록 +)
    f.reliability_score,
    f.climate_score / 100,     // 0-1 정규화
    f.popularity_score / 100,  // 0-1 정규화
    f.korean_meal_count,
    f.free_time_ratio,         // 0-1
  ];
}

function policyWeights(policy: ScoringPolicy): number[] {
  const w = policy.weights;
  // P1 axis는 정책에 없으면 0 (기존 정책은 base 6만 사용)
  return [
    w.price, w.hotel, w.meal, w.free_options, w.shopping_avoidance, w.reliability,
    w.climate_fit ?? 0, w.popularity ?? 0, w.korean_meal ?? 0, w.free_time ?? 0,
  ];
}

/** destination별 12개월 climate score / popularity score 캐시. P1 통합. */
async function loadDestinationSignals(destinations: string[]): Promise<Map<string, {
  fitness: Array<{ month: number; score: number }>;
  popularity: Array<{ month: number; popularity_score: number }>;
}>> {
  const map = new Map();
  if (destinations.length === 0) return map;
  const { data } = await supabaseAdmin
    .from('destination_climate')
    .select('destination, fitness_scores, seasonal_signals')
    .in('destination', destinations);
  for (const row of data ?? []) {
    const r = row as {
      destination: string;
      fitness_scores: Array<{ month: number; score: number }> | null;
      seasonal_signals: Array<{ month: number; popularity_score: number }> | null;
    };
    map.set(r.destination, {
      fitness: r.fitness_scores ?? [],
      popularity: r.seasonal_signals ?? [],
    });
  }
  return map;
}

/** 출발일 → 월 → climate/popularity 점수 lookup */
function lookupMonthSignal(
  signals: Map<string, { fitness: Array<{ month: number; score: number }>; popularity: Array<{ month: number; popularity_score: number }> }>,
  destination: string,
  date: string,
): { climate_score: number; popularity_score: number } {
  const sig = signals.get(destination);
  if (!sig) return { climate_score: 50, popularity_score: 50 };
  const month = Number(date.slice(5, 7));
  const fit = sig.fitness.find(f => Number(f.month) === month);
  const pop = sig.popularity.find(p => Number(p.month) === month);
  return {
    climate_score: fit ? Number(fit.score) : 50,
    popularity_score: pop ? Number(pop.popularity_score) : 50,
  };
}

async function loadReliabilityMap(operatorIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (operatorIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from('land_operators')
    .select('id, reliability_score')
    .in('id', operatorIds);
  if (error) return map; // 안전 폴백: 빈 map → default 0.7 사용
  for (const row of data ?? []) {
    const v = (row as { id: string; reliability_score: number | null }).reliability_score;
    map.set((row as { id: string }).id, typeof v === 'number' ? v : 0.7);
  }
  return map;
}

function isoDateAdd(iso: string, deltaDays: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * 같은 (목적지+출발일±window) 그룹 내 패키지를 점수 산출 후 랭킹 반환.
 * 자비스 도구 / 외부 API 둘 다 사용.
 */
export async function recommendBestPackages(
  input: RecommendBestInput,
): Promise<RecommendBestResult> {
  const policy = input.policy ?? await getActivePolicy();
  const window = input.departure_window_days
    ?? policy.fallback_rules?.departure_window_days ?? 3;

  // 1) 후보 조회 — status='approved'|'active' 가 노출 조건 (실 스키마)
  let q = supabaseAdmin
    .from('travel_packages')
    .select(PACKAGE_SELECT_COLS)
    .ilike('destination', `%${input.destination}%`)
    .in('status', ['approved', 'active'])
    .limit(100);

  // departure_date 컬럼 제거 — price_dates jsonb 내부에서 처리. 그룹 키도 destination + duration 으로 변경
  if (input.duration_days) q = q.eq('duration', input.duration_days);

  const { data, error } = await q;
  if (error) throw new Error(`패키지 조회 실패: ${error.message}`);
  const candidates = (data ?? []) as RawPackageRow[] & { title: string }[];

  // 그룹 키: destination + duration (출발일 컬럼 없음 — price_dates 의 dates는 제각각)
  const groupKey = `${input.destination}|d${input.duration_days ?? '*'}`;
  if (candidates.length === 0) {
    return { group_key: groupKey, group_size: 0, policy_version: policy.version, ranked: [] };
  }

  // 2) Feature + effective price (+ reliability map + brand entries)
  const operatorIds = Array.from(new Set(
    candidates.map(c => c.land_operator_id).filter((v): v is string => !!v),
  ));
  const [reliabilityMap, brandEntries] = await Promise.all([
    loadReliabilityMap(operatorIds),
    loadBrandEntries().catch((): HotelBrandEntry[] => []),
  ]);
  const mrtKeys = candidates.map(c => ({
    packageId: c.id,
    departureDate: pickPackageRepresentativeDate(c.price_dates),
  }));
  const mrtQualityMap = await loadMrtHotelQualityMap(mrtKeys);
  const features = candidates.map(c => {
    const f = extractPackageFeatures(c, reliabilityMap);
    const k = `${c.id}|${f.departure_date ?? '_'}`;
    const mq = mrtQualityMap.get(k);
    return { ...f, mrt_hotel_quality_score: mq ?? null };
  });
  const eps = features.map(f => computeEffectivePrice(f, policy, brandEntries));

  // 3) TOPSIS
  const matrix = features.map((f, i) => buildMatrixRow(f, eps[i]));
  const { scores, ranks } = topsis({
    matrix,
    weights: policyWeights(policy),
    types: TOPSIS_CRITERIA,
  });

  // 4) 결과
  const ranked: RankedPackage[] = candidates.map((c, i) => {
    const breakdown: ScoreBreakdown = {
      list_price: features[i].list_price,
      effective_price: eps[i].effective_price,
      deductions: eps[i].deductions,
      topsis_score: scores[i],
      rank_in_group: ranks[i],
      group_size: candidates.length,
      why: eps[i].why,
      mrt_hotel_quality_score: features[i].mrt_hotel_quality_score ?? null,
    };
    return {
      package_id: c.id,
      title: (c as unknown as { title: string }).title,
      destination: c.destination,
      departure_date: (c as unknown as { departure_date?: string | null }).departure_date ?? null,
      duration_days: features[i].duration_days,
      list_price: features[i].list_price,
      effective_price: eps[i].effective_price,
      topsis_score: scores[i],
      rank: ranks[i],
      features: features[i],
      breakdown,
    };
  });
  ranked.sort((a, b) => a.rank - b.rank);

  const limit = input.limit ?? 5;
  return {
    group_key: groupKey,
    group_size: candidates.length,
    policy_version: policy.version,
    ranked: ranked.slice(0, limit),
  };
}

/**
 * 전체 active 패키지를 그룹별로 묶어 점수 캐시 갱신 (cron 매일 새벽).
 * 기존 캐시는 정책 단위로 삭제 후 재삽입.
 */
export async function recomputeAllScores(): Promise<{
  groups: number;
  packages: number;
  policy_id: string;
  policy_version: string;
}> {
  const policy = await getActivePolicy(true);

  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select(PACKAGE_SELECT_COLS)
    .in('status', ['approved', 'active']);
  if (error) throw new Error(`전체 조회 실패: ${error.message}`);
  const all = ((data ?? []) as unknown as Array<RawPackageRow & { title: string }>);

  // ── v3 (2026-04-29): 출발일 펼치기 → 정확 같은 날 그룹 (옵션 A) ───
  // 한 패키지의 N개 price_dates 각각이 별도 점수 단위.
  const today = new Date().toISOString().slice(0, 10);
  type Expanded = (RawPackageRow & { title: string }) & { _date: string; _price: number };
  const expanded: Expanded[] = [];
  for (const p of all) {
    if (!p.destination) continue;
    const dates = Array.isArray(p.price_dates) ? p.price_dates : [];
    for (const d of dates) {
      if (!d?.date || d.date < today) continue;
      const price = typeof d.price === 'number' && d.price > 0 ? d.price : (p.price ?? 0);
      expanded.push({ ...p, _date: d.date, _price: price });
    }
  }

  const groups = new Map<string, Expanded[]>();
  for (const e of expanded) {
    // 정확 같은 날 + 같은 destination 그룹
    const key = `${e.destination}|${e._date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const mrtQualityGlobal = await loadMrtHotelQualityMap(
    expanded.map(p => ({ packageId: p.id, departureDate: p._date })),
  );

  // 기존 캐시 삭제 (정책 단위)
  const { error: delErr } = await supabaseAdmin
    .from('package_scores').delete().eq('policy_id', policy.id);
  if (delErr) throw new Error(`기존 score 캐시 삭제 실패: ${delErr.message}`);

  // 신뢰도 + 브랜드 캐시 — 전체 한 번만 로드
  const allOperatorIds = Array.from(new Set(
    all.map(p => p.land_operator_id).filter((v): v is string => !!v),
  ));
  const [reliabilityMap, brandEntries] = await Promise.all([
    loadReliabilityMap(allOperatorIds),
    loadBrandEntries().catch((): HotelBrandEntry[] => []),
  ]);

  // v3 P1: destination별 climate / popularity 캐시 (전체 한 번 로드)
  const allDestinations = Array.from(new Set(all.map(p => p.destination).filter(Boolean)));
  const destSignals = await loadDestinationSignals(allDestinations);

  let pkgCount = 0;
  let scoreRows: Record<string, unknown>[] = [];
  for (const [groupKey, items] of groups.entries()) {
    if (items.length === 0) continue;
    // 그룹 사이즈 1 (solo) — score 계산은 하되 노출 측에서 필터
    const features = items.map(p => {
      const sig = lookupMonthSignal(destSignals, p.destination, p._date);
      const enrichedPkg: RawPackageRow = { ...p, climate_score: sig.climate_score, popularity_score: sig.popularity_score };
      const f = extractPackageFeatures(enrichedPkg, reliabilityMap, p._date);
      const mq = mrtQualityGlobal.get(`${p.id}|${p._date}`);
      return { ...f, mrt_hotel_quality_score: mq ?? null };
    });
    const eps = features.map(f => computeEffectivePrice(f, policy, brandEntries));
    const matrix = features.map((f, i) => buildMatrixRow(f, eps[i]));
    const { scores, ranks } = items.length >= 2
      ? topsis({ matrix, weights: policyWeights(policy), types: TOPSIS_CRITERIA })
      : { scores: [1.0], ranks: [1] }; // solo는 1위 1.0 점

    items.forEach((p, i) => {
      scoreRows.push({
        package_id: p.id,
        policy_id: policy.id,
        group_key: groupKey,
        departure_date: p._date,
        list_price: features[i].list_price,
        effective_price: eps[i].effective_price,
        topsis_score: scores[i],
        rank_in_group: ranks[i],
        group_size: items.length,
        shopping_count: features[i].shopping_count,
        hotel_avg_grade: features[i].hotel_avg_grade,
        meal_count: features[i].meal_count,
        free_option_count: features[i].free_option_count,
        is_direct_flight: features[i].is_direct_flight,
        duration_days: features[i].duration_days,
        breakdown: {
          list_price: features[i].list_price,
          deductions: eps[i].deductions,
          why: eps[i].why,
          mrt_hotel_quality_score: features[i].mrt_hotel_quality_score ?? null,
        },
      });
    });
    pkgCount += items.length;

    if (scoreRows.length >= 1000) {
      const { error: e1 } = await supabaseAdmin.from('package_scores').insert(scoreRows);
      if (e1) console.error('[scoring] package_scores insert 실패:', e1.message);
      scoreRows = [];
    }
  }
  if (scoreRows.length > 0) {
    const { error: e1 } = await supabaseAdmin.from('package_scores').insert(scoreRows);
    if (e1) console.error('[scoring] package_scores tail insert 실패:', e1.message);
  }

  // history 스냅샷은 cron route 가 별도 호출 (snapshotScoreHistory)

  return {
    groups: groups.size,
    packages: pkgCount,
    policy_id: policy.id,
    policy_version: policy.version,
  };
}

/**
 * 현재 package_scores 전체를 history로 복사 — 매일 1회 cron 후 호출.
 * 10년 시계열 자산화 + LTR 학습 데이터 + 정책 A/B 비교용.
 */
export async function snapshotScoreHistory(): Promise<{ inserted: number }> {
  const policy = await getActivePolicy();
  const today = new Date().toISOString().slice(0, 10);

  // 같은 snapshot_date 의 기존 row 제거 (cron 이중 호출 보호)
  await supabaseAdmin.from('package_score_history')
    .delete().eq('snapshot_date', today).eq('policy_id', policy.id);

  // 페이지네이션으로 전량 복사 (Supabase default limit 1000)
  let total = 0;
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('package_scores')
      .select('package_id, policy_id, group_key, departure_date, list_price, effective_price, topsis_score, rank_in_group, group_size, shopping_count, hotel_avg_grade, free_option_count, is_direct_flight, breakdown')
      .eq('policy_id', policy.id)
      .order('group_key')
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('[snapshot] select 실패:', error.message); break; }
    if (!data || data.length === 0) break;

    const rows = data.map((r: Record<string, unknown>) => ({ ...r, snapshot_date: today, policy_version: policy.version }));
    const { error: insErr } = await supabaseAdmin.from('package_score_history').insert(rows);
    if (insErr) { console.error('[snapshot] insert 실패:', insErr.message); break; }
    total += rows.length;
    if (data.length < PAGE) break;
  }

  return { inserted: total };
}

/**
 * 그룹 단위 즉시 재계산 — 패키지 등록 직후 호출용.
 * recomputeAllScores 대신 이 그룹만 처리해서 1~2초 안에 끝남.
 */
export async function recomputeGroupScores(
  destination: string,
  departureDate?: string | null,
): Promise<{
  group_key: string;
  group_size: number;
  packages_inserted: number;
  policy_version: string;
}> {
  const policy = await getActivePolicy();
  const result = await recommendBestPackages({
    destination,
    departure_date: departureDate ?? undefined,
    limit: 1000,
    policy,
  });

  if (result.ranked.length === 0) {
    return {
      group_key: result.group_key,
      group_size: 0,
      packages_inserted: 0,
      policy_version: policy.version,
    };
  }

  // 해당 그룹 캐시 DELETE + 새 점수 INSERT
  await supabaseAdmin.from('package_scores').delete()
    .eq('policy_id', policy.id).eq('group_key', result.group_key);

  const rows = result.ranked.map(r => ({
    package_id: r.package_id,
    policy_id: policy.id,
    group_key: result.group_key,
    departure_date: r.features.departure_date,
    list_price: r.list_price,
    effective_price: r.effective_price,
    topsis_score: r.topsis_score,
    rank_in_group: r.rank,
    group_size: result.group_size,
    breakdown: {
      list_price: r.list_price,
      deductions: r.breakdown.deductions,
      why: r.breakdown.why,
      mrt_hotel_quality_score: r.features.mrt_hotel_quality_score ?? null,
    },
    shopping_count: r.features.shopping_count,
    hotel_avg_grade: r.features.hotel_avg_grade,
    meal_count: r.features.meal_count,
    free_option_count: r.features.free_option_count,
    is_direct_flight: r.features.is_direct_flight,
    duration_days: r.features.duration_days,
  }));

  const { error } = await supabaseAdmin.from('package_scores').insert(rows);
  if (error) throw new Error(`그룹 점수 INSERT 실패: ${error.message}`);

  return {
    group_key: result.group_key,
    group_size: result.group_size,
    packages_inserted: rows.length,
    policy_version: policy.version,
  };
}

/**
 * 패키지 ID로 자동 그룹 추론 후 재계산 — /register 후에 패키지 ID만 알면 동작.
 */
export async function recomputeGroupForPackage(packageId: string): Promise<{
  group_key: string;
  group_size: number;
  packages_inserted: number;
  policy_version: string;
}> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('destination, departure_date')
    .eq('id', packageId).limit(1);
  if (error) throw new Error(`패키지 조회 실패: ${error.message}`);
  const pkg = data?.[0];
  if (!pkg) throw new Error(`패키지 ${packageId} 없음`);
  return recomputeGroupScores(pkg.destination, pkg.departure_date);
}
