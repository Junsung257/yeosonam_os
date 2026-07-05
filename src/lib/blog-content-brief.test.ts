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
    expect(brief.title).toBe('보라카이 7월 날씨 옷차림 여행 준비물 체크리스트');
    expect(brief.primaryKeyword).toBe('보라카이 7월 날씨');
    expect(brief.secondaryKeywords).toEqual(
      expect.arrayContaining(['보라카이 7월 옷차림', '보라카이 여행 준비물', '보라카이 7월 우기']),
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
    expect(brief.primaryKeyword).toBe('다낭 7월 날씨');
    expect(brief.requiredSections).toEqual(
      expect.arrayContaining([
        '다낭 7월 날씨 한눈에 보기',
        '7월 기온/강수/습도 표',
        '다낭 7월 옷차림',
        '다낭 여행 준비물 체크리스트',
      ]),
    );
    expect(buildBlogContentBriefPromptBlock(brief)).toContain('Required H2 sections');
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

    expect(brief.searchIntent).toBe('cost');
    expect(brief.title).toBe('몽골 공항 픽업 이동비');
    expect(brief.requiredSections).toEqual(
      expect.arrayContaining(['비용 핵심 요약', '항목별 예산 표', '추가 비용']),
    );
    expect(brief.requiredSections).not.toEqual(
      expect.arrayContaining(['월별/시즌별 표', '옷차림']),
    );
  });
});
