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

  it('does not match a short Korean place name inside a longer unrelated word', () => {
    const out = suggestAttractionsForActivity(
      '각종 동물쇼와 새공원등 다채로운 볼거리 가득한 빈펄 사파리.',
      [
        {
          id: 'sapa',
          name: '사파',
          aliases: [],
          region: '사파',
          country: 'VN',
          category: 'tour',
          emoji: null,
          short_desc: '베트남 북부 산악 여행지',
        },
      ],
      30,
      3,
    );
    expect(out.suggestions).toEqual([]);
  });

  it('ignores generic aliases that would attach the wrong destination', () => {
    const out = suggestAttractionsForActivity(
      '천저우의 고즈넉한 야경 유후거리',
      [
        {
          id: 'dalat-night-market',
          name: '달랏야시장',
          aliases: ['야경', '시내'],
          region: '달랏',
          country: 'VN',
          category: 'tour',
          emoji: null,
          short_desc: '달랏 중심 야시장',
        },
      ],
      30,
      3,
    );
    expect(out.suggestions).toEqual([]);
  });

  it('ignores polluted sentence-like aliases from existing attraction data', () => {
    const out = suggestAttractionsForActivity(
      '동경 최대 번화가 신주쿠 시내관광',
      [
        {
          id: 'dalat-night-market',
          name: '달랏야시장',
          aliases: ['동경 최대 번화가 신주쿠 시내'],
          region: '달랏',
          country: 'VN',
          category: 'tour',
          emoji: null,
          short_desc: '달랏 중심 야시장',
        },
      ],
      30,
      3,
    );
    expect(out.suggestions).toEqual([]);
  });

  it('ignores destination plus generic experience aliases from unrelated attractions', () => {
    const out = suggestAttractionsForActivity(
      '호이안 야경투어+소원등&소원배 체험',
      [
        {
          id: 'dalat-night-market',
          name: '달랏야시장',
          aliases: ['호이안 야경'],
          region: null,
          country: 'VN',
          category: 'tour',
          emoji: null,
          short_desc: '달랏 중심 야시장',
        },
      ],
      30,
      3,
    );
    expect(out.suggestions).toEqual([]);
  });

  it('does not rely on descriptive aliases when the attraction name itself is too broad', () => {
    const out = suggestAttractionsForActivity(
      '협곡을 한번에 볼 수 있는 보천대협곡',
      [
        {
          id: 'baoquan',
          name: '보천',
          aliases: ['협곡을 한번에 볼 수 있는 보천대협곡'],
          region: '정저우',
          country: 'CN',
          category: 'nature',
          emoji: null,
          short_desc: '중국 협곡 관광지',
        },
      ],
      30,
      3,
    );
    expect(out.suggestions).toEqual([]);
  });

  it('still matches descriptive schedule text when the canonical attraction name is specific', () => {
    const out = suggestAttractionsForActivity(
      '협곡을 한번에 볼 수 있는 보천대협곡',
      [
        {
          id: 'baoquan-grand-canyon',
          name: '보천대협곡',
          aliases: [],
          region: '정저우',
          country: 'CN',
          category: 'nature',
          emoji: null,
          short_desc: '중국 협곡 관광지',
        },
      ],
      30,
      3,
    );
    expect(out.suggestions[0]).toMatchObject({
      id: 'baoquan-grand-canyon',
      matched_via: 'exact',
      matched_term: '보천대협곡',
    });
  });

  it('still returns exact attraction names embedded in longer schedule text', () => {
    const out = suggestAttractionsForActivity(
      '협곡과 호수 원시림, 자연을 느낄수 있는 고의령 등정',
      [
        {
          id: 'gaoyiling',
          name: '고의령',
          aliases: [],
          region: '광저우',
          country: 'CN',
          category: 'tour',
          emoji: null,
          short_desc: '광저우 근교 절경',
        },
      ],
      30,
      3,
    );
    expect(out.suggestions[0]).toMatchObject({
      id: 'gaoyiling',
      matched_via: 'exact',
      matched_term: '고의령',
    });
  });
});
