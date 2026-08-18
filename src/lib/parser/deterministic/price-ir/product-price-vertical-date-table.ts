import type { MatrixPriceRow, PriceIROptions } from './types.ts';
import { extractSourceWonAmounts } from './source-money.ts';

function parseKoreanWonPrice(line: string): number {
  const prices = extractSourceWonAmounts(line, {
    allowBareSaleShorthand: true,
    minAmount: 30_000,
    maxAmount: 50_000_000,
  }).map(candidate => candidate.amount);
  if (prices.length === 0) return 0;
  if (/[→>]/.test(line) && prices.length >= 2) return prices[prices.length - 1];
  return Math.min(...prices);
}

function isKoreanStopSection(line: string): boolean {
  return /^(포\s*함|불\s*포함|선택관광|쇼핑|비\s*고|REMARK|일\s*자|PKG|포함사항|불포함사항)/i.test(line.trim());
}

function parseKoreanDepartureDates(line: string, yearHint?: number): string[] {
  if (!/출발/.test(line) || !/월/.test(line)) return [];
  const monthMatch = line.match(/(\d{1,2})\s*월/);
  const month = Number(monthMatch?.[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return [];

  const afterMonth = line.slice((monthMatch?.index ?? 0) + (monthMatch?.[0].length ?? 0));
  const beforeDeparture = afterMonth.split(/출발/)[0] ?? '';
  const dates: string[] = [];
  for (const match of beforeDeparture.matchAll(/\d{1,2}/g)) {
    const day = Number(match[0]);
    const iso = isoDate(inferYearForMonth(month, yearHint), month, day);
    if (iso) dates.push(iso);
  }
  return [...new Set(dates)];
}

function selectedGradeIndex(title?: string | null): number | null {
  const compact = String(title ?? '').replace(/\s+/g, '');
  if (!compact) return null;
  if (compact.includes('고품격')) return 2;
  if (compact.includes('품격')) return 1;
  if (compact.includes('실속') || compact.includes('라이트')) return 0;
  return null;
}

function extractKoreanDepartureLinePriceRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();
  const nonSaleContext = /(?:\uCEE4\s*\uBBF8\s*\uC158|commission|\bcomm?\b|\uC218\s*\uC218\s*\uB8CC|\uC2F1\s*\uAE00|\uC544\s*\uB3D9|\uC18C\s*\uC544|\uC720\s*\uB958|\uD604\s*\uC9C0\s*\uBE44|\uC635\s*\uC158|\uC120\s*\uD0DD|\uACC4\s*\uC57D\s*\uAE08)/iu;

  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const dates = parseKoreanDepartureDates(lines[i], options.year);
    if (dates.length === 0 || dates.length > 20) continue;

    const candidatePrices: number[] = [];
    const priceOnDepartureLine = /(?:판매가|상품가|요금|행사가)/.test(lines[i])
      && !nonSaleContext.test(lines[i])
      ? parseKoreanWonPrice(lines[i])
      : 0;
    if (priceOnDepartureLine > 0) candidatePrices.push(priceOnDepartureLine);
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      if (isKoreanStopSection(lines[j])) break;
      if (nonSaleContext.test(lines[j])) continue;
      const candidate = parseKoreanWonPrice(lines[j]);
      if (candidate > 0) candidatePrices.push(candidate);
    }
    const uniquePrices = [...new Set(candidatePrices)];
    // Multiple amounts near one departure are commercially ambiguous (for
    // example list/sale, adult/child, or two product grades). A later typed
    // resolver must establish their relation instead of selecting the first.
    if (uniquePrices.length !== 1) continue;
    const price = uniquePrices[0]!;

    for (const date of dates) {
      const key = `${date}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        date,
        adult_price: price,
        child_price: null,
        note: 'source_korean_departure_line_price',
        status: 'available',
      });
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
}

function parseKoreanMonthDayLine(line: string, yearHint?: number): string[] {
  const match = line.trim().match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일$/);
  if (!match) return [];
  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = isoDate(inferYearForMonth(month, yearHint), month, day);
  return date ? [date] : [];
}

function extractKoreanGradeDatePriceRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const rows: MatrixPriceRow[] = [];
  const wantedDuration = typeof options.durationDays === 'number' && options.durationDays > 0
    ? options.durationDays
    : null;
  const preferred = selectedGradeIndex(options.title);
  // This flattened layout contains only numbers after each date; without a
  // product title naming the grade there is no source-backed way to know which
  // column belongs to the current section. Product segmentation/profile logic
  // must establish that axis first. Emitting every column would attach other
  // products' prices to one product and later look like a same-date conflict.
  if (preferred == null) return [];
  let currentDuration: number | null = null;

  for (let i = 0; i < Math.min(lines.length, 140); i++) {
    const durationMatch = lines[i].match(/(\d{1,2})\s*박\s*(\d{1,2})\s*일/);
    if (durationMatch) currentDuration = Number(durationMatch[2]);

    const dates = parseKoreanMonthDayLine(lines[i], options.year);
    if (dates.length === 0) continue;

    const prices: number[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      if (/마감|대기|문의/.test(lines[j])) break;
      if (parseKoreanMonthDayLine(lines[j], options.year).length > 0) break;
      if (isKoreanStopSection(lines[j]) || /[A-Z]{2}\d{3,4}/.test(lines[j])) break;
      const price = parseKoreanWonPrice(lines[j]);
      if (price > 0) prices.push(price);
      else if (prices.length > 0) break;
    }
    if (prices.length === 0) continue;
    if (wantedDuration != null && currentDuration != null && currentDuration !== wantedDuration) continue;

    const indexes = prices[preferred] != null ? [preferred] : [];
    const labels = ['실속', '품격', '고품격'];
    for (const date of dates) {
      for (const index of indexes) {
        const price = prices[index];
        if (!price) continue;
        rows.push({
          date,
          adult_price: price,
          child_price: null,
          note: labels[index] ? `source_korean_grade_date_price:${labels[index]}` : 'source_korean_grade_date_price',
          status: 'available',
          option_label: labels[index] ?? null,
          option_type: labels[index] ? 'hotel' : null,
        });
      }
    }
  }

  const byKey = new Map<string, MatrixPriceRow>();
  for (const row of rows) byKey.set(`${row.date}|${row.adult_price}|${row.note ?? ''}`, row);
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
}

function parseKoreanDayList(line: string, month: number | null, yearHint?: number): string[] {
  if (month == null) return [];
  const compact = line.replace(/\s+/g, '');
  if (!/^\d{1,2}(?:,\d{1,2})*$/.test(compact)) return [];
  return compact
    .split(',')
    .map(day => isoDate(inferYearForMonth(month, yearHint), month, Number(day)))
    .filter((date): date is string => Boolean(date));
}

function extractKoreanHotelMonthDayRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const dateHeader = lines.findIndex(line => line === '날짜');
  if (dateHeader < 0 || dateHeader > 8) return [];

  const labels: string[] = [];
  for (let i = dateHeader + 1; i < Math.min(lines.length, dateHeader + 8); i++) {
    if (/^\d{1,2}\s*월$/.test(lines[i])) break;
    if (parseKoreanWonPrice(lines[i]) > 0) break;
    labels.push(lines[i]);
  }
  if (labels.length < 2) return [];

  const rows: MatrixPriceRow[] = [];
  let month: number | null = null;
  let i = dateHeader + labels.length + 1;
  while (i < Math.min(lines.length, 80)) {
    if (/^(실시간|REMARK|PKG|포함|불포함)/i.test(lines[i])) break;
    const monthMatch = lines[i].match(/^(\d{1,2})\s*월$/);
    if (monthMatch) {
      month = Number(monthMatch[1]);
      i++;
      continue;
    }

    const dates = parseKoreanDayList(lines[i], month, options.year);
    if (dates.length === 0) {
      i++;
      continue;
    }

    let durationLabel: string | null = null;
    const prices: number[] = [];
    let j = i + 1;
    for (; j < Math.min(lines.length, i + 8); j++) {
      if (/^\d{1,2}\s*월$/.test(lines[j]) || parseKoreanDayList(lines[j], month, options.year).length > 0) break;
      const durationMatch = lines[j].match(/^\d+\s*박$/);
      if (durationMatch) {
        durationLabel = durationMatch[0].replace(/\s+/g, '');
        continue;
      }
      const price = parseKoreanWonPrice(lines[j]);
      if (price > 0) prices.push(price);
      else if (prices.length > 0) break;
    }

    for (const date of dates) {
      prices.forEach((price, index) => {
        const label = labels[index] ?? labels[labels.length - 1] ?? null;
        rows.push({
          date,
          adult_price: price,
          child_price: null,
          note: `source_korean_hotel_month_day${label ? `:${label}` : ''}${durationLabel ? `:${durationLabel}` : ''}`,
          status: 'available',
          option_label: label,
          option_type: label ? 'hotel' : null,
        });
      });
    }
    i = Math.max(i + 1, j);
  }

  const byKey = new Map<string, MatrixPriceRow>();
  for (const row of rows) byKey.set(`${row.date}|${row.adult_price}|${row.note ?? ''}`, row);
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
}

function parseDurationDays(line: string): number | null {
  const match = line.match(/(\d{1,2})\s*박\s*(\d{1,2})\s*일/);
  const days = Number(match?.[2]);
  return Number.isInteger(days) && days > 0 ? days : null;
}

function parseStandaloneKoreanMonth(line: string): number | null {
  const match = line.replace(/\s+/g, '').match(/^(\d{1,2})월$/);
  const month = Number(match?.[1]);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

function parseStandaloneKoreanDayList(line: string, month: number | null, yearHint?: number): string[] {
  if (month == null || parseKoreanWonPrice(line) > 0) return [];
  const compact = line.replace(/\s+/g, '').replace(/일/g, '');
  if (!/^\d{1,2}(?:,\d{1,2})*$/.test(compact)) return [];
  return compact
    .split(',')
    .map(day => isoDate(inferYearForMonth(month, yearHint), month, Number(day)))
    .filter((date): date is string => Boolean(date));
}

function extractKoreanDurationSectionPriceRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const wantedDuration = typeof options.durationDays === 'number' && options.durationDays > 0
    ? options.durationDays
    : null;
  if (wantedDuration == null) return [];

  const hasDatePriceHeader = lines
    .slice(0, 16)
    .some((line, index) => /출발일/.test(line) && lines.slice(index, index + 4).some(next => /판매가|상품가|요금/.test(next)));
  if (!hasDatePriceHeader) return [];

  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();
  let currentDuration: number | null = null;
  let currentMonth: number | null = null;

  for (let i = 0; i < Math.min(lines.length, 120); i++) {
    const duration = parseDurationDays(lines[i]);
    if (duration != null) {
      currentDuration = duration;
      currentMonth = null;
      continue;
    }

    const month = parseStandaloneKoreanMonth(lines[i]);
    if (month != null) {
      currentMonth = month;
      continue;
    }

    if (currentDuration !== wantedDuration) continue;
    const dates = parseStandaloneKoreanDayList(lines[i], currentMonth, options.year);
    if (dates.length === 0 || dates.length > 31) continue;

    let price = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      if (parseDurationDays(lines[j]) != null || parseStandaloneKoreanMonth(lines[j]) != null) break;
      if (parseStandaloneKoreanDayList(lines[j], currentMonth, options.year).length > 0) break;
      price = parseKoreanWonPrice(lines[j]);
      if (price > 0) break;
      if (isKoreanStopSection(lines[j])) break;
    }
    if (price <= 0) continue;

    for (const date of dates) {
      const key = `${date}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        date,
        adult_price: price,
        child_price: null,
        note: 'source_korean_duration_section_price',
        status: 'available',
      });
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
}

