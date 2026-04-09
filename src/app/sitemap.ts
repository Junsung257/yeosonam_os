import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // ── 정적 경로 ─────────────────────────────────────────────
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/packages`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/concierge`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/group-inquiry`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    // /login은 robots.txt에서 Disallow → sitemap에서도 제외
  ];

  // ── 동적 경로: 패키지 상품 ─────────────────────────────────
  let tourRoutes: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${BASE_URL}/api/packages?sitemap=true`, {
      next: { revalidate: 3600 }, // 1시간 캐시
    });
    if (res.ok) {
      const data = await res.json();
      const packages: { id: string; updated_at?: string }[] = data.packages ?? [];
      tourRoutes = packages.map((pkg) => ({
        url: `${BASE_URL}/tour/${pkg.id}`,
        lastModified: pkg.updated_at ? new Date(pkg.updated_at) : new Date(),
        changeFrequency: 'weekly',
        priority: 0.85,
      }));
    }
  } catch {
    // 빌드 시점에 API 미가용 → 정적 경로만 포함
  }

  // ── 동적 경로: RFQ (공개된 것만) ─────────────────────────
  let rfqRoutes: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${BASE_URL}/api/rfq?status=awaiting_selection&sitemap=true`, {
      next: { revalidate: 1800 },
    });
    if (res.ok) {
      const data = await res.json();
      const rfqs: { id: string; created_at?: string }[] = data.rfqs ?? [];
      rfqRoutes = rfqs.map((rfq) => ({
        url: `${BASE_URL}/rfq/${rfq.id}`,
        lastModified: rfq.created_at ? new Date(rfq.created_at) : new Date(),
        changeFrequency: 'hourly',
        priority: 0.6,
      }));
    }
  } catch {
    // 무시
  }

  // ── 동적 경로: 블로그 글 ──────────────────────────────────
  let blogRoutes: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${BASE_URL}/api/blog?limit=50`, {
      next: { revalidate: 600 }, // 10분 (블로그 페이지 ISR과 동일)
    });
    if (res.ok) {
      const data = await res.json();
      const posts: { slug: string; published_at?: string }[] = data.posts ?? [];
      // 목적지 목록 추출 (카테고리 랜딩 페이지용)
      const destinations = new Set<string>();
      const postsTyped: { slug: string; published_at?: string; travel_packages?: { destination?: string } }[] = data.posts ?? [];
      postsTyped.forEach(p => { if (p.travel_packages?.destination) destinations.add(p.travel_packages.destination); });

      blogRoutes = [
        // 블로그 목록 페이지
        { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
        // 목적지 카테고리 랜딩 페이지
        ...[...destinations].map(dest => ({
          url: `${BASE_URL}/blog/destination/${encodeURIComponent(dest)}`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.75,
        })),
        // 개별 글
        ...postsTyped.map((post) => ({
          url: `${BASE_URL}/blog/${post.slug}`,
          lastModified: post.published_at ? new Date(post.published_at) : new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.7,
        })),
      ];
    }
  } catch {
    // 빌드 시점에 API 미가용 → 블로그 경로 제외
  }

  return [...staticRoutes, ...tourRoutes, ...rfqRoutes, ...blogRoutes];
}
