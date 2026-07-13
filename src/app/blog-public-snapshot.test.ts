import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('blog public package data boundary', () => {
  it('uses public snapshots before attaching package data to blog detail pages', () => {
    const text = source('src/app/blog/[slug]/page.tsx');
    const packageQueryIndex = text.indexOf("'postFastPackage'");
    const packageMergeIndex = text.indexOf('post.travel_packages = (publicRows[0]');

    expect(text).toContain('function isBlogPublicSnapshotCandidate');
    expect(text).toContain('async function mergeBlogPublicPackageSnapshots');
    expect(text).toContain(".in('publication_state', ['approved', 'published'])");
    expect(text).not.toContain('travel_packages(id, title');
    expect(packageMergeIndex).toBeGreaterThan(packageQueryIndex);
  });

  it('uses public snapshots before rendering related and curation product rows', () => {
    const text = source('src/app/blog/[slug]/page.tsx');
    const scoredIndex = text.indexOf('const scoredCandidates');
    const scoredMergeIndex = text.indexOf('for (const pkg of await mergeBlogPublicPackageSnapshots(scoredCandidates))');
    const relatedPostIndex = text.indexOf("'relatedPosts'");
    const relatedPostAttachIndex = text.indexOf('const posts = await attachRelatedPostPublicSnapshots');
    const curationIndex = text.indexOf("'curationProducts'");
    const curationMergeIndex = text.indexOf('const publicAlive = await mergeBlogPublicPackageSnapshots');

    expect(text).not.toContain('travel_packages(destination, price, duration, nights)');
    expect(text).toContain('async function attachRelatedPostPublicSnapshots');
    expect(text).toContain("'relatedPostPublicPackages'");
    expect(scoredMergeIndex).toBeGreaterThan(scoredIndex);
    expect(relatedPostAttachIndex).toBeGreaterThan(relatedPostIndex);
    expect(curationMergeIndex).toBeGreaterThan(curationIndex);
  });

  it('does not join raw package titles into the public RSS feed', () => {
    const text = source('src/app/api/rss/route.ts');

    expect(text).not.toContain('travel_packages(');
    expect(text).not.toContain('travel_packages?.title');
    expect(text).toContain("const title = escXml(post.seo_title || '여소남 블로그')");
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
    const packageQueryIndex = text.indexOf(".from('travel_packages')");
    const snapshotIndex = text.indexOf('const publicPackages = await fetchAndMergeCurrentPublicPackageCardSnapshots');
    const filterIndex = text.indexOf('publicPackageDestinationById.get');

    expect(text).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(text).not.toContain('travel_packages(destination)');
    expect(text).not.toContain('p.travel_packages?.destination');
    expect(snapshotIndex).toBeGreaterThan(packageQueryIndex);
    expect(filterIndex).toBeGreaterThan(snapshotIndex);
  });
});
