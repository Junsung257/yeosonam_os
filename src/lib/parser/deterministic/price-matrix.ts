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
  option_label?: string | null;
  option_type?: 'hotel' | null;
}

export interface MatrixPriceExtractOptions {
  title?: string | null;
  accommodations?: string[] | null;
  includeAllHotelColumns?: boolean;
}

const DOW_MAP: Record<string, number> = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
};
const DOW_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const PERIOD_RE = /(\d{1,2})[./](\d{1,2})\s*[~\-–—]\s*(\d{1,2})[./](\d{1,2})/;
/** 단일일 또는 쉼표 구분 개별일 — e.g. "6/3", "10/3,10/9" */
const SINGLE_DATE_RE = /^(\d{1,2})[./](\d{1,2})(?:,\s*(\d{1,2})[./](\d{1,2}))*$/;
const DOW_LINE_RE = /^([일월화수목금토](?:[~\-][일월화수목금토])?|[일월화수목금토]{2,7}|매일)\s*$/;
const PRICE_RE = /^([\d,]{3,10})(?:\s*[,\-]|\s*원)?\s*$/;
const SPOT_LINE_RE = /^(\d{1,2})[./](\d{1,2})\s+([\d,]{3,10})/;
const EXCLUDE_HINT_RE = /제외|except|exclude/i;

function compactLabel(label: string): string {
  return label.replace(/\s+/g, '');
}

function isDowLine(line: string): boolean {
  return DOW_LINE_RE.test(compactLabel(line));
}

function parseDowPriceLine(line: string): { dowLabel: string; price: number } | null {
  const compact = compactLabel(line);
  const m = compact.match(/^([일월화수목금토]{1,7}|매일)([\d,]{3,10})(?:원)?$/);
  if (!m) return null;
  const price = parsePrice(m[2]);
  return price > 0 ? { dowLabel: m[1], price } : null;
}

