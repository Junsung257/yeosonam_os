import { describe, expect, it } from 'vitest';
import { classifyBlogFreshnessRisk } from './blog-freshness-risk';

describe('blog freshness risk', () => {
  it.each([
    '해외여행 약',
    '처방약 해외 반입',
    '여행용 상비약과 복용법',
    'travel medication rules',
  ])('treats medication information as high risk: %s', (topic) => {
    expect(classifyBlogFreshnessRisk(topic)).toMatchObject({
      level: 'high',
      topics: expect.arrayContaining(['medical']),
      requiresOfficialSources: true,
      suggestedReviewDays: 14,
    });
  });

  it('does not classify reservation terms as medical information', () => {
    expect(classifyBlogFreshnessRisk('여행 예약 약관 안내')).toMatchObject({ level: 'low' });
  });
});
