import type { MatrixPriceRow, PriceIROptions } from './types';

function parseKoreanWonPrice(line: string): number {
  const prices = [...line.matchAll(/(\d{1,3}(?:,\d{3})+|\d{5,8})\s*(?:원|KRW)?/gi)]
    .map(match => Number(match[1].replace(/,/g, '')))
    .filter(price => Number.isInteger(price) && price >= 10_000 && price <= 50_000_000);
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

  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const dates = parseKoreanDepartureDates(lines[i], options.year);
    if (dates.length === 0 || dates.length > 20) continue;

    let price = /(?:판매가|상품가|요금|행사가)/.test(lines[i])
      ? parseKoreanWonPrice(lines[i])
      : 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      if (price > 0) break;
      if (isKoreanStopSection(lines[j])) break;
      price = parseKoreanWonPrice(lines[j]);
      if (price > 0) break;
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

    const indexes = preferred != null && prices[preferred] != null
      ? [preferred]
      : prices.map((_, index) => index);
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
  const text = line.replace(/\s+/g, '');
  const match = text.match(/^(\d{1,3}(?:,\d{3})+|\d{5,8}|\d{3,4})(?:원|\/인|,-)?/);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 10000 ? value * 1000 : value;
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

function sliceProductPriceSection(rawText: string): string {
  const startMatch = rawText.match(/^\s*(?:상품\s*가|판매\s*가|요금\s*표|출발\s*일\s*(?:&|및)?\s*상품\s*가|출발\s*일자|출발\s*날짜)\s*$/m);
  if (!startMatch?.index && startMatch?.index !== 0) return '';

  const start = startMatch.index;
  const tail = rawText.slice(start);
  const stop = tail.search(/^\s*(?:포\s*함\s*(?:내역|사항)|불\s*포함|일정표?|여행\s*일정|일\s*시|1\s*일|DAY\s*1|취소|예약|호텔|항공|비\s*고|쇼핑|옵션)\b/m);
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

  for (const match of cleaned.matchAll(/(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일?/g)) {
    const month = Number(match[1] ?? context.month);
    const day = Number(match[2]);
    if (!Number.isInteger(month) || !Number.isInteger(day)) continue;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const iso = isoDate(inferYearForMonth(month, context.year), month, day);
    if (iso) dates.push(iso);
  }

  return [...new Set(dates)];
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
    if (!/^출\s*발\s*(?:날짜|일|일자)$/.test(lines[i])) continue;
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

    while (j < lines.length && !/^상\s*품\s*가$|^상품가$|^판매가$/.test(lines[j])) j++;
    const prices: number[] = [];
    for (let k = j + 1; k < lines.length && k < j + 8; k++) {
      const price = parseKrwPrice(lines[k]);
      if (price > 0) prices.push(price);
      else if (prices.length > 0) break;
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
    ...extractKoreanGradeDatePriceRows(rawText, options),
    ...extractKoreanHotelMonthDayRows(rawText, options),
  ];
  if (sourceKoreanRows.length > 0) {
    const byKey = new Map<string, MatrixPriceRow>();
    for (const row of sourceKoreanRows) byKey.set(`${row.date}|${row.adult_price}|${row.note ?? ''}`, row);
    return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
  }

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
