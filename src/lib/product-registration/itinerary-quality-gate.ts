export type ItineraryScheduleQualityDay = {
  day?: number;
  dayNumber?: number;
  day_number?: number;
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
const STANDALONE_REGION_RE = /^(?:부산|부\s*산|김해|나리타|나라타|치바|치\s*바|동경|도쿄|오사카|후쿠오카|세부|다낭|나트랑|푸꾸옥)$/;
const HOTEL_LINE_RE = /^HOTEL\s*[:：]/i;
const URL_RE = /^https?:\/\//i;
const MEAL_LINE_RE = /^[조중석]\s*[:：]\s*\S+/;
const NOTICE_SECTION_RE = /^(?:비\s*고|주의사항|취소|환불|예약금|잔금|취소수수료|취소료|환불규정)\b/;

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
  if (STANDALONE_TRANSPORT_RE.test(activity) || STANDALONE_TRANSPORT_RE.test(compact)) {
    return { code: 'ITINERARY_SCHEDULE_TRANSPORT_ONLY', reason: 'transport column value appears as a standalone schedule activity' };
  }
  if (STANDALONE_REGION_RE.test(activity) || STANDALONE_REGION_RE.test(compact)) {
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
    const hasColumnFragment = dayIssues.some(issue => issue.code !== 'ITINERARY_SCHEDULE_REGION_ONLY');
    issues.push(...dayIssues.filter(issue => issue.code !== 'ITINERARY_SCHEDULE_REGION_ONLY' || hasColumnFragment));
  }

  return issues;
}
