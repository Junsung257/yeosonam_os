import type { V3PriceCalendarEntry } from '@/lib/product-registration-v3/types';

export const PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION = 'source-departure-date-policy-4';
export const PRODUCT_SOURCE_DEPARTURE_TIMEZONE = 'Asia/Seoul' as const;
export const PRODUCT_YEARLESS_ROLLOVER_MAX_DAYS = 184;

export type ProductSourceDepartureDateAuthority =
  | 'document_text'
  | 'filename'
  | 'upload_envelope'
  | 'nearest_future_policy'
  | 'missing'
  | 'conflicting';

export type ProductSourceDepartureDateResolution = {
  authority: ProductSourceDepartureDateAuthority;
  reference_date: string;
  timezone: typeof PRODUCT_SOURCE_DEPARTURE_TIMEZONE;
  policy_version: 'source-departure-date-policy-2' | 'source-departure-date-policy-3' | typeof PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION;
  disposition: 'future' | 'range_clipped' | 'past_excluded' | 'invalid_blocked';
  original_date?: string | null;
  original_range?: { start: string; end: string } | null;
};

export type ResolvedV3PriceCalendarEntry = V3PriceCalendarEntry & {
  date_resolution?: ProductSourceDepartureDateResolution;
};

export type ProductDepartureCalendarPolicyResult = {
  entries: ResolvedV3PriceCalendarEntry[];
  originalDatedEntryCount: number;
  futureDatedEntryCount: number;
  inferredDateCount: number;
  explicitDateCount: number;
  excludedPastDateCount: number;
  clippedRangeCount: number;
  invalidDateCount: number;
  undatedEntryCount: number;
  blockers: string[];
  disposition: 'eligible_future' | 'past_entries_removed' | 'past_only_excluded' | 'undated_or_invalid';
};

type DepartureCalendarPolicyInput = {
  entries: V3PriceCalendarEntry[];
  authority: ProductSourceDepartureDateAuthority;
  referenceDate: string;
};

type MonthDay = { month: number; day: number };

export type ExplicitSourceDepartureWindow = {
  start: string;
  end: string;
  quote: string;
};

function iso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIsoDate(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return iso(year, month, day) === value ? { year, month, day } : null;
}

