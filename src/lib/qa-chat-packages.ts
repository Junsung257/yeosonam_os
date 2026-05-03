import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { extractQaDestinationHint } from '@/lib/qa-destination-hint';

/** QA 컨텍스트에 필요한 컬럼만 — `select *` 대비 페이로드·파싱 비용 절감 */
const QA_PACKAGE_SELECT =
  'id,title,destination,duration,nights,price,price_tiers,inclusions,excludes,itinerary,raw_text';

type CacheEntry = { t: number; rows: Record<string, unknown>[] };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 90_000;

function fresh(entry: CacheEntry | undefined, now: number): boolean {
  return Boolean(entry && now - entry.t < TTL_MS);
}

async function fetchApprovedPackagesFiltered(destinationHint: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select(QA_PACKAGE_SELECT)
    .eq('status', 'approved')
    .or('audit_status.is.null,audit_status.neq.blocked')
    .ilike('destination', `%${destinationHint}%`)
    .order('created_at', { ascending: false })
    .limit(120);

  if (error) throw error;
  return (data || []) as Record<string, unknown>[];
}

async function fetchApprovedPackagesAll(): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select(QA_PACKAGE_SELECT)
    .eq('status', 'approved')
    .or('audit_status.is.null,audit_status.neq.blocked')
    .order('created_at', { ascending: false })
    .limit(150);

  if (error) throw error;
  return (data || []) as Record<string, unknown>[];
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
      if (filtered.length > 0) {
        cache.set(key, { t: now, rows: filtered });
        return filtered;
      }
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
