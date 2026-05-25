'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

const PINNED_KEY = 'admin.pinned-items';
const MAX_PINNED = 5;

export interface PinnedItem {
  id: string;
  label: string;
  href: string;
  iconName: string; // lucide-react 아이콘 이름 (문자열)
  createdAt: number;
}

// ── 외부 스토어 (localStorage 변경 감지) ──────────────────

// 외부 스토어 싱글톤 (매번 같은 참조 유지)
let cached: PinnedItem[] | undefined;
const EMPTY: PinnedItem[] = [];

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('admin:pinned-changed', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('admin:pinned-changed', callback);
  };
}

function getSnapshot(): PinnedItem[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(PINNED_KEY);
    if (raw === null) return EMPTY;
    const parsed: PinnedItem[] = JSON.parse(raw);
    // 직렬화 비교로 캐시 무효화 (깊은 === 유지)
    const rawCached = cached ? JSON.stringify(cached) : null;
    const rawParsed = JSON.stringify(parsed);
    if (rawCached !== rawParsed) cached = parsed;
    return cached ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

const SERVER_SNAPSHOT: PinnedItem[] = [];

export function usePinnedItems() {
  const pinned = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);

  const add = useCallback((item: Omit<PinnedItem, 'id' | 'createdAt'>) => {
    const current = getSnapshot();
    // 중복 방지
    if (current.some((p) => p.href === item.href)) return;
    const next: PinnedItem[] = [
      ...current,
      { ...item, id: `pin-${Date.now()}`, createdAt: Date.now() },
    ].slice(-MAX_PINNED);
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('admin:pinned-changed'));
  }, []);

  const remove = useCallback((href: string) => {
    const current = getSnapshot();
    const next = current.filter((p) => p.href !== href);
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('admin:pinned-changed'));
  }, []);

  const clear = useCallback(() => {
    window.localStorage.removeItem(PINNED_KEY);
    window.dispatchEvent(new Event('admin:pinned-changed'));
  }, []);

  return { pinned, add, remove, clear };
}

/**
 * 아이콘 이름 문자열 → Lucide 아이콘 컴포넌트 매핑
 * 자주 사용되는 아이콘만 등록 (동적 import는 번들 최적화)
 */
export function resolveIcon(name: string) {
  // 간단한 매핑 — 자비스가 전달하는 아이콘 이름 해석
  const iconMap: Record<string, string> = {
    'zap': 'Zap',
    'trending-up': 'TrendingUp',
    'bar-chart-3': 'BarChart3',
    'dollar-sign': 'BadgeDollarSign',
    'users': 'Users',
    'package': 'Package',
    'megaphone': 'Megaphone',
    'bot': 'Bot',
    'star': 'Star',
    'wallet': 'Wallet',
    'file-text': 'FileText',
    'activity': 'Activity',
    'settings': 'Settings',
    'search': 'Search',
    'link': 'Link',
    'send': 'Send',
    'message-circle': 'MessageCircle',
  };
  return iconMap[name] ?? 'Zap';
}
