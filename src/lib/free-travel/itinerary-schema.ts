import type { ActivityResult, StayResult } from '@/lib/travel-providers/types';

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
}

export interface DayPlan {
  day: number;
  date: string;
  title: string;
  move: string;
  highlight: string;
  hotels: DayHotelOption[];
  activities: DayActivitySlot[];
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
  const totalDays = Math.max(2, nights + 1);

  const toDate = (offset: number) =>
    new Date(new Date(dateFrom).getTime() + offset * 86400_000).toISOString().slice(0, 10);

  const primaryHotel = hotels[0];
  const altHotels = hotels.slice(1, 3);
  const dayPlans: DayPlan[] = [];

  for (let day = 1; day <= totalDays; day += 1) {
    const date = toDate(day - 1);
    const isArrival = day === 1;
    const isDeparture = day === totalDays;
    const isActivityDay = day === Math.min(2, totalDays - 1);

    const hotelsForDay: DayHotelOption[] = [];
    if (!isDeparture && primaryHotel) {
      hotelsForDay.push({
        type: 'recommended',
        name: primaryHotel.name,
        pricePerNight: primaryHotel.pricePerNight,
        location: primaryHotel.location,
        reason: isArrival
          ? '도착일 이동 피로를 줄이기 위한 접근성 우선 추천'
          : '동선 안정화를 위한 연박 추천',
        affiliateLink: primaryHotel.affiliateLink ?? primaryHotel.providerUrl,
      });
      for (const alt of altHotels) {
        hotelsForDay.push({
          type: 'alternative',
          name: alt.name,
          pricePerNight: alt.pricePerNight,
          location: alt.location,
          reason: '예산/취향에 따른 대체 숙소',
          affiliateLink: alt.affiliateLink ?? alt.providerUrl,
        });
      }
    }

    const activity = isActivityDay ? activities[0] : undefined;
    const activitySlots: DayActivitySlot[] = activity
      ? [{
          title: activity.name,
          price: activity.price,
          reason: '핵심 관광일에 체류 시간을 고려해 배치한 추천 액티비티',
          affiliateLink: activity.affiliateLink ?? activity.providerUrl,
        }]
      : [];

    dayPlans.push({
      day,
      date,
      title: isArrival
        ? `${destination} 도착 및 체크인`
        : isDeparture
          ? '체크아웃 및 귀국'
          : `${destination} 자유일정`,
      move: isArrival
        ? '공항 → 숙소'
        : isDeparture
          ? '숙소 → 공항'
          : '핵심 관광지 순환 이동',
      highlight: [
        isActivityDay ? '2일차 액티비티 결합형 일정' : null,
        hotelBudgetBand ? `호텔 예산: ${hotelBudgetBand}` : null,
        travelPace ? `여행 속도: ${travelPace}` : null,
      ].filter(Boolean).join(' · ') || '일정 확정 전까지 항목 삭제/교체 가능합니다.',
      hotels: hotelsForDay,
      activities: activitySlots,
    });
  }

  return dayPlans;
}
