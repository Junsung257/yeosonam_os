import type {
  V3DraftLedger,
  V3EventType,
  V3LedgerEvent,
  V3LedgerVariant,
  V3OptionCandidate,
  V3SourceLine,
  V3StructurePlan,
} from './types';
import { evidenceFromLines } from './source-line-index';

const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/;
const FLIGHT_CODE_RE = /\b([A-Z0-9]{2})\s*(\d{3,4})\b/;
const PRICE_RE = /(?:KRW|₩|원)?\s*([1-9]\d{1,2}(?:,\d{3})+|[1-9]\d{5,})\s*(원|KRW|USD|\$)?/i;
const USD_RE = /\$\s*(\d+(?:\.\d+)?)/;
const DAY_HEADER_RE = /^(?:day\s*)?(\d{1,2})(?:일차|day|\s*일)?\b/i;

function normalizePrice(token: string): number {
  const number = Number(token.replace(/[,\s]/g, ''));
  if (!Number.isFinite(number)) return 0;
  return number < 10_000 ? number * 1000 : number;
}

function eventTypeForLine(line: string): V3EventType | null {
  const text = line.trim();
  if (!text) return null;
  if (/^(?:#{1,4}\s*)?(상품|product|variant|코스|등급)\s*[:\-]/i.test(text)) return null;
  if (/^price\s*[:\-]|^가격\s*[:\-]?|^요금\s*[:\-]?/i.test(text)) return null;
  if (/meeting|미팅|집결|集合|공항\s*미팅/i.test(text)) return 'meeting';
  if (FLIGHT_CODE_RE.test(text) || /flight|항공|출발|도착|공항/i.test(text) && TIME_RE.test(text)) return 'flight';
  if (/transfer|이동|차량|버스|전용차량|픽업|샌딩/i.test(text)) return 'transfer';
  if (/breakfast|lunch|dinner|조식|중식|석식|특식|meal/i.test(text)) return 'meal';
  if (/hotel|resort|숙박|호텔|체크인|체크아웃/i.test(text)) return 'hotel';
  if (/option|optional|선택|옵션|현지\s*지불|마사지|크루즈|쇼|티켓|공연/i.test(text)) return 'option';
  if (/shopping|쇼핑|면세|센터/i.test(text)) return 'shopping';
  if (/free\s*time|자유시간|휴식/i.test(text)) return 'free_time';
  if (/include|exclude|포함|불포함|최소|주의|안내|notice/i.test(text)) return 'notice';
  if (/상품|product|price|가격|요금|인원|코스|등급/i.test(text)) return null;
  return text.length >= 2 ? 'attraction' : null;
}

function optionCategory(text: string): V3OptionCandidate['category'] {
  if (/마사지|massage/i.test(text)) return 'massage';
  if (/쇼|공연|show/i.test(text)) return 'show';
  if (/크루즈|cruise/i.test(text)) return 'cruise';
  if (/식|meal|upgrade/i.test(text)) return 'meal_upgrade';
  if (/티켓|입장|ticket/i.test(text)) return 'ticket';
  if (/체험|activity/i.test(text)) return 'activity';
  return 'other';
}

function titleParts(lines: V3SourceLine[], start: number, end: number): string[] {
  return lines
    .slice(start - 1, end)
    .map(line => line.quote.trim())
    .filter(Boolean)
    .filter(line => !DAY_HEADER_RE.test(line) && !PRICE_RE.test(line))
    .slice(0, 3);
}

function buildEvent(line: V3SourceLine, type: V3EventType, rawText = line.quote.trim()): V3LedgerEvent {
  return {
    type,
    time: rawText.match(TIME_RE)?.[0] ?? null,
    raw_text: rawText,
    canonical_id: null,
    canonical_type: null,
    match_status: type === 'attraction' ? 'unmatched' : type === 'option' ? 'review' : 'ignored',
    evidence: evidenceFromLines([line], 1),
  };
}

function buildVariant(lines: V3SourceLine[], boundary: V3StructurePlan['product_boundaries'][number]): V3LedgerVariant {
  const sectionLines = lines.slice(boundary.line_start - 1, boundary.line_end);
  const prices = sectionLines
    .map(line => ({ line, match: line.quote.match(PRICE_RE) }))
    .filter((row): row is { line: V3SourceLine; match: RegExpMatchArray } => Boolean(row.match))
    .map(({ line, match }) => ({
      date: line.quote.match(/\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/)?.[0]?.replace(/[./]/g, '-') ?? null,
      label: line.quote.trim(),
      amount: normalizePrice(match[1]),
      currency: match[2] === '$' || match[2] === 'USD' ? 'USD' : 'KRW',
      evidence: evidenceFromLines(lines, line.lineNumber),
    }))
    .filter(price => price.amount > 0);

  const flight_segments = sectionLines
    .map(line => ({ line, match: line.quote.match(FLIGHT_CODE_RE) }))
    .filter((row): row is { line: V3SourceLine; match: RegExpMatchArray } => Boolean(row.match))
    .map(({ line, match }, index) => {
      const times = [...line.quote.matchAll(new RegExp(TIME_RE.source, 'g'))].map(m => m[0]);
      return {
        leg: index === 0 ? 'outbound' as const : index === 1 ? 'inbound' as const : 'unknown' as const,
        code: `${match[1]}${match[2]}`,
        dep_time: times[0] ?? null,
        arr_time: times[1] ?? null,
        evidence: evidenceFromLines(lines, line.lineNumber),
      };
    });

  const days: V3LedgerVariant['days'] = [];
  let currentDay: V3LedgerVariant['days'][number] | null = null;
  for (const line of sectionLines) {
    const dayMatch = line.quote.trim().match(DAY_HEADER_RE);
    let eventText = line.quote;
    if (dayMatch) {
      currentDay = {
        day: Number(dayMatch[1]),
        route: [],
        events: [],
        meals: { breakfast: {}, lunch: {}, dinner: {} },
        hotel: {},
      };
      days.push(currentDay);
      eventText = line.quote.trim().replace(DAY_HEADER_RE, '').trim();
      if (!eventText) continue;
    }
    const type = eventTypeForLine(eventText);
    if (!type) continue;
    if (!currentDay) {
      currentDay = { day: 1, route: [], events: [], meals: { breakfast: {}, lunch: {}, dinner: {} }, hotel: {} };
      days.push(currentDay);
    }
    const event = buildEvent(line, type, eventText.trim());
    currentDay.events.push(event);
    if (type === 'meal') {
      if (/breakfast|조식/i.test(line.quote)) currentDay.meals.breakfast = { raw_text: line.quote.trim(), evidence: event.evidence };
      if (/lunch|중식/i.test(line.quote)) currentDay.meals.lunch = { raw_text: line.quote.trim(), evidence: event.evidence };
      if (/dinner|석식/i.test(line.quote)) currentDay.meals.dinner = { raw_text: line.quote.trim(), evidence: event.evidence };
    }
    if (type === 'hotel') currentDay.hotel = { raw_text: line.quote.trim(), evidence: event.evidence };
  }

  const optionLines = sectionLines.filter(line => eventTypeForLine(line.quote) === 'option');
  const options = optionLines.map(line => {
    const usd = line.quote.match(USD_RE);
    return {
      region: null,
      city: null,
      raw_name: line.quote.trim(),
      normalized_name: line.quote.replace(USD_RE, '').trim(),
      category: optionCategory(line.quote),
      price_amount: usd ? Number(usd[1]) : null,
      currency: usd ? 'USD' : null,
      duration_minutes: null,
      day_number: null,
      evidence: evidenceFromLines(lines, line.lineNumber),
      match_status: 'review' as const,
    };
  });

  const inclusions = sectionLines
    .filter(line => /include|포함/i.test(line.quote))
    .map(line => ({ value: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const exclusions = sectionLines
    .filter(line => /exclude|불포함/i.test(line.quote))
    .map(line => ({ value: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const shopping = sectionLines
    .filter(line => eventTypeForLine(line.quote) === 'shopping')
    .map(line => ({ value: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const minDepartureLine = sectionLines.find(line => /minimum|min\.?|최소/i.test(line.quote) && /\d+/.test(line.quote));
  const minimum_departure = minDepartureLine
    ? { value: Number(minDepartureLine.quote.match(/\d+/)?.[0] ?? 0), evidence: evidenceFromLines(lines, minDepartureLine.lineNumber) }
    : null;

  return {
    variant_key: `v${boundary.index + 1}`,
    grade: null,
    course: null,
    duration_days: days.length || null,
    nights: days.length > 0 ? Math.max(0, days.length - 1) : null,
    title_parts: titleParts(lines, boundary.line_start, boundary.line_end),
    price_calendar: prices,
    flight_segments,
    days,
    inclusions,
    exclusions,
    options,
    shopping,
    minimum_departure,
    evidence_coverage: {},
  };
}

export function buildProductRegistrationV3Ledger(lines: V3SourceLine[], plan: V3StructurePlan): V3DraftLedger {
  const variants = plan.product_boundaries.map(boundary => buildVariant(lines, boundary));
  return {
    document: {
      type: plan.document_type,
      expected_products: plan.expected_products,
      variant_axes: plan.variant_axes,
    },
    variants,
  };
}