function isoWeekday(value: string): number | null {
  if (!parseIsoDate(value)) return null;
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

function fullYear(value: string): number {
  return value.length === 2 ? 2000 + Number(value) : Number(value);
}

/**
 * Reads only a fully dated departure window that is physically attached to a
 * departure heading. It is intentionally narrower than the general date
 * parser: this helper is used to discard an entirely expired mixed-year
 * calendar, never to manufacture future sale dates.
 */
export function resolveExplicitSourceDepartureWindow(text: string): ExplicitSourceDepartureWindow | null {
  const normalized = text.normalize('NFKC');
  const heading = /\uCD9C\s*\uBC1C(?:\s*\uC77C|\s*\uB0A0\s*\uC9DC|\s*\uAE30\s*\uAC04)?/gu;
  const range = /(20\d{2}|\d{2})\s*\uB144\s*(\d{1,2})\s*\uC6D4\s*(?:(\d{1,2})\s*\uC77C)?\s*[~\-\u2013\u2014\u301C]\s*(20\d{2}|\d{2})\s*\uB144\s*(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C/gu;
  const compactRange = /(20\d{2}|\d{2})\s*\uB144\s*(\d{1,2})\s*(?:\uC6D4\s*|[./-]\s*)(\d{1,2})\s*(?:\uC77C)?\s*[~\-\u2013\u2014\u301C]\s*(?:(20\d{2}|\d{2})\s*\uB144\s*)?(\d{1,2})\s*(?:\uC6D4\s*|[./-]\s*)(\d{1,2})\s*(?:\uC77C)?/gu;
  const windows: ExplicitSourceDepartureWindow[] = [];
  for (const match of normalized.matchAll(heading)) {
    const nearby = normalized.slice(match.index, match.index + 220);
    range.lastIndex = 0;
    const period = range.exec(nearby);
    if (period) {
      const startYear = fullYear(period[1]!);
      const endYear = fullYear(period[4]!);
      const startMonth = Number(period[2]);
      const endMonth = Number(period[5]);
      const endDay = Number(period[6]);
      const startDay = period[3] ? Number(period[3]) : 1;
      const start = iso(startYear, startMonth, startDay);
      const end = iso(endYear, endMonth, endDay);
      if (start && end && end >= start) windows.push({ start, end, quote: period[0] });
    }
    compactRange.lastIndex = 0;
    const compact = compactRange.exec(nearby);
    if (!compact) continue;
    const startYear = fullYear(compact[1]!);
    const endYear = compact[4] ? fullYear(compact[4]) : startYear;
    const start = iso(startYear, Number(compact[2]), Number(compact[3]));
    const end = iso(endYear, Number(compact[5]), Number(compact[6]));
    if (start && end && end >= start) windows.push({ start, end, quote: compact[0].trim() });
  }
  const unique = [...new Map(windows.map(window => [`${window.start}|${window.end}`, window])).values()];
  return unique.length === 1 ? unique[0]! : null;
}

function monthDayKey(value: MonthDay): number {
  return value.month * 100 + value.day;
}

function explicitYearInEntry(entry: V3PriceCalendarEntry): boolean {
  const evidenceQuote = typeof entry.evidence?.quote === 'string' ? entry.evidence.quote : '';
  return /(?:^|\D)(?:20\d{2}\s*(?:년|[.\-/]\s*\d{1,2})|2\d\s*년|2\d\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})/u
    .test(`${entry.label}\n${evidenceQuote}`);
}

function resolution(
  authority: ProductSourceDepartureDateAuthority,
  referenceDate: string,
  disposition: ProductSourceDepartureDateResolution['disposition'],
  originalDate?: string | null,
  originalRange?: { start: string; end: string } | null,
): ProductSourceDepartureDateResolution {
  return {
    authority,
    reference_date: referenceDate,
    timezone: PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
    policy_version: PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
    disposition,
    ...(originalDate !== undefined ? { original_date: originalDate } : {}),
    ...(originalRange !== undefined ? { original_range: originalRange } : {}),
  };
}

export function seoulDateFromInstant(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('SOURCE_DEPARTURE_REFERENCE_INSTANT_INVALID');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const result = `${values.year}-${values.month}-${values.day}`;
  if (!parseIsoDate(result)) throw new Error('SOURCE_DEPARTURE_REFERENCE_DATE_INVALID');
  return result;
}

export function assertProductDepartureReferenceDate(value: string): string {
  if (!parseIsoDate(value)) throw new Error('SOURCE_DEPARTURE_REFERENCE_DATE_INVALID');
  return value;
}

export function resolveNearestFutureMonthDay(input: {
  month: number;
  day: number;
  referenceDate: string;
}): string | null {
  const reference = parseIsoDate(assertProductDepartureReferenceDate(input.referenceDate))!;
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = iso(reference.year + offset, input.month, input.day);
    if (!candidate || candidate < input.referenceDate) continue;
    const daysAhead = Math.floor((Date.parse(`${candidate}T00:00:00.000Z`) - Date.parse(`${input.referenceDate}T00:00:00.000Z`)) / 86_400_000);
    // A yearless January near year-end is a normal next-year schedule. A
    // supplier row that already passed many months ago is stale inventory,
    // not evidence for the same date one year later. Keep inference inside a
    // bounded selling horizon instead of silently manufacturing next season.
    return daysAhead <= PRODUCT_YEARLESS_ROLLOVER_MAX_DAYS ? candidate : null;
  }
  return null;
}

