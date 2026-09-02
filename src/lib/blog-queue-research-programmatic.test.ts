import { describe, expect, it } from 'vitest';
import {
  buildQueuedInformationBrief,
  evaluateQueuedInformationResearch,
} from './blog-queue-research';

describe('programmatic queue research compatibility', () => {
  it('derives itinerary, audience and content key for legacy programmatic rows', () => {
    const row = {
      topic: '세부 신혼여행 추천 코스와 호텔',
      destination: '세부',
      primary_keyword: '세부 신혼여행',
      category: 'travel_tips',
      angle_type: 'honeymoon',
      source: 'coverage_gap',
      meta: {
        programmatic_source_id: 'legacy-cebu-honeymoon',
        programmatic_angle: 'honeymoon',
      },
    };

    const brief = buildQueuedInformationBrief(row);
    const readiness = evaluateQueuedInformationResearch(row);

    expect(brief.intentType).toBe('itinerary');
    expect(brief.plan.audience).toBe('couple');
    expect(readiness.passed).toBe(false);
    expect(readiness.issues).not.toContain('research_expected_content_key_missing');
  });
});
