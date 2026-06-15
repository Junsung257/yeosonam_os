/**
 * @file itinerary-normalizer.ts — itinerary_data 후처리 정규화 (LLM 0)
 *
 * 박제 사유 (P10-3, 2026-05-13):
 * LLM 추출 결과의 다형성을 결정적 룰로 통일 → 수동 편집 5~10% 감소.
 *
 * 정규화 항목:
 * 1. 호텔 grade: "4성급" / "5성(특급)" / "★★★★★" → "4성" / "5성" 표준화
 * 2. 식사 카운트: meta.total_meals 자동 계산 (조/중/석 합계)
 * 3. 호텔명 dedupe: 같은 패키지 내 유사 호텔명 (Levenshtein 거리 2 이하) 통합
 * 4. regions 정규화: trim + 중복 제거
 * 5. schedule 빈 항목 제거
 */

interface ScheduleItem {
  time?: string | null;
  activity?: string | null;
  transport?: string | null;
  type?: string | null;
  note?: string | null;
  [key: string]: unknown;
}

interface DayHotel {
  name?: string | null;
  grade?: string | number | null;
  note?: string | null;
}

interface Meals {
  breakfast?: boolean | string | null;
  lunch?: boolean | string | null;
  dinner?: boolean | string | null;
  breakfast_note?: string | null;
  lunch_note?: string | null;
  dinner_note?: string | null;
  [key: string]: unknown;
}

interface DayBlock {
  day?: number;
  regions?: string[];
  schedule?: ScheduleItem[];
  hotel?: DayHotel;
  meals?: Meals;
  [key: string]: unknown;
}

interface ItineraryDataBlock {
  days?: DayBlock[];
  meta?: { [key: string]: unknown };
  [key: string]: unknown;
}

/** 호텔 grade 정규화: "4성급" / "5성(특급)" / "★★★★★" → "4성" / "5성" */
function normalizeHotelGrade(grade: string | number | null | undefined): string | null {
  if (grade === null || grade === undefined || grade === '') return null;
  const s = String(grade).trim();
  if (!s) return null;
  // 숫자만: 4 → "4성"
  if (/^[1-5]$/.test(s)) return `${s}성`;
  // "★★★★★" 별 카운트
  const stars = (s.match(/★/g) ?? []).length;
  if (stars >= 1 && stars <= 5) return `${stars}성`;
  // "4성급" / "5성(특급)" / "준4성"
  const m = s.match(/(준?)\s*([1-5])\s*성/);
  if (m) return `${m[1]}${m[2]}성`;
  // 기타 — 원본 유지
  return s;
}

/** 호텔명 유사도 (Levenshtein 거리) */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/** 호텔명 fuzzy dedupe — Levenshtein 2 이하면 첫 등장 명칭으로 통일 */
function dedupeHotelNames(days: DayBlock[]): DayBlock[] {
  const canonical: string[] = [];
  return days.map(day => {
    const name = day.hotel?.name?.trim();
    if (!name) return day;
    // 기존 canonical 중 유사한 게 있나
    const match = canonical.find(c => levenshtein(c, name) <= 2);
    if (match && match !== name) {
      return {
        ...day,
        hotel: { ...day.hotel, name: match },
      };
    }
    canonical.push(name);
    return day;
  });
}

/** regions 정규화: trim + 중복 제거 + 빈값 제거 */
const HOTEL_NAME_SCHEDULE_TEXT_RE = /(?:\uBBF8\uD305|\uACF5\uD56D|\uC774\uB3D9|\uCD9C\uBC1C|\uB3C4\uCC29|\uCCB4\uD06C\uC544\uC6C3|\uB77C\uC6B4\uB529)/;
const HOTEL_NAME_HINT_RE = /(?:[\uAC00-\uD7A3A-Za-z0-9]{2,}\uD638\uD154|\uB9AC\uC870\uD2B8|\uACE8\uD504\uD154|hotel|resort|\uB3D9\uAE09|\d\s*\uC131)/i;

function hotelNameIsScheduleText(name: string | null | undefined): boolean {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return HOTEL_NAME_SCHEDULE_TEXT_RE.test(text.replace(/\s+/g, '')) && !HOTEL_NAME_HINT_RE.test(text);
}

function repairHotelFieldScheduleText(day: DayBlock): DayBlock {
  const name = day.hotel?.name?.trim();
  if (!hotelNameIsScheduleText(name)) return day;
  const schedule = Array.isArray(day.schedule) ? [...day.schedule] : [];
  if (name && !schedule.some(item => item.activity?.trim() === name)) {
    schedule.push({
      activity: name,
      time: null,
      transport: null,
      type: /\uC774\uB3D9|\uACF5\uD56D|\uBBF8\uD305/.test(name) ? 'normal' : 'hotel',
    });
  }
  return {
    ...day,
    schedule,
    hotel: undefined,
  };
}

