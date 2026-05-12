/**
 * DeepSeek(가격 대비 성능) — 일자별 일정 슬롯 JSON 생성 + MRT 투어 카탈로그 병합
 */

import { z } from 'zod';
import { llmCall } from '@/lib/llm-gateway';
import type { ActivityResult, StayResult } from '@/lib/travel-providers/types';
import {
  buildDayPlans,
  type DayPlan,
  type DayStop,
} from '@/lib/free-travel/itinerary-schema';
import { buildStopsForDay } from '@/lib/free-travel/itinerary-templates';

// ─── LLM 출력 스키마 (Zod) ─────────────────────────────────────────────────

const LlmSlotSchema = z.object({
  timeHint: z.string().min(1),
  label: z.string().min(1),
  /** 카탈로그에 있으면 그대로 넣으면 예약 슬롯로 확정 */
  mrtProviderId: z.string().optional(),
});

const LlmDaySchema = z.object({
  day: z.number().int().min(1).max(60),
  slots: z.array(LlmSlotSchema).min(1),
});

const LlmItineraryRootSchema = z.object({
  days: z.array(LlmDaySchema).min(1),
});

export type LlmItineraryRoot = z.infer<typeof LlmItineraryRootSchema>;

const JsonSchemaForLlm = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'number' },
          slots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                timeHint: { type: 'string' },
                label: { type: 'string' },
                mrtProviderId: { type: 'string' },
              },
              required: ['timeHint', 'label'],
            },
          },
        },
        required: ['day', 'slots'],
      },
    },
  },
  required: ['days'],
} as const;

// ─── MRT 매칭 ───────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function fuzzyMatchActivity(
  label: string,
  activities: ActivityResult[],
): ActivityResult | null {
  const parts = label
    .split(/[·,\s/|]+/)
    .map(p => p.trim())
    .filter(p => p.length >= 2);
  for (const a of activities) {
    const low = a.name.toLowerCase();
    if (parts.some(p => low.includes(p.toLowerCase()) || p.toLowerCase().includes(low.slice(0, 4)))) {
      return a;
    }
  }
  for (const a of activities) {
    if (normalize(a.name).includes(normalize(label).slice(0, 6))) return a;
  }
  return null;
}

function slotToStop(
  day: number,
  slotIdx: number,
  slot: z.infer<typeof LlmSlotSchema>,
  activities: ActivityResult[],
): DayStop {
  const id = `${day}-${slotIdx}`;
  let act: ActivityResult | null = null;
  if (slot.mrtProviderId) {
    act = activities.find(a => a.providerId === slot.mrtProviderId) ?? null;
  }
  if (!act) act = fuzzyMatchActivity(slot.label, activities);
  const bookable = Boolean(act && act.price > 0);
  return {
    id,
    timeHint: slot.timeHint,
    label: slot.label,
    kind: bookable ? 'bookable' : 'free',
    activityProviderId: bookable ? act!.providerId : undefined,
    priceHint: bookable ? act!.price : undefined,
  };
}

function inferPace(travelPace: string | null | undefined): 'fast' | 'relaxed' | 'normal' {
  if (!travelPace) return 'normal';
  if (/빡|빽|촘|다이나믹|몰아/i.test(travelPace)) return 'fast';
  if (/여유|느긋|천천|휴양/i.test(travelPace)) return 'relaxed';
  return 'normal';
}

