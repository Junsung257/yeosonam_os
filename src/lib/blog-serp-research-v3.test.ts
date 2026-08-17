import { describe, expect, it, vi } from 'vitest';
import {
  BLOG_SERP_RESEARCH_VERSION,
  findCompetitorPhraseMatchesV3,
  parseNaverSearchCount,
  prioritizeBlogSerpInitialCandidatesV3,
  researchSerpNaverFirstV3,
  type SerpDemandSignalV3,
  type SerpEditorialResultV3,
} from './blog-serp-research-v3';

const now = new Date('2026-08-14T00:00:00.000Z');

function result(rank: number, source: 'naver_blog' | 'naver_web' = 'naver_blog'): SerpEditorialResultV3 {
  return {
    sampleRank: rank,
    providerRank: rank,
    source,
    title: rank % 2
      ? '세부 호텔 추천 막탄과 세부시티 지역 비교'
      : '세부 가족여행 숙소 위치와 공항 이동',
    url: `https://example${rank}.com/post`,
    domain: `example${rank}.com`,
    snippet: '가족과 커플 유형에 따라 지역 장단점, 공항 이동 시간, 예약 조건을 비교합니다.',
    publishedAt: '2026-08-01T00:00:00.000Z',
  };
}

const monthlyDemand: SerpDemandSignalV3[] = [{
  provider: 'naver_search_ads',
  metric: 'monthly_total_searches',
  value: 4_200,
  unit: 'searches_per_month',
  valueKind: 'provider_estimate',
  sourceReference: 'keywordstool',
}];

describe('Naver-first SERP research V3', () => {
  it('keeps monthly volume, relative trend and GSC observations as separate signals', async () => {
    const persist = vi.fn(async () => undefined);
    const packet = await researchSerpNaverFirstV3({ primaryQuery: '세부 호텔 추천' }, {
      now: () => now,
      readCached: async () => null,
      fetchNaverResults: async () => Array.from({ length: 10 }, (_, index) => result(index + 1, index % 2 ? 'naver_web' : 'naver_blog')),
      fetchNaverKeywordDemand: async () => monthlyDemand,
      fetchNaverTrend: async () => [{
        provider: 'naver_datalab', metric: 'relative_trend_index', value: 63,
        unit: 'relative_index_0_100', valueKind: 'relative_index', sourceReference: 'datalab',
      }],
      fetchGscDemand: async () => [{
        provider: 'google_search_console', metric: 'impressions', value: 122,
        unit: 'impressions_90d', valueKind: 'observed', sourceReference: 'gsc',
      }],
      persist,
    });

    expect(packet.version).toBe(BLOG_SERP_RESEARCH_VERSION);
    expect(packet.mode).toBe('fresh');
    expect(packet.intent).toBe('hotel_area_selection');
    expect(packet.archetypeCandidates[0]).toBe('neighborhood_selector');
    expect(packet.demandSignals.map((signal) => signal.unit)).toEqual([
      'searches_per_month', 'relative_index_0_100', 'impressions_90d',
    ]);
    expect(packet.serpFeatures).toMatchObject({ editorialResultCount: 10, naverBlogCount: 5, naverWebCount: 5 });
    expect(packet.consensus.map((entry) => entry.purpose)).toContain('지역을 먼저 선택');
    expect(packet.verifiedDemand).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('continues in fallback mode when editorial results are unavailable but observed demand exists', async () => {
    const packet = await researchSerpNaverFirstV3({ primaryQuery: '다낭 10월 날씨', persist: false }, {
      now: () => now,
      readCached: async () => null,
      fetchNaverResults: async () => [],
      fetchNaverKeywordDemand: async () => [],
      fetchNaverTrend: async () => [{
        provider: 'naver_datalab', metric: 'relative_trend_index', value: 41,
        unit: 'relative_index_0_100', valueKind: 'relative_index', sourceReference: 'datalab',
      }],
      fetchGscDemand: async () => [],
    });

    expect(packet.mode).toBe('fallback_only');
    expect(packet.verifiedDemand).toBe(true);
    expect(packet.intent).toBe('weather_travel_viability');
  });

  it('reports unavailable instead of treating empty providers as success', async () => {
    const packet = await researchSerpNaverFirstV3({ primaryQuery: '미관측 여행 질문', persist: false }, {
      now: () => now,
      readCached: async () => null,
      fetchNaverResults: async () => [],
      fetchNaverKeywordDemand: async () => [],
      fetchNaverTrend: async () => [],
      fetchGscDemand: async () => [],
    });
    expect(packet.mode).toBe('unavailable');
    expect(packet.verifiedDemand).toBe(false);
  });

  it('does not invent a count for the provider bucket below ten', () => {
    expect(parseNaverSearchCount('< 10')).toBeNull();
    expect(parseNaverSearchCount('1,230')).toBe(1230);
  });

  it('blocks twelve-token overlap with a competitor title/snippet sample', () => {
    const competitor = result(1);
    competitor.snippet = '막탄 공항에서 가까운 숙소를 고르면 첫날 이동 시간이 줄고 아이와 쉬기 편합니다 예약 조건도 확인하세요';
    expect(findCompetitorPhraseMatchesV3(competitor.snippet, [competitor])).toHaveLength(1);
    expect(findCompetitorPhraseMatchesV3('막탄과 세부시티는 일정에 따라 선택 기준이 달라집니다.', [competitor])).toEqual([]);
  });

  it('keeps the three approved operating candidates in deterministic order when queued', () => {
    const ordered = prioritizeBlogSerpInitialCandidatesV3([
      { primary_keyword: '기타 여행 질문' },
      { primary_keyword: '세부 호텔 추천' },
      { primary_keyword: '다낭 10월 날씨' },
      { primary_keyword: '다낭 가볼만한곳' },
    ]);
    expect(ordered.map((row) => row.primary_keyword)).toEqual([
      '다낭 10월 날씨', '다낭 가볼만한곳', '세부 호텔 추천', '기타 여행 질문',
    ]);
  });
});
