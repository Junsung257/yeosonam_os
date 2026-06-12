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
});
