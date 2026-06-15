export type ItineraryScheduleQualityDay = {
  day?: number;
  dayNumber?: number;
  day_number?: number;
  hotel?: {
    name?: string | null;
  } | null;
  schedule?: Array<{
    activity?: string | null;
    type?: string | null;
    note?: string | null;
    transport?: string | null;
    time?: string | null;
  }> | null;
};

export type ItineraryScheduleQualityIssue = {
  code: string;
  day: number | null;
  activity: string;
  reason: string;
};

const STANDALONE_FLIGHT_CODE_RE = /^(?:[A-Z]{2}|\d[A-Z])\d{2,4}$/;
const STANDALONE_TIME_RE = /^\d{1,2}:\d{2}$/;
const STANDALONE_TRANSPORT_RE = /^(?:전용차량|전용 차량|도보|셔틀|셔틀버스|차량|버스|이동)$/;
const STANDALONE_REGION_RE = /^(?:부산|부\s*산|김해|나리타|나라타|치바|치\s*바|동경|도쿄|오사카|후쿠오카|유후인|도스|사세보|세부|다낭|나트랑|푸꾸옥)$/;
const HOTEL_LINE_RE = /^HOTEL\s*[:：]/i;
const URL_RE = /^https?:\/\//i;
const MEAL_LINE_RE = /^[조중석]\s*[:：]\s*\S+/;
const NOTICE_SECTION_RE = /^(?:비\s*고|주의사항|취소|환불|예약금|잔금|취소수수료|취소료|환불규정)\b/;

const KOREAN_STANDALONE_TRANSPORT_RE = /^(?:전용차량|전용\s*차량|송영차량|전용버스|버스|차량|이동)$/;
const KOREAN_STANDALONE_REGION_RE = /^(?:부산|김해|후쿠오카|유후인|도스|사세보|나리타|치바|동경|도쿄|서안|화산|푸꾸옥|다낭|하노이|나트랑|방콕)$/;
const PRICE_TABLE_HEADING_RE = /^(?:스팟\s*특가|spot|실시간\s*항공\s*기준|\*\s*실시간\s*항공\s*기준|\?ㅽ뙚\s*\?밴\?|\?ㅼ떆媛꾪빆怨듦린以)$/i;
const PRICE_DATE_TOKEN_RE = /^\d{1,2}\/\d{1,2}(?:\s*[,，]\s*\d{1,2})*(?:\s*~\s*\d{1,2}\/\d{1,2})?$/;
const PRICE_AMOUNT_TOKEN_RE = /^\d{1,3}(?:,\d{3})?,-$/;
const WEEKDAY_ONLY_RE = /^(?:[일월화수목금토](?:\s*[,/·~\-]\s*[일월화수목금토])*)$/;
const PRICE_TABLE_NOTICE_RE = /^(?:(?:호텔\s*)?예약시\s*날짜별\s*(?:써차지|서차지|surcharge|상품가)|호텔\s*예약시\s*날짜별|항공제외일|항공\s*제외일|현지지상비|현지\s*지상비|일본공휴일|일본\s*공휴일|항공그룹요금|항공\s*그룹\s*요금)/i;
const HOTEL_NAME_SCHEDULE_TEXT_RE = /(?:\uBBF8\uD305|\uACF5\uD56D|\uC774\uB3D9|\uCD9C\uBC1C|\uB3C4\uCC29|\uCCB4\uD06C\uC544\uC6C3|\uB77C\uC6B4\uB529)/;
const HOTEL_NAME_HINT_RE = /(?:[\uAC00-\uD7A3A-Za-z0-9]{2,}\uD638\uD154|\uB9AC\uC870\uD2B8|\uACE8\uD504\uD154|hotel|resort|\uB3D9\uAE09|\d\s*\uC131)/i;

