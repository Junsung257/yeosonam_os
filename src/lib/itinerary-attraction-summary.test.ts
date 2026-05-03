import { describe, expect, it } from 'vitest';
import { getAttractionPreviewNamesFromItinerary } from './itinerary-attraction-summary';

describe('getAttractionPreviewNamesFromItinerary', () => {
  it('attraction_names를 우선 사용', () => {
    const names = getAttractionPreviewNamesFromItinerary({
      days: [
        { schedule: [{ attraction_names: ['도이인타논 산', '베치라탄 폭포'] }] },
      ],
    });
    expect(names).toEqual(['도이인타논 산', '베치라탄 폭포']);
  });

  it('없으면 activity fallback', () => {
    const names = getAttractionPreviewNamesFromItinerary({
      days: [
        { schedule: [{ activity: '▶푸미폰 국왕 장수기념관 [1시간]' }] },
      ],
    });
    expect(names[0]).toContain('푸미폰');
  });
});
