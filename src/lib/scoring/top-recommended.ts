/**
 * 점수 시스템에서 "광고/콘텐츠 자동화에 우선 노출할 패키지" 선정 (v3.8, 2026-04-30).
 *
 * 사용처:
 *   - content_pipeline orchestrator: 어느 패키지를 자동 발행할지
 *   - meta-ads / google-ads: 어느 패키지를 우선 광고할지
 *   - card-news 자동 발행 cron: 어느 패키지를 시즌 카드뉴스로
 *
 * 정책: 그룹 1위 + 그룹 사이즈 ≥ 2 (비교 풀 있는 검증된 패키지) + 가장 가까운 미래 출발.
 *
 * 사장님 비즈니스 효과:
 *   "1위 패키지를 가장 많이 광고" → 광고 클릭 → 실제 전환 ↑
 *   "랜덤 패키지 광고" → 떨어지는 패키지 광고비 낭비 ↓
 */
import { supabaseAdmin } from '@/lib/supabase';

export interface TopPackage {
  package_id: string;
  destination: string;
  group_key: string;
  departure_date: string | null;
  rank_in_group: number;
  group_size: number;
  effective_price: number;
  list_price: number | null;
  topsis_score: number | null;
}

export interface TopOptions {
  /** 결과 개수 (기본 20) */
  limit?: number;
  /** 그룹사이즈 최소 (기본 2 — solo 그룹은 검증 미흡) */
  minGroupSize?: number;
  /** 최대 순위 (기본 1 — 1위만. 3 면 1~3위 모두) */
  maxRank?: number;
  /** destination 필터 */
  destination?: string;
  /** 출발일 from~to */
  departureFrom?: string;
  departureTo?: string;
  /** 같은 패키지 중복 제거 (다른 출발일이라도 1번만) — 기본 true */
  dedupePackage?: boolean;
}

export async function getTopRecommendedPackages(opts: TopOptions = {}): Promise<TopPackage[]> {
  const {
    limit = 20,
    minGroupSize = 2,
    maxRank = 1,
    destination,
    departureFrom,
    departureTo,
    dedupePackage = true,
  } = opts;

  const today = new Date().toISOString().slice(0, 10);
  let q = supabaseAdmin
    .from('package_scores')
    .select('package_id, group_key, departure_date, rank_in_group, group_size, effective_price, list_price, topsis_score, travel_packages!inner(destination, status)')
    .gte('group_size', minGroupSize)
    .lte('rank_in_group', maxRank)
    .gte('departure_date', departureFrom ?? today)
    .order('departure_date', { ascending: true })
    .order('rank_in_group', { ascending: true })
    .order('topsis_score', { ascending: false })
    .limit(limit * 5); // dedupe 여유분

  if (destination) q = q.ilike('travel_packages.destination', `%${destination}%`);
  if (departureTo) q = q.lte('departure_date', departureTo);

  const { data, error } = await q;
  if (error) throw new Error(`getTopRecommendedPackages 실패: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<TopPackage & {
    travel_packages: { destination: string; status: string } | { destination: string; status: string }[];
  }>;

  // active/approved만
  const active = rows.filter(r => {
    const tp = Array.isArray(r.travel_packages) ? r.travel_packages[0] : r.travel_packages;
    return tp && (tp.status === 'active' || tp.status === 'approved');
  });

  const seen = new Set<string>();
  const out: TopPackage[] = [];
  for (const r of active) {
    const tp = Array.isArray(r.travel_packages) ? r.travel_packages[0] : r.travel_packages;
    if (dedupePackage && seen.has(r.package_id)) continue;
    seen.add(r.package_id);
    out.push({
      package_id: r.package_id,
      destination: tp?.destination ?? '',
      group_key: r.group_key,
      departure_date: r.departure_date,
      rank_in_group: r.rank_in_group,
      group_size: r.group_size,
      effective_price: Number(r.effective_price) || 0,
      list_price: r.list_price ?? null,
      topsis_score: r.topsis_score ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** destination별 최고 패키지 1개씩 (광고 캠페인용) */
export async function getTopByDestination(opts: { limit?: number; minGroupSize?: number } = {}): Promise<TopPackage[]> {
  const all = await getTopRecommendedPackages({
    limit: 200,
    minGroupSize: opts.minGroupSize ?? 2,
    maxRank: 1,
    dedupePackage: false,
  });
  // destination별 1개씩
  const byDest = new Map<string, TopPackage>();
  for (const p of all) {
    if (!byDest.has(p.destination)) byDest.set(p.destination, p);
  }
  return [...byDest.values()].slice(0, opts.limit ?? 20);
}