export function resolveNearestFutureRange(input: {
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  referenceDate: string;
}): { start: string; end: string; clipped: boolean } | null {
  const reference = parseIsoDate(assertProductDepartureReferenceDate(input.referenceDate))!;
  const startMonthDay = { month: input.startMonth, day: input.startDay };
  const endMonthDay = { month: input.endMonth, day: input.endDay };
  const crossesYear = monthDayKey(endMonthDay) < monthDayKey(startMonthDay);
  for (let offset = 0; offset <= 8; offset += 1) {
    const startYear = reference.year + offset;
    const start = iso(startYear, input.startMonth, input.startDay);
    const end = iso(startYear + (crossesYear ? 1 : 0), input.endMonth, input.endDay);
    if (!start || !end || end < start || end < input.referenceDate) continue;
    const effectiveStart = start < input.referenceDate ? input.referenceDate : start;
    const daysAhead = Math.floor((Date.parse(`${effectiveStart}T00:00:00.000Z`) - Date.parse(`${input.referenceDate}T00:00:00.000Z`)) / 86_400_000);
    if (daysAhead > PRODUCT_YEARLESS_ROLLOVER_MAX_DAYS) return null;
    return {
      start: effectiveStart,
      end,
      clipped: start < input.referenceDate,
    };
  }
  return null;
}

