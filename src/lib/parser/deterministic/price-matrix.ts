/**
 * @file deterministic/price-matrix.ts — 기간×요일 매트릭스 가격표 (2026-05-20 RC3)
 *
 * 골프·리조트 카탈로그의 "기간 헤더 → 요일 라벨 → 가격" grid 패턴.
 */

export interface MatrixPriceRow {
  date: string;
  adult_price: number;
  child_price?: number | null;
  note?: string | null;
  status?: string | null;
}

const DOW_MAP: Record<string, number> = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
};
const DOW_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const PERIOD_RE = /(\d{1,2})[./](\d{1,2})\s*[~\-–—]\s*(\d{1,2})[./](\d{1,2})/;
const DOW_LINE_RE = /^([일월화수목금토](?:[~\-][일월화수목금토])?|매일)\s*$/;
const PRICE_RE = /^([\d,]{3,10})(?:\s*[,\-]|\s*원)?\s*$/;
const SPOT_LINE_RE = /^(\d{1,2})[./](\d{1,2})\s+([\d,]{3,10})/;
const EXCLUDE_HINT_RE = /제외|except|exclude/i;

function parsePrice(tok: string): number {
  const n = parseInt(tok.replace(/[, ]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 10000 ? n * 1000 : n;
}

function expandDow(label: string): number[] {
  if (label === '매일') return [0, 1, 2, 3, 4, 5, 6];
  const rangeM = label.match(/^([일월화수목금토])[~\-]([일월화수목금토])$/);
  if (rangeM) {
    const start = DOW_MAP[rangeM[1]];
    const end = DOW_MAP[rangeM[2]];
    if (start == null || end == null) return [];
    const out: number[] = [];
    let i = start;
    for (let n = 0; n < 7; n++) {
      out.push(i);
      if (i === end) break;
      i = (i + 1) % 7;
    }
    return out;
  }
  const single = DOW_MAP[label];
  return single != null ? [single] : [];
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferYear(month: number, todayYear?: number): number {
  const now = new Date();
  const base = todayYear ?? now.getFullYear();
  return month < now.getMonth() + 1 ? base + 1 : base;
}

function expandPeriod(
  year: number,
  startMonth: number,
  startDay: number,
  endMonth: number,
  endDay: number,
  dowFilter: number[],
  price: number,
  note: string | null,
): MatrixPriceRow[] {
  const rows: MatrixPriceRow[] = [];
  const start = new Date(year, startMonth - 1, startDay);
  const end = new Date(year, endMonth - 1, endDay);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return rows;

  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dowFilter.length === 0 || dowFilter.includes(dow)) {
      const iso = toIso(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
      if (iso) rows.push({ date: iso, adult_price: price, child_price: null, note, status: 'available' });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return rows;
}

function slicePriceRegion(rawText: string): string {
  const itinHints = ['제1일', 'DAY 1', 'Day 1', '제 1 일'];
  let endIdx = rawText.length;
  for (const hint of itinHints) {
    const i = rawText.indexOf(hint);
    if (i >= 0 && i < endIdx) endIdx = i;
  }
  const stopHints = ['포 함', '포함사항', '포함 사항', '불포함', '비 고', '최소출발'];
  let stopIdx = endIdx;
  for (const hint of stopHints) {
    const i = rawText.indexOf(hint);
    if (i >= 0 && i < stopIdx) stopIdx = i;
  }
  return rawText.slice(0, stopIdx);
}

/**
 * 기간×요일 매트릭스 → 일자별 price_dates row.
 * 패턴 미매칭 시 [] (LLM fallback 으로).
 */
export function extractPriceMatrix(rawText: string, todayYear?: number): MatrixPriceRow[] {
  if (!rawText || rawText.length < 30) return [];
  const region = slicePriceRegion(rawText);
  if (!PERIOD_RE.test(region)) return [];

  const lines = region.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows: MatrixPriceRow[] = [];
  const excludedDates = new Set<string>();

  let periodStart: { m: number; d: number } | null = null;
  let periodEnd: { m: number; d: number } | null = null;
  let year = todayYear ?? new Date().getFullYear();
  let pendingDow: number[] = [];
  let inSpotSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (EXCLUDE_HINT_RE.test(line) && /\d{1,2}[./]\d{1,2}/.test(line)) {
      const spots = [...line.matchAll(/(\d{1,2})[./](\d{1,2})/g)];
      for (const s of spots) {
        const m = +s[1], d = +s[2];
        const y = inferYear(m, year);
        const iso = toIso(y, m, d);
        if (iso) excludedDates.add(iso);
      }
      continue;
    }

    const periodM = line.match(PERIOD_RE);
    if (periodM) {
      periodStart = { m: +periodM[1], d: +periodM[2] };
      periodEnd = { m: +periodM[3], d: +periodM[4] };
      year = inferYear(periodStart.m, todayYear);
      pendingDow = [];
      inSpotSection = false;
      continue;
    }

    if (/스팟|특가|spot/i.test(line)) {
      inSpotSection = true;
      pendingDow = [];
      continue;
    }

    if (inSpotSection) {
      const spotM = line.match(SPOT_LINE_RE);
      if (spotM) {
        const m = +spotM[1], d = +spotM[2];
        const price = parsePrice(spotM[3]);
        const y = inferYear(m, year);
        const iso = toIso(y, m, d);
        if (iso && price > 0) {
          rows.push({ date: iso, adult_price: price, child_price: null, note: '스팟특가', status: 'available' });
        }
      }
      continue;
    }

    if (!periodStart || !periodEnd) continue;

    if (DOW_LINE_RE.test(line)) {
      pendingDow = expandDow(line);
      continue;
    }

    const priceM = line.match(PRICE_RE);
    if (priceM && pendingDow.length > 0) {
      const price = parsePrice(priceM[1]);
      if (price > 0) {
        const note = pendingDow.length === 7 ? '매일' : DOW_NAMES.filter((_, idx) => pendingDow.includes(idx)).join('');
        rows.push(...expandPeriod(
          year,
          periodStart.m, periodStart.d,
          periodEnd.m, periodEnd.d,
          pendingDow,
          price,
          note,
        ));
      }
    }
  }

  if (rows.length === 0) return [];

  const byDate = new Map<string, MatrixPriceRow>();
  for (const r of rows) {
    if (excludedDates.has(r.date)) continue;
    byDate.set(r.date, r);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
