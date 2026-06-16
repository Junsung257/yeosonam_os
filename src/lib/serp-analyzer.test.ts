import { describe, expect, it } from 'vitest';
import { buildSerpPromptBlock, parseGoogleSuggestPayload, type SerpAnalysis } from './serp-analyzer';

describe('serp analyzer free fallback', () => {
  it('parses Google Suggest firefox payload into intent snippets', () => {
    const snippets = parseGoogleSuggestPayload(
      ['보라카이 7월', ['보라카이 7월 날씨', '보라카이 7월 옷차림', '보라카이 7월 준비물']],
      '보라카이 7월',
    );

    expect(snippets).toHaveLength(3);
    expect(snippets[0]).toMatchObject({
      rank: 1,
      title: '보라카이 7월 날씨',
    });
    expect(snippets[0].url).toContain('google.com/search');
  });

  it('marks prompt blocks from free suggest as intent guidance, not ranking proof', () => {
    const analysis: SerpAnalysis = {
      keyword: '보라카이 7월 날씨',
      source: 'naver_blog',
      signal_source: 'free_google_suggest',
      fetched_at: new Date('2026-06-16T00:00:00.000Z').toISOString(),
      cached: false,
      avg_title_len: 18,
      power_words: [],
      year_inclusion_rate: 0,
      bracket_rate: 0,
      entities: [],
      recommended_title_patterns: [],
      recommended_entities_to_include: [],
    };

    const block = buildSerpPromptBlock(analysis);

    expect(block).toContain('free Google Suggest fallback');
    expect(block).toContain('not ranking proof');
  });
});
