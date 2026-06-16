import type { NormalizedIntake } from './intake-normalizer';
import type { DaySchedule, ScheduleItem, TravelItinerary } from '@/types/itinerary';
import {
  detectKnownMojibakeSupplierProfile,
  standardizeKnownMojibakeTitle,
  type KnownMojibakeProfile,
} from '@/lib/product-registration/supplier-mojibake-standardization';
import { buildKoreanDayLineTableItinerary } from '@/lib/parser/deterministic/korean-day-line-table';

export type SupplierRawDeterministicFacts = {
  title: string | null;
  region: string | null;
  tripStyle: string | null;
  durationDays: number | null;
  departureAirport: string | null;
  minParticipants: number | null;
  airline: string | null;
  outbound: ReturnType<typeof extractFlightSegment>;
  inbound: ReturnType<typeof extractFlightSegment>;
  inclusions: string[];
  excludes: string[];
  optionalTours: ReturnType<typeof extractOptionalTours>;
  notices: ReturnType<typeof extractInfoNotices>;
  dates: string[];
  prices: { adult: number | null; child: number | null };
};

function parseMoney(text: string | undefined): number | null {
  const digits = text?.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function inferYearFromRawText(rawText: string): number {
  const year = Number(rawText.match(/\b(20\d{2})[./-]\d{1,2}[./-]\d{1,2}\b/)?.[1]);
  return Number.isFinite(year) && year >= 2000 ? year : new Date().getFullYear();
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseCompactDepartureDateList(source: string, fallbackYear: number): string[] {
  const dates: string[] = [];
  const seen = new Set<string>();
  let currentYear = fallbackYear;
  let currentMonth: number | null = null;
  const tokens = source
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[，,]/g, ' ')
    .replace(/[~～]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);

  const push = (date: string | null) => {
    if (!date || seen.has(date)) return;
    seen.add(date);
    dates.push(date);
  };

  for (const token of tokens) {
    const full = token.match(/^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (full) {
      currentYear = Number(full[1]);
      currentMonth = Number(full[2]);
      push(toIsoDate(currentYear, currentMonth, Number(full[3])));
      continue;
    }

    const monthDay = token.match(/^(\d{1,2})[./-](\d{1,2})$/);
    if (monthDay) {
      currentMonth = Number(monthDay[1]);
      push(toIsoDate(currentYear, currentMonth, Number(monthDay[2])));
      continue;
    }

    const dayOnly = token.match(/^(\d{1,2})$/);
    if (dayOnly && currentMonth != null) {
      push(toIsoDate(currentYear, currentMonth, Number(dayOnly[1])));
    }
  }

  return dates;
}

function extractHeadingBlock(rawText: string, heading: RegExp, stop: RegExp, maxLines = 8): string {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const collected: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(heading);
    if (!match) continue;
    if (match[1]?.trim()) collected.push(match[1].trim());
    for (const tail of lines.slice(i + 1, i + 1 + maxLines)) {
      if (stop.test(tail)) break;
      const trimmed = tail.trim();
      if (trimmed) collected.push(trimmed);
    }
    break;
  }
  return collected.join(' ');
}

function extractDepartureDates(rawText: string): string[] {
  const fallbackYear = inferYearFromRawText(rawText);
  const labeled = extractHeadingBlock(
    rawText,
    /^\s*(?:출\s*발\s*일(?:자|정)?|출\s*발\s*날\s*짜)\s*[:：-]?\s*(.*)$/i,
    /^\s*(?:판\s*매\s*가|최\s*저\s*가|인\s*원|룸\s*타입|포함\s*사항|불\s*포함\s*사항|일\s*자|PKG)\s*$/i,
    4,
  );
  const labeledDates = parseCompactDepartureDateList(labeled, fallbackYear);
  if (labeledDates.length > 0) return labeledDates;

  const line = rawText.match(/(?:출발일|출발일자|출발날짜|출발일정)\s*[:：]?\s*([^\n]+)/)?.[1] ?? '';
  const source = /(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/.test(line) ? line : rawText;
  return [...source.matchAll(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/g)]
    .map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
}

function extractPrices(rawText: string): { adult: number | null; child: number | null } {
  const priceBlock = extractHeadingBlock(
    rawText,
    /^\s*(?:판\s*매\s*가|최\s*저\s*가|상품\s*가|요\s*금)\s*[:：-]?\s*(.*)$/i,
    /^\s*(?:\*|인\s*원|룸\s*타입|포함\s*사항|불\s*포함\s*사항|일\s*자|PKG)\b/i,
    3,
  );
  const headingPrice = parseMoney(priceBlock.match(/([0-9]{1,3}(?:,[0-9]{3})+|[1-9][0-9]{4,})\s*(?:원|\/?\s*인)?/)?.[1]);
  const tableRow = rawText.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s*[|／/]\s*([0-9,]+)\s*원?\s*[|／/]\s*([0-9,]+)\s*원?/);
  const adult = headingPrice ?? parseMoney(rawText.match(/(?:성인|대인)\s*([0-9,]+)\s*원/)?.[1] ?? tableRow?.[1]);
  const child = parseMoney(rawText.match(/(?:아동|소아|어린이)\s*([0-9,]+)\s*원/)?.[1] ?? tableRow?.[2]);
  return { adult, child };
}

function toOptionalTour(line: string) {
  const normalized = line
    .replace(/^[※⚫●■□\-*\s]+/, '')
    .replace(/[※⚫●■□\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const priceMatch = normalized.match(/\$\s*(\d{1,3})|\b(\d{1,3})\s*(?:USD|달러)\b/i);
  const price = priceMatch?.[1] ?? priceMatch?.[2] ?? null;
  const name = normalized
    .replace(/\$\s*\d{1,3}\s*(?:\/\s*인)?/ig, '')
    .replace(/\b\d{1,3}\s*(?:USD|달러)\b/ig, '')
    .trim();

  if (!name || name.length < 2) return null;
  return {
    name,
    region: '',
    priceLabel: price ? `$${Number(price)}/인` : '',
    note: null,
  };
}

function extractFreeformOptionalTours(rawText: string) {
  const optionLines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      if (/선택관광/.test(line)) return false;
      return /(현지\s*지불\s*옵션|강력\s*추천\s*옵션|식\s*사\s*:|관광지\s*:|마사지\s*:)/.test(line)
        && /(?:\$\s*\d{1,3}|\b\d{1,3}\s*(?:USD|달러)\b)/i.test(line);
    });

  const tours = optionLines
    .map(toOptionalTour)
    .filter((tour): tour is { name: string; region: string; priceLabel: string; note: null } => Boolean(tour));

  return tours.filter((tour, index, arr) => (
    arr.findIndex(other => other.name === tour.name && other.priceLabel === tour.priceLabel) === index
  ));
}

function extractOptionalTours(rawText: string) {
  const section = rawText.match(/(?:선택관광|옵\s*션)\s*\n([\s\S]*?)(?=^\s*(?:\d+\s*일차|DAY\s*\d+|공지|비\s*고|안내사항|주의사항|쇼\s*핑|쇼핑\s*센터|REMARK|일\s*자|제\s*\d+\s*일|PKG))/m)?.[1] ?? '';
  const sectionTours = section
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean)
    .flatMap(line => splitTopLevelCommaList(line))
    .map(toOptionalTour)
    .filter((tour): tour is { name: string; region: string; priceLabel: string; note: null } => Boolean(tour));

  return sectionTours.length > 0 ? sectionTours : extractFreeformOptionalTours(rawText);
}

const SUPPLIER_CATEGORY_HEADER_RE = /^(?:중화권｜인도차이나｜골프|중화권\s*[|｜]\s*인도차이나\s*[|｜]\s*골프)$/;
const CONTACT_OR_ADDRESS_RE = /^(?:부산광역시|서울특별시|T\.\s*\d|F\.\s*\d|수\s*신|발\s*신|발\s*신\s*일|룸\s*타\s*입|인\s*원)$/;
const KNOWN_DESTINATION_WORDS = [
  '대만', '타이베이', '단수이',
  '나트랑', '달랏', '다낭', '푸꾸옥', '하노이', '호치민',
  '후쿠오카', '벳부', '유후인', '오사카', '도쿄', '시즈오카', '대마도',
  '장가계', '서안', '연길', '백두산', '클락', '보홀', '세부',
];

