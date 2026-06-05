import { describe, expect, it } from 'vitest';
import { normalizeUploadItinerary } from './itinerary-normalization';

describe('normalizeUploadItinerary', () => {
  it('post-processes itinerary and returns attraction candidate rows outside the route', async () => {
    const result = await normalizeUploadItinerary({
      destination: '푸꾸옥',
      activeAttractions: [],
      productRawText: '쇼핑센터\n잡화점 1회\n비 고',
      itineraryData: {
        days: [{
          day: 1,
          schedule: [
            { type: 'activity', activity: '빈원더스 관광', note: null },
            { type: 'flight', activity: '부산 출발', note: null },
          ],
        }],
      } as never,
    });

    expect(result.fallbackApplied).toBe(false);
    expect(result.scheduleItemCount).toBe(1);
    expect((result.itineraryDataToSave?.highlights as { shopping?: string } | undefined)?.shopping).toBe('쇼핑센터 잡화점 1회');
    expect(result.extractedCandidateRows.some(row => row.activity.includes('빈원더스'))).toBe(true);
  });
});
