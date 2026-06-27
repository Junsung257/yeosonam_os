import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseCanonicalNameFromNaver } from './naver-entity-verifier';
import {
  resolveItineraryEntityCandidate,
  terminalNonMasterReason,
  type EntityCandidateRow,
} from './itinerary-entity-resolution-engine';

function candidate(overrides: Partial<EntityCandidateRow> = {}): EntityCandidateRow {
  return {
    id: 'candidate-1',
    candidate_key: 'attraction:test',
    category: 'attraction',
    raw_label: '대표 방문지 공강지공원',
    normalized_label: '공강지공원',
    destination_scope: '중국',
    country_scope: 'CN',
    region_scope: '항저우',
    evidence_count: 3,
    occurrence_count: 4,
    package_count: 2,
    source_context: {},
    external_sources: [],
    suggested_master: { label: '공강지공원' },
    confidence: 0.72,
    auto_action: 'create_internal_master',
    promotion_status: 'auto_internal',
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chooseCanonicalNameFromNaver', () => {
  it('prefers a short high-volume Korean place name over a long descriptive phrase', () => {
    const result = chooseCanonicalNameFromNaver({
      fallback: '고대 황제와 문인들의 놀이터 공강지공원',
      aliases: ['공강지공원'],
      keywordEvidence: [
        {
          keyword: '고대 황제와 문인들의 놀이터 공강지공원',
          monthlyPc: 0,
          monthlyMobile: 0,
          monthlyTotal: 0,
          competition: null,
        },
        {
          keyword: '공강지공원',
          monthlyPc: 120,
          monthlyMobile: 880,
          monthlyTotal: 1000,
          competition: 1,
        },
      ],
    });

    expect(result).toEqual({ name: '공강지공원', source: 'naver_searchad' });
  });

  it('keeps a Korean fallback when SearchAd only returns romanized variants', () => {
    const result = chooseCanonicalNameFromNaver({
      fallback: '죠시CC 18홀 라운딩',
      aliases: ['죠시CC'],
      keywordEvidence: [
        {
          keyword: 'choshi',
          monthlyPc: 200,
          monthlyMobile: 1000,
          monthlyTotal: 1200,
          competition: 1,
        },
      ],
    });

    expect(result).toEqual({ name: '죠시CC', source: 'input' });
  });

  it('does not let unrelated SearchAd keywords hijack the source label', () => {
    const result = chooseCanonicalNameFromNaver({
      fallback: '매운탕',
      aliases: ['매운탕'],
      keywordEvidence: [
        {
          keyword: '곡성장미축제',
          monthlyPc: 1000,
          monthlyMobile: 5000,
          monthlyTotal: 6000,
          competition: 1,
        },
      ],
    });

    expect(result).toEqual({ name: '매운탕', source: 'input' });
  });
});

