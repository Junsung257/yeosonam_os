import { describe, expect, it } from 'vitest';
import { normalizeSeasonalTopicSeed } from './blog-seasonal-calendar';

describe('blog seasonal calendar', () => {
  it('normalizes destination-month lodging tangents into weather clothing preparation intent', () => {
    const seed = normalizeSeasonalTopicSeed({
      year_month: '2026-07',
      topic: '7월 필리핀 보라카이, 에어컨 없는 숙소 괜찮을까?',
      destination: '보라카이',
      keywords: ['보라카이 7월', '보라카이 숙소 추천', '필리핀 날씨'],
      season_tag: '여름',
    });

    expect(seed.topic).toBe('보라카이 7월 날씨와 옷차림 여행 준비물 체크리스트');
    expect(seed.keywords).toEqual([
      '보라카이 7월 날씨',
      '보라카이 7월 옷차림',
      '보라카이 여행 준비물',
      '보라카이 7월',
    ]);
  });
});
