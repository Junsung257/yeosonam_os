import type { Metadata } from 'next';
import TourDetailClient from './TourDetailClient';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yesonam.com';

// ── SSR 상품 데이터 fetch ──────────────────────────────────────

async function getTour(id: string) {
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

// ── 동적 메타태그 ────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tour = await getTour(id);
  if (!tour) return { title: '상품을 찾을 수 없습니다' };

  const title = tour.title ?? '여소남 여행 상품';
  const description = [
    tour.destination && `목적지: ${tour.destination}`,
    tour.duration   && `${tour.duration}일`,
    tour.price      && `₩${tour.price.toLocaleString('ko-KR')}부터`,
  ].filter(Boolean).join(' | ');

  return {
    title,
    description: description || '여소남에서 안심 여행을 예약하세요.',
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/tour/${id}`,
      images: tour.image_url ? [{ url: tour.image_url }] : [`${BASE_URL}/og-image.png`],
    },
    alternates: { canonical: `${BASE_URL}/tour/${id}` },
  };
}

// ── JSON-LD 생성 ─────────────────────────────────────────────

function buildJsonLd(tour: Record<string, unknown>, id: string) {
  const price   = (tour.price as number) ?? 0;
  const rating  = (tour.rating as number) ?? 4.5;
  const reviews = (tour.review_count as number) ?? 12;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        name: tour.title ?? '여소남 여행 상품',
        description: tour.description ?? '',
        url: `${BASE_URL}/tour/${id}`,
        image: tour.image_url ?? `${BASE_URL}/og-image.png`,
        brand: { '@type': 'Brand', name: '여소남' },
        // 고객 화면: 판매가만 노출 (원가 미포함)
        offers: {
          '@type': 'Offer',
          priceCurrency: 'KRW',
          price: price,
          availability: 'https://schema.org/InStock',
          url: `${BASE_URL}/tour/${id}`,
          seller: { '@type': 'Organization', name: '여소남' },
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: rating,
          reviewCount: reviews,
          bestRating: 5,
          worstRating: 1,
        },
      },
      {
        '@type': 'TouristTrip',
        name: tour.title,
        description: tour.description ?? '',
        touristType: tour.destination ? `${tour.destination} 여행` : '해외여행',
        itinerary: {
          '@type': 'ItemList',
          itemListElement: ((tour.itinerary as string[]) ?? []).map((day: string, i: number) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: day,
          })),
        },
      },
    ],
  };
}

// ── 페이지 ───────────────────────────────────────────────────

export default async function TourDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tour = await getTour(id);
  const jsonLd = tour ? buildJsonLd(tour, id) : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <TourDetailClient id={id} initialTour={tour} />
    </>
  );
}
