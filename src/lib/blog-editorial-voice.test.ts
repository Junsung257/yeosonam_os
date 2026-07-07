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
    expect(brief.information_risk).toBe('medium');
    expect(prompt).toContain('Writer: info_writer');
    expect(prompt).toContain('first 120-180 Korean characters');
    expect(prompt).toContain('Internally analyze the title promise');
    expect(prompt).toContain('Do not invent prices');
    expect(prompt).toContain('Headings must be specific to the query');
    expect(prompt).toContain('Keep Markdown, source links, and valid tables');
    expect(prompt).toContain('bottom only');
    expect(prompt).toContain('You are not a product salesperson');
  });

  it('uses a natural Korean topic particle in info answer-first guidance', () => {
    const contentBrief: BlogContentBrief = {
      title: '몽골 7월 날씨 옷차림',
      primaryKeyword: '몽골 7월 날씨',
      secondaryKeywords: [],
      searchIntent: 'weather',
      readerQuestion: '몽골 7월 날씨와 옷차림은 어떻게 준비하나요?',
      requiredSections: ['기온과 일교차', '옷차림'],
      forbiddenAngles: [],
      sourceRequirements: [],
      titleCandidates: [],
      evidence: [],
      passed: true,
      issues: [],
    };

    const brief = buildInfoGuideBrief(contentBrief);

    expect(brief.answer_first).toContain('몽골 7월 날씨는 먼저');
    expect(brief.answer_first).not.toContain('날씨은');
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
    expect(prompt).toContain('Keep source fidelity');
    expect(prompt).toContain('Remove customer-hidden business data');
    expect(prompt).toContain('guide/driver fee');
    expect(prompt).toContain('Explain choices factually');
    expect(consultBrief.included).toEqual(['항공', '호텔']);
    expect(consultBrief.excluded).toEqual(['개인경비']);
  });
});
