'use client';

import { useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase';

interface Opts {
  table: string;
  schema?: string;
  filter?: string;
  events?: Array<'INSERT' | 'UPDATE' | 'DELETE'>;
  onChange: () => void;
  /** 연속 이벤트 디바운스 (ms) */
  debounceMs?: number;
}

/**
 * 단순한 Realtime 구독 훅 — 이벤트 수신 시 onChange 콜백 1회 호출.
 * 서버 컴포넌트 기반 페이지가 router.refresh() 로 재렌더링하게 하기 위한 용도.
 * 탭 숨김 시 자동 unsubscribe.
 */
export function useRealtimeRefresh({
  table,
  schema = 'public',
  filter,
  events = ['INSERT', 'UPDATE'],
  onChange,
  debounceMs = 800,
}: Opts) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        onChange();
        timer = null;
      }, debounceMs);
    };

    const channelName = `rt-refresh:${table}:${filter ?? 'all'}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    let channel = supabase.channel(channelName);
    for (const evt of events) {
      channel = channel.on(
        'postgres_changes' as any,
        { event: evt, schema, table, ...(filter ? { filter } : {}) },
        () => trigger(),
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
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, schema, filter, events.join(','), debounceMs]);
}
