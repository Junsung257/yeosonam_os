/**
 * @file holiday-aware-expand.ts — price_dates 확장 시 한국 공휴일 자동 제외 (P11-5)
 *
 * 박제 사유 (2026-05-13):
 * 패키지 가격은 보통 평일/주말 다름. 공휴일은 가격 인상 또는 매진. 자동 expand 시
 * 공휴일을 별도 tier 로 분리하거나 제외해서 사장님이 수동 정리할 일을 줄임.
 *
 * 동작:
 * 1. expand_date_range 가 생성한 departure_dates 중 kr_holidays 와 매치되는 날짜 분리
 * 2. 결과: { regular: [], holiday: [], adjacent: [] }
 *   - regular: 평일·일반 주말
 *   - holiday: 공휴일 (별도 가격 tier 필요)
 *   - adjacent: 공휴일 전후 1일 (성수기 가능성)
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export interface HolidaySegmentation {
  regular:  string[];
  holiday:  string[];
  adjacent: string[];
  matched_holidays: Array<{ date: string; name: string; category: string }>;
}

let holidayCache: Map<string, { name: string; category: string }> | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

async function loadHolidays(): Promise<Map<string, { name: string; category: string }>> {
  if (holidayCache && Date.now() < cacheExpiry) return holidayCache;
  if (!isSupabaseConfigured) return new Map();
  try {
    const { data } = await supabaseAdmin
      .from('kr_holidays')
      .select('holiday_date, name, category');
    const map = new Map<string, { name: string; category: string }>();
    for (const row of (data ?? []) as Array<{ holiday_date: string; name: string; category: string }>) {
      map.set(row.holiday_date, { name: row.name, category: row.category });
    }
    holidayCache = map;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return map;
  } catch {
    return new Map();
  }
}

/** 날짜 배열을 공휴일 / 인접일 / 일반으로 분리 */
export async function segmentDatesByHoliday(dates: string[]): Promise<HolidaySegmentation> {
  const holidays = await loadHolidays();
  const result: HolidaySegmentation = {
    regular: [],
    holiday: [],
    adjacent: [],
    matched_holidays: [],
  };

  for (const date of dates) {
    if (holidays.has(date)) {
      const h = holidays.get(date)!;
      result.holiday.push(date);
      result.matched_holidays.push({ date, name: h.name, category: h.category });
      continue;
    }
    // 전후 1일 인접 체크
    const d = new Date(date);
    const prev = new Date(d); prev.setDate(d.getDate() - 1);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const prevISO = prev.toISOString().slice(0, 10);
    const nextISO = next.toISOString().slice(0, 10);
    if (holidays.has(prevISO) || holidays.has(nextISO)) {
      result.adjacent.push(date);
    } else {
      result.regular.push(date);
    }
  }

  return result;
}

/** price_tier 자동 분리 — holiday/adjacent 가 있으면 새 tier 권장 */
export interface TierSplitHint {
  needs_split: boolean;
  holiday_count: number;
  adjacent_count: number;
  regular_count: number;
  recommendation: string;
}

export async function analyzeTierForHolidays(dates: string[]): Promise<TierSplitHint> {
  const seg = await segmentDatesByHoliday(dates);
  return {
    needs_split: seg.holiday.length > 0 || seg.adjacent.length > 0,
    holiday_count: seg.holiday.length,
    adjacent_count: seg.adjacent.length,
    regular_count: seg.regular.length,
    recommendation: seg.holiday.length > 0
      ? `공휴일 ${seg.holiday.length}건 (${seg.matched_holidays.map(h => h.name).join(', ')}) — 별도 tier 권장`
      : seg.adjacent.length > 0
        ? `공휴일 인접 ${seg.adjacent.length}건 — 성수기 tier 고려`
        : '일반 tier OK',
  };
}

export function invalidateHolidayCache() {
  holidayCache = null;
  cacheExpiry = 0;
}