function stayOptionsFromSchema(
  day: number,
  totalDays: number,
  isArrival: boolean,
  primaryHotel: StayResult | undefined,
  altHotels: StayResult[],
  destination: string,
): DayPlan['hotels'] {
  if (!primaryHotel) return [];
  const hotelsForDay: DayPlan['hotels'] = [];
  hotelsForDay.push({
    type: 'recommended',
    name: primaryHotel.name,
    pricePerNight: primaryHotel.pricePerNight,
    location: primaryHotel.location,
    reason: isArrival
      ? '도착일 이동 피로를 줄이기 위한 접근성 우선 추천 (이후 일정은 같은 숙소 연박 기준)'
      : day === totalDays - 1
        ? '마지막 숙박일 — 체크아웃 전 짐 정리·이동 여유를 두세요'
        : `${destination} 체류 중 동선 안정을 위한 연박 추천`,
    affiliateLink: primaryHotel.affiliateLink ?? primaryHotel.providerUrl,
  });
  for (const alt of altHotels) {
    hotelsForDay.push({
      type: 'alternative',
      name: alt.name,
      pricePerNight: alt.pricePerNight,
      location: alt.location,
      reason: '예산·취향에 맞는 대체 숙소 (실제 예약은 1곳만 선택)',
      affiliateLink: alt.affiliateLink ?? alt.providerUrl,
    });
  }
  return hotelsForDay;
}

function stopsToActivitySlots(
  stops: DayStop[],
  activities: ActivityResult[],
  day: number,
  pace: 'fast' | 'relaxed' | 'normal',
): DayPlan['activities'] {
  const slots: DayPlan['activities'] = [];
  const byId = new Map(activities.map(a => [a.providerId, a]));
  for (const s of stops) {
    if (s.kind !== 'bookable' || !s.activityProviderId) continue;
    const a = byId.get(s.activityProviderId);
    if (!a) continue;
    const paceNote =
      pace === 'fast' ? '이동·체험 위주' : pace === 'relaxed' ? '여유 있게' : '동선·체류 반영';
    slots.push({
      title: a.name,
      price: a.price,
      reason: `${day}일차 ${s.timeHint} — 「${s.label}」 (${paceNote})`,
      affiliateLink: a.affiliateLink ?? a.providerUrl,
      activityProviderId: a.providerId,
    });
  }
  return slots;
}

/** LLM 일차 맵 → 누락 일자는 템플릿 스톱으로 보강 */
function mergeLlmDaysWithTemplate(
  llmDays: LlmItineraryRoot['days'],
  totalDays: number,
  destination: string,
  activities: ActivityResult[],
): Map<number, DayStop[]> {
  const map = new Map<number, DayStop[]>();
  const middleDays: number[] = [];
  for (let d = 2; d < totalDays; d += 1) middleDays.push(d);

  for (const ld of llmDays) {
    if (ld.day < 1 || ld.day > totalDays) continue;
    const stops = ld.slots.map((s, i) => slotToStop(ld.day, i, s, activities));
    map.set(ld.day, stops);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    if (map.has(day) && (map.get(day)!.length > 0)) continue;

    const isArrival = day === 1;
    const isDeparture = day === totalDays;
    const middleIdx = middleDays.includes(day) ? middleDays.indexOf(day) : 0;

    const fallback = buildStopsForDay({
      destination,
      calendarDay: day,
      middleDayIndex: middleIdx,
      isArrival,
      isDeparture,
      activities,
    });
    map.set(day, fallback);
  }

  return map;
}

function validateLlmCoverage(map: Map<number, DayStop[]>, totalDays: number): boolean {
  for (let d = 1; d <= totalDays; d += 1) {
    const stops = map.get(d);
    if (!stops || stops.length === 0) return false;
  }
  return true;
}

