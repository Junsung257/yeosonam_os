import { describe, expect, it } from 'vitest';

import { BLOG_STYLE_GUIDE } from './style-guide';

describe('blog style guide prompt contract', () => {
  it('does not ask writers to emit manual highlight markup', () => {
    expect(BLOG_STYLE_GUIDE).not.toMatch(/==[^=\n]{1,200}==/);
    expect(BLOG_STYLE_GUIDE).not.toContain('각 H2 섹션당 정확히 1개');
    expect(BLOG_STYLE_GUIDE).not.toContain('<mark');
  });

  it('keeps customer-facing scan rules without decorative emphasis', () => {
    expect(BLOG_STYLE_GUIDE).toContain('스캔 요소 규칙');
    expect(BLOG_STYLE_GUIDE).toContain('수동 볼드, 형광펜, mark 태그, 등호 기반 강조 문법을 쓰지 않는다');
    expect(BLOG_STYLE_GUIDE).toContain('표/체크리스트');
  });

  it('keeps informational structure flexible instead of forcing every section candidate', () => {
    expect(BLOG_STYLE_GUIDE).toContain('검색 의도에 필요한 5~7개 구간만 남긴다');
    expect(BLOG_STYLE_GUIDE).not.toContain('H2 8개 고정');
    expect(BLOG_STYLE_GUIDE).not.toContain('모든 후보를 다 쓰');
  });
});
