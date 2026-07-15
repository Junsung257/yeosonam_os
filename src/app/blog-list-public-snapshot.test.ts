import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('blog list public package data boundary', () => {
  it('keeps blog angle lists from joining raw package text and gates recommendations in angle matcher', () => {
    const anglePage = source('src/app/blog/angle/[angle]/page.tsx');
    const matcher = source('src/lib/angle-matcher.ts');

    expect(anglePage).not.toContain('travel_packages(');
    expect(anglePage).not.toContain('isCustomerPubliclyOpenable');
    expect(matcher).toContain('getPublishedPackageCards');
    expect(matcher).not.toContain('isAnglePublicSnapshotCandidate');
    expect(matcher).not.toContain(".in('publication_state'");
  });

  it('keeps destination blog lists from joining raw packages and gates destination package cards', () => {
    const text = source('src/app/blog/destination/[dest]/page.tsx');
    const packageQueryIndex = text.indexOf("'packages'");
    const snapshotIndex = text.indexOf('packages: await mergeBlogDestinationPublicPackages');

    expect(text).not.toContain('travel_packages(');
    expect(text).toContain('async function mergeBlogDestinationPublicPackages');
    expect(text).toContain('getPublishedPackageCards');
    expect(text).not.toContain('isBlogDestinationPublicSnapshotCandidate');
    expect(text).not.toContain(".in('publication_state'");
    expect(snapshotIndex).toBeGreaterThan(packageQueryIndex);
  });

  it('strips accidental raw package data from the public blog list before rendering', () => {
    const text = source('src/app/blog/BlogData.tsx');
    const fetchIndex = text.indexOf('const fetchedPosts = stripRawPackageDataFromBlogListPosts');

    expect(text).toContain('function stripRawPackageDataFromBlogListPosts');
    expect(text).toContain('travel_packages: null');
    expect(text).toContain('const fallbackPosts = stripRawPackageDataFromBlogListPosts(getFallbackBlogPosts(filter))');
    expect(fetchIndex).toBeGreaterThan(text.indexOf("runBlogQuery('posts'"));
    expect(text).not.toContain('travel_packages(');
  });
});
