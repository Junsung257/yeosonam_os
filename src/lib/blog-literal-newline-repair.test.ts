import { describe, expect, it } from 'vitest';
import { repairBlogLiteralNewlines } from './blog-literal-newline-repair';

describe('repairBlogLiteralNewlines', () => {
  it('converts model-escaped structural newlines before public rendering', () => {
    const result = repairBlogLiteralNewlines(
      '# 캐나다 로키 교통\\n\\n## 공식 노선\\n| 노선 | 요금 |',
    );

    expect(result).toMatchObject({
      changed: true,
      replacementCount: 3,
    });
    expect(result.markdown).toBe(
      '# 캐나다 로키 교통\n\n## 공식 노선\n| 노선 | 요금 |',
    );
    expect(result.markdown).not.toContain('\\n');
  });

  it('handles repeated backslashes and remains idempotent', () => {
    const first = repairBlogLiteralNewlines('안내\\\\n다음 줄');
    const second = repairBlogLiteralNewlines(first.markdown);

    expect(first).toMatchObject({
      markdown: '안내\n다음 줄',
      changed: true,
      replacementCount: 1,
    });
    expect(second).toMatchObject({
      markdown: first.markdown,
      changed: false,
      replacementCount: 0,
    });
  });

  it('normalizes model-escaped CRLF tokens as one line break', () => {
    const result = repairBlogLiteralNewlines('첫째 줄\\r\\n둘째 줄');

    expect(result).toMatchObject({
      markdown: '첫째 줄\n둘째 줄',
      changed: true,
      replacementCount: 1,
    });
  });
});
