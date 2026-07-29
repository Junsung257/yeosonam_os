import { describe, expect, it } from 'vitest';
import {
  BLOG_WRITER_MAX_POSTPROCESS_CHARACTERS,
  boundBlogWriterOutput,
} from './blog-writer-output-boundary';

describe('boundBlogWriterOutput', () => {
  it('preserves ordinary writer output', () => {
    const markdown = '# 제목\n\n짧고 완결된 본문입니다.';
    expect(boundBlogWriterOutput(markdown)).toEqual({
      markdown,
      originalCharacters: markdown.length,
      finalCharacters: markdown.length,
      truncated: false,
    });
  });

  it('cuts oversized output at a recent paragraph boundary', () => {
    const paragraph = `${'가'.repeat(790)}\n\n`;
    const markdown = `# 제목\n\n${paragraph.repeat(24)}마지막 문단`;
    const result = boundBlogWriterOutput(markdown);

    expect(result.truncated).toBe(true);
    expect(result.originalCharacters).toBe(markdown.length);
    expect(result.finalCharacters).toBeLessThanOrEqual(BLOG_WRITER_MAX_POSTPROCESS_CHARACTERS);
    expect(result.markdown.endsWith('가')).toBe(true);
    expect(result.markdown).not.toContain('마지막 문단');
  });
});