export function applyFutureDeparturePolicyToPriceCalendar(
  input: DepartureCalendarPolicyInput,
): ProductDepartureCalendarPolicyResult {
  const referenceDate = assertProductDepartureReferenceDate(input.referenceDate);
  const entries: ResolvedV3PriceCalendarEntry[] = [];
  const blockers: string[] = [];
  let originalDatedEntryCount = 0;
  let futureDatedEntryCount = 0;
  let inferredDateCount = 0;
  let explicitDateCount = 0;
  let excludedPastDateCount = 0;
  let clippedRangeCount = 0;
  let invalidDateCount = 0;
  let undatedEntryCount = 0;

  input.entries.forEach((entry, index) => {
    const parsedDate = parseIsoDate(entry.date);
    const range = entry.date_range;
    const parsedStart = parseIsoDate(range?.start);
    const parsedEnd = parseIsoDate(range?.end);
    const hasDate = Boolean(entry.date);
    const hasRange = Boolean(range);
    if (!hasDate && !hasRange) {
      undatedEntryCount += 1;
      entries.push(entry);
      return;
    }
    originalDatedEntryCount += 1;
    if ((hasDate && !parsedDate) || (hasRange && (
      !parsedStart
      || !parsedEnd
      || (range!.end < range!.start && input.authority !== 'nearest_future_policy')
    ))) {
      invalidDateCount += 1;
      blockers.push(`PRICE_DATE_INVALID:${index}`);
      return;
    }

    // Entry-local source evidence always wins over a document-level fallback.
    // In particular, an explicit past year must be excluded rather than rolled
    // forward by the current-upload nearest-future policy.
    const entryAuthority = explicitYearInEntry(entry)
      ? 'document_text'
      : input.authority;
    if (entryAuthority === 'conflicting' || entryAuthority === 'missing') {
      invalidDateCount += 1;
      blockers.push(`${entryAuthority === 'missing' ? 'PRICE_DATE_YEAR_MISSING' : 'PRICE_DATE_YEAR_CONFLICT'}:${index}`);
      return;
    }

    if (hasDate && parsedDate) {
      const originalDate = entry.date;
      const resolvedDate = entryAuthority === 'nearest_future_policy'
        ? resolveNearestFutureMonthDay({ month: parsedDate.month, day: parsedDate.day, referenceDate })
        : originalDate;
      if (!resolvedDate) {
        const referenceYear = parseIsoDate(referenceDate)!.year;
        const currentYearOccurrence = entryAuthority === 'nearest_future_policy'
          ? iso(referenceYear, parsedDate.month, parsedDate.day)
          : null;
        // Upstream parsers may temporarily attach the next year to a
        // yearless month/day. Once that month/day sits outside the bounded
        // selling horizon, compare the occurrence in the intake year rather
        // than treating the temporary year as source evidence. This turns
        // stale May-July rows into past exclusions instead of false blockers.
        if (
          entryAuthority === 'nearest_future_policy'
          && currentYearOccurrence
          && currentYearOccurrence < referenceDate
        ) {
          excludedPastDateCount += 1;
        } else {
          invalidDateCount += 1;
          blockers.push(`PRICE_DATE_INVALID:${index}`);
        }
        return;
      }
      if (entryAuthority === 'nearest_future_policy' && entry.weekday != null) {
        const originalWeekday = isoWeekday(originalDate!);
        const resolvedWeekday = isoWeekday(resolvedDate);

        // A past month/day whose supplied weekday matches the intake year's
        // calendar is evidence for that expired occurrence. Rolling it to the
        // next year would silently publish a different weekday and schedule.
        if (originalDate! < referenceDate && originalWeekday === entry.weekday) {
          excludedPastDateCount += 1;
          return;
        }

        // For a genuinely upcoming yearless date, the source weekday must
        // agree with the nearest-future candidate. Never search farther years
        // merely to make the weekday fit a stale supplier document.
        if (resolvedWeekday !== entry.weekday) {
          invalidDateCount += 1;
          blockers.push(`PRICE_DATE_WEEKDAY_CONFLICT:${index}`);
          return;
        }
      }
      if (resolvedDate < referenceDate) {
        excludedPastDateCount += 1;
        return;
      }
      if (entryAuthority === 'nearest_future_policy') inferredDateCount += 1;
      else explicitDateCount += 1;
      futureDatedEntryCount += 1;
      entries.push({
        ...entry,
        date: resolvedDate,
        date_resolution: resolution(entryAuthority, referenceDate, 'future', originalDate, null),
      });
      return;
    }

    const originalRange = { start: range!.start, end: range!.end };
    const resolvedRange = entryAuthority === 'nearest_future_policy'
      ? resolveNearestFutureRange({
          startMonth: parsedStart!.month,
          startDay: parsedStart!.day,
          endMonth: parsedEnd!.month,
          endDay: parsedEnd!.day,
          referenceDate,
        })
      : range!.end < referenceDate
        ? null
        : {
            start: range!.start < referenceDate ? referenceDate : range!.start,
            end: range!.end,
            clipped: range!.start < referenceDate,
          };
    if (!resolvedRange) {
      excludedPastDateCount += 1;
      return;
    }
    if (resolvedRange.clipped) clippedRangeCount += 1;
    if (entryAuthority === 'nearest_future_policy') inferredDateCount += 1;
    else explicitDateCount += 1;
    futureDatedEntryCount += 1;
    entries.push({
      ...entry,
      date: null,
      date_range: { start: resolvedRange.start, end: resolvedRange.end },
      date_resolution: resolution(
        entryAuthority,
        referenceDate,
        resolvedRange.clipped ? 'range_clipped' : 'future',
        null,
        originalRange,
      ),
    });
  });

  const disposition = originalDatedEntryCount > 0
    && futureDatedEntryCount === 0
    && excludedPastDateCount === originalDatedEntryCount
    && undatedEntryCount === 0
    && blockers.length === 0
    ? 'past_only_excluded'
    : futureDatedEntryCount > 0 && excludedPastDateCount > 0
      ? 'past_entries_removed'
      : futureDatedEntryCount > 0
        ? 'eligible_future'
        : 'undated_or_invalid';

  return {
    entries,
    originalDatedEntryCount,
    futureDatedEntryCount,
    inferredDateCount,
    explicitDateCount,
    excludedPastDateCount,
    clippedRangeCount,
    invalidDateCount,
    undatedEntryCount,
    blockers,
    disposition,
  };
}
