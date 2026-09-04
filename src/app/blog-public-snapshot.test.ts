import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('blog public package data boundary', () => {
  it('uses public snapshots before attaching package data to blog detail pages', () => {
    const text = source('src/app/blog/[slug]/page.tsx');
    const packageMergeIndex = text.indexOf('post.travel_packages = (current?.package');

    expect(text).toContain('getCurrentPublicPackage');
    expect(text).toContain("channel: 'customer'");
    expect(text).not.toContain("'postFastPackage'");
    expect(text).not.toContain('travel_packages(id, title');
    expect(packageMergeIndex).toBeGreaterThan(0);
  });

  it('uses public snapshots before rendering related and curation product rows', () => {
    const text = source('src/app/blog/[slug]/page.tsx');
    const scoredIndex = text.indexOf('const scoredCandidates');
    const scoredMergeIndex = text.indexOf('for (const pkg of await mergeBlogPublicPackageSnapshots(scoredCandidates))');
    const relatedPostIndex = text.indexOf("'relatedPosts'");
    const relatedPostAttachIndex = text.indexOf('const posts = await attachRelatedPostPublicSnapshots');
    const pointerListCount = text.split('listCurrentPublicPackageCardSnapshots').length - 1;

    expect(text).not.toContain('travel_packages(destination, price, duration, nights)');
    expect(text).toContain('async function attachRelatedPostPublicSnapshots');
    expect(pointerListCount).toBeGreaterThanOrEqual(3);
    expect(scoredMergeIndex).toBeGreaterThan(scoredIndex);
    expect(relatedPostAttachIndex).toBeGreaterThan(relatedPostIndex);
    expect(text).not.toContain("'curationProducts'");
  });

  it('does not join raw package titles into the public RSS feed', () => {
    const text = source('src/app/api/rss/route.ts');

    expect(text).not.toContain('travel_packages(');
    expect(text).not.toContain('travel_packages?.title');
    expect(text).toContain("const title = escXml(post.seo_title || '여소남 블로그')");
    expect(text).toContain("export const dynamic = 'force-dynamic'");
  });

  it('does not join raw package destinations into blog Open Graph images', () => {
    const text = source('src/app/blog/[slug]/opengraph-image.tsx');

    expect(text).not.toContain('travel_packages(destination)');
    expect(text).not.toContain('travel_packages?.destination');
    expect(text).toContain(".select('seo_title, angle_type, og_image_url, destination')");
    expect(text).toContain('if (post?.destination) destination = post.destination');
  });

  it('filters destination RSS posts with public snapshot destinations only', () => {
    const text = source('src/app/destinations/[city]/rss.xml/route.ts');
    const snapshotIndex = text.indexOf('const publicPackages = (await listCurrentPublicPackageCardSnapshots');
    const filterIndex = text.indexOf('publicPackageDestinationById.get');

    expect(text).toContain('listCurrentPublicPackageCardSnapshots');
    expect(text).not.toContain(".from('travel_packages')");
    expect(text).not.toContain('travel_packages(destination)');
    expect(text).not.toContain('p.travel_packages?.destination');
    expect(snapshotIndex).toBeGreaterThan(0);
    expect(filterIndex).toBeGreaterThan(snapshotIndex);
  });
});