function inferYearForMonth(month: number, explicitYear?: number): number {
  if (explicitYear && explicitYear >= 2000) return explicitYear;
  const now = new Date();
  return month < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseKrwPrice(line: string): number {
  const values = extractSourceWonAmounts(line, {
    allowBareSaleShorthand: true,
    minAmount: 100_000,
    maxAmount: 50_000_000,
  }).map(candidate => candidate.amount);
  if (values.length === 0) return 0;
  if (/(?:→|⇒|➜|⟶|▶|->|=>)/u.test(line) && values.length >= 2) return values.at(-1) ?? 0;
  return values.length === 1 ? values[0]! : 0;
}

function preferredGradePriceIndex(title?: string | null): number | null {
  const compact = String(title ?? '').replace(/\s+/g, '');
  if (!compact) return null;
  if (compact.includes('고품격')) return 2;
  if (compact.includes('품격')) return 1;
  if (compact.includes('실속')) return 0;
  return null;
}

function pickProductPrice(prices: number[], options: PriceIROptions): number {
  const preferredIndex = preferredGradePriceIndex(options.title);
  if (preferredIndex != null && prices[preferredIndex] > 0) return prices[preferredIndex];
  return prices[0] ?? 0;
}

function parseDateListLine(line: string, yearHint?: number): string[] {
  const compact = line
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  if (!/\d{1,2}[./]\d{1,2}/.test(compact)) return [];
  if (/[가-힣A-Za-z]/.test(compact.replace(/월|일|출발|확정|가능|최저가/g, ''))) return [];

  const normalized = compact.replace(/[.]/g, '/').replace(/월/g, '/').replace(/일/g, '');
  const tokens = normalized.split(/[,，、|]+/).map(token => token.trim()).filter(Boolean);
  const dates: string[] = [];
  let month: number | null = null;

  for (const token of tokens) {
    const explicit = token.match(/^(\d{1,2})[./](\d{1,2})$/);
    if (explicit) {
      month = Number(explicit[1]);
      const iso = isoDate(inferYearForMonth(month, yearHint), month, Number(explicit[2]));
      if (iso) dates.push(iso);
      continue;
    }

    const dayOnly = token.match(/^\d{1,2}$/);
    if (dayOnly && month != null) {
      const iso = isoDate(inferYearForMonth(month, yearHint), month, Number(token));
      if (iso) dates.push(iso);
    }
  }

  return [...new Set(dates)];
}

function extractBareVerticalGradeDateRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex(line => /^(?:상품\s*가|판매\s*가)$/.test(line));
  if (headerIndex < 0) return [];
  const byDate = new Map<string, MatrixPriceRow>();
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const dates = parseDateListLine(lines[i], options.year);
    if (dates.length === 0) continue;
    const prices: number[] = [];
    let cursor = i + 1;
    for (; cursor < Math.min(lines.length, i + 8); cursor++) {
      if (parseDateListLine(lines[cursor], options.year).length > 0) break;
      if (isKoreanStopSection(lines[cursor])) break;
      const price = parseKrwPrice(lines[cursor]);
      if (price > 0) prices.push(price);
      else if (prices.length > 0) break;
    }
    const price = pickProductPrice(prices, options);
    if (price <= 0) continue;
    for (const date of dates) {
      byDate.set(date, {
        date,
        adult_price: price,
        child_price: null,
        note: 'source_vertical_grade_price',
        status: 'available',
      });
    }
    i = Math.max(i, cursor - 1);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function sliceProductPriceSection(rawText: string): string {
  const startMatch = rawText.match(/^\s*(?:상품\s*가|판매\s*가|요금\s*표|출발\s*일\s*(?:&|및)?\s*상품\s*가|출발\s*일자|출발\s*날짜)\s*$/m);
  if (!startMatch?.index && startMatch?.index !== 0) return '';

  const start = startMatch.index;
  const tail = rawText.slice(start);
  const stop = tail.search(/^\s*(?:포\s*함\s*(?:내역|사항)|불\s*포함|일정표?|여행\s*일정|일\s*시|1\s*일|DAY\s*1|취소|예약|호텔|항공|비\s*고|쇼핑|옵션)(?=\s|$)/m);
  return stop > 0 ? tail.slice(0, stop) : tail;
}

function hasNormalKoreanVerticalPriceSignal(rawText: string): boolean {
  return /[가-힣]/.test(rawText)
    && /(출\s*발\s*(?:날짜|일|일자)|상\s*품\s*가|상품가|판매가)/.test(rawText);
}

function parseKoreanMonthHeading(line: string): number | null {
  const match = line.replace(/\s+/g, '').match(/^(\d{1,2})월$/);
  const month = Number(match?.[1]);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

function parseKoreanDateLine(line: string, context: { month: number | null; year?: number }): string[] {
  const cleaned = line
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[월화수목금토일]요일/g, ' ')
    .replace(/[，、]/g, ',')
    .trim();
  const dates: string[] = [];
  let currentMonth = context.month;

  for (const match of cleaned.matchAll(/(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일?/g)) {
    const explicitMonth = Number(match[1]);
    if (Number.isInteger(explicitMonth) && explicitMonth >= 1 && explicitMonth <= 12) {
      currentMonth = explicitMonth;
    }
    const month = Number(currentMonth);
    const day = Number(match[2]);
    if (!Number.isInteger(month) || !Number.isInteger(day)) continue;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const iso = isoDate(inferYearForMonth(month, context.year), month, day);
    if (iso) dates.push(iso);
  }

  return [...new Set(dates)];
}

function compactDurationDays(line: string): number | null {
  const compact = line.replace(/\s+/gu, '').toUpperCase();
  const latin = compact.match(/\b\d{1,2}N(\d{1,2})D\b/u);
  const korean = compact.match(/\d{1,2}박(\d{1,2})일/u);
  const value = Number(latin?.[1] ?? korean?.[1] ?? '');
  return Number.isInteger(value) && value > 1 && value < 31 ? value : null;
}

/**
 * Resolves a strict HWP visual-row inversion where the exported text is
 * `amount -> date` instead of `date -> amount`. The rule only activates when
 * the source declares both date and amount columns, the lines are adjacent,
 * and a duration axis is present. This prevents a nearby guide fee, ticketing
 * deadline, or closed-date notice from being paired as a package price.
 */
function extractKoreanAmountBeforeDateRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const lines = rawText.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const header = lines.slice(0, 24).join(' ');
  if (!/(?:날\s*짜|출\s*발\s*일)/u.test(header) || !/(?:금\s*액|상\s*품\s*가|판\s*매\s*가)/u.test(header)) return [];

  const wantedDuration = typeof options.durationDays === 'number' && options.durationDays > 0
    ? options.durationDays
    : null;
  const rows: MatrixPriceRow[] = [];
  const durationMarkers = lines.slice(0, 100).flatMap((line, index) => {
    const duration = compactDurationDays(line);
    return duration == null ? [] : [{ index, duration }];
  });
  for (let markerIndex = 0; markerIndex < durationMarkers.length; markerIndex += 1) {
    const marker = durationMarkers[markerIndex]!;
    if (wantedDuration != null && marker.duration !== wantedDuration) continue;
    const end = Math.min(durationMarkers[markerIndex + 1]?.index ?? lines.length, 100);
    const blockIndexes = Array.from({ length: Math.max(0, end - marker.index - 1) }, (_, offset) => marker.index + offset + 1);
    const firstPriceIndex = blockIndexes.find(index => parseKrwPrice(lines[index]!) > 0) ?? -1;
    const firstDateIndex = blockIndexes.find(index => (
      /\d{1,2}\s*월/u.test(lines[index]!)
      && /\d{1,2}\s*일/u.test(lines[index]!)
      && !/(?:발권|예약|입금|마감|싱글|추가|불포함|포함)/u.test(lines[index]!)
    )) ?? -1;
    // Do not reinterpret an ordinary date->amount table by pairing each
    // amount with the following row's date. The visual inversion must be
    // proven once for the whole duration block.
    if (firstPriceIndex < 0 || firstDateIndex < 0 || firstPriceIndex >= firstDateIndex) continue;

    for (const index of blockIndexes) {
      if (index + 1 >= end) continue;
      if (/(?:커미션|commission|\bcomm?\b|수수료|싱글|아동|소아|유류|가이드|기사|현지비|옵션|선택|발권|마감|잔여)/iu.test(lines[index]!)) continue;
      const price = parseKrwPrice(lines[index]!);
      if (price <= 0) continue;
      const dateLine = lines[index + 1]!;
      if (!/\d{1,2}\s*월/u.test(dateLine) || !/\d{1,2}\s*일/u.test(dateLine)) continue;
      if (/(?:발권|예약|입금|마감|싱글|추가|불포함|포함)/u.test(dateLine)) continue;
      const dates = parseKoreanDateLine(dateLine, { month: null, year: options.year });
      if (dates.length === 0 || dates.length > 31) continue;
      for (const date of dates) {
        rows.push({
          date,
          adult_price: price,
          child_price: null,
          note: `source_korean_amount_before_date:${marker.duration}d`,
          status: 'available',
          option_type: wantedDuration == null ? 'duration' : null,
          option_label: wantedDuration == null ? `${marker.duration}일` : null,
        });
      }
    }
  }

  const byKey = new Map<string, MatrixPriceRow>();
  for (const row of rows) byKey.set(`${row.date}|${row.adult_price}|${row.option_label ?? ''}`, row);
  return [...byKey.values()].sort((left, right) => left.date.localeCompare(right.date) || left.adult_price - right.adult_price);
}

function extractKoreanDateBeforeAmountRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const lines = rawText.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const header = lines.slice(0, 24).join(' ');
  if (!/(?:날\s*짜|출\s*발\s*일)/u.test(header) || !/(?:금\s*액|상\s*품\s*가|판\s*매\s*가)/u.test(header)) return [];
  const wantedDuration = typeof options.durationDays === 'number' && options.durationDays > 0
    ? options.durationDays
    : null;
  const markers = lines.slice(0, 100).flatMap((line, index) => {
    const duration = compactDurationDays(line);
    return duration == null ? [] : [{ index, duration }];
  });
  const rows: MatrixPriceRow[] = [];
  for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
    const marker = markers[markerIndex]!;
    if (wantedDuration != null && marker.duration !== wantedDuration) continue;
    const end = Math.min(markers[markerIndex + 1]?.index ?? lines.length, 100);
    const indexes = Array.from({ length: Math.max(0, end - marker.index - 1) }, (_, offset) => marker.index + offset + 1);
    const firstDateIndex = indexes.find(index => (
      /\d{1,2}\s*월/u.test(lines[index]!)
      && /\d{1,2}\s*일/u.test(lines[index]!)
      && !/(?:발권|예약|입금|마감|싱글|추가|불포함|포함)/u.test(lines[index]!)
    )) ?? -1;
    const firstPriceIndex = indexes.find(index => parseKrwPrice(lines[index]!) > 0) ?? -1;
    if (firstDateIndex < 0 || firstPriceIndex < 0 || firstDateIndex >= firstPriceIndex) continue;

    for (const index of indexes) {
      if (index + 1 >= end) continue;
      const dateLine = lines[index]!;
      if (!/\d{1,2}\s*월/u.test(dateLine) || !/\d{1,2}\s*일/u.test(dateLine)) continue;
      if (/(?:발권|예약|입금|마감|싱글|추가|불포함|포함)/u.test(dateLine)) continue;
      const immediate = lines[index + 1]!;
      const priceLine = /^(?:(?:추석|설(?:날)?)연휴?|연휴|성수기|공휴일|특별기)$/u.test(immediate.replace(/\s+/gu, ''))
        && index + 2 < end
        ? lines[index + 2]!
        : immediate;
      if (/(?:커미션|commission|\bcomm?\b|수수료|싱글|아동|소아|유류|가이드|기사|현지비|옵션|선택|발권|마감|잔여)/iu.test(priceLine)) continue;
      const price = parseKrwPrice(priceLine);
      if (price <= 0) continue;
      const dates = parseKoreanDateLine(dateLine, { month: null, year: options.year });
      if (dates.length === 0 || dates.length > 31) continue;
      for (const date of dates) {
        rows.push({
          date,
          adult_price: price,
          child_price: null,
          note: `source_korean_date_before_amount:${marker.duration}d`,
          status: 'available',
          option_type: wantedDuration == null ? 'duration' : null,
          option_label: wantedDuration == null ? `${marker.duration}일` : null,
        });
      }
    }
  }
  const byKey = new Map<string, MatrixPriceRow>();
  for (const row of rows) byKey.set(`${row.date}|${row.adult_price}|${row.option_label ?? ''}`, row);
  return [...byKey.values()].sort((left, right) => left.date.localeCompare(right.date) || left.adult_price - right.adult_price);
}

