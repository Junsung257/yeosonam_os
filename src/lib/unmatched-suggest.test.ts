import { describe, expect, it } from 'vitest';
import { suggestAttractionsForActivity } from './unmatched-suggest';

describe('suggestAttractionsForActivity', () => {
  it('높은 점수 exact 매칭 반환', () => {
    const out = suggestAttractionsForActivity(
      '▶도이인타논으로 이동 [1시간]',
      [
        {
          id: '1',
          name: '도이인타논 산',
          aliases: ['도이인타논'],
          region: '치앙마이',
          country: '태국',
          category: 'nature',
          emoji: '⛰️',
          short_desc: '치앙마이 최고봉',
        },
      ],
      30,
      3,
    );
    expect(out.suggestions.length).toBeGreaterThan(0);
    expect(out.suggestions[0].name).toContain('도이인타논');
  });
});
