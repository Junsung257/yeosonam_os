import { describe, expect, it } from 'vitest';
import { sanitizePublicBlogBodyHtml } from './blog-public-render-normalizer';

describe('public blog render normalizer security cases', () => {
  it('removes executable URL, srcdoc, and inline style payloads from destination body HTML', () => {
    const html = sanitizePublicBlogBodyHtml(
      '<p style="background:url(javascript:alert(1))">safe</p><a href="data:text/html,<script>alert(1)</script>">bad</a><img srcdoc="<script>alert(1)</script>" src="javascript:alert(2)" />',
    );

    expect(html).toContain('safe');
    expect(html).not.toMatch(/style=|srcdoc=|javascript:|data:text\/html/i);
  });
});
