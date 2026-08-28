import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BLOG_PUBLIC_ANGLES,
  BLOG_PUBLIC_ANGLE_LABELS,
  BLOG_PUBLIC_ANGLE_LABELS_WITH_ICON,
} from '@/lib/blog-public-taxonomy';
import {
  FALLBACK_BLOG_POSTS,
  getFallbackBlogPost,
} from '@/lib/blog-public-fallback';
import { resolveBlogSlugRedirect } from '@/lib/blog-slug-redirects';

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
      expect(source).toContain('SafeCoverImg');
      expect(source).not.toContain('src={post.og_image_url}');
    }
  });

  it('discloses generated conceptual media on every public blog card surface', () => {
    const detailSource = readSource('src/app/blog/[slug]/page.tsx');
    for (const file of [
      'src/app/blog/BlogData.tsx',
      'src/app/blog/destination/[dest]/page.tsx',
      'src/app/blog/angle/[angle]/page.tsx',
    ]) {
      const source = readSource(file);
      expect(source).toContain('isGeneratedBlogImageUrl');
      expect(source).toContain('AI 생성 참고 이미지');
    }
    expect(detailSource).toContain('generatedHeroImage');
    expect(detailSource).toContain('실제 현장 기록이나 최신 운영 상황의 증거로 사용하지 않습니다.');
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

  it('derives destination guide cards from the shared public blog catalog', () => {
    const source = readSource('src/app/blog/BlogData.tsx');

    expect(source).toContain('loadPublicBlogCatalogPage({');
    expect(source).toContain('result.destinations.length');
    expect(source).toContain('b.post_count - a.post_count');
    expect(source).toContain('/blog/destination/${encodeDestinationPathSegment(d.destination)}');
    expect(source).not.toContain('getDestinationUrl(d.destination)');
  });

  it('does not expose empty style filters without site-wide angle evidence', () => {
    const source = readSource('src/app/blog/BlogData.tsx');

    expect(source).toContain('countAnglesFromPosts(posts)');
    expect(source).toContain('(angleCounts[candidate.key] ?? 0) > 0');
    expect(source).not.toContain('const visibleAngleChips = BLOG_PUBLIC_ANGLES;');
  });

  it('uses server-side pagination totals instead of loading 2,000 rows into the list route', () => {
    const source = readSource('src/app/blog/BlogData.tsx');

    expect(source).toContain('const exactTotal = result.total');
    expect(source).toContain('pageSize: PER_PAGE');
    expect(source).toContain('total: exactTotal');
    expect(source).not.toContain('.limit(2000)');
  });

  it('keeps fallback-only sample posts out of public detail URLs', () => {
    const linkable = FALLBACK_BLOG_POSTS.filter((post) => post.detail_available);
    const samplesOnly = FALLBACK_BLOG_POSTS.filter((post) => !post.detail_available);

    expect(linkable.map((post) => post.slug)).toContain('zhangjiajie-weather');
    expect(samplesOnly.map((post) => post.slug)).toContain('danang-family-package-checklist');
    expect(getFallbackBlogPost('zhangjiajie-weather')).toBeTruthy();
    expect(getFallbackBlogPost('danang-family-package-checklist')).toBeNull();
  });

  it('builds list JSON-LD and sitemap URLs only from canonical public rows', () => {
    const blogSource = readSource('src/app/blog/BlogData.tsx');
    const sitemapSource = readSource('src/app/sitemap.ts');

    expect(blogSource).toContain('getBlogPostHref(post)');
    expect(blogSource).toContain('jsonLdPosts.map');
    expect(sitemapSource).toContain('loadPublicBlogCatalog()');
    expect(sitemapSource).not.toContain('getFallbackBlogPosts');
  });

  it('shares one compact catalog across public blog collection surfaces', () => {
    const files = [
      'src/app/blog/BlogData.tsx',
      'src/app/blog/destination/[dest]/page.tsx',
      'src/app/blog/angle/[angle]/page.tsx',
      'src/app/sitemap.ts',
    ];
    for (const file of files) {
      expect(readSource(file)).toContain('loadPublicBlogCatalog');
    }

    const catalogSource = readSource('src/lib/blog-public-catalog.ts');
    expect(catalogSource).toContain("['blog-public-catalog-v3-medication-policy']");
    expect(catalogSource).toContain('loadPublicBlogCatalogPage');
    expect(catalogSource).not.toContain('.limit(2000)');
    expect(catalogSource).toContain('isBlogSlugRedirectSource');
    expect(catalogSource).not.toContain('blog_html');
    expect(catalogSource).not.toContain('quality_gate');
    expect(catalogSource).toContain('noindex:generation_meta->noindex');
    expect(catalogSource).not.toContain('prompt_manifest');
  });

  it('does not redirect legacy slugs to archived blog posts', () => {
    expect(resolveBlogSlugRedirect('travel-guide-q35bf6ed0')).toBeNull();
  });

  it('consolidates live-audited weather duplicates into their active representative', () => {
    expect(resolveBlogSlugRedirect('danang-weather'))
      .toBe('다낭-5월-날씨와-옷차림-우기-시작-전-쾌적한-여행-준비물');
    expect(resolveBlogSlugRedirect('6-danang'))
      .toBe('다낭-5월-날씨와-옷차림-우기-시작-전-쾌적한-여행-준비물');
    expect(resolveBlogSlugRedirect('june-sapporo-weather'))
      .toBe('sapporo-weather-packing');
  });
});
