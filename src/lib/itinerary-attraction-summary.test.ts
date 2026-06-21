import { describe, expect, it } from 'vitest';
import { getAttractionPreviewNamesFromItinerary } from './itinerary-attraction-summary';

describe('getAttractionPreviewNamesFromItinerary', () => {
  it('uses attraction names when the schedule has attraction evidence', () => {
    const names = getAttractionPreviewNamesFromItinerary({
      days: [
        {
          schedule: [
            {
              entity_kind: 'attraction_visit',
              attraction_ids: ['att-1'],
              attraction_names: ['도이인타논 산', '베치라탄 폭포'],
            },
          ],
        },
      ],
    });

    expect(names).toEqual(['도이인타논 산', '베치라탄 폭포']);
  });

  it('does not promote meals, transfers, airport lines, or golf fragments as attraction previews', () => {
    const names = getAttractionPreviewNamesFromItinerary({
      days: [
        {
          schedule: [
            { entity_kind: 'unknown', activity: '라운딩 후 중:클럽식' },
            { entity_kind: 'transfer', activity: '공항으로 이동' },
            { entity_kind: 'unknown', activity: '부 산 06:55 김해 국제공항 도착' },
            { entity_kind: 'meal', attraction_names: ['꿔바로우'], activity: '꿔바로우' },
          ],
        },
      ],
    });

    expect(names).toEqual([]);
  });

  it('falls back to activity text only for attraction-like schedule items', () => {
    const names = getAttractionPreviewNamesFromItinerary({
      days: [
        {
          schedule: [
            { entity_kind: 'attraction_visit', activity: '▶ 쿠로가와 온천마을 산책' },
          ],
        },
      ],
    });

    expect(names).toEqual(['쿠로가와 온천마을 산책']);
  });
});
