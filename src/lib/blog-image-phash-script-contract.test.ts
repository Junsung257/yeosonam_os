import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog image pHash backfill script', () => {
  const source = readFileSync(join(process.cwd(), 'scripts/backfill-blog-image-phash.ts'), 'utf8');

  it('is dry-run by default and requires an explicit confirmation before updates', () => {
    expect(source).toContain("process.argv.includes('--apply')");
    expect(source).toContain("BLOG_IMAGE_PHASH_APPLY_CONFIRM !== 'DRY_RUN_REVIEWED'");
    expect(source).toContain(".is('perceptual_hash', null)");
  });

  it('rejects private destinations and oversized responses before hashing', () => {
    expect(source).toContain('private_image_address');
    expect(source).toContain('image_exceeds_12mb');
    expect(source).toContain("redirect: 'manual'");
  });
});
