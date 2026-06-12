import type { ItineraryDataLike, ItineraryScheduleItem } from '@/lib/itinerary-attraction-enricher';

type MealSlot = 'breakfast' | 'lunch' | 'dinner';

type MealFields = {
  breakfast?: boolean | string | null;
  lunch?: boolean | string | null;
  dinner?: boolean | string | null;
  breakfast_note?: string | null;
  lunch_note?: string | null;
  dinner_note?: string | null;
};

type HotelFields = {
  name?: string | null;
  grade?: string | number | null;
  note?: string | null;
};

type StructuredDayLike = {
  day?: number | null;
  schedule?: ItineraryScheduleItem[];
  meals?: MealFields | null;
  hotel?: HotelFields | null;
  [key: string]: unknown;
};

const FOOD_ONLY_RE = /^(?:호텔식|현지식|김밥|냉면|꿈바로우|꿔바로우|샤브샤브|삼겹살|양꼬치|비빔밥|무제한|매운탕|오리구이|산천어회)$/;
const HOTEL_STAY_RE = /(?:HOTEL|호텔|리조트|숙소).*(?:또는\s*동급|동급|\([^)성]*성[^)]*\)|숙박|투숙)/i;
const NOT_HOTEL_STAY_RE = /(?:온천욕|체험|특전|상당|마사지|선택관광|현지지불)/;

function compact(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function getKind(item: ItineraryScheduleItem): string {
  return String(item.entity_kind ?? item.type ?? '').toLowerCase();
}

function isMealItem(item: ItineraryScheduleItem): boolean {
  const activity = String(item.activity ?? '').replace(/\s+/g, ' ').trim();
  if (!activity) return false;
  const kind = getKind(item);
  if (kind === 'meal') return true;
  if (item.type === 'meal') return true;
  return FOOD_ONLY_RE.test(compact(activity));
}

function inferMealSlot(activity: string): MealSlot {
  if (/breakfast|조식/i.test(activity)) return 'breakfast';
  if (/lunch|중식/i.test(activity)) return 'lunch';
  if (/dinner|석식/i.test(activity)) return 'dinner';
  return 'dinner';
}

function mergeMeal(meals: MealFields, slot: MealSlot, note: string): MealFields {
  const next = { ...meals };
  next[slot] = true;
  const noteKey = `${slot}_note` as `${MealSlot}_note`;
  const current = typeof next[noteKey] === 'string' ? next[noteKey]?.trim() : '';
  next[noteKey] = current ? current : note;
  return next;
}

function isHotelStayItem(item: ItineraryScheduleItem): boolean {
  const activity = String(item.activity ?? '').replace(/\s+/g, ' ').trim();
  if (!activity) return false;
  const kind = getKind(item);
  if (kind === 'optional_tour') return false;
  if (NOT_HOTEL_STAY_RE.test(activity)) return false;
  if (kind === 'hotel_stay') return true;
  if (item.type === 'hotel' && HOTEL_STAY_RE.test(activity)) return true;
  return false;
}

function parseHotel(activity: string): HotelFields {
  const normalized = activity.replace(/\s+/g, ' ').trim();
  const grade = normalized.match(/\(([^)]*성[^)]*)\)/)?.[1]?.trim() ?? null;
  const name = normalized
    .replace(/\s*\([^)]*성[^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    name: name || normalized,
    grade,
    note: null,
  };
}

function hasHotelName(hotel: unknown): boolean {
  return !!(hotel && typeof hotel === 'object' && typeof (hotel as HotelFields).name === 'string' && (hotel as HotelFields).name?.trim());
}

export function normalizeStructuredDayEntities<T extends StructuredDayLike>(day: T): T {
  if (!Array.isArray(day.schedule) || day.schedule.length === 0) return day;

  let changed = false;
  let meals: MealFields = day.meals && typeof day.meals === 'object' ? { ...(day.meals as MealFields) } : {};
  let hotel: HotelFields | null = day.hotel && typeof day.hotel === 'object' ? { ...(day.hotel as HotelFields) } : null;
  const schedule: ItineraryScheduleItem[] = [];

  for (const item of day.schedule) {
    if (isMealItem(item)) {
      const activity = String(item.activity ?? '').replace(/\s+/g, ' ').trim();
      meals = mergeMeal(meals, inferMealSlot(activity), activity);
      changed = true;
      continue;
    }

    if (isHotelStayItem(item)) {
      if (!hasHotelName(hotel)) hotel = parseHotel(String(item.activity ?? ''));
      changed = true;
      continue;
    }

    schedule.push(item);
  }

  if (!changed) return day;
  return {
    ...day,
    schedule,
    meals,
    hotel,
  };
}

export function normalizeStructuredItineraryEntities<T extends ItineraryDataLike | null>(itineraryData: T): T {
  if (!itineraryData?.days?.length) return itineraryData;
  const days = itineraryData.days.map(day => normalizeStructuredDayEntities(day));
  return { ...itineraryData, days } as T;
}
