import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { REGIONS, getRegionBySlug, getDestinationUrl, cityInRegion } from '@/lib/regions';
import GlobalNav from '@/components/customer/GlobalNav';
import PackageCard, { type PackageCardData } from '@/components/customer/PackageCard';
import SearchBar from '@/components/customer/SearchBar';
import SectionHeader from '@/components/customer/SectionHeader';

export const revalidate = 600;
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

export async function generateStaticParams() {
  return REGIONS.map(r => ({ region: r.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ region: string }> }): Promise<Metadata> {
  const { region: slug } = await params;
  const region = getRegionBySlug(slug);
  if (!region) return {};
  return {
    title: `${region.label} 여행 패키지 가이드`,
    description: `${region.label} 여행의 모든 것 — ${region.tagline}. ${region.featuredCities.slice(0, 4).join('·')} 등 운영팀 검증 패키지를 한곳에서.`,
    alternates: { canonical: `${BASE_URL}/destinations/region/${slug}` },
    openGraph: {
      title: `${region.label} 여행 가이드 | 여소남`,
      description: region.tagline,
      url: `${BASE_URL}/destinations/region/${slug}`,
      type: 'website',
    },
  };
}

interface CityCard {
  destination: string;
  package_count: number;
  min_price: number | null;
  avg_rating: number | null;
  total_reviews: number | null;
  image: string | null;
}

interface RegionData {
  cities: CityCard[];
  packages: PackageCardData[];
  posts: Array<{ id: string; slug: string; seo_title: string | null; og_image_url: string | null; content_type: string | null }>;
  totalPackages: number;
  minPrice: number | null;
}

async function getRegionData(slug: string): Promise<RegionData | null> {
  const region = getRegionBySlug(slug);
  if (!region) return null;
  if (!isSupabaseConfigured) {
    return { cities: [], packages: [], posts: [], totalPackages: 0, minPrice: null };
  }

  const { data: allDests } = await supabaseAdmin
    .from('active_destinations')
    .select('destination, package_count, min_price, avg_rating, total_reviews')
    .limit(500);

  // 이 region 에 속하는 도시만 필터 — 토큰화 매칭(cityInRegion)으로 멀티시티 "북경/홍콩" false-positive 방지.
  const regionDests = ((allDests as Array<{ destination: string; package_count: number; min_price: number | null; avg_rating: number | null; total_reviews: number | null }> | null) ?? [])
    .filter(d => cityInRegion(d.destination, slug));

  const dests = regionDests.map(d => d.destination);

  // 도시·패키지·블로그 3종을 병렬 — 각자 dests 만 의존하므로 round-trip 1회로 합침.
  const today = new Date().toISOString().slice(0, 10);
  const emptyResult = { data: null } as { data: null };
  const [attrsRes, pkgsRes, blogRes] = await Promise.all([
    dests.length > 0
      ? supabaseAdmin.from('attractions').select('region, photos').in('region', dests).not('photos', 'is', null).limit(200)
      : Promise.resolve(emptyResult),
    dests.length > 0
      // travel_packages 에는 hero_image_url / thumbnail_urls 컬럼 없음 — 포함 시 쿼리 통째로 에러 → data=null
      ? supabaseAdmin
          .from('travel_packages')
          .select('id, title, display_title, hero_tagline, destination, duration, nights, price, price_dates, price_tiers, product_type, airline, departure_airport, product_highlights, is_airtel, avg_rating, review_count, seats_held, seats_confirmed, products(display_name, internal_code)')
          .in('destination', dests)
          .in('status', ['active', 'approved'])
          .order('price', { ascending: true })
          .limit(24)
      : Promise.resolve(emptyResult),
    dests.length > 0
      ? supabaseAdmin
          .from('content_creatives')
          .select('id, slug, seo_title, og_image_url, content_type, destination')
          .in('destination', dests)
          .eq('channel', 'naver_blog')
          .eq('status', 'published')
          .not('slug', 'is', null)
          .order('published_at', { ascending: false })
          .limit(8)
      : Promise.resolve(emptyResult),
  ]);
  const attrs = attrsRes.data;
  const pkgs = pkgsRes.data;
  const blogPosts = blogRes.data;

  const imgByDest: Record<string, string> = {};
  ((attrs as Array<{ region: string; photos: Array<{ src_medium?: string }> | null }> | null) ?? []).forEach(a => {
    const key = a.region;
    if (key && !imgByDest[key]) {
      const u = a.photos?.[0]?.src_medium;
      if (u) imgByDest[key] = u;
    }
  });

  // 출발일 살아있는 상품만 + Supabase 의 products 배열을 단일 객체로 정규화
  const alivePkgs = ((pkgs as any[] | null) ?? [])
    .filter(p => {
      const pd = (p.price_dates ?? []) as Array<{ date?: string }>;
      if (pd.length === 0) return true;
      return pd.some(d => d.date && d.date >= today);
    })
    .map(p => ({
      ...p,
      products: Array.isArray(p.products) ? p.products[0] ?? null : p.products,
    }))
    .slice(0, 12) as PackageCardData[];

  const cities: CityCard[] = regionDests
    .sort((a, b) => (b.package_count ?? 0) - (a.package_count ?? 0))
    .map(d => ({
      destination: d.destination,
      package_count: d.package_count ?? 0,
      min_price: d.min_price ?? null,
      avg_rating: d.avg_rating != null ? Number(d.avg_rating) : null,
      total_reviews: d.total_reviews ?? null,
      image: imgByDest[d.destination] ?? null,
    }));

  const totalPackages = cities.reduce((sum, c) => sum + c.package_count, 0);
  const minPrice = cities
    .map(c => c.min_price)
    .filter((v): v is number => typeof v === 'number' && v > 0)
    .reduce<number | null>((min, v) => (min == null || v < min ? v : min), null);

  return {
    cities,
    packages: alivePkgs,
    posts: ((blogPosts as any[] | null) ?? []).map(p => ({
      id: p.id, slug: p.slug, seo_title: p.seo_title, og_image_url: p.og_image_url, content_type: p.content_type,
    })),
    totalPackages,
    minPrice,
  };
}

export default async function RegionLandingPage({ params }: { params: Promise<{ region: string }> }) {
  const { region: slug } = await params;
  const region = getRegionBySlug(slug);
  if (!region) notFound();

  const data = await getRegionData(slug);
  if (!data) notFound();

  const heroImage = data.cities.find(c => c.image)?.image ?? null;

  return (
    <>
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'CollectionPage',
                name: `${region.label} 여행 패키지`,
                description: region.tagline,
                url: `${BASE_URL}/destinations/region/${slug}`,
                inLanguage: 'ko-KR',
              },
              {
                '@type': 'BreadcrumbList',
                itemListElement: [
                  { '@type': 'ListItem', position: 1, name: '홈', item: BASE_URL },
                  { '@type': 'ListItem', position: 2, name: '여행지', item: `${BASE_URL}/destinations` },
                  { '@type': 'ListItem', position: 3, name: region.label, item: `${BASE_URL}/destinations/region/${slug}` },
                ],
              },
            ],
          }),
        }}
      />

      <GlobalNav />

      <main className="min-h-screen bg-white">
        {/* Hero — Jiwonnote 의 도시 hero 패턴을 region 단위로 적용 */}
        <header className="relative min-h-[320px] md:min-h-[420px] overflow-hidden bg-slate-900">
          {heroImage && (
            <div className="absolute inset-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImage} alt={`${region.label} 여행 대표 이미지`} className="w-full h-full object-cover opacity-70" loading="eager" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/95 via-slate-900/60 to-slate-900/30" />
            </div>
          )}
          <div className="relative max-w-6xl mx-auto px-4 md:px-6 py-12 md:py-20 text-white">
            <nav className="text-[13px] md:text-sm text-slate-300 mb-4" aria-label="breadcrumb">
              <Link href="/" className="hover:underline">홈</Link>
              <span className="mx-1.5">/</span>
              <Link href="/destinations" className="hover:underline">여행지</Link>
              <span className="mx-1.5">/</span>
              <span className="text-white">{region.label}</span>
            </nav>
            <div className="text-2xl md:text-4xl mb-2 opacity-90">{region.emoji} {region.label.toUpperCase()}</div>
            <h1 className="text-[40px] md:text-[64px] font-black tracking-tight leading-[1.05]">{region.label} 여행</h1>
            <p className="mt-4 text-base md:text-lg text-slate-200 max-w-2xl leading-relaxed">{region.tagline}</p>

            <div className="mt-6 md:mt-8 flex flex-wrap gap-2 text-[13px] md:text-sm">
              <span className="px-3.5 py-1.5 bg-white/15 backdrop-blur rounded-full border border-white/20">
                🌏 {data.cities.length}개 여행지
              </span>
              <span className="px-3.5 py-1.5 bg-white/15 backdrop-blur rounded-full border border-white/20">
                🧳 {data.totalPackages}개 패키지
              </span>
              {data.minPrice && (
                <span className="px-3.5 py-1.5 bg-amber-400/20 backdrop-blur rounded-full border border-amber-300/30 text-amber-100 font-bold">
                  {Math.round(data.minPrice / 10000).toLocaleString()}만원부터
                </span>
              )}
            </div>
          </div>
        </header>

        {/* 통합 검색바 — region 안에서 도시·일정·가격으로 패키지 좁히기 */}
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4">
            <SearchBar />
          </div>
        </div>

        {/* 도시 토글바 — Jiwonnote 의 "오사카·교토·고베·나라" 칩 */}
        {data.cities.length > 0 && (
          <div className="border-b border-slate-200 bg-white sticky top-14 md:top-16 z-30">
            <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex gap-2 overflow-x-auto scrollbar-hide">
              <Link
                href={`/destinations/region/${slug}`}
                className="flex-shrink-0 text-sm bg-[#3182F6] text-white px-3 py-1.5 rounded-md font-medium"
                aria-current="page"
              >
                전체
              </Link>
              {data.cities.map(c => (
                <Link
                  key={c.destination}
                  href={getDestinationUrl(c.destination)}
                  className="flex-shrink-0 text-sm bg-white text-gray-700 border border-gray-200 px-3 py-1.5 rounded-md hover:shadow-card-hover hover:text-[#3182F6] transition"
                >
                  {c.destination}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-16 space-y-16 md:space-y-20">
          {/* 도시 카드 그리드 — Jiwonnote 의 "추천 콘텐츠" 2열 + "최신 콘텐츠" 3열 패턴 */}
          {data.cities.length > 0 ? (
            <section>
              <SectionHeader
                title={`${region.label} 추천 여행지`}
                subtitle="도시별 가이드 · 관광지 · 엄선 패키지"
              />
              <div className="grid gap-4 md:gap-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {data.cities.map(c => (
                  <Link
                    key={c.destination}
                    href={getDestinationUrl(c.destination)}
                    className="group relative h-64 md:h-80 rounded-xl overflow-hidden border border-slate-200 bg-slate-200"
                  >
                    {c.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.image} alt={`${c.destination} 대표 이미지`} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#3182F6] to-[#1B64DA] flex items-center justify-center text-5xl">{region.emoji}</div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/30 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4 md:p-5 text-white">
                      <h3 className="text-xl md:text-2xl font-black leading-tight tracking-tight">{c.destination}</h3>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs md:text-[13px] text-slate-200">
                        <span>🧳 {c.package_count}개</span>
                        {c.min_price ? <span>· {Math.round(c.min_price / 10000)}만원~</span> : null}
                        {c.avg_rating ? <span>· ★ {c.avg_rating.toFixed(1)}</span> : null}
                      </div>
                      <div className="mt-2 text-xs md:text-[13px] text-amber-300 font-bold opacity-90">완벽 가이드 →</div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : (
            <section className="py-12 text-center">
              <p className="text-base text-slate-600 mb-2">{region.label} 패키지 준비 중입니다</p>
              <p className="text-[13px] text-slate-400 mb-4">곧 운영팀이 {region.label} 여행지를 정식 오픈합니다.</p>
              <Link href="/group-inquiry" className="inline-block px-5 py-2 bg-[#3182F6] text-white text-sm rounded-full hover:opacity-90">
                맞춤 문의하기 →
              </Link>
            </section>
          )}

          {/* 추천 패키지 — 통합 카드 사용 */}
          {data.packages.length > 0 && (
            <section>
              <SectionHeader
                title={`${region.label} 엄선 패키지`}
                subtitle="가성비 · 중가 · 프리미엄 · 운영팀 검증"
                actionHref={`/packages?filter=${encodeURIComponent(region.label)}`}
                actionLabel="전체 보기 →"
              />
              <div className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {data.packages.map(p => (
                  <PackageCard key={p.id} pkg={p} variant="vertical" />
                ))}
              </div>
            </section>
          )}

          {/* 매거진 카드 */}
          {data.posts.length > 0 && (
            <section>
              <SectionHeader title={`${region.label} 여행 매거진`} subtitle="가이드 · 꿀팁 · 후기" />
              <div className="grid gap-4 md:gap-6 grid-cols-2 md:grid-cols-4">
                {data.posts.map(p => (
                  <Link key={p.id} href={`/blog/${p.slug}`} className="group bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition">
                    {p.og_image_url ? (
                      <div className="aspect-[16/9] bg-slate-100 overflow-hidden">
                        <Image src={p.og_image_url} alt={p.seo_title || ''} width={400} height={225} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    ) : (
                      <div className="aspect-[16/9] bg-gradient-to-br from-[#EBF3FE] to-[#F2F4F6] flex items-center justify-center text-3xl">📖</div>
                    )}
                    <div className="p-4">
                      <h3 className="text-sm md:text-base font-bold text-slate-900 line-clamp-2 leading-snug min-h-[2.8em] group-hover:text-[#3182F6] tracking-tight">
                        {p.seo_title || '여행 가이드'}
                      </h3>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* CTA */}
          <section className="text-center bg-slate-50 border border-slate-200 rounded-2xl p-8 md:p-12">
            <h3 className="text-xl md:text-2xl font-black text-slate-900 mb-3 tracking-tight">
              {region.label} 여행 상담이 필요하신가요?
            </h3>
            <p className="text-sm md:text-base text-slate-600 mb-6">
              여소남 운영팀이 {region.label} 최적 패키지를 맞춤 추천해드립니다.
            </p>
            <a href="https://pf.kakao.com/_xcFxkBG/chat" target="_blank" rel="noopener" referrerPolicy="no-referrer-when-downgrade" className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#FEE500] text-[#3C1E1E] font-bold text-base rounded-full hover:opacity-90">
              💬 카카오톡 상담하기
            </a>
          </section>
        </div>
      </main>
    </>
  );
}
