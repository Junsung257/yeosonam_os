import type { MetadataRoute } from 'next';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { encodeDestinationPathSegment } from '@/lib/regions';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');
const HARD_LIMIT = 45000;

export const revalidate = 60;
export const dynamic = 'force-static';

function safeLastModified(iso: string | null | undefined): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function isSafeSitemapBlogSlug(slug: string | null | undefined): boolean {
  if (slug == null || typeof slug !== 'string') return false;
  const s = slug.trim();
  if (s.length === 0 || s.length > 512) return false;
  if (s.startsWith('/') || s.includes('//') || s.includes('?') || s.includes('#')) return false;
  if (!/[0-9a-zA-Z가-힣]/.test(s)) return true;
  return true;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes: MetadataRoute.Sitemap = [];

  // 1. 정적 경로
  routes.push(
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/packages`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/destinations`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/concierge`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/group-inquiry`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
  );

  if (!isSupabaseConfigured) return routes;

  // 2. 패키지
  try {
    const { data: pkgs } = await supabaseAdmin
      .from('travel_packages')
      .select('id, updated_at')
      .in('status', ['active', 'approved'])
      .order('updated_at', { ascending: false })
      .limit(HARD_LIMIT);

    for (const pkg of pkgs || []) {
      routes.push({
        url: `${BASE_URL}/packages/${pkg.id}`,
        lastModified: pkg.updated_at ? new Date(pkg.updated_at) : new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.85,
      });
    }
  } catch (err) {
    console.warn('[sitemap] packages error:', err);
  }

  // 3. 목적지
  try {
    const { data: activeDests } = await supabaseAdmin
      .from('active_destinations')
      .select('destination');
    for (const d of (activeDests || []) as Array<{ destination: string }>) {
      if (d.destination) {
        routes.push({
          url: `${BASE_URL}/destinations/${encodeDestinationPathSegment(d.destination)}`,
          lastModified: new Date(),
          changeFrequency: 'daily' as const,
          priority: 0.9,
        });
      }
    }
  } catch {
    // noop
  }

  // 4. 블로그
  try {
    const { data: posts } = await supabaseAdmin
      .from('content_creatives')
      .select('slug, published_at, updated_at')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(HARD_LIMIT);

    const postList = (posts || []) as Array<{
      slug: string;
      published_at: string | null;
      updated_at: string | null;
    }>;

    const destinations = new Set<string>();
    for (const post of postList) {
      if (post.slug) {
        // destination 추출: slug 접두사에서 추론 가능
        const parts = post.slug.split('-');
        if (parts.length > 1) destinations.add(parts[0]);
      }
    }

    const ANGLES = ['value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food'];

    for (const dest of destinations) {
      routes.push({
        url: `${BASE_URL}/blog/destination/${encodeURIComponent(dest)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      });
    }

    for (const angle of ANGLES) {
      routes.push({
        url: `${BASE_URL}/blog/angle/${angle}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      });
    }

    for (const post of postList) {
      if (isSafeSitemapBlogSlug(post.slug)) {
        const last = post.updated_at || post.published_at;
        routes.push({
          url: `${BASE_URL}/blog/${encodeURIComponent(post.slug)}`,
          lastModified: safeLastModified(last),
          changeFrequency: 'weekly' as const,
          priority: 0.7,
        });
      }
    }
  } catch (err) {
    console.warn('[sitemap] blog error:', err);
  }

  // 5. RFQ + destination 필터
  try {
    const { data: rfqs } = await supabaseAdmin
      .from('rfqs')
      .select('id, created_at')
      .eq('status', 'awaiting_selection')
      .order('created_at', { ascending: false })
      .limit(500);

    for (const rfq of rfqs || []) {
      routes.push({
        url: `${BASE_URL}/rfq/${rfq.id}`,
        lastModified: rfq.created_at ? new Date(rfq.created_at) : new Date(),
        changeFrequency: 'hourly' as const,
        priority: 0.6,
      });
    }
  } catch {
    // noop
  }

  // Destination filter pages
  try {
    const { data: pkgs } = await supabaseAdmin
      .from('travel_packages')
      .select('destination')
      .in('status', ['active', 'approved'])
      .limit(HARD_LIMIT);

    const destinations = new Set<string>();
    for (const p of pkgs || []) {
      if (p.destination) destinations.add(p.destination);
    }

    for (const dest of destinations) {
      routes.push({
        url: `${BASE_URL}/packages?destination=${encodeURIComponent(dest)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      });
    }
  } catch {
    // noop
  }

  return routes;
}
