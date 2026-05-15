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
  breakfast?: boolean | null;
  lunch?: boolean | null;
  dinner?: boolean | null;
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
function normalizeRegions(regions: string[] | undefined): string[] {
  if (!Array.isArray(regions)) return [];
  const cleaned = regions
    .map(r => (typeof r === 'string' ? r.trim() : ''))
    .filter(r => r.length > 0);
  return Array.from(new Set(cleaned));
}

/** schedule 정제 — 빈 항목 제거 + ▶ 접두사 제거 + 한 덩어리로 합쳐진 activity 줄별 분할.
 *  2026-05-15 박제 (부관훼리 DAY 2 한 덩어리 사고): LLM 이 여러 활동을 한 activity 에 합쳐서 박는 경우,
 *  ▶로 시작하는 부분 + 줄바꿈 으로 분할하여 별도 schedule item 으로 정형화. */
const BULLET_PREFIX_RE = /^[▶●•·◆◇■□★☆+○•▪●◦]+\s*/;
const ACTIVITY_SPLIT_RE = /\s*(?=▶)\s*|\n+/;

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
      if (cleaned) out.push({ ...s, activity: cleaned });
      continue;
    }
    // 다중 활동 — 각각 분할해서 별도 schedule item 으로 (첫 item 은 time/transport 등 메타 보존)
    parts.forEach((part, idx) => {
      const activity = part.replace(BULLET_PREFIX_RE, '').trim();
      if (!activity) return;
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

/** 메인 정규화 — itinerary_data 통째로 후처리 */
export function normalizeItinerary(itin: ItineraryDataBlock | null | undefined): ItineraryDataBlock | null | undefined {
  if (!itin || !Array.isArray(itin.days)) return itin;

  // 1) 각 day 정규화
  let normalizedDays: DayBlock[] = itin.days.map(day => ({
    ...day,
    regions: normalizeRegions(day.regions),
    schedule: cleanSchedule(day.schedule),
    hotel: day.hotel ? {
      ...day.hotel,
      grade: normalizeHotelGrade(day.hotel.grade),
    } : day.hotel,
  }));

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