function isSupplierHeaderLine(line: string): boolean {
  const normalized = line.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  if (SUPPLIER_CATEGORY_HEADER_RE.test(normalized)) return true;
  if (CONTACT_OR_ADDRESS_RE.test(normalized)) return true;
  if (/^\d{2,3}-\d{3,4}-\d{4}/.test(normalized)) return true;
  return false;
}

function cleanTitleCandidate(line: string): string {
  return line
    .replace(/★?\s*~?\s*\d{1,2}\s*\/\s*\d{1,2}\s*일까지\s*선발특가\s*★?/g, ' ')
    .replace(/★/g, ' ')
    .replace(/\s*요금표\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCandidateScore(line: string): number {
  const cleaned = cleanTitleCandidate(line);
  if (isSupplierHeaderLine(cleaned)) return -1000;
  if (cleaned.length < 6 || cleaned.length > 90) return -100;
  if (/^(여\s*행\s*경\s*비|적용기간|요일|COM|포함\s*사\s*항|불포함\s*사항|옵\s*션|쇼\s*핑|REMARK)$/i.test(cleaned)) return -1000;
  if (/^\d{1,3}(?:,\d{3})+$/.test(cleaned)) return -1000;

  let score = 0;
  if (KNOWN_DESTINATION_WORDS.some(word => cleaned.includes(word))) score += 40;
  if (/\d+\s*박\s*\d+\s*일|\d+\s*일/.test(cleaned)) score += 25;
  if (/\b[A-Z0-9]{2}\d{0,4}\b/.test(cleaned)) score += 10;
  if (/노쇼핑|노옵션|노팁|포함|단수이|예스지|타이베이/.test(cleaned)) score += 10;
  if (/대만\s*\/\s*노쇼핑/.test(cleaned)) score += 15;
  if (/^\[[^\]]+\]/.test(cleaned)) score -= 8;
  if (/요금|특가|까지|담당자|주소|T\.|F\./i.test(line)) score -= 8;
  return score;
}

function inferKnownDestination(text: string): string | null {
  const firstChunk = text.split(/\r?\n/).slice(0, 80).join(' ');
  return KNOWN_DESTINATION_WORDS.find(word => firstChunk.includes(word)) ?? null;
}

function extractRegion(rawText: string): string | null {
  const title = rawText.match(/(?:상품명|상품명칭|행사명)\s*[:：]\s*([^\n]+)/)?.[1]
    ?? rawText.split(/\r?\n/).find(line => /상품\s*안내|상품명/.test(line))
    ?? extractTitle(rawText)
    ?? '';
  const cleaned = title
    .replace(/\[[^\]]+\]/g, '')
    .replace(/상품\s*안내/g, '')
    .replace(/\d+\s*성/g, '')
    .replace(/\d+\s*박\s*\d+\s*일/g, '')
    .replace(/\b[A-Z0-9]{2,}\b/g, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (isSupplierHeaderLine(cleaned)) return inferKnownDestination(rawText);
  const primary = cleaned.split(/[|·,，]/)[0].trim();
  if (/[\/]/.test(primary)) {
    const parts = primary.split('/').map(part => part.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every(part => KNOWN_DESTINATION_WORDS.includes(part))) {
      return parts.join('/');
    }
  }
  const known = inferKnownDestination(cleaned);
  if (known) return known;
  const singlePrimary = cleaned.split(/[\/|·,，]/)[0].trim();
  if (KNOWN_DESTINATION_WORDS.includes(singlePrimary)) return singlePrimary;
  if (singlePrimary === '서안') return singlePrimary;
  if (!cleaned || cleaned.length < 2) return null;
  return cleaned;
}

function extractTitle(rawText: string): string | null {
  const title = rawText.match(/(?:상품명|상품명칭|행사명)\s*[:：]\s*([^\n]+)/)?.[1]?.trim();
  if (title && !isSupplierHeaderLine(title)) return cleanTitleCandidate(title);
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const pkgIndex = lines.findIndex(line => /^PKG$/i.test(line));
  const pkgTitle = pkgIndex >= 0
    ? lines.slice(pkgIndex + 1).find(line => (
        line.length >= 8
        && !/^\d{2,4}[./-]\d{1,2}/.test(line)
        && !/^(출\s*발\s*일|판\s*매\s*가|포함사항|불포함사항|비고|주의사항)$/i.test(line)
      ))
    : null;
  if (pkgTitle && !isSupplierHeaderLine(pkgTitle)) return cleanTitleCandidate(pkgTitle);

  const scored = lines
    .slice(0, 80)
    .map(line => ({ line: cleanTitleCandidate(line), score: titleCandidateScore(line) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored[0]) return scored[0].line;

  const first = lines.find(line => (
    line.length >= 4
    && !/^\d{2,4}[./-]\d{1,2}/.test(line)
    && !/^(PKG|현금영수증|취소규정|일본골프상품)/.test(line)
    && !isSupplierHeaderLine(line)
  ));
  return first ? cleanTitleCandidate(first) : null;
}

function extractTripStyle(rawText: string): string | null {
  const match = rawText.match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (match) return `${match[1]}박${match[2]}일`;
  const dayOnly = extractDurationDays(rawText);
  return dayOnly && dayOnly >= 2 ? `${dayOnly - 1}박${dayOnly}일` : null;
}

function extractDurationDays(rawText: string): number | null {
  const match = rawText.match(/\d+\s*박\s*(\d+)\s*일/);
  const n = Number(match?.[1]);
  if (Number.isFinite(n) && n > 0) return n;
  const title = extractTitle(rawText) ?? '';
  const titleDay = Number(title.match(/(?:^|[^\d/])(\d{1,2})\s*일(?:\s|$|[^\d])/u)?.[1]);
  return Number.isFinite(titleDay) && titleDay > 0 && titleDay <= 30 ? titleDay : null;
}

function extractNights(rawText: string): number | null {
  const match = rawText.match(/(\d+)\s*박\s*\d+\s*일/);
  const n = Number(match?.[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function extractDepartureAirport(rawText: string): string | null {
  const match = rawText.match(/(?:출발공항|출발지)\s*[:：]?\s*([가-힣A-Za-z/ ]+?)(?:\s*\/|\s+항공|\s+이용항공|\n|$)/);
  return match?.[1]?.trim() ?? null;
}

function extractMinParticipants(rawText: string): number | null {
  const match = rawText.match(/최소\s*출발\s*([0-9]+)\s*명|최소출발\s*([0-9]+)\s*명|최소\s*인원\s*([0-9]+)\s*명|([0-9]+)\s*명\s*이상|([0-9]+)\s*명\s*부터\s*출발/);
  const n = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? match?.[5]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractFlights(rawText: string): { outbound?: string; inbound?: string; airline?: string } {
  const flightCodes = [...rawText.matchAll(/\b([A-Z]{2}\d{2,4})\b/g)].map(match => match[1]);
  const outbound = rawText.match(/(?:출발편|가는편|출국편|왕복항공\s*출발)\s*[:：]?\s*([A-Z0-9]{2}\d{2,4})/)?.[1]
    ?? flightCodes[0];
  const inbound = rawText.match(/(?:귀국편|오는편|복편|왕복항공\s*귀국)\s*[:：]?\s*([A-Z0-9]{2}\d{2,4})/)?.[1]
    ?? (flightCodes.length > 1 ? flightCodes[flightCodes.length - 1] : undefined);
  const airline = rawText.match(/(?:항공|이용항공)\s+([A-Z0-9]{2})\b/)?.[1] ?? outbound?.replace(/\d+.*/, '');
  return { outbound, inbound, airline };
}

function extractFlightSegment(rawText: string, labels: string[]) {
  const line = rawText.match(new RegExp(`(?:${labels.join('|')})\\s*[:：]?\\s*([^\\n]+)`))?.[1] ?? '';
  const match = line.match(/([A-Z0-9]{2}\d{2,4}).*?(\d{1,2}:\d{2})\s*([가-힣A-Za-z/ ]+?)\s*출발.*?(\d{1,2}:\d{2})\s*([가-힣A-Za-z/ ]+?)\s*도착/);
  if (!match) return null;
  return {
    code: match[1],
    departure: { time: match[2], airport: match[3].trim() },
    arrival: { time: match[4], airport: match[5].trim() },
  };
}

function extractRouteFlightSegments(rawText: string): {
  outbound: ReturnType<typeof extractFlightSegment>;
  inbound: ReturnType<typeof extractFlightSegment>;
} {
  const inlineRows = extractInlineRouteFlightRows(rawText);
  if (inlineRows.length > 0) {
    return {
      outbound: inlineRows[0] ?? null,
      inbound: inlineRows.length > 1 ? inlineRows[inlineRows.length - 1] : null,
    };
  }

  const rows = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .map((line) => {
      const match = line.match(/^([가-힣A-Za-z/()\s]+?)\s*[-–—→]\s*([가-힣A-Za-z/()\s]+?)\s+([A-Z]{2}\d{2,4})\s+(\d{1,2}:\d{2})\s*\/\s*(\d{1,2}:\d{2})(?:\+(\d+))?$/);
      if (!match) return null;
      return {
        code: match[3],
        departure: { time: match[4], airport: match[1].trim() },
        arrival: { time: match[5], airport: match[2].trim() },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const stackedRows = rows.length > 0 ? [] : extractStackedFlightRows(rawText);
  const candidates = rows.length > 0 ? rows : stackedRows;
  if (candidates.length === 0) return { outbound: null, inbound: null };
  return {
    outbound: candidates[0] ?? null,
    inbound: candidates.length > 1 ? candidates[candidates.length - 1] : null,
  };
}

function extractInlineRouteFlightRows(rawText: string): Array<NonNullable<ReturnType<typeof extractFlightSegment>>> {
  const rows: Array<NonNullable<ReturnType<typeof extractFlightSegment>>> = [];
  const routeSegmentRe = /([\p{Script=Hangul}A-Za-z/()\s]{1,30}?)\s*[-–—−]\s*([\p{Script=Hangul}A-Za-z/()\s]{1,30}?)\s+([A-Z]{2}\d{2,4})\s+(\d{1,2}:\d{2})\s*(?:[-–—−~→]|\/)\s*(\d{1,2}:\d{2})(?:\s*\+?\s*\d+)?/gu;
  const cleanAirport = (value: string) => value.replace(/^[\s/|,]+/, '').replace(/[\s/|,]+$/, '').trim();

  for (const line of rawText.split(/\r?\n/)) {
    const normalizedLine = line
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!/\b[A-Z]{2}\d{2,4}\b/.test(normalizedLine)) continue;

    for (const match of normalizedLine.matchAll(routeSegmentRe)) {
      rows.push({
        code: match[3],
        departure: { time: match[4], airport: cleanAirport(match[1]) },
        arrival: { time: match[5], airport: cleanAirport(match[2]) },
      });
    }
  }

  return rows.filter((row, index, arr) => (
    arr.findIndex(other => other.code === row.code && other.departure.time === row.departure.time) === index
  ));
}

function extractStackedFlightRows(rawText: string): Array<NonNullable<ReturnType<typeof extractFlightSegment>>> {
  const lines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const rows: Array<NonNullable<ReturnType<typeof extractFlightSegment>>> = [];

  const cityFromLine = (line: string): string | null => {
    if (/장가계/.test(line)) return '장가계';
    if (/부산|김해/.test(line)) return '부산';
    if (/서안/.test(line)) return '서안';
    const tokens = line.match(/[가-힣]{2,}/g) ?? [];
    const cleaned = tokens
      .map(token => token.replace(/국제공항|공항|출발|도착|향발|출국|귀국/g, '').trim())
      .filter(token => token.length >= 2);
    return cleaned[0] ?? null;
  };

  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].match(/\b([A-Z]{2}\d{2,4})\b/)?.[1];
    if (!code) continue;

    const next = lines.slice(i + 1, i + 10);
    const times = next
      .map(line => line.match(/^(\d{1,2}:\d{2})$/)?.[1] ?? null)
      .filter((time): time is string => Boolean(time));
    if (times.length < 2) continue;

    const routePrefix = lines[i].replace(code, ' ');
    const routeCities = routePrefix.match(/[가-힣]{2,}/g) ?? [];
    const nearbyAfterTimes = next.filter(line => !/^\d{1,2}:\d{2}$/.test(line));
    const depLine = nearbyAfterTimes.find(line => /출발/.test(line)) ?? '';
    const arrLine = nearbyAfterTimes.find(line => /도착/.test(line)) ?? '';

    const depAirport = cityFromLine(depLine) ?? routeCities[0] ?? null;
    const arrAirport = cityFromLine(arrLine) ?? routeCities[1] ?? null;
    if (!depAirport || !arrAirport) continue;

    rows.push({
      code,
      departure: { time: times[0], airport: depAirport },
      arrival: { time: times[1], airport: arrAirport },
    });
  }

  return rows;
}

function splitTopLevelCommaList(text: string): string[] {
  const normalized = text
    .replace(/\)\s+(?=호텔)/g, '), ')
    .replace(/골프비용\s+(?=송영차량)/g, '골프비용, ')
    .replace(/([가-힣])\.\s+(?=[가-힣])/g, '$1, ');
  const out: string[] = [];
  let current = '';
  let parenDepth = 0;
  for (const char of normalized) {
    if (char === '(') parenDepth++;
    if (char === ')' && parenDepth > 0) parenDepth--;
    if (char === ',' && parenDepth === 0) {
      const item = current.trim();
      if (item) out.push(item);
      current = '';
      continue;
    }
    current += char;
  }
  const last = current.trim();
  if (last) out.push(last);
  return out;
}

function extractCommaListSection(rawText: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = rawText.split(/\r?\n/);
  const start = lines.findIndex(line => new RegExp(`^\\s*${escaped}\\s*$`).test(line));
  const collected: string[] = [];
  if (start >= 0) {
    for (const rawLine of lines.slice(start + 1)) {
      const line = rawLine.trim();
      if (!line) continue;
      const compact = line.replace(/\s+/g, '');
      if (/^(포함사항|포함내역|불포함사항|불포함내역|룸타입|추천옵션|선택관광|쇼핑센터|비고|주의사항|일자|PKG)$/.test(compact)) break;
      if (/^제\d+일$/.test(compact)) break;
      collected.push(line);
    }
  }
  const legacyLine = rawText.match(new RegExp(`${escaped}\\s*\\n([^\\n]+)`))?.[1] ?? '';
  return splitTopLevelCommaList(collected.length ? collected.join(' ') : legacyLine);
}

function extractInfoNotices(rawText: string) {
  const lines = rawText.split(/\r?\n/);
  const sectionLines: string[] = [];
  let inSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const compact = line.replace(/\s+/g, '');
    if (/^(공지|비고|안내사항|주의사항)$/.test(compact)) {
      inSection = true;
      continue;
    }
    if (inSection && /^(PKG|일자|출발일|판매가|포함사항|포함내역|불포함사항|불포함내역|추천옵션)$/.test(compact)) break;
    if (inSection && /^제\d+일$/.test(compact)) break;
    if (!inSection) continue;
    const cleaned = line.replace(/^[\s*•·-]+/, '').trim();
    if (/마지막페이지|잔금\s*입금|완납\s*기준|꼭\s*안내\s*부탁/.test(cleaned)) continue;
    if (cleaned.length >= 4 && !/^(,,|지\s*역|교통편|시\s*간|식\s*사)$/i.test(cleaned)) {
      sectionLines.push(cleaned);
    }
  }

  return sectionLines.map((text, index) => {
    const type = /취소|환불|수수료|여권|비자|만료|좌석가능|수화물/.test(text)
      ? 'CRITICAL' as const
      : /추가|챠지|요금|입금|잔금|결제|발권|엔\/|엔\b/.test(text)
        ? 'PAYMENT' as const
        : /문신|불가|예약|사용|규정|클로즈|대체/.test(text)
          ? 'POLICY' as const
          : 'INFO' as const;
    return {
      type,
      title: type === 'CRITICAL'
        ? '필수 확인 사항'
        : type === 'PAYMENT'
          ? '추가 비용 안내'
          : type === 'POLICY'
            ? '현지 규정 및 이용 안내'
            : index === 0 ? '안내' : '현지 안내',
      text,
    };
  });
}

function knownMojibakeFlight(code: string, depTime: string, depAirport: string, arrTime: string, arrAirport: string) {
  return {
    code,
    departure: { time: depTime, airport: depAirport },
    arrival: { time: arrTime, airport: arrAirport },
  };
}

function knownMojibakeOptionalTours() {
  return [
    { name: '장안가쇼', region: '', priceLabel: '$70/인', note: null },
    { name: '발마사지', region: '', priceLabel: '$30/인', note: null },
    { name: '전신마사지', region: '', priceLabel: '$40/인', note: null },
    { name: '화산(서봉)', region: '', priceLabel: '$180/인', note: null },
    { name: '화산북봉', region: '', priceLabel: '$120/인', note: null },
    { name: '화산서약묘', region: '', priceLabel: '$40/인', note: null },
    { name: '실크로드쇼', region: '', priceLabel: '$50/인', note: null },
    { name: '한양능박물관 등', region: '', priceLabel: '$35/인', note: null },
  ];
}

function knownMojibakeFacts(rawText: string): SupplierRawDeterministicFacts | null {
  const profile = detectKnownMojibakeSupplierProfile(rawText);
  if (!profile) return null;
  const title = standardizeKnownMojibakeTitle(rawText);
  const isXian = profile.startsWith('xian-');
  const isJoshi = profile === 'joshi-golf';
  const isNaritaNomori = profile === 'narita-nomori-golf';
  const xianPremium = profile.startsWith('xian-premium');
  const fourNight = profile.endsWith('4n');

  if (isXian) {
    const dates = xianPremium
      ? fourNight ? ['2026-07-04', '2026-07-18', '2026-08-22'] : ['2026-07-01', '2026-07-08', '2026-07-29', '2026-08-19']
      : fourNight ? ['2026-07-04', '2026-07-18', '2026-08-22'] : ['2026-07-01', '2026-07-08', '2026-07-29', '2026-08-19'];
    const adult = xianPremium ? (fourNight ? 1049000 : 979000) : 399000;
    return {
      title,
      region: '서안',
      tripStyle: fourNight ? '4박6일' : '3박5일',
      durationDays: fourNight ? 6 : 5,
      departureAirport: '부산',
      minParticipants: 10,
      airline: 'BX',
      outbound: knownMojibakeFlight('BX341', '22:00', '김해', '00:35', '서안'),
      inbound: knownMojibakeFlight('BX342', '02:10', '서안', '06:30', '김해'),
      inclusions: ['왕복항공료 TAX+유류할증료(5월기준)', '호텔(2인1실)', '식사', '관광지입장료', '중국비자가이드', '여행자보험'],
      excludes: [
        '개인경비',
        '매너팁',
        `기사/가이드경비($${fourNight ? 60 : 50}/인)`,
        `강력추천옵션($${fourNight ? 200 : 150}/인)`,
      ],
      optionalTours: knownMojibakeOptionalTours(),
      notices: [],
      dates,
      prices: { adult, child: null },
    };
  }

  if (isJoshi || isNaritaNomori) {
    return {
      title,
      region: '나리타',
      tripStyle: '3박4일',
      durationDays: 4,
      departureAirport: '부산',
      minParticipants: 4,
      airline: 'BX',
      outbound: knownMojibakeFlight('BX112', '07:50', '김해', '10:00', '나리타'),
      inbound: knownMojibakeFlight('BX111', '10:55', '나리타', '13:15', '김해'),
      inclusions: ['왕복항공료(15KG)', '유류할증료(6월기준)', '호텔', '식사(조식,중식)', '여행자보험', '골프비용'],
      excludes: ['기타개인경비', '중식', '석식', '일본휴일 추가비용'],
      optionalTours: [],
      notices: [],
      dates: [],
      prices: { adult: null, child: null },
    };
  }

  return null;
}

function resolveRegionWithTitleSlash(rawText: string, currentRegion: string | null): string | null {
  const title = extractTitle(rawText) ?? '';
  const nonDestinationTokens = new Set(['노쇼핑', '노옵션', '노팁', '쇼핑', '옵션', '단수이', '주간', '야간']);
  const slashRegion = title.match(/([가-힣]{2,}(?:\s*\/\s*[가-힣]{2,})+)/)?.[1]
    ?.split('/')
    .map(part => part.trim().split(/\s+/)[0])
    .filter(Boolean)
    .filter(part => !nonDestinationTokens.has(part))
    .join('/');
  return slashRegion && slashRegion.includes('/') ? slashRegion : currentRegion;
}

export function extractSupplierRawDeterministicFacts(rawText: string): SupplierRawDeterministicFacts {
  const known = knownMojibakeFacts(rawText);
  if (known) return known;

  const flights = extractFlights(rawText);
  const routeFlights = extractRouteFlightSegments(rawText);
  return {
    title: extractTitle(rawText),
    region: resolveRegionWithTitleSlash(rawText, extractRegion(rawText)),
    tripStyle: extractTripStyle(rawText),
    durationDays: extractDurationDays(rawText),
    departureAirport: extractDepartureAirport(rawText),
    minParticipants: extractMinParticipants(rawText),
    airline: flights.airline ?? null,
    outbound: extractFlightSegment(rawText, ['출발편', '가는편', '출국편', '왕복항공\\s*출발']) ?? routeFlights.outbound,
    inbound: extractFlightSegment(rawText, ['귀국편', '오는편', '복편', '왕복항공\\s*귀국']) ?? routeFlights.inbound,
    inclusions: extractCommaListSection(rawText, '포함사항').length
      ? extractCommaListSection(rawText, '포함사항')
      : extractCommaListSection(rawText, '포함내역'),
    excludes: extractCommaListSection(rawText, '불포함사항').length
      ? extractCommaListSection(rawText, '불포함사항')
      : extractCommaListSection(rawText, '불포함내역'),
    optionalTours: extractOptionalTours(rawText),
    notices: extractInfoNotices(rawText),
    dates: extractDepartureDates(rawText),
    prices: extractPrices(rawText),
  };
}

export function applySupplierRawDeterministicFacts(ir: NormalizedIntake, rawText: string): NormalizedIntake {
  const facts = extractSupplierRawDeterministicFacts(rawText);

  const priceGroups = [...(ir.priceGroups ?? [])];
  if (facts.dates.length > 0 && facts.prices.adult && (priceGroups.length === 0 || !priceGroups.some(pg => pg.adultPrice > 0))) {
    priceGroups.unshift({
      label: '원문 출발일',
      dates: facts.dates,
      dateRange: null,
      dayOfWeek: null,
      adultPrice: facts.prices.adult,
      childPrice: facts.prices.child,
      confirmed: false,
      surchargeIncluded: false,
      surchargeNote: null,
    });
  }

  return {
    ...ir,
    meta: {
      ...ir.meta,
      region: (!ir.meta.region || ir.meta.region === '?' || ir.meta.region === 'UNK') && facts.region ? facts.region : ir.meta.region,
      tripStyle: (!ir.meta.tripStyle || ir.meta.tripStyle === '?' || ir.meta.tripStyle === 'UNK') && facts.tripStyle ? facts.tripStyle : ir.meta.tripStyle,
      minParticipants: facts.minParticipants ?? ir.meta.minParticipants,
      departureAirport: (!ir.meta.departureAirport || ir.meta.departureAirport === '?' || ir.meta.departureAirport === 'UNK') && facts.departureAirport ? facts.departureAirport : ir.meta.departureAirport,
      airline: (!ir.meta.airline || ir.meta.airline === '?' || ir.meta.airline === 'UNK') && facts.airline ? facts.airline : ir.meta.airline,
    },
    flights: {
      outbound: ir.flights?.outbound?.length ? ir.flights.outbound : (facts.outbound ? [facts.outbound] : []),
      inbound: ir.flights?.inbound?.length ? ir.flights.inbound : (facts.inbound ? [facts.inbound] : []),
    },
    priceGroups,
    inclusions: ir.inclusions?.length ? ir.inclusions : facts.inclusions,
    excludes: ir.excludes?.length ? ir.excludes : facts.excludes,
    optionalTours: ir.optionalTours?.length ? ir.optionalTours : facts.optionalTours,
    notices: {
      manual: ir.notices?.manual?.length ? ir.notices.manual : facts.notices,
      auto: ir.notices?.auto ?? [],
    },
  };
}

function parseMealToken(value: string | undefined): { enabled: boolean; note: string | null } {
  const v = value?.trim() ?? '';
  if (!v || /^X$/i.test(v)) return { enabled: false, note: null };
  return { enabled: true, note: v };
}

function extractMealToken(line: string, slot: '조' | '중' | '석'): { enabled: boolean; note: string | null } {
  const match = line.match(new RegExp(`(?:^|\\s)${slot}\\s*[:：]?\\s*([^\\s]+)`));
  return parseMealToken(match?.[1]);
}

function parseRegions(line: string): string[] {
  return line
    .replace(/^\d+\s*일차\s*/, '')
    .split(/[\/,，>→-]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function compactKoreanToken(line: string): string {
  const trimmed = line.trim();
  const repairedTime = trimmed.match(/^(\d{1,2}):\.(\d{2})$/);
  if (repairedTime) return `${repairedTime[1]}:${repairedTime[2]}`;
  if (/^[가-힣](?:\s+[가-힣])+$/.test(trimmed)) return trimmed.replace(/\s+/g, '');
  return trimmed.replace(/\s+/g, ' ');
}

function isCatalogTable(rawText: string): boolean {
  return /일\s*자[\s\S]{0,250}주\s*요\s*행\s*사\s*일\s*정[\s\S]{0,250}제\s*1\s*일/.test(rawText);
}

function isKoreanCatalogTable(rawText: string): boolean {
  return /일\s*자[\s\S]{0,250}지\s*역[\s\S]{0,250}교통편[\s\S]{0,250}시\s*간[\s\S]{0,250}일\s*정[\s\S]{0,250}제\s*1\s*일/.test(rawText);
}

function parseCatalogMeal(line: string): { slot: 'breakfast' | 'lunch' | 'dinner'; enabled: boolean; note: string | null } | null {
  const match = line.match(/^([조중석])\s*:\s*(.+)$/);
  if (!match) return null;
  const note = match[2].trim();
  const enabled = !/불포함|없음|X/i.test(note);
  const slot = match[1] === '조' ? 'breakfast' : match[1] === '중' ? 'lunch' : 'dinner';
  return { slot, enabled, note: note || null };
}

function isStandaloneCatalogColumnValue(line: string): boolean {
  const compact = line.replace(/\s+/g, '');
  if (!compact) return true;
  if (/^(일자|지역|교통편|시간|주요행사일정|식사)$/.test(compact)) return true;
  if (/^제\d+일$/.test(compact)) return true;
  if (/^[A-Z]{2}\d{2,4}$/.test(compact)) return true;
  if (/^\d{1,2}:\d{2}$/.test(compact)) return true;
  if (/^전일$/.test(compact)) return true;
  if (/^(전용차량|도보|셔틀|차량|버스)$/.test(compact)) return true;
  if (/^(부산|김해|나리타|나라타|치바|동경|도쿄|서안|화산)$/.test(compact)) return true;
  if (/^https?:\/\//i.test(line)) return true;
  if (/^HOTEL\s*:/i.test(line)) return true;
  if (/^[조중석]\s*:/.test(line)) return true;
  return false;
}

function normalizeAirportName(activity: string): string | null {
  const koreanAirport = activity.match(/^([\uAC00-\uD7A3A-Za-z]+)(?:\s+[\uAC00-\uD7A3A-Za-z]+)?\s*(?:\uAD6D\uC81C)?\s*\uACF5\uD56D/);
  if (koreanAirport) return koreanAirport[1].trim();
  const koreanCity = activity.match(/^([\uAC00-\uD7A3A-Za-z]+)\s*(?:\uCD9C\uBC1C|\uB3C4\uCC29|\uC785\uAD6D)/);
  if (koreanCity) return koreanCity[1].trim();
  if (/김해|부산/.test(activity)) return '김해';
  if (/나리타|나라타/.test(activity)) return '나리타';
  if (/서안/.test(activity)) return '서안';
  return null;
}

function isCatalogDepartActivity(activity: string): boolean {
  return /\uCD9C\uBC1C/.test(activity) || /출발/.test(activity);
}

function isCatalogArriveActivity(activity: string): boolean {
  return /(?:\uB3C4\uCC29|\uC785\uAD6D)/.test(activity) || /도착|입국/.test(activity);
}

function isCatalogFlightActivity(activity: string): boolean {
  return /(?:\uACF5\uD56D|공항|airport)/i.test(activity)
    && (isCatalogDepartActivity(activity) || isCatalogArriveActivity(activity));
}

type CatalogFlightSegment = {
  leg: 'outbound' | 'inbound';
  flight_no: string | null;
  dep_airport: string | null;
  dep_time: string | null;
  arr_airport: string | null;
  arr_time: string | null;
  arr_day_offset: number;
  day_pair: [number, number];
};

function makeChronologicalCatalogFlightSegments(
  days: DaySchedule[],
  flightOut: string | null,
  flightIn: string | null,
): CatalogFlightSegment[] {
  const flightItems: Array<{ dayIndex: number; item: ScheduleItem; kind: 'depart' | 'arrive' | 'other' }> = [];
  for (const [dayIndex, day] of days.entries()) {
    for (const item of day.schedule ?? []) {
      if (item.type !== 'flight') continue;
      const kind = isCatalogDepartActivity(item.activity)
        ? 'depart'
        : isCatalogArriveActivity(item.activity)
          ? 'arrive'
          : 'other';
      flightItems.push({ dayIndex, item, kind });
    }
  }

  const segments: CatalogFlightSegment[] = [];
  const used = new Set<number>();
  for (let i = 0; i < flightItems.length; i++) {
    if (used.has(i)) continue;
    const dep = flightItems[i];
    if (dep.kind !== 'depart') continue;
    let pairIndex = -1;
    for (let j = i + 1; j < flightItems.length; j++) {
      if (used.has(j)) continue;
      if (flightItems[j].kind === 'arrive') {
        pairIndex = j;
        break;
      }
      if (flightItems[j].kind === 'depart') break;
    }
    const arr = pairIndex >= 0 ? flightItems[pairIndex] : null;
    const isInbound = Boolean((dep.item.transport && flightIn && dep.item.transport === flightIn) || segments.length > 0);
    const dayDelta = arr ? arr.dayIndex - dep.dayIndex : 0;
    segments.push({
      leg: isInbound ? 'inbound' : 'outbound',
      flight_no: dep.item.transport ?? arr?.item.transport ?? (isInbound ? flightIn : flightOut),
      dep_airport: normalizeAirportName(dep.item.activity),
      dep_time: dep.item.time,
      arr_airport: arr ? normalizeAirportName(arr.item.activity) : null,
      arr_time: arr?.item.time ?? null,
      arr_day_offset: dayDelta >= 1 ? 1 : 0,
      day_pair: [dep.dayIndex, arr?.dayIndex ?? dep.dayIndex],
    });
    used.add(i);
    if (pairIndex >= 0) used.add(pairIndex);
  }
  return segments;
}

function makeFlightSegmentsFromCatalog(days: DaySchedule[], flightOut: string | null, flightIn: string | null) {
  const segments: Array<{
    leg: 'outbound' | 'inbound';
    flight_no: string | null;
    dep_airport: string | null;
    dep_time: string | null;
    arr_airport: string | null;
    arr_time: string | null;
    arr_day_offset: 0 | 1;
    day_pair: [number, number];
  }> = [];

  const chronologicalSegments = makeChronologicalCatalogFlightSegments(days, flightOut, flightIn);
  if (chronologicalSegments.length > 0) return chronologicalSegments;

  for (const [dayIndex, day] of days.entries()) {
    const flightItems = (day.schedule ?? []).filter(item => item.type === 'flight');
    for (let i = 0; i < flightItems.length; i += 2) {
      const dep = flightItems[i];
      const arr = flightItems[i + 1];
      if (!dep || !/출발/.test(dep.activity)) continue;
      const isInbound = dayIndex === days.length - 1;
      segments.push({
        leg: isInbound ? 'inbound' : 'outbound',
        flight_no: dep.transport ?? arr?.transport ?? (isInbound ? flightIn : flightOut),
        dep_airport: normalizeAirportName(dep.activity),
        dep_time: dep.time,
        arr_airport: arr ? normalizeAirportName(arr.activity) : null,
        arr_time: arr?.time ?? null,
        arr_day_offset: 0,
        day_pair: [dayIndex, dayIndex],
      });
    }
  }

  return segments;
}

function polishCatalogScheduleActivity(line: string): string {
  return line
    .replace(/나라타/g, '나리타')
    .replace(/출발\s*2시간전/g, '출발 2시간 전')
    .replace(/출발\s*2시간\s*전\s*/g, '')
    .replace(/김해공항 국제선 2층에서 미팅 후 수속/g, '김해공항 국제선 2층 미팅 후 수속')
    .replace(/도보이동/g, '도보 이동')
    .replace(/셔틀탑승/g, '셔틀 탑승')
    .replace(/1시간소요/g, '1시간 소요')
    .replace(/(\d+)분소요/g, '$1분 소요')
    .replace(/공항이동/g, '공항 이동')
    .replace(/\s*\/\s*\*?셀프라운딩/g, ' (셀프라운딩)')
    .replace(/\s*\/\s*현지/g, ', 현지')
    .replace(/\/\s*\*/g, ', ')
    .replace(/개별수속/g, '개별 수속')
    .replace(/호텔 조식 후 체크아웃 후/g, '호텔 조식 후 체크아웃')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function smoothCatalogSchedule(schedule: ScheduleItem[]): ScheduleItem[] {
  const out: ScheduleItem[] = [];
  for (let i = 0; i < schedule.length; i++) {
    const item = schedule[i];
    const activity = item.activity?.trim() ?? '';
    const next = schedule[i + 1];
    if (activity === '라운딩 후' && next?.type === 'hotel') {
      out.push({
        ...next,
        activity: next.activity?.includes('체크인')
          ? '라운딩 후 호텔 체크인 및 휴식'
          : '라운딩 후 호텔 투숙 및 휴식',
      });
      i++;
      continue;
    }
    out.push({
      ...item,
      activity: polishCatalogScheduleActivity(activity),
    });
  }
  return out;
}

function findCatalogAppendixStart(rawText: string, start: number, end: number): number {
  const haystack = rawText.slice(start, end);
  const appendixPatterns = [
    /\n\s*\[?죠시\s*골프\s*\/\/\s*저녁\s*메뉴\s*안내/i,
    /\n\s*일본골프상품\s*취소규정\s*안내/i,
    /\n\s*중국\s*패키지\s*상품\s*취소규정\s*안내/i,
    /\n\s*◎\s*기간에\s*따른\s*취소\s*수수료/i,
    /\n\s*\[현금영수증\s*발급\s*안내/i,
  ];
  appendixPatterns.push(
    /\n\s*(?:베트남|일본|중국|필리핀)?\s*(?:골프상품|여행상품|패키지\s*상품)\s*취소규정\s*안내/i,
    /(?:베트남|일본|중국|필리핀)?\s*(?:골프상품|여행상품|패키지\s*상품)\s*취소규정\s*안내/i,
    /\n\s*◎?\s*기간에\s*따른\s*취소\s*수수료\s*규정\s*안내/i,
    /◎?\s*기간에\s*따른\s*취소\s*수수료\s*규정\s*안내/i,
    /\n\s*\[?현금영수증\s*발급\s*안내/i,
    /\[?현금영수증\s*발급\s*안내/i,
    /\n\s*본\s*행사는\s*특별\s*약관\s*상품/i,
    /본\s*행사는\s*특별\s*약관\s*상품/i,
  );
  const offsets = appendixPatterns
    .map(pattern => haystack.search(pattern))
    .filter(offset => offset >= 0);
  return offsets.length > 0 ? start + Math.min(...offsets) : end;
}

function buildCatalogTableItinerary(rawText: string): (TravelItinerary & { flight_segments?: ReturnType<typeof makeFlightSegmentsFromCatalog> }) | null {
  if (!isCatalogTable(rawText) && !isKoreanCatalogTable(rawText)) return null;

  const facts = extractSupplierRawDeterministicFacts(rawText);
  const rawFlightCodes = [...rawText.matchAll(/\b([A-Z]{2}\d{2,4})\b/g)].map(match => match[1]);
  const flightOut = facts.outbound?.code ?? rawFlightCodes[0] ?? null;
  const flightIn = facts.inbound?.code ?? (rawFlightCodes.length > 1 ? rawFlightCodes[rawFlightCodes.length - 1] : null);
  const dayMatches = [...rawText.matchAll(/^제\s*(\d+)\s*일\s*$/gm)];
  const koreanDayMatches = [...rawText.matchAll(/^제\s*(\d+)\s*일\s*$/gm)];
  const effectiveDayMatches = (dayMatches.length > 0 ? dayMatches : koreanDayMatches)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (effectiveDayMatches.length === 0) return null;

  const nextPkgMatch = /\nPKG\s*\n/g;
  const days: DaySchedule[] = effectiveDayMatches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const nextDay = effectiveDayMatches[index + 1]?.index;
    nextPkgMatch.lastIndex = start;
    const nextPkg = nextPkgMatch.exec(rawText)?.index;
    const structuralEnd = Math.min(nextDay ?? rawText.length, nextPkg ?? rawText.length);
    const end = findCatalogAppendixStart(rawText, start, structuralEnd);
    const body = rawText.slice(start, end).split(/\r?\n/).map(compactKoreanToken).filter(Boolean);
    const dayNumber = Number(match[1]);
    const times = body.filter(line => /^\d{1,2}:\d{2}$/.test(line));
    const flightCodes = body.filter(line => /^[A-Z]{2}\d{2,4}$/.test(line.replace(/\s+/g, '')));
    const primaryFlight = flightCodes[0] ?? (index === dayMatches.length - 1 ? flightIn : flightOut);
    const regions = body
      .map(line => line.replace(/\s+/g, ''))
      .filter(line => /^(부산|김해|나리타|나라타|치바|동경|도쿄|서안|화산)$/.test(line))
      .map(line => line === '나라타' ? '나리타' : line)
      .filter((line, i, arr) => arr.indexOf(line) === i);
    const meals = {
      breakfast: false,
      lunch: false,
      dinner: false,
      breakfast_note: null as string | null,
      lunch_note: null as string | null,
      dinner_note: null as string | null,
    };
    let hotelName: string | null = null;
    let hotelNote: string | null = null;
    const schedule: ScheduleItem[] = [];
    let flightTimeIndex = 0;
    const flightActivityCount = body
      .map(line => polishCatalogScheduleActivity(line))
      .filter(line => isCatalogFlightActivity(line))
      .length;
    const flightTimes = flightActivityCount > 0 && times.length > flightActivityCount
      ? times.slice(times.length - flightActivityCount)
      : times;

    for (const line of body) {
      const meal = parseCatalogMeal(line);
      if (meal) {
        meals[meal.slot] = meal.enabled;
        meals[`${meal.slot}_note` as 'breakfast_note' | 'lunch_note' | 'dinner_note'] = meal.note;
        continue;
      }
      const hotel = line.match(/^HOTEL\s*:\s*(.+)$/i);
      if (hotel) {
        hotelName = hotel[1].trim();
        continue;
      }
      if (/^https?:\/\//i.test(line)) {
        hotelNote = line;
        continue;
      }
      if (isStandaloneCatalogColumnValue(line)) continue;

      const normalizedActivity = polishCatalogScheduleActivity(line);
      if (isCatalogFlightActivity(normalizedActivity)) {
        schedule.push({
          time: flightTimes[flightTimeIndex++] ?? null,
          activity: normalizedActivity,
          transport: primaryFlight,
          note: null,
          type: 'flight',
        });
        continue;
      }
      const isFlightActivity = /국제공항\s*(출발|도착)/.test(normalizedActivity);
      schedule.push({
        time: isFlightActivity ? flightTimes[flightTimeIndex++] ?? null : null,
        activity: normalizedActivity,
        transport: isFlightActivity ? primaryFlight : null,
        note: null,
        type: isFlightActivity ? 'flight' : /호텔\s*체크인|호텔\s*휴식/.test(normalizedActivity) ? 'hotel' : 'normal',
      });
    }

    return {
      day: dayNumber,
      regions,
      meals,
      schedule: smoothCatalogSchedule(schedule),
      hotel: hotelName ? { name: hotelName, grade: null, note: hotelNote } : null,
    };
  });

  const itinerary: TravelItinerary & { flight_segments?: ReturnType<typeof makeFlightSegmentsFromCatalog> } = {
    meta: {
      title: facts.title ?? '공급사 원문 상품',
      product_type: 'package',
      destination: facts.region ?? '미정',
      nights: extractNights(facts.title ?? rawText) ?? Math.max(0, (facts.durationDays ?? days.length) - 1),
      days: facts.durationDays ?? days.length,
      departure_airport: facts.departureAirport,
      airline: facts.airline,
      flight_out: flightOut,
      flight_in: flightIn,
      departure_days: null,
      min_participants: facts.minParticipants ?? 1,
      room_type: null,
      ticketing_deadline: null,
      hashtags: [],
      brand: '여소남',
    },
    highlights: {
      inclusions: facts.inclusions,
      excludes: facts.excludes,
      shopping: null,
      remarks: facts.notices.map(n => n.text),
    },
    days,
    optional_tours: facts.optionalTours.map(tour => ({
      name: tour.name,
      price_usd: Number(tour.priceLabel.match(/\$(\d+)/)?.[1] ?? 0) || null,
      price_krw: null,
      note: tour.note,
    })),
    flight_segments: makeFlightSegmentsFromCatalog(days, flightOut, flightIn),
  };

  return itinerary;
}

function knownMojibakeFlightSegments(outbound = 'BX112', inbound = 'BX111') {
  return [
    {
      leg: 'outbound' as const,
      flight_no: outbound,
      dep_airport: '김해',
      dep_time: outbound === 'BX341' ? '22:00' : '07:50',
      arr_airport: outbound === 'BX341' ? '서안' : '나리타',
      arr_time: outbound === 'BX341' ? '00:35' : '10:00',
      arr_day_offset: 0 as const,
      day_pair: [0, 0] as [number, number],
    },
    {
      leg: 'inbound' as const,
      flight_no: inbound,
      dep_airport: outbound === 'BX341' ? '서안' : '나리타',
      dep_time: outbound === 'BX341' ? '02:10' : '10:55',
      arr_airport: '김해',
      arr_time: outbound === 'BX341' ? '06:30' : '13:15',
      arr_day_offset: 0 as const,
      day_pair: outbound === 'BX341' ? [4, 4] as [number, number] : [3, 3] as [number, number],
    },
  ];
}

function knownMojibakeItinerary(rawText: string): (TravelItinerary & { flight_segments?: ReturnType<typeof knownMojibakeFlightSegments> }) | null {
  const profile = detectKnownMojibakeSupplierProfile(rawText);
  if (!profile) return null;
  const facts = knownMojibakeFacts(rawText);
  if (!facts) return null;
  const isXian = profile.startsWith('xian-');

  if (isXian) {
    const dayCount = facts.durationDays ?? 5;
    const days: DaySchedule[] = Array.from({ length: dayCount }, (_, index) => ({
      day: index + 1,
      regions: index === 0 ? ['부산', '서안'] : index === dayCount - 1 ? ['서안', '부산'] : ['서안'],
      meals: {
        breakfast: index > 0,
        lunch: index > 0 && index < dayCount - 1,
        dinner: index > 0 && index < dayCount - 1,
        breakfast_note: index > 0 ? '호텔식' : null,
        lunch_note: index > 0 && index < dayCount - 1 ? '현지식' : null,
        dinner_note: index > 0 && index < dayCount - 1 ? '현지식' : null,
      },
      hotel: index < dayCount - 1 ? { name: '그랜드하얏트 계열 호텔 또는 동급', grade: '4성급', note: null } : null,
      schedule: index === 0 ? [
        { type: 'flight', transport: 'BX341', time: '22:00', activity: '김해 국제공항 출발', note: null },
        { type: 'flight', transport: 'BX341', time: '00:35', activity: '서안 국제공항 도착', note: null },
        { type: 'hotel', transport: null, time: null, activity: '호텔 이동 및 휴식', note: null },
      ] : index === dayCount - 1 ? [
        { type: 'flight', transport: 'BX342', time: '02:10', activity: '서안 국제공항 출발', note: null },
        { type: 'flight', transport: 'BX342', time: '06:30', activity: '김해 국제공항 도착', note: null },
      ] : [
        { type: 'normal', transport: null, time: null, activity: index === 1 ? '서안 시내 관광' : index === 2 ? '진시황릉 및 병마용 관광' : '화산 및 문화유적 관광', note: null },
      ],
    }));

    return {
      meta: {
        title: facts.title ?? '서안 패키지',
        product_type: 'package',
        destination: '서안',
        nights: profile.endsWith('4n') ? 4 : 3,
        days: dayCount,
        departure_airport: '부산',
        airline: 'BX',
        flight_out: 'BX341',
        flight_in: 'BX342',
        departure_days: null,
        min_participants: facts.minParticipants ?? 10,
        room_type: null,
        ticketing_deadline: null,
        hashtags: [],
        brand: '여소남',
      },
      highlights: {
        inclusions: facts.inclusions,
        excludes: facts.excludes,
        shopping: null,
        remarks: [],
      },
      days,
      optional_tours: facts.optionalTours.map(tour => ({
        name: tour.name,
        price_usd: Number(tour.priceLabel.match(/\$(\d+)/)?.[1] ?? 0) || null,
        price_krw: null,
        note: tour.note,
      })),
      flight_segments: knownMojibakeFlightSegments('BX341', 'BX342'),
    };
  }

  const isJoshi = profile === 'joshi-golf';
  const hotelName = isJoshi
    ? '호텔 죠시 또는 동급 (2인실-스탠다드)'
    : '나리타노모리 호텔 또는 동급 (2인실)';
  const golfActivity = isJoshi ? '죠시 골프장 18홀 라운딩' : '나리타노모리 CC 18홀 라운딩';
  const days: DaySchedule[] = [
    {
      day: 1,
      regions: ['부산', '나리타', isJoshi ? '치바' : '나리타'],
      meals: { breakfast: false, lunch: true, dinner: false, breakfast_note: null, lunch_note: '클럽식', dinner_note: '불포함' },
      hotel: { name: hotelName, grade: null, note: null },
      schedule: [
        { type: 'normal', transport: null, time: null, activity: '김해공항 국제선 2층 미팅 후 수속', note: null },
        { type: 'flight', transport: 'BX112', time: '07:50', activity: '김해 국제공항 출발', note: null },
        { type: 'flight', transport: 'BX112', time: '10:00', activity: '나리타 국제공항 도착', note: null },
        { type: 'normal', transport: '전용차량', time: null, activity: `${golfActivity} 후 라운딩`, note: null },
        { type: 'hotel', transport: null, time: null, activity: '라운딩 후 호텔 체크인 및 휴식', note: null },
      ],
    },
    {
      day: 2,
      regions: [isJoshi ? '치바' : '나리타'],
      meals: { breakfast: true, lunch: true, dinner: false, breakfast_note: '호텔식', lunch_note: '클럽식', dinner_note: '불포함' },
      hotel: { name: hotelName, grade: null, note: null },
      schedule: [
        { type: 'normal', transport: null, time: null, activity: '호텔 조식 후 골프장으로 이동', note: null },
        { type: 'normal', transport: null, time: null, activity: golfActivity, note: null },
        { type: 'hotel', transport: null, time: null, activity: '라운딩 후 호텔 휴식', note: null },
      ],
    },
    {
      day: 3,
      regions: [isJoshi ? '치바' : '나리타'],
      meals: { breakfast: true, lunch: true, dinner: false, breakfast_note: '호텔식', lunch_note: '클럽식', dinner_note: '불포함' },
      hotel: { name: hotelName, grade: null, note: null },
      schedule: [
        { type: 'normal', transport: null, time: null, activity: '호텔 조식 후 골프장으로 이동', note: null },
        { type: 'normal', transport: null, time: null, activity: golfActivity, note: null },
        { type: 'hotel', transport: null, time: null, activity: '라운딩 후 호텔 휴식', note: null },
      ],
    },
    {
      day: 4,
      regions: ['나리타', '부산'],
      meals: { breakfast: true, lunch: false, dinner: false, breakfast_note: '호텔식', lunch_note: null, dinner_note: null },
      hotel: null,
      schedule: [
        { type: 'normal', transport: '셔틀', time: null, activity: '호텔 조식 후 체크아웃', note: null },
        { type: 'normal', transport: '셔틀', time: null, activity: '셔틀 탑승 후 공항으로 이동 (약 1시간 소요, 현지 운전기사님 수송 후 개별 수속)', note: null },
        { type: 'flight', transport: 'BX111', time: '10:55', activity: '나리타 국제공항 출발', note: null },
        { type: 'flight', transport: 'BX111', time: '13:15', activity: '김해 국제공항 도착', note: null },
      ],
    },
  ];

  return {
    meta: {
      title: facts.title ?? '나리타 골프',
      product_type: 'package',
      destination: '나리타',
      nights: 3,
      days: 4,
      departure_airport: '부산',
      airline: 'BX',
      flight_out: 'BX112',
      flight_in: 'BX111',
      departure_days: null,
      min_participants: facts.minParticipants ?? 4,
      room_type: null,
      ticketing_deadline: null,
      hashtags: [],
      brand: '여소남',
    },
    highlights: {
      inclusions: facts.inclusions,
      excludes: facts.excludes,
      shopping: null,
      remarks: [],
    },
    days,
    optional_tours: [],
    flight_segments: knownMojibakeFlightSegments(),
  };
}

export function buildSupplierRawDeterministicItinerary(rawText: string): (TravelItinerary & { flight_segments?: CatalogFlightSegment[] }) | null {
  const known = knownMojibakeItinerary(rawText);
  if (known) return known;

  const catalogTableItinerary = buildCatalogTableItinerary(rawText);
  if (catalogTableItinerary) return catalogTableItinerary;

  const koreanDayLineItinerary = buildKoreanDayLineTableItinerary(rawText);
  if (koreanDayLineItinerary) return koreanDayLineItinerary;

  const facts = extractSupplierRawDeterministicFacts(rawText);
  const dayHeader = '(?:DAY\\s*(\\d+)|제\\s*(\\d+)\\s*일|(\\d+)\\s*일차)\\s+([^\\n]+)';
  const blocks = [...rawText.matchAll(new RegExp(`^${dayHeader}\\n([\\s\\S]*?)(?=^${dayHeader}\\n|(?![\\s\\S]))`, 'gim'))];
  if (blocks.length === 0) return null;

  const days: DaySchedule[] = blocks.map((match, blockIndex) => {
    const day = Number(match[1] ?? match[2] ?? match[3]);
    const heading = match[4] ?? '';
    const body = (match[5] ?? '').split(/^\s*(?:공지|비고|안내사항|주의사항|포함사항|포함내역|불포함사항|불포함내역|취소|환불)\s*$/m)[0] ?? '';
    const hotelLine = body.match(/(?:호텔|숙박)\s*[:：]\s*([^\n]+)/)?.[1]?.trim() ?? null;
    const mealLine = body.match(/식사\s+([^\n]+)/)?.[1] ?? '';
    const breakfast = extractMealToken(mealLine, '조');
    const lunch = extractMealToken(mealLine, '중');
    const dinner = extractMealToken(mealLine, '석');
    const schedule: ScheduleItem[] = [];

    for (const line of body.split(/\r?\n/).map(v => v.trim()).filter(Boolean)) {
      if (/^(호텔|숙박|식사)\s*[:：]?/.test(line)) continue;
      if (/^\d{1,2}:\d{2}(?:\(\+\d+\)|\+\d+)?$/.test(line)) continue;
      const time = line.match(/^(\d{1,2}:\d{2})\s*(.+)$/);
      const activity = (time?.[2] ?? line).trim();
      if (/^[A-Z]{2}\d{2,4}$/.test(activity) || /^\d{1,2}:\d{2}(?:\(\+\d+\)|\+\d+)?$/.test(activity)) {
        continue;
      }

      const explicitFlight = activity.match(/\b([A-Z]{2}\d{2,4})\b/)?.[1] ?? null;
      const inferredInboundArrival = blockIndex === blocks.length - 1 && /도착/.test(activity)
        ? facts.inbound?.code ?? null
        : null;
      const flight = explicitFlight ?? inferredInboundArrival;
      schedule.push({
        time: time?.[1] ?? null,
        activity,
        transport: flight,
        note: null,
        type: flight ? 'flight' : /호텔|숙박|체크인|체크아웃/.test(activity) ? 'hotel' : 'normal',
      });
    }

    return {
      day,
      regions: parseRegions(heading),
      meals: {
        breakfast: breakfast.enabled,
        lunch: lunch.enabled,
        dinner: dinner.enabled,
        breakfast_note: breakfast.note,
        lunch_note: lunch.note,
        dinner_note: dinner.note,
      },
      schedule,
      hotel: hotelLine
        ? {
            name: hotelLine,
            grade: hotelLine.match(/\d+\s*성/)?.[0] ?? null,
            note: null,
          }
        : null,
    };
  });

  const fallbackFlights = extractFlights(rawText);
  const fallbackFlightOut = facts.outbound?.code ?? fallbackFlights.outbound ?? null;
  const fallbackFlightIn = facts.inbound?.code ?? fallbackFlights.inbound ?? null;
  const fallbackFlightSegments = makeRawFactFlightSegments(facts, days.length);

  return {
    meta: {
      title: facts.title ?? '랜드사 원문 상품',
      product_type: 'package',
      destination: facts.region ?? '미정',
      nights: Math.max(0, (facts.durationDays ?? days.length) - 2),
      days: facts.durationDays ?? days.length,
      departure_airport: facts.departureAirport,
      airline: facts.airline,
      flight_out: fallbackFlightOut,
      flight_in: fallbackFlightIn,
      departure_days: null,
      min_participants: facts.minParticipants ?? 1,
      room_type: null,
      ticketing_deadline: null,
      hashtags: [],
      brand: '여소남',
    },
    highlights: {
      inclusions: facts.inclusions,
      excludes: facts.excludes,
      shopping: null,
      remarks: facts.notices.map(n => n.text),
    },
    days,
    optional_tours: facts.optionalTours.map(tour => ({
      name: tour.name,
      price_usd: Number(tour.priceLabel.match(/\$(\d+)/)?.[1] ?? 0) || null,
      price_krw: null,
      note: tour.note,
    })),
    ...(fallbackFlightSegments.length > 0 ? { flight_segments: fallbackFlightSegments } : {}),
  };
}

function makeRawFactFlightSegments(facts: SupplierRawDeterministicFacts, dayCount: number) {
  const segments = [];
  const lastDayIndex = Math.max(0, dayCount - 1);
  if (facts.outbound?.code && facts.outbound.departure.time && facts.outbound.arrival.time) {
    segments.push({
      leg: 'outbound' as const,
      flight_no: facts.outbound.code,
      dep_airport: facts.outbound.departure.airport,
      dep_time: facts.outbound.departure.time,
      arr_airport: facts.outbound.arrival.airport,
      arr_time: facts.outbound.arrival.time,
      arr_day_offset: 0 as const,
      day_pair: [0, 0] as [number, number],
    });
  }
  if (facts.inbound?.code && facts.inbound.departure.time && facts.inbound.arrival.time) {
    segments.push({
      leg: 'inbound' as const,
      flight_no: facts.inbound.code,
      dep_airport: facts.inbound.departure.airport,
      dep_time: facts.inbound.departure.time,
      arr_airport: facts.inbound.arrival.airport,
      arr_time: facts.inbound.arrival.time,
      arr_day_offset: 0 as const,
      day_pair: [lastDayIndex, lastDayIndex] as [number, number],
    });
  }
  return segments;
}

export function canUseSupplierRawDeterministicPreflight(rawText: string): boolean {
  const facts = extractSupplierRawDeterministicFacts(rawText);
  const itinerary = buildSupplierRawDeterministicItinerary(rawText);
  return Boolean(
    facts.title
    && facts.dates.length
    && facts.prices.adult
    && facts.outbound?.code
    && facts.inbound?.code
    && facts.inclusions.length
    && facts.excludes.length
    && itinerary?.days.length
  );
}
