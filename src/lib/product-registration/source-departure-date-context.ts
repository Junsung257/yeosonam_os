export const PRODUCT_SOURCE_DEPARTURE_DATE_CONTEXT_VERSION = 'source-departure-date-context-1' as const;

export type TrustedFilenameDepartureDates = {
  dates: string[];
  authority: 'filename';
  version: typeof PRODUCT_SOURCE_DEPARTURE_DATE_CONTEXT_VERSION;
  sourceTokens: string[];
};

export type TrustedFilenameDepartureMonthWindow = {
  start: string;
  end: string;
  year: number;
  authority: 'filename';
  sourceToken: string;
};

export type TrustedSingleProductTravelPeriodStart = {
  date: string;
  end: string;
  quote: string;
  authority: 'document_text';
};

const NEGATIVE_DATE_CONTEXT_RE = /(?:발권|예약금|계약금|입금|작성|수정|업데이트|최종\s*수정|마감|취소|환불|유효기간)/u;

function isoDate(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function expandedYear(value: string): number {
  return value.length === 2 ? 2000 + Number(value) : Number(value);
}

function inclusiveDays(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  return Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime
    ? Math.round((endTime - startTime) / 86_400_000) + 1
    : 0;
}

/**
 * Resolves the departure day from a source travel period only when the period
 * is near the product heading and its inclusive day count exactly matches the
 * product duration. This deliberately does not treat arbitrary date ranges as
 * sale-price scopes.
 */
export function parseTrustedSingleProductTravelPeriodStart(input: {
  text: string;
  validatedYear: number;
  durationDays: number;
}): TrustedSingleProductTravelPeriodStart | null {
  if (!Number.isInteger(input.validatedYear) || input.validatedYear < 2000 || input.validatedYear > 2100) return null;
  if (!Number.isInteger(input.durationDays) || input.durationDays < 2 || input.durationDays > 31) return null;
  const heading = input.text.normalize('NFKC').slice(0, 900);
  const candidates: TrustedSingleProductTravelPeriodStart[] = [];
  const patterns = [
    /(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\([^)]{0,8}\))?\s*[~\-–—〜]\s*(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일/gu,
    /(?:^|\D)(\d{1,2})[./-](\d{1,2})\s*[~–—〜]\s*(?:(\d{1,2})[./-])?(\d{1,2})(?=$|\D)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of heading.matchAll(pattern)) {
      const startMonth = Number(match[1]);
      const startDay = Number(match[2]);
      const endMonth = Number(match[3] ?? startMonth);
      const endDay = Number(match[4]);
      const endYear = endMonth < startMonth ? input.validatedYear + 1 : input.validatedYear;
      const start = isoDate(input.validatedYear, startMonth, startDay);
      const end = isoDate(endYear, endMonth, endDay);
      if (!start || !end || inclusiveDays(start, end) !== input.durationDays) continue;
      candidates.push({ date: start, end, quote: match[0].trim(), authority: 'document_text' });
    }
  }
  const unique = [...new Map(candidates.map(candidate => [`${candidate.date}|${candidate.end}`, candidate])).values()];
  return unique.length === 1 ? unique[0]! : null;
}

/**
 * Reads a supplier filename period such as `26.6~26.11` or
 * `2026\uB144 6\uC6D4-9\uC6D4`. A month window can select a year context, but it
 * cannot create an exact departure day or a price binding by itself.
 */
export function parseTrustedDepartureMonthWindowFromFilename(filenameValue: string): TrustedFilenameDepartureMonthWindow | null {
  const filename = filenameValue.normalize('NFKC').replace(/\.(?:hwp|hwpx|pdf)$/iu, ' ');
  const matches = [...filename.matchAll(/(?:^|\D)(20\d{2}|2\d)\s*(?:\uB144\s*|[.])\s*(\d{1,2})\s*(?:\uC6D4)?\s*[~\-\u2013\u2014\u301C]\s*(?:(20\d{2}|2\d)\s*(?:\uB144\s*|[.])\s*)?(\d{1,2})\s*(?:\uC6D4)?/gu)];
  const windows = matches.flatMap(match => {
    const tokenOffset = match[0].search(/2/u);
    const index = match.index + Math.max(0, tokenOffset);
    const token = match[0].slice(Math.max(0, tokenOffset)).trim();
    if (negativeContext(filename, index, token.length)) return [];
    const startYear = expandedYear(match[1]!);
    const endYear = match[3] ? expandedYear(match[3]) : startYear;
    const startMonth = Number(match[2]);
    const endMonth = Number(match[4]);
    const start = isoDate(startYear, startMonth, 1);
    const endDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
    const end = isoDate(endYear, endMonth, endDay);
    if (!start || !end || end < start) return [];
    return [{ start, end, year: startYear, authority: 'filename' as const, sourceToken: token }];
  });
  const unique = [...new Map(windows.map(window => [`${window.start}|${window.end}`, window])).values()];
  return unique.length === 1 ? unique[0]! : null;
}

function negativeContext(filename: string, index: number, tokenLength: number): boolean {
  const before = filename.slice(Math.max(0, index - 18), index);
  // Commercial conditions often follow a valid departure token later in the
  // filename (for example `260621,28 - 3일내발권조건`). Only an immediately
  // adjacent label can describe the token itself.
  const after = filename.slice(index + tokenLength, index + tokenLength + 4);
  return NEGATIVE_DATE_CONTEXT_RE.test(`${before} ${after}`);
}

