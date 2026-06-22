import { describe, expect, it } from 'vitest';
import { normalizeUploadItinerary } from './itinerary-normalization';

describe('normalizeUploadItinerary', () => {
  it('fills empty schedule days from the original day table before customer render', async () => {
    const result = await normalizeUploadItinerary({
      destination: '푸꾸옥',
      durationDays: 6,
      activeAttractions: [],
      productRawText: [
        '제1일 에스츄리CC 18홀 라운딩 *클럽식 포함',
        '제2일 호텔 조식 후 골프장으로 이동',
        '빈펄CC 18홀 라운딩',
        '제3일 호텔 조식 후 골프장으로 이동',
        '빈펄CC 18홀 라운딩',
        '제4일 호텔 조식 후 골프장으로 이동',
        '에스츄리CC 18홀 라운딩 *클럽식 포함',
        '제5일 공항으로 이동',
        '제6일 부산 도착',
      ].join('\n'),
      itineraryData: {
        days: [
          { day: 1, schedule: [{ type: 'normal', activity: '에스츄리CC 18홀 라운딩 *클럽식 포함' }] },
          { day: 2, schedule: [] },
          { day: 3, schedule: [] },
          { day: 4, schedule: [] },
          { day: 5, schedule: [{ type: 'transfer', activity: '공항으로 이동' }] },
          { day: 6, schedule: [{ type: 'flight', activity: '부산 도착' }] },
        ],
      },
    });

    const days = result.itineraryDataToSave?.days ?? [];
    expect(days.find(day => day.day === 2)?.schedule?.map(item => item.activity)).toContain('빈펄CC 18홀 라운딩');
    expect(days.find(day => day.day === 3)?.schedule?.map(item => item.activity)).toContain('빈펄CC 18홀 라운딩');
    expect(days.find(day => day.day === 4)?.schedule?.map(item => item.activity)).toContain('에스츄리CC 18홀 라운딩 *클럽식 포함');
    expect(result.warnings.some(warning => warning.includes('empty itinerary day schedule filled'))).toBe(true);
  });

  it('post-processes itinerary and returns attraction candidate rows outside the route', async () => {
    const result = await normalizeUploadItinerary({
      destination: '괌',
      activeAttractions: [],
      productRawText: '쇼핑센터\n잡화점 1회\n비고',
      itineraryData: {
        days: [{
          day: 1,
          schedule: [
            { type: 'activity', activity: '비원 리조트 관광', note: null },
            { type: 'flight', activity: '부산 출발', note: null },
          ],
        }],
      } as never,
    });

    expect(result.fallbackApplied).toBe(false);
    expect(result.scheduleItemCount).toBe(1);
    expect((result.itineraryDataToSave?.highlights as { shopping?: string } | undefined)?.shopping).toBe('쇼핑센터 잡화점 1회');
    expect(result.extractedCandidateRows.some(row => row.activity.includes('비원 리조트'))).toBe(true);
  });

  it('promotes standalone meal and hotel schedule tokens into structured day fields', async () => {
    const result = await normalizeUploadItinerary({
      destination: '연길/백두산',
      activeAttractions: [],
      productRawText: [
        '제1일',
        '중:냉면+',
        '꿔바로우',
        '석:샤브샤브',
        '무제한',
        '󰆹 풀만호텔 또는 동급 (5성)',
      ].join('\n'),
      itineraryData: {
        days: [{
          day: 1,
          schedule: [
            { type: 'normal', activity: '두만강 강변공원 관광', entity_kind: 'attraction_visit' },
            { type: 'normal', activity: '중식 후 도문으로 이동 (1시간30분 소요)', entity_kind: 'transfer' },
            { type: 'normal', activity: '호텔 조식 후 백두산 남파로 이동 (2시간 소요)', entity_kind: 'transfer' },
            { type: 'normal', activity: '꿔바로우', entity_kind: 'meal' },
            { type: 'hotel', activity: '풀만호텔 또는 동급 (5성)', entity_kind: 'hotel_stay' },
          ],
        }],
      } as never,
    });

    const day = result.itineraryDataToSave?.days?.[0] as {
      schedule?: Array<{ activity?: string }>;
      meals?: {
        breakfast?: boolean;
        lunch?: boolean;
        dinner?: boolean;
        breakfast_note?: string | null;
        lunch_note?: string | null;
        dinner_note?: string | null;
      };
      hotel?: { name?: string | null; grade?: string | null };
    };
    const activities = (day.schedule ?? []).map(item => item.activity);
    expect(activities).not.toContain('꿔바로우');
    expect(activities).not.toContain('풀만호텔 또는 동급 (5성)');
    expect(activities).toContain('도문으로 이동 (1시간30분 소요)');
    expect(activities).toContain('백두산 남파로 이동 (2시간 소요)');
    expect(day.meals?.breakfast).toBe(true);
    expect(day.meals?.breakfast_note).toBe('호텔식');
    expect(day.meals?.lunch).toBe(true);
    expect(day.meals?.lunch_note).toBe('냉면 + 꿔바로우');
    expect(day.meals?.dinner).toBe(true);
    expect(day.meals?.dinner_note).toBe('샤브샤브 무제한');
    expect(day.hotel?.name).toBe('풀만호텔 또는 동급');
    expect(day.hotel?.grade).toBe('5성');
  });
  it('collapses repeated day ranges before customer render when duration bounds the itinerary', async () => {
    const result = await normalizeUploadItinerary({
      destination: '푸꾸옥',
      durationDays: 6,
      activeAttractions: [],
      productRawText: '푸꾸옥 4박6일',
      itineraryData: {
        days: [
          { day: 1, schedule: [{ type: 'flight', activity: '부산 출발' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '빈원더스 관광' }] },
          { day: 3, schedule: [{ type: 'activity', activity: '혼똔섬 케이블카' }] },
          { day: 4, schedule: [{ type: 'activity', activity: '호국사 관광' }] },
          { day: 5, schedule: [{ type: 'free_time', activity: '리조트 자유시간' }] },
          { day: 6, schedule: [{ type: 'flight', activity: '부산 도착' }] },
          { day: 1, schedule: [{ type: 'flight', activity: '부산 출발' }, { type: 'activity', activity: '가이드 미팅' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '빈원더스 관광' }, { type: 'meal', activity: '중식' }] },
          { day: 3, schedule: [{ type: 'activity', activity: '혼똔섬 케이블카' }] },
          { day: 4, schedule: [{ type: 'activity', activity: '호국사 관광' }] },
          { day: 5, schedule: [{ type: 'free_time', activity: '리조트 자유시간' }] },
          { day: 6, schedule: [{ type: 'flight', activity: '부산 도착' }] },
        ],
      } as never,
    });

    const days = result.itineraryDataToSave?.days ?? [];
    expect(days.map(day => day.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(days).toHaveLength(6);
    expect(result.warnings).toContain('duplicate itinerary days collapsed: day 1, 2, 3, 4, 5, 6');
  });

  it('prunes out-of-range price-table days before duplicate day repair', async () => {
    const result = await normalizeUploadItinerary({
      destination: '서안',
      durationDays: 6,
      activeAttractions: [],
      productRawText: '서안 구채구 4박6일',
      itineraryData: {
        days: [
          {
            day: 25,
            schedule: [
              { type: 'normal', activity: '4박 6일' },
              { type: 'normal', activity: '4 18 - 1,369,000' },
              { type: 'normal', activity: '5 2 1,369,000 1,399,000' },
              { type: 'normal', activity: 'OR' },
            ],
          },
          { day: 1, schedule: [{ type: 'flight', activity: 'BX341 21:55 부산 출발' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '구채구 관광' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '구채구 관광' }, { type: 'meal', activity: '중식' }] },
          { day: 3, schedule: [{ type: 'activity', activity: '황룡 관광' }] },
          { day: 4, schedule: [{ type: 'activity', activity: '신선지 관광' }] },
          { day: 5, schedule: [{ type: 'activity', activity: '서안 이동' }] },
          { day: 6, schedule: [{ type: 'flight', activity: 'BX342 06:30 부산 도착' }] },
        ],
      } as never,
    });

    const days = result.itineraryDataToSave?.days ?? [];
    expect(days.map(day => day.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.warnings).toContain('out-of-range polluted itinerary days pruned: day 25');
    expect(result.warnings).toContain('duplicate itinerary days collapsed: day 2');
  });

  it('prunes Korean price/admin and sparse numeric rows misread as late itinerary days', async () => {
    const result = await normalizeUploadItinerary({
      destination: '서안',
      durationDays: 5,
      activeAttractions: [],
      productRawText: '서안 상품가 및 일정표',
      itineraryData: {
        days: [
          { day: 1, schedule: [{ type: 'flight', activity: 'BX341 부산 출발' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '소림사 관광' }] },
          { day: 3, schedule: [{ type: 'activity', activity: '용문석굴 관광' }] },
          { day: 4, schedule: [{ type: 'activity', activity: '운대산 관광' }] },
          { day: 5, schedule: [{ type: 'flight', activity: 'BX342 부산 도착' }] },
          {
            day: 25,
            schedule: [
              { type: 'normal', activity: '5월 9, 16일 1,029,000' },
              { type: 'normal', activity: '3월 30일(월)까지 항공권 발권하는 조건입니다.' },
            ],
          },
          {
            day: 10,
            schedule: [
              { type: 'normal', activity: '314M' },
              { type: 'normal', activity: ':' },
            ],
          },
        ],
      } as never,
    });

    const days = result.itineraryDataToSave?.days ?? [];
    expect(days.map(day => day.day)).toEqual([1, 2, 3, 4, 5]);
    expect(result.warnings).toContain('out-of-range polluted itinerary days pruned: day 10, 25');
  });

  it('prunes late outlier table rows even when product duration is unavailable', async () => {
    const result = await normalizeUploadItinerary({
      destination: '서안',
      activeAttractions: [],
      productRawText: '서안 티벳 일정표',
      itineraryData: {
        days: [
          { day: 1, schedule: [{ type: 'flight', activity: '부산 출발' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '서안 관광' }] },
          { day: 3, schedule: [{ type: 'activity', activity: '티벳 이동' }] },
          { day: 4, schedule: [{ type: 'activity', activity: '라싸 관광' }] },
          { day: 5, schedule: [{ type: 'activity', activity: '고궁 관광' }] },
          { day: 6, schedule: [{ type: 'activity', activity: '공항 이동' }] },
          {
            day: 30,
            schedule: [
              { type: 'normal', activity: '3월 30일(월)까지 발권 조건' },
              { type: 'normal', activity: '5월 23, 30일 1,099,000' },
            ],
          },
        ],
      } as never,
    });

    const days = result.itineraryDataToSave?.days ?? [];
    expect(days.map(day => day.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.warnings).toContain('outlier polluted itinerary days pruned: day 30');
  });

  it('does not prune a near-gap day when the schedule might be real', async () => {
    const result = await normalizeUploadItinerary({
      destination: '하노이',
      activeAttractions: [],
      productRawText: '하노이 사파 3박5일',
      itineraryData: {
        days: [
          { day: 1, schedule: [{ type: 'activity', activity: '하노이 도착' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '사파 관광' }] },
          { day: 4, schedule: [{ type: 'activity', activity: '롯데센터 하노이 전망대 관광' }] },
        ],
      } as never,
    });

    expect((result.itineraryDataToSave?.days ?? []).map(day => day.day)).toEqual([1, 2, 4]);
  });

  it('does not trust a one-day duration enough to prune real multi-day schedules', async () => {
    const result = await normalizeUploadItinerary({
      destination: '청도',
      durationDays: 1,
      activeAttractions: [],
      productRawText: '청도 3일 일정표',
      itineraryData: {
        days: [
          { day: 1, schedule: [{ type: 'activity', activity: '신호산 관광' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '청양 야시장 관광' }] },
          { day: 3, schedule: [{ type: 'flight', activity: '부산 도착' }] },
        ],
      } as never,
    });

    expect((result.itineraryDataToSave?.days ?? []).map(day => day.day)).toEqual([1, 2, 3]);
  });

  it('preserves source-backed top-level flight segments after itinerary normalization', async () => {
    const flightSegments = [
      {
        leg: 'outbound',
        flight_no: 'ZE981',
        dep_airport: 'Busan',
        dep_time: '18:55',
        arr_airport: 'Phu Quoc',
        arr_time: '21:30',
        arr_day_offset: 0,
        day_pair: [0, 0],
      },
      {
        leg: 'inbound',
        flight_no: 'ZE982',
        dep_airport: 'Phu Quoc',
        dep_time: '23:25',
        arr_airport: 'Busan',
        arr_time: '06:55',
        arr_day_offset: 1,
        day_pair: [4, 5],
      },
    ];

    const result = await normalizeUploadItinerary({
      destination: 'Phu Quoc',
      durationDays: 6,
      activeAttractions: [],
      productRawText: [
        'ZE981',
        '18:55',
        '21:30',
        'ZE982',
        '23:25',
        '06:55',
      ].join('\n'),
      itineraryData: {
        days: [
          { day: 1, schedule: [{ type: 'flight', activity: 'Busan departure' }] },
          { day: 2, schedule: [{ type: 'activity', activity: 'Sunset Town' }] },
          { day: 3, schedule: [{ type: 'activity', activity: 'Island hopping' }] },
          { day: 4, schedule: [{ type: 'activity', activity: 'Grand World' }] },
          { day: 5, schedule: [{ type: 'flight', activity: 'Phu Quoc departure' }] },
          { day: 6, schedule: [{ type: 'flight', activity: 'Busan arrival' }] },
        ],
        flight_segments: flightSegments,
      } as never,
    });

    expect((result.itineraryDataToSave as { flight_segments?: unknown[] } | null)?.flight_segments).toEqual(flightSegments);
  });

  it('aligns saved itinerary meta nights and days to the product duration', async () => {
    const result = await normalizeUploadItinerary({
      destination: '시즈오카',
      durationDays: 3,
      activeAttractions: [],
      productRawText: '시즈오카 2박3일',
      itineraryData: {
        meta: { days: 2, nights: 1 },
        days: [
          { day: 1, schedule: [{ type: 'activity', activity: '공항 미팅' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '시즈오카 관광' }] },
          { day: 3, schedule: [{ type: 'flight', activity: '부산 도착' }] },
        ],
      } as never,
    });

    expect(result.itineraryDataToSave?.meta).toMatchObject({ days: 3, nights: 2 });
  });

  it('uses source-backed nights for overnight-flight products instead of days minus one', async () => {
    const result = await normalizeUploadItinerary({
      destination: '푸꾸옥',
      durationDays: 6,
      nights: 4,
      activeAttractions: [],
      productRawText: '푸꾸옥 4박6일',
      itineraryData: {
        meta: { days: 6, nights: 5 },
        days: [
          { day: 1, schedule: [{ type: 'flight', activity: '부산 출발' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '골프 라운딩' }] },
          { day: 3, schedule: [{ type: 'activity', activity: '골프 라운딩' }] },
          { day: 4, schedule: [{ type: 'activity', activity: '골프 라운딩' }] },
          { day: 5, schedule: [{ type: 'flight', activity: '푸꾸옥 출발' }] },
          { day: 6, schedule: [{ type: 'flight', activity: '부산 도착' }] },
        ],
      } as never,
    });

    expect(result.itineraryDataToSave?.meta).toMatchObject({ days: 6, nights: 4 });
  });
});
