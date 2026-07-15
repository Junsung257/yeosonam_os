import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('review page public package data boundary', () => {
  it('uses public snapshots before showing package text on review routes', () => {
    const text = source('src/app/review/[booking_id]/page.tsx');
    const metadataQueryIndex = text.indexOf(".select('product_id')");
    const metadataSnapshotIndex = text.indexOf('const pkg = await getReviewPublicPackage(productId)');
    const pageSnapshotIndex = text.indexOf('const pkg = await getReviewPublicPackage(info.booking.product_id)');

    expect(text).toContain('getPublishedPackageDetail');
    expect(text).toContain('async function getReviewPublicPackage');
    expect(text).not.toContain('travel_packages(title)');
    expect(text).not.toContain('travel_packages(title, destination)');
    expect(text).not.toContain('info.booking.travel_packages');
    expect(metadataSnapshotIndex).toBeGreaterThan(metadataQueryIndex);
    expect(pageSnapshotIndex).toBeGreaterThan(metadataSnapshotIndex);
  });

  it('uses public snapshots for review section product schema text', () => {
    const text = source('src/components/reviews/ReviewsSection.tsx');
    const packageQueryIndex = text.indexOf(".from('travel_packages')");
    const snapshotIndex = text.indexOf('getPublishedPackageDetail', packageQueryIndex);
    const schemaIndex = text.indexOf("'@type': 'Product'");

    expect(packageQueryIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThan(packageQueryIndex);
    expect(schemaIndex).toBeGreaterThan(snapshotIndex);
    expect(text).toContain('name: publicTitle');
    expect(text).toContain('description: publicSummary || publicTitle');
    expect(text).not.toContain("select('avg_rating, review_count, title, product_summary')");
    expect(text).not.toContain('name: stats.title');
    expect(text).not.toContain('description: stats.product_summary || stats.title');
  });
});
