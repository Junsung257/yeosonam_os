import { describe, expect, it } from 'vitest';
import { compileItineraryForLanding, compileScheduleItemForLanding } from './itinerary-schedule-compiler';
import { enrichItineraryWithAttractionReferences } from './itinerary-attraction-enricher';
import { mapTravelPackageToLandingData } from './map-travel-package-to-lp';

describe('itinerary schedule landing compiler', () => {
  it('separates attraction query, customer sentence, and transfer lines', () => {
    const yunohana = compileScheduleItemForLanding({ activity: '▶ 유황재배지 유노하나 관광', type: 'normal' });
    const kurokawa = compileScheduleItemForLanding({ activity: '▶ 쿠로가와 온천마을 산책', type: 'normal' });
    const transfer = compileScheduleItemForLanding({ activity: '유후인 이동', type: 'normal' });
    const hotel = compileScheduleItemForLanding({ activity: '호텔 이동 후 석식 및 휴식, ♨온천욕', type: 'hotel' });

    expect(yunohana.entity_kind).toBe('attraction_visit');
    expect(yunohana.attraction_query).toBe('유노하나 재배지');
    expect(kurokawa.landing_sentence).toBe('쿠로가와 온천마을을 산책하며 온천 마을의 분위기를 둘러봅니다.');
    expect(transfer.entity_kind).toBe('transfer');
    expect(transfer.attraction_query).toBeNull();
    expect(transfer.landing_sentence).toBe('유후인으로 이동합니다.');
    expect(hotel.landing_sentence).toBe('호텔로 이동해 석식 후 휴식하며 온천욕을 즐깁니다.');
  });

  it('matches attractions from compiled queries without over-matching movement text', () => {
    const compiled = compileItineraryForLanding({
      days: [
        {
          day: 1,
          schedule: [
            { activity: '유후인 이동', type: 'normal' },
            { activity: '쿠로가와 온천마을 산책', type: 'normal' },
          ],
        },
      ],
    });

    const result = enrichItineraryWithAttractionReferences(
      compiled,
      [
        { id: 'hotel-yufuin', name: '유후인 온센 유후인 고투부키 하나노쇼', short_desc: '호텔', category: 'hotel' },
        { id: 'kurokawa', name: '쿠로가와 온천마을', short_desc: '온천 마을' },
        { id: 'yunohana', name: '유노하나 온천마을', short_desc: '다른 온천 마을' },
      ],
      '후쿠오카',
    );

    const schedule = result.itineraryData?.days?.[0]?.schedule ?? [];
    expect(schedule[0].attraction_ids).toBeUndefined();
    expect(schedule[1].attraction_names).toEqual(['쿠로가와 온천마을']);
  });

  it('feeds landing sentences into mobile landing data', () => {
    const pkg = {
      id: 'pkg-1',
      title: '큐슈 온천 2박3일',
      destination: '후쿠오카',
      duration: 3,
      price: 1299000,
      price_dates: [{ date: '2026-07-01', price: 1299000, confirmed: false }],
      itinerary_data: compileItineraryForLanding({
        days: [
          {
            day: 1,
            regions: ['벳부'],
            meals: { breakfast: false, lunch: true, dinner: true },
            schedule: [
              { activity: '쿠로가와 온천마을 산책', type: 'normal' },
              { activity: '호텔 이동 후 석식 및 휴식, ♨온천욕', type: 'hotel' },
            ],
            hotel: { name: '스기노이 호텔 (니지관)', grade: null, note: null },
          },
        ],
      }),
    };

    const landing = mapTravelPackageToLandingData(pkg, null);
    const labels = landing.itinerary.days[0].activities.map(activity => activity.label);

    expect(labels).toContain('쿠로가와 온천마을을 산책하며 온천 마을의 분위기를 둘러봅니다.');
    expect(labels).toContain('호텔로 이동해 석식 후 휴식하며 온천욕을 즐깁니다.');
  });
});
