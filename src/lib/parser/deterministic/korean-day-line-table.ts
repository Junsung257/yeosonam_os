import type { DaySchedule, ScheduleItem, TravelItinerary } from '@/types/itinerary';

type DayBlock = { day: number; body: string };
type DayHeader = { day: number; index: number; tail: string };
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

const DAY_LINE_RE = /^\s*(?:제\s*)?(?:DAY\s*)?(\d+)\s*(?:일차|일|day)?\s*$/i;
const JE_DAY_LINE_RE = /^\s*제\s*(\d{1,2})\s*(?:일차|일)\s*$/;
const REVERSED_DAY_LINE_RE = /^\s*일\s*(\d{1,2})\s*$/;
const SPACED_JE_DAY_LINE_RE = /^\s*제\s*일\s*(\d{1,2})(?:\s*차)?\s*$/;
const JE_INLINE_DAY_LINE_RE = /^\s*제\s*(\d{1,2})\s*(?:일차|일)\s+(.+)$/;
const INLINE_DAY_LINE_RE = /^\s*(?:제\s*)?(?:DAY\s*)?(\d{1,2})\s*(?:일차|일|day)?\s+(.+)$/i;
const REVERSED_INLINE_DAY_LINE_RE = /^\s*일\s*(\d{1,2})\s+(.+)$/;
const SPACED_JE_INLINE_DAY_LINE_RE = /^\s*제\s*일\s*(\d{1,2})(?:\s*차)?\s*(.+)$/;
const EXPLICIT_DAY_PREFIX_RE = /^\s*제\s*(\d{1,2})\s*(?:일차|일)\s*(.*)$/;
const OCR_PUNCT_ONLY_DAY_LINE_RE = /^\s*(\d{1,2})\s*[*＊·•ㆍ-]+\s*(?:[,./\\\s]*)$/;
const FLIGHT_CODE_RE = /\b([A-Z]{2}\d{2,4})\b/;
const FLIGHT_CODE_GLOBAL_RE = /\b([A-Z]{2}\d{2,4})\b/g;
const TIME_ONLY_RE = /^\d{1,2}:\d{2}(?:\(\+\d+\)|\+\d+)?$/;
const STRUCTURAL_LINE_RE = /^(?:지역|교통편|교통|시간|일정|식사|비고|상품가|포함\s*내역|불포함|호텔|HOTEL)$/i;
const STOP_LINE_RE = /^(?:포함\s*(?:내역|사항)|불포함|취소|예약|안내|주의\s*사항|특약|약관|상품가)$/;
const REGION_HINT_RE = /^(?:부산|김해|인천|후쿠오카|큐슈|규슈|벳부|벳푸|유후인|쿠로가와|아소|오사카|도쿄|삿포로|나고야|나라|교토)$/;

function inferDurationBound(rawText: string): number | null {
  const values = [...rawText.matchAll(/(\d{1,2})\s*박\s*(\d{1,2})\s*일/g)]
    .map(match => Number(match[2]))
    .filter(value => Number.isFinite(value) && value > 0 && value <= 30);
  for (const match of rawText.matchAll(/(?:^|[^\d])(\d{1,2})\s*일\s*\/\s*(\d{1,2})\s*일/g)) {
    const left = Number(match[1]);
    const right = Number(match[2]);
    if (Number.isFinite(left) && left > 0 && left <= 30) values.push(left);
    if (Number.isFinite(right) && right > 0 && right <= 30) values.push(right);
  }
  return values.length > 0 ? Math.max(...values) : null;
}

