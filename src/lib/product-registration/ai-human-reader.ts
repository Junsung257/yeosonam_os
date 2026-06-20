import { createHash } from 'node:crypto';
import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import type { MatrixPriceRow, PriceTier } from '@/lib/parser/deterministic/price-ir/types';
import {
  buildSupplierRawDeterministicItinerary,
} from '@/lib/supplier-raw-deterministic-facts';
import {
  compileScheduleItemForLanding,
  type ScheduleEntityKind,
} from '@/lib/itinerary-schedule-compiler';
import type { SourceEvidenceSpan } from './types';

export type HumanReaderSource = 'deterministic_evidence_reader' | 'ai_schema_reader';

export type HumanReaderPricePair = {
  date: string;
  adult_price: number;
  child_price: number | null;
  note: string | null;
  status: string | null;
  evidence: SourceEvidenceSpan;
};

export type HumanReaderItineraryEvent = {
  day_number: number | null;
  raw_text: string;
  entity_kind: ScheduleEntityKind;
  attraction_queries: string[];
  landing_sentence: string | null;
  a4_sentence: string | null;
  evidence: SourceEvidenceSpan;
};

export type HumanReaderEntityMention = {
  category: ScheduleEntityKind;
  raw_text: string;
  canonical_query: string | null;
  customer_visible: boolean;
  evidence: SourceEvidenceSpan;
};

export type HumanReaderResult = {
  source: HumanReaderSource;
  rawTextHash: string;
  priceSource: string;
  priceTiers: PriceTier[];
  pricePairs: HumanReaderPricePair[];
  itineraryEvents: HumanReaderItineraryEvent[];
  entityMentions: HumanReaderEntityMention[];
  uncertainties: string[];
  evidenceSpans: SourceEvidenceSpan[];
};

export type HumanReaderInput = {
  rawText: string;
  title?: string | null;
  accommodations?: string[] | null;
  durationDays?: number | null;
  departureDays?: string | string[] | null;
  year?: number;
};

function hashRawText(rawText: string): string {
  return createHash('sha256').update(rawText).digest('hex');
}

