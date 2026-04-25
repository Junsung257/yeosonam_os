import type { MetadataRoute } from 'next';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

// Google sitemap 1파일 상한은 50,000 URL / 50MB. 아래 상한은 방어적으로 둔다.
const HARD_LIMIT = 45000;

export const revalidate = 3600; // 1시간 — sitemap 자체도 ISR

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // ── 정적 경로 ─────────────────────────────────────────────
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/packages`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/destinations`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/concierge`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/group-inquiry`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    // /login 은 robots.txt 에서 Disallow → sitemap 에서도 제외
  ];

  if (!isSupabaseConfigured) return staticRoutes;

  // ── 동적: 상품 + 목적지 필터 랜딩 ─────────────────────────
  let tourRoutes: MetadataRoute.Sitemap = [];
  let destinationFilterRoutes: MetadataRoute.Sitemap = [];
  try {
    const { data: pkgs } = await supabaseAdmin
      .from('travel_packages')
      .select('id, updated_at, destination')
      .in('status', ['active', 'approved'])
      .order('updated_at', { ascending: false })
      .limit(HARD_LIMIT);

    const packages = pkgs || [];
    tourRoutes = packages.map((pkg: any) => ({
      url: `${BASE_URL}/packages/${pkg.id}`,
      lastModified: pkg.updated_at ? new Date(pkg.updated_at) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    }));

    const destinations = new Set<string>();
    packages.forEach((p: any) => {
      if (p.destination) destinations.add(p.destination);
    });
    destinationFilterRoutes = [...destinations].map((dest) => ({
      url: `${BASE_URL}/packages?destination=${encodeURIComponent(dest)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
  } catch (err) {
    console.warn('[sitemap] packages 로딩 실패:', err);
  }

  // ── 동적: RFQ (공개 selection 단계) ─────────────────────────
  let rfqRoutes: MetadataRoute.Sitemap = [];
  try {
    const { data: rfqs } = await supabaseAdmin
      .from('rfqs')
      .select('id, created_at')
      .eq('status', 'awaiting_selection')
      .order('created_at', { ascending: false })
      .limit(500);

    rfqRoutes = (rfqs || []).map((rfq: any) => ({
      url: `${BASE_URL}/rfq/${rfq.id}`,
      lastModified: rfq.created_at ? new Date(rfq.created_at) : new Date(),
      changeFrequency: 'hourly' as const,
      priority: 0.6,
    }));
  } catch {
    // 무시 — 테이블이 없거나 일시적 오류
  }

  // ── 동적: 블로그 (모든 발행 글 + 카테고리 랜딩) ─────────────────
  let blogRoutes: MetadataRoute.Sitemap = [];
  try {
    const { data: posts } = await supabaseAdmin
      .from('content_creatives')
      .select(
        'slug, published_at, updated_at, og_image_url, seo_title, travel_packages(destination)',
      )
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(HARD_LIMIT);

    const postList = (posts || []) as Array<{
      slug: string;
      published_at: string | null;
      updated_at: string | null;
      og_image_url: string | null;
      seo_title: string | null;
      travel_packages: { destination: string | null } | null;
    }>;

    const destinations = new Set<string>();
    postList.forEach((p) => {
      if (p.travel_packages?.destination) destinations.add(p.travel_packages.destination);
    });

    const ANGLES = ['value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food'];

    blogRoutes = [
      // 목적지 카테고리 랜딩
      ...[...destinations].map((dest) => ({
        url: `${BASE_URL}/blog/destination/${encodeURIComponent(dest)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      })),
      // 앵글별 카테고리 랜딩
      ...ANGLES.map((angle) => ({
        url: `${BASE_URL}/blog/angle/${angle}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      })),
      // 개별 글 — updated_at 우선, 없으면 published_at
      ...postList.map((post) => {
        const last = post.updated_at || post.published_at;
        const entry: MetadataRoute.Sitemap[number] = {
          url: `${BASE_URL}/blog/${post.slug}`,
          lastModified: last ? new Date(last) : new Date(),
          changeFrequency: 'weekly',
          priority: 0.7,
        };
        // Next.js MetadataRoute.Sitemap 는 images 속성을 지원 (xmlns:image 자동 주입)
        if (post.og_image_url) {
          (entry as any).images = [post.og_image_url];
        }
        return entry;
      }),
    ];
  } catch (err) {
    console.warn('[sitemap] blog 로딩 실패:', err);
  }

  // ── 동적: /destinations/[city] Pillar 허브 ─────────────────
  let destinationHubRoutes: MetadataRoute.Sitemap = [];
  try {
    const { data: activeDests } = await supabaseAdmin
      .from('active_destinations')
      .select('destination');

    destinationHubRoutes = ((activeDests || []) as Array<{ destination: string }>)
      .filter(d => d.destination)
      .map(d => ({
        url: `${BASE_URL}/destinations/${encodeURIComponent(d.destination)}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.9,  // Pillar 는 높은 우선순위
      }));
  } catch {
    // noop
  }

  return [
    ...staticRoutes,
    ...tourRoutes,
    ...destinationHubRoutes,
    ...destinationFilterRoutes,
    ...rfqRoutes,
    ...blogRoutes,
  ];
}
