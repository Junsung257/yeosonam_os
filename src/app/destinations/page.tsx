import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const revalidate = 600;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

export const metadata: Metadata = {
  title: '여행지 완벽 가이드 | 목적지별 총정리',
  description: '여소남이 운영팀 검증으로 엄선한 여행지별 완벽 가이드 — 관광지·일정·준비물·계절·비자까지 한 곳에서.',
  alternates: { canonical: `${BASE_URL}/destinations` },
  openGraph: {
    title: '여행지 완벽 가이드 | 여소남',
    description: '여소남이 엄선한 여행지별 완벽 가이드. 목적지 Pillar Page.',
    url: `${BASE_URL}/destinations`,
    type: 'website',
  },
};

interface DestinationStat {
  destination: string;
  package_count: number;
  avg_rating: number | null;
  total_reviews: number | null;
  min_price: number | null;
}

interface AttractionSample {
  destination: string;
  name: string;
  photos: Array<{ src_medium?: string }> | null;
}

async function getDestinations() {
  if (!isSupabaseConfigured) return { stats: [], attractionsByDest: {} };

  const { data: stats } = await supabaseAdmin
    .from('active_destinations')
    .select('*')
    .order('package_count', { ascending: false });

  // 각 destination의 대표 이미지 (attractions 첫 번째 사진)
  const destinations = (stats as DestinationStat[] | null)?.map(s => s.destination) || [];
  const { data: attractions } = destinations.length > 0 ? await supabaseAdmin
    .from('attractions')
    .select('destination, name, photos')
    .in('destination', destinations)
    .not('photos', 'is', null)
    .limit(200) : { data: null };

  const attractionsByDest: Record<string, AttractionSample> = {};
  (attractions as AttractionSample[] | null)?.forEach(a => {
    if (a.destination && !attractionsByDest[a.destination]) {
      attractionsByDest[a.destination] = a;
    }
  });

  return { stats: (stats as DestinationStat[]) || [], attractionsByDest };
}

export default async function DestinationsIndexPage() {
  const { stats, attractionsByDest } = await getDestinations();

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
                url: `${BASE_URL}/destinations/${encodeURIComponent(s.destination)}`,
              })),
            },
          }),
        }}
      />

      <main className="min-h-screen bg-[#faf6f0]">
        <header className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white">
          <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
            <Link href="/" className="text-[13px] text-slate-300 hover:text-white">
              ← 여소남 홈
            </Link>
            <h1 className="mt-2 text-[32px] md:text-[44px] font-extrabold tracking-tight">
              여행지 완벽 가이드
            </h1>
            <p className="mt-2 text-[14px] md:text-[15px] text-slate-300 max-w-2xl">
              여소남 운영팀이 직접 답사·검증한 목적지별 정보 허브 — 관광지, 일정, 준비물, 비용까지 한곳에서 확인하세요.
            </p>
            <div className="mt-5 flex gap-3 text-[12px] text-slate-200">
              <span>🌏 {stats.length}개 여행지</span>
              <span>·</span>
              <span>🧳 {stats.reduce((s, d) => s + d.package_count, 0)}개 엄선 패키지</span>
            </div>
          </div>
        </header>

        {/* Grid */}
        <section className="mx-auto max-w-6xl px-4 py-10 md:py-14">
          {stats.length === 0 ? (
            <p className="py-20 text-center text-slate-400">활성 여행지가 없습니다.</p>
          ) : (
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {stats.map(d => {
                const attr = attractionsByDest[d.destination];
                const img = attr?.photos?.[0]?.src_medium;
                return (
                  <Link
                    key={d.destination}
                    href={`/destinations/${encodeURIComponent(d.destination)}`}
                    className="group relative h-64 md:h-72 rounded-xl overflow-hidden border border-slate-200 bg-slate-200"
                  >
                    {img ? (
                      <img
                        src={img}
                        alt={`${d.destination} 여행지 대표 사진`}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-indigo-300 to-purple-400 flex items-center justify-center text-5xl">
                        🌍
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/30 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                      <h2 className="text-[18px] md:text-[20px] font-bold leading-tight">
                        {d.destination}
                      </h2>
                      <div className="mt-1 flex gap-2 text-[11px] text-slate-200">
                        <span>🧳 {d.package_count}개</span>
                        {d.min_price && <span>· {Math.round(d.min_price / 10000)}만원~</span>}
                        {d.avg_rating && <span>· ⭐ {Number(d.avg_rating).toFixed(1)}</span>}
                      </div>
                      <div className="mt-2 text-[11px] text-amber-300 font-semibold opacity-90">
                        완벽 가이드 보기 →
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