function matchDayHeader(line: string): { day: number; tail: string } | null {
  const trimmed = line.trim();
  const koreanExact = trimmed.match(/^제\s*(\d{1,2})\s*일(?:차)?$/u)
    ?? trimmed.match(/^(\d{1,2})\s*일(?:차)?$/u);
  if (koreanExact) return { day: Number(koreanExact[1]), tail: '' };

  const koreanInline = trimmed.match(/^제\s*(\d{1,2})\s*일(?:차)?\s+(.+)$/u)
    ?? trimmed.match(/^(\d{1,2})\s*일(?:차)?\s+(.+)$/u);
  if (koreanInline) {
    const tail = koreanInline[2].trim();
    if (/\d{1,3}(?:,\d{3})+/.test(tail)) return null;
    return { day: Number(koreanInline[1]), tail };
  }

  const explicitPrefix = trimmed.match(EXPLICIT_DAY_PREFIX_RE);
  if (explicitPrefix) {
    const tail = (explicitPrefix[2] ?? '').trim();
    if (/\d{1,3}(?:,\d{3})+/.test(tail)) return null;
    return { day: Number(explicitPrefix[1]), tail };
  }
  const exact = trimmed.match(DAY_LINE_RE);
  if (exact) return { day: Number(exact[1]), tail: '' };
  const jeExact = trimmed.match(JE_DAY_LINE_RE);
  if (jeExact) return { day: Number(jeExact[1]), tail: '' };
  const reversedExact = trimmed.match(REVERSED_DAY_LINE_RE);
  if (reversedExact) return { day: Number(reversedExact[1]), tail: '' };
  const spacedJeExact = trimmed.match(SPACED_JE_DAY_LINE_RE);
  if (spacedJeExact) return { day: Number(spacedJeExact[1]), tail: '' };

  const inline = trimmed.match(JE_INLINE_DAY_LINE_RE)
    ?? trimmed.match(INLINE_DAY_LINE_RE)
    ?? trimmed.match(REVERSED_INLINE_DAY_LINE_RE)
    ?? trimmed.match(SPACED_JE_INLINE_DAY_LINE_RE);
  if (!inline) return null;
  const tail = inline[2].trim();
  if (/\d{1,3}(?:,\d{3})+/.test(tail)) return null;
  if (/^\s*(?:제\s*)?\d{1,2}\s*(?:일차|일)\b/u.test(trimmed) && /[\p{Script=Hangul}A-Za-z]/u.test(tail)) {
    return { day: Number(inline[1]), tail };
  }
  if (/^\s*제\s*일\s*\d{1,2}/u.test(trimmed) && /[\p{Script=Hangul}A-Za-z]/u.test(tail)) {
    return { day: Number(inline[1]), tail };
  }
  if (!/(?:\d{1,2}:\d{2}|[A-Z]{2}\d{2,4}|[:：]|공항|출발|도착|호텔|조\s*[:：]|중\s*[:：]|석\s*[:：]|▶)/.test(tail)) {
    return null;
  }
  return { day: Number(inline[1]), tail };
}

function matchBridgeableOcrDayHeader(line: string): { day: number; tail: string } | null {
  const match = line.trim().match(OCR_PUNCT_ONLY_DAY_LINE_RE);
  if (!match) return null;
  return { day: Number(match[1]), tail: '' };
}

function shouldKeepHeaderTail(tail: string): boolean {
  const compact = tail.replace(/\s+/g, '');
  if (!compact) return false;
  const hasScheduleVerb = /(?:출발|도착|관광|이동|미팅|체크|호텔|식사|탑승|체험|산책|공항|자유|휴식|\d{1,2}:\d{2})/.test(tail);
  const locationLabel = /^[\p{Script=Hangul}A-Za-z/ㆍ·\-\s]{2,50}$/u.test(tail)
    && (tail.includes('/') || !hasScheduleVerb);
  return !(locationLabel && !hasScheduleVerb);
}

function lineLooksLikeDayOneScheduleStart(line: string): boolean {
  const compact = line.replace(/\s+/g, '');
  return (FLIGHT_CODE_RE.test(line) && /(출발|도착|공항|국제)/.test(line))
    || /(김해|부산|인천|김포|청도|치토세|신치토세|국제공항|공항).*(미팅|집결|출발|도착|입국|수속)/.test(compact)
    || /(출발|도착).*(가이드|미팅|입국|수속)/.test(compact);
}

function prependSyntheticDayOneWhenSplitByPdf(lines: string[], headers: DayHeader[]): DayHeader[] {
  if (headers.length === 0 || headers[0].day !== 2) return headers;
  const firstHeaderIndex = headers[0].index;
  const searchStart = Math.max(0, firstHeaderIndex - 80);
  const candidateIndex = lines
    .slice(searchStart, firstHeaderIndex)
    .findIndex(line => lineLooksLikeDayOneScheduleStart(line.trim()));
  if (candidateIndex < 0) return headers;

  const index = searchStart + candidateIndex;
  const bodyPreview = lines.slice(index, firstHeaderIndex).join('\n');
  if (!/(출발|도착|공항|미팅|입국|수속|관광|호텔|중식|석식|조식)/.test(bodyPreview)) return headers;

  return [{ day: 1, index, tail: lines[index].trim() }, ...headers];
}