function normalizeRegions(regions: string[] | undefined): string[] {
  if (!Array.isArray(regions)) return [];
  const cleaned = regions
    .map(r => (typeof r === 'string' ? r.trim() : ''))
    .filter(r => r.length > 0);
  return Array.from(new Set(cleaned));
}

function normalizeMealSlot(value: unknown, note: unknown): { enabled: boolean | null; note: string | null } {
  const noteText = typeof note === 'string' && note.trim() ? note.trim() : null;
  if (typeof value === 'boolean') return { enabled: value, note: noteText };
  if (value == null) return { enabled: noteText ? true : null, note: noteText };
  if (typeof value !== 'string') return { enabled: Boolean(value), note: noteText };

  const text = value.trim();
  if (!text) return { enabled: noteText ? true : null, note: noteText };
  const normalizedText = text === '한' ? '한식' : text;
  const unavailable = /불포함|자유식|없음|미포함|X|x/.test(normalizedText);
  return {
    enabled: !unavailable,
    note: noteText ?? normalizedText,
  };
}

function normalizeMeals(meals: Meals | undefined): Meals | undefined {
  if (!meals) return meals;
  const breakfast = normalizeMealSlot(meals.breakfast, meals.breakfast_note);
  const lunch = normalizeMealSlot(meals.lunch, meals.lunch_note);
  const dinner = normalizeMealSlot(meals.dinner, meals.dinner_note);
  return {
    ...meals,
    breakfast: breakfast.enabled,
    lunch: lunch.enabled,
    dinner: dinner.enabled,
    breakfast_note: breakfast.note,
    lunch_note: lunch.note,
    dinner_note: dinner.note,
  };
}

/** LLM이 공항 출발/도착을 type=normal 로 두는 경우 flight 로 보정 (flight_segments·헤더 카드 SSOT) */
export function coerceAirportScheduleTypes(schedule: ScheduleItem[] | undefined): ScheduleItem[] {
  if (!Array.isArray(schedule)) return [];
  return schedule.map(item => {
    if (item.type === 'flight') return item;
    const act = (item.activity ?? '').trim();
    if (!act) return item;

    // 미팅·수속 — flight 아님 (sanitizeFlightScheduleTimes 가 time 제거)
    if (/출발\s*\d+\s*시간\s*전|미팅\s*후\s*수속|국제선\s*\d+\s*층|공항\s*도착\s*후|도착\s*후/.test(act)) {
      return item;
    }

    const isArrowFlight = /[→↦⇒]/.test(act) && /출발/.test(act) && /도착/.test(act);
    const isDep =
      /(국제)?\s*공항\s*출발/.test(act) ||
      (/출발/.test(act) && !/도착/.test(act) && /공항|김해|인천|김포|부산/.test(act));
    const isArr =
      /(국제)?\s*공항\s*도착/.test(act) ||
      (/도착/.test(act) && !/출발/.test(act) && /공항/.test(act));
    const isSimpleDep =
      /^[\w가-힣]+(?:\s+[\w가-힣]+)?\s*출발$/.test(act) &&
      !/미팅|수속|층/.test(act);
    const isSimpleArr =
      /^[\w가-힣]+(?:\s+[\w가-힣]+)?\s*도착$/.test(act);

    if (isArrowFlight || isDep || isArr || isSimpleDep || isSimpleArr) {
      return { ...item, type: 'flight' };
    }
    return item;
  });
}

/** schedule 정제 — 빈 항목 제거 + ▶ 접두사 제거 + 한 덩어리로 합쳐진 activity 줄별 분할.
 *  2026-05-15 박제 (부관훼리 DAY 2 한 덩어리 사고): LLM 이 여러 활동을 한 activity 에 합쳐서 박는 경우,
 *  ▶로 시작하는 부분 + 줄바꿈 으로 분할하여 별도 schedule item 으로 정형화. */