function lineStarts(rawText: string): number[] {
  const starts = [0];
  for (let i = 0; i < rawText.length; i++) {
    if (rawText[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineIndexForOffset(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(0, high);
}

function makeEvidence(input: {
  rawText: string;
  rawTextHash: string;
  field: string;
  quote: string;
  sourceKind?: SourceEvidenceSpan['sourceKind'];
  confidence?: number;
}): SourceEvidenceSpan {
  const starts = lineStarts(input.rawText);
  const cleanQuote = input.quote.replace(/\s+/g, ' ').trim().slice(0, 240);
  let start = cleanQuote ? input.rawText.indexOf(cleanQuote) : -1;
  if (start < 0 && cleanQuote) {
    const firstToken = cleanQuote.split(/\s+/)[0];
    start = firstToken ? input.rawText.indexOf(firstToken) : -1;
  }
  const safeStart = Math.max(0, start);
  const safeEnd = start >= 0 ? Math.min(input.rawText.length, start + cleanQuote.length) : safeStart;
  return {
    field: input.field,
    rawTextHash: input.rawTextHash,
    start: safeStart,
    end: safeEnd,
    quote: cleanQuote,
    productIndex: null,
    sourceKind: input.sourceKind ?? 'line',
    sectionKey: null,
    lineIndex: start >= 0 ? lineIndexForOffset(starts, start) : null,
    rowIndex: null,
    columnIndex: null,
    confidence: input.confidence ?? (start >= 0 ? 0.84 : 0.62),
  };
}

function priceEvidenceQuote(rawText: string, row: MatrixPriceRow): string {
  const price = row.adult_price.toLocaleString('en-US');
  const compactPrice = String(Math.round(row.adult_price / 1000));
  const dateParts = row.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateHints = dateParts
    ? [
      `${Number(dateParts[2])}/${Number(dateParts[3])}`,
      `${Number(dateParts[2])}.${Number(dateParts[3])}`,
      `${Number(dateParts[2])}월 ${Number(dateParts[3])}`,
    ]
    : [];

  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const candidates = lines.filter(line => {
    const hasDate = dateHints.some(hint => line.includes(hint));
    const hasPrice = line.includes(price) || line.includes(compactPrice);
    const hasNote = row.note ? line.includes(row.note) : false;
    return hasDate || hasPrice || hasNote;
  });

  return candidates.slice(0, 3).join(' / ') || `${row.date} ${price}`;
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

function parseLooseDateTokens(line: string, yearHint?: number): string[] {
  const withoutParentheses = line
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d+\s*(?:nights?|night|박)\b/gi, ' ')
    .replace(/[&+]/g, ',');
  const explicitKoreanDates = [...withoutParentheses.matchAll(/(20\d{2})\D{0,5}(\d{1,2})\D{0,5}(\d{1,2})/g)]
    .map(match => isoDate(Number(match[1]), Number(match[2]), Number(match[3])))
    .filter((date): date is string => Boolean(date));
  if (explicitKoreanDates.length > 0) return [...new Set(explicitKoreanDates)];

  const twoDigitYearDates = [...withoutParentheses.matchAll(/(?:^|[^\d])(\d{2})\s*년\s*(\d{1,2})\s*(?:[./월]\s*)?(\d{1,2})/g)]
    .map((match) => {
      const yy = Number(match[1]);
      const year = yy >= 80 ? 1900 + yy : 2000 + yy;
      return isoDate(year, Number(match[2]), Number(match[3]));
    })
    .filter((date): date is string => Boolean(date));
  if (twoDigitYearDates.length > 0) return [...new Set(twoDigitYearDates)];

  const tokens = withoutParentheses.match(/\d{1,2}[./-]\d{1,2}|\b\d{1,2}\b/g) ?? [];
  const dates: string[] = [];
  let currentMonth: number | null = null;

  for (const token of tokens) {
    const explicit = token.match(/^(\d{1,2})[./-](\d{1,2})$/);
    if (explicit) {
      currentMonth = Number(explicit[1]);
      const iso = isoDate(inferYearForMonth(currentMonth, yearHint), currentMonth, Number(explicit[2]));
      if (iso) dates.push(iso);
      continue;
    }
    if (currentMonth == null) continue;
    const day = Number(token);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const iso = isoDate(inferYearForMonth(currentMonth, yearHint), currentMonth, day);
    if (iso) dates.push(iso);
  }

  return [...new Set(dates)];
}

function parseKrwPrices(line: string): number[] {
  const prices: number[] = [];
  const matches = line.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d{3,4},-)\s*(?:KRW|krw)?/g);
  for (const match of matches) {
    const token = match[1];
    const value = token.endsWith(',-')
      ? Number(token.replace(',-', '')) * 1000
      : Number(token.replace(/,/g, ''));
    if (Number.isInteger(value) && value >= 250_000 && value <= 50_000_000) prices.push(value);
  }
  return [...new Set(prices)];
}

const ADMIN_DATE_CONTEXT_RE = /(?:발\s*신\s*일|수\s*신|담당자|드림|작성일|배포일|발송일|문서|기안|기준일)/;
const NON_PACKAGE_PRICE_CONTEXT_RE = /(?:호텔\s*써차지|써차지|투숙일|싱글차지|불\s*포함|불포함|선택관광|선택\s*관광|옵션|매너팁|가이드경비|개인경비|패널티|취소|환불|유류|텍스|쇼\s*핑|쇼핑)/;
const PACKAGE_DATE_PRICE_CONTEXT_RE = /(?:출\s*발|출발|판매가|판\s*매\s*가|상품가|요금|가격|성인|최저가|특가)/;

function isNonPackagePriceContext(line: string): boolean {
  return ADMIN_DATE_CONTEXT_RE.test(line) || NON_PACKAGE_PRICE_CONTEXT_RE.test(line);
}

const KOREAN_WEEKDAY_TO_DAY = new Map<string, number>([
  ['일', 0],
  ['월', 1],
  ['화', 2],
  ['수', 3],
  ['목', 4],
  ['금', 5],
  ['토', 6],
]);

function weekdayHeading(line: string): number | null {
  const normalized = line.replace(/\s+/g, '');
  const weekday = normalized.match(/^[*]?(월|화|수|목|금|토|일)(?:요일)?[*]?$/)?.[1];
  return weekday ? KOREAN_WEEKDAY_TO_DAY.get(weekday) ?? null : null;
}

function monthHeading(line: string): number | null {
  const match = line.replace(/\s+/g, '').match(/^(\d{1,2})월$/);
  if (!match) return null;
  const month = Number(match[1]);
  return month >= 1 && month <= 12 ? month : null;
}

function dayRangeLine(line: string): { from: number; to: number } | null {
  const normalized = line.replace(/\s+/g, '');
  const match = normalized.match(/^(\d{1,2})[~\-](\d{1,2})$/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (from < 1 || from > 31 || to < from || to > 31) return null;
  return { from, to };
}

function datesForWeekdayRange(input: {
  year: number;
  month: number;
  from: number;
  to: number;
  weekday: number;
}): string[] {
  const dates: string[] = [];
  for (let day = input.from; day <= input.to; day++) {
    const date = new Date(input.year, input.month - 1, day);
    if (date.getFullYear() !== input.year || date.getMonth() !== input.month - 1) continue;
    if (date.getDay() !== input.weekday) continue;
    const iso = isoDate(input.year, input.month, day);
    if (iso) dates.push(iso);
  }
  return dates;
}

function extractMonthlyWeekdayGridRows(input: HumanReaderInput): MatrixPriceRow[] {
  const lines = input.rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length - 1; i++) {
    const month = monthHeading(lines[i]);
    const range = dayRangeLine(lines[i + 1]);
    if (!month || !range) continue;

    const year = inferYearForMonth(month, input.year);
    let j = i + 2;
    while (j < lines.length) {
      if (j > i + 80) break;
      if (j > i + 2 && monthHeading(lines[j]) && dayRangeLine(lines[j + 1] ?? '')) break;

      const weekday = weekdayHeading(lines[j]);
      if (weekday == null) {
        j++;
        continue;
      }

      const prices: number[] = [];
      let k = j + 1;
      while (k < lines.length && prices.length < 8) {
        if (weekdayHeading(lines[k]) != null) break;
        if (monthHeading(lines[k]) && dayRangeLine(lines[k + 1] ?? '')) break;
        if (/^출발일|^패턴|^세이브|^스탠다드|^디럭스|^프리미엄/.test(lines[k])) break;
        prices.push(...parseKrwPrices(lines[k]));
        k++;
      }

      const dates = datesForWeekdayRange({
        year,
        month,
        from: range.from,
        to: range.to,
        weekday,
      });
      for (const date of dates) {
        for (const price of prices) {
          const key = `${date}|${price}|monthly_weekday_grid`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            date,
            adult_price: price,
            child_price: null,
            note: 'source_monthly_weekday_grid',
            status: 'available',
          });
        }
      }

      j = Math.max(k, j + 1);
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
}

function extractAdjacentDatePriceRows(input: HumanReaderInput): MatrixPriceRow[] {
  const lines = input.rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    if (isNonPackagePriceContext(lines[i])) continue;
    const dates = parseLooseDateTokens(lines[i], input.year);
    if (dates.length === 0 || dates.length > 80) continue;
    const hasPackageContext = PACKAGE_DATE_PRICE_CONTEXT_RE.test(lines[i]);
    const bareFullDateLine = /^\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s*$/.test(lines[i]);
    if (bareFullDateLine && !hasPackageContext) continue;

    const prices = [
      ...parseKrwPrices(lines[i]),
      ...(hasPackageContext
        ? lines.slice(Math.max(0, i - 2), i).flatMap(line => {
          if (isNonPackagePriceContext(line)) return [];
          if (parseLooseDateTokens(line, input.year).length > 0) return [];
          return parseKrwPrices(line);
        })
        : []),
      ...lines.slice(i + 1, Math.min(lines.length, i + 6)).flatMap(line => {
        if (isNonPackagePriceContext(line)) return [];
        if (parseLooseDateTokens(line, input.year).length > 0) return [];
        return parseKrwPrices(line);
      }),
    ];
    if (prices.length === 0 || prices.length > 8) continue;

    for (const date of dates) {
      for (const price of prices) {
        const key = `${date}|${price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          date,
          adult_price: price,
          child_price: null,
          note: 'source_adjacent_date_price',
          status: 'available',
        });
      }
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
}

function eventEvidenceQuote(rawText: string, value: string): string {
  const line = rawText.split(/\r?\n/).find(item => item.includes(value));
  return line?.trim() || value;
}

function buildPricePairs(input: HumanReaderInput, rawTextHash: string): {
  priceSource: string;
  tiers: PriceTier[];
  pairs: HumanReaderPricePair[];
  spans: SourceEvidenceSpan[];
} {
  const ir = extractPriceIR(input.rawText, {
    year: input.year,
    title: input.title,
    accommodations: input.accommodations ?? [],
    durationDays: input.durationDays,
    departureDays: input.departureDays,
  });
  const pairs: HumanReaderPricePair[] = [];
  const spans: SourceEvidenceSpan[] = [];
  const seen = new Set<string>();

  const candidateRows = [
    ...ir.rows,
    ...extractAdjacentDatePriceRows(input),
    ...extractMonthlyWeekdayGridRows(input),
  ];
  for (const row of candidateRows) {
    if (!row.date || !row.adult_price || row.adult_price <= 0) continue;
    const key = `${row.date}|${row.adult_price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const evidence = makeEvidence({
      rawText: input.rawText,
      rawTextHash,
      field: 'human_reader.price_pair',
      quote: priceEvidenceQuote(input.rawText, row),
      sourceKind: 'table_cell',
      confidence: 0.88,
    });
    spans.push(evidence);
    pairs.push({
      date: row.date,
      adult_price: row.adult_price,
      child_price: row.child_price ?? null,
      note: row.note ?? null,
      status: row.status ?? null,
      evidence,
    });
  }

  return {
    priceSource: ir.source,
    tiers: ir.tiers,
    pairs,
    spans,
  };
}

function buildItineraryEvents(rawText: string, rawTextHash: string): {
  events: HumanReaderItineraryEvent[];
  mentions: HumanReaderEntityMention[];
  spans: SourceEvidenceSpan[];
} {
  const itinerary = buildSupplierRawDeterministicItinerary(rawText);
  const events: HumanReaderItineraryEvent[] = [];
  const mentions: HumanReaderEntityMention[] = [];
  const spans: SourceEvidenceSpan[] = [];

  for (const day of itinerary?.days ?? []) {
    for (const item of day.schedule ?? []) {
      if (!item.activity) continue;
      const compiled = compileScheduleItemForLanding(
        item as unknown as Parameters<typeof compileScheduleItemForLanding>[0],
      );
      const entityKind = compiled.entity_kind ?? 'unknown';
      const evidence = makeEvidence({
        rawText,
        rawTextHash,
        field: 'human_reader.itinerary_event',
        quote: eventEvidenceQuote(rawText, compiled.activity),
        confidence: entityKind === 'unknown' ? 0.62 : 0.82,
      });
      spans.push(evidence);
      const attractionQueries = compiled.attraction_queries ?? (compiled.attraction_query ? [compiled.attraction_query] : []);
      events.push({
        day_number: day.day ?? null,
        raw_text: compiled.activity,
        entity_kind: entityKind,
        attraction_queries: attractionQueries,
        landing_sentence: compiled.landing_sentence ?? null,
        a4_sentence: compiled.a4_sentence ?? null,
        evidence,
      });
      mentions.push({
        category: entityKind,
        raw_text: compiled.activity,
        canonical_query: attractionQueries[0] ?? null,
        customer_visible: entityKind !== 'unknown',
        evidence,
      });
    }
  }

  return { events, mentions, spans };
}

export function readSupplierDocumentLikeHuman(input: HumanReaderInput): HumanReaderResult {
  const rawTextHash = hashRawText(input.rawText);
  const price = buildPricePairs(input, rawTextHash);
  const itinerary = buildItineraryEvents(input.rawText, rawTextHash);
  const uncertainties: string[] = [];

  if (price.pairs.length === 0) {
    uncertainties.push('no source-backed product price/date pairs recognized by evidence reader');
  }
  if (itinerary.events.length === 0) {
    uncertainties.push('no source-backed itinerary events recognized by evidence reader');
  }

  return {
    source: 'deterministic_evidence_reader',
    rawTextHash,
    priceSource: price.priceSource,
    priceTiers: price.tiers,
    pricePairs: price.pairs,
    itineraryEvents: itinerary.events,
    entityMentions: itinerary.mentions,
    uncertainties,
    evidenceSpans: [...price.spans, ...itinerary.spans],
  };
}
