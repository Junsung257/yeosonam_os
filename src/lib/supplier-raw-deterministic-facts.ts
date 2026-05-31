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

function extractDepartureDates(rawText: string): string[] {
  const line = rawText.match(/(?:출발일|출발일자|출발날짜|출발일정)\s*[:：]?\s*([^\n]+)/)?.[1] ?? '';
  const source = /(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/.test(line) ? line : rawText;
  return [...source.matchAll(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/g)]
    .map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
}

function extractPrices(rawText: string): { adult: number | null; child: number | null } {
  const tableRow = rawText.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s*[|／/]\s*([0-9,]+)\s*원?\s*[|／/]\s*([0-9,]+)\s*원?/);
  const adult = parseMoney(rawText.match(/(?:성인|대인)\s*([0-9,]+)\s*원/)?.[1] ?? tableRow?.[1]);
  const child = parseMoney(rawText.match(/(?:아동|소아|어린이)\s*([0-9,]+)\s*원/)?.[1] ?? tableRow?.[2]);
  return { adult, child };
}

function extractOptionalTours(rawText: string) {
  const section = rawText.match(/선택관광\s*\n([\s\S]*?)(?=^\s*(?:\d+\s*일차|DAY\s*\d+|공지|비고|안내사항|주의사항))/m)?.[1] ?? '';
  return section
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean)
    .map(line => {
      const price = line.match(/\$?\s*(\d{1,3})\s*(?:\/\s*인|불|USD|\$)?/i)?.[1] ?? null;
      const name = line
        .replace(/\$?\s*\d{1,3}\s*(?:\/\s*인|불|USD|\$)?/ig, '')
        .trim();
      if (!name) return null;
      return {
        name,
        region: '',
        priceLabel: price ? `$${Number(price)}/인` : '',
        note: null,
      };
    })
    .filter((tour): tour is { name: string; region: string; priceLabel: string; note: null } => Boolean(tour));
}

function extractRegion(rawText: string): string | null {
  const title = rawText.match(/(?:상품명|상품명칭|행사명)\s*[:：]\s*([^\n]+)/)?.[1]
    ?? rawText.split(/\r?\n/).find(line => /상품\s*안내|상품명/.test(line))
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
  if (!cleaned || cleaned.length < 2) return null;
  return cleaned;
}

function extractTitle(rawText: string): string | null {
  const title = rawText.match(/(?:상품명|상품명칭|행사명)\s*[:：]\s*([^\n]+)/)?.[1]?.trim();
  if (title) return title;
  const first = rawText.split(/\r?\n/).find(line => line.trim().length >= 4)?.trim();
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
  const outbound = rawText.match(/(?:출발편|가는편|출국편|왕복항공\s*출발)\s*[:：]?\s*([A-Z0-9]{2}\d{2,4})/)?.[1];
  const inbound = rawText.match(/(?:귀국편|오는편|복편|왕복항공\s*귀국)\s*[:：]?\s*([A-Z0-9]{2}\d{2,4})/)?.[1];
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

function extractCommaListSection(rawText: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rawText.match(new RegExp(`${escaped}\\s*\\n([^\\n]+)`));
  const line = match?.[1] ?? '';
  return line.split(/\s*,\s*/).map(v => v.trim()).filter(Boolean);
}

function extractInfoNotices(rawText: string) {
  const section = rawText.match(/(?:공지|비고|안내사항|주의사항)\s*\n([\s\S]+)$/)?.[1] ?? '';
  return section
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean)
    .map((text, index) => ({
      type: /취소|환불|약관|규정/.test(text)
        ? 'POLICY' as const
        : /여권|비자|필수|만료/.test(text)
          ? 'CRITICAL' as const
          : 'INFO' as const,
      title: /취소|환불|약관|규정/.test(text)
        ? '취소/환불 규정'
        : index === 0 ? '안내' : '현지 안내',
      text,
    }));
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

export function buildSupplierRawDeterministicItinerary(rawText: string): TravelItinerary | null {
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
