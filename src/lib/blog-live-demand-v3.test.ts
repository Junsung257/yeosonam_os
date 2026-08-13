import { describe, expect, it } from 'vitest';
import { enrichBlogDemandWithNaverV3 } from './blog-live-demand-v3';

describe('enrichBlogDemandWithNaverV3', () => {
  it('keeps monthly volume and relative trend as separate observed signals', async () => {
    const result = await enrichBlogDemandWithNaverV3({}, '다낭 10월 날씨', {
      fetchKeywordDemand: async () => [{
        provider: 'naver_search_ads', metric: 'monthly_total_searches', value: 840,
        unit: 'searches_per_month', valueKind: 'provider_estimate', sourceReference: 'keyword-tool',
      }],
      fetchTrendDemand: async () => [{
        provider: 'naver_datalab', metric: 'relative_trend_index', value: 61.4,
        unit: 'relative_index_0_100', valueKind: 'relative_index', sourceReference: 'datalab',
      }],
    });

    expect(result.signal.monthlySearchVolume).toBe(840);
    expect(result.signal.trendScore).toBe(61.4);
    expect(result.acceptedProviders).toEqual([
      'search_volume:naver_search_ads',
      'search_trend:naver_datalab',
    ]);
  });

  it('does not turn empty, zero, or failed providers into verified demand', async () => {
    const result = await enrichBlogDemandWithNaverV3({}, '세부 호텔 추천', {
      fetchKeywordDemand: async () => [],
      fetchTrendDemand: async () => [{
        provider: 'naver_datalab', metric: 'relative_trend_index', value: 0,
        unit: 'relative_index_0_100', valueKind: 'relative_index', sourceReference: 'datalab',
      }],
    });

    expect(result.signal.monthlySearchVolume).toBeNull();
    expect(result.signal.trendScore).toBeNull();
    expect(result.acceptedProviders).toEqual([]);
  });
});