/**
 * Extracts only exact departure dates carried by the supplier filename.
 * Four-digit MMDD revision/issuance suffixes are deliberately ignored.
 */
export function parseTrustedDepartureDatesFromFilename(input: {
  filename: string;
  validatedYear?: number | null;
}): TrustedFilenameDepartureDates | null {
  const filename = input.filename.normalize('NFKC').replace(/\.(?:hwp|hwpx|pdf)$/iu, ' ');
  const byDate = new Map<string, string>();
  const push = (date: string | null, token: string) => {
    if (date && !byDate.has(date)) byDate.set(date, token);
  };

  for (const match of filename.matchAll(/\b(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})(?:일)?\b/gu)) {
    if (negativeContext(filename, match.index, match[0].length)) continue;
    push(isoDate(Number(match[1]), Number(match[2]), Number(match[3])), match[0]);
  }

  for (const match of filename.matchAll(/(?:^|\D)(2\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=$|\D)/gu)) {
    const tokenOffset = match[0].search(/2/u);
    const index = match.index + Math.max(0, tokenOffset);
    const token = `${match[1]}${match[2]}${match[3]}`;
    if (negativeContext(filename, index, token.length)) continue;
    const year = 2000 + Number(match[1]);
    const month = Number(match[2]);
    push(isoDate(year, month, Number(match[3])), token);

    // Supplier filenames often abbreviate following dates as 260621,28.
    const suffix = filename.slice(index + token.length).match(/^\s*[,，&/]\s*((?:3[01]|[12]\d|0?[1-9])(?:\s*[,，&/]\s*(?:3[01]|[12]\d|0?[1-9]))*)/u)?.[1];
    for (const day of suffix?.match(/\d{1,2}/gu) ?? []) {
      push(isoDate(year, month, Number(day)), `${token},${day}`);
    }
  }

  // A common Korean supplier convention writes the year once and follows it
  // with one or more compact MMDD departure dates: `26년0617. 0623`. Only
  // immediately adjacent MMDD tokens are expanded, so a later revision or
  // ticketing suffix cannot be mistaken for another departure.
  for (const match of filename.matchAll(/(?:^|\D)(2\d)\s*\uB144\s*(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=$|\D)/gu)) {
    const tokenOffset = match[0].search(/2/u);
    const index = match.index + Math.max(0, tokenOffset);
    const year = 2000 + Number(match[1]);
    const token = `${match[1]}\uB144${match[2]}${match[3]}`;
    const consumedTokenLength = match[0].length - Math.max(0, tokenOffset);
    if (negativeContext(filename, index, consumedTokenLength)) continue;
    push(isoDate(year, Number(match[2]), Number(match[3])), token);
    const suffix = filename.slice(index + consumedTokenLength).match(/^\s*[,./\u00B7]\s*((?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:\s*[,./\u00B7]\s*(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))*)/u)?.[1];
    for (const compact of suffix?.match(/(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])/gu) ?? []) {
      push(isoDate(year, Number(compact.slice(0, 2)), Number(compact.slice(2, 4))), `${token}.${compact}`);
    }
  }

  if (byDate.size === 0 && input.validatedYear) {
    const withoutRoleTag = filename
      .replace(/^\s*(?:\[[^\]]{1,24}\]|【[^】]{1,24}】|\([^)]{1,24}\))\s*/u, '')
      .replace(/^[^0-9\p{L}]{0,8}/u, '');
    const leadingList = withoutRoleTag.match(
      /^((?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:\s*[,，+&/\u00B7]\s*(?:(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|(?:3[01]|[12]\d|0?[1-9])))+)/u,
    )?.[1];
    const tokens = leadingList?.match(/\d{1,4}/gu) ?? [];
    const first = tokens[0]?.padStart(4, '0') ?? '';
    const leadingMonth = Number(first.slice(0, 2));
    for (const [index, rawToken] of tokens.entries()) {
      const compact = rawToken.padStart(rawToken.length <= 2 ? 2 : 4, '0');
      const month = index === 0 || compact.length === 4 ? Number(compact.slice(0, 2)) : leadingMonth;
      const day = compact.length === 4 ? Number(compact.slice(2, 4)) : Number(compact);
      push(isoDate(input.validatedYear, month, day), rawToken);
    }
  }

  if (byDate.size === 0 && input.validatedYear) {
    for (const match of filename.matchAll(/(?:^|\D)(\d{1,2})\s*월\s*(\d{1,2})\s*일(?=$|\D)/gu)) {
      const tokenOffset = match[0].search(/\d/u);
      const index = match.index + Math.max(0, tokenOffset);
      if (negativeContext(filename, index, match[0].length - tokenOffset)) continue;
      push(isoDate(input.validatedYear, Number(match[1]), Number(match[2])), match[0].trim());
    }
  }

  const dates = [...byDate.keys()].sort();
  return dates.length > 0 ? {
    dates,
    authority: 'filename',
    version: PRODUCT_SOURCE_DEPARTURE_DATE_CONTEXT_VERSION,
    sourceTokens: dates.map(date => byDate.get(date)!),
  } : null;
}
