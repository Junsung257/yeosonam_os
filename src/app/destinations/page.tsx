import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getDestinationUrl } from '@/lib/regions';
import GlobalNav from '@/components/customer/GlobalNav';
import SectionHeader from '@/components/customer/SectionHeader';
import { DestinationImageFallback, SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import { pickAttractionPhotoUrl } from '@/lib/image-url';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';
import { getPublicDestinationQueryNames } from '@/lib/public-destinations';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { CUSTOMER_VISIBLE_STATUSES } from '@/lib/visibility-status';
import { fetchAndMergeCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';
import { isPublicPublicationState } from '@/lib/package-publication/types';

export const revalidate = 600;
export const dynamic = 'force-dynamic';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');
const SOCIAL_IMAGE_URL = `${BASE_URL}/og-image.png`;

export const metadata: Metadata = {
  title: '여행지 완벽 가이드 | 목적지별 총정리',
  description: '여소남이 운영팀 검증으로 엄선한 여행지별 완벽 가이드 — 관광지·일정·준비물·계절·비자까지 한 곳에서.',
  alternates: { canonical: `${BASE_URL}/destinations` },
  openGraph: {
    title: '여행지 완벽 가이드',
    description: '여소남이 엄선한 여행지별 완벽 가이드. 목적지 Pillar Page.',
    url: `${BASE_URL}/destinations`,
    type: 'website',
    images: [{ url: SOCIAL_IMAGE_URL, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '여행지 완벽 가이드',
    description: '여소남이 엄선한 여행지별 완벽 가이드. 목적지 Pillar Page.',
    images: [SOCIAL_IMAGE_URL],
  },
};

type GalleryPhoto = { src_medium?: string | null; src_large?: string | null };

interface AttractionSample {
  destination: string;
  name: string;
  photos: GalleryPhoto[] | null;
}

type DestinationPackageStatsRow = {
  id?: string | null;
  destination: string | null;
  price?: number | null;
  status?: string | null;
  publication_state?: string | null;
  package_revision?: number | null;
  audit_status?: string | null;
  audit_report?: unknown;
  updated_at?: string | null;
  optional_tours?: unknown;
  itinerary_data?: unknown;
};

function normalizeAttractionSample(row: unknown): AttractionSample | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const destination = typeof record.region === 'string' ? record.region.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!destination || !name) return null;

  const photos = Array.isArray(record.photos)
    ? record.photos.filter((photo): photo is GalleryPhoto => photo != null && typeof photo === 'object')
    : null;

  return {
    destination,
    name,
    photos: photos && photos.length > 0 ? photos : null,
  };
}

async function getDestinations() {
  if (!isSupabaseConfigured) return { stats: [], imagesByDest: {} };
  if (shouldSkipPublicDbReadsForResourceSaver()) return { stats: [], imagesByDest: {} };

  try {
    const { data: stats } = await supabaseAdmin
      .from('travel_packages')
      .select('id, destination, price, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data')
      .in('status', [...CUSTOMER_VISIBLE_STATUSES])
      .in('publication_state', ['approved', 'published'])
      .not('destination', 'is', null)
      .limit(2000);

    const publicStats = await fetchAndMergeCurrentPublicPackageCardSnapshots(
      supabaseAdmin,
      ((stats ?? []) as DestinationPackageStatsRow[])
        .filter((pkg) => isPublicPublicationState(pkg.publication_state))
        .filter((pkg) => isCustomerPubliclyOpenable(pkg as Record<string, unknown>)) as unknown as Array<Record<string, unknown>>,
    );

    const statsByDestination = new Map<string, {
      destination: string;
      package_count: number;
      min_price: number | null;
      avg_rating: number | null;
      total_reviews: number | null;
    }>();
    (publicStats as unknown as Array<{ destination: string | null; price?: number | null }>)
      .forEach((pkg) => {
        const destination = pkg.destination?.trim();
        if (!destination) return;
        const current = statsByDestination.get(destination) ?? {
          destination,
          package_count: 0,
          min_price: null,
          avg_rating: null,
          total_reviews: null,
        };
        current.package_count += 1;
        if (typeof pkg.price === 'number' && pkg.price > 0 && (current.min_price == null || pkg.price < current.min_price)) {
          current.min_price = pkg.price;
        }
        statsByDestination.set(destination, current);
      });

    const normalizedStats = [...statsByDestination.values()]
      .sort((a, b) => b.package_count - a.package_count);
    const destinations = normalizedStats.map(s => s.destination);
    const queryNames = [...new Set(destinations.flatMap(getPublicDestinationQueryNames))];
    const [{ data: metadata }, { data: attractions }, { data: posts }] = queryNames.length > 0 ? await Promise.all([
      supabaseAdmin
        .from('destination_metadata')
        .select('destination, hero_image_url, photo_approved')
        .in('destination', queryNames)
        .eq('photo_approved', true),
      supabaseAdmin
        .from('attractions')
        .select('region, name, photos')
        .in('region', queryNames)
        .not('photos', 'is', null)
        .limit(4000),
      supabaseAdmin
        .from('content_creatives')
        .select('destination, og_image_url')
        .in('destination', queryNames)
        .eq('channel', 'naver_blog')
        .eq('status', 'published')
        .not('og_image_url', 'is', null)
        .order('published_at', { ascending: false })
        .limit(300),
    ]) : [{ data: null }, { data: null }, { data: null }];

    const imagesByDest: Record<string, string> = {};
    const aliasToDestination = new Map<string, string>();
    normalizedStats.forEach((stat) => {
      getPublicDestinationQueryNames(stat.destination).forEach((name) => aliasToDestination.set(name, stat.destination));
    });

    ((metadata as Array<{ destination?: string | null; hero_image_url?: string | null; photo_approved?: boolean }> | null) ?? []).forEach((row) => {
      const dest = row.destination ? aliasToDestination.get(row.destination) : null;
      if (dest && !imagesByDest[dest] && row.photo_approved && row.hero_image_url) imagesByDest[dest] = row.hero_image_url;
    });

    ((attractions as unknown[] | null) ?? []).forEach((row) => {
      const sample = normalizeAttractionSample(row);
      if (sample) {
        const dest = aliasToDestination.get(sample.destination);
        const image = pickAttractionPhotoUrl(sample.photos);
        if (dest && image && !imagesByDest[dest]) imagesByDest[dest] = image;
      }
    });

    ((posts as Array<{ destination?: string | null; og_image_url?: string | null }> | null) ?? []).forEach((row) => {
      const dest = row.destination ? aliasToDestination.get(row.destination) : null;
      if (dest && row.og_image_url && !imagesByDest[dest]) imagesByDest[dest] = row.og_image_url;
    });

    return { stats: normalizedStats, imagesByDest };
  } catch {
    return { stats: [], imagesByDest: {} };
  }
}

export default async function DestinationsIndexPage() {
  const { stats, imagesByDest } = await getDestinations();

  return (
    <>
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: '여행지 완벽 가이드',
            description: '여소남이 엄선한 목적지별 완벽 가이드 허브',
            url: `${BASE_URL}/destinations`,
            inLanguage: 'ko-KR',
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: stats.length,
              itemListElement: stats.slice(0, 20).map((s, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: s.destination,
                url: `${BASE_URL}${getDestinationUrl(s.destination)}`,
              })),
            },
          }),
        }}
      />

      <GlobalNav />
      <main className="min-h-screen bg-white">
        <header className="bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#1B3A6B] text-white">
          <div className="mx-auto max-w-6xl px-4 md:px-6 py-14 md:py-20">
            <Link href="/" className="text-[13px] md:text-sm text-slate-300 hover:text-white">
              ← 여소남 홈
            </Link>
            <h1 className="mt-3 text-[40px] md:text-[60px] font-black tracking-tight leading-[1.05]">
              여행지 완벽 가이드
            </h1>
            <p className="mt-4 text-base md:text-lg text-slate-300 max-w-2xl leading-relaxed">
              여소남 운영팀이 직접 답사·검증한 목적지별 정보 허브 — 관광지, 일정, 준비물, 비용까지 한곳에서 확인하세요.
            </p>
            <div className="mt-6 md:mt-8 flex gap-3 text-[13px] md:text-sm text-slate-200">
              <span>🌏 {stats.length}개 여행지</span>
              <span>·</span>
              <span>🧳 {stats.reduce((s, d) => s + d.package_count, 0)}개 엄선 패키지</span>
            </div>
          </div>
        </header>

        {/* Grid */}
        <section className="mx-auto max-w-6xl px-4 md:px-6 py-12 md:py-16">
          {stats.length === 0 ? (
            <p className="py-20 text-center text-slate-400">활성 여행지가 없습니다.</p>
          ) : (
            <>
              <SectionHeader title="전체 여행지" subtitle="패키지가 많은 순으로 정렬" />
              <div className="grid gap-4 md:gap-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {stats.map(d => {
                  const img = imagesByDest[d.destination] ?? null;
                  return (
                    <Link
                      key={d.destination}
                      href={getDestinationUrl(d.destination)}
                      className="group relative h-72 md:h-80 rounded-xl overflow-hidden border border-slate-200 bg-slate-200 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(49,130,246,0.18)]"
                    >
                      {img ? (
                        <SafeCoverImg
                          src={img}
                          alt={`${d.destination} 여행지 대표 사진`}
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                          fallback={
                            <DestinationImageFallback
                              title={d.destination}
                              destination={d.destination}
                              compact
                              className="absolute inset-0"
                            />
                          }
                        />
                      ) : (
                        <DestinationImageFallback
                          title={d.destination}
                          destination={d.destination}
                          compact
                          className="absolute inset-0"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/30 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-5 text-white">
                        <h2 className="text-xl md:text-2xl font-black leading-tight tracking-tight">
                          {d.destination}
                        </h2>
                        <div className="mt-2 flex gap-2 text-xs md:text-[13px] text-slate-200">
                          <span>🧳 {d.package_count}개</span>
                          {d.min_price && <span>· {Math.round(d.min_price / 10000)}만원~</span>}
                          {d.avg_rating && <span>· ⭐ {Number(d.avg_rating).toFixed(1)}</span>}
                        </div>
                        <div className="mt-2 text-xs md:text-[13px] text-amber-300 font-bold opacity-90">
                          완벽 가이드 보기 →
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}
