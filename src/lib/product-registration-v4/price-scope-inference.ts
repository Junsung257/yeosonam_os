import { sha256Hex } from './document-ir';
import type { V3LedgerVariant } from '@/lib/product-registration-v3/types';

type Variant = {
  price_calendar: V3LedgerVariant['price_calendar'];
  evidence_coverage?: { price?: boolean; [key: string]: unknown };
  title_parts?: string[];
  course?: string | null;
  duration_days?: number | null;
};

type Scope = {
  start: string;
  end: string;
  weekday: number;
  sourceLineIndex: number;
  sourceLine: string;
};

const DOW: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

function iso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthEnd(year: number, month: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || month < 1 || month > 12) return null;
  const date = new Date(Date.UTC(year, month, 0));
  return `${year}-${String(month).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function normalizeLine(line: string): string {
  return line.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function scopeFromLine(line: string, year: number, sourceLineIndex: number): Scope | null {
  const value = normalizeLine(line);
  if (!/(?:출발|출발일|출발기준)/u.test(value)) return null;

  // `4월10일~5월29일 매주 화 출발`, `4/10~5/29 매주 화요일 출발`.
  const explicitRange = value.match(
    /(?:^|[^\d])(?<sm>\d{1,2})\s*(?:월|[./])\s*(?<sd>\d{1,2})\s*일?\s*[~\-–—]\s*(?:(?<em>\d{1,2})\s*(?:월|[./])\s*)?(?<ed>\d{1,2})\s*일?\s*(?:매주\s*)?(?<dow>[일월화수목금토])(?:요일)?\s*(?:출발|출발일|출발기준)/u,
  );
  if (explicitRange?.groups) {
    const start = iso(year, Number(explicitRange.groups.sm), Number(explicitRange.groups.sd));
    const end = iso(
      year,
      Number(explicitRange.groups.em ?? explicitRange.groups.sm),
      Number(explicitRange.groups.ed),
    );
    const weekday = DOW[explicitRange.groups.dow ?? ''];
    if (start && end && start <= end && weekday != null) {
      return { start, end, weekday, sourceLineIndex, sourceLine: value };
    }
  }

  // `5월 일요일 출발`, `5월 매주 일요일 출발`.
  const monthWeekday = value.match(
    /(?:^|[^\d])(?<month>\d{1,2})\s*월\s*(?:매주\s*)?(?<dow>[일월화수목금토])(?:요일)?\s*(?:출발|출발일|출발기준)/u,
  );
  if (monthWeekday?.groups) {
    const month = Number(monthWeekday.groups.month);
    const start = iso(year, month, 1);
    const end = monthEnd(year, month);
    const weekday = DOW[monthWeekday.groups.dow ?? ''];
    if (start && end && weekday != null) {
      return { start, end, weekday, sourceLineIndex, sourceLine: value };
    }
  }

  return null;
}

function sameScope(left: Scope, right: Scope): boolean {
  return left.start === right.start && left.end === right.end && left.weekday === right.weekday;
}

function nearbyScope(lines: string[], entry: V3LedgerVariant['price_calendar'][number], year: number): Scope | null {
  const lineStart = Number(entry.evidence.line_start);
  const anchor = Number.isInteger(lineStart) && lineStart > 0 ? lineStart - 1 : 0;
  const nearby: Scope[] = [];
  for (let offset = -8; offset <= 8; offset += 1) {
    const index = anchor + offset;
    if (index < 0 || index >= lines.length) continue;
    const scope = scopeFromLine(lines[index]!, year, index);
    if (scope && !nearby.some(existing => sameScope(existing, scope))) nearby.push(scope);
  }
  // A table extractor can attach the price evidence to a flattened cell line.
  // If the local window did not contain a scope, use a single unambiguous
  // schedule phrase in the section. Conflicting phrases remain unresolved.
  if (nearby.length === 0) {
    lines.forEach((line, index) => {
      const scope = scopeFromLine(line, year, index);
      if (scope && !nearby.some(existing => sameScope(existing, scope))) nearby.push(scope);
    });
  }
  return nearby.length === 1 ? nearby[0]! : null;
}

function parseDurationDays(line: string): number | null {
  const match = normalizeLine(line).match(/^(\d{1,2})\s*박\s*(\d{1,2})\s*일$/u);
  if (!match) return null;
  const nights = Number(match[1]);
  const days = Number(match[2]);
  return nights >= 0 && days === nights + 1 ? days : null;
}

function parseMonthHeading(line: string): number | null {
  const match = normalizeLine(line).match(/^(\d{1,2})\s*월$/u);
  const month = Number(match?.[1]);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

function parseDayRange(line: string): { startDay: number; endDay: number } | null {
  const match = normalizeLine(line).match(/^(\d{1,2})\s*[~\-–—]\s*(\d{1,2})$/u);
  if (!match) return null;
  const startDay = Number(match[1]);
  const endDay = Number(match[2]);
  return startDay >= 1 && endDay >= startDay && endDay <= 31
    ? { startDay, endDay }
    : null;
}

function parseWeekday(line: string): number | null {
  const value = normalizeLine(line).replace(/요일$/u, '');
  return value.length === 1 && DOW[value] != null ? DOW[value]! : null;
}

function parseMoneyTokens(line: string): number[] {
  const tokens = normalizeLine(line).match(/(?<!\d)(?:\d{1,3}(?:[,.]\d{3})+|\d{3,4}[,.]?)(?:\s*원)?/gu) ?? [];
  return tokens.map(token => {
    const compact = token.replace(/\s*원$/u, '').replace(/\s+/gu, '');
    if (/^\d{3,4}[,.]$/u.test(compact)) return Number(compact.slice(0, -1)) * 1000;
    const digits = compact.replace(/[,.]/gu, '');
    return Number.isFinite(Number(digits)) ? Number(digits) : NaN;
  }).filter(value => Number.isFinite(value) && value > 0);
}

/**
 * Some HWP tables flatten a price row into a compact matrix without the word
 * `출발`: `9월 / 14~30 / 토 / 2박3일 / 699,000`. The deterministic schedule
 * resolver above cannot see a scope in that shape, but the row is still safe
 * when the duration and a unique month/day/weekday tuple are present next to
 * the amount. Keep this adapter intentionally narrow; missing or competing
 * tuples remain unresolved rather than borrowing a neighboring grade.
 */
function nearbyMatrixScope(
  lines: string[],
  entry: Variant['price_calendar'][number],
  variant: Variant,
  year: number,
): Scope | null {
  const lineStart = Number(entry.evidence.line_start);
  const anchor = Number.isInteger(lineStart) && lineStart > 0 ? lineStart - 1 : 0;
  const candidates: Scope[] = [];
  let currentMonth: number | null = null;
  let currentRange: { startDay: number; endDay: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeLine(lines[index] ?? '');
    const month = parseMonthHeading(line);
    if (month != null) {
      currentMonth = month;
      currentRange = null;
      continue;
    }
    const range = parseDayRange(line);
    if (range) {
      currentRange = range;
      continue;
    }
    const durationDays = parseDurationDays(line);
    if (durationDays == null || variant.duration_days !== durationDays || !currentMonth || !currentRange) continue;
    const weekday = parseWeekday(lines[index - 1] ?? '');
    if (weekday == null) continue;
    // The price cells follow the duration marker in a flattened table. Match
    // the current amount inside that row before accepting its date scope;
    // otherwise a same-duration row for another grade/month could be borrowed.
    const rowAmounts = lines
      .slice(index, Math.min(lines.length, index + 8))
      .flatMap(value => parseMoneyTokens(value));
    if (!rowAmounts.includes(Number(entry.amount))) continue;
    const startDate = iso(year, currentMonth, currentRange.startDay);
    const endDate = iso(year, currentMonth, currentRange.endDay);
    if (!startDate || !endDate || startDate > endDate) continue;
    candidates.push({
      start: startDate,
      end: endDate,
      weekday,
      sourceLineIndex: index,
      sourceLine: [
        normalizeLine(lines[index - 3] ?? ''),
        normalizeLine(lines[index - 2] ?? ''),
        normalizeLine(lines[index - 1] ?? ''),
        line,
      ].filter(Boolean).join(' | '),
    });
  }
  const unique = candidates.filter((candidate, index, all) => (
    all.findIndex(other => sameScope(other, candidate)) === index
  ));
  return unique.length === 1 ? unique[0]! : null;
}

type ExactDateRoster = {
  dates: string[];
  sourceLineIndices: number[];
  sourceQuote: string;
};

/**
 * Reads an exact departure roster that is written next to an undated amount,
 * for example `5/27, 29 출발 기준` or a small block headed `출발 날짜` with
 * `5/28`, `6/4, 11, 18, 25`, `7/9`. Ranges and bare itinerary dates are not
 * accepted here; those are handled by the weekday/range resolver above.
 */
function exactDatesFromLine(line: string, year: number): string[] {
  const value = normalizeLine(line);
  if (/[~\-–—]/u.test(value)) return [];
  const explicit = value.match(/(?<!\d)(\d{1,2})\s*[./]\s*(\d{1,2})(?:\s*[,，]\s*(\d{1,2}))*\b/gu) ?? [];
  const monthDay = value.match(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})(?:\s*[,，]\s*(\d{1,2}))*\s*일?/gu) ?? [];
  const values = [...explicit, ...monthDay];
  const hasOnlyRosterText = values.some(token => {
    const remainder = value
      .replace(token, '')
      .replace(/[()\[\],，\s]/gu, '')
      .replace(/(?:출발|출확|기준|요일|날짜|상품가|요금|일)/gu, '');
    return remainder.length === 0;
  });
  if (!hasOnlyRosterText) return [];
  const dates: string[] = [];
  for (const token of values) {
    const slash = token.match(/^(\d{1,2})\s*[./]\s*(\d{1,2})(.*)$/u);
    const korean = token.match(/^(\d{1,2})\s*월\s*(\d{1,2})(.*)$/u);
    const month = Number(slash?.[1] ?? korean?.[1]);
    const firstDay = Number(slash?.[2] ?? korean?.[2]);
    if (!Number.isInteger(month) || !Number.isInteger(firstDay)) continue;
    const first = iso(year, month, firstDay);
    if (first) dates.push(first);
    const tail = slash?.[3] ?? korean?.[3] ?? '';
    for (const match of tail.matchAll(/[,，]\s*(\d{1,2})/gu)) {
      const date = iso(year, month, Number(match[1]));
      if (date) dates.push(date);
    }
  }
  return [...new Set(dates)].sort();
}

function nearbyExactDateRoster(lines: string[], entry: V3LedgerVariant['price_calendar'][number], year: number): ExactDateRoster | null {
  const lineStart = Number(entry.evidence.line_start);
  const anchor = Number.isInteger(lineStart) && lineStart > 0 ? lineStart - 1 : 0;
  // In table-flattened HWP, the amount row can precede the local product's
  // `출발 날짜` roster by a page header and several note rows. Keep the
  // search bounded to this product section, but allow a practical 32-line
  // local window before declaring the relation ambiguous.
  const start = Math.max(0, anchor - 32);
  const end = Math.min(lines.length, anchor + 33);
  const context = lines.slice(start, end);
  const hasDepartureHeading = context.some(line => {
    const normalized = normalizeLine(line);
    const compact = normalized.replace(/\s+/gu, '');
    return /(?:출발|출발일|출발기준|출발날짜|상품가|요금)/u.test(compact);
  });
  if (!hasDepartureHeading) return null;
  const candidates: Array<{ index: number; dates: string[]; line: string }> = [];
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? '';
    const dates = exactDatesFromLine(line, year);
    if (dates.length > 0) candidates.push({ index, dates, line: normalizeLine(line) });
  }
  if (candidates.length === 0) return null;
  const dates = [...new Set(candidates.flatMap(candidate => candidate.dates))].sort();
  return {
    dates,
    sourceLineIndices: candidates.map(candidate => candidate.index),
    sourceQuote: candidates.map(candidate => candidate.line).join(' | '),
  };
}

const TRANSPORT_CODE_RE = /\b(?:BX|LJ|VJ|VN|KE|7C|ZE|TW|OZ|CA|PR|3U)\s*\d{2,4}\b|\b(?:BX|LJ|VJ|VN|KE|7C|ZE|TW|OZ|CA|PR|3U)\b/igu;

function variantTransportCodes(variant: Variant): string[] {
  const titleParts = variant.title_parts ?? [];
  // The first title part is the local product heading. Later parts can be
  // shared-prefix text containing several carriers (e.g. `BX & LJ`), which
  // must not make a proven local `[BX]`/`[LJ]` axis look ambiguous.
  const primaryText = titleParts[0] ?? '';
  const primaryCodes = [...primaryText.toUpperCase().matchAll(TRANSPORT_CODE_RE)].map(match => {
    const token = match[0]!.match(/BX|LJ|VJ|VN|KE|7C|ZE|TW|OZ|CA|PR|3U/i)?.[0] ?? '';
    return token.toUpperCase();
  }).filter(Boolean);
  if (primaryCodes.length > 0) return [...new Set(primaryCodes)];
  const text = [...titleParts, variant.course ?? ''].join(' ');
  return [...new Set([...text.toUpperCase().matchAll(TRANSPORT_CODE_RE)].map(match => {
    const token = match[0]!.match(/BX|LJ|VJ|VN|KE|7C|ZE|TW|OZ|CA|PR|3U/i)?.[0] ?? '';
    return token.toUpperCase();
  }).filter(Boolean))];
}

function nearbyTransportCode(lines: string[], entry: V3LedgerVariant['price_calendar'][number]): string | null {
  const lineStart = Number(entry.evidence.line_start);
  const anchor = Number.isInteger(lineStart) && lineStart > 0 ? lineStart - 1 : 0;
  const codesOnLine = (index: number): string[] => [...(lines[index] ?? '').toUpperCase().matchAll(TRANSPORT_CODE_RE)]
    .map(match => match[0]!.match(/BX|LJ|VJ|VN|KE|7C|ZE|TW|OZ|CA|PR|3U/i)?.[0]?.toUpperCase())
    .filter((code): code is string => Boolean(code));
  // Prefer the nearest preceding carrier label. In a flattened card the next
  // sibling label may be only one row below the current amount (LJ amount,
  // then BX amount); scanning both sides as one set would make both prices
  // look ambiguous.
  for (let index = anchor; index >= Math.max(0, anchor - 4); index -= 1) {
    const codes = codesOnLine(index);
    if (codes.length > 0) return codes.length === 1 ? codes[0]! : null;
  }
  for (let index = anchor + 1; index <= Math.min(lines.length - 1, anchor + 4); index += 1) {
    const codes = codesOnLine(index);
    if (codes.length > 0) return codes.length === 1 ? codes[0]! : null;
  }
  return null;
}

/**
 * Connects an undated selling price to a unique, nearby source schedule.
 *
 * This is intentionally narrow: it only accepts an explicit month/weekday
 * departure rule, requires one unambiguous scope, and never fills a deposit,
 * surcharge, option, or passenger-specific row. The original price evidence
 * and the schedule evidence are both retained in the resulting quote.
 */
export function inferUndatedPriceScopesFromSchedule(input: {
  rawText: string;
  variants: Variant[];
  year: number | null | undefined;
  preferredTransportCode?: string | null;
}): { applied: number; ambiguous: number } {
  if (!Number.isInteger(input.year) || Number(input.year) < 2000) return { applied: 0, ambiguous: 0 };
  const lines = input.rawText.split(/\r?\n/u);
  let applied = 0;
  let ambiguous = 0;
  const forbidden = /(?:예약금|계약금|deposit|커미션|commission|수수료|유류할증|현지비|가이드비|선택관광|옵션)/iu;

  for (const variant of input.variants) {
    // A combined airline price card can leave both carrier rows on every
    // variant. If the local product title proves one carrier and the amount
    // evidence sits beside that carrier row, keep only that row before
    // binding dates. Without this mutual evidence we deliberately retain all
    // rows and refuse to invent an association.
    const preferredTransportCode = input.preferredTransportCode?.trim().toUpperCase() || null;
    const transportCodes = preferredTransportCode ? [preferredTransportCode] : variantTransportCodes(variant);
    if (variant.price_calendar.length > 1 && transportCodes.length === 1) {
      const matched = variant.price_calendar.filter(entry => nearbyTransportCode(lines, entry) === transportCodes[0]);
      if (matched.length > 0 && matched.length < variant.price_calendar.length) variant.price_calendar = matched;
    }
    let rosterExpanded = false;
    const updatedEntries: typeof variant.price_calendar = [];
    for (const entry of variant.price_calendar) {
      if (entry.date || entry.date_range?.start || entry.weekday != null) {
        updatedEntries.push(entry);
        continue;
      }
      if (!Number.isFinite(entry.amount) || Number(entry.amount) <= 0) {
        updatedEntries.push(entry);
        continue;
      }
      const originalQuote = String(entry.evidence.quote ?? entry.label ?? '');
      if (forbidden.test(originalQuote)) {
        updatedEntries.push(entry);
        continue;
      }
      const exactRoster = nearbyExactDateRoster(lines, entry, Number(input.year));
      if (exactRoster && exactRoster.dates.length > 0
        && (variant.price_calendar.length === 1 || (transportCodes.length === 1 && nearbyTransportCode(lines, entry) === transportCodes[0]))) {
        const makeEntry = (date: string) => ({
          ...entry,
          date,
          label: `${entry.label ?? `${entry.amount}원`} [원문 출발일 적용]`,
          evidence: {
            ...entry.evidence,
            line_start: Math.min(
              Number.isInteger(Number(entry.evidence.line_start)) && Number(entry.evidence.line_start) > 0
                ? Number(entry.evidence.line_start)
                : exactRoster.sourceLineIndices[0]! + 1,
              exactRoster.sourceLineIndices[0]! + 1,
            ),
            line_end: Math.max(
              Number.isInteger(Number(entry.evidence.line_end)) && Number(entry.evidence.line_end) > 0
                ? Number(entry.evidence.line_end)
                : exactRoster.sourceLineIndices.at(-1)! + 1,
              exactRoster.sourceLineIndices.at(-1)! + 1,
            ),
            char_start: 0,
            char_end: `${originalQuote} | ${exactRoster.sourceQuote}`.length,
            quote: `${originalQuote} | ${exactRoster.sourceQuote}`,
            quote_hash: sha256Hex(`${originalQuote} | ${exactRoster.sourceQuote}`),
          },
        });
        for (const date of exactRoster.dates) updatedEntries.push(makeEntry(date));
        applied += exactRoster.dates.length;
        rosterExpanded = true;
        continue;
      }
      const scope = nearbyScope(lines, entry, Number(input.year))
        ?? nearbyMatrixScope(lines, entry, variant, Number(input.year));
      if (!scope) {
        const hasAnySchedule = lines.some(line => scopeFromLine(line, Number(input.year), 0));
        if (hasAnySchedule) ambiguous += 1;
        updatedEntries.push(entry);
        continue;
      }
      const scopeQuote = scope.sourceLine;
      const combinedQuote = [originalQuote, scopeQuote]
        .filter(Boolean)
        .filter((quote, index, all) => all.indexOf(quote) === index)
        .join(' | ');
      entry.date = null;
      entry.date_range = { start: scope.start, end: scope.end };
      entry.weekday = scope.weekday;
      entry.label = `${entry.label ?? `${entry.amount}원`} [원문 출발요일 적용]`;
      entry.evidence = {
        ...entry.evidence,
        line_start: Math.min(
          Number.isInteger(Number(entry.evidence.line_start)) && Number(entry.evidence.line_start) > 0
            ? Number(entry.evidence.line_start)
            : scope.sourceLineIndex + 1,
          scope.sourceLineIndex + 1,
        ),
        line_end: Math.max(
          Number.isInteger(Number(entry.evidence.line_end)) && Number(entry.evidence.line_end) > 0
            ? Number(entry.evidence.line_end)
            : scope.sourceLineIndex + 1,
          scope.sourceLineIndex + 1,
        ),
        char_start: 0,
        char_end: combinedQuote.length,
        quote: combinedQuote,
        quote_hash: sha256Hex(combinedQuote),
      };
      applied += 1;
      updatedEntries.push(entry);
    }
    if (rosterExpanded) variant.price_calendar = updatedEntries;
  }
  return { applied, ambiguous };
}
