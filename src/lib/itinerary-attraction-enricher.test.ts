import { describe, expect, it } from 'vitest';
import { enrichItineraryWithAttractionReferences } from './itinerary-attraction-enricher';

describe('enrichItineraryWithAttractionReferences', () => {
  it('일정 항목에 attraction_ids/names를 주입한다', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 3,
            schedule: [
              {
                activity: '▶도이인타논으로 이동 [1시간 소요]',
                note: '태국에서 가장 높은 해발 2656미터의 히말라야의 관문 도이인타논 산',
              },
            ],
          },
        ],
      },
      [
        {
          id: 'a-1',
          name: '도이인타논 산',
          short_desc: '치앙마이 최고봉 전망 포인트',
          country: '태국',
          region: '치앙마이',
          aliases: ['도이인타논'],
        },
      ],
      '치앙마이',
    );

    const item = res.itineraryData?.days?.[0]?.schedule?.[0] as Record<string, unknown>;
    expect(item.attraction_ids).toEqual(['a-1']);
    expect(item.attraction_names).toEqual(['도이인타논 산']);
    expect(typeof item.attraction_note).toBe('string');
    expect(res.unmatchedCandidates.length).toBe(0);
  });
});
