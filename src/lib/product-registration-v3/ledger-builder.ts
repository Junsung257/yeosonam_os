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
import { extractStandardNoticesFromRemarkLines } from './standard-notices';

const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/;
const TIME_RE_GLOBAL = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
const FLIGHT_CODE_RE = /\b([A-Z0-9]{2})\s*(\d{3,4})\b/;
const PRICE_RE = /(?:KRW|\u20a9|\uc6d0)?\s*([1-9]\d{1,2}(?:,\d{3})+|[1-9]\d{5,})\s*(\uc6d0|KRW|USD|\$)?/i;
const USD_RE = /\$\s*(\d+(?:\.\d+)?)/;
const DAY_HEADER_RE = /^(?:day\s*)?(\d{1,2})(?:\uc77c\ucc28|day|\s*\uc77c)?\b/i;
const PRODUCT_HEADER_RE = /^(?:#{1,4}\s*)?(?:\uc0c1\ud488|product|variant|\ucf54\uc2a4|\ub4f1\uae09)\s*[:\-]/i;
const PRICE_HEADER_RE = /^price\s*[:\-]|^(?:\uac00\uaca9|\uc694\uae08)\s*[:\-]?/i;
const MEETING_RE = /meeting|\ubbf8\ud305|\uc9d1\uacb0|\ud53d\uc5c5|\uacf5\ud56d\s*\ubbf8\ud305/i;
const FLIGHT_WORD_RE = /flight|\ud56d\uacf5|\ucd9c\ubc1c|\ub3c4\ucc29|\uacf5\ud56d/i;
const TRANSFER_RE = /transfer|\uc774\ub3d9|\ucc28\ub7c9|\ubc84\uc2a4|\uc804\uc6a9\ucc28\ub7c9|\uc1a1\uc601|\ud53d\uc5c5/i;
const MEAL_RE = /breakfast|lunch|dinner|\uc870\uc2dd|\uc911\uc2dd|\uc11d\uc2dd|\ud2b9\uc2dd|meal/i;
const HOTEL_RE = /hotel|resort|\uc219\ubc15|\ud638\ud154|\ub9ac\uc870\ud2b8|\uccb4\ud06c\uc778|\uccb4\ud06c\uc544\uc6c3/i;
const OPTION_RE = /option|optional|\uc120\ud0dd|\uc635\uc158|\ud604\uc9c0\s*\uc9c0\ubd88|\ub9c8\uc0ac\uc9c0|\ud06c\ub8e8\uc988|\uacf5\uc5f0|\uc1fc|\uccb4\ud5d8|\ud2f0\ucf13/i;
const SHOPPING_RE = /shopping|\uc1fc\ud551|\uba74\uc138|\uc13c\ud130/i;
const FREE_TIME_RE = /free\s*time|\uc790\uc720\s*\uc2dc\uac04|\ud734\uc2dd/i;
const NOTICE_RE = /include|exclude|\ud3ec\ud568|\ubd88\ud3ec\ud568|\ucd5c\uc18c|\uc8fc\uc758|\uc548\ub0b4|notice/i;
const REMARK_RE = /비고|주의사항|remark|안내|공지|싱글\s*차지|여권|전자담배|룸배정|개런티|일정|마사지\s*팁|패널티|도보\s*이동/i;
const ATTRACTION_DECOY_RE = PRODUCT_HEADER_RE;

function normalizePrice(token: string): number {
  const number = Number(token.replace(/[,\s]/g, ''));
  if (!Number.isFinite(number)) return 0;
  return number < 10_000 ? number * 1000 : number;
}

function eventTypeForLine(line: string): V3EventType | null {
  const text = line.trim();
  if (!text) return null;
  if (PRODUCT_HEADER_RE.test(text) || PRICE_HEADER_RE.test(text)) return null;
  if (MEETING_RE.test(text)) return 'meeting';
  if (FLIGHT_CODE_RE.test(text) || (FLIGHT_WORD_RE.test(text) && TIME_RE.test(text))) return 'flight';
  if (TRANSFER_RE.test(text)) return 'transfer';
  if (MEAL_RE.test(text)) return 'meal';
  if (HOTEL_RE.test(text)) return 'hotel';
  if (OPTION_RE.test(text)) return 'option';
  if (SHOPPING_RE.test(text)) return 'shopping';
  if (FREE_TIME_RE.test(text)) return 'free_time';
  if (NOTICE_RE.test(text)) return 'notice';
  if (ATTRACTION_DECOY_RE.test(text) || PRICE_RE.test(text)) return null;
  return text.length >= 2 ? 'attraction' : null;
}

function optionCategory(text: string): V3OptionCandidate['category'] {
  if (/\ub9c8\uc0ac\uc9c0|massage/i.test(text)) return 'massage';
  if (/\uacf5\uc5f0|\uc1fc|show/i.test(text)) return 'show';
  if (/\ud06c\ub8e8\uc988|cruise/i.test(text)) return 'cruise';
  if (/\ud2b9\uc2dd|meal|upgrade/i.test(text)) return 'meal_upgrade';
  if (/\ud2f0\ucf13|\uc785\uc7a5|ticket/i.test(text)) return 'ticket';
  if (/\uccb4\ud5d8|activity/i.test(text)) return 'activity';
  return 'other';
}

function titleParts(lines: V3SourceLine[], boundary: V3StructurePlan['product_boundaries'][number]): string[] {
  const header = lines[boundary.line_start - 1]?.quote.replace(PRODUCT_HEADER_RE, '').trim();
  const body = lines
    .slice(boundary.line_start - 1, boundary.line_end)
    .map(line => line.quote.trim())
    .filter(Boolean)
    .filter(line => !DAY_HEADER_RE.test(line) && !PRICE_RE.test(line) && !PRICE_HEADER_RE.test(line))
    .slice(0, 3);
  return [header || boundary.title_hint, ...body.filter(line => line !== header)].filter(Boolean).slice(0, 3);
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

function parseDuration(title: string, dayCount: number): { durationDays: number | null; nights: number | null } {
  const nd = title.match(/\b(\d+)N(\d+)D\b/i);
  if (nd) return { nights: Number(nd[1]), durationDays: Number(nd[2]) };
  const korean = title.match(/(\d+)\s*\ubc15\s*(\d+)\s*\uc77c/);
  if (korean) return { nights: Number(korean[1]), durationDays: Number(korean[2]) };
  return {
    durationDays: dayCount || null,
    nights: dayCount > 0 ? Math.max(0, dayCount - 1) : null,
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
      currency: match[2] === '$' || match[2]?.toUpperCase() === 'USD' ? 'USD' : 'KRW',
      evidence: evidenceFromLines(lines, line.lineNumber),
    }))
    .filter(price => price.amount > 0);

  const flight_segments = sectionLines
    .map(line => ({ line, match: line.quote.match(FLIGHT_CODE_RE) }))
    .filter((row): row is { line: V3SourceLine; match: RegExpMatchArray } => Boolean(row.match))
    .map(({ line, match }, index) => {
      const times = [...line.quote.matchAll(TIME_RE_GLOBAL)].map(m => m[0]);
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
  let inRemarkSection = false;
  for (const line of sectionLines) {
    const trimmed = line.quote.trim();
    if (/^(REMARK|비고|주의사항|공지사항)\s*$/i.test(trimmed)) {
      inRemarkSection = true;
      continue;
    }
    const dayMatch = trimmed.match(DAY_HEADER_RE);
    let eventText = line.quote;
    if (dayMatch) {
      inRemarkSection = false;
      currentDay = {
        day: Number(dayMatch[1]),
        route: [],
        events: [],
        meals: { breakfast: {}, lunch: {}, dinner: {} },
        hotel: {},
      };
      days.push(currentDay);
      eventText = trimmed.replace(DAY_HEADER_RE, '').trim();
      if (!eventText) continue;
    }
    if (inRemarkSection) continue;
    const type = eventTypeForLine(eventText);
    if (!type) continue;
    if (!currentDay) {
      currentDay = { day: 1, route: [], events: [], meals: { breakfast: {}, lunch: {}, dinner: {} }, hotel: {} };
      days.push(currentDay);
    }
    const event = buildEvent(line, type, eventText.trim());
    currentDay.events.push(event);
    if (type === 'attraction') currentDay.route.push(event.raw_text);
    if (type === 'meal') {
      if (/breakfast|\uc870\uc2dd/i.test(line.quote)) currentDay.meals.breakfast = { raw_text: line.quote.trim(), evidence: event.evidence };
      if (/lunch|\uc911\uc2dd/i.test(line.quote)) currentDay.meals.lunch = { raw_text: line.quote.trim(), evidence: event.evidence };
      if (/dinner|\uc11d\uc2dd|\ud2b9\uc2dd/i.test(line.quote)) currentDay.meals.dinner = { raw_text: line.quote.trim(), evidence: event.evidence };
    }
    if (type === 'hotel') currentDay.hotel = { raw_text: line.quote.trim(), evidence: event.evidence };
  }

  const optionLines = sectionLines.filter(line => eventTypeForLine(line.quote) === 'option');
  const options = optionLines.map(line => {
    const usd = line.quote.match(USD_RE);
    const duration = line.quote.match(/(\d+)\s*(?:\ubd84|min|minutes?|\uc2dc\uac04|hour)/i);
    const day = [...days].reverse().find(d => d.events.some(event => event.evidence.line_start <= line.lineNumber));
    return {
      region: null,
      city: null,
      raw_name: line.quote.trim(),
      normalized_name: line.quote.replace(USD_RE, '').replace(/\s+/g, ' ').trim(),
      category: optionCategory(line.quote),
      price_amount: usd ? Number(usd[1]) : null,
      currency: usd ? 'USD' : null,
      duration_minutes: duration ? Number(duration[1]) * (/hour|\uc2dc\uac04/i.test(duration[0]) ? 60 : 1) : null,
      day_number: day?.day ?? null,
      evidence: evidenceFromLines(lines, line.lineNumber),
      match_status: 'review' as const,
    };
  });

  const inclusions = sectionLines
    .filter(line => /include|\ud3ec\ud568/i.test(line.quote))
    .map(line => ({ value: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const exclusions = sectionLines
    .filter(line => /exclude|\ubd88\ud3ec\ud568/i.test(line.quote))
    .map(line => ({ value: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const shopping = sectionLines
    .filter(line => eventTypeForLine(line.quote) === 'shopping')
    .map(line => ({ value: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const remarkLines = sectionLines
    .filter(line => REMARK_RE.test(line.quote))
    .map(line => ({ text: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const standard_notices = extractStandardNoticesFromRemarkLines(remarkLines);
  const minDepartureLine = sectionLines.find(line => /minimum|min\.?|\ucd5c\uc18c/i.test(line.quote) && /\d+/.test(line.quote));
  const minimum_departure = minDepartureLine
    ? {
        value: Number(
          minDepartureLine.quote.match(/(?:minimum|min\.?|\ucd5c\uc18c(?:\ucd9c\ubc1c)?)\D*(\d+)/i)?.[1]
            ?? minDepartureLine.quote.match(/\d+/)?.[0]
            ?? 0,
        ),
        evidence: evidenceFromLines(lines, minDepartureLine.lineNumber),
      }
    : null;
  const title = boundary.title_hint;
  const duration = parseDuration(title, days.length);

  return {
    variant_key: `v${boundary.index + 1}`,
    grade: title.match(/\b(standard|premium|lilac|deluxe|basic|vip)\b/i)?.[1] ?? null,
    course: title,
    duration_days: duration.durationDays,
    nights: duration.nights,
    title_parts: titleParts(lines, boundary),
    price_calendar: prices,
    flight_segments,
    days,
    inclusions,
    exclusions,
    options,
    shopping,
    standard_notices,
    minimum_departure,
    evidence_coverage: {
      price: prices.length > 0,
      flight: flight_segments.length > 0,
      itinerary: days.length > 0,
      meals: days.some(day => Object.values(day.meals).some(value => Object.keys(value).length > 0)),
      hotel: days.some(day => Object.keys(day.hotel).length > 0),
      inclusions: inclusions.length > 0,
      exclusions: exclusions.length > 0,
      minimum_departure: Boolean(minimum_departure),
      options: options.length > 0,
      shopping: shopping.length > 0,
    },
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
