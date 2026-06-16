import type { ExtractedData, NoticeItem, OptionalTour, ParsedDocument, PriceTier, Surcharge } from '@/lib/parser';
import type { DaySchedule, MealInfo, ScheduleItem, TravelItinerary } from '@/types/itinerary';

type SectionMap = Record<string, string[]>;

interface BasicInfo {
  title?: string;
  destination?: string;
  country?: string;
  productType?: string;
  tripStyle?: string;
  departureAirport?: string;
  airline?: string;
  flightOut?: string;
  flightIn?: string;
  departureDays?: string;
  minParticipants?: string;
  ticketingDeadline?: string;
  landOperator?: string;
  commissionRate?: string;
}

interface ParsedFlight {
  code: string | null;
  depTime: string | null;
  depAirport: string | null;
  arrTime: string | null;
  arrAirport: string | null;
}

const STANDARD_MARKERS = [
  'YSN-PRODUCT-MD',
  '## 기본정보',
  '## 가격',
  '## 일정',
];

const KEY_ALIASES: Record<string, keyof BasicInfo> = {
  상품명: 'title',
  제목: 'title',
  목적지: 'destination',
  지역: 'destination',
  국가: 'country',
  상품타입: 'productType',
  상품유형: 'productType',
  상품구분: 'productType',
  타입: 'productType',
  여행스타일: 'tripStyle',
  일정: 'tripStyle',
  기간: 'tripStyle',
  출발공항: 'departureAirport',
  항공: 'airline',
  항공사: 'airline',
  출발편: 'flightOut',
  가는편: 'flightOut',
  귀국편: 'flightIn',
  오는편: 'flightIn',
  리턴편: 'flightIn',
  출발요일: 'departureDays',
  출발일: 'departureDays',
  최소출발: 'minParticipants',
  최소인원: 'minParticipants',
  발권마감: 'ticketingDeadline',
  발권기한: 'ticketingDeadline',
  랜드사: 'landOperator',
  커미션: 'commissionRate',
};

const SECTION_ALIASES: Record<string, string[]> = {
  basic: ['기본정보', '기본 정보', '상품정보', '상품 정보'],
  price: ['가격', '요금', '요금표', '판매가'],
  inclusions: ['포함', '포함사항', '포함 사항'],
  excludes: ['불포함', '불포함사항', '불포함 사항'],
  surcharges: ['추가요금', '추가 요금', '현지지불', '현지지불비용'],
  optionalTours: ['선택관광', '옵션', '현지지불옵션', '강력추천옵션'],
  itinerary: ['일정', '일정표', '여행일정', '여행 일정'],
  notices: ['공지', '안내', '비고', '유의사항', '주의사항'],
  cancellation: ['취소규정', '취소 규정', '약관'],
};

export function isStandardProductMarkdown(rawText: string): boolean {
  const text = rawText.trim();
  if (!text) return false;
  const hitCount = STANDARD_MARKERS.filter(marker => text.includes(marker)).length;
  return text.includes('YSN-PRODUCT-MD') || hitCount >= 2;
}

function normalizeLine(line: string): string {
  return line.replace(/^\s*[-*]\s*/, '').trim();
}

function splitSections(rawText: string): SectionMap {
  const sections: SectionMap = {};
  let current = 'root';
  for (const line of rawText.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].trim();
      sections[current] = sections[current] ?? [];
      continue;
    }
    sections[current] = sections[current] ?? [];
    sections[current].push(line);
  }
  return sections;
}

function sectionLines(sections: SectionMap, key: keyof typeof SECTION_ALIASES): string[] {
  const aliases = SECTION_ALIASES[key];
  const found = Object.entries(sections).find(([section]) => {
    const normalized = section.replace(/\s+/g, '');
    return aliases.some(alias => normalized.startsWith(alias.replace(/\s+/g, '')));
  });
  return found?.[1] ?? [];
}

