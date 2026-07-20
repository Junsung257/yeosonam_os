import { describe, expect, it } from 'vitest';
import { inspectBlogRenderedSeoQuality } from './blog-rendered-seo-quality';

const BASE = {
  slug: 'sapporo-food-budget',
  title: '삿포로 식비 예산 가이드',
  description: '삿포로 식비 예산과 음식 가격 기준을 한눈에 정리합니다.',
  destination: '삿포로',
};

describe('informational rendered SEO quality', () => {
  it('accepts one public H1, a complete table and matching structured data', async () => {
    const report = await inspectBlogRenderedSeoQuality({
      ...BASE,
      markdown: [
        '# 삿포로 식비 예산 가이드',
        '',
        '하루 식비는 식사 구성에 따라 달라집니다. 아침과 점심, 저녁의 기준을 나눠 예산을 정하면 판단이 쉬워집니다.',
        '',
        '## 식비 기준',
        '',
        '| 구분 | 확인 기준 |',
        '| --- | --- |',
        '| 점심 | 메뉴 가격 |',
      ].join('\n'),
    });

    expect(report.passed).toBe(true);
    expect(report.readingTimeMinutes).toBe(3);
    expect(report.issues).toEqual([]);
  });

  it('blocks raw residue, empty structures, placeholders and canonical mismatch', async () => {
    const report = await inspectBlogRenderedSeoQuality({
      ...BASE,
      markdown: '## \n\nTODO 내용을 입력하세요.\\n\n| 구분 | 값 |\n| --- | --- |',
      generationMeta: {
        information_representative: {
          status: 'active',
          canonical_slug: 'another-post',
        },
      },
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'literal_newline_escape',
      'placeholder',
      'canonical_index_mismatch',
    ]));
  });

  it('blocks a named section that has no rendered content', async () => {
    const report = await inspectBlogRenderedSeoQuality({
      ...BASE,
      markdown: '답변을 먼저 제공합니다.\n\n## 비어 있는 섹션',
    });

    expect(report.issues.map((issue) => issue.code)).toContain('empty_heading');
  });

  it('detects duplicated body CTAs and an answer replaced by CTA copy', async () => {
    const report = await inspectBlogRenderedSeoQuality({
      ...BASE,
      markdown: '[상담하기](/group-inquiry) [다시 상담](/group-inquiry)',
    });

    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'duplicate_cta',
      'cta_replaces_answer',
    ]));
  });

  it('treats child FAQ questions as content for their parent heading', async () => {
    const report = await inspectBlogRenderedSeoQuality({
      ...BASE,
      markdown: [
        '## 자주 묻는 질문',
        '',
        '### Q1. 하루 예산은 어디에서 확인하나요?',
        '',
        "A. 위의 '근거로 확인한 1인 하루 식비' 표를 확인하세요.",
      ].join('\n'),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('empty_heading');
  });
});
