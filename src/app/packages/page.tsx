import type { Metadata } from 'next';
import { Suspense } from 'react';

import { listPublicCatalog } from '@/lib/public-catalog';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

import PackagesClient from './PackagesClient';
import Loading from './loading';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');

export const revalidate = 300;

export const metadata: Metadata = {
  title: '패키지·크루즈·골프 여행상품',
  description: '부산 출발 패키지·크루즈·골프 상품의 출발일, 최근 확인 가격과 예약 조건을 비교하세요.',
  alternates: { canonical: `${BASE_URL}/packages` },
};

export default async function PackagesPage() {
  const packages = isSupabaseConfigured
    ? await listPublicCatalog(supabaseAdmin, { limit: 500 }).catch((error) => {
        console.error('[packages] public catalog unavailable', error);
        return [];
      })
    : [];

  return (
    <Suspense fallback={<Loading />}>
      <PackagesClient initialPackages={packages} />
    </Suspense>
  );
}
