import { describe, expect, it } from 'vitest';
import { ensureRequiredBlogDecisionBlocks } from './blog-required-structure';

describe('blog required structure', () => {
  it('adds a real decision table to weather posts without one', () => {
    const markdown = [
      '# 장가계 날씨 가이드',
      '',
      '장가계 날씨는 계절별 기온과 강수량 차이가 커서 출발 전 준비가 중요합니다.',
    ].join('\n');

    const result = ensureRequiredBlogDecisionBlocks(markdown, {
      destination: '장가계',
      primaryKeyword: '장가계 날씨',
    });

    expect(result).toContain('## 빠른 판단표');
    expect(result).toContain('| 구분 | 여행 판단 기준 | 준비 포인트 |');
    expect((result.match(/^\s*\|.+\|\s*$/gm) || []).length).toBeGreaterThanOrEqual(6);
    expect(result).toContain('## 출발 전 최종 체크리스트');
  });

  it('does not duplicate an existing decision table', () => {
    const markdown = [
      '# 보홀 날씨',
      '',
      '| 구분 | 기준 | 준비 |',
      '| --- | --- | --- |',
      '| 우기 | 소나기 | 우산 |',
      '| 건기 | 자외선 | 모자 |',
      '',
      '이미 표가 있는 글입니다.',
    ].join('\n');

    const result = ensureRequiredBlogDecisionBlocks(markdown, {
      destination: '보홀',
      primaryKeyword: '보홀 날씨',
    });

    expect((result.match(/## 빠른 판단표/g) || []).length).toBe(0);
  });

  it('leaves unrelated non-travel content unchanged', () => {
    const markdown = '# 회사 소식\n\n이번 주 내부 운영 메모입니다.';

    expect(ensureRequiredBlogDecisionBlocks(markdown)).toBe(markdown);
  });

  it('does not mistake English detail headings for ETA visa content', () => {
    const markdown = [
      '## Section 1',
      '',
      '### Detail 1',
      '',
      'This is a generic editorial outline.',
    ].join('\n');

    expect(ensureRequiredBlogDecisionBlocks(markdown)).toBe(markdown);
  });
});