/**
 * Resolves supplier headers that list one or more departure dates followed by
 * their shared amount. `별도문의`/`마감` closes the pending date group without
 * inventing a price. Parsing stops before the itinerary/commercial body so a
 * later fee cannot be attached to header dates.
 */
function extractKoreanGroupedDatesBeforePriceRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  if (!options.year || compactDurationDays(rawText.split(/\r?\n/u).slice(0, 12).join(' ')) == null) return [];
  const allLines = rawText.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const stop = allLines.findIndex((line, index) => index > 4 && (
    /^---+$/u.test(line)
    || /^(?:최소\s*출발|포\s*함\s*(?:내역|사항)|불\s*포함|일\s*자)$/u.test(line.replace(/\s+/gu, ''))
    || /\b[A-Z0-9]{2}\d{3,4}\b/u.test(line)
  ));
  const lines = allLines.slice(0, stop > 0 ? stop : Math.min(allLines.length, 70));
  const gradeLabels = new Set(lines.flatMap(line => line.match(/(?:실속|품격|고품격)/gu) ?? []));
  if (gradeLabels.size >= 2) return [];
  const dateLineCount = lines.filter(line => /\d{1,2}\s*월\s*\d{1,2}\s*일/u.test(line)).length;
  const saleLineCount = lines.filter(line => parseKrwPrice(line) > 0).length;
  if (dateLineCount < 2 || saleLineCount < 2) return [];
  const firstDateIndex = lines.findIndex(line => /\d{1,2}\s*월\s*\d{1,2}\s*일/u.test(line));
  const firstPriceIndex = lines.findIndex(line => parseKrwPrice(line) > 0);
  if (firstDateIndex < 0 || firstPriceIndex < 0 || firstDateIndex >= firstPriceIndex) return [];

  const rows: MatrixPriceRow[] = [];
  let pendingDates: string[] = [];
  for (const line of lines) {
    const dates = /^\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*[,，]\s*\d{1,2}\s*일?)*$/u.test(line)
      ? parseKoreanDateLine(line, { month: null, year: options.year })
      : [];
    if (dates.length > 0) {
      pendingDates.push(...dates);
      continue;
    }
    if (/^(?:별도\s*문의|문의|마감|대기|판매\s*종료)/u.test(line)) {
      pendingDates = [];
      continue;
    }
    if (pendingDates.length === 0) continue;
    if (/^(?:(?:추석|설(?:날)?)연휴?|연휴|성수기|공휴일|한글날연휴|개천절연휴)$/u.test(line.replace(/[\[\]()\s]/gu, ''))) continue;
    if (/(?:커미션|commission|\bcomm?\b|수수료|싱글|아동|소아|유류|가이드|기사|현지비|옵션|선택|발권|예약금)/iu.test(line)) continue;
    const price = parseKrwPrice(line);
    if (price <= 0) continue;
    for (const date of [...new Set(pendingDates)]) {
      rows.push({
        date,
        adult_price: price,
        child_price: null,
        note: 'source_korean_grouped_dates_before_price',
        status: 'available',
      });
    }
    pendingDates = [];
  }
  const byKey = new Map<string, MatrixPriceRow>();
  for (const row of rows) byKey.set(`${row.date}|${row.adult_price}`, row);
  return [...byKey.values()].sort((left, right) => left.date.localeCompare(right.date) || left.adult_price - right.adult_price);
}

