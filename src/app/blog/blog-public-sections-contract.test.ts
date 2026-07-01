import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BLOG_PUBLIC_ANGLES,
  BLOG_PUBLIC_ANGLE_LABELS,
  BLOG_PUBLIC_ANGLE_LABELS_WITH_ICON,
} from '@/lib/blog-public-taxonomy';

const PUBLIC_PUBLISH_ANGLES = ['value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food'];

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('blog public sections contract', () => {
  it('keeps public angle taxonomy complete for published blog angles', () => {
    const keys = BLOG_PUBLIC_ANGLES.map((angle) => angle.key);

    expect(keys).toEqual(expect.arrayContaining(PUBLIC_PUBLISH_ANGLES));
    for (const key of PUBLIC_PUBLISH_ANGLES) {
      expect(BLOG_PUBLIC_ANGLE_LABELS[key]).toBeTruthy();
      expect(BLOG_PUBLIC_ANGLE_LABELS_WITH_ICON[key]).toContain(BLOG_PUBLIC_ANGLE_LABELS[key]);
    }
  });

  it('routes section card images through the blog image display helper', () => {
    const files = [
      'src/app/blog/BlogData.tsx',
      'src/app/blog/destination/[dest]/page.tsx',
      'src/app/blog/angle/[angle]/page.tsx',
    ];

    for (const file of files) {
      const source = readSource(file);
      expect(source).toContain('toBlogImageDisplaySrc');
      expect(source).not.toContain('src={post.og_image_url}');
    }
  });

  it('keeps public blog surfaces on the shared canonical origin contract', () => {
    const files = [
      'src/app/blog/page.tsx',
      'src/app/blog/BlogData.tsx',
      'src/app/blog/[slug]/page.tsx',
      'src/app/blog/destination/[dest]/page.tsx',
      'src/app/blog/angle/[angle]/page.tsx',
      'src/app/sitemap.ts',
    ];

    for (const file of files) {
      expect(readSource(file)).toContain('resolveBlogCanonicalOrigin');
    }
  });

  it('keeps destination guide cards inside the blog topical cluster', () => {
    const source = readSource('src/app/blog/BlogData.tsx');

    expect(source).toContain(".from('active_destinations')");
    expect(source).toContain("order('package_count'");
    expect(source).toContain('/blog/destination/${encodeDestinationPathSegment(d.destination)}');
    expect(source).not.toContain('getDestinationUrl(d.destination)');
  });

  it('does not expose empty style filters without site-wide angle evidence', () => {
    const source = readSource('src/app/blog/BlogData.tsx');

    expect(source).toContain("runBlogQuery(\n    'angles'");
    expect(source).toContain('(angleCounts[candidate.key] ?? 0) > 0');
    expect(source).not.toContain('const visibleAngleChips = BLOG_PUBLIC_ANGLES;');
  });
});
