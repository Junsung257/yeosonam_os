/**
 * User Actions — 행동 기반 추적 및 추천
 *
 * user_actions 테이블에 고객 행동(상품 조회/찜/문의)을 기록하고
 * 최근 본 상품, 비슷한 상품 등을 조회합니다.
 */
import { supabaseAdmin } from '@/lib/supabase';

export type UserActionType =
  | 'page_view'
  | 'package_view'
  | 'package_wish'
  | 'package_inquiry'
  | 'search';

export interface TrackUserActionInput {
  customerId?: string | null;
  sessionId?: string | null;
  actionType: UserActionType;
  targetId?: string | null;
  context?: Record<string, unknown>;
}

export interface UserActionRow {
  id: string;
  customer_id: string | null;
  session_id: string | null;
  action_type: string;
  target_id: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

/**
 * user_actions 테이블에 행동 기록
 */
export async function trackUserAction(input: TrackUserActionInput): Promise<void> {
  if (!input.customerId && !input.sessionId) return; // 둘 다 없으면 기록 불가

  const { error } = await supabaseAdmin.from('user_actions').insert({
    customer_id: input.customerId ?? null,
    session_id: input.sessionId ?? null,
    action_type: input.actionType,
    target_id: input.targetId ?? null,
    context: input.context ?? null,
  });

  if (error) {
    console.error('[user-actions] trackUserAction failed:', error.message);
  }
}

/**
 * 최근 본 패키지 ID 목록 (중복 제거, 최신순)
 */
export async function getRecentViews(
  options: {
    customerId?: string | null;
    sessionId?: string | null;
    limit?: number;
  },
): Promise<string[]> {
  const { customerId, sessionId, limit = 10 } = options;

  if (!customerId && !sessionId) return [];

  let query = supabaseAdmin
    .from('user_actions')
    .select('target_id, created_at')
    .eq('action_type', 'package_view')
    .not('target_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (customerId) {
    query = query.eq('customer_id', customerId);
  } else if (sessionId) {
    query = query.eq('session_id', sessionId);
  }

  const { data, error } = await query;

  if (error || !data) {
    console.error('[user-actions] getRecentViews failed:', error?.message);
    return [];
  }

  // 중복 제거 (최신순)
  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of data) {
    const tid = row.target_id!;
    if (!seen.has(tid)) {
      seen.add(tid);
      result.push(tid);
      if (result.length >= limit) break;
    }
  }
  return result;
}

/**
 * 같은 destination + category의 유사 패키지 조회
 */
export async function getSimilarPackages(
  packageId: string,
  options?: { limit?: number },
): Promise<Array<{ id: string; title: string; destination: string; price: number }>> {
  const limit = options?.limit ?? 6;

  // 먼저 해당 패키지의 destination/category 조회
  const { data: pkg, error: pkgErr } = await supabaseAdmin
    .from('travel_packages')
    .select('destination, category, id')
    .eq('id', packageId)
    .single();

  if (pkgErr || !pkg) return [];

  const { data: similar, error: simErr } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, price')
    .in('status', ['active', 'approved'])
    .neq('id', packageId)
    .eq('destination', pkg.destination)
    .limit(limit);

  if (simErr || !similar) {
    // fallback: category로 검색
    if (pkg.category) {
      const { data: catSimilar } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, price')
        .in('status', ['active', 'approved'])
        .neq('id', packageId)
        .eq('category', pkg.category)
        .limit(limit);
      return (catSimilar ?? []) as Array<{ id: string; title: string; destination: string; price: number }>;
    }
    return [];
  }

  return similar as Array<{ id: string; title: string; destination: string; price: number }>;
}