/**
 * Resolves the common HWP vertical export where one amount is followed by
 * several month/day rows until the next amount:
 *
 *   900,000
 *   4월 20,22,27,29
 *   4월 21,26,28
 *   950,000
 *   6월 10,17,24
 *
 * The visual table has already established the amount→date direction. We
 * only activate when a sale header appears before both the first amount and
 * first date, and we retain every date as an explicit source row. No value is
 * inferred from a neighbouring product or from a cheapest/majority choice.
 */
function extractKoreanAmountBeforeGroupedDateRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  if (!options.year) return [];
  const lines = rawText.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex(line => /^(?:판매\s*가|상품\s*가|요금\s*표)$/u.test(line));
  if (headerIndex < 0) return [];

  const stopIndex = lines.findIndex((line, index) => index > headerIndex && (
    /^(?:포\s*함\s*(?:내역|사항)?|불\s*포함|선택\s*관광|쇼핑|비\s*고|취소|예약\s*조건)$/u.test(line)
    || /^(?:제\s*1\s*일|DAY\s*1|일\s*정\s*표)$/iu.test(line)
  ));
  const end = stopIndex > headerIndex ? stopIndex : lines.length;
  const body = lines.slice(headerIndex + 1, end);
  const dateRows = body.flatMap((line, index) => {
    const dates = parseKoreanDateLine(line, { month: null, year: options.year });
    return dates.length > 0 && /\d{1,2}\s*월/u.test(line)
      ? [{ index, dates }]
      : [];
  });
  const amountIndexes = body.flatMap((line, index) => {
    if (/(?:커미션|commission|수수료|싱글|아동|소아|유류|가이드|기사|현지비|옵션|선택|예약금|계약금|발권|마감)/iu.test(line)) return [];
    const amount = parseKrwPrice(line);
    return amount > 0 && parseKoreanDateLine(line, { month: null, year: options.year }).length === 0
      ? [{ index, amount }]
      : [];
  });
  const firstDate = dateRows[0]?.index ?? -1;
  const firstAmount = amountIndexes[0]?.index ?? -1;
  if (firstDate < 0 || firstAmount < 0 || firstAmount >= firstDate) return [];

  const rows: MatrixPriceRow[] = [];
  for (const amountRow of amountIndexes) {
    const nextAmountIndex = amountIndexes.find(row => row.index > amountRow.index)?.index ?? Number.MAX_SAFE_INTEGER;
    const dates = dateRows
      .filter(row => row.index > amountRow.index && row.index < nextAmountIndex && row.index <= amountRow.index + 12)
      .flatMap(row => row.dates);
    if (dates.length === 0) continue;
    for (const date of [...new Set(dates)]) {
      rows.push({
        date,
        adult_price: amountRow.amount,
        child_price: null,
        note: 'source_korean_amount_before_grouped_dates',
        status: 'available',
      });
    }
  }
  const byKey = new Map<string, MatrixPriceRow>();
  for (const row of rows) byKey.set(`${row.date}|${row.adult_price}`, row);
  return [...byKey.values()].sort((left, right) => left.date.localeCompare(right.date) || left.adult_price - right.adult_price);
}

