import { describe, expect, it } from 'vitest';
import { buildBlogInformationPlan } from './blog-information-planner';

describe('blog information planner', () => {
  it.each([
    ['삿포로 식비', '삿포로', 'food_budget', 'LOW'],
    ['광저우 월별 날씨', '광저우', 'monthly_weather', 'MEDIUM'],
    ['오사카 공항 이동', '오사카', 'airport_transport', 'MEDIUM'],
    ['캐나다 로키 대중교통', '캐나다 로키산맥', 'local_transport', 'MEDIUM'],
    ['대만 숙소 지역', '대만', 'hotel_areas', 'LOW'],
    ['싱가포르 가족 예산', '싱가포르', 'family_budget', 'LOW'],
  ] as const)('builds a distinct complete plan for %s', (topic, destination, intent, riskLevel) => {
    const plan = buildBlogInformationPlan({ topic, destination, primaryKeyword: topic });
    expect(plan.passed).toBe(true);
    expect(plan.intent).toBe(intent);
    expect(plan.riskLevel).toBe(riskLevel);
    expect(plan.destinationId).toBe(destination.replace(/\s+/g, '-'));
    expect(plan.requiredFacts.length).toBeGreaterThanOrEqual(4);
    expect(plan.plannedTables.length).toBeGreaterThan(0);
    expect(plan.faqQuestions).toHaveLength(3);
    expect(plan.missingInputs).toEqual([]);
  });

  it('infers a family audience independently from intent', () => {
    const plan = buildBlogInformationPlan({
      topic: '싱가포르 아이와 가족여행 예산',
      destination: '싱가포르',
    });
    expect(plan.audience).toBe('family');
    expect(plan.intent).toBe('family_budget');
  });

  it('blocks entry planning until traveler nationality is known', () => {
    const blocked = buildBlogInformationPlan({
      topic: '일본 입국 비자 조건',
      destination: '일본',
    });
    expect(blocked.intent).toBe('entry_requirements');
    expect(blocked.riskLevel).toBe('HIGH');
    expect(blocked.passed).toBe(false);
    expect(blocked.missingInputs).toContain('traveler_nationality');

    const ready = buildBlogInformationPlan({
      topic: '한국인 일본 입국 비자 조건',
      destination: '일본',
    });
    expect(ready.travelerNationality).toBe('KR');
    expect(ready.passed).toBe(true);
  });

  it('fails closed for invalid destinations instead of producing a generic plan', () => {
    const plan = buildBlogInformationPlan({ topic: '대학생 공항 이동', destination: '대학생' });
    expect(plan.passed).toBe(false);
    expect(plan.destinationId).toBeNull();
    expect(plan.missingInputs).toContain('contract:audience_destination');
  });
});
