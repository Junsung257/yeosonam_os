import { describe, expect, it } from 'vitest';
import { normalizeUploadItinerary } from './itinerary-normalization';

describe('normalizeUploadItinerary', () => {
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
});