function parsePrice(tok: string): number {
  const n = parseInt(tok.replace(/[, ]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 10000 ? n * 1000 : n;
}

function expandDow(label: string): number[] {
  const compact = compactLabel(label);
  if (compact === '매일') return [0, 1, 2, 3, 4, 5, 6];
  const rangeM = compact.match(/^([일월화수목금토])[~\-]([일월화수목금토])$/);
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
  if (/^[일월화수목금토]{2,7}$/.test(compact)) {
    return [...new Set(compact.split('').map(ch => DOW_MAP[ch]).filter((v): v is number => v != null))];
  }
  const single = DOW_MAP[compact];
  return single != null ? [single] : [];
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferYear(month: number, todayYear?: number): number {
  if (typeof todayYear === 'number' && Number.isInteger(todayYear) && todayYear >= 2000) return todayYear;
  const now = new Date();
  const base = now.getFullYear();
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
  meta: Pick<MatrixPriceRow, 'option_label' | 'option_type'> = {},
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
      if (iso) rows.push({ date: iso, adult_price: price, child_price: null, note, status: 'available', ...meta });
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

interface PeriodSlot {
  start: { m: number; d: number };
  end: { m: number; d: number };
  year: number;
}

function normalizeHint(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[()\[\]{}【】［］]/g, ' ')
    .replace(/\s+/g, '');
}

function labelHints(label: string): string[] {
  const hints = [label];
  const bracket = label.match(/\[([^\]]+)\]/);
  if (bracket?.[1]) hints.push(bracket[1]);
  const beforeBracket = label.split('[')[0]?.trim();
  if (beforeBracket) hints.push(beforeBracket);
  return [...new Set(hints.map(normalizeHint).filter(Boolean))];
}

function selectHotelColumn(labels: string[], options: MatrixPriceExtractOptions): number {
  const sourceHints = [
    options.title ?? '',
    ...(options.accommodations ?? []),
  ].map(normalizeHint).filter(Boolean);

  if (sourceHints.length === 0) return 0;

  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < labels.length; i++) {
    const candidates = labelHints(labels[i]);
    let score = 0;
    for (const source of sourceHints) {
      for (const candidate of candidates) {
        if (!candidate) continue;
        if (source.includes(candidate)) score += candidate.length >= 3 ? 20 : 8;
        if (candidate.includes(source) && source.length >= 2) score += source.length >= 3 ? 12 : 4;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestScore > 0 ? bestIndex : 0;
}

function findHorizontalHotelHeader(lines: string[]): { headerStart: number; labels: string[]; periodIndex: number } | null {
  const departureIdx = lines.findIndex(line => compactLabel(line) === '출발일');
  if (departureIdx < 0) return null;

  let periodIndex = -1;
  for (let i = departureIdx + 1; i < lines.length; i++) {
    if (PERIOD_RE.test(lines[i])) {
      periodIndex = i;
      break;
    }
  }
  if (periodIndex < 0) return null;

  const labels = lines
    .slice(departureIdx + 1, periodIndex)
    .filter(line => compactLabel(line) !== '요일')
    .filter(line => !isDowLine(line))
    .filter(line => !PRICE_RE.test(line));

  return labels.length >= 2 ? { headerStart: departureIdx, labels, periodIndex } : null;
}

function extractHorizontalHotelMatrix(
  lines: string[],
  todayYear: number | undefined,
  options: MatrixPriceExtractOptions,
): MatrixPriceRow[] {
  const header = findHorizontalHotelHeader(lines);
  if (!header) return [];

  const selectedColumn = selectHotelColumn(header.labels, options);
  const includeAllColumns = options.includeAllHotelColumns === true;
  const rows: MatrixPriceRow[] = [];
  let periods: PeriodSlot[] = [];
  let priceGenerated = false;

  for (let i = header.periodIndex; i < lines.length; i++) {
    const line = lines[i];
    const periodM = line.match(PERIOD_RE);
    if (periodM) {
      if (priceGenerated) {
        periods = [];
        priceGenerated = false;
      }
      const ps = { m: +periodM[1], d: +periodM[2] };
      const pe = { m: +periodM[3], d: +periodM[4] };
      periods.push({ start: ps, end: pe, year: inferYear(ps.m, todayYear) });
      continue;
    }

    const dowPrice = parseDowPriceLine(line);
    if (periods.length === 0 || (!isDowLine(line) && !dowPrice)) continue;

    const dowLabel = dowPrice?.dowLabel ?? line;
    const dow = expandDow(dowLabel);
    if (dow.length === 0) continue;

    const prices: number[] = dowPrice ? [dowPrice.price] : [];
    let j = i + 1;
    while (j < lines.length && prices.length < header.labels.length) {
      const priceM = lines[j].match(PRICE_RE);
      if (!priceM) break;
      prices.push(parsePrice(priceM[1]));
      j++;
    }
    if (prices.length < header.labels.length) continue;

    const columns = includeAllColumns
      ? header.labels.map((label, index) => ({ label, index }))
      : [{ label: header.labels[selectedColumn] ?? header.labels[0] ?? null, index: selectedColumn }];

    for (const column of columns) {
      const selectedPrice = prices[column.index] ?? 0;
      if (selectedPrice <= 0) continue;
      const note = column.label ? `${column.label} ${dowLabel}` : dowLabel;
      for (const p of periods) {
        rows.push(...expandPeriod(
          p.year,
          p.start.m, p.start.d,
          p.end.m, p.end.d,
          dow,
          selectedPrice,
          note,
          column.label ? { option_label: column.label, option_type: 'hotel' } : {},
        ));
      }
      priceGenerated = true;
    }
    i = j - 1;
  }

  return rows;
}

/**
 * 기간×요일 매트릭스 → 일자별 price_dates row.
 * 패턴 미매칭 시 [] (LLM fallback 으로).
 *
 * 다중 기간 누적 지원: 여러 기간 라인이 하나의 요일+가격 블록을 공유하는 패턴 처리
 * (e.g. 기간1\n기간2\n기간3\n일,월,화\n1,059,-)
 */
export function extractPriceMatrix(rawText: string, todayYear?: number, options: MatrixPriceExtractOptions = {}): MatrixPriceRow[] {
  if (!rawText || rawText.length < 30) return [];
  const region = slicePriceRegion(rawText);
  if (!PERIOD_RE.test(region)) return [];

  const lines = region.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const hotelRows = extractHorizontalHotelMatrix(lines, todayYear, options);
  if (hotelRows.length > 0) {
    return hotelRows.sort((a, b) => a.date.localeCompare(b.date));
  }

  const rows: MatrixPriceRow[] = [];
  const excludedDates = new Set<string>();

  /** 누적 기간 스택 — 동일 요일+가격 블록을 공유하는 모든 기간 */
  let periods: PeriodSlot[] = [];
  let pendingDow: number[] = [];
  let inSpotSection = false;
  /** 가격 행이 한 번이라도 전개된 적이 있는지 — 새 기간 블록 시작 감지용 */
  let priceGenerated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (EXCLUDE_HINT_RE.test(line) && /\d{1,2}[./]\d{1,2}/.test(line)) {
      const spots = [...line.matchAll(/(\d{1,2})[./](\d{1,2})/g)];
      for (const s of spots) {
        const m = +s[1], d = +s[2];
        const y = inferYear(m);
        const iso = toIso(y, m, d);
        if (iso) excludedDates.add(iso);
      }
      continue;
    }

    const periodM = line.match(PERIOD_RE);
    if (periodM) {
      // 이전 가격 블록 이후 새 기간이면 스택 초기화 (가격 블록 구분)
      if (priceGenerated) {
        periods = [];
        priceGenerated = false;
      }
      const ps = { m: +periodM[1], d: +periodM[2] };
      const pe = { m: +periodM[3], d: +periodM[4] };
      const y = inferYear(ps.m, todayYear);
      periods.push({ start: ps, end: pe, year: y });
      pendingDow = [];
      inSpotSection = false;
      continue;
    }

    /** 단일일 또는 쉼표 구분 개별일 — e.g. "6/3", "10/3,10/9" */
    const singleM = line.match(SINGLE_DATE_RE);
    if (singleM) {
      if (priceGenerated) {
        periods = [];
        priceGenerated = false;
      }
      const dates: { m: number; d: number }[] = [];
      for (let g = 1; g < singleM.length; g += 2) {
        const m = +singleM[g], d = +singleM[g + 1];
        if (Number.isFinite(m) && Number.isFinite(d)) {
          dates.push({ m, d });
        }
      }
      for (const dt of dates) {
        const yy = inferYear(dt.m, todayYear);
        periods.push({ start: dt, end: dt, year: yy });
      }
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
        const y = inferYear(m);
        const iso = toIso(y, m, d);
        if (iso && price > 0) {
          rows.push({ date: iso, adult_price: price, child_price: null, note: '스팟특가', status: 'available' });
        }
      }
      continue;
    }

    if (periods.length === 0) continue;

    if (isDowLine(line)) {
      pendingDow = expandDow(line);
      continue;
    }

    const priceM = line.match(PRICE_RE);
    if (priceM && pendingDow.length > 0) {
      const price = parsePrice(priceM[1]);
      if (price > 0) {
        const note = pendingDow.length === 7 ? '매일' : DOW_NAMES.filter((_, idx) => pendingDow.includes(idx)).join('');
        for (const p of periods) {
          rows.push(...expandPeriod(
            p.year,
            p.start.m, p.start.d,
            p.end.m, p.end.d,
            pendingDow,
            price,
            note,
          ));
        }
        priceGenerated = true;
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
