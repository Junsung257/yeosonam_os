'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase';

export interface RealtimeListOptions<T> {
  table: string;
  schema?: string;
  filter?: string; // 예: 'booking_id=eq.<uuid>'
  events?: Array<'INSERT' | 'UPDATE' | 'DELETE'>;
  getId: (row: T) => string;
  /** upstream payload → UI 행. 다른 필드명이나 조인이 필요할 때 사용 */
  transform?: (raw: any) => T | null;
  /** 신규 INSERT 를 상단에 두려면 true, 하단은 false. 기본 true */
  prepend?: boolean;
}

/**
 * 공통 Realtime 리스트 훅.
 * - SSR 초기 데이터 + 브라우저 Realtime 이벤트를 id 기반 dedup 머지
 * - 탭 비활성화 시 자동 unsubscribe 로 배터리 절약
 */
export function useRealtimeList<T>(
  initialData: T[],
  opts: RealtimeListOptions<T>,
) {
  const [items, setItems] = useState<T[]>(initialData);
  const {
    table,
    schema = 'public',
    filter,
    events = ['INSERT', 'UPDATE', 'DELETE'],
    getId,
    transform,
    prepend = true,
  } = opts;

  // initialData 가 바뀌면 리셋 (tab 변경 등)
  useEffect(() => {
    setItems(initialData);
  }, [initialData]);

  const applyUpsert = useCallback(
    (row: T) => {
      setItems(prev => {
        const id = getId(row);
        const next = prev.filter(r => getId(r) !== id);
        return prepend ? [row, ...next] : [...next, row];
      });
    },
    [getId, prepend],
  );

  const applyDelete = useCallback(
    (id: string) => {
      setItems(prev => prev.filter(r => getId(r) !== id));
    },
    [getId],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channelName = `realtime:${table}:${filter ?? 'all'}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    let channel = supabase.channel(channelName);
    for (const evt of events) {
      channel = channel.on(
        'postgres_changes' as any,
        { event: evt, schema, table, ...(filter ? { filter } : {}) },
        (payload: any) => {
          if (evt === 'DELETE') {
            const oldRow = payload.old ?? {};
            const id = oldRow.id as string | undefined;
            if (id) applyDelete(id);
            return;
          }
          const raw = payload.new ?? {};
          const row = transform ? transform(raw) : (raw as T);
          if (row) applyUpsert(row);
        },
      );
    }
    channel.subscribe();

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        supabase!.removeChannel(channel);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, schema, filter, events.join(','), applyDelete, applyUpsert, transform]);

  return items;
}