function distributePrices(dates: string[], prices: number[]): MatrixPriceRow[] {
  if (dates.length === 0 || prices.length === 0) return [];
  if (prices.length === 1) {
    return dates.map(date => ({
      date,
      adult_price: prices[0],
      child_price: null,
      note: 'source_korean_vertical_price',
      status: 'available',
    }));
  }

  const rows: MatrixPriceRow[] = [];
  const groupSize = Math.ceil(dates.length / prices.length);
  for (let i = 0; i < dates.length; i++) {
    rows.push({
      date: dates[i],
      adult_price: prices[Math.min(prices.length - 1, Math.floor(i / groupSize))],
      child_price: null,
      note: 'source_korean_vertical_price',
      status: 'available',
    });
  }
  return rows;
}

function extractKoreanDepartureDateBlockRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const byDate = new Map<string, MatrixPriceRow>();
  const wantedDuration = typeof options.durationDays === 'number' && options.durationDays > 0
    ? options.durationDays
    : null;

  for (let i = 0; i < lines.length; i++) {
    // Some supplier tables label the commercial departure row as `여행일`
    // instead of `출발일`. Keep this exact-label only: `여행일정` is an
    // itinerary heading and must never open a price/date block.
    if (!/^(?:출\s*발\s*(?:날짜|일|일자)|여\s*행\s*일)$/.test(lines[i])) continue;
    const nearbyTitle = lines.slice(Math.max(0, i - 4), i).reverse().find(line => /PKG|패키지|박\s*\d+\s*일/.test(line));
    const durationMatch = nearbyTitle?.match(/(\d+)\s*박\s*(\d+)\s*일/);
    if (wantedDuration != null && durationMatch && Number(durationMatch[2]) !== wantedDuration) continue;

    const dates: string[] = [];
    let month: number | null = null;
    let j = i + 1;

    for (; j < lines.length && j < i + 24; j++) {
      if (/^(출발인원|상\s*품\s*가|상품가|판매가|룸\s*타\s*입|포\s*함)$/.test(lines[j])) break;
      const headingMonth = parseKoreanMonthHeading(lines[j]);
      if (headingMonth) {
        month = headingMonth;
        continue;
      }
      dates.push(...parseKoreanDateLine(lines[j], { month, year: options.year }));
    }

    // HWP visual cells can be emitted in a different text order from their
    // row/column order. Accept one explicitly sale-labelled amount immediately
    // before the following 상품가 header; multiple amounts remain ambiguous.
    const precedingPrices = lines
      .slice(i + 1, j)
      .filter(line => /(?:특가|판매가|상품가|행사가)/.test(line))
      .map(parseKrwPrice)
      .filter(price => price > 0);
    while (j < lines.length && !/^상\s*품\s*가$|^상품가$|^판매가$/.test(lines[j])) j++;
    const prices: number[] = [];
    for (let k = j + 1; k < lines.length && k < j + 8; k++) {
      const price = parseKrwPrice(lines[k]);
      if (price > 0) prices.push(price);
      else if (prices.length > 0) break;
    }
    if (prices.length === 0 && new Set(precedingPrices).size === 1) {
      prices.push(precedingPrices[0]!);
    }

    for (const row of distributePrices([...new Set(dates)], prices)) byDate.set(row.date, row);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function extractKoreanMonthDurationRows(rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const byDate = new Map<string, MatrixPriceRow>();
  let currentMonth: number | null = null;
  const wantedDuration = typeof options.durationDays === 'number' && options.durationDays > 0
    ? options.durationDays
    : null;

  for (let i = 0; i < lines.length; i++) {
    const headingMonth = parseKoreanMonthHeading(lines[i]);
    if (headingMonth) {
      currentMonth = headingMonth;
      continue;
    }

    if (!/^\([월화수목금토일]\)/.test(lines[i])) continue;
    const dates = parseKoreanDateLine(lines[i], { month: currentMonth, year: options.year });
    if (dates.length === 0 || dates.length > 20) continue;

    let durationMatches = wantedDuration == null;
    let price = 0;
    for (let j = i + 1; j < lines.length && j < i + 5; j++) {
      const durationMatch = lines[j].match(/(\d+)\s*박\s*(\d+)\s*일/);
      if (durationMatch) {
        durationMatches = wantedDuration == null || Number(durationMatch[2]) === wantedDuration;
        continue;
      }
      price = parseKrwPrice(lines[j]);
      if (price > 0) break;
      if (parseKoreanMonthHeading(lines[j])) break;
    }
    if (!durationMatches || price <= 0) continue;

    for (const date of dates) {
      byDate.set(date, {
        date,
        adult_price: price,
        child_price: null,
        note: 'source_korean_month_duration_price',
        status: 'available',
      });
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function extractProductPriceVerticalDateRows(
  rawText: string,
  options: PriceIROptions = {},
): MatrixPriceRow[] {
  const sourceKoreanRows = [
    ...extractKoreanDepartureLinePriceRows(rawText, options),
    ...extractKoreanAmountBeforeDateRows(rawText, options),
    ...extractKoreanAmountBeforeGroupedDateRows(rawText, options),
    ...extractKoreanDateBeforeAmountRows(rawText, options),
    ...extractKoreanGroupedDatesBeforePriceRows(rawText, options),
    ...extractKoreanDurationSectionPriceRows(rawText, options),
    ...extractKoreanGradeDatePriceRows(rawText, options),
    ...extractKoreanHotelMonthDayRows(rawText, options),
  ];
  if (sourceKoreanRows.length > 0) {
    const byKey = new Map<string, MatrixPriceRow>();
    for (const row of sourceKoreanRows) byKey.set(`${row.date}|${row.adult_price}|${row.note ?? ''}`, row);
    return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
  }

  const bareVerticalGradeRows = extractBareVerticalGradeDateRows(rawText, options);
  if (bareVerticalGradeRows.length > 0) return bareVerticalGradeRows;

  if (hasNormalKoreanVerticalPriceSignal(rawText)) {
    const koreanRows = [
      ...extractKoreanDepartureDateBlockRows(rawText, options),
      ...extractKoreanMonthDurationRows(rawText, options),
    ];
    if (koreanRows.length > 0) {
      const byKey = new Map<string, MatrixPriceRow>();
      for (const row of koreanRows) byKey.set(`${row.date}|${row.adult_price}`, row);
      return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
    }
  }

  const section = sliceProductPriceSection(rawText);
  if (!section) return [];

  const lines = section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const rows: MatrixPriceRow[] = [];
  const byDate = new Map<string, MatrixPriceRow>();

  for (let i = 0; i < lines.length; i++) {
    const dates = parseDateListLine(lines[i], options.year);
    if (dates.length === 0) continue;

    const prices: number[] = [];
    let priceIndex = i + 1;
    for (; priceIndex < Math.min(lines.length, i + 8); priceIndex++) {
      if (parseDateListLine(lines[priceIndex], options.year).length > 0) break;
      const price = parseKrwPrice(lines[priceIndex]);
      if (price > 0) prices.push(price);
      else if (prices.length > 0) break;
    }
    const price = pickProductPrice(prices, options);
    if (price <= 0) continue;

    for (const date of dates) {
      byDate.set(date, {
        date,
        adult_price: price,
        child_price: null,
        note: '상품가',
        status: 'available',
      });
    }
    i = Math.max(i, priceIndex - 1);
  }

  rows.push(...byDate.values());
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
