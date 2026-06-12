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

describe('Baekdu landing regression guards', () => {
  it('cleans Shizuoka-style region and meal connector fragments before mobile landing render', () => {
    const compiled = compileItineraryForLanding({
      days: [
        {
          day: 1,
          regions: ['\uBD80\uC0B0', '\uC2DC\uC988\uC624\uCE74', '\uCE74\uC640\uAD6C\uCE58'],
          schedule: [
            { activity: '\uC2DC\uC988\uC624\uCE74', type: 'normal' },
            { activity: '\uCE74\uC640\uAD6C\uCE58', type: 'normal' },
            { activity: '\uBD80\uC0B0 \uAE40\uD574 \uAD6D\uC81C \uACF5\uD56D 2\uCE35 \uC9D1\uACB0', type: 'normal' },
            { activity: '\uC911\uC2DD \uD6C4', type: 'normal' },
            { activity: '\uB2C8\uD63C\uB2E4\uC774\uB77C \uB85C\uD504\uC6E8\uC774 \uC655\uBCF5\uD0D1\uC2B9', type: 'normal' },
            { activity: '\uD638\uD154\uC548\uB0B4 \uBC0F \uC11D\uC2DD \uD6C4 \uC628\uCC9C\uD734\uC2DD\u2668', type: 'hotel' },
          ],
        },
      ],
    });

    const labels = compiled.days[0].schedule.map(item => (
      (item as { landing_sentence?: string | null }).landing_sentence ?? item.activity
    ));

    expect(labels).not.toContain('\uC2DC\uC988\uC624\uCE74');
    expect(labels).not.toContain('\uCE74\uC640\uAD6C\uCE58');
    expect(labels).not.toContain('\uC911\uC2DD \uD6C4');
    expect(labels).toContain('\uD638\uD154\uB85C \uC774\uB3D9\uD574 \uC11D\uC2DD \uD6C4 \uD734\uC2DD\uD558\uBA70 \uC628\uCC9C\uC695\uC744 \uC990\uAE41\uB2C8\uB2E4.');
  });

  it('removes route-only and table-noise fragments from landing schedules', () => {
    const compiled = compileItineraryForLanding({
      days: [
        {
          day: 1,
          schedule: [
            { activity: '\uC5F0 \uAE38', type: 'normal' },
            { activity: '\uC804\uC77C', type: 'normal' },
            { activity: '\uBB34\uC81C\uD55C', type: 'normal' },
            { activity: '\uAE40\uD574 \uAD6D\uC81C\uACF5\uD56D \uBBF8\uD305', type: 'normal' },
          ],
        },
      ],
    });

    expect(compiled.days[0].schedule.map(item => item.activity)).toEqual([
      '\uAE40\uD574 \uAD6D\uC81C\uACF5\uD56D \uBBF8\uD305',
    ]);
  });

  it('does not turn Baekdu transfer and massage service lines into attraction cards', () => {
    const move = compileScheduleItemForLanding({
      activity: '\uC5F0\uAE38\uB85C \uC774\uB3D9 (2\uC2DC\uAC04 \uC18C\uC694)',
      type: 'normal',
    });
    const massage = compileScheduleItemForLanding({
      activity: '\uC5EC\uD589\uC758 \uD53C\uB85C\uB97C \uD480\uC5B4\uC8FC\uB294 \uC804\uC2E0+\uBC1C\uB9C8\uC0AC\uC9C0 90\uBD84 (\uB9E4\uB108\uD301 \uBCC4\uB3C4)',
      type: 'normal',
    });

    expect(move.entity_kind).toBe('transfer');
    expect(move.attraction_query).toBeNull();
    expect(move.landing_sentence).toBe('\uC5F0\uAE38\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4.');
    expect(massage.entity_kind).toBe('perk');
    expect(massage.attraction_query).toBeNull();
    expect(massage.service_name).toBe('\uC804\uC2E0+\uBC1C\uB9C8\uC0AC\uC9C0');
    expect(massage.service_detail).toBe('90\uBD84 / \uB9E4\uB108\uD301 \uBCC4\uB3C4');
    expect(massage.landing_sentence).toBe('\uC804\uC2E0+\uBC1C\uB9C8\uC0AC\uC9C0 90\uBD84\uC73C\uB85C \uC5EC\uD589\uC758 \uD53C\uB85C\uB97C \uD480\uC5B4\uBD05\uB2C8\uB2E4. \uB9E4\uB108\uD301\uC740 \uBCC4\uB3C4\uC785\uB2C8\uB2E4.');
  });

  it('classifies included hot spring value items as perk instead of hotel stay', () => {
    const hotSpring = compileScheduleItemForLanding({
      activity: '$50 \uC0C1\uB2F9 \uD2B9\uAE09\uD638\uD154 \uC628\uCC9C\uC695 \uCCB4\uD5D8(\uC218\uC601\uBCF5 \uAC1C\uBCC4\uC9C0\uCC38)',
      type: 'normal',
    });
    const hotelRest = compileScheduleItemForLanding({
      activity: '\uD638\uD154 \uC774\uB3D9 \uD6C4 \uC11D\uC2DD \uBC0F \uD734\uC2DD, \uC628\uCC9C\uC695',
      type: 'hotel',
    });

    expect(hotSpring.entity_kind).toBe('perk');
    expect(hotSpring.service_name).toBe('\uC628\uCC9C\uC695');
    expect(hotSpring.service_detail).toBe('\uC218\uC601\uBCF5 \uAC1C\uBCC4\uC9C0\uCC38');
    expect(hotelRest.entity_kind).toBe('hotel_stay');
  });

  it('reclassifies stale flight and hotel-like labels before mobile landing render', () => {
    const baekduCheonji = compileScheduleItemForLanding({
      activity: '\u0031\u0034\u0034\u0032\uACC4\uB2E8 \uB4F1\uC815 \uB8E8 \uBC31\uB450\uC0B0 \uCC9C\uC9C0 \uAD00\uAD11',
      type: 'flight',
    });
    const hotel = compileScheduleItemForLanding({
      activity: '\uAD00\uB78C\uB300\uC8FC\uC810 \uB610\uB294 \uB3D9\uAE09 (\uC900\u0035\uC131)',
      type: 'normal',
    });
    const meal = compileScheduleItemForLanding({
      activity: '\uAFC8\uBC14\uB85C\uC6B0',
      type: 'normal',
    });

    expect(baekduCheonji.entity_kind).toBe('attraction_visit');
    expect(baekduCheonji.type).toBe('normal');
    expect(baekduCheonji.attraction_query).toBe('\uBC31\uB450\uC0B0 \uCC9C\uC9C0');
    expect(hotel.entity_kind).toBe('hotel_stay');
    expect(hotel.attraction_query).toBeNull();
    expect(meal.entity_kind).toBe('meal');
  });

  it('blocks cross-region attraction IDs and short substring matches in Baekdu lines', () => {
    const compiled = compileItineraryForLanding({
      days: [
        {
          day: 3,
          schedule: [
            {
              activity: '\uC138\uACC4\uC5D0\uC11C \uAC00\uC7A5 \uAE34 \uB192\uC774 68M \uD654\uC0B0\uD3ED\uD3EC, \uC77C\uB144\uB0B4\uB0B4 \uC5BC\uC9C0\uC54A\uB294 \uC7A5\uBC31\uD3ED\uD3EC',
              type: 'normal',
              attraction_ids: ['huashan'],
              attraction_names: ['\uD654\uC0B0'],
            },
            {
              activity: '\uC5EC\uD589\uC758 \uD53C\uB85C\uB97C \uD480\uC5B4\uC8FC\uB294 \uC804\uC2E0+\uBC1C\uB9C8\uC0AC\uC9C0 90\uBD84',
              type: 'normal',
            },
          ],
        },
      ],
    });

    const result = enrichItineraryWithAttractionReferences(
      compiled,
      [
        { id: 'huashan', name: '\uD654\uC0B0', region: '\uC11C\uC548,\uD654\uC0B0', short_desc: 'xian' },
        { id: 'bohol-massage', name: '\uC804\uD1B5\uC624\uC77C\uB9C8\uC0AC\uC9C0', region: '\uBCF4\uD640', country: 'PH', aliases: ['\uC804\uC2E0\uB9C8\uC0AC\uC9C0', '\uB9C8\uC0AC\uC9C0'] },
      ],
      '\uC5F0\uAE38/\uBC31\uB450\uC0B0',
    );

    const schedule = result.itineraryData?.days?.[0]?.schedule ?? [];
    expect(schedule[0].attraction_ids ?? []).toEqual([]);
    expect(schedule[0].attraction_names).toBeUndefined();
    expect(schedule[1].attraction_ids).toBeUndefined();
  });
});
