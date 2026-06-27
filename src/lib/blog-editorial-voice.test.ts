import { describe, expect, it } from 'vitest';
import {
  buildInfoGuideBrief,
  buildInfoWriterPromptBlock,
  buildProductConsultantPromptBlock,
  buildProductConsultBrief,
} from './blog-editorial-voice';
import { buildProductBlogBrief } from './blog-product-brief';
import type { BlogContentBrief } from './blog-content-brief';

describe('blog editorial voice contracts', () => {
  it('builds an answer-first info writer prompt', () => {
    const contentBrief: BlogContentBrief = {
      title: '발리 가족 여행 경비',
      primaryKeyword: '발리 가족 여행 경비',
      secondaryKeywords: ['발리 3인 가족 경비'],
      searchIntent: 'cost',
      readerQuestion: '발리 가족 여행은 얼마를 준비해야 하나요?',
      requiredSections: ['항공/숙소 비용', '현지 지출'],
      forbiddenAngles: [],
      sourceRequirements: [],
      titleCandidates: [],
      evidence: [],
      passed: true,
      issues: [],
    };

    const brief = buildInfoGuideBrief(contentBrief);
    const prompt = buildInfoWriterPromptBlock(brief);

    expect(brief.cta_policy).toBe('bottom_soft');
    expect(brief.official_sources_required).toBe(true);
    expect(prompt).toContain('Writer: info_writer');
    expect(prompt).toContain('first 120-180 Korean characters');
    expect(prompt).toContain('bottom only');
    expect(prompt).toContain('You are not a product salesperson');
  });

  it('builds a product consultant prompt from product facts', () => {
    const productBrief = buildProductBlogBrief({
      id: 'pkg_123',
      title: '발리 가족 패키지',
      destination: '발리',
      duration: 5,
      price: 899000,
      inclusions: ['항공', '호텔'],
      excludes: ['개인경비'],
    }, 'value');
    const consultBrief = buildProductConsultBrief(productBrief);
    const prompt = buildProductConsultantPromptBlock(consultBrief);

    expect(prompt).toContain('Writer: product_consultant_writer');
    expect(prompt).toContain('10-second judgement');
    expect(prompt).toContain('fit_for/not_fit_for');
    expect(prompt).toContain('Never invent hotels');
    expect(consultBrief.included).toEqual(['항공', '호텔']);
    expect(consultBrief.excluded).toEqual(['개인경비']);
  });
});
