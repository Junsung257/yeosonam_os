import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('auto publish loop Instagram bridge contract', () => {
  it('sends the required publish-instagram body fields from cron publishing', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/cron/auto-publish-loop/route.ts'), 'utf8');

    expect(source).toContain("publishCaption = card.ig_caption?.trim() || card.title");
    expect(source).toContain("when: 'now'");
    expect(source).toContain('caption: publishCaption');
    expect(source).toContain('image_urls: imageUrls');
    expect(source).toContain("source: 'auto-publish-loop'");
  });
});
