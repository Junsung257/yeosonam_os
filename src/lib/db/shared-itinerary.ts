/**
 * SharedItinerary — 공유 일정 (DYNAMIC: 컨시어지 카트 / FIXED: 패키지)
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27 단계 1).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 *
 * CartItem 의존: ./concierge.ts 에서 type-only import.
 */

import type { CartItem } from './concierge';
import { getSupabase } from '../supabase';

export interface SharedItinerary {
  id:            string;
  share_code:    string;
  share_type:    'DYNAMIC' | 'FIXED';
  // DYNAMIC
  items?:        CartItem[];
  search_query?: string;
  // FIXED
  product_id?:   string;
  product_name?: string;
  review_text?:  string;
  // 공통
  creator_name:  string;
  view_count:    number;
  expires_at:    string;
  created_at:    string;
}

function generateShareCode(): string {
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return part() + part();
}

export async function createSharedItinerary(
  data: Omit<SharedItinerary, 'id' | 'share_code' | 'view_count' | 'created_at' | 'expires_at'>
): Promise<SharedItinerary | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const share_code = generateShareCode();
  const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: row, error } = await sb
    .from('shared_itineraries')
    .insert([{ ...data, share_code, expires_at }] as never)
    .select()
    .single();
  if (error) { console.error('공유 일정 생성 실패:', error); return null; }
  return row as SharedItinerary;
}

export async function getSharedItinerary(code: string): Promise<SharedItinerary | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row } = await sb
    .from('shared_itineraries')
    .select('*')
    .eq('share_code', code)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (!row) return null;
  // view_count 증가 (fire-and-forget)
  sb.from('shared_itineraries')
    .update({ view_count: (row as SharedItinerary).view_count + 1 } as never)
    .eq('share_code', code)
    .then(() => {});
  return row as SharedItinerary;
}
