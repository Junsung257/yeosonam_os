import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ContentReviewPanel preview safety', () => {
  it('sanitizes creative HTML before preview rendering', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/admin/ContentReviewPanel.tsx'), 'utf8');

    expect(source).toContain("import DOMPurify from 'dompurify'");
    expect(source).toContain('DOMPurify.sanitize(creative.blog_html)');
    expect(source).toContain('dangerouslySetInnerHTML={{ __html: sanitizedPreviewHtml }}');
    expect(source).not.toContain('dangerouslySetInnerHTML={{ __html: creative.blog_html }}');
  });
});
