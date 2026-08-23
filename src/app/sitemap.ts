import type { MetadataRoute } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { encodeDestinationPathSegment } from '@/lib/regions';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';
import { listCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';
import { loadPublicBlogCatalog } from '@/lib/blog-public-catalog';
import { isBlogSlugRedirectTombstone } from '@/lib/blog-slug-redirects';
import { canonicalizePublicDestination } from '@/lib/public-destinations';

const BASE_URL = resolveBlogCanonicalOrigin();
const PACKAGE_LIMIT = 1000;
const BLOG_LIMIT = 2000;
const DESTINATION_LIMIT = 500;

type ActiveDestinationSitemapRow = {
  destination: string | null;
  package_count?: number | string | null;
};

type PublicPackageDestinationSitemapRow = {
  id: string | null;
  destination: string | null;
  status?: string | null;
  publication_state?: string | null;
  package_revision?: number | null;
  audit_status?: string | null;
  audit_report?: unknown;
  updated_at?: string | null;
  optional_tours?: unknown;
  itinerary_data?: unknown;
};

export const revalidate = 3600;

function safeLastModified(iso: string | null | undefined): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function isSafeSitemapBlogSlug(slug: string | null | undefined): slug is string {
  if (slug == null || typeof slug !== 'string') return false;
  const s = slug.trim();
  if (s.length === 0 || s.length > 512) return false;
  if (s.startsWith('/') || s.includes('/') || s.includes('\\')) return false;
  if (s.includes('//') || s.includes('?') || s.includes('#')) return false;
  return encodeURIComponent(s).length <= 1024;
}

function getSafeSitemapDestination(row: ActiveDestinationSitemapRow): string | null {
  const destination = row.destination?.trim();
  if (!destination || destination.length > 160) return null;
  if (destination.includes('\\') || destination.includes('?') || destination.includes('#')) return null;
  const packageCount = row.package_count == null ? null : Number(row.package_count);
  if (packageCount != null && (!Number.isFinite(packageCount) || packageCount <= 0)) return null;
  return destination;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/group`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/private-tour`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/packages`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/destinations`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/concierge`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/group-inquiry`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.2 },
  ];

  const [packageDestinations, canonicalPosts] = await Promise.all([
    listCurrentPublicPackageCardSnapshots(supabaseAdmin, { limit: PACKAGE_LIMIT })
      .then(rows => rows as unknown as PublicPackageDestinationSitemapRow[])
      .catch(error => {
        console.warn('[sitemap] pointer-only package catalog unavailable:', error);
        return [];
      }),
    loadPublicBlogCatalog()
      .then((posts) => posts.slice(0, BLOG_LIMIT))
      .catch((error) => {
        console.warn('[sitemap] shared blog catalog unavailable:', error);
        return [];
      }),
  ]);

  const snapshotDestinations = packageDestinations;
  const publicDestinations = new Map<string, ActiveDestinationSitemapRow>();
  for (const pkg of snapshotDestinations) {
    const rawDestination = pkg.destination?.trim();
    const destination = canonicalizePublicDestination(rawDestination) ?? rawDestination;
    if (!destination) continue;
    const current = publicDestinations.get(destination) ?? { destination, package_count: 0 };
    current.package_count = Number(current.package_count ?? 0) + 1;
    publicDestinations.set(destination, current);
    if (publicDestinations.size >= DESTINATION_LIMIT) break;
  }

  for (const d of publicDestinations.values()) {
    const destination = getSafeSitemapDestination(d);
    if (destination) {
      routes.push({
        url: `${BASE_URL}/destinations/${encodeDestinationPathSegment(destination)}`,
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: 0.9,
      });
    }
  }

  const angles = new Set(['value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food']);
  const destinations = new Set<string>();
  const anglesWithPosts = new Set<string>();

  for (const post of canonicalPosts) {
    const destination = post.destination?.trim();
    if (destination) destinations.add(destination);
    if (post.angle_type && angles.has(post.angle_type)) {
      anglesWithPosts.add(post.angle_type);
    }
  }

  for (const dest of destinations) {
    routes.push({
      url: `${BASE_URL}/blog/destination/${encodeDestinationPathSegment(dest)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.75,
    });
  }

  for (const angle of anglesWithPosts) {
    routes.push({
      url: `${BASE_URL}/blog/angle/${angle}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.75,
    });
  }

  for (const post of canonicalPosts) {
    if (isSafeSitemapBlogSlug(post.slug) && !isBlogSlugRedirectTombstone(post.slug)) {
      routes.push({
        url: `${BASE_URL}/blog/${encodeURIComponent(post.slug.trim())}`,
        lastModified: safeLastModified(post.content_modified_at || post.published_at),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }

  return routes;
}
