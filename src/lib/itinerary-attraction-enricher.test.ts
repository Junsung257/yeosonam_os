import { describe, expect, it } from 'vitest';
import { enrichItineraryWithAttractionReferences, shouldAttemptAttractionMatch } from './itinerary-attraction-enricher';

describe('enrichItineraryWithAttractionReferences', () => {
  it('directly scans registered attraction names from simple supplier itinerary lines', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 1,
            schedule: [
              { activity: '\uACBD\uBCF5\uAD81 - \uC870\uC120 \uC655\uC870\uC758 \uB300\uD45C \uAD81\uAD90' },
              { activity: '\uCC3D\uB355\uAD81 - \uC720\uB124\uC2A4\uCF54 \uC138\uACC4\uC720\uC0B0' },
              { activity: '\uBC1C\uB9C8\uC0AC\uC9C0 - \uC5EC\uD589 \uD53C\uB85C \uD574\uC18C' },
            ],
          },
        ],
      },
      [
        { id: 'palace-1', name: '\uACBD\uBCF5\uAD81', short_desc: '\uC11C\uC6B8\uC758 \uB300\uD45C \uAD81\uAD90' },
        { id: 'palace-2', name: '\uCC3D\uB355\uAD81', short_desc: '\uC720\uB124\uC2A4\uCF54 \uAD81\uAD90' },
        { id: 'spa-1', name: '\uBC1C\uB9C8\uC0AC\uC9C0', short_desc: '\uD53C\uB85C\uB97C \uD478\uB294 \uCCB4\uD5D8' },
      ],
      '\uC11C\uC6B8',
    );

    const schedule = res.itineraryData?.days?.[0]?.schedule ?? [];
    expect(schedule.map(item => item.attraction_names)).toEqual([
      ['\uACBD\uBCF5\uAD81'],
      ['\uCC3D\uB355\uAD81'],
      undefined,
    ]);
    expect(res.matchedScheduleItemCount).toBe(2);
    expect(res.unmatchedCandidates).toHaveLength(0);
  });

  it('does not direct-scan long MRT product titles as attraction cards', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 1,
            schedule: [
              { activity: '\uD478\uAFB8\uC625 \uACF5\uD56D \uC785\uAD6D \uD328\uC2A4\uD2B8\uD2B8\uB799 \uC774\uC6A9' },
            ],
          },
        ],
      },
      [
        {
          id: 'mrt-1',
          name: '\uBCA0\uD2B8\uB0A8 \uD478\uAFB8\uC625 \uACF5\uD56D \uC785\uAD6D \uD328\uC2A4\uD2B8\uD2B8\uB799',
          short_desc: '\uAE34 \uC0C1\uD488\uBA85',
          category: 'mrt_product',
        },
      ],
      '\uD478\uAFB8\uC625',
    );

    const item = res.itineraryData?.days?.[0]?.schedule?.[0] as Record<string, unknown>;
    expect(item.attraction_ids).toBeUndefined();
    expect(res.matchedScheduleItemCount).toBe(0);
  });

  it('removes stale non-sightseeing attraction ids such as eSIM data products', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 2,
            schedule: [
              {
                activity: '기암괴석, 운해, 폭포와 온천이 어우러진 여행지 오지봉',
                attraction_ids: ['esim-cn'],
              },
            ],
          },
        ],
      },
      [
        {
          id: 'esim-cn',
          name: '중국 eSIM 기간 고정 데이터 해외 여행 데이터 필수',
          region: '북경',
          country: 'CN',
        },
      ],
      '광저우',
    );

    const item = res.itineraryData?.days?.[0]?.schedule?.[0] as Record<string, unknown>;
    expect(item.attraction_ids).toBeUndefined();
    expect(item.attraction_names).toBeUndefined();
    expect(res.matchedScheduleItemCount).toBe(0);
  });

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

  it('prefers direct source text matches over stale existing attraction ids', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 2,
            regions: ['푸꾸옥'],
            schedule: [
              {
                activity: '빈펄CC 18홀 라운딩 조:호텔식',
                attraction_ids: ['safari'],
              },
            ],
          },
        ],
      },
      [
        {
          id: 'safari',
          name: '푸꾸옥 빈펄 사파리 빈원더스 콤보 QR티켓 입장권 패스트패스',
          short_desc: '사파리와 테마파크',
          region: '푸꾸옥',
        },
        {
          id: 'golf',
          name: '빈펄 CC',
          short_desc: '푸꾸옥 프리미엄 18홀 골프',
          region: '푸꾸옥',
          aliases: ['빈펄CC'],
        },
      ],
      '푸꾸옥',
    );

    const item = res.itineraryData?.days?.[0]?.schedule?.[0] as Record<string, unknown>;
    expect(item.attraction_ids).toEqual(['golf']);
    expect(item.attraction_names).toEqual(['빈펄 CC']);
  });

  it('skips generic free-time and transit rows from the attraction denominator', () => {
    expect(shouldAttemptAttractionMatch({ activity: '달랏 시내 자유시간', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '공항 이동', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: 'Check-out (~12:00)', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '미제공', type: 'normal' })).toBe(false);
    expect(shouldAttemptAttractionMatch({ activity: '죽림선원 관광', type: 'normal' })).toBe(true);
  });

  it('removes stale attraction references from hotel operation rows', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 4,
            schedule: [
              {
                activity: 'Check-out (~12:00)',
                type: 'normal',
                entity_kind: 'attraction_visit',
                attraction_query: 'Check-out',
                attraction_queries: ['Check-out'],
              },
            ],
          },
        ],
      },
      [{ id: 'dummy', name: '푸꾸옥 야시장', region: '푸꾸옥' }],
      '푸꾸옥',
    );

    const item = res.itineraryData?.days?.[0]?.schedule?.[0] as Record<string, unknown>;
    expect(item.attraction_query).toBeUndefined();
    expect(item.attraction_queries).toBeUndefined();
    expect(res.unmatchedCandidates).toHaveLength(0);
  });

  it('removes hotel-stay attraction ids instead of rendering accommodation as attraction cards', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 1,
            schedule: [
              {
                activity: '서안 노보텔 또는 동급 준5성 호텔 투숙',
                type: 'normal',
                attraction_ids: ['hotel-1'],
                attraction_names: ['노보텔 시안 더 벨 타워'],
              },
            ],
          },
        ],
      },
      [{ id: 'hotel-1', name: '노보텔 시안 더 벨 타워', region: '서안' }],
      '서안',
    );

    const item = res.itineraryData?.days?.[0]?.schedule?.[0] as Record<string, unknown>;
    expect(item.attraction_ids).toBeUndefined();
    expect(item.attraction_names).toBeUndefined();
    expect(item.attraction_note).toBeUndefined();
  });

  it('uses source activity text as a safe attraction note when the registered attraction lacks descriptions', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 3,
            schedule: [
              {
                activity: '베트남에서 가장 유명한 다딴란 폭포 알파인코스터 체험',
                type: 'normal',
                attraction_ids: ['coaster-1'],
              },
            ],
          },
        ],
      },
      [{ id: 'coaster-1', name: '다딴라 알파인 코스터', region: '달랏' }],
      '나트랑/달랏',
    );

    const item = res.itineraryData?.days?.[0]?.schedule?.[0] as Record<string, unknown>;
    expect(item.attraction_ids).toEqual(['coaster-1']);
    expect(item.attraction_note).toBe('베트남에서 가장 유명한 다딴란 폭포 알파인코스터 체험');
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

  it('does not attach Baekdu heaven lake cards to Akhwa waterfall or optional price rows', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 2,
            schedule: [
              {
                activity: '\uBC31\uB450\uC0B0 \uBD81\uCABD \uBE44\uD0C8\uC5D0 \uBC1C\uB2EC\uB41C \uC0BC\uB3C4\uBC31\uD558 \uC0C1\uB958\uC5D0 \uC704\uCE58\uD55C \uC545\uD654\uD3ED\uD3EC',
                attraction_ids: ['heaven-lake'],
              },
              {
                activity: '\u203B\uD604\uC9C0\uC9C0\uBD88\uC635\uC158 : \uBC31\uB450\uC0B05D\uD50C\uB77C\uC789 \uCCB4\uD5D8 $40/\uC778',
                attraction_ids: ['heaven-lake'],
                entity_kind: 'optional_tour',
              },
            ],
          },
        ],
      },
      [
        {
          id: 'heaven-lake',
          name: '\uBC31\uB450\uC0B0 \uCC9C\uC9C0',
          short_desc: '\uBC31\uB450\uC0B0 \uC815\uC0C1\uC758 \uD654\uC0B0\uD638',
          country: 'CN',
          region: '\uBC31\uB450\uC0B0',
        },
      ],
      '\uC5F0\uAE38/\uBC31\uB450\uC0B0',
    );

    const schedule = res.itineraryData?.days?.[0]?.schedule ?? [];
    expect(schedule[0].attraction_ids).toBeUndefined();
    expect(schedule[1].attraction_ids).toBeUndefined();
    expect(res.matchedScheduleItemCount).toBe(0);
  });

  it('deduplicates overlapping Baekdu attraction cards and strips pure transfer rows', () => {
    const res = enrichItineraryWithAttractionReferences(
      {
        days: [
          {
            day: 3,
            schedule: [
              {
                activity: '\uC9DA\uCC28\uB85C \uBBFC\uC871\uC758 \uC601\uC0B0 \uBC31\uB450\uC0B0 \uC815\uC0C1 \uCC9C\uBB38\uBD09 \uB4F1\uC815, \uCC9C\uC9C0\uC870\uB9DD',
                attraction_ids: ['heaven-lake', 'cheonji'],
              },
              {
                activity: '\uBC31\uB450\uC0B0 \uC11C\uD30C\uB85C \uC774\uB3D9',
                attraction_ids: ['west-slope'],
                entity_kind: 'transfer',
              },
            ],
          },
        ],
      },
      [
        { id: 'heaven-lake', name: '\uBC31\uB450\uC0B0 \uCC9C\uC9C0', short_desc: '\uBC31\uB450\uC0B0 \uC815\uC0C1\uC758 \uD654\uC0B0\uD638', region: '\uBC31\uB450\uC0B0' },
        { id: 'cheonji', name: '\uCC9C\uC9C0', short_desc: '\uD654\uC0B0\uD638', region: '\uBC31\uB450\uC0B0' },
        { id: 'west-slope', name: '\uBC31\uB450\uC0B0\uC11C\uD30C', short_desc: '\uBC31\uB450\uC0B0 \uC11C\uCABD \uC0AC\uBA74', region: '\uBC31\uB450\uC0B0' },
      ],
      '\uC5F0\uAE38/\uBC31\uB450\uC0B0',
    );

    const schedule = res.itineraryData?.days?.[0]?.schedule ?? [];
    expect(schedule[0].attraction_ids).toEqual(['heaven-lake']);
    expect(schedule[0].attraction_names).toEqual(['\uBC31\uB450\uC0B0 \uCC9C\uC9C0']);
    expect(schedule[1].attraction_ids).toBeUndefined();
  });
});
