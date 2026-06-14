import type { DaySchedule, ScheduleItem, TravelItinerary } from '@/types/itinerary';

type DayBlock = { day: number; body: string };
type HeaderFlightSegment = {
  leg: 'outbound' | 'inbound';
  flight_no: string;
  dep_airport: string;
  dep_time: string;
  arr_airport: string;
  arr_time: string;
  arr_day_offset: number;
  day_pair: [number, number];
};

const DAY_LINE_RE = /^\s*(?:DAY\s*)?(\d+)\s*(?:일|일차|day)?\s*$/i;
const FLIGHT_CODE_RE = /\b([A-Z]{2}\d{2,4})\b/;
const FLIGHT_CODE_GLOBAL_RE = /\b([A-Z]{2}\d{2,4})\b/g;
const TIME_ONLY_RE = /^\d{1,2}:\d{2}(?:\(\+\d+\)|\+\d+)?$/;
const STRUCTURAL_LINE_RE = /^(?:지역|교통편|교통|시간|일정|식사|비고|상품가|포함\s*내역|불포함|호텔|HOTEL)$/i;
const STOP_LINE_RE = /^(?:포함\s*(?:내역|사항)|불포함|취소|예약|안내|주의\s*사항|특약|약관|상품가)$/;
const REGION_HINT_RE = /^(?:부산|김해|인천|후쿠오카|큐슈|규슈|벳부|벳푸|유후인|쿠로가와|아소|오사카|도쿄|삿포로|나고야|나라|교토)$/;

function splitByKoreanDayLines(rawText: string): DayBlock[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const headers: Array<{ day: number; index: number }> = [];

  lines.forEach((line, index) => {
    const match = line.trim().match(DAY_LINE_RE);
    if (!match) return;
    const day = Number(match[1]);
    if (day >= 1 && day <= 30) headers.push({ day, index });
  });

  if (headers.length === 0) return [];

  return headers.map((header, index) => {
    const next = headers[index + 1]?.index ?? lines.length;
    return {
      day: header.day,
      body: lines.slice(header.index + 1, next).join('\n'),
    };
  });
}

