import type { Metadata } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yesonam.com';

async function getPackage(id: string) {
  try {
    const res = await fetch(`${BASE_URL}/api/packages?id=${id}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.package ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const pkg = await getPackage(id);
  if (!pkg) return { title: '상품을 찾을 수 없습니다 | 여소남' };

  // 제목: 랜드사명 제거, 여소남 브랜딩
  const rawTitle = (pkg.title ?? '여행 상품') as string;
  const title = rawTitle
    .replace(/투어폰|랜드부산|더투어|투어비|현지투어/g, '')
    .trim() + ' | 여소남';

  // 설명: 핵심 정보 조합
  const parts: string[] = [];
  if (pkg.destination) parts.push(pkg.destination);
  if (pkg.duration) parts.push(`${pkg.duration}일`);
  if (pkg.price) parts.push(`₩${Number(pkg.price).toLocaleString('ko-KR')}~`);
  if (pkg.product_highlights?.length) {
    parts.push((pkg.product_highlights as string[]).slice(0, 3).join(', '));
  }
  const description = parts.length > 0
    ? parts.join(' | ')
    : '여소남에서 안심 여행을 예약하세요.';

  // OG 이미지: itinerary_data에서 첫 번째 호텔 사진 또는 기본 이미지
  const ogImage = `${BASE_URL}/og-image.png`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/packages/${id}`,
      siteName: '여소남',
      type: 'website',
      images: [{ url: ogImage, width: 1200, height: 630, alt: rawTitle }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
    alternates: { canonical: `${BASE_URL}/packages/${id}` },
  };
}

export default function PackageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
