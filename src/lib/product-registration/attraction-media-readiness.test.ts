import { describe, expect, it } from 'vitest';

import {
  evaluateAttractionMediaReadiness,
  extractCustomerAttractionLabel,
  extractCustomerAttractionLabels,
} from './attraction-media-readiness';

describe('attraction media readiness', () => {
  it('extracts customer-visible Shizuoka attraction labels and drops region or meal fragments', () => {
    const itineraryData = {
      days: [
        {
          day: 1,
          regions: ['시즈오카', '카와구치'],
          schedule: [
            { activity: '시즈오카' },
            { activity: '카와구치' },
            { activity: '중식 후' },
            { activity: '시즈오카 국제공항 도착 및 입국 수속', type: 'flight' },
            { activity: '니혼다이라 로프웨이 왕복탑승' },
            { activity: '일본 3대 송림중 하나인, 유네스코세계유산 미호노 마츠바라' },
            { activity: '광활한 녹차밭, 계단식 차밭과 후지산이 어우러진 오부치사사바' },
          ],
        },
        {
          day: 2,
          schedule: [
            { activity: '아라쿠라야마 센겐신사 관광' },
            { activity: '후지산 파노라마 로프웨이 탑승' },
            { activity: '오시노핫카이 산책' },
            { activity: '미시마 스카이워크 방문' },
          ],
        },
      ],
    };

    const result = evaluateAttractionMediaReadiness({ itineraryData });
    expect(result.unmatchedCandidates.map(candidate => candidate.label)).toEqual([
      '니혼다이라 로프웨이',
      '미호노 마츠바라',
      '오부치사사바',
      '아라쿠라야마 센겐신사',
      '후지산 파노라마 로프웨이',
      '오시노핫카이',
      '미시마 스카이워크',
    ]);
    expect(result.warnings).toContain('attraction.unmatched_major:니혼다이라 로프웨이');
    expect(result.warnings).not.toContain('attraction.unmatched_major:시즈오카');
    expect(result.warnings).not.toContain('attraction.unmatched_major:중식 후');
  });

  it('uses existing attraction ids and audits photos only when photo audit is enabled', () => {
    const itineraryData = {
      days: [
        {
          day: 1,
          schedule: [
            { activity: '미호노 마츠바라 관광', attraction_ids: ['a1'] },
            { activity: '니혼다이라 로프웨이 왕복탑승', attraction_ids: ['a2'] },
          ],
        },
      ],
    };
    const attractions = [
      {
        id: 'a1',
        name: '미호노 마츠바라',
        photos: [{ src_medium: 'm.jpg', src_large: 'l.jpg', photographer: 'source', pexels_id: 1 }],
      },
      { id: 'a2', name: '니혼다이라 로프웨이', photos: [] },
    ];

    const withoutPhotoAudit = evaluateAttractionMediaReadiness({ itineraryData, attractions });
    expect(withoutPhotoAudit.matchedCount).toBe(2);
    expect(withoutPhotoAudit.missingPhotoCandidates).toEqual([]);

    const withPhotoAudit = evaluateAttractionMediaReadiness({ itineraryData, attractions, includePhotoAudit: true });
    expect(withPhotoAudit.matchedWithPhotos).toBe(1);
    expect(withPhotoAudit.missingPhotoCandidates.map(candidate => candidate.label)).toEqual(['니혼다이라 로프웨이']);
  });

  it('prefers explicit attraction names when the enrichment layer already resolved them', () => {
    expect(extractCustomerAttractionLabel({
      activity: '산책',
      attraction_names: ['쿠로가와 온천마을'],
    })).toBe('쿠로가와 온천마을');
  });

  it('splits known Baekdu/Yanji composite attraction phrases into separate customer-visible labels', () => {
    expect(extractCustomerAttractionLabels({
      activity: '\uB3C5\uB9BD\uC758\uC2DD\uC744 \uACE0\uCDE8\uD558\uB294 \uC0C1\uC9D5 \uBE44\uC554\uC0B0 \uC77C\uC1A1\uC815, \uD574\uB780\uAC15(\uCC28\uCC3D\uAD00\uAD11)',
    })).toEqual(['\uBE44\uC554\uC0B0 \uC77C\uC1A1\uC815', '\uD574\uB780\uAC15']);

    expect(extractCustomerAttractionLabels({
      activity: '\uC724\uB3D9\uC8FC\uC0DD\uAC00, \uBA85\uB3D9\uAD50\uD68C \uAD00\uAD11',
    })).toEqual(['\uC724\uB3D9\uC8FC\uC0DD\uAC00', '\uBA85\uB3D9\uAD50\uD68C']);
  });
});
