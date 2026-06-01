import { describe, expect, it } from 'vitest';
import { mapTravelPackageToLandingData } from './map-travel-package-to-lp';
import { renderPackage } from './render-contract';

describe('mapTravelPackageToLandingData', () => {
  it('CRC 결과를 우선 사용해 LP 데이터를 만든다', () => {
    const pkg = {
      id: 'pkg-1',
      title: '후쿠오카 3일',
      destination: '후쿠오카',
      duration: 3,
      price: 399000,
      products: { internal_code: 'PUS-TEST-0001' },
      price_dates: [
        { date: '2026-05-10', price: 399000, confirmed: true },
        { date: '2026-05-17', price: 459000, confirmed: false },
      ],
      inclusions: ['왕복 항공권', '호텔 2박'],
      excludes: ['가이드 팁', '개인경비'],
      surcharges: [{ name: '연휴', start: '2026-05-05', end: '2026-05-06', amount: 50, currency: 'USD', unit: '인' }],
      itinerary_data: {
        meta: {
          title: '후쿠오카 3일',
          destination: '후쿠오카',
          nights: 2,
          days: 3,
          departure_airport: '부산(김해)',
          airline: '에어부산',
          flight_out: 'BX148',
          flight_in: 'BX149',
          departure_days: '매주 화/목',
          min_participants: 2,
          room_type: '2인 1실',
          ticketing_deadline: '2026-05-01',
          hashtags: [],
          brand: '여소남',
        },
        highlights: {
          inclusions: ['왕복 항공권', '호텔 2박', '일정표 상 관광지'],
          excludes: ['가이드 팁', '개인경비', '의무디너 $20'],
          shopping: '1회',
          remarks: ['출발 7일 전 취소 시 수수료 발생', '현지 사정으로 일정 변경 가능'],
        },
        days: [
          {
            day: 1,
            regions: ['부산', '후쿠오카'],
            meals: { breakfast: false, lunch: false, dinner: true, breakfast_note: null, lunch_note: null, dinner_note: null },
            schedule: [
              { time: '08:25', activity: '김해국제공항 출발', transport: 'BX148', note: null, type: 'flight' },
              { time: '11:00', activity: '다자이후 관광', transport: '전용차량', note: null, type: 'normal' },
              { time: '18:00', activity: '호텔 투숙 및 휴식', transport: null, note: '시내 4성급', type: 'hotel' },
            ],
            hotel: { name: '하카타 호텔', grade: '4성', note: null },
          },
          {
            day: 2,
            regions: ['후쿠오카', '부산'],
            meals: { breakfast: true, lunch: false, dinner: false, breakfast_note: null, lunch_note: null, dinner_note: null },
            schedule: [
              { time: '19:55', activity: '후쿠오카 출발 → 부산 도착', transport: 'BX149', note: null, type: 'flight' },
            ],
            hotel: null,
          },
        ],
        optional_tours: [{ name: '야경 투어', price_usd: 30, price_krw: null, note: null }],
      },
    } as const;

    const view = renderPackage(pkg as unknown as Parameters<typeof renderPackage>[0]);
    const mapped = mapTravelPackageToLandingData(pkg as unknown as Record<string, unknown>, null);

    expect(mapped.internalCode).toBe('PUS-TEST-0001');
    expect(mapped.itinerary.includes).toEqual(view.inclusions.flat);
    expect(mapped.itinerary.excludes).toEqual(view.excludes.basic);
    expect(mapped.itinerary.legalNotices).toEqual(['출발 7일 전 취소 시 수수료 발생', '현지 사정으로 일정 변경 가능']);
    expect(mapped.itinerary.days).toHaveLength(view.days.length);

    const day1 = mapped.itinerary.days[0];
    expect(day1.activities.some((a) => a.type === 'hotel' && a.label.includes('하카타 호텔'))).toBe(true);
    expect(day1.activities.some((a) => a.type === 'flight')).toBe(true);
  });
  it('filters supplier table fragments from mobile landing activities', () => {
    const pkg = {
      id: 'pkg-baekdu',
      title: '\uC5F0\uAE38/\uBC31\uB450\uC0B0(\uBD81\uD30C) 2\uBC153\uC77C',
      destination: '\uC5F0\uAE38/\uBC31\uB450\uC0B0',
      duration: 3,
      price: 749000,
      price_dates: [{ date: '2026-06-01', price: 999000, confirmed: true }],
      inclusions: [],
      excludes: [],
      itinerary_data: {
        meta: { title: '\uC5F0\uAE38/\uBC31\uB450\uC0B0(\uBD81\uD30C) 2\uBC153\uC77C', destination: '\uC5F0\uAE38/\uBC31\uB450\uC0B0', days: 3 },
        highlights: { inclusions: [], excludes: [], remarks: [] },
        days: [
          {
            day: 1,
            regions: ['\uBD80\uC0B0'],
            meals: { breakfast: false, lunch: true, dinner: true },
            schedule: [
              { activity: '\uC5F0  \uAE38', type: 'normal' },
              { activity: 'BX337', type: 'flight' },
              { activity: '\uC804\uC6A9\uCC28\uB7C9', type: 'normal' },
              { activity: '06:30', type: 'normal' },
              { activity: '\uC911:\uB0C9\uBA74', type: 'normal' },
              { activity: '\uAE40\uD574 \uAD6D\uC81C\uACF5\uD56D \uBBF8\uD305', type: 'normal' },
              {
                activity: '\uBC31\uB450\uC0B0 \uCC9C\uC9C0 \uAD00\uAD11',
                type: 'normal',
                attraction_names: ['\uBC31\uB450\uC0B0 \uCC9C\uC9C0'],
              },
            ],
          },
        ],
      },
    };

    const mapped = mapTravelPackageToLandingData(pkg as unknown as Record<string, unknown>, null);
    const labels = mapped.itinerary.days[0].activities.map(a => a.label);

    expect(labels).not.toContain('\uC5F0  \uAE38');
    expect(labels).not.toContain('BX337');
    expect(labels).not.toContain('\uC804\uC6A9\uCC28\uB7C9');
    expect(labels).not.toContain('06:30');
    expect(labels).not.toContain('\uC911:\uB0C9\uBA74');
    expect(labels).toContain('\uAE40\uD574 \uAD6D\uC81C\uACF5\uD56D \uBBF8\uD305');
    expect(labels).toContain('\uBC31\uB450\uC0B0 \uCC9C\uC9C0 \uAD00\uAD11');
  });
});