function cleanActivity(line: string): string {
  return line
    .replace(/^[▶◆◇●○■□*ㆍ·\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMealLine(line: string): { key: 'breakfast' | 'lunch' | 'dinner'; note: string | null } | null {
  const match = line.match(/^(조|중|석)\s*[:：]\s*(.+)$/);
  if (!match) return null;
  const key = match[1] === '조' ? 'breakfast' : match[1] === '중' ? 'lunch' : 'dinner';
  const note = match[2].trim();
  return { key, note: note && !/^(없음|불포함|-)$/.test(note) ? note : null };
}

function parseHotelLine(line: string): { name: string; grade: string | null; note: string | null } | null {
  const match = line.match(/^(?:HOTEL|호텔)\s*[:：]\s*(.+)$/i);
  if (!match?.[1]) return null;
  const name = match[1].replace(/\s+/g, ' ').trim();
  return name ? { name, grade: null, note: null } : null;
}

function scheduleType(activity: string): ScheduleItem['type'] {
  if (/공항/.test(activity) && /(출발|도착)/.test(activity)) return 'flight';
  if (/(면세|쇼핑|쇼핑센터|라라포트|lala\s*port)/i.test(activity)) return 'shopping';
  if (/(선택관광|옵션|별도\s*요금)/.test(activity)) return 'optional';
  if (/호텔/.test(activity) && /(체크|휴식|투숙|이동|온천욕|석식)/.test(activity)) return 'hotel';
  return 'normal';
}

function shouldSkipLine(line: string): boolean {
  if (!line) return true;
  if (STRUCTURAL_LINE_RE.test(line)) return true;
  if (STOP_LINE_RE.test(line)) return true;
  if (TIME_ONLY_RE.test(line)) return true;
  if (FLIGHT_CODE_RE.test(line) && line.replace(/\s+/g, '') === line.match(FLIGHT_CODE_RE)?.[1]) return true;
  if (/^전용\s*차량$/.test(line)) return true;
  if (parseMealLine(line)) return true;
  if (parseHotelLine(line)) return true;
  if (REGION_HINT_RE.test(line)) return true;
  return false;
}

function collectRegions(blockBody: string, schedule: ScheduleItem[]): string[] {
  const regions = new Set<string>();
  for (const line of blockBody.split(/\r?\n/).map(line => cleanActivity(line))) {
    if (REGION_HINT_RE.test(line)) regions.add(line);
    const move = line.match(/^(.+?)\s*이동$/);
    if (move?.[1] && move[1].length <= 12) regions.add(move[1].trim());
  }
  for (const item of schedule) {
    const move = item.activity.match(/^(.+?)\s*이동$/);
    if (move?.[1] && move[1].length <= 12) regions.add(move[1].trim());
  }
  return [...regions];
}

function parseDayBlock(block: DayBlock, fallbackFlightCode: string | null): DaySchedule {
  const rawLines = block.body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const meals: DaySchedule['meals'] = {
    breakfast: false,
    lunch: false,
    dinner: false,
    breakfast_note: null,
    lunch_note: null,
    dinner_note: null,
  };
  let hotel: DaySchedule['hotel'] = null;
  const schedule: ScheduleItem[] = [];
  const times = rawLines.filter(line => TIME_ONLY_RE.test(line));
  let flightTimeIndex = 0;

  for (const rawLine of rawLines) {
    const line = cleanActivity(rawLine);
    const meal = parseMealLine(line);
    if (meal) {
      meals[meal.key] = meal.note != null;
      meals[`${meal.key}_note` as 'breakfast_note' | 'lunch_note' | 'dinner_note'] = meal.note;
      continue;
    }

    const parsedHotel = parseHotelLine(line);
    if (parsedHotel) {
      hotel = parsedHotel;
      continue;
    }

    if (shouldSkipLine(line)) continue;

    const type = scheduleType(line);
    const flightCode = line.match(FLIGHT_CODE_RE)?.[1] ?? (type === 'flight' ? fallbackFlightCode : null);
    schedule.push({
      time: type === 'flight' ? times[flightTimeIndex++] ?? null : null,
      activity: line,
      transport: flightCode,
      note: null,
      type,
    });
  }

  return {
    day: block.day,
    regions: collectRegions(block.body, schedule),
    meals,
    schedule,
    hotel,
  };
}

function inferTitle(rawText: string): string {
  return rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length >= 4 && !STRUCTURAL_LINE_RE.test(line)) ?? '공급사 원문 상품';
}

function parseHeaderFlightSegments(rawText: string, dayCount: number): HeaderFlightSegment[] {
  const rows = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .map((line) => {
      const match = line.match(/^([가-힣A-Za-z/()\s]+?)\s*[-–—→]\s*([가-힣A-Za-z/()\s]+?)\s+([A-Z]{2}\d{2,4})\s+(\d{1,2}:\d{2})\s*\/\s*(\d{1,2}:\d{2})(?:\+(\d+))?$/);
      if (!match) return null;
      return {
        flight_no: match[3],
        dep_airport: match[1].trim(),
        dep_time: match[4],
        arr_airport: match[2].trim(),
        arr_time: match[5],
        arr_day_offset: Number(match[6] ?? 0) || 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (rows.length === 0) return [];

  const outbound = rows[0];
  const inbound = rows.length > 1 ? rows[rows.length - 1] : null;
  const segments: HeaderFlightSegment[] = [{
    leg: 'outbound',
    ...outbound,
    day_pair: [0, Math.min(dayCount - 1, outbound.arr_day_offset)] as [number, number],
  }];
  if (inbound) {
    const lastDayIndex = Math.max(0, dayCount - 1);
    segments.push({
      leg: 'inbound',
      ...inbound,
      day_pair: [lastDayIndex, lastDayIndex],
    });
  }
  return segments;
}

export function buildKoreanDayLineTableItinerary(rawText: string): (TravelItinerary & { flight_segments?: HeaderFlightSegment[] }) | null {
  const blocks = splitByKoreanDayLines(rawText);
  if (blocks.length < 2) return null;

  const flightCodes = [...rawText.matchAll(FLIGHT_CODE_GLOBAL_RE)].map(match => match[1]);
  const flightOut = flightCodes[0] ?? null;
  const flightIn = flightCodes.length > 1 ? flightCodes[flightCodes.length - 1] : flightOut;
  const days = blocks.map((block, index) => parseDayBlock(
    block,
    index === 0 ? flightOut : index === blocks.length - 1 ? flightIn : null,
  ));
  if (days.every(day => day.schedule.length === 0)) return null;
  const flightSegments = parseHeaderFlightSegments(rawText, days.length);

  const destination = /후쿠오카|큐슈|규슈|벳부|벳푸|유후인|쿠로가와/.test(rawText)
    ? '후쿠오카/큐슈'
    : days.flatMap(day => day.regions).find(Boolean) ?? '미정';

  return {
    meta: {
      title: inferTitle(rawText),
      product_type: 'package',
      destination,
      nights: Math.max(0, days.length - 1),
      days: days.length,
      departure_airport: /부산|김해/.test(rawText) ? '부산' : null,
      airline: flightOut?.slice(0, 2) ?? null,
      flight_out: flightOut,
      flight_in: flightIn,
      departure_days: null,
      min_participants: 1,
      room_type: null,
      ticketing_deadline: null,
      hashtags: [],
      brand: '여소남' as TravelItinerary['meta']['brand'],
    },
    highlights: {
      inclusions: [],
      excludes: [],
      shopping: null,
      remarks: [],
    },
    days,
    optional_tours: [],
    ...(flightSegments.length > 0 ? { flight_segments: flightSegments } : {}),
  };
}