export function assembleDayPlansFromLlm(
  llm: LlmItineraryRoot,
  ctx: {
    destination: string;
    dateFrom: string;
    totalDays: number;
    hotels: StayResult[];
    activities: ActivityResult[];
    hotelBudgetBand?: string | null;
    travelPace?: string | null;
    companionType?: string | null;
  },
): DayPlan[] {
  const {
    destination,
    dateFrom,
    totalDays,
    hotels,
    activities,
    hotelBudgetBand,
    travelPace,
    companionType,
  } = ctx;

  const pace = inferPace(travelPace);
  const fromMs = new Date(dateFrom).getTime();
  const toDate = (offset: number) => {
    if (Number.isNaN(fromMs)) return dateFrom;
    return new Date(fromMs + offset * 86400_000).toISOString().slice(0, 10);
  };

  const primaryHotel = hotels[0];
  const altHotels = hotels.slice(1, 3);
  const middleDays: number[] = [];
  for (let d = 2; d < totalDays; d += 1) middleDays.push(d);

  const stopMap = mergeLlmDaysWithTemplate(llm.days, totalDays, destination, activities);
  if (!validateLlmCoverage(stopMap, totalDays)) {
    throw new Error('INVALID_LLM_STOPS');
  }

  const dayPlans: DayPlan[] = [];

  for (let day = 1; day <= totalDays; day += 1) {
    const date = toDate(day - 1);
    const isArrival = day === 1;
    const isDeparture = day === totalDays;

    const hotelsForDay =
      !isDeparture && primaryHotel
        ? stayOptionsFromSchema(day, totalDays, isArrival, primaryHotel, altHotels, destination)
        : [];

    const stops = stopMap.get(day) ?? [];

    const activitySlots = stopsToActivitySlots(stops, activities, day, pace);

    const title = isArrival
      ? `${destination} 도착 & 체크인`
      : isDeparture
        ? '체크아웃 & 귀국'
        : `${destination} 관광·체험`;

    const move = isArrival
      ? '공항(또는 역) → 숙소'
      : isDeparture
        ? '숙소 → 공항(또는 역)'
        : '숙소 기준 · 당일 코스';

    const bookableLabels = stops.filter(s => s.kind === 'bookable').map(s => s.label);
    const highlightParts = [
      bookableLabels.length
        ? `예약 연계: ${bookableLabels.join(' · ')}`
        : middleDays.includes(day)
          ? '자유·예약 슬롯을 조합한 일정입니다.'
          : null,
      hotelBudgetBand ? `호텔 예산: ${hotelBudgetBand}` : null,
      travelPace ? `여행 속도: ${travelPace}` : null,
      companionType ? `동행: ${companionType}` : null,
    ].filter(Boolean) as string[];

    dayPlans.push({
      day,
      date,
      title,
      move,
      highlight: highlightParts.join(' · ') || '일정 확정 전까지 항목 삭제/교체 가능합니다.',
      stops,
      hotels: hotelsForDay,
      activities: activitySlots,
    });
  }

  return dayPlans;
}

export interface ItineraryLlmResult {
  ok: boolean;
  dayPlans: DayPlan[];
  source: 'llm' | 'template';
  error?: string;
}

/**
 * DeepSeek Flash(json_object)로 일정 생성 → 검증 → MRT 병합. 실패 시 기존 템플릿 buildDayPlans.
 */
