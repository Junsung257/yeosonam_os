import { describe, expect, it } from 'vitest';
import { buildBlogContentBrief, buildBlogContentBriefPromptBlock } from './blog-content-brief';

describe('blog content brief', () => {
  it('rewrites destination-month lodging tangents into weather clothing preparation briefs', () => {
    const brief = buildBlogContentBrief({
      topic: '7월 필리핀 보라카이, 에어컨 없는 숙소 괜찮을까?',
      destination: '보라카이',
      primaryKeyword: '보라카이 7월',
      source: 'seasonal',
      keywords: ['보라카이 7월', '보라카이 숙소 추천', '7월 보라카이 날씨'],
    });

    expect(brief.passed).toBe(true);
    expect(brief.title).toBe('보라카이 7월 날씨');
    expect(brief.primaryKeyword).toBe('보라카이 7월 날씨');
    expect(brief.intentType).toBe('monthly_weather');
    expect(brief.requiresHumanReview).toBe(false);
    expect(brief.requiredSections).toContain('1~12월 평균 기온');
    expect(brief.secondaryKeywords).toEqual(
      expect.arrayContaining(['보라카이 7월 옷차림', '보라카이 7월 우기']),
    );
    expect(brief.forbiddenAngles.join(' ')).toContain('에어컨 없는 숙소');
  });

  it('builds a strict weather brief for longtail travel preparation keywords', () => {
    const brief = buildBlogContentBrief({
      topic: '다낭 7월 여행 준비물 옷차림 날씨 우기',
      destination: '다낭',
      primaryKeyword: '다낭 7월 여행 준비물 옷차림 날씨 우기',
      source: 'gsc_longtail',
      keywords: ['다낭 7월 날씨', '다낭 7월 옷차림', '다낭 우기 준비물'],
    });

    expect(brief.searchIntent).toBe('weather');
    expect(brief.intentType).toBe('monthly_weather');
    expect(brief.primaryKeyword).toBe('다낭 7월 날씨');
    expect(brief.requiredSections).toEqual(
      expect.arrayContaining([
        '1~12월 평균 기온',
        '강수량 또는 강수일',
        '월별 옷차림',
        '기후 평년값 관측 기간과 출처',
      ]),
    );
    expect(buildBlogContentBriefPromptBlock(brief)).toContain('not fixed H2 headings');
    expect(brief.claimLedgerPolicy.required).toBe(true);
    expect(brief.claimLedgerPolicy.candidateKinds).toContain('money_price');
  });

  it('prioritizes transport cost intent over stale weather metadata', () => {
    const brief = buildBlogContentBrief({
      topic: '몽골 공항 픽업 이동비 비교',
      destination: '몽골',
      primaryKeyword: '몽골 공항 픽업 이동비',
      category: 'weather',
      source: 'coverage_gap',
      keywords: ['몽골 렌터카 비용', '몽골 택시 요금', '몽골 공항 픽업'],
    });

    expect(brief.searchIntent).toBe('transport');
    expect(brief.intentType).toBe('airport_transport');
    expect(brief.title).toBe('몽골 공항 픽업 이동비');
    expect(brief.requiredSections).toEqual(
      expect.arrayContaining(['이동수단 비교', '성인·아동·수하물 요금', '공식 운영사 링크와 확인일']),
    );
    expect(brief.requiredSections).not.toEqual(
      expect.arrayContaining(['월별/시즌별 표', '옷차림']),
    );
  });

  it('exposes human-review and source policy for regulated information intent', () => {
    const brief = buildBlogContentBrief({
      topic: '일본 비자 입국 신고와 세관 조건',
      destination: '일본',
      primaryKeyword: '일본 입국 조건',
      category: 'entry',
      keywords: ['일본 비자', '일본 입국 신고', '일본 세관'],
      travelerNationality: 'KR',
    });

    expect(brief.intentType).toBe('entry_requirements');
    expect(brief.requiresHumanReview).toBe(true);
    expect(brief.sourcePolicy.minimumClaimSourceCoverage).toBe(1);
    expect(brief.sourcePolicy.primarySourcesRequired).toBe(true);
    expect(buildBlogContentBriefPromptBlock(brief)).toContain('Human review required: yes');
    expect(brief.requiredSections).toContain('정부·대사관·공항·세관 1차 출처');
  });

  it('keeps tables optional and forbids invented values for food-budget articles', () => {
    const brief = buildBlogContentBrief({
      topic: '삿포로 식비와 하루 음식 예산',
      destination: '삿포로',
      primaryKeyword: '삿포로 식비',
      category: 'cost',
      microAngle: 'food_budget',
    });
    const prompt = buildBlogContentBriefPromptBlock(brief);

    expect(brief.intentType).toBe('food_budget');
    expect(prompt).toContain('Tables: optional; use only when every cell is supported');
    expect(prompt).toContain('FAQ: default off');
    expect(prompt).toContain('No deterministic length filling');
    expect(prompt).not.toContain('exactly three data rows');
  });

  it('fails closed before writing when a regulated plan is missing traveler nationality', () => {
    const brief = buildBlogContentBrief({
      topic: '일본 비자 입국 신고와 세관 조건',
      destination: '일본',
      primaryKeyword: '일본 입국 조건',
      category: 'entry',
    });

    expect(brief.passed).toBe(false);
    expect(brief.plan.missingInputs).toContain('traveler_nationality');
    expect(brief.issues).toContain('information_plan:traveler_nationality');
  });
});
