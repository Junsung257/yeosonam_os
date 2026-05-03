import type { ActivityResult, StayResult } from '@/lib/travel-providers/types';
import { buildStopsForDay, type BuiltStop } from '@/lib/free-travel/itinerary-templates';

export type DayStop = BuiltStop;

export interface DayHotelOption {
  type: 'recommended' | 'alternative';
  name: string;
  pricePerNight: number;
  location?: string;
  reason: string;
  affiliateLink?: string;
}

export interface DayActivitySlot {
  title: string;
  price: number;
  reason: string;
  affiliateLink?: string;
  activityProviderId?: string;
}

export interface DayPlan {
  day: number;
  date: string;
  /** UI: `N일차 · title` 형태로 붙이므로 여기엔 일차 번호 없음 */
  title: string;
  move: string;
  highlight: string;
  /** 일자별 코스(자유 관광 + 예약 가능 투어 슬롯) */
  stops: DayStop[];
  hotels: DayHotelOption[];
  /** 예약 가능한 MRT 슬롯만 (일정표와 동기화) */
  activities: DayActivitySlot[];
}

function stayOptionsForLodgingDay(params: {
  day: number;
  totalDays: number;
  isArrival: boolean;
  primaryHotel: StayResult | undefined;
  altHotels: StayResult[];
  destination: string;
}): DayHotelOption[] {
  const { day, totalDays, isArrival, primaryHotel, altHotels, destination } = params;
  const hotelsForDay: DayHotelOption[] = [];
  if (!primaryHotel) return hotelsForDay;

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

function activitySlotFromStop(
  stop: DayStop,
  a: ActivityResult,
  day: number,
  pace: 'fast' | 'relaxed' | 'normal',
): DayActivitySlot {
  const paceNote =
    pace === 'fast' ? '이동·체험 위주' : pace === 'relaxed' ? '여유 있게' : '동선·체류 반영';
  return {
    title: a.name,
    price: a.price,
    reason: `${day}일차 ${stop.timeHint} — 일정표 「${stop.label}」에 맞춘 예약 가능 코스 (${paceNote})`,
    affiliateLink: a.affiliateLink ?? a.providerUrl,
    activityProviderId: a.providerId,
  };
}

function inferPace(travelPace: string | null | undefined): 'fast' | 'relaxed' | 'normal' {
  if (!travelPace) return 'normal';
  if (/빡|빽|촘|다이나믹|몰아|빼빼|하루에\s*많/i.test(travelPace)) return 'fast';
  if (/여유|느긋|천천|휴양|루즈/i.test(travelPace)) return 'relaxed';
  return 'normal';
}

function stopsToActivitySlots(
  stops: DayStop[],
  activities: ActivityResult[],
  day: number,
  pace: 'fast' | 'relaxed' | 'normal',
): DayActivitySlot[] {
  const slots: DayActivitySlot[] = [];
  const byId = new Map(activities.map(a => [a.providerId, a]));
  for (const s of stops) {
    if (s.kind !== 'bookable' || !s.activityProviderId) continue;
    const a = byId.get(s.activityProviderId);
    if (a) slots.push(activitySlotFromStop(s, a, day, pace));
  }

  if (pace === 'fast' && activities.length > 1 && slots.length === 1) {
    const used = new Set(slots.map(x => x.activityProviderId));
    const extra = activities.find(a => !used.has(a.providerId));
    if (extra) {
      slots.push({
        title: extra.name,
        price: extra.price,
        reason: `${day}일차 추가 코스 — 체력 여유 시 반나절 투어`,
        affiliateLink: extra.affiliateLink ?? extra.providerUrl,
        activityProviderId: extra.providerId,
      });
    }
  }

  return slots;
}

/** 일정표에 포함된 예약형 투어(providerId 유니크) 기준 견적 합계 */
export function computeActivityEstimateFromDayPlans(dayPlans: DayPlan[], adults: number): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const d of dayPlans) {
    for (const s of d.stops) {
      if (s.kind !== 'bookable' || !s.activityProviderId || seen.has(s.activityProviderId)) continue;
      seen.add(s.activityProviderId);
      sum += (s.priceHint ?? 0) * Math.max(1, adults);
    }
  }
  return sum;
}

