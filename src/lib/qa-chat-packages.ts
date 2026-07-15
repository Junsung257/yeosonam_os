import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { extractQaDestinationHint } from '@/lib/qa-destination-hint';
import { getTopRecommendedPackages } from '@/lib/scoring/top-recommended';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import { getPublishedPackageCards } from '@/lib/public-packages';

/** QA 컨텍스트에 필요한 컬럼만 — `select *` 대비 페이로드·파싱 비용 절감 */
const QA_PACKAGE_SELECT =
  'id,destination,status,publication_state,package_revision,audit_status,audit_report,updated_at,optional_tours,itinerary_data';

type CacheEntry = { t: number; rows: Record<string, unknown>[] };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 90_000;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function isQaPublicSnapshotCandidate(row: Record<string, unknown>): boolean {
  const publicationState = asString(row.publication_state);
  return isPublicPublicationState(publicationState) && isCustomerPubliclyOpenable(row);
}

function toQaCustomerPackageRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows
    .map((row) => ({
      id: asString(row.id),
      title: asString(row.title) ?? asString(row.display_title),
      destination: asString(row.destination),
      duration: asNumber(row.duration),
      nights: asNumber(row.nights),
      price: asNumber(row.price),
      product_summary: asString(row.product_summary) ?? asString(row.summary),
      product_highlights: asStringArray(row.product_highlights),
      inclusions: asStringArray(row.inclusions),
      excludes: asStringArray(row.excludes),
      itinerary: asStringArray(row.itinerary),
      _public_snapshot: row._public_snapshot ?? null,
    }))
    .filter((row) => typeof row.id === 'string' && row.id.length > 0 && typeof row.title === 'string' && row.title.length > 0);
}

async function mergeQaPublicSnapshots(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const candidates = rows.filter(isQaPublicSnapshotCandidate);
  if (candidates.length === 0) return [];
  const merged = await getPublishedPackageCards(supabaseAdmin, candidates);
  return toQaCustomerPackageRows(merged);
}

function fresh(entry: CacheEntry | undefined, now: number): boolean {
  return Boolean(entry && now - entry.t < TTL_MS);
}

async function fetchApprovedPackagesFiltered(destinationHint: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select(QA_PACKAGE_SELECT)
    .eq('status', 'approved')
    .in('publication_state', ['approved', 'published'])
    .ilike('destination', `%${destinationHint}%`)
    .order('created_at', { ascending: false })
    .limit(120);

  if (error) throw error;
  const publicRows = await mergeQaPublicSnapshots((data || []) as Record<string, unknown>[]);
  return rankQaPackagesForHint(publicRows, destinationHint);
}

async function fetchApprovedPackagesAll(): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select(QA_PACKAGE_SELECT)
    .eq('status', 'approved')
    .in('publication_state', ['approved', 'published'])
    .order('created_at', { ascending: false })
    .limit(150);

  if (error) throw error;
  return mergeQaPublicSnapshots((data || []) as Record<string, unknown>[]);
}

async function rankQaPackagesForHint(
  rows: Record<string, unknown>[],
  destinationHint: string,
): Promise<Record<string, unknown>[]> {
  if (rows.length <= 1) return rows;
  try {
    const ranked = await getTopRecommendedPackages({
      destination: destinationHint,
      limit: rows.length,
      minGroupSize: 1,
      maxRank: rows.length,
    });
    const rankMap = new Map(ranked.map((r, index) => [r.package_id, index]));
    return [...rows].sort((a, b) => {
      const ar = rankMap.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER;
      const br = rankMap.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return 0;
    });
  } catch (e) {
    console.warn('[qa-chat-packages] package_scores ranking fallback:', e);
    return rows;
  }
}

/**
 * 고객 QA(/api/qa/chat)용 승인 상품 목록.
 * - `hintSource`: 현재 메시지(+선택 이전 고객 발화)를 합친 문자열 → 목적지 키워드 있으면 DB 선필터.
 * - 필터 결과 0건이면 전체 목록으로 폴백 (오탐·DB 표기 불일치 방지).
 * - 키별 TTL 캐시로 연속 채팅 부하 완화.
 */
export async function getQaChatPackageContext(hintSource?: string): Promise<Record<string, unknown>[]> {
  if (!isSupabaseConfigured) return [];
  const now = Date.now();
  const hint = hintSource?.trim() ? extractQaDestinationHint(hintSource) : null;

  if (hint) {
    const key = `d:${hint}`;
    const hit = cache.get(key);
    if (fresh(hit, now)) return hit!.rows;

    try {
      const filtered = await fetchApprovedPackagesFiltered(hint);
      cache.set(key, { t: now, rows: filtered });
      return filtered;
    } catch (e) {
      console.error('[qa-chat-packages] 목적지 필터 조회 실패:', e);
      const stale = cache.get(key);
      if (stale?.rows.length) return stale.rows;
    }
  }

  const allKey = 'all';
  const hitAll = cache.get(allKey);
  if (fresh(hitAll, now)) return hitAll!.rows;

  try {
    const rows = await fetchApprovedPackagesAll();
    cache.set(allKey, { t: now, rows });
    return rows;
  } catch (e) {
    console.error('[qa-chat-packages] 전체 조회 실패:', e);
    return hitAll?.rows ?? [];
  }
}

/** 상품 승인 직후 등에서 캐시를 비우고 싶을 때 호출 (선택) */
export function invalidateQaChatPackageCache(): void {
  cache.clear();
}
