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
    entity_kind?: string | null;
    note?: string | null;
    transport?: string | null;
    time?: string | null;
    attraction_ids?: unknown;
    attraction_names?: unknown;
    [key: string]: unknown;
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
const NON_ATTRACTION_ENTITY_KINDS = new Set([
  'flight',
  'transfer',
  'hotel',
  'hotel_stay',
  'meal',
  'shopping',
  'optional_tour',
  'perk',
  'free_time',
  'notice',
  'price_noise',
]);
const ATTRACTION_ENTITY_KINDS = new Set(['attraction', 'attraction_visit', 'visit']);
const MEAL_TEXT_RE = /(?:\uC870\uC2DD|\uC911\uC2DD|\uC11D\uC2DD|\uD638\uD154\uC2DD|\uD604\uC9C0\uC2DD|\uD2B9\uC2DD|\uAFD4\uBC14\uB85C\uC6B0|\uC0BC\uACB9\uC0B4|\uC0BC\uACB9\uC0B4\s*\uBB34\uC81C\uD55C|\uBB34\uC81C\uD55C\s*\uC0BC\uACB9\uC0B4|\uB9E4\uC6B4\uD0D5|\uC18C\uBD88\uACE0\uAE30|\uC591\uAF2C\uCE58|\uC1A1\uC774\uAD6C\uC774|\uC0E4\uBE0C\uC0E4\uBE0C|\uBE44\uBE54\uBC25)/;
const HOTEL_TEXT_RE = /(?:\uD638\uD154|\uB9AC\uC870\uD2B8|\uACE8\uD504\uD154|\uB3D9\uAE09|\uD22C\uC219|\uCCB4\uD06C\s*\uC778|\uCCB4\uD06C\uC778|\uD734\uC2DD|hotel|resort)/i;
const TRANSFER_TEXT_RE = /(?:\uC774\uB3D9|\uC18C\uC694|\uACF5\uD56D|\uCD9C\uBC1C|\uB3C4\uCC29|\uC804\uC6A9\uCC28\uB7C9|\uBC84\uC2A4|\uD56D\uACF5|\uD0D1\uC2B9)/;
const SHOPPING_TEXT_RE = /(?:\uC1FC\uD551\uC13C\uD130|\uC1FC\uD551|\uBA74\uC138\uC810|\uCE68\uD5A5|\uD55C\uC57D\uBC29|\uB77C\uD14D\uC2A4|\uCC28\uAC00\uBC84\uC12F|\uC8FD\uD0C4|\uCF5C\uB77C\uAC90|\uBCF4\uC774\uCC28|\uB18D\uC0B0\uBB3C|\uD2B9\uC0B0\uD488|\uAE30\uB150\uD488)/;
const OPTIONAL_DISCLOSURE_TEXT_RE = /(?:\uC120\uD0DD\uAD00\uAD11|\uD604\uC9C0\uC9C0\uBD88\uC635\uC158|\uAC15\uB825\uCD94\uCC9C\uC635\uC158|[$]\s*\d|\bUSD\s*\d)/i;
const SERVICE_TEXT_RE = /(?:\uB9C8\uC0AC\uC9C0|\uC804\uC2E0\s*\+\s*\uBC1C|\uC804\uC2E0\uB9C8\uC0AC\uC9C0|\uBC1C\uB9C8\uC0AC\uC9C0|\uC628\uCC9C\uC695|\uC2A4\uD30C|\uC785\uC7A5\uAD8C)/i;
const ATTRACTION_VISIT_HINT_RE = /(?:\uAD00\uAD11|\uBC29\uBB38|\uC0B0\uCC45|\uC21C\uB840|\uC870\uB9DD|\uB4F1\uC815|\uACF5\uC6D0|\uD3ED\uD3EC|\uD638\uC218|\uBBFC\uC18D\uCD0C|\uC628\uCC9C\uB9C8\uC744|\uB450\uB9CC\uAC15|\uC77C\uC1A1\uC815|\uD574\uB780\uAC15|\uCC9C\uC9C0|\uC7A5\uBC31\uD3ED\uD3EC|\uC545\uD654\uD3ED\uD3EC|\uB178\uCC9C\uC628\uCC9C\uC9C0\uB300|\uACBD\uACC4\uBE44|\uD611\uACE1|\uC2DC\uC7A5|\uC2E0\uC0AC|\uC0AC\uC6D0)/;

function normalizeActivity(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKind(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function hasListValue(value: unknown): boolean {
  return Array.isArray(value)
    ? value.some(item => String(item ?? '').trim().length > 0)
    : String(value ?? '').trim().length > 0;
}

function hasAttractionReference(item: NonNullable<ItineraryScheduleQualityDay['schedule']>[number]): boolean {
  return hasListValue(item.attraction_ids) || hasListValue(item.attraction_names);
}

function hasAttractionVisitHint(text: string): boolean {
  return ATTRACTION_VISIT_HINT_RE.test(text.replace(/\s+/g, ''));
}

function classifyNonAttractionCustomerText(activity: string, item: NonNullable<ItineraryScheduleQualityDay['schedule']>[number]): string | null {
  const text = [activity, item.note ?? ''].filter(Boolean).join(' ');
  const compact = text.replace(/\s+/g, '');
  if (MEAL_TEXT_RE.test(compact)) return 'meal text must not be rendered as an attraction card';
  if (SHOPPING_TEXT_RE.test(compact)) return 'shopping disclosure text must not be rendered as an attraction card';
  if (OPTIONAL_DISCLOSURE_TEXT_RE.test(text)) return 'paid optional-tour disclosure must not be rendered as an attraction card';
  if (HOTEL_TEXT_RE.test(text) && !hasAttractionVisitHint(text)) return 'hotel/rest text must not be rendered as an attraction card';
  if (SERVICE_TEXT_RE.test(text) && !hasAttractionVisitHint(text)) return 'optional/service text must not be rendered as an attraction card';
  if (TRANSFER_TEXT_RE.test(text) && !hasAttractionVisitHint(text)) return 'transfer text must not be rendered as an attraction card';
  return null;
}

function classifySemanticEntityIssue(
  activity: string,
  item: NonNullable<ItineraryScheduleQualityDay['schedule']>[number],
): { code: string; reason: string } | null {
  if (!activity) return null;
  const kind = normalizeKind(item.entity_kind) || normalizeKind(item.type);
  const hasRefs = hasAttractionReference(item);
  const nonAttractionReason = classifyNonAttractionCustomerText(activity, item);

  if (kind && ATTRACTION_ENTITY_KINDS.has(kind) && nonAttractionReason) {
    return {
      code: 'ITINERARY_ATTRACTION_KIND_CONTRADICTS_TEXT',
      reason: nonAttractionReason,
    };
  }
  if (hasRefs && kind && NON_ATTRACTION_ENTITY_KINDS.has(kind)) {
    return {
      code: 'ITINERARY_NON_ATTRACTION_HAS_ATTRACTION_REF',
      reason: `${kind} item has attraction references and would create a wrong mobile landing card`,
    };
  }
  if (hasRefs && nonAttractionReason) {
    return {
      code: 'ITINERARY_ATTRACTION_REF_ON_NON_ATTRACTION_TEXT',
      reason: nonAttractionReason,
    };
  }
  return null;
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
      if (pollution) {
        dayIssues.push({
          ...pollution,
          day: number,
          activity,
        });
      }
      const semantic = classifySemanticEntityIssue(activity, item);
      if (semantic) {
        dayIssues.push({
          ...semantic,
          day: number,
          activity,
        });
      }
    }
    issues.push(...dayIssues);
  }

  return issues;
}
