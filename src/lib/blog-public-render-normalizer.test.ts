import { describe, expect, it } from 'vitest';
import { sanitizePublicBlogBodyHtml } from './blog-public-render-normalizer';

describe('public blog render normalizer', () => {
  it('keeps the page title as the only possible H1 and removes executable markup', () => {
    const html = sanitizePublicBlogBodyHtml('<h1>본문 제목</h1><script>alert(1)</script><p onclick="x()">답변</p>');
    expect(html).toContain('<h2>본문 제목</h2>');
    expect(html).not.toMatch(/<h1\b|<script|onclick=/i);
  });
});