function splitByKoreanDayLines(rawText: string): DayBlock[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const headers: DayHeader[] = [];
  const durationBound = inferDurationBound(rawText);

  lines.forEach((line, index) => {
    const match = matchDayHeader(line);
    if (!match) return;
    const day = match.day;
    if (day >= 1 && day <= 30) headers.push({ day, index, tail: match.tail });
  });
  const explicitDays = new Set(headers.map(header => header.day));
  lines.forEach((line, index) => {
    if (headers.some(header => header.index === index)) return;
    const match = matchBridgeableOcrDayHeader(line);
    if (!match) return;
    const day = match.day;
    if (day < 1 || day > 30) return;
    if (durationBound && day > durationBound) return;
    if (!explicitDays.has(day - 1) || !explicitDays.has(day + 1)) return;
    headers.push({ day, index, tail: match.tail });
    explicitDays.add(day);
  });
  headers.sort((left, right) => left.index - right.index);
  const boundedHeaders = durationBound
    ? headers.filter(header => header.day <= durationBound)
    : headers;
  const effectiveHeaders = prependSyntheticDayOneWhenSplitByPdf(lines, boundedHeaders);

  if (effectiveHeaders.length === 0) return [];

  return effectiveHeaders.map((header, index) => {
    const next = effectiveHeaders[index + 1]?.index ?? lines.length;
    const bodyLines = [
      ...(shouldKeepHeaderTail(header.tail) ? [header.tail] : []),
      ...lines.slice(header.index + 1, next),
    ];
    return {
      day: header.day,
      body: bodyLines.join('\n'),
    };
  });
}

function cleanActivity(line: string): string {
  return line
    .replace(/^[▶◆◇●○■□*ㆍ·\-\s]+/, '')
    .replace(/^일\s+(?=▶|부\s*산|김해|인천|김포|청\s*도|공항|[A-Z]{2}\d{2,4})/u, '')
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

function parseMealSummaryLine(line: string): Partial<Record<'breakfast' | 'lunch' | 'dinner', string | null>> | null {
  if (!/^식사\s/.test(line)) return null;
  const result: Partial<Record<'breakfast' | 'lunch' | 'dinner', string | null>> = {};
  const slots = [
    ['조', 'breakfast'],
    ['중', 'lunch'],
    ['석', 'dinner'],
  ] as const;
  for (const [label, key] of slots) {
    const match = line.match(new RegExp(`${label}\\s*[:：]?\\s*([^\\s]+)`));
    if (!match?.[1]) continue;
    const note = match[1].trim();
    result[key] = /^(X|없음|불포함|-)$/.test(note) ? null : note;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function parseHotelLine(line: string): { name: string; grade: string | null; note: string | null } | null {
  const match = line.match(/^(?:HOTEL|호텔)\s*[:：]\s*(.+)$/i);
  if (!match?.[1]) return null;
  const name = match[1].replace(/\s+/g, ' ').trim();
  return name ? { name, grade: null, note: null } : null;
}

function scheduleType(activity: string): ScheduleItem['type'] {
  if (FLIGHT_CODE_RE.test(activity) && /(출발|도착|공항|국제|탑승)/.test(activity)) return 'flight';
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

function stripNonScheduleRows(schedule: ScheduleItem[]): ScheduleItem[] {
  const withoutMealRows = schedule.filter(item => !/^식사(?:\s|$)/.test(item.activity.trim()));
  const noticeIndex = withoutMealRows.findIndex(item =>
    /^(공지|안내|안내사항|주의사항|포함사항|불포함사항|취소|예약|약관|여권|현지\s*사정|취소료)(?:\s|$)/.test(item.activity.trim()),
  );
  return noticeIndex >= 0 ? withoutMealRows.slice(0, noticeIndex) : withoutMealRows;
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
    if (/^(공지|안내|안내사항|주의사항|포함사항|불포함사항|취소|예약|약관)(?:\s|$)/.test(rawLine.trim())) break;
    const line = cleanActivity(rawLine);
    const meal = parseMealLine(line);
    if (meal) {
      meals[meal.key] = meal.note != null;
      meals[`${meal.key}_note` as 'breakfast_note' | 'lunch_note' | 'dinner_note'] = meal.note;
      continue;
    }
    const mealSummary = parseMealSummaryLine(line);
    if (mealSummary) {
      for (const [key, note] of Object.entries(mealSummary) as Array<['breakfast' | 'lunch' | 'dinner', string | null]>) {
        meals[key] = note != null;
        meals[`${key}_note` as 'breakfast_note' | 'lunch_note' | 'dinner_note'] = note;
      }
      continue;
    }

    const parsedHotel = parseHotelLine(line);
    if (parsedHotel) {
      hotel = parsedHotel;
      continue;
    }

    if (shouldSkipLine(line)) continue;

    const fallbackFlightActivity = Boolean(fallbackFlightCode && /(출발|도착)/.test(line));
    const type = fallbackFlightActivity ? 'flight' : scheduleType(line);
    const flightCode = line.match(FLIGHT_CODE_RE)?.[1] ?? (type === 'flight' ? fallbackFlightCode : null);
    schedule.push({
      time: type === 'flight' ? times[flightTimeIndex++] ?? null : null,
      activity: line,
      transport: flightCode,
      note: null,
      type,
    });
  }

  const cleanedSchedule = stripNonScheduleRows(schedule);
  return {
    day: block.day,
    regions: collectRegions(block.body, cleanedSchedule),
    meals,
    schedule: cleanedSchedule,
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