export function buildDayPlans(input: {
  destination: string;
  dateFrom: string;
  nights: number;
  hotels: StayResult[];
  activities: ActivityResult[];
  hotelBudgetBand?: string | null;
  travelPace?: string | null;
}): DayPlan[] {
  const {
    destination,
    dateFrom,
    nights,
    hotels,
    activities,
    hotelBudgetBand,
    travelPace,
  } = input;

  const safeNights = Number.isFinite(nights) && nights > 0 ? Math.floor(nights) : 1;
  const totalDays = Math.max(2, safeNights + 1);
  const pace = inferPace(travelPace);

  const fromMs = new Date(dateFrom).getTime();
  const toDate = (offset: number) => {
    if (Number.isNaN(fromMs)) return dateFrom;
    return new Date(fromMs + offset * 86400_000).toISOString().slice(0, 10);
  };

  const primaryHotel = hotels[0];
  const altHotels = hotels.slice(1, 3);

  const middleDays: number[] = [];
  for (let d = 2; d < totalDays; d += 1) {
    middleDays.push(d);
  }

  const dayPlans: DayPlan[] = [];

  for (let day = 1; day <= totalDays; day += 1) {
    const date = toDate(day - 1);
    const isArrival = day === 1;
    const isDeparture = day === totalDays;
    const isMiddle = middleDays.includes(day);
    const middleIdx = isMiddle ? middleDays.indexOf(day) : -1;

    let hotelsForDay: DayHotelOption[] = [];
    if (!isDeparture && primaryHotel) {
      hotelsForDay = stayOptionsForLodgingDay({
        day,
        totalDays,
        isArrival,
        primaryHotel,
        altHotels,
        destination,
      });
    }

    let stops: DayStop[] = [];
    if (isMiddle && middleIdx >= 0) {
      stops = buildStopsForDay({
        destination,
        calendarDay: day,
        middleDayIndex: middleIdx,
        isArrival: false,
        isDeparture: false,
        activities,
      });
    } else if (isArrival) {
      stops = buildStopsForDay({
        destination,
        calendarDay: day,
        middleDayIndex: 0,
        isArrival: true,
        isDeparture: false,
        activities,
      });
    } else if (isDeparture) {
      stops = buildStopsForDay({
        destination,
        calendarDay: day,
        middleDayIndex: 0,
        isArrival: false,
        isDeparture: true,
        activities,
      });
    }

    let activitySlots = stopsToActivitySlots(stops, activities, day, pace);

    if (isArrival && middleDays.length === 0 && activities.length > 0 && activitySlots.length === 0) {
      const a = activities[0];
      activitySlots = [
        {
          title: a.name,
          price: a.price,
          reason: '짧은 체류 — 도착일·귀국일 사이 예약 가능 코스',
          affiliateLink: a.affiliateLink ?? a.providerUrl,
          activityProviderId: a.providerId,
        },
      ];
      stops = [
        ...stops,
        {
          id: `${day}-tour`,
          timeHint: '오후',
          label: a.name,
          kind: 'bookable',
          activityProviderId: a.providerId,
          priceHint: a.price,
        },
      ];
    }

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
        ? `예약 연계 추천: ${bookableLabels.join(' · ')}`
        : isMiddle
          ? '자유 관광 위주 일정 — 마음에 드는 투어만 아래에서 골라 예산에 반영하세요.'
          : null,
      hotelBudgetBand ? `호텔 예산: ${hotelBudgetBand}` : null,
      travelPace ? `여행 속도: ${travelPace}` : null,
    ].filter(Boolean) as string[];

    const highlight =
      highlightParts.join(' · ') || '일정 확정 전까지 항목 삭제/교체 가능합니다.';

    dayPlans.push({
      day,
      date,
      title,
      move,
      highlight,
      stops,
      hotels: hotelsForDay,
      activities: activitySlots,
    });
  }

  return dayPlans;
}
