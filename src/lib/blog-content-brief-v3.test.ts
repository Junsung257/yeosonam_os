import { describe, expect, it } from 'vitest';
import { assertNoFabricatedExperienceV3, buildBlogContentBriefV3 } from './blog-content-brief-v3';

const details = [1, 2, 3].map((n) => ({ text: `destination detail ${n}`, evidenceId: `evidence-${n}` }));

describe('flexible blog content brief v3', () => {
  it.each([
    ['오사카 숙소 위치', 'neighborhood_selector'],
    ['간사이공항에서 난바 이동', 'route_walkthrough'],
    ['ETIAS 변경', 'current_change_explainer'],
    ['부모님과 장가계', 'traveler_type_plan'],
    ['다낭 4박5일 비용', 'budget_scenarios'],
  ] as const)('selects %s by intent and evidence', (topic, archetype) => {
    expect(buildBlogContentBriefV3({ topic, destinationDecisionDetails: details }).archetype).toBe(archetype);
  });

  it('defaults FAQ, checklist, year and image minimum off', () => {
    expect(buildBlogContentBriefV3({ topic: '오사카 첫 여행', destinationDecisionDetails: details })).toMatchObject({
      includeFaq: false,
      includeChecklist: false,
      includeYearInTitle: false,
      imageMinimum: 0,
    });
  });

  it('requires three evidence-backed destination details', () => {
    expect(buildBlogContentBriefV3({ topic: '오사카 숙소 위치' })).toMatchObject({
      passed: false,
      issues: ['destination_specific_evidence_below_three'],
    });
  });

  it('blocks invented first-party experience language', () => {
    expect(assertNoFabricatedExperienceV3('지난달 다녀온 지인이 좋다고 말했다.', [])).not.toHaveLength(0);
    expect(assertNoFabricatedExperienceV3('운영팀이 직접 확인했다.', ['field-note-1'])).toEqual([]);
  });
});
