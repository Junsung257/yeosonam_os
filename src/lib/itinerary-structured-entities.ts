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

function isGenericMealNote(note: string | null | undefined): boolean {
  return /^(?:조식|중식|석식|호텔식|현지식)$/.test(String(note ?? '').trim());
}

function mergeMeal(meals: MealFields, slot: MealSlot, note: string): MealFields {
  const next = { ...meals };
  next[slot] = true;
  const noteKey = `${slot}_note` as `${MealSlot}_note`;
  const current = typeof next[noteKey] === 'string' ? next[noteKey]?.trim() : '';
  const cleanNote = note.replace(/\s+/g, ' ').trim();
  next[noteKey] = current && !isGenericMealNote(current) ? current : cleanNote;
  return next;
}

function embeddedMealEvidence(activity: string): Array<{ slot: MealSlot; note: string }> {
  const out: Array<{ slot: MealSlot; note: string }> = [];
  if (/(?:호텔\s*)?조식\s*후/.test(activity)) {
    out.push({ slot: 'breakfast', note: /호텔\s*조식/.test(activity) ? '호텔식' : '조식' });
  }
  if (/중식\s*후/.test(activity)) out.push({ slot: 'lunch', note: '중식' });
  if (/석식\s*후/.test(activity)) out.push({ slot: 'dinner', note: '석식' });
  return out;
}

function removeEmbeddedMealPrefix(activity: string): string {
  return activity
    .replace(/^\s*(?:호텔\s*)?조식\s*후\s*[▶>\-–—:：]?\s*/g, '')
    .replace(/^\s*중식\s*후\s*[▶>\-–—:：]?\s*/g, '')
    .replace(/^\s*석식\s*후\s*[▶>\-–—:：]?\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  for (let item of day.schedule) {
    let activity = String(item.activity ?? '').replace(/\s+/g, ' ').trim();
    const embeddedMeals = embeddedMealEvidence(activity);
    if (embeddedMeals.length > 0) {
      for (const meal of embeddedMeals) meals = mergeMeal(meals, meal.slot, meal.note);
      const cleanedActivity = removeEmbeddedMealPrefix(activity);
      changed = true;
      if (!cleanedActivity) continue;
      item = { ...item, activity: cleanedActivity };
      activity = cleanedActivity;
    }

    if (isMealItem(item)) {
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

function mealSlotFromKorean(label: string): MealSlot {
  if (label === '조') return 'breakfast';
  if (label === '중') return 'lunch';
  return 'dinner';
}

function normalizeMealNote(value: string): string | null {
  let note = value
    .replace(/[+＋]\s*/g, ' + ')
    .replace(/\s+/g, ' ')
    .replace(/\s+\+\s+/g, ' + ')
    .replace(/김\s+밥/g, '김밥')
    .trim();
  note = note.replace(/^무제한\s+(.+)$/, '$1 무제한');
  if (!note || /^(?:없음|불포함|-)$/.test(note)) return null;
  return note;
}

function parseRawTextMealEvidence(rawText: string | null | undefined): Map<number, Partial<Record<MealSlot, string>>> {
  const evidence = new Map<number, Partial<Record<MealSlot, string>>>();
  if (!rawText) return evidence;

  const lines = rawText.replace(/\r\n/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
  let currentDay: number | null = null;
  let currentSlot: MealSlot | null = null;

  const commit = (slot: MealSlot, value: string) => {
    if (!currentDay) return;
    const note = normalizeMealNote(value);
    if (!note) return;
    const dayEvidence = evidence.get(currentDay) ?? {};
    dayEvidence[slot] = note;
    evidence.set(currentDay, dayEvidence);
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[▶★*ㆍ·\-\s]+/, '').trim();
    const dayMatch = line.match(/^(?:DAY\s*)?(\d+)\s*(?:일|day)?$/i) ?? line.match(/^제\s*(\d+)\s*일$/);
    if (dayMatch) {
      currentDay = Number(dayMatch[1]);
      currentSlot = null;
      continue;
    }

    if (!currentDay) continue;

    const mealMatch = line.match(/^([조중석])\s*[:：]\s*(.+)$/);
    if (mealMatch) {
      currentSlot = mealSlotFromKorean(mealMatch[1]);
      commit(currentSlot, mealMatch[2]);
      continue;
    }

    if (!currentSlot) continue;
    if (/^(?:호텔|HOTEL|󰆹|☞|\[|※|제\s*\d+\s*일|DAY\s*\d+)/i.test(line)) {
      currentSlot = null;
      continue;
    }
    if (/^(?:시\s*간|일\s*정|식\s*사|전용차량|전일|\d{1,2}:\d{2}|[A-Z0-9]{2}\d{3,4})$/i.test(line)) continue;
    if (/^(?:부\s*산|연\s*길|도\s*문|용\s*정|송강하|남\s*파|북\s*파|서\s*파|이도백하)$/.test(line)) continue;
    if (/[가-힣A-Za-z]/.test(line) && line.length <= 20) {
      const dayEvidence = evidence.get(currentDay) ?? {};
      const current = dayEvidence[currentSlot] ?? '';
      dayEvidence[currentSlot] = normalizeMealNote(`${current} ${line}`) ?? current;
      evidence.set(currentDay, dayEvidence);
    }
  }

  return evidence;
}

export function mergeRawTextMealEvidence<T extends ItineraryDataLike | null>(itineraryData: T, rawText: string | null | undefined): T {
  if (!itineraryData?.days?.length || !rawText) return itineraryData;
  const evidence = parseRawTextMealEvidence(rawText);
  if (evidence.size === 0) return itineraryData;

  const days = itineraryData.days.map(day => {
    const dayNumber = typeof day.day === 'number' ? day.day : null;
    const dayEvidence = dayNumber ? evidence.get(dayNumber) : null;
    if (!dayEvidence) return day;
    let meals: MealFields = day.meals && typeof day.meals === 'object' ? { ...(day.meals as MealFields) } : {};
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      const note = dayEvidence[slot];
      if (!note) continue;
      meals[slot] = true;
      meals[`${slot}_note` as `${MealSlot}_note`] = note;
    }
    return { ...day, meals };
  });

  return { ...itineraryData, days } as T;
}
