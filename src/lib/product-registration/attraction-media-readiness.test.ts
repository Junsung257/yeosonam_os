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

  it('blocks matched customer attractions when no customer description exists', () => {
    const itineraryData = {
      days: [
        {
          day: 2,
          schedule: [
            {
              activity: '\uBC31\uB450\uC0B0 \uC0BC\uB3C4\uBC31\uD558 \uC0C1\uB958\uC5D0 \uC704\uCE58\uD55C \uC545\uD654\uD3ED\uD3EC',
              attraction_ids: ['akhwa'],
              attraction_names: ['\uC545\uD654\uD3ED\uD3EC'],
            },
          ],
        },
      ],
    };
    const attractions = [{ id: 'akhwa', name: '\uC545\uD654\uD3ED\uD3EC', short_desc: null, long_desc: null, photos: [] }];

    const result = evaluateAttractionMediaReadiness({
      itineraryData,
      attractions,
      blockUnmatchedMajor: true,
    });

    expect(result.missingDescriptionCandidates.map(candidate => candidate.label)).toEqual(['\uC545\uD654\uD3ED\uD3EC']);
    expect(result.blockers).toContain('attraction.description_missing:\uC545\uD654\uD3ED\uD3EC');
  });

  it('does not require customer-card copy for a recognized internal-only master', () => {
    const itineraryData = {
      days: [{
        day: 1,
        schedule: [{
          activity: '통천협 관광',
          attraction_ids: ['tongtian'],
          attraction_names: ['통천협'],
        }],
      }],
    };

    const result = evaluateAttractionMediaReadiness({
      itineraryData,
      attractions: [{
        id: 'tongtian',
        name: '통천협',
        is_active: true,
        customer_publishable: false,
        short_desc: null,
        long_desc: null,
        photos: [],
      }],
      blockUnmatchedMajor: true,
    });

    expect(result.unmatchedCandidates).toEqual([]);
    expect(result.missingDescriptionCandidates).toEqual([]);
    expect(result.blockers).toEqual([]);
  });

  it('prefers explicit attraction names when the enrichment layer already resolved them', () => {
    expect(extractCustomerAttractionLabel({
      activity: '산책',
      attraction_names: ['쿠로가와 온천마을'],
    })).toBe('쿠로가와 온천마을');
  });

  it('prioritizes the compiled entity kind over a legacy normal type for transfers', () => {
    expect(extractCustomerAttractionLabels({
      activity: '\uBCF4\uCC9C\uB300\uD611\uACE1\uC73C\uB85C \uC774\uB3D9',
      type: 'normal',
      entity_kind: 'transfer',
    })).toEqual([]);
  });

  it('does not require attraction media for route mechanics or orphan description fragments', () => {
    const fragments = [
      '인 : 야시장자유관람',
      '200 년 하리푼차이의 역사와 유적지를 재현',
      '대협곡중 으뜸으로 꼽히는',
      '협곡 위 높이 625 m',
      '도보 -전동카 -도보 -유리전망대-전동카',
      '입구- 셔틀버스-공중버스 -쌍심플래폼- 레일케이블카-전동카',
      '유리전망대- 전동카-동굴엘리베이터-전동카-셔틀버스 -출구',
      '완행열차 체험 – 치앙마이에서만 느낄 수 있는 여유와 감성이 있는 열차',
    ];

    for (const activity of fragments) {
      expect(extractCustomerAttractionLabels({ activity })).toEqual([]);
    }
  });

  it('splits known Baekdu/Yanji composite attraction phrases into separate customer-visible labels', () => {
    expect(extractCustomerAttractionLabels({
      activity: '\uB3C5\uB9BD\uC758\uC2DD\uC744 \uACE0\uCDE8\uD558\uB294 \uC0C1\uC9D5 \uBE44\uC554\uC0B0 \uC77C\uC1A1\uC815, \uD574\uB780\uAC15(\uCC28\uCC3D\uAD00\uAD11)',
    })).toEqual(['\uBE44\uC554\uC0B0 \uC77C\uC1A1\uC815', '\uD574\uB780\uAC15']);

    expect(extractCustomerAttractionLabels({
      activity: '\uC724\uB3D9\uC8FC\uC0DD\uAC00, \uBA85\uB3D9\uAD50\uD68C \uAD00\uAD11',
    })).toEqual(['\uC724\uB3D9\uC8FC\uC0DD\uAC00', '\uBA85\uB3D9\uAD50\uD68C']);
  });

  it.each([
    '성인 등 모든 관광객 인당 신청 필수',
    '성수기의 경우 ETA 승인이 오래 걸릴 수 있으니 여유있는 신청 필수',
    '괌 도착 72시간 전 전자세관신고서 작성 후 QR 코드 촬영 필수',
    '야채절임, 디저트',
    '실제 음식은 조리 과정에 따라 플레이팅이 달라질 수 있습니다.',
    '파인이스트 괌 골프장 18홀',
    '피로를 덜어주는 대만식 발맛사지 30분',
    '로컬마켓 문화체험 - 재래시장 관람',
    '프라이빗한 해변을 가진 비치바 or 핫플카페',
    '미슐랭 추천 5성급 호텔 디너쇼 식사 후',
  ])('does not require attraction media for operational, meal, golf, or generic venue text: %s', activity => {
    expect(extractCustomerAttractionLabels({ activity })).toEqual([]);
  });

  it('still requires media for a named cathedral next to descriptive copy', () => {
    expect(extractCustomerAttractionLabels({
      activity: '마카오 상징적 건축물로 유명한 성바울 성당',
    })).toEqual(['마카오 상징적 건축물로 유명한 성바울 성당']);
  });
});
