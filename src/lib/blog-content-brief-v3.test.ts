import { describe, expect, it } from 'vitest';
import { assertNoFabricatedExperienceV3, buildBlogContentBriefV3 } from './blog-content-brief-v3';
import type { SerpResearchPacketV3 } from './blog-serp-research-v3';

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

  it('uses mistake prevention only when preparation is the actual query intent', () => {
    const brief = buildBlogContentBriefV3({
      topic: '몽골 여행 준비물 체크 리스트',
      primaryKeyword: '몽골 여행 준비물 체크 리스트',
      destination: '몽골',
      destinationDecisionDetails: details,
    });

    expect(brief.archetype).toBe('mistake_prevention');
    expect(brief.includeChecklist).toBe(true);
    expect(brief.includeFaq).toBe(false);
    expect(brief.includeTable).toBe(false);
  });

  it('requires three evidence-backed destination details', () => {
    expect(buildBlogContentBriefV3({ topic: '오사카 숙소 위치' })).toMatchObject({
      passed: false,
      issues: ['destination_specific_evidence_below_three'],
    });
  });

  it('builds decision-first structures for the first operating candidates', () => {
    const weather = buildBlogContentBriefV3({
      topic: '다낭 10월 날씨', primaryKeyword: '다낭 10월 날씨', destination: '다낭',
      destinationDecisionDetails: details,
    });
    const attractions = buildBlogContentBriefV3({
      topic: '다낭 가볼만한곳', primaryKeyword: '다낭 가볼만한곳', destination: '다낭',
      destinationDecisionDetails: details,
    });
    const hotels = buildBlogContentBriefV3({
      topic: '세부 호텔 추천', primaryKeyword: '세부 호텔 추천', destination: '세부',
      destinationDecisionDetails: details,
    });

    expect(weather.title).toBe('다낭 10월 날씨, 여행해도 괜찮을까?');
    expect(weather.sections).toContain('우천 시 실행 가능한 대안을 제시한다');
    expect(weather.includeTwelveMonthTable).toBe(false);
    expect(attractions.archetype).toBe('decision_comparison');
    expect(attractions.sections).toContain('함께 묶을 수 있는 동선을 제시한다');
    expect(hotels.archetype).toBe('neighborhood_selector');
    expect(hotels.sections[0]).toBe('개별 호텔보다 숙소 지역을 먼저 고르게 한다');
  });

  it('keeps H1, metadata and OG title fixed to one deterministic variant', () => {
    const brief = buildBlogContentBriefV3({
      topic: '세부 호텔 추천', primaryKeyword: '세부 호텔 추천', destination: '세부',
      destinationDecisionDetails: details,
    });
    expect(brief.title).toBe(brief.metadata.title);
    expect(brief.metadata.ogTitle).toBe(brief.metadata.title);
    expect(brief.metadata.description.length).toBeGreaterThanOrEqual(80);
    expect(brief.metadata.description.length).toBeLessThanOrEqual(150);
    expect(brief.title).not.toMatch(/2026|완벽|총정리|BEST/i);
  });

  it('blocks invented first-party experience language', () => {
    expect(assertNoFabricatedExperienceV3('지난달 다녀온 지인이 좋다고 말했다.', [])).not.toHaveLength(0);
    expect(assertNoFabricatedExperienceV3('운영팀이 직접 확인했다.', ['field-note-1'])).toEqual([]);
  });

  it('routes a broad destination query to representative refresh instead of a new URL', () => {
    const serpResearch = {
      queryCluster: { primaryQuery: '다낭 여행', secondaryQueries: [], tier: 'broad', destination: '다낭' },
      intent: 'destination_overview',
      archetypeCandidates: ['direct_answer'],
    } as unknown as SerpResearchPacketV3;
    const brief = buildBlogContentBriefV3({
      topic: '다낭 여행', primaryKeyword: '다낭 여행', destination: '다낭',
      destinationDecisionDetails: details, serpResearch,
    });
    expect(brief.publicationStrategy).toBe('refresh_representative');
  });
});
