import { describe, expect, it } from 'vitest';
import { normalizeBlogAngleType, normalizeBlogTopicQueueRow } from './blog-queue-normalize';

describe('blog queue normalization', () => {
  it('maps producer-only angle labels to valid content angles', () => {
    expect(normalizeBlogAngleType('trend')).toBe('value');
    expect(normalizeBlogAngleType('longtail')).toBe('value');
    expect(normalizeBlogAngleType('family')).toBe('filial');
    expect(normalizeBlogAngleType('itinerary')).toBe('activity');
    expect(normalizeBlogAngleType('food')).toBe('food');
  });

  it('moves non-table search intent into meta and preserves raw angle labels', () => {
    const row = normalizeBlogTopicQueueRow({
      topic: '다낭 7월 여행 준비물',
      source: 'gsc_longtail',
      angle_type: 'longtail',
      search_intent: 'informational',
      meta: { keyword: '다낭 7월 여행 준비물' },
    });

    expect(row.angle_type).toBe('value');
    expect(row).not.toHaveProperty('search_intent');
    expect(row.meta.search_intent).toBe('informational');
    expect(row.meta.raw_angle_type).toBe('longtail');
  });
});
