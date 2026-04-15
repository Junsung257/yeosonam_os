import { createClient } from '@supabase/supabase-js';
import type { Metadata } from 'next';
import PackagesClient from './PackagesClient';

export const revalidate = 300; // 5분 ISR

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { destination?: string; q?: string; month?: string };
}): Promise<Metadata> {
  const term = (searchParams.destination || searchParams.q || '').trim();
  const month = searchParams.month || '';
  if (term) {
    const monthLabel = month ? ` ${month.split('-')[0]}년 ${parseInt(month.split('-')[1])}월` : '';
    return {
      title: `${term}${monthLabel} 패키지 여행 | 여소남`,
      description: `${term}${monthLabel} 단체·패키지 여행 상품. 김해공항 출발, 확정일·잔여석 실시간 확인.`,
      alternates: {
        canonical: `/packages?destination=${encodeURIComponent(term)}${month ? `&month=${month}` : ''}`,
      },
    };
  }
  return {
    title: '전체 패키지 상품 | 여소남',
    description: '김해공항 출발 단체·패키지 여행 전체 상품. 중국·일본·동남아·마카오 인기 여행지.',
    alternates: { canonical: '/packages' },
  };
}

const PACKAGE_FIELDS = `
  id, title, destination, category, product_type, trip_style,
  departure_days, departure_airport, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_list, price_dates, status, created_at,
  product_tags, product_highlights, product_summary, itinerary_data,
  internal_code, is_airtel, display_title,
  products(internal_code, display_name)
`;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: { destination?: string; filter?: string; q?: string; month?: string; priceMax?: string };
}) {
  const destination = searchParams.destination || '';
  const filter = searchParams.filter || '';
  const q = searchParams.q?.trim() || '';
  const month = searchParams.month || '';
  const priceMax = searchParams.priceMax || '';
  const sb = getSupabase();

  // 상품 목록 서버사이드 fetch
  let query = sb
    .from('travel_packages')
    .select(PACKAGE_FIELDS)
    .in('status', ['active', 'approved'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (destination) {
    query = query.ilike('destination', `%${destination}%`);
  }

  // 자유 검색: destination/title/display_title 중 어디든 매칭
  if (q) {
    const safe = q.replace(/[%,]/g, ' ');
    query = query.or(`destination.ilike.%${safe}%,title.ilike.%${safe}%,display_title.ilike.%${safe}%`);
  }

  const { data: rawPackages } = await query;

  // products JOIN 결과를 단일 객체로 정규화 (Supabase는 배열로 반환)
  const packages = (rawPackages ?? []).map((pkg: any) => ({
    ...pkg,
    products: Array.isArray(pkg.products) ? pkg.products[0] ?? null : pkg.products,
  }));

  // 관광지 사진 서버사이드 fetch
  const { data: attractions } = await sb
    .from('attractions')
    .select('name, short_desc, photos, country, region, mention_count')
    .not('photos', 'is', null)
    .limit(300);

  return (
    <PackagesClient
      initialPackages={packages ?? []}
      initialAttractions={attractions ?? []}
      destination={destination}
      filter={filter}
      q={q}
      month={month}
      priceMax={priceMax}
    />
  );
}
