import type { Metadata } from 'next';
import { Suspense } from 'react';
import PackagesData from './PackagesData';
import Loading from './loading';
import { normalizeDepartureHub, type DepartureHubId } from '@/lib/departure-hub';

export const revalidate = 300; // 5분 ISR

// Vercel 공식 PPR 패턴 (https://nextjs.org/docs/15/app/getting-started/partial-prerendering):
//   "Components only opt into dynamic rendering when the value is accessed."
//   Page 는 searchParams 를 prop 으로 받기만 하고 access 안 함 → 정적 shell prerender 가능.
//   Suspense 안 PackagesData 만 dynamic, 검색 결과는 streaming.
//
// generateMetadata 는 searchParams access 하지만 metadata 만 dynamic — 페이지 본문 prerender 와 별개.

function hubMetaLabel(hub: DepartureHubId): string {
  if (hub === 'all') return '전국 출발';
  if (hub === 'busan') return '부산 출발';
  if (hub === 'incheon') return '인천 출발';
  if (hub === 'daegu') return '대구 출발';
  return '청주 출발';
}

export async function generateMetadata(
  props: {
    searchParams: Promise<{ destination?: string; q?: string; month?: string; hub?: string; filter?: string }>;
  }
): Promise<Metadata> {
  const searchParams = await props.searchParams;
  let hub = normalizeDepartureHub(searchParams.hub);
  if ((searchParams.filter || '') === '인천출발' && !searchParams.hub) hub = 'incheon';

  const term = (searchParams.destination || searchParams.q || '').trim();
  const month = searchParams.month || '';
  const hubLine = hubMetaLabel(hub);

  if (term) {
    const monthLabel = month ? ` ${month.split('-')[0]}년 ${parseInt(month.split('-')[1])}월` : '';
    return {
      title: `${term}${monthLabel} 패키지 | 여소남`,
      description: `${term}${monthLabel} · ${hubLine} 단체·패키지 여행. 확정일·요금 비교.`,
      alternates: {
        canonical: `/packages?destination=${encodeURIComponent(term)}${month ? `&month=${month}` : ''}`,
      },
    };
  }
  return {
    title: `${hubLine} 패키지 상품 | 여소남`,
    description: `${hubLine} 단체·패키지 여행 상품. 중국·일본·동남아·마카오 등 인기 여행지.`,
    alternates: { canonical: '/packages' },
  };
}

export default function PackagesPage(
  props: {
    searchParams: Promise<{
      destination?: string;
      filter?: string;
      q?: string;
      month?: string;
      priceMin?: string;
      priceMax?: string;
      urgency?: string;
      category?: string;
      hub?: string;
    }>;
  }
) {
  // Page 는 searchParams 를 access 하지 않고 prop 으로 forward — Page 자체는 정적.
  return (
    <Suspense fallback={<Loading />}>
      <PackagesData searchParams={props.searchParams} />
    </Suspense>
  );
}
