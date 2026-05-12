/**
 * Message Log — 고객 여정 타임라인 (예약 단계별 알림 기록)
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27 단계 1).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 */

import { getSupabase } from '../supabase';

export interface MessageLog {
  id: string;
  booking_id: string;
  log_type: 'system' | 'kakao' | 'mock' | 'scheduler' | 'manual';
  event_type: string;
  title: string;
  content?: string | null;
  is_mock: boolean;
  created_by: string;
  created_at: string;
}

export async function getMessageLogs(bookingId: string): Promise<MessageLog[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('message_logs')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });
  if (error) {
    // message_logs 테이블 미생성 시 조용히 빈 배열 반환 (PGRST205 방어)
    console.warn('[message_logs] 조회 실패 (테이블 없음 가능성):', error.message);
    return [];
  }
  return (data ?? []) as MessageLog[];
}

export async function createMessageLog(data: {
  booking_id: string;
  log_type: 'system' | 'kakao' | 'mock' | 'scheduler' | 'manual';
  event_type: string;
  title: string;
  content?: string;
  is_mock?: boolean;
  created_by?: string;
}): Promise<MessageLog | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('message_logs')
    .insert({
      booking_id: data.booking_id,
      log_type:   data.log_type,
      event_type: data.event_type,
      title:      data.title,
      content:    data.content ?? null,
      is_mock:    data.is_mock ?? false,
      created_by: data.created_by ?? 'system',
    } as never)
    .select()
    .single();
  if (error) {
    // message_logs 테이블 미생성 시 null 반환 (앱 중단 없음)
    console.warn('[message_logs] 생성 실패 (테이블 없음 가능성):', error.message);
    return null;
  }
  return row as MessageLog;
}
