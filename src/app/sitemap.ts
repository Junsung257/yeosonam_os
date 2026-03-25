import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yesonam.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // ── 정적 경로 ─────────────────────────────────────────────
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/packages`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/concierge`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/group-inquiry`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/login`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
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

  return [...staticRoutes, ...tourRoutes, ...rfqRoutes];
}
