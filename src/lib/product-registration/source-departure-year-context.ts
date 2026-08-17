import { parseTrustedDepartureMonthWindowFromFilename } from './source-departure-date-context';
import { resolveExplicitSourceDepartureWindow } from './future-departure-date-policy';

export const PRODUCT_SOURCE_DEPARTURE_YEAR_CONTEXT_VERSION = 'source-departure-year-context-1';

export type ProductSourceDepartureYearContext = {
  year: number;
  authority: 'authenticated_admin';
  version: typeof PRODUCT_SOURCE_DEPARTURE_YEAR_CONTEXT_VERSION;
};

export type ProductSourceDepartureYearContextResult =
  | { ok: true; value: ProductSourceDepartureYearContext | null }
  | { ok: false; code: 'SOURCE_DEPARTURE_YEAR_INVALID'; message: string };

export type ProductSourceDepartureYearEvidence = {
  validated: boolean;
  year: number | null;
  source: 'document_text' | 'filename' | 'missing' | 'conflicting';
  superseded_source_window?: { start: string; end: string };
  filename_month_window?: { start: string; end: string };
};

type YearMention = {
  year: number;
  index: number;
  raw: string;
  compactDate: boolean;
};

const DEPARTURE_YEAR_POSITIVE_CONTEXT = /(?:출발(?:일|날짜)?|행사(?:일)?|여행기간|상품|패키지|요금|가격|하계|동계|성수기|스케줄)/u;
const DEPARTURE_YEAR_NEGATIVE_CONTEXT = /(?:전자담배|반입|금지|법규|시행|개정|여권|비자|무비자|입국|체류|출입국|유효기간|취소|환불|약관|발권일|발행일|작성일|수정일|개장|오픈|설립|준공|완공|리뉴얼|출시)/u;
const EXPLICIT_YEAR_MONTH_CONTEXT = /(?:20\d{2}|2\d)\s*년?\s*(?:\d{1,2}\s*월|[.\-/]\s*\d{1,2})/u;

function collectYearMentions(value: string): YearMention[] {
  const normalized = value.normalize('NFKC');
  const mentions: YearMention[] = [];
  const patterns: Array<{ expression: RegExp; compactDate: boolean; year: (match: RegExpExecArray) => number }> = [
    {
      expression: /\b(20\d{2})\s*(?:년|[.\-/]\s*\d{1,2})/gu,
      compactDate: false,
      year: match => Number(match[1]),
    },
    {
      expression: /(?:^|\D)(2\d)\s*년/gu,
      compactDate: false,
      year: match => 2000 + Number(match[1]),
    },
    {
      expression: /(?:^|\D)(2\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:\D|$)/gu,
      compactDate: true,
      year: match => 2000 + Number(match[1]),
    },
  ];
  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.expression.exec(normalized)) != null) {
      const year = pattern.year(match);
      if (year < 2020 || year > 2100) continue;
      const raw = match[0];
      const leadingOffset = raw.search(/2/u);
      mentions.push({
        year,
        index: match.index + Math.max(0, leadingOffset),
        raw: raw.slice(Math.max(0, leadingOffset)),
        compactDate: pattern.compactDate,
      });
    }
  }
  return mentions.filter((mention, index, all) => all.findIndex(candidate => (
    candidate.year === mention.year
    && candidate.index === mention.index
  )) === index);
}

function isDepartureYearMention(value: string, mention: YearMention, filename: boolean): boolean {
  const normalized = value.normalize('NFKC');
  const lineStart = normalized.lastIndexOf('\n', mention.index - 1) + 1;
  const nextLineBreak = normalized.indexOf('\n', mention.index + mention.raw.length);
  const sourceLine = normalized.slice(lineStart, nextLineBreak < 0 ? normalized.length : nextLineBreak);
  const before = normalized.slice(Math.max(0, mention.index - 48), mention.index);
  const after = normalized.slice(mention.index + mention.raw.length, mention.index + mention.raw.length + 72);
  if (filename) {
    if (mention.compactDate) {
      return !/(?:수정|작성|업데이트|최종)\s*$/u.test(before.slice(-18));
    }
    return true;
  }
  // A year written inside an informational/legal notice must not conflict
  // with the actual departure year in the filename. Checking the physical
  // source line first avoids a later table heading (for example "일정") from
  // lending false positive context to "25년 전자담배 반입 금지".
  if (DEPARTURE_YEAR_NEGATIVE_CONTEXT.test(sourceLine)
    && !DEPARTURE_YEAR_POSITIVE_CONTEXT.test(sourceLine)) {
    return false;
  }
  const boundary = /[.。!\n▶●※]/u;
  const beforeClause = before.split(boundary).at(-1) ?? '';
  const afterClause = after.split(boundary)[0] ?? '';
  const clause = `${beforeClause}\n${mention.raw}\n${afterClause}`;
  if (DEPARTURE_YEAR_NEGATIVE_CONTEXT.test(clause) && !DEPARTURE_YEAR_POSITIVE_CONTEXT.test(clause)) {
    return false;
  }
  return DEPARTURE_YEAR_POSITIVE_CONTEXT.test(clause) || EXPLICIT_YEAR_MONTH_CONTEXT.test(clause);
}

function uniqueYears(mentions: YearMention[]): number[] {
  return [...new Set(mentions.map(mention => mention.year))];
}

