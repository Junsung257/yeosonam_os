import type { MetadataRoute } from 'next';
import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase';
import { encodeDestinationPathSegment } from '@/lib/regions';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { CUSTOMER_VISIBLE_STATUSES } from '@/lib/visibility-status';
import {
  fetchAndMergeCurrentPublicPackageCardSnapshots,
  listCurrentPublicPackageCardSnapshots,
} from '@/lib/package-publication/snapshot-projection';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import { loadPublicBlogCatalog } from '@/lib/blog-public-catalog';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';

const BASE_URL = resolveBlogCanonicalOrigin();
const PACKAGE_LIMIT = 1000;
const BLOG_LIMIT = 2000;
const DESTINATION_LIMIT = 500;
const QUERY_TIMEOUT_MS = 2500;

type SitemapQueryResponse<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

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

function isAbortLikeError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || /abort|timeout|timed out/i.test(err.message);
  }
  return false;
}

function isSitemapPublicSnapshotCandidate(row: PublicPackageDestinationSitemapRow): boolean {
  return isPublicPublicationState(row.publication_state)
    && isCustomerPubliclyOpenable(row as unknown as Record<string, unknown>);
}

async function fetchSitemapPublicSnapshotRows(rows: PublicPackageDestinationSitemapRow[]): Promise<PublicPackageDestinationSitemapRow[]> {
  if (rows.length === 0) return [];
  try {
    return await fetchAndMergeCurrentPublicPackageCardSnapshots(
      supabaseAdmin,
      rows as unknown as Array<Record<string, unknown>>,
    ) as unknown as PublicPackageDestinationSitemapRow[];
  } catch (error) {
    console.warn('[sitemap] public snapshot merge failed; hiding package destination URLs:', error);
    return [];
  }
}

async function runSitemapQuery<T>(
  label: string,
  queryFactory: (signal: AbortSignal) => PromiseLike<SitemapQueryResponse<T>>,
): Promise<T[]> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) return [];
  if (shouldSkipPublicDbReadsForResourceSaver()) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const result = await queryFactory(controller.signal);
    if (result.error) {
      console.warn(`[sitemap] ${label} query failed:`, result.error.message || result.error);
      return [];
    }
    return Array.isArray(result.data) ? result.data : [];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[sitemap] ${label} query ${isAbortLikeError(err) ? 'timed out' : 'failed'}:`, reason);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pointerOnly = getProductRegistrationV6RuntimeConfig().authorityMode === 'kernel';
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
    pointerOnly
      ? listCurrentPublicPackageCardSnapshots(supabaseAdmin, { limit: PACKAGE_LIMIT })
        .then(rows => rows as unknown as PublicPackageDestinationSitemapRow[])
        .catch(error => {
          console.warn('[sitemap] pointer-only package catalog unavailable:', error);
          return [];
        })
      : runSitemapQuery<PublicPackageDestinationSitemapRow>('destinations', (signal) =>
        supabaseAdmin
          .from('travel_packages')
          .select('id, destination, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data')
          .in('status', [...CUSTOMER_VISIBLE_STATUSES])
          .in('publication_state', ['approved', 'published'])
          .not('destination', 'is', null)
          .limit(PACKAGE_LIMIT)
          .abortSignal(signal),
      ),
    loadPublicBlogCatalog()
      .then((posts) => posts.slice(0, BLOG_LIMIT))
      .catch((error) => {
        console.warn('[sitemap] shared blog catalog unavailable:', error);
        return [];
      }),
  ]);

  const snapshotDestinations = pointerOnly
    ? packageDestinations
    : await fetchSitemapPublicSnapshotRows(
      packageDestinations.filter(isSitemapPublicSnapshotCandidate),
    );
  const publicDestinations = new Map<string, ActiveDestinationSitemapRow>();
  for (const pkg of snapshotDestinations) {
    const destination = pkg.destination?.trim();
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
    if (isSafeSitemapBlogSlug(post.slug)) {
      routes.push({
        url: `${BASE_URL}/blog/${encodeURIComponent(post.slug.trim())}`,
        lastModified: safeLastModified(post.updated_at || post.published_at),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }

  return routes;
}