const BULLET_PREFIX_RE = /^[▶●•·◆◇■□★☆+○•▪●◦]+\s*/;
const ACTIVITY_SPLIT_RE = /\s*(?=▶)\s*|\n+/;
const SCHEDULE_DETAIL_NOISE_RE: RegExp[] = [
  /^\d+\.\s*\uACE8\uD504\uC7A5\s*\uC815\uBCF4\s*$/,
  /^\[?\s*(?:\uD3EC\uD568\s*\uC0AC\uD56D|\uBD88\uD3EC\uD568\s*\uC0AC\uD56D)\s*\]?\s*$/,
  /^\uCF54\uC2A4\uC815\uBCF4\s*[:：]/,
  /^\uD2F0\uD0C0\uC784\s*[:：]/,
  /^\uD074\uB7FD\s*\uB80C\uD0C8\s*[:：]/,
  /^\uCE90\uB514\uD301\b/,
  /^\uD640\uC218\s*\uC778\uC6D0\s*\uC608\uC57D/,
  /^\uB9AC\uC870\uD2B8\s*[→>\-~]+\s*\uACE8\uD504\uC7A5/,
];

export function isScheduleDetailNoise(activity: string | null | undefined): boolean {
  const s = (activity ?? '').trim();
  if (!s) return false;
  return SCHEDULE_DETAIL_NOISE_RE.some(re => re.test(s));
}

function cleanSchedule(schedule: ScheduleItem[] | undefined): ScheduleItem[] {
  if (!Array.isArray(schedule)) return [];
  const out: ScheduleItem[] = [];
  for (const s of schedule) {
    const raw = (s.activity ?? '').trim();
    if (!raw) continue;
    // ▶ 다중 활동이 한 줄/한 item 에 합쳐진 경우 분할
    const parts = raw.split(ACTIVITY_SPLIT_RE).map(p => p.trim()).filter(p => p.length >= 2);
    if (parts.length <= 1) {
      // 단일 활동 — ▶ 접두사만 제거
      const cleaned = raw.replace(BULLET_PREFIX_RE, '').trim();
      if (cleaned && !isScheduleDetailNoise(cleaned)) out.push({ ...s, activity: cleaned });
      continue;
    }
    // 다중 활동 — 각각 분할해서 별도 schedule item 으로 (첫 item 은 time/transport 등 메타 보존)
    parts.forEach((part, idx) => {
      const activity = part.replace(BULLET_PREFIX_RE, '').trim();
      if (!activity || isScheduleDetailNoise(activity)) return;
      if (idx === 0) {
        out.push({ ...s, activity });
      } else {
        // 추가 분할된 활동은 time/transport 없이 activity 만 (UI 가 시간 없으면 시간란 안 그림)
        out.push({ activity, time: null, transport: null, type: 'normal' } as ScheduleItem);
      }
    });
  }
  return out;
}

/** 항공 dep/arr 시간이 미팅·수속 줄에 잘못 붙은 경우 제거 (2026-05-22 보홀·다낭) */
function sanitizeFlightScheduleTimes(schedule: ScheduleItem[]): ScheduleItem[] {
  if (!Array.isArray(schedule) || schedule.length === 0) return schedule;

  const depFlight = schedule.find(s => s.type === 'flight' && /출발/.test(s.activity || '') && !/도착/.test(s.activity || ''));
  const arrFlight = schedule.find(s => s.type === 'flight' && /도착/.test(s.activity || '') && !/출발/.test(s.activity || ''));

  return schedule.map(item => {
    if (item.type === 'flight') return item;
    const act = (item.activity ?? '').trim();
    if (!act || !item.time) return item;

    // 미팅·수속·층 안내 — 시계 시간 표시 금지 (출발 N시간 전 계산값 18:50 포함)
    if (/출발\s*\d+\s*시간\s*전|미팅\s*후\s*수속|국제선\s*\d+\s*층/.test(act)) {
      return { ...item, time: null };
    }

    if (
      arrFlight?.time &&
      item.time === arrFlight.time &&
      !/(국제)?\s*공항\s*도착/.test(act)
    ) {
      return { ...item, time: null };
    }

    if (
      depFlight?.time &&
      item.time === depFlight.time &&
      !/(국제)?\s*공항\s*출발/.test(act) &&
      !/출발/.test(act)
    ) {
      return { ...item, time: null };
    }

    return item;
  });
}

