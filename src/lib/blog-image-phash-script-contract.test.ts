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

  it('hashes each unique image URL once with bounded concurrency', () => {
    expect(source).toContain('const uniqueMissingUrls = [...new Set');
    expect(source).toContain('mapWithConcurrency(selectedUrls, concurrency');
    expect(source).toContain("limit_semantics: 'unique_image_urls'");
    expect(source).toContain('Math.min(Number(concurrencyArg');
  });

  it('labels the last-known-good public snapshot fallback instead of hiding a DB read failure', () => {
    expect(source).toContain("source = 'bundled_public_detail_snapshot_fallback'");
    expect(source).toContain("source_scope: source === 'bundled_public_detail_snapshot_fallback'");
    expect(source).toContain('source_read_error: sourceReadError');
  });

  it('keeps the default console output bounded while preserving full audit artifacts', () => {
    expect(source).toContain("process.argv.includes('--verbose')");
    expect(source).toContain("report_json: 'docs/audits/blog-image-phash-preview.json'");
  });

  it('makes perceptual duplicate pairs actionable with URL and destination evidence', () => {
    expect(source).toContain('leftDestination: left?.destinationId');
    expect(source).toContain('rightDestination: right?.destinationId');
    expect(source).toContain('perceptual_duplicate_pairs_different_url');
    expect(source).toContain('exact_url_duplicate_pairs');
    expect(source).toContain('same_source_asset_variant_pairs');
    expect(source).toContain('distinct_source_perceptual_pairs');
  });

  it('collapses repeated hero/body occurrences before counting visual-use pairs', () => {
    expect(source).toContain('const visualUseByKey = new Map');
    expect(source).toContain('findCrossDestinationImageDuplicatesV3(visualUses, 4)');
    expect(source).toContain('audited_visual_uses: visualUses.length');
  });
});
