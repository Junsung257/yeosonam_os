import type { NormalizedIntake } from './intake-normalizer';
import type { DaySchedule, ScheduleItem, TravelItinerary } from '@/types/itinerary';

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
  const section = rawText.match(/선택관광\s*\n([\s\S]*?)(?=^\s*(?:\d+\s*일차|DAY\s*\d+|공지|비\s*고|안내사항|주의사항|쇼핑\s*센터|일\s*자|PKG))/m)?.[1] ?? '';
  const sectionTours = section
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean)
    .flatMap(line => splitTopLevelCommaList(line))
    .map(toOptionalTour)
    .filter((tour): tour is { name: string; region: string; priceLabel: string; note: null } => Boolean(tour));

  return sectionTours.length > 0 ? sectionTours : extractFreeformOptionalTours(rawText);
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
  const primary = cleaned.split(/[\/|·,，]/)[0].trim();
  if (primary === '서안') return primary;
  if (!cleaned || cleaned.length < 2) return null;
  return cleaned;
}

function extractTitle(rawText: string): string | null {
  const title = rawText.match(/(?:상품명|상품명칭|행사명)\s*[:：]\s*([^\n]+)/)?.[1]?.trim();
  if (title) return title;
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const pkgIndex = lines.findIndex(line => /^PKG$/i.test(line));
  const pkgTitle = pkgIndex >= 0
    ? lines.slice(pkgIndex + 1).find(line => (
        line.length >= 8
        && !/^\d{2,4}[./-]\d{1,2}/.test(line)
        && !/^(출\s*발\s*일|판\s*매\s*가|포함사항|불포함사항|비고|주의사항)$/i.test(line)
      ))
    : null;
  if (pkgTitle) return pkgTitle;

  const first = lines.find(line => (
    line.length >= 4
    && !/^\d{2,4}[./-]\d{1,2}/.test(line)
    && !/^(PKG|현금영수증|취소규정|일본골프상품)/.test(line)
  ));
  return first ?? null;
}

function extractTripStyle(rawText: string): string | null {
  const match = rawText.match(/(\d+)\s*박\s*(\d+)\s*일/);
  return match ? `${match[1]}박${match[2]}일` : null;
}

function extractDurationDays(rawText: string): number | null {
  const match = rawText.match(/\d+\s*박\s*(\d+)\s*일/);
  const n = Number(match?.[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
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
  const match = rawText.match(/최소\s*출발\s*([0-9]+)\s*명|최소출발\s*([0-9]+)\s*명|최소\s*인원\s*([0-9]+)\s*명|([0-9]+)\s*명\s*이상/);
  const n = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4]);
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

export function extractSupplierRawDeterministicFacts(rawText: string): SupplierRawDeterministicFacts {
  const flights = extractFlights(rawText);
  return {
    title: extractTitle(rawText),
    region: extractRegion(rawText),
    tripStyle: extractTripStyle(rawText),
    durationDays: extractDurationDays(rawText),
    departureAirport: extractDepartureAirport(rawText),
    minParticipants: extractMinParticipants(rawText),
    airline: flights.airline ?? null,
    outbound: extractFlightSegment(rawText, ['출발편', '가는편', '출국편', '왕복항공\\s*출발']),
    inbound: extractFlightSegment(rawText, ['귀국편', '오는편', '복편', '왕복항공\\s*귀국']),
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

function parseRegions(line: string): string[] {
  return line
    .replace(/^\d+\s*일차\s*/, '')
    .split(/[\/,，>→-]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function compactKoreanToken(line: string): string {
  const trimmed = line.trim();
  if (/^[가-힣](?:\s+[가-힣])+$/.test(trimmed)) return trimmed.replace(/\s+/g, '');
  return trimmed.replace(/\s+/g, ' ');
}

function isCatalogTable(rawText: string): boolean {
  return /일\s*자[\s\S]{0,250}주\s*요\s*행\s*사\s*일\s*정[\s\S]{0,250}제\s*1\s*일/.test(rawText);
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
  if (/김해|부산/.test(activity)) return '김해';
  if (/나리타|나라타/.test(activity)) return '나리타';
  if (/서안/.test(activity)) return '서안';
  return null;
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
  const offsets = appendixPatterns
    .map(pattern => haystack.search(pattern))
    .filter(offset => offset >= 0);
  return offsets.length > 0 ? start + Math.min(...offsets) : end;
}

function buildCatalogTableItinerary(rawText: string): (TravelItinerary & { flight_segments?: ReturnType<typeof makeFlightSegmentsFromCatalog> }) | null {
  if (!isCatalogTable(rawText)) return null;

  const facts = extractSupplierRawDeterministicFacts(rawText);
  const rawFlightCodes = [...rawText.matchAll(/\b([A-Z]{2}\d{2,4})\b/g)].map(match => match[1]);
  const flightOut = facts.outbound?.code ?? rawFlightCodes[0] ?? null;
  const flightIn = facts.inbound?.code ?? (rawFlightCodes.length > 1 ? rawFlightCodes[rawFlightCodes.length - 1] : null);
  const dayMatches = [...rawText.matchAll(/^제\s*(\d+)\s*일\s*$/gm)];
  if (dayMatches.length === 0) return null;

  const nextPkgMatch = /\nPKG\s*\n/g;
  const days: DaySchedule[] = dayMatches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const nextDay = dayMatches[index + 1]?.index;
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
      const isFlightActivity = /국제공항\s*(출발|도착)/.test(normalizedActivity);
      schedule.push({
        time: isFlightActivity ? times[flightTimeIndex++] ?? null : null,
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

export function buildSupplierRawDeterministicItinerary(rawText: string): TravelItinerary | null {
  const catalogTableItinerary = buildCatalogTableItinerary(rawText);
  if (catalogTableItinerary) return catalogTableItinerary;

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
    const breakfast = parseMealToken(mealLine.match(/조\s*[:：]\s*([^ ]+)/)?.[1]);
    const lunch = parseMealToken(mealLine.match(/중\s*[:：]\s*([^ ]+)/)?.[1]);
    const dinner = parseMealToken(mealLine.match(/석\s*[:：]\s*([^ ]+)/)?.[1]);
    const schedule: ScheduleItem[] = [];

    for (const line of body.split(/\r?\n/).map(v => v.trim()).filter(Boolean)) {
      if (/^(호텔|숙박|식사)\s*[:：]?/.test(line)) continue;
      const time = line.match(/^(\d{1,2}:\d{2})\s*(.+)$/);
      const activity = (time?.[2] ?? line).trim();
      const explicitFlight = activity.match(/\b([A-Z0-9]{2}\d{2,4})\b/)?.[1] ?? null;
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

  return {
    meta: {
      title: facts.title ?? '랜드사 원문 상품',
      product_type: 'package',
      destination: facts.region ?? '미정',
      nights: Math.max(0, (facts.durationDays ?? days.length) - 2),
      days: facts.durationDays ?? days.length,
      departure_airport: facts.departureAirport,
      airline: facts.airline,
      flight_out: facts.outbound?.code ?? null,
      flight_in: facts.inbound?.code ?? null,
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
  };
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
