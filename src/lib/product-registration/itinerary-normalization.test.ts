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
      itineraryData: {
        days: [{
          day: 1,
          schedule: [
            { type: 'normal', activity: '두만강 강변공원 관광', entity_kind: 'attraction_visit' },
            { type: 'normal', activity: '꿔바로우', entity_kind: 'meal' },
            { type: 'hotel', activity: '풀만호텔 또는 동급 (5성)', entity_kind: 'hotel_stay' },
          ],
        }],
      } as never,
    });

    const day = result.itineraryDataToSave?.days?.[0] as {
      schedule?: Array<{ activity?: string }>;
      meals?: { dinner?: boolean; dinner_note?: string | null };
      hotel?: { name?: string | null; grade?: string | null };
    };
    const activities = (day.schedule ?? []).map(item => item.activity);
    expect(activities).not.toContain('꿔바로우');
    expect(activities).not.toContain('풀만호텔 또는 동급 (5성)');
    expect(day.meals?.dinner).toBe(true);
    expect(day.meals?.dinner_note).toBe('꿔바로우');
    expect(day.hotel?.name).toBe('풀만호텔 또는 동급');
    expect(day.hotel?.grade).toBe('5성');
  });
});
