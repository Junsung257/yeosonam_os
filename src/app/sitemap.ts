import type { MetadataRoute } from 'next';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
const HARD_LIMIT = 45000;

export const revalidate = 60;

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

// ── sitemap index: generateSitemaps 로 분할 (Google sitemap index 권장)
export async function generateSitemaps() {
  // 총 sitemap 조각 수 계산: 정적(1) + 상품(1) + 목적지(1) + RFQ(1) + 블로그(1) = 5
  return [{ id: 'static' }, { id: 'packages' }, { id: 'destinations' }, { id: 'blogs' }, { id: 'other' }];
}

export default async function sitemap({
  id,
}: {
  id: string;
}): Promise<MetadataRoute.Sitemap> {
  switch (id) {
    case 'static':
      return getStaticRoutes();
    case 'packages':
      return getPackageRoutes();
    case 'destinations':
      return getDestinationRoutes();
    case 'blogs':
      return getBlogRoutes();
    case 'other':
      return getOtherRoutes();
    default:
      return [];
  }
}

// ── 정적 경로 ─────────────────────────────────────────────
async function getStaticRoutes(): Promise<MetadataRoute.Sitemap> {
  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/packages`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/destinations`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/concierge`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/group-inquiry`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
  ];
}

// ── 패키지 ─────────────────────────────────────────────────
async function getPackageRoutes(): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data: pkgs } = await supabaseAdmin
      .from('travel_packages')
      .select('id, updated_at, destination')
      .in('status', ['active', 'approved'])
      .order('updated_at', { ascending: false })
      .limit(HARD_LIMIT);

    const packages = pkgs || [];
    return packages.map((pkg: any) => ({
      url: `${BASE_URL}/packages/${pkg.id}`,
      lastModified: pkg.updated_at ? new Date(pkg.updated_at) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    }));
  } catch (err) {
    console.warn('[sitemap] packages 로딩 실패:', err);
    return [];
  }
}

// ── 목적지 ─────────────────────────────────────────────────
async function getDestinationRoutes(): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured) return [];
  const routes: MetadataRoute.Sitemap = [];
  try {
    const { data: activeDests } = await supabaseAdmin
      .from('active_destinations')
      .select('destination');
    const dests = ((activeDests || []) as Array<{ destination: string }>)
      .filter(d => d.destination);
    for (const d of dests) {
      routes.push({
        url: `${BASE_URL}/destinations/${encodeURIComponent(d.destination)}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.9,
      });
    }
  } catch {
    // noop
  }
  return routes;
}

// ── 블로그 ─────────────────────────────────────────────────
async function getBlogRoutes(): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data: posts } = await supabaseAdmin
      .from('content_creatives')
      .select('slug, published_at, updated_at, travel_packages(destination)')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(HARD_LIMIT);

    const postList = (posts || []) as Array<{
      slug: string;
      published_at: string | null;
      updated_at: string | null;
      travel_packages: { destination: string | null } | null;
    }>;

    const destinations = new Set<string>();
    postList.forEach((p) => {
      if (p.travel_packages?.destination) destinations.add(p.travel_packages.destination);
    });

    const ANGLES = ['value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food'];

    return [
      ...[...destinations].map((dest) => ({
        url: `${BASE_URL}/blog/destination/${encodeURIComponent(dest)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      })),
      ...ANGLES.map((angle) => ({
        url: `${BASE_URL}/blog/angle/${angle}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      })),
      ...postList
        .filter((post) => isSafeSitemapBlogSlug(post.slug))
        .map((post) => {
          const last = post.updated_at || post.published_at;
          return {
            url: `${BASE_URL}/blog/${encodeURIComponent(post.slug)}`,
            lastModified: safeLastModified(last),
            changeFrequency: 'weekly' as const,
            priority: 0.7,
          };
        }),
    ];
  } catch (err) {
    console.warn('[sitemap] blog 로딩 실패:', err);
    return [];
  }
}

// ── RFQ + 패키지 destination 필터 ──────────────────────────
async function getOtherRoutes(): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured) return [];
  const routes: MetadataRoute.Sitemap = [];

  // RFQ
  try {
    const { data: rfqs } = await supabaseAdmin
      .from('rfqs')
      .select('id, created_at')
      .eq('status', 'awaiting_selection')
      .order('created_at', { ascending: false })
      .limit(500);
    const rfqRoutes = (rfqs || []).map((rfq: any) => ({
      url: `${BASE_URL}/rfq/${rfq.id}`,
      lastModified: rfq.created_at ? new Date(rfq.created_at) : new Date(),
      changeFrequency: 'hourly' as const,
      priority: 0.6,
    }));
    routes.push(...rfqRoutes);
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
    (pkgs || []).forEach((p: any) => {
      if (p.destination) destinations.add(p.destination);
    });
    const filterRoutes = [...destinations].map((dest) => ({
      url: `${BASE_URL}/packages?destination=${encodeURIComponent(dest)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
    routes.push(...filterRoutes);
  } catch {
    // noop
  }

  return routes;
}