function explicitDocumentCrossYearStart(value: string): number | null {
  const matches = [...value.normalize('NFKC').matchAll(
    /(?:(?:행사\s*(?:날짜|일)?|출발\s*(?:일|날짜)?|여행\s*기간|상품\s*기간)[^\n]{0,32}?)?(20\d{2})\s*년\s*\d{1,2}\s*월\s*[~\-–—]\s*(20\d{2})\s*년\s*\d{1,2}\s*월/gu,
  )].map(match => ({ start: Number(match[1]), end: Number(match[2]) }));
  const valid = matches.filter(match => match.end === match.start + 1);
  const starts = [...new Set(valid.map(match => match.start))];
  return starts.length === 1 ? starts[0]! : null;
}

/**
 * Resolves only years that describe the sale/departure period. Regulatory and
 * informational years (for example, "25년 전자담배 반입 금지") must never
 * turn a clearly stated 2026 departure calendar into a false conflict.
 */
export function resolveProductSourceDepartureYearEvidence(input: {
  text: string;
  filename: string;
}): ProductSourceDepartureYearEvidence {
  const textYears = uniqueYears(collectYearMentions(input.text)
    .filter(mention => isDepartureYearMention(input.text, mention, false)));
  const filenameYears = uniqueYears(collectYearMentions(input.filename)
    .filter(mention => isDepartureYearMention(input.filename, mention, true)));

  const crossYearStart = explicitDocumentCrossYearStart(input.text);
  if (
    textYears.length === 2
    && filenameYears.length === 0
    && crossYearStart != null
    && textYears.every(year => year === crossYearStart || year === crossYearStart + 1)
  ) {
    return { validated: true, year: crossYearStart, source: 'document_text' };
  }

  if (textYears.length > 1 || filenameYears.length > 1) {
    return { validated: false, year: null, source: 'conflicting' };
  }
  const textYear = textYears[0] ?? null;
  const filenameYear = filenameYears[0] ?? null;
  if (textYear != null && filenameYear != null && textYear !== filenameYear) {
    return { validated: false, year: null, source: 'conflicting' };
  }
  if (textYear != null) return { validated: true, year: textYear, source: 'document_text' };
  if (filenameYear != null) return { validated: true, year: filenameYear, source: 'filename' };
  return { validated: false, year: null, source: 'missing' };
}

/**
 * A supplier can reuse an old itinerary template while replacing its price
 * table and filename with a later sale period. The filename period may win
 * only when it is future-active and the conflicting, fully dated source
 * window ended before that filename period began. This never resolves two
 * competing active schedules.
 */
export function resolveProductSourceDepartureYearEvidenceAtReference(input: {
  text: string;
  filename: string;
  referenceDate: string;
}): ProductSourceDepartureYearEvidence {
  const direct = resolveProductSourceDepartureYearEvidence(input);
  if (direct.source !== 'conflicting') return direct;
  const filenameWindow = parseTrustedDepartureMonthWindowFromFilename(input.filename);
  const sourceWindow = resolveExplicitSourceDepartureWindow(input.text);
  if (
    filenameWindow
    && sourceWindow
    && sourceWindow.end < filenameWindow.start
    && filenameWindow.end >= input.referenceDate
  ) {
    return {
      validated: true,
      year: filenameWindow.year,
      source: 'filename',
      superseded_source_window: { start: sourceWindow.start, end: sourceWindow.end },
      filename_month_window: { start: filenameWindow.start, end: filenameWindow.end },
    };
  }
  return direct;
}

/**
 * An upload-envelope year is evidence only when an authenticated operator
 * explicitly confirms it. Empty input remains absent; it never falls back to
 * the current year or a file timestamp.
 */
export function parseProductSourceDepartureYearContext(
  input: unknown,
): ProductSourceDepartureYearContextResult {
  if (input == null || (typeof input === 'string' && input.trim() === '')) {
    return { ok: true, value: null };
  }

  const structured = typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  if (structured && (
    structured.authority !== 'authenticated_admin'
    || structured.version !== PRODUCT_SOURCE_DEPARTURE_YEAR_CONTEXT_VERSION
  )) {
    return {
      ok: false,
      code: 'SOURCE_DEPARTURE_YEAR_INVALID',
      message: '출발연도 보조정보의 확인 권한 또는 버전이 올바르지 않습니다.',
    };
  }
  const rawYear = structured ? structured.year : input;
  const yearText = typeof rawYear === 'string' ? rawYear.trim() : rawYear;
  const year = Number(yearText);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || String(yearText).length !== 4) {
    return {
      ok: false,
      code: 'SOURCE_DEPARTURE_YEAR_INVALID',
      message: '출발연도는 확인된 4자리 연도(2020~2100)로 입력해야 합니다.',
    };
  }

  return {
    ok: true,
    value: {
      year,
      authority: 'authenticated_admin',
      version: PRODUCT_SOURCE_DEPARTURE_YEAR_CONTEXT_VERSION,
    },
  };
}

export function mergeProductSourceUploadMetadata(input: {
  sourceMetadata: Record<string, unknown>;
  requestMetadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const embedded = input.sourceMetadata.uploadSourceMetadata;
  const storedUploadMetadata = embedded
    && typeof embedded === 'object'
    && !Array.isArray(embedded)
    ? embedded as Record<string, unknown>
    : {};
  return {
    ...storedUploadMetadata,
    ...(input.sourceMetadata.sourceDepartureYearContext
      ? { sourceDepartureYearContext: input.sourceMetadata.sourceDepartureYearContext }
      : {}),
    ...(input.requestMetadata ?? {}),
  };
}