export async function generateDayPlansWithLlmOrFallback(params: {
  destination: string;
  dateFrom: string;
  nights: number;
  hotels: StayResult[];
  activities: ActivityResult[];
  hotelBudgetBand?: string | null;
  travelPace?: string | null;
  companionType?: string | null;
  userMessage: string;
}): Promise<ItineraryLlmResult> {
  const {
    destination,
    dateFrom,
    nights,
    hotels,
    activities,
    hotelBudgetBand,
    travelPace,
    companionType,
    userMessage,
  } = params;

  const safeNights = Number.isFinite(nights) && nights > 0 ? Math.floor(nights) : 1;
  const totalDays = Math.max(2, safeNights + 1);

  const catalogLines = activities.slice(0, 24).map((a, i) => {
    return `${i + 1}. providerId="${a.providerId}" name="${a.name.replace(/"/g, "'")}" price=${a.price}`;
  });

  const systemPrompt = `당신은 한국어 여행 일정 설계자입니다. 반드시 JSON만 출력하세요. 마크다운·설명 금지.

규칙:
- 총 ${totalDays}일 일정이며 day는 1부터 ${totalDays}까지 각각 정확히 한 번씩 포함.
- 1일차: 도착·입국·체크인 중심 (가벼운 슬롯).
- ${totalDays}일차: 체크아웃·공항(또는 역) 출발·귀국 중심.
- 중간 일차(2 ~ ${totalDays - 1}): 현지 관광·시장·랜드마크·반나절/종일 코스를 오전·오후·저녁 등 timeHint로 나눔.
- 여행 속도가 "여유"면 슬롯 수를 과하지 않게, "빡빡"이면 알차게.
- 아래 「예약 가능 투어 카탈로그」에 있는 상품을 일정에 넣을 경우, 해당 슬롯에 정확한 mrtProviderId 문자열을 넣으세요. 없으면 생략(자유 관광).
- 카탈로그에 없는 장소는 자유 슬롯으로만 서술 (지어낸 providerId 금지).`;

  const userPrompt = JSON.stringify({
    destination,
    dateFrom,
    nights: safeNights,
    totalDays,
    hotelBudgetBand: hotelBudgetBand ?? null,
    travelPace: travelPace ?? null,
    companionType: companionType ?? null,
    userRequest: userMessage.slice(0, 2000),
    mrtTourCatalog: catalogLines.join('\n'),
  });

  const raw = await llmCall<unknown>({
    task: 'free-travel-itinerary',
    systemPrompt,
    userPrompt,
    jsonSchema: JsonSchemaForLlm as unknown as object,
    maxTokens: 4096,
    temperature: 0.35,
    autoEscalate: false,
  });

  if (!raw.success || raw.data == null) {
    return {
      ok: true,
      dayPlans: buildDayPlans({
        destination,
        dateFrom,
        nights: safeNights,
        hotels,
        activities,
        hotelBudgetBand,
        travelPace,
      }),
      source: 'template',
      error: raw.errors?.join('; ') ?? 'LLM_FAILED',
    };
  }

  const parsed = LlmItineraryRootSchema.safeParse(raw.data);
  if (!parsed.success) {
    return {
      ok: true,
      dayPlans: buildDayPlans({
        destination,
        dateFrom,
        nights: safeNights,
        hotels,
        activities,
        hotelBudgetBand,
        travelPace,
      }),
      source: 'template',
      error: 'ZOD_INVALID',
    };
  }

  const byDay = new Map<number, LlmItineraryRoot['days'][0]>();
  for (const d of parsed.data.days) {
    byDay.set(d.day, d);
  }
  if (byDay.size !== totalDays) {
    return {
      ok: true,
      dayPlans: buildDayPlans({
        destination,
        dateFrom,
        nights: safeNights,
        hotels,
        activities,
        hotelBudgetBand,
        travelPace,
      }),
      source: 'template',
      error: 'DAY_COUNT_MISMATCH',
    };
  }

  const orderedDays: LlmItineraryRoot['days'] = [];
  for (let i = 1; i <= totalDays; i += 1) {
    const row = byDay.get(i);
    if (!row) {
      return {
        ok: true,
        dayPlans: buildDayPlans({
          destination,
          dateFrom,
          nights: safeNights,
          hotels,
          activities,
          hotelBudgetBand,
          travelPace,
        }),
        source: 'template',
        error: 'MISSING_DAY',
      };
    }
    orderedDays.push(row);
  }

  const llmRoot: LlmItineraryRoot = { days: orderedDays };

  try {
    const dayPlans = assembleDayPlansFromLlm(llmRoot, {
      destination,
      dateFrom,
      totalDays,
      hotels,
      activities,
      hotelBudgetBand,
      travelPace,
      companionType,
    });
    return { ok: true, dayPlans, source: 'llm' };
  } catch {
    return {
      ok: true,
      dayPlans: buildDayPlans({
        destination,
        dateFrom,
        nights: safeNights,
        hotels,
        activities,
        hotelBudgetBand,
        travelPace,
      }),
      source: 'template',
      error: 'ASSEMBLE_FAILED',
    };
  }
}