function parseKeyValueLines(lines: string[]): BasicInfo {
  const out: BasicInfo = {};
  for (const raw of lines) {
    const line = normalizeLine(raw);
    const match = line.match(/^([^:：|]+)\s*[:：]\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim().replace(/\s+/g, '');
    const alias = KEY_ALIASES[key];
    if (!alias) continue;
    out[alias] = match[2].trim();
  }
  return out;
}

function parseMoney(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  return Number(digits);
}

function parseNumber(value: string | undefined, fallback = 0): number {
  const m = value?.match(/\d+/);
  return m ? Number(m[0]) : fallback;
}

function parseIsoDate(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const match = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (!match) return undefined;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function parseTripDays(style: string | undefined): { nights: number; days: number } {
  const text = style ?? '';
  const nightMatch = text.match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (nightMatch) return { nights: Number(nightMatch[1]), days: Number(nightMatch[2]) };
  const dayMatch = text.match(/(\d+)\s*일/);
  if (dayMatch) return { nights: Math.max(0, Number(dayMatch[1]) - 1), days: Number(dayMatch[1]) };
  return { nights: 0, days: 1 };
}

function parseFlight(raw: string | undefined): ParsedFlight {
  const text = raw?.trim() ?? '';
  const code = text.match(/\b([A-Z0-9]{2}\d{2,4})\b/)?.[1] ?? null;
  const times = [...text.matchAll(/(\d{1,2}:\d{2})/g)].map(m => m[1]);
  const airportText = text.replace(code ?? '', '').replace(/\d{1,2}:\d{2}/g, '');
  const airports = airportText
    .split(/\s*(?:->|→|⇒|~| - )\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  return {
    code,
    depTime: times[0] ?? null,
    arrTime: times[1] ?? null,
    depAirport: airports[0] ?? null,
    arrAirport: airports[1] ?? null,
  };
}

function parseBullets(lines: string[]): string[] {
  return lines.map(normalizeLine).filter(line => line && !line.startsWith('#'));
}

function parsePriceRows(lines: string[]): PriceTier[] {
  const rows = lines
    .map(line => line.trim())
    .filter(line => line.startsWith('|') && line.endsWith('|'))
    .filter(line => !/^\|\s*-+/.test(line));
  if (rows.length <= 1) return [];
  return rows.slice(1).map((row): PriceTier | null => {
    const cells = row.split('|').slice(1, -1).map(c => c.trim());
    const [label, datesRaw, adultRaw, childRaw, statusRaw, noteRaw] = cells;
    const adult = parseMoney(adultRaw);
    if (!adult) return null;
    const dates = datesRaw && !/전체|전\s*출발|매주|요일/.test(datesRaw)
      ? datesRaw.split(/[,/]/).map(d => d.trim()).filter(Boolean)
      : undefined;
    const status: PriceTier['status'] = /확정/.test(statusRaw ?? '')
      ? 'confirmed'
      : /마감|대기|불가|예약불가/.test(statusRaw ?? '')
        ? 'soldout'
        : 'available';
    return {
      period_label: label || datesRaw || '기본',
      departure_dates: dates,
      adult_price: adult,
      child_price: parseMoney(childRaw),
      status,
      note: noteRaw || undefined,
    };
  }).filter((row): row is PriceTier => row !== null);
}

function parseOptionalTours(lines: string[]): OptionalTour[] {
  return parseBullets(lines).map(line => {
    const parts = line.split('|').map(p => p.trim());
    const [name, price, note] = parts.length > 1 ? parts : [line, '', ''];
    return {
      name,
      price: price || undefined,
      price_usd: price?.includes('$') || /USD/i.test(price ?? '') ? parseMoney(price) : undefined,
      price_krw: /원|KRW/i.test(price ?? '') ? parseMoney(price) : undefined,
      note: note || null,
    };
  }).filter(t => t.name);
}

function parseSurcharges(lines: string[]): Surcharge[] {
  return parseBullets(lines).map(line => ({
    period: line,
    amount_usd: line.includes('$') || /USD/i.test(line) ? parseMoney(line) : undefined,
    amount_krw: /원|KRW/i.test(line) ? parseMoney(line) : undefined,
    note: line,
  }));
}

function normalizeNoticeType(value: string): NoticeItem['type'] | null {
  const key = value.trim().toUpperCase();
  if (key === 'CRITICAL' || key === '필수' || key === '중요') return 'CRITICAL';
  if (key === 'PAYMENT' || key === '결제' || key === '요금') return 'PAYMENT';
  if (key === 'POLICY' || key === '규정' || key === '약관') return 'POLICY';
  if (key === 'INFO' || key === '안내' || key === '참고') return 'INFO';
  return null;
}

function parseNotices(lines: string[], basic: BasicInfo): NoticeItem[] {
  const notices: NoticeItem[] = [];
  for (const line of parseBullets(lines)) {
    const parts = line.split('|').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const type = normalizeNoticeType(parts[0]);
      if (type) {
        notices.push({ type, title: parts[1], text: parts.slice(2).join(' | ') });
        continue;
      }
    }
    notices.push({ type: 'INFO', title: '상품 안내', text: line });
  }

  if (basic.ticketingDeadline && !parseIsoDate(basic.ticketingDeadline) && !notices.some(n => n.type === 'PAYMENT')) {
    notices.push({
      type: 'PAYMENT',
      title: '발권 마감',
      text: `발권마감은 ${basic.ticketingDeadline} 기준입니다. 예약 확정 전 좌석과 요금 변동 여부를 확인해 주세요.`,
    });
  }

  return notices;
}

function parseMeals(raw: string | undefined): MealInfo {
  const text = raw ?? '';
  const read = (labels: string[]): [boolean, string | null] => {
    const pattern = new RegExp(`(?:${labels.join('|')})\\s*[:：]?\\s*([^/|]+)`);
    const value = pattern.exec(text)?.[1]?.trim() ?? '';
    if (!value || /x|불포함|없음/i.test(value)) return [false, value || null];
    return [true, value];
  };
  const [breakfast, breakfast_note] = read(['조식', '조']);
  const [lunch, lunch_note] = read(['중식', '중']);
  const [dinner, dinner_note] = read(['석식', '석']);
  return { breakfast, lunch, dinner, breakfast_note, lunch_note, dinner_note };
}

function extractAttractionIds(note: string | undefined): { ids: string[]; note: string | null } {
  const text = note?.trim();
  if (!text) return { ids: [], note: null };
  const pattern = /(?:attraction_ids?|관광지ID)\s*[:=]\s*([0-9a-zA-Z_,\-\s]+)/i;
  const match = text.match(pattern);
  if (!match) return { ids: [], note: text };
  const ids = match[1].split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
  const clean = text.replace(pattern, '').replace(/\s*\|\s*$/, '').trim();
  return { ids, note: clean || null };
}

function parseScheduleItem(line: string, defaultFlightCode: string | null): ScheduleItem | null {
  const clean = normalizeLine(line);
  if (!clean) return null;
  const parts = clean.split('|').map(p => p.trim());
  const [timeOrActivity, maybeActivity, maybeType, maybeNote] = parts;
  const hasTime = /^\d{1,2}:\d{2}$/.test(timeOrActivity ?? '');
  const time = hasTime ? timeOrActivity : null;
  const activity = hasTime ? maybeActivity : timeOrActivity;
  if (!activity) return null;
  const typeText = (hasTime ? maybeType : maybeActivity) ?? '';
  const combined = `${typeText} ${activity}`;
  const type: ScheduleItem['type'] = /flight|항공|출발|도착|공항|비행/.test(combined)
    ? 'flight'
    : /optional|선택|옵션/.test(combined)
      ? 'optional'
      : /shopping|쇼핑/.test(combined)
        ? 'shopping'
        : /meal|식사|조식|중식|석식/.test(combined)
          ? 'meal'
          : /hotel|호텔|숙박|체크인|체크아웃/.test(combined)
            ? 'hotel'
            : 'normal';
  const flightCode = activity.match(/\b([A-Z0-9]{2}\d{2,4})\b/)?.[1] ?? defaultFlightCode;
  const attraction = extractAttractionIds(maybeNote);
  return {
    time,
    activity,
    transport: type === 'flight' ? flightCode : null,
    note: attraction.note,
    attraction_ids: attraction.ids.length > 0 ? attraction.ids : undefined,
    type,
  };
}

function parseDays(lines: string[], basic: BasicInfo): DaySchedule[] {
  const days: DaySchedule[] = [];
  let current: DaySchedule | null = null;
  const outFlight = parseFlight(basic.flightOut);
  const inFlight = parseFlight(basic.flightIn);

  for (const line of lines) {
    const heading = line.match(/^###\s*DAY\s*(\d+)(?:\s*\|\s*(.*))?$/i);
    if (heading) {
      if (current) days.push(current);
      const dayNo = Number(heading[1]);
      const parts = (heading[2] ?? '').split('|').map(p => p.trim());
      const regions = (parts[0] ?? basic.destination ?? '').split(/[,/]/).map(p => p.trim()).filter(Boolean);
      const hotelRaw = parts[1] ?? '';
      const hotelMatch = hotelRaw.match(/^(.+?)(?:\(([^)]+)\))?$/);
      const hotelGrade = hotelMatch?.[2]?.trim() ?? null;
      current = {
        day: dayNo,
        regions,
        meals: parseMeals(parts[2]),
        schedule: [],
        hotel: hotelRaw
          ? { name: hotelMatch?.[1]?.trim() ?? hotelRaw, grade: hotelGrade && !/기내/.test(hotelGrade) ? hotelGrade : null, note: null }
          : null,
      };
      continue;
    }
    if (!current) continue;
    const defaultFlight = current.day === 1 ? outFlight.code : current.day === parseTripDays(basic.tripStyle).days ? inFlight.code : null;
    const item = parseScheduleItem(line, defaultFlight);
    if (item) current.schedule.push(item);
  }
  if (current) days.push(current);
  return days;
}

function buildItinerary(basic: BasicInfo, sections: SectionMap): TravelItinerary {
  const trip = parseTripDays(basic.tripStyle);
  const days = parseDays(sectionLines(sections, 'itinerary'), basic);
  return {
    meta: {
      title: basic.title ?? '상품명 미입력',
      product_type: basic.productType ?? null,
      destination: basic.destination ?? '',
      nights: trip.nights,
      days: trip.days || days.length || 1,
      departure_airport: basic.departureAirport ?? null,
      airline: basic.airline ?? null,
      flight_out: parseFlight(basic.flightOut).code,
      flight_in: parseFlight(basic.flightIn).code,
      departure_days: basic.departureDays ?? null,
      min_participants: parseNumber(basic.minParticipants, 1),
      room_type: null,
      ticketing_deadline: parseIsoDate(basic.ticketingDeadline) ?? null,
      hashtags: [],
      brand: '여소남' as never,
    },
    highlights: {
      inclusions: parseBullets(sectionLines(sections, 'inclusions')),
      excludes: parseBullets(sectionLines(sections, 'excludes')),
      shopping: null,
      remarks: parseBullets(sectionLines(sections, 'notices')),
    },
    days,
    optional_tours: parseOptionalTours(sectionLines(sections, 'optionalTours')).map(t => ({
      name: t.name,
      price_usd: t.price_usd ?? null,
      price_krw: t.price_krw ?? null,
      note: t.note ?? t.price ?? null,
    })),
  };
}

export function parseStandardProductMarkdown(rawText: string, filename = 'standard-product.md'): ParsedDocument {
  const sections = splitSections(rawText);
  const basic = parseKeyValueLines(sectionLines(sections, 'basic'));
  const trip = parseTripDays(basic.tripStyle);
  const itineraryData = buildItinerary(basic, sections);
  const priceTiers = parsePriceRows(sectionLines(sections, 'price'));
  const inclusions = parseBullets(sectionLines(sections, 'inclusions'));
  const excludes = parseBullets(sectionLines(sections, 'excludes'));
  const optionalTours = parseOptionalTours(sectionLines(sections, 'optionalTours'));
  const notices = parseNotices(sectionLines(sections, 'notices'), basic);
  const accommodations = itineraryData.days
    .map(day => day.hotel)
    .filter((hotel): hotel is NonNullable<typeof hotel> => Boolean(hotel?.name))
    .map(hotel => hotel.grade ? `${hotel.name} (${hotel.grade})` : hotel.name);
  const price = priceTiers.map(t => t.adult_price ?? Infinity).reduce((min, current) => Math.min(min, current), Infinity);
  const extractedData: ExtractedData = {
    title: basic.title,
    category: 'package',
    product_type: basic.productType,
    trip_style: basic.tripStyle,
    destination: basic.destination,
    duration: trip.days || itineraryData.days.length || undefined,
    nights: trip.nights,
    departure_days: basic.departureDays,
    departure_airport: basic.departureAirport,
    airline: basic.airline,
    min_participants: parseNumber(basic.minParticipants, 1),
    ticketing_deadline: parseIsoDate(basic.ticketingDeadline),
    price: Number.isFinite(price) ? price : undefined,
    price_tiers: priceTiers,
    inclusions,
    excludes,
    optional_tours: optionalTours,
    surcharges: parseSurcharges(sectionLines(sections, 'surcharges')),
    itinerary: itineraryData.days.flatMap(day => day.schedule.map(item => item.activity)),
    accommodations: [...new Set(accommodations)],
    notices_parsed: notices,
    cancellation_policy: parseBullets(sectionLines(sections, 'cancellation')).map(line => ({ period: line, rate: 0, note: line })),
    land_operator: basic.landOperator,
    product_tags: [],
    product_highlights: [],
    product_summary: undefined,
    flight_info: {
      airline: basic.airline ?? null,
      flight_no: parseFlight(basic.flightOut).code,
      depart: parseFlight(basic.flightOut).depTime,
      arrive: parseFlight(basic.flightOut).arrTime,
      return_depart: parseFlight(basic.flightIn).depTime,
      return_arrive: parseFlight(basic.flightIn).arrTime,
    },
    rawText,
    _llm_meta: {
      provider: 'standard-markdown',
      cache_hit: true,
      tokens_input: 0,
      tokens_output: 0,
      cost_usd: 0,
    },
  };

  return {
    filename,
    fileType: 'hwp',
    rawText,
    extractedData,
    itineraryData,
    parsedAt: new Date(),
    confidence: 0.98,
  };
}

export const STANDARD_PRODUCT_MARKDOWN_TEMPLATE = `YSN-PRODUCT-MD v1

# 상품명
## 기본정보
- 상품명:
- 목적지:
- 국가:
- 상품타입: 패키지
- 여행스타일: 3박5일
- 출발공항:
- 항공:
- 출발편: BX781 19:20 부산/김해 -> 22:20 나트랑
- 귀국편: BX782 23:20 나트랑 -> 06:20 부산/김해
- 출발요일:
- 최소출발:
- 발권마감:
- 랜드사:
- 커미션:

## 가격
| 라벨 | 날짜 | 성인 | 아동 | 상태 | 비고 |
| --- | --- | --- | --- | --- | --- |
| 기본 | 2026-07-16, 2026-07-23 | 1,099,000원 | 1,099,000원 | 가능 | 실제 출발일을 YYYY-MM-DD로 입력 |

## 포함
- 왕복항공권
- 일정표상 숙박/식사/차량/관광

## 불포함
- 개인경비

## 추가요금
-

## 선택관광
- 관광명 | $30/인 | 비고

## 일정
### DAY 1 | 부산, 나트랑 | 기내박 | 조식 X / 중식 X / 석식 X
- 19:20 | BX781 부산/김해 출발 | flight
- 22:20 | 나트랑 도착 | flight

### DAY 2 | 나트랑 | 호텔명(5성) | 조식 호텔식 / 중식 현지식 / 석식 현지식
- 09:00 | 관광지명 관광 | normal | 관광지ID: 기존 attractions.id 입력 시 고객 랜딩 카드 연결

## 공지
- CRITICAL | 여권/비자 | 여권 만료일은 출발일 기준 6개월 이상 남아 있어야 하며, 비자 필요 여부는 예약 전 확인해 주세요.
- PAYMENT | 발권/결제 | 발권마감 이후에는 항공 좌석과 요금이 변동될 수 있어 예약 확정 전 최종 안내가 필요합니다.
- POLICY | 취소/변경 | 취소료는 여행 약관과 항공사 규정에 따라 적용되며, 발권 항공권은 별도 조건이 우선될 수 있습니다.
- INFO | 현지 안내 | 현지 사정과 항공 스케줄에 따라 일정 순서가 변경될 수 있으며 동급 호텔로 대체될 수 있습니다.

## 취소규정
- `;
