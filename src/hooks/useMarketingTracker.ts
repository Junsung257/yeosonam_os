'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase';

// ── 타입 ─────────────────────────────────────────────────
export type PlatformKey = 'blog' | 'instagram' | 'cafe' | 'threads';

export interface MarketingLog {
  id: string;
  product_id?: string | null;
  travel_package_id?: string | null;
  platform: PlatformKey | 'other';
  url: string;
  created_at: string;
  va_id?: string | null;
  va_name?: string | null;
}

export const PLATFORMS: { key: PlatformKey; icon: string; label: string }[] = [
  { key: 'blog',      icon: 'B', label: '블로그' },
  { key: 'instagram', icon: 'I', label: '인스타' },
  { key: 'cafe',      icon: 'C', label: '카페' },
  { key: 'threads',   icon: 'T', label: '스레드' },
];

// ── 훅 ──────────────────────────────────────────────────
export function useMarketingTracker() {
  const [logs, setLogs] = useState<MarketingLog[]>([]);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);

  // Supabase Auth에서 실제 유저 정보 취득
  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
          const user = data.session.user;
          setCurrentUser({
            id: user.id,
            name: user.email || user.user_metadata?.name || '관리자',
          });
        }
      } catch {
        // 세션 취득 실패 시 기본값
        setCurrentUser({ id: 'anonymous', name: '관리자' });
      }
    })();
  }, []);

  // 전체 로그 로드
  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/marketing-logs?all=1');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch { /* 실패 무시 */ }
  }, []);

  // pkgId별 플랫폼별 로그 맵
  const coverageMap = useMemo(() => {
    const map = new Map<string, Map<PlatformKey, MarketingLog>>();
    for (const log of logs) {
      const pkgId = log.product_id || log.travel_package_id || '';
      if (!pkgId || log.platform === 'other') continue;
      if (!map.has(pkgId)) map.set(pkgId, new Map());
      map.get(pkgId)!.set(log.platform as PlatformKey, log);
    }
    return map;
  }, [logs]);

  // 플랫폼 활성 여부
  const isActive = useCallback((pkgId: string, platform: PlatformKey): boolean => {
    return coverageMap.get(pkgId)?.has(platform) ?? false;
  }, [coverageMap]);

  // Audit Trail 정보
  const getAuditInfo = useCallback((pkgId: string, platform: PlatformKey): string | null => {
    const log = coverageMap.get(pkgId)?.get(platform);
    if (!log) return null;
    const date = new Date(log.created_at);
    const formatted = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const name = log.va_name || '관리자';
    const platformLabel = platform === 'blog' ? '블로그' : platform === 'instagram' ? '인스타' : platform === 'cafe' ? '카페' : '스레드';
    return `${platformLabel} 완료: ${name} (${formatted})`;
  }, [coverageMap]);

  // 낙관적 UI 토글 (Auth 연동 — currentUser 파라미터 불필요)
  const togglePlatform = useCallback(async (
    pkgId: string,
    platform: PlatformKey,
  ): Promise<{ success: boolean; error?: string }> => {
    // Auth 검증
    if (!currentUser || currentUser.id === 'anonymous') {
      return { success: false, error: '로그인이 필요합니다' };
    }

    const key = `${pkgId}-${platform}`;
    if (togglingKey === key) return { success: false, error: '처리 중' };
    setTogglingKey(key);

    const existing = coverageMap.get(pkgId)?.get(platform);

    if (existing) {
      const prevLogs = [...logs];
      setLogs(prev => prev.filter(l => l.id !== existing.id));

      try {
        const res = await fetch(`/api/marketing-logs?id=${existing.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('삭제 실패');
        setTogglingKey(null);
        return { success: true };
      } catch {
        setLogs(prevLogs);
        setTogglingKey(null);
        return { success: false, error: '삭제 실패 — 다시 시도해주세요' };
      }
    } else {
      const tempId = `temp-${Date.now()}`;
      const optimisticLog: MarketingLog = {
        id: tempId,
        product_id: pkgId,
        platform,
        url: `https://yeosonam.com/${platform}/${pkgId}`,
        created_at: new Date().toISOString(),
        va_id: currentUser.id,
        va_name: currentUser.name,
      };
      setLogs(prev => [...prev, optimisticLog]);

      try {
        const res = await fetch('/api/marketing-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: pkgId,
            platform,
            url: optimisticLog.url,
            va_id: currentUser.id,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || '등록 실패');
        }
        const data = await res.json();
        setLogs(prev => prev.map(l => l.id === tempId ? { ...l, id: data.log?.id || tempId } : l));
        setTogglingKey(null);
        return { success: true };
      } catch (err) {
        setLogs(prev => prev.filter(l => l.id !== tempId));
        setTogglingKey(null);
        return { success: false, error: err instanceof Error ? err.message : '등록 실패 — 다시 시도해주세요' };
      }
    }
  }, [logs, coverageMap, togglingKey, currentUser]);

  // 커버리지 퍼센트
  const getCoverage = useCallback((pkgId: string): number => {
    const platforms = coverageMap.get(pkgId);
    if (!platforms) return 0;
    return Math.round((platforms.size / PLATFORMS.length) * 100);
  }, [coverageMap]);

  return {
    logs,
    loadLogs,
    coverageMap,
    isActive,
    getAuditInfo,
    togglePlatform,
    getCoverage,
    togglingKey,
    currentUser,
  };
}
