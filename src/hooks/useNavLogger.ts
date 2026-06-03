'use client';

import { useCallback, useEffect, useRef } from 'react';

const NAV_USAGE_KEY = 'admin.nav-usage';
const MAX_ENTRIES = 500;

/** 최근 방문한 메뉴 경로 + 타임스탬프 */
interface NavUsageEntry {
  href: string;
  t: number; // timestamp
}

function isNavUsageEntry(value: unknown): value is NavUsageEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as NavUsageEntry).href === 'string' &&
    Number.isFinite((value as NavUsageEntry).t)
  );
}

function parseNavUsage(raw: string | null): NavUsageEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isNavUsageEntry) : [];
  } catch {
    return [];
  }
}

/**
 * 메뉴 클릭 로그를 localStorage에 수집하는 훅.
 * 사이드바/네비게이션 클릭 시 trackNavClick(href)을 호출.
 */
export function useNavLogger() {
  const batchRef = useRef<NavUsageEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (batchRef.current.length === 0) return;
    try {
      const raw = window.localStorage.getItem(NAV_USAGE_KEY);
      const existing = parseNavUsage(raw);
      const merged = [...existing, ...batchRef.current].slice(-MAX_ENTRIES);
      window.localStorage.setItem(NAV_USAGE_KEY, JSON.stringify(merged));
    } catch {
      // 저장 실패는 무시
    }
    batchRef.current = [];
  }, []);

  // 언마운트 시 플러시
  useEffect(() => {
    return () => flush();
  }, [flush]);

  const trackNavClick = useCallback(
    (href: string) => {
      batchRef.current.push({ href, t: Date.now() });
      // 2초 디바운스로 배치 저장
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 2000);
    },
    [flush],
  );

  return { trackNavClick };
}

/**
 * localStorage에서 NavUsageEntry[]를 읽고, 항목별 방문 횟수를 계산.
 * 최근 30일 이내 데이터만 집계.
 */
export function readNavUsage(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(NAV_USAGE_KEY);
    const entries = parseNavUsage(raw);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const counts: Record<string, number> = {};
    for (const e of entries) {
      if (e.t < cutoff) continue;
      counts[e.href] = (counts[e.href] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

/**
 * 특정 메뉴 href의 사용 빈도 점수 (0~1, 상대적).
 * readNavUsage() 결과를 인자로 받아 정규화.
 */
export function computeFrequencyScore(
  usageCounts: Record<string, number>,
  href: string,
): number {
  const values = Object.values(usageCounts);
  if (values.length === 0) return 0;
  const max = Math.max(...values);
  if (max === 0) return 0;
  return (usageCounts[href] ?? 0) / max;
}