describe('resolveItineraryEntityCandidate', () => {
  it('uses Google Places strong identity plus supplier corpus as internal-only attraction evidence', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      raw_label: 'Tokyo Tower',
      normalized_label: 'Tokyo Tower',
      destination_scope: 'Tokyo',
      country_scope: 'JP',
      region_scope: 'Tokyo',
      evidence_count: 4,
      occurrence_count: 7,
      package_count: 3,
      suggested_master: { label: 'Tokyo Tower' },
    }), {
      naverVerifier: async () => ({
        configured: true,
        canonicalName: 'Tokyo Tower',
        canonicalNameSource: 'input',
        searchScore: 0,
        keywordScore: 0,
        overallScore: 0,
        searchEvidence: [],
        keywordEvidence: [],
        sources: [],
        attempts: [],
      }),
      googlePlacesVerifier: async () => ({
        configured: true,
        enabled: true,
        remainingDailyCalls: 9,
        maxQueriesPerCandidate: 1,
        canonicalName: 'Tokyo Tower',
        score: 0.92,
        hasStrongPlaceIdentity: true,
        regionConflict: false,
        evidence: [{
          query: 'Tokyo Tokyo Tower',
          placeId: 'place-tokyo-tower',
          displayName: 'Tokyo Tower',
          formattedAddress: '4 Chome-2-8 Shibakoen, Minato City, Tokyo, Japan',
          types: ['tourist_attraction', 'point_of_interest'],
          googleMapsUri: 'https://maps.google.com/?cid=1',
          websiteUri: null,
          nameMatches: true,
          regionMatches: true,
          countryMatches: true,
          typeMatches: true,
          score: 0.92,
        }],
        sources: [{
          source: 'google_places',
          id: 'place-tokyo-tower',
          url: 'https://maps.google.com/?cid=1',
          confidence: 0.92,
          name: 'Tokyo Tower',
        }],
        attempts: [],
      }),
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('create_internal_master');
    expect(decision.promotionStatus).toBe('auto_internal');
    expect(decision.autoVerificationStatus).toBe('verified_internal');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
    expect(decision.suggestedMaster.assurance).toEqual(expect.objectContaining({
      google_places_support: true,
    }));
  });

  it('uses Naver as a naming signal but does not make a new attraction publishable by itself', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate(), {
      naverVerifier: async () => ({
        configured: true,
        canonicalName: '공강지공원',
        canonicalNameSource: 'naver_searchad',
        searchScore: 0.8,
        keywordScore: 0.7,
        overallScore: 0.765,
        searchEvidence: [],
        keywordEvidence: [],
        sources: [
          {
            source: 'naver_search',
            id: '공강지공원',
            url: 'https://search.naver.com/search.naver?query=%EA%B3%B5%EA%B0%95%EC%A7%80%EA%B3%B5%EC%9B%90',
            confidence: 0.8,
            name: '공강지공원',
          },
          {
            source: 'naver_searchad',
            id: '공강지공원',
            confidence: 0.7,
            name: '공강지공원',
          },
        ],
        attempts: [],
      }),
      wikidataReconciler: async () => [],
    });

    expect(decision.canonicalName).toBe('공강지공원');
    expect(decision.autoAction).toBe('create_internal_master');
    expect(decision.promotionStatus).toBe('auto_internal');
    expect(decision.autoVerificationStatus).toBe('unverified');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
  });

  it('marks an attraction publishable-ready only when identity evidence and Korean naming support agree', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      evidence_count: 8,
      occurrence_count: 14,
      package_count: 5,
    }), {
      naverVerifier: async () => ({
        configured: true,
        canonicalName: '공강지공원',
        canonicalNameSource: 'naver_searchad',
        searchScore: 0.96,
        keywordScore: 0.9,
        overallScore: 0.939,
        searchEvidence: [
          {
            target: 'local',
            query: '공강지공원',
            total: 12,
            itemCount: 3,
            matchedItems: 2,
            exactTitleMatches: 1,
            regionMatches: 1,
            addressMatches: 1,
            topTitles: ['공강지공원'],
            topLinks: ['https://example.com/place'],
          },
        ],
        keywordEvidence: [],
        sources: [
          {
            source: 'naver_search',
            id: '공강지공원',
            url: 'https://search.naver.com/search.naver?query=%EA%B3%B5%EA%B0%95%EC%A7%80%EA%B3%B5%EC%9B%90',
            confidence: 0.96,
            name: '공강지공원',
          },
        ],
        attempts: [],
      }),
      wikidataReconciler: async () => [
        {
          qid: 'Q123',
          label_ko: '공강지공원',
          label_en: 'Gonggangji Park',
          description: 'park',
          aliases: ['공강지 공원'],
          image_url: null,
          type_qid: 'Q2344606',
          confidence: 1,
        },
      ],
    });

    expect(decision.autoAction).toBe('create_publishable_master');
    expect(decision.promotionStatus).toBe('publishable_ready');
    expect(decision.autoVerificationStatus).toBe('verified_publishable');
    expect(decision.suggestedMaster.customer_publishable).toBe(true);
  });

  it('can mark an attraction publishable-ready with free OSM identity evidence while keeping admin approval separate', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      raw_label: 'Tokyo Tower',
      normalized_label: 'Tokyo Tower',
      destination_scope: 'Tokyo',
      country_scope: 'JP',
      region_scope: 'Tokyo',
      evidence_count: 10,
      occurrence_count: 16,
      package_count: 6,
      suggested_master: { label: 'Tokyo Tower' },
    }), {
      naverVerifier: async () => ({
        configured: true,
        canonicalName: 'Tokyo Tower',
        canonicalNameSource: 'naver_search',
        searchScore: 0.98,
        keywordScore: 0,
        overallScore: 0.637,
        searchEvidence: [
          {
            target: 'local',
            query: 'Tokyo Tower',
            total: 20,
            itemCount: 3,
            matchedItems: 3,
            exactTitleMatches: 1,
            regionMatches: 1,
            addressMatches: 1,
            topTitles: ['Tokyo Tower'],
            topLinks: ['https://example.com/tokyo-tower'],
          },
        ],
        keywordEvidence: [],
        sources: [
          {
            source: 'naver_search',
            id: 'Tokyo Tower',
            url: 'https://search.naver.com/search.naver?query=Tokyo%20Tower',
            confidence: 0.98,
            name: 'Tokyo Tower',
          },
        ],
        attempts: [],
      }),
      osmNominatimVerifier: async () => ({
        configured: true,
        canonicalName: 'Tokyo Tower',
        score: 1,
        hasStrongPlaceIdentity: true,
        regionConflict: false,
        evidence: [],
        sources: [{
          source: 'osm_nominatim',
          id: 'way:123',
          url: 'https://www.openstreetmap.org/way/123',
          confidence: 1,
          name: 'Tokyo Tower',
        }],
        attempts: [],
      }),
      googlePlacesVerifier: async () => {
        throw new Error('Google should not be called when free evidence is enough');
      },
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('create_publishable_master');
    expect(decision.promotionStatus).toBe('publishable_ready');
    expect(decision.autoVerificationStatus).toBe('verified_publishable');
    expect(decision.suggestedMaster.assurance).toEqual(expect.objectContaining({
      osm_nominatim_support: true,
      google_places_support: false,
    }));
  });

  it('verifies an internal hotel only with local/place support and repeated supplier evidence', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      category: 'hotel',
      candidate_key: 'hotel:local',
      raw_label: 'Golden Bay Hotel',
      normalized_label: 'Golden Bay Hotel',
      destination_scope: 'Da Nang',
      country_scope: 'VN',
      region_scope: 'Da Nang',
      evidence_count: 4,
      occurrence_count: 7,
      package_count: 3,
      suggested_master: { label: 'Golden Bay Hotel' },
    }), {
      naverVerifier: async () => ({
        configured: true,
        canonicalName: 'Golden Bay Hotel',
        canonicalNameSource: 'input',
        searchScore: 0.74,
        keywordScore: 0.2,
        overallScore: 0.551,
        searchEvidence: [
          {
            target: 'local',
            query: 'Da Nang Golden Bay Hotel',
            total: 6,
            itemCount: 2,
            matchedItems: 2,
            exactTitleMatches: 1,
            regionMatches: 1,
            addressMatches: 1,
            topTitles: ['Golden Bay Hotel'],
            topLinks: ['https://example.com/hotel'],
          },
        ],
        keywordEvidence: [],
        sources: [
          {
            source: 'naver_search',
            id: 'Golden Bay Hotel',
            url: 'https://search.naver.com/search.naver?query=Golden%20Bay%20Hotel',
            confidence: 0.74,
            name: 'Golden Bay Hotel',
          },
        ],
        attempts: [],
      }),
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('create_internal_master');
    expect(decision.promotionStatus).toBe('auto_internal');
    expect(decision.autoVerificationStatus).toBe('verified_internal');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
  });

  it('keeps blog-only Naver evidence review-gated without Google or local place support', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      raw_label: '보랏빛 야경과 이색적인 시장의 조화 [부이페스트 바자 나이트 마켓]',
      normalized_label: '부이페스트 바자 나이트 마켓',
      destination_scope: '푸꾸옥',
      country_scope: 'VN',
      region_scope: '푸꾸옥',
      evidence_count: 2,
      occurrence_count: 2,
      package_count: 2,
      suggested_master: { label: '부이페스트 바자 나이트 마켓' },
    }), {
      naverVerifier: async () => ({
        configured: true,
        canonicalName: '부이페스트 바자 나이트 마켓',
        canonicalNameSource: 'input',
        searchScore: 0.78,
        keywordScore: 0,
        overallScore: 0.507,
        searchEvidence: [
          {
            target: 'blog',
            query: '푸꾸옥 부이페스트 바자 나이트 마켓',
            total: 80,
            itemCount: 5,
            matchedItems: 3,
            exactTitleMatches: 1,
            regionMatches: 2,
            addressMatches: 0,
            topTitles: ['푸꾸옥 부이페스트 바자 나이트 마켓'],
            topLinks: ['https://example.com/blog'],
          },
        ],
        keywordEvidence: [],
        sources: [
          {
            source: 'naver_search',
            id: '부이페스트 바자 나이트 마켓',
            url: 'https://search.naver.com/search.naver?query=%EB%B6%80%EC%9D%B4%ED%8E%98%EC%8A%A4%ED%8A%B8',
            confidence: 0.78,
            name: '부이페스트 바자 나이트 마켓',
          },
        ],
        attempts: [],
      }),
      wikidataReconciler: async () => [],
    });

    expect(decision.autoVerificationStatus).not.toBe('verified_internal');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
  });

  it('does not verify when Naver canonical name disagrees with the source text', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      raw_label: '매운탕',
      normalized_label: '매운탕',
      destination_scope: '연길/백두산',
      country_scope: 'CN',
      region_scope: '연길/백두산',
      suggested_master: { label: '매운탕' },
    }), {
      naverVerifier: async () => ({
        configured: true,
        canonicalName: '곡성장미축제',
        canonicalNameSource: 'naver_searchad',
        searchScore: 0.96,
        keywordScore: 1,
        overallScore: 0.974,
        searchEvidence: [
          {
            target: 'local',
            query: '곡성장미축제',
            total: 100,
            itemCount: 5,
            matchedItems: 5,
            exactTitleMatches: 2,
            regionMatches: 1,
            addressMatches: 1,
            topTitles: ['곡성장미축제'],
            topLinks: ['https://example.com/festival'],
          },
        ],
        keywordEvidence: [],
        sources: [
          {
            source: 'naver_search',
            id: '곡성장미축제',
            url: 'https://search.naver.com/search.naver?query=%EA%B3%A1%EC%84%B1%EC%9E%A5%EB%AF%B8%EC%B6%95%EC%A0%9C',
            confidence: 0.96,
            name: '곡성장미축제',
          },
        ],
        attempts: [],
      }),
      wikidataReconciler: async () => [],
    });

    expect(decision.autoVerificationStatus).not.toBe('verified_internal');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
  });

  it('auto-rejects generic attraction type labels even with search evidence', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      raw_label: '기념관',
      normalized_label: '기념관',
      suggested_master: { label: '기념관' },
    }), {
      naverVerifier: async () => {
        throw new Error('Naver should be skipped for terminal non-master text');
      },
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('reject_noise');
    expect(decision.promotionStatus).toBe('rejected_noise');
    expect(decision.autoVerificationStatus).toBe('rejected_noise');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
  });

  it('auto-rejects package benefit fragments instead of leaving them for human review', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      raw_label: '나트랑항공권',
      normalized_label: '나트랑항공권',
      suggested_master: { label: '나트랑항공권' },
    }), {
      naverVerifier: async () => {
        throw new Error('Naver should be skipped for terminal non-master text');
      },
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('reject_noise');
    expect(decision.promotionStatus).toBe('rejected_noise');
    expect(decision.autoVerificationStatus).toBe('rejected_noise');
  });

  it('auto-rejects Korean itinerary fragments that are not attraction masters', async () => {
    const labels = [
      '부산항출항',
      '왕복전동차',
      '호이안 디저트 - 반짱느엉 + 못 주스',
      '일본 3대 온천지로 꼽히는 아타미로 이동 후',
      '증편특가',
    ];

    for (const label of labels) {
      const decision = await resolveItineraryEntityCandidate(candidate({
        raw_label: label,
        normalized_label: label,
        suggested_master: { label },
      }), {
        naverVerifier: async () => {
          throw new Error('Naver should be skipped for terminal non-master Korean fragments');
        },
        wikidataReconciler: async () => [],
      });

      expect(decision.autoAction).toBe('reject_noise');
      expect(decision.promotionStatus).toBe('rejected_noise');
      expect(decision.autoVerificationStatus).toBe('rejected_noise');
      expect(decision.suggestedMaster.customer_publishable).toBe(false);
    }
  });

  it('does not reject a clean Korean place name just because raw context has list wording', async () => {
    expect(terminalNonMasterReason(
      'attraction',
      '다딴란 폭포',
      '베트남에서 가장 유명한 다딴란 폭포 등 관광',
    )).toBeNull();
  });

  it('auto-rejects Korean option, metric, room, and multi-entity fragments', () => {
    expect(terminalNonMasterReason('attraction', '사막 진입시 케이블카 또는 버스 이용', '사막 진입시 케이블카 또는 버스 이용'))
      .toBe('activity or operational detail, not an attraction master');
    expect(terminalNonMasterReason('attraction', '5043M', '5043M'))
      .toBe('metric or attribute fragment, not an attraction master');
    expect(terminalNonMasterReason('attraction', '비암산 일송정, 해란강', '비암산 일송정, 해란강'))
      .toBe('multiple entities or option list, not a single attraction master');
    expect(terminalNonMasterReason('hotel', ': 푸꾸옥 뉴월드 - 가든풀빌라 2BED룸', ': 푸꾸옥 뉴월드 - 가든풀빌라 2BED룸'))
      .toBe('hotel operational or room fragment');
  });

  it('keeps clean Korean place names reviewable', () => {
    expect(terminalNonMasterReason('attraction', '시나무런초원', '시나무런 초원')).toBeNull();
    expect(terminalNonMasterReason('attraction', '관운장 사당', '관운장 사당')).toBeNull();
    expect(terminalNonMasterReason('attraction', '베이사이드플레이스', '베이사이드플레이스 관광')).toBeNull();
    expect(terminalNonMasterReason('attraction', '판시판산', '케이블카 탑승 후 판시판산 관광')).toBeNull();
    expect(terminalNonMasterReason('attraction', '아쿠아토피아 워터파크', '아쿠아토피아 워터파크+놀이공원 무제한 이용 가능')).toBeNull();
  });

  it('keeps shopping text review-gated without wasting external search', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      category: 'shopping',
      candidate_key: 'shopping:test',
      raw_label: '라텍스 쇼핑센터 방문',
      normalized_label: '라텍스 쇼핑센터 방문',
    }), {
      naverVerifier: async () => {
        throw new Error('Naver should be skipped for customer disclosure review text');
      },
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('needs_review');
    expect(decision.promotionStatus).toBe('needs_review');
    expect(decision.autoVerificationStatus).toBe('needs_review');
    expect(decision.attempts).toHaveLength(0);
  });

  it('auto-structures low-risk schedule notices without external search', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      category: 'notice',
      candidate_key: 'notice:schedule',
      raw_label: '상기 일정은 현지 사정 및 항공사의 사정에 의해 다소 변동 될 수 있음을 양지하시기 바랍니다',
      normalized_label: '상기 일정은 현지 사정 및 항공사의 사정에 의해 다소 변동 될 수 있음을 양지하시기 바랍니다',
    }), {
      naverVerifier: async () => {
        throw new Error('Naver should be skipped for safe schedule notices');
      },
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('structure_non_master');
    expect(decision.autoVerificationStatus).toBe('template_matched');
    expect(decision.attempts).toHaveLength(0);
  });

  it('auto-structures option fee details without creating a master entity', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      category: 'optional_tour',
      candidate_key: 'optional:fee',
      raw_label: '캐디팁 $20/18홀/인 (현장결제)',
      normalized_label: '캐디팁 $20/18홀/인 (현장결제)',
    }), {
      naverVerifier: async () => {
        throw new Error('Naver should be skipped for source-backed option details');
      },
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('structure_non_master');
    expect(decision.autoVerificationStatus).toBe('structured_non_master');
    expect(decision.suggestedMaster.customer_publishable).toBe(false);
  });

  it('auto-structures room labels instead of creating hotel masters', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      category: 'hotel',
      candidate_key: 'hotel:room',
      raw_label: '2인실-스탠다드',
      normalized_label: '2인실-스탠다드',
    }), {
      naverVerifier: async () => {
        throw new Error('Naver should be skipped for room labels');
      },
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('structure_non_master');
    expect(decision.autoVerificationStatus).toBe('structured_non_master');
  });

  it('auto-structures low-risk preparation notices', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      category: 'notice',
      candidate_key: 'notice:prep',
      raw_label: '준비물 : 수영복',
      normalized_label: '준비물 : 수영복',
    }), {
      naverVerifier: async () => {
        throw new Error('Naver should be skipped for preparation notices');
      },
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('structure_non_master');
    expect(decision.autoVerificationStatus).toBe('template_matched');
  });

  it('auto-structures golf metric fragments', async () => {
    const decision = await resolveItineraryEntityCandidate(candidate({
      category: 'optional_tour',
      candidate_key: 'optional:golf-metric',
      raw_label: '7508야드',
      normalized_label: '7508야드',
    }), {
      naverVerifier: async () => {
        throw new Error('Naver should be skipped for golf metrics');
      },
      wikidataReconciler: async () => [],
    });

    expect(decision.autoAction).toBe('structure_non_master');
    expect(decision.autoVerificationStatus).toBe('structured_non_master');
  });
});