function applyMetaFlightHints(days: DayBlock[], meta: ItineraryDataBlock['meta'] | undefined): DayBlock[] {
  const flightOut = typeof meta?.flight_out === 'string' ? meta.flight_out : null;
  const flightIn = typeof meta?.flight_in === 'string' ? meta.flight_in : null;
  const flightOutTime = typeof meta?.flight_out_time === 'string' ? meta.flight_out_time : null;
  const flightInTime = typeof meta?.flight_in_time === 'string' ? meta.flight_in_time : null;

  return days.map((day, dayIndex) => {
    const isFirstDay = dayIndex === 0;
    const isLastDay = dayIndex === days.length - 1;
    const schedule = (day.schedule ?? []).map((item) => {
      const activity = item.activity ?? '';
      if (/출발\s*\d+\s*시간\s*전|미팅\s*후\s*수속|국제선\s*\d+\s*층/.test(activity)) {
        return item;
      }
      const isOutboundDeparture =
        isFirstDay
        && /\uCD9C\uBC1C/.test(activity)
        && (/\uD5A5\uBC1C/.test(activity) || !/\uB3C4\uCC29/.test(activity));
      const isInboundDeparture =
        isLastDay
        && /\uCD9C\uBC1C/.test(activity)
        && !/\uD5A5\uBC1C/.test(activity);

      if (isOutboundDeparture && flightOut) {
        return {
          ...item,
          type: 'flight',
          transport: item.transport ?? flightOut,
          time: item.time ?? flightOutTime,
        };
      }
      if (isInboundDeparture && flightIn) {
        return {
          ...item,
          type: 'flight',
          transport: item.transport ?? flightIn,
          time: item.time ?? flightInTime,
        };
      }
      return item;
    });
    return { ...day, schedule };
  });
}
/** 업로드·고객 상세 공통 — itinerary_data 후처리 + flight_segments SSOT */
export function enrichItineraryForDisplay<T extends ItineraryDataBlock | null | undefined>(
  itin: T,
  normalizeFlights?: (data: ItineraryDataBlock) => ItineraryDataBlock | null | undefined,
): T {
  if (!itin) return itin;
  const normalized = normalizeItinerary(itin) as ItineraryDataBlock;
  if (typeof normalizeFlights === 'function') {
    return (normalizeFlights(normalized) ?? normalized) as T;
  }
  return normalized as T;
}

/** 메인 정규화 — itinerary_data 통째로 후처리 */
export function normalizeItinerary(itin: ItineraryDataBlock | null | undefined): ItineraryDataBlock | null | undefined {
  if (!itin || !Array.isArray(itin.days)) return itin;

  // 1) 각 day 정규화
  let normalizedDays: DayBlock[] = itin.days.map(day => {
    const repairedDay = repairHotelFieldScheduleText(day);
    return {
      ...repairedDay,
      regions: normalizeRegions(repairedDay.regions),
      schedule: sanitizeFlightScheduleTimes(cleanSchedule(coerceAirportScheduleTypes(repairedDay.schedule))),
      meals: normalizeMeals(repairedDay.meals),
      hotel: repairedDay.hotel ? {
        ...repairedDay.hotel,
        grade: normalizeHotelGrade(repairedDay.hotel.grade),
      } : repairedDay.hotel,
    };
  });

  normalizedDays = applyMetaFlightHints(normalizedDays, itin.meta);

  // 2) 호텔명 fuzzy dedupe (Levenshtein 2 이하)
  normalizedDays = dedupeHotelNames(normalizedDays);

  // 3) meta 식사 카운트
  let totalMeals = 0;
  for (const d of normalizedDays) {
    const m = d.meals;
    if (m) {
      if (m.breakfast) totalMeals++;
      if (m.lunch) totalMeals++;
      if (m.dinner) totalMeals++;
    }
  }

  return {
    ...itin,
    days: normalizedDays,
    meta: {
      ...(itin.meta ?? {}),
      total_meals: totalMeals,
    },
  };
}

/** 통계 — 정규화 효과 측정 (audit용) */
export function getNormalizationStats(
  before: ItineraryDataBlock | null | undefined,
  after: ItineraryDataBlock | null | undefined,
): { hotels_normalized: number; meals_counted: number; regions_cleaned: number; schedule_cleaned: number } {
  let hotelsBefore = 0, hotelsAfter = 0;
  let regionsBefore = 0, regionsAfter = 0;
  let schedBefore = 0, schedAfter = 0;

  for (const d of before?.days ?? []) {
    const grades = d.hotel?.grade;
    if (grades && typeof grades === 'string' && grades !== normalizeHotelGrade(grades)) hotelsBefore++;
    regionsBefore += (d.regions ?? []).length;
    schedBefore += (d.schedule ?? []).length;
  }
  for (const d of after?.days ?? []) {
    if (d.hotel?.grade) hotelsAfter++;
    regionsAfter += (d.regions ?? []).length;
    schedAfter += (d.schedule ?? []).length;
  }

  return {
    hotels_normalized: hotelsBefore,
    meals_counted: Number((after?.meta?.total_meals as number | undefined) ?? 0),
    regions_cleaned: regionsBefore - regionsAfter,
    schedule_cleaned: schedBefore - schedAfter,
  };
}
