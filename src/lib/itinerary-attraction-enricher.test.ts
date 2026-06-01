import { describe, expect, it } from 'vitest';
import { enrichItineraryWithAttractionReferences, shouldAttemptAttractionMatch } from './itinerary-attraction-enricher';

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
    expect(res.matchedScheduleItemCount).toBe(1);
  });

  it('preserves valid manual attraction ids and skips meal rows from matching', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 2,
            schedule: [
              { activity: '죽림선원 관광', type: 'normal', attraction_ids: ['a-1'] },
              { activity: '달랏 시내 자유시간', type: 'meal' },
            ],
          },
        ],
      },
      [
        {
          id: 'a-1',
          name: '죽림선원',
          short_desc: '달랏 사원',
          country: '베트남',
          region: '달랏',
          aliases: ['죽림선원'],
        },
      ],
      '달랏',
    );

    const item = res.itineraryData?.days?.[0]?.schedule?.[0] as Record<string, unknown>;
    expect(item.attraction_ids).toEqual(['a-1']);
    expect(item.attraction_names).toEqual(['죽림선원']);
    expect(res.matchedScheduleItemCount).toBe(1);
    expect(res.unmatchedCandidates).toHaveLength(0);
  });

  it('skips generic free-time and transit rows from the attraction denominator', () => {
    expect(shouldAttemptAttractionMatch({ activity: '달랏 시내 자유시간', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '공항 이동', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '죽림선원 관광', type: 'normal' })).toBe(true);
  });
  it('skips supplier table fragments from unmatched attraction collection', () => {
    expect(shouldAttemptAttractionMatch({ activity: '\uBD80  \uC0B0', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '\uC804\uC6A9\uCC28\uB7C9', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '\uC804\uC77C', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '\uC911:\uAE40  \uBC25', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '\uC11D:\uC0BC\uACB9\uC0B4', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '$30/\uC778 \uBC1C\uC81C\uC678/\uD301\uBCC4\uB3C4', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '\uC9C4\uB2EC\uB798\uAD11\uC7A5', type: 'normal' })).toBe(true);
  });
});