function normalizeActivity(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function dayNumber(day: ItineraryScheduleQualityDay): number | null {
  const n = day.day ?? day.dayNumber ?? day.day_number;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function classifyPollutedActivity(activity: string): { code: string; reason: string } | null {
  const compact = activity.replace(/\s+/g, '');
  if (!activity) return null;
  if (STANDALONE_FLIGHT_CODE_RE.test(compact)) {
    return { code: 'ITINERARY_SCHEDULE_FLIGHT_CODE_ONLY', reason: 'flight code appears as a standalone schedule activity' };
  }
  if (STANDALONE_TIME_RE.test(compact)) {
    return { code: 'ITINERARY_SCHEDULE_TIME_ONLY', reason: 'time appears as a standalone schedule activity' };
  }
  if (
    STANDALONE_TRANSPORT_RE.test(activity)
    || STANDALONE_TRANSPORT_RE.test(compact)
    || KOREAN_STANDALONE_TRANSPORT_RE.test(activity)
    || KOREAN_STANDALONE_TRANSPORT_RE.test(compact)
  ) {
    return { code: 'ITINERARY_SCHEDULE_TRANSPORT_ONLY', reason: 'transport column value appears as a standalone schedule activity' };
  }
  if (
    STANDALONE_REGION_RE.test(activity)
    || STANDALONE_REGION_RE.test(compact)
    || KOREAN_STANDALONE_REGION_RE.test(activity)
    || KOREAN_STANDALONE_REGION_RE.test(compact)
  ) {
    return { code: 'ITINERARY_SCHEDULE_REGION_ONLY', reason: 'region column value appears as a standalone schedule activity' };
  }
  if (HOTEL_LINE_RE.test(activity)) {
    return { code: 'ITINERARY_SCHEDULE_HOTEL_LINE', reason: 'hotel column line must be stored in day.hotel, not schedule' };
  }
  if (URL_RE.test(activity)) {
    return { code: 'ITINERARY_SCHEDULE_URL_LINE', reason: 'URL must not be a standalone schedule activity' };
  }
  if (MEAL_LINE_RE.test(activity)) {
    return { code: 'ITINERARY_SCHEDULE_MEAL_LINE', reason: 'meal column line must be stored in day.meals, not schedule' };
  }
  if (NOTICE_SECTION_RE.test(activity)) {
    return { code: 'ITINERARY_SCHEDULE_NOTICE_LINE', reason: 'notice/policy text leaked into schedule activity' };
  }
  if (PRICE_TABLE_HEADING_RE.test(activity)) {
    return { code: 'ITINERARY_SCHEDULE_PRICE_TABLE_HEADING', reason: 'price table heading leaked into schedule activity' };
  }
  if (PRICE_DATE_TOKEN_RE.test(compact)) {
    return { code: 'ITINERARY_SCHEDULE_PRICE_DATE_TOKEN', reason: 'price table date/range leaked into schedule activity' };
  }
  if (PRICE_AMOUNT_TOKEN_RE.test(compact)) {
    return { code: 'ITINERARY_SCHEDULE_PRICE_AMOUNT_TOKEN', reason: 'price table amount leaked into schedule activity' };
  }
  if (WEEKDAY_ONLY_RE.test(compact)) {
    return { code: 'ITINERARY_SCHEDULE_WEEKDAY_ONLY', reason: 'price table weekday label leaked into schedule activity' };
  }
  if (PRICE_TABLE_NOTICE_RE.test(activity)) {
    return { code: 'ITINERARY_SCHEDULE_PRICE_NOTICE_LINE', reason: 'price table notice leaked into schedule activity' };
  }
  return null;
}

export function findItineraryScheduleQualityIssues(
  days: ItineraryScheduleQualityDay[] | null | undefined,
): ItineraryScheduleQualityIssue[] {
  if (!Array.isArray(days) || days.length === 0) return [];
  const issues: ItineraryScheduleQualityIssue[] = [];

  for (const day of days) {
    const number = dayNumber(day);
    const dayIssues: ItineraryScheduleQualityIssue[] = [];
    const hotelName = normalizeActivity(day.hotel?.name);
    if (hotelName && HOTEL_NAME_SCHEDULE_TEXT_RE.test(hotelName.replace(/\s+/g, '')) && !HOTEL_NAME_HINT_RE.test(hotelName)) {
      dayIssues.push({
        code: 'ITINERARY_HOTEL_FIELD_SCHEDULE_TEXT',
        day: number,
        activity: hotelName,
        reason: 'movement/schedule text must not be stored as day.hotel.name',
      });
    }
    for (const item of day.schedule ?? []) {
      const activity = normalizeActivity(item.activity);
      const pollution = classifyPollutedActivity(activity);
      if (!pollution) continue;
      dayIssues.push({
        ...pollution,
        day: number,
        activity,
      });
    }
    issues.push(...dayIssues);
  }

  return issues;
}
