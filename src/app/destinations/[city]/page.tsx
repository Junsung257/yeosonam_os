import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { applyMarkdownAccents, applyHtmlAccents } from '@/lib/blog-accent';
import GlobalNav from '@/components/customer/GlobalNav';
import SectionHeader from '@/components/customer/SectionHeader';
import TravelFitnessCard from '@/components/customer/TravelFitnessCard';
import DestinationPackagesSection from '@/components/customer/DestinationPackagesSection';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import { getRegionForCity, getDestinationUrl, getRegionUrl, cityInRegion } from '@/lib/regions';
import { isSafeImageSrc, pickAttractionPhotoUrl } from '@/lib/image-url';

export const revalidate = 300;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

interface DestinationMeta {
  tagline: string | null;
  hero_tagline: string | null;
  hero_image_url: string | null;
  photo_approved: boolean;
}

interface ClimateData {
  destination: string;
  primary_city: string;
  country: string | null;
  timezone: string;
  utc_offset_minutes: number;
  monthly_normals: unknown;
  fitness_scores: unknown;
  seasonal_signals: unknown;
}

interface PillarData {
  destination: string;
  packageCount: number;
  avgRating: number | null;
  reviewCount: number;
  minPrice: number | null;
  attractions: Array<{
    id: string;
    name: string;
    short_desc: string | null;
    photos: Array<{ src_medium?: string }> | null;
    badge_type: string | null;
  }>;
  packages: Array<{
    id: string;
    title: string;
    destination: string;
    duration: number | null;
    nights: number | null;
    price: number | null;
    airline: string | null;
    departure_airport: string | null;
    avg_rating: number | null;
    review_count: number;
    price_dates: Array<{ date?: string }> | null;
  }>;
  relatedPosts: Array<{
    id: string;
    slug: string;
    seo_title: string | null;
    og_image_url: string | null;
    content_type: string | null;
    angle_type: string;
    published_at: string;
  }>;
  pillarPost: {
    blog_html: string;
    seo_title: string;
    seo_description: string | null;
    updated_at: string | null;
    published_at: string;
  } | null;
  siblingCities: string[];
  metadata: DestinationMeta | null;
  climateData: ClimateData | null;
  departureCities: string[];
}

function extractDepartureCity(airport: string): string {
  return airport.split('(')[0].trim();
}

async function getPillarData(city: string): Promise<PillarData | null> {
  if (!isSupabaseConfigured) return null;

  const today = new Date().toISOString().split('T')[0];
  const region = getRegionForCity(city);

  const siblingQuery = region
    ? supabaseAdmin
        .from('active_destinations')
        .select('destination, package_count')
        .order('package_count', { ascending: false })
        .limit(500)
    : Promise.resolve({ data: null });

  // destination_metadata는 테이블이 없을 수 있으므로 별도 try/catch
  const metadataQuery = supabaseAdmin
    .from('destination_metadata')
    .select('tagline, hero_tagline, hero_image_url, photo_approved')
    .eq('destination', city)
    .maybeSingle();

  const climateQuery = supabaseAdmin
    .from('destination_climate')
    .select('destination, primary_city, country, timezone, utc_offset_minutes, monthly_normals, fitness_scores, seasonal_signals')
    .eq('destination', city)
    .maybeSingle();

  const departureQuery = supabaseAdmin
    .from('travel_packages')
    .select('departure_airport')
    .eq('destination', city)
    .in('status', ['approved', 'active'])
    .not('departure_airport', 'is', null);

  const [
    { data: stats },
    { data: attractions },
    { data: packages },
    { data: posts },
    { data: pillarRow },
    { data: allDests },
    metadataResult,
    climateResult,
    { data: departurePkgs },
  ] = await Promise.all([
    supabaseAdmin.from('active_destinations').select('*').eq('destination', city).limit(1),
    supabaseAdmin
      .from('attractions')
      .select('id, name, short_desc, photos, badge_type')
      .eq('destination', city)
      .order('mention_count', { ascending: false })
      .limit(8),
    supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, nights, price, airline, departure_airport, avg_rating, review_count, price_dates')
      .eq('destination', city)
      .in('status', ['approved', 'active'])
      .order('price', { ascending: true })
      .limit(12),
    supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, og_image_url, content_type, angle_type, published_at')
      .or(`destination.eq.${city},travel_packages.destination.eq.${city}`)
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(8),
    supabaseAdmin
      .from('content_creatives')
      .select('blog_html, seo_title, seo_description, updated_at, published_at')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .eq('content_type', 'pillar')
      .eq('pillar_for', city)
      .limit(1),
    siblingQuery,
    metadataQuery,
    climateQuery,
    departureQuery,
  ]);

  if (!stats || stats.length === 0) return null;
  const stat = stats[0] as any;

  const alivePkgs = ((packages || []) as any[]).filter(p => {
    const pd = (p.price_dates || []) as Array<{ date?: string }>;
    if (pd.length === 0) return true;
    return pd.some(d => d.date && d.date >= today);
  });

  let siblingCities: string[] = [];
  if (region && allDests) {
    siblingCities = ((allDests as Array<{ destination: string }> | null) ?? [])
      .filter(d => d.destination !== city)
      .filter(d => cityInRegion(d.destination, region.slug))
      .map(d => d.destination)
      .slice(0, 8);
  }

  const departureCities = [
    ...new Set(
      ((departurePkgs || []) as Array<{ departure_airport: string | null }>)
        .map(p => p.departure_airport ? extractDepartureCity(p.departure_airport) : null)
        .filter((c): c is string => !!c && c.length > 0)
    ),
  ];

  // destination_metadata: 테이블 없으면 null로 처리
  const metadata: DestinationMeta | null =
    metadataResult.error ? null : (metadataResult.data as DestinationMeta | null);

  const climateData: ClimateData | null =
    climateResult.error ? null : (climateResult.data as ClimateData | null);

  return {
    destination: city,
    packageCount: stat.package_count || 0,
    avgRating: stat.avg_rating ? Number(stat.avg_rating) : null,
    reviewCount: stat.total_reviews || 0,
    minPrice: stat.min_price || null,
    attractions: (attractions as any[]) || [],
    packages: alivePkgs,
    relatedPosts: (posts as any[]) || [],
    pillarPost: (pillarRow as any[])?.[0] || null,
    siblingCities,
    metadata,
    climateData,
    departureCities,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params;
  const decoded = decodeURIComponent(city);
  return {
    title: `${decoded} 여행 완벽 가이드 | 관광지·일정·비용`,
    description: `${decoded} 여행의 모든 것 — 운영팀 검증 관광지, 추천 일정, 예상 비용, 계절별 팁까지. 여소남이 정리한 ${decoded} 완벽 가이드.`,
    alternates: {
      canonical: `${BASE_URL}/destinations/${encodeURIComponent(decoded)}`,
      types: {
        'application/rss+xml': [
          { url: `${BASE_URL}/destinations/${encodeURIComponent(decoded)}/rss.xml`, title: `${decoded} 여행 매거진 RSS` },
        ],
      },
    },
    openGraph: {
      title: `${decoded} 여행 완벽 가이드 | 여소남`,
      description: `${decoded} 여행의 모든 것. 운영팀 검증 관광지와 엄선 패키지까지.`,
      url: `${BASE_URL}/destinations/${encodeURIComponent(decoded)}`,
      type: 'website',
    },
  };
}

function renderPillarBody(md: string): string {
  const accented = applyMarkdownAccents(md);
  const html = marked.parse(accented) as string;
  const colored = applyHtmlAccents(html);
  return DOMPurify.sanitize(colored, { ADD_TAGS: ['mark', 'aside'], ADD_ATTR: ['class'] });
}

export default async function DestinationPillarPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const decoded = decodeURIComponent(city);
  const data = await getPillarData(decoded);
  if (!data) notFound();

  // 히어로 이미지: 승인된 메타 URL(안전한 경우만) > 관광지 갤러리 medium/large
  const fromMeta =
    data.metadata?.photo_approved &&
    data.metadata?.hero_image_url &&
    isSafeImageSrc(data.metadata.hero_image_url)
      ? data.metadata.hero_image_url.trim()
      : null;
  const fromAttr =
    data.attractions
      .map(a => pickAttractionPhotoUrl(a.photos as { src_medium?: string; src_large?: string }[] | null))
      .find(Boolean) ?? null;
  const heroImage = fromMeta || fromAttr;

  const pillarHtml = data.pillarPost?.blog_html ? renderPillarBody(data.pillarPost.blog_html) : null;
  const region = getRegionForCity(decoded);

  // 히어로 타이틀/설명 (destination_metadata 우선)
  const heroTitle = data.metadata?.tagline || `가보면 이해하는 곳, ${decoded}`;
  const heroDesc =
    data.metadata?.hero_tagline ||
    (pillarHtml && data.pillarPost?.seo_description
      ? data.pillarPost.seo_description
      : `여소남 운영팀이 직접 검증한 ${decoded} 여행의 핵심 정보`);

  // 출발지가 1개면 필터 탭 의미 없음
  const showDepartureTabs = data.departureCities.length >= 2;

  // 출발월 분포 (climate 카드용)
  const departureDist: Record<number, number> = {};
  data.packages.forEach(p => {
    (p.price_dates || []).forEach(d => {
      if (d.date) {
        const m = new Date(d.date).getMonth() + 1;
        departureDist[m] = (departureDist[m] || 0) + 1;
      }
    });
  });

  return (
    <>
      {/* JSON-LD: TouristDestination + BreadcrumbList */}
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'TouristDestination',
                name: decoded,
                description: data.pillarPost?.seo_description || `${decoded} 여행 완벽 가이드`,
                url: `${BASE_URL}/destinations/${encodeURIComponent(decoded)}`,
                ...(heroImage ? { image: heroImage } : {}),
                ...(data.avgRating
                  ? {
                      aggregateRating: {
                        '@type': 'AggregateRating',
                        ratingValue: data.avgRating.toFixed(2),
                        reviewCount: data.reviewCount || 1,
                      },
                    }
                  : {}),
                includesAttraction: data.attractions.slice(0, 8).map(a => ({
                  '@type': 'TouristAttraction',
                  name: a.name,
                })),
              },
              {
                '@type': 'BreadcrumbList',
                itemListElement: [
                  { '@type': 'ListItem', position: 1, name: '홈', item: BASE_URL },
                  { '@type': 'ListItem', position: 2, name: '여행지', item: `${BASE_URL}/destinations` },
                  ...(region
                    ? [{ '@type': 'ListItem', position: 3, name: region.label, item: `${BASE_URL}/destinations/region/${region.slug}` }]
                    : []),
                  {
                    '@type': 'ListItem',
                    position: region ? 4 : 3,
                    name: decoded,
                    item: `${BASE_URL}/destinations/${encodeURIComponent(decoded)}`,
                  },
                ],
              },
              ...(data.packages.length > 0
                ? [
                    {
                      '@type': 'ItemList',
                      name: `${decoded} 여행 상품`,
                      itemListElement: data.packages.slice(0, 10).map((p, i) => ({
                        '@type': 'ListItem',
                        position: i + 1,
                        item: {
                          '@type': 'Product',
                          name: p.title,
                          url: `${BASE_URL}/packages/${p.id}`,
                          ...(p.avg_rating && p.review_count > 0
                            ? {
                                aggregateRating: {
                                  '@type': 'AggregateRating',
                                  ratingValue: Number(p.avg_rating).toFixed(2),
                                  reviewCount: p.review_count,
                                },
                              }
                            : {}),
                          ...(p.price ? { offers: { '@type': 'Offer', price: p.price, priceCurrency: 'KRW' } } : {}),
                        },
                      })),
                    },
                  ]
                : []),
            ],
          }),
        }}
      />

      <GlobalNav />

      <main className="min-h-screen bg-white">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section
          className="relative min-h-[420px] md:min-h-[540px] overflow-hidden"
          style={!heroImage ? { background: 'linear-gradient(135deg, #1e3a5f 0%, #3182F6 100%)' } : undefined}
        >
          {/* 배경 이미지 */}
          {heroImage && (
            <div className="absolute inset-0">
              <SafeCoverImg
                src={heroImage}
                alt={`${decoded} 여행 대표 이미지`}
                className="w-full h-full object-cover scale-105 origin-center"
                fetchPriority="high"
                loading="eager"
                fallback={<div className="w-full h-full bg-gradient-to-br from-[#1e3a5f] to-brand" aria-hidden />}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/95 via-slate-900/65 to-slate-900/25" />
            </div>
          )}
          {!heroImage && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          )}

          <div className="relative mx-auto max-w-6xl px-4 py-14 md:py-24 text-white">
            {/* 브레드크럼 */}
            <nav className="text-[13px] md:text-sm text-white/60 mb-5">
              <Link href="/" className="hover:text-white/90 transition">홈</Link>
              <span className="mx-2 text-white/30">/</span>
              <Link href="/destinations" className="hover:text-white/90 transition">여행지</Link>
              {region && (
                <>
                  <span className="mx-2 text-white/30">/</span>
                  <Link href={getRegionUrl(region.slug)} className="hover:text-white/90 transition">{region.label}</Link>
                </>
              )}
              <span className="mx-2 text-white/30">/</span>
              <span className="text-white/90">{decoded}</span>
            </nav>

            {/* 메인 타이틀 */}
            <h1 className="text-[38px] md:text-[68px] font-black tracking-tight leading-[1.05] drop-shadow-lg break-keep">
              {heroTitle}
            </h1>
            <p className="mt-4 text-base md:text-xl text-white/85 max-w-2xl leading-relaxed drop-shadow break-keep">
              {heroDesc}
            </p>

            {/* 메타 뱃지 */}
            <div className="mt-6 md:mt-8 flex flex-wrap gap-2 text-[13px] md:text-sm">
              <span className="px-3.5 py-1.5 bg-white/15 backdrop-blur-sm rounded-full border border-white/20">
                🧳 {data.packageCount}개 상품
              </span>
              {data.attractions.length > 0 && (
                <span className="px-3.5 py-1.5 bg-white/15 backdrop-blur-sm rounded-full border border-white/20">
                  🗺️ {data.attractions.length}곳 관광지
                </span>
              )}
              {data.minPrice && (
                <span className="px-3.5 py-1.5 bg-amber-400/25 backdrop-blur-sm rounded-full border border-amber-300/40 text-amber-100 font-bold">
                  {Math.round(data.minPrice / 10000).toLocaleString()}만원부터
                </span>
              )}
              {data.avgRating && data.reviewCount > 0 && (
                <span className="px-3.5 py-1.5 bg-white/15 backdrop-blur-sm rounded-full border border-white/20">
                  ⭐ {data.avgRating.toFixed(1)} ({data.reviewCount}개 후기)
                </span>
              )}
            </div>

            {/* CTA 버튼 */}
            <div className="mt-8 md:mt-10">
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="#packages"
                  className="inline-flex justify-center items-center px-7 py-3.5 bg-white text-slate-900 font-bold text-base md:text-lg rounded-full hover:bg-slate-100 transition shadow-lg"
                >
                  상품 보기
                </a>
                <a
                  href="https://pf.kakao.com/_yeosonam"
                  target="_blank"
                  rel="noopener"
                  className="inline-flex justify-center items-center gap-2 px-7 py-3.5 bg-[#FEE500] text-[#3C1E1E] font-bold text-base md:text-lg rounded-full hover:bg-[#FEE500]/90 transition shadow-lg"
                >
                  💬 카카오톡 상담
                </a>
              </div>

              {/* Trust Bar — 동적 출발지 */}
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-white/75 font-medium">
                <span className="flex items-center gap-1">✓ 노팁·노옵션</span>
                <span className="flex items-center gap-1">✓ 운영팀 직접 검증</span>
                <span className="flex items-center gap-1">✓ 전 상품 직항</span>
                {data.departureCities.map(c => (
                  <span key={c} className="flex items-center gap-1">✓ {c} 출발</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 형제 도시 탭바 (sticky) ────────────────────────────────────── */}
        {region && data.siblingCities.length > 0 && (
          <div className="border-b border-slate-100 bg-white/95 backdrop-blur-sm sticky top-14 md:top-16 z-30">
            <div className="max-w-6xl mx-auto px-4 md:px-6 py-3.5 md:py-4 flex gap-2 overflow-x-auto scrollbar-hide">
              <span
                className="flex-shrink-0 text-sm md:text-base font-bold bg-slate-900 text-white px-4 py-2 rounded-lg"
                aria-current="page"
              >
                {decoded}
              </span>
              {data.siblingCities.map(c => (
                <Link
                  key={c}
                  href={getDestinationUrl(c)}
                  className="flex-shrink-0 text-sm md:text-base font-medium bg-white text-slate-600 border border-slate-200 px-4 py-2 rounded-lg hover:border-slate-900 hover:text-slate-900 transition"
                >
                  {c}
                </Link>
              ))}
              <Link
                href={getRegionUrl(region.slug)}
                className="flex-shrink-0 text-sm md:text-base text-brand font-bold px-4 py-2 hover:underline whitespace-nowrap"
              >
                {region.label} 전체 →
              </Link>
            </div>
          </div>
        )}

        <div className="mx-auto max-w-6xl px-4 md:px-6 py-12 md:py-16 space-y-16 md:space-y-20">
          {/* ── 1. 기후 적합도 (실데이터) ──────────────────────────────────── */}
          {data.climateData && (
            <TravelFitnessCard
              destination={data.climateData.destination}
              primaryCity={data.climateData.primary_city}
              country={data.climateData.country}
              monthlyNormals={data.climateData.monthly_normals as any}
              fitnessScores={data.climateData.fitness_scores as any}
              seasonalSignals={data.climateData.seasonal_signals as any}
              representativeMonth={new Date().getMonth() + 1}
              departureDistribution={Object.keys(departureDist).length > 0 ? departureDist : undefined}
            />
          )}

          {/* ── 2. Pillar 본문 ────────────────────────────────────────────── */}
          {pillarHtml && (
            <article className="prose prose-xl prose-blog max-w-none prose-p:text-base md:prose-p:text-lg prose-p:leading-relaxed prose-p:text-slate-700">
              <div dangerouslySetInnerHTML={{ __html: pillarHtml }} />
            </article>
          )}

          {/* ── 3. 관광지 그리드 ──────────────────────────────────────────── */}
          {data.attractions.length > 0 && (
            <section>
              <SectionHeader
                title={`${decoded}에서 꼭 봐야 할 필수 코스`}
                subtitle="운영팀 답사 기준 · 최신 정보"
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
                {data.attractions.map(a => {
                  const img = a.photos?.[0]?.src_medium;
                  return (
                    <div
                      key={a.id}
                      className="group bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                    >
                      {img ? (
                        <div className="aspect-[4/3] bg-slate-100 overflow-hidden relative">
                          <img
                            src={img}
                            alt={`${decoded} ${a.name}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        </div>
                      ) : (
                        <div className="aspect-[4/3] bg-gradient-to-br from-brand/10 to-brand/20 flex flex-col items-center justify-center gap-2">
                          <span className="text-5xl font-bold text-brand/40 drop-shadow-sm select-none">
                            {a.name.charAt(0)}
                          </span>
                          <span className="text-[11px] text-brand/40 font-medium">사진 준비중</span>
                        </div>
                      )}
                      <div className="p-4">
                        <h3 className="text-sm md:text-base font-bold text-slate-900 line-clamp-1 tracking-tight">{a.name}</h3>
                        {a.short_desc && (
                          <p className="text-[12px] md:text-[13px] text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">
                            {a.short_desc}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 4. 엄선 패키지 (출발지 필터 탭 포함) ─────────────────────── */}
          {data.packages.length > 0 && (
            <DestinationPackagesSection
              destination={decoded}
              packages={data.packages as any}
              departureCities={showDepartureTabs ? data.departureCities : []}
            />
          )}

          {/* ── 5. 관련 블로그 ────────────────────────────────────────────── */}
          {data.relatedPosts.length > 0 && (
            <section>
              <SectionHeader
                title={`${decoded} 생생한 매거진 & 꿀팁`}
                subtitle="미리 알아두면 좋은 팁과 후기"
              />
              <div className="grid gap-4 md:gap-5 grid-cols-2 md:grid-cols-4">
                {data.relatedPosts.map(p => (
                  <Link
                    key={p.id}
                    href={`/blog/${p.slug}`}
                    className="group bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  >
                    {p.og_image_url ? (
                      <div className="aspect-[16/9] bg-slate-100 overflow-hidden">
                        <img
                          src={p.og_image_url}
                          alt={p.seo_title || ''}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="aspect-[16/9] bg-gradient-to-br from-brand-light to-[#F2F4F6] flex items-center justify-center text-3xl">
                        📖
                      </div>
                    )}
                    <div className="p-4">
                      <h3 className="text-sm md:text-base font-bold text-slate-900 line-clamp-2 leading-snug min-h-[2.8em] group-hover:text-brand tracking-tight transition-colors">
                        {p.seo_title || '블로그 가이드'}
                      </h3>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ── 6. 하단 CTA ───────────────────────────────────────────────── */}
          <section className="bg-[#EBF5FF] border border-brand/15 rounded-3xl p-8 md:p-12 text-center overflow-hidden relative">
            <div className="relative z-10 max-w-2xl mx-auto">
              <h3 className="text-2xl md:text-3xl font-black text-slate-900 mb-4 tracking-tight break-keep">
                어떤 상품이 우리한테 맞을지 모르겠다면
              </h3>
              <p className="text-base md:text-lg text-slate-600 mb-8 leading-relaxed break-keep">
                일정·예산·동행인 알려주시면{' '}
                <br className="md:hidden" />
                운영팀이 딱 맞는 패키지 골라드려요
              </p>

              <div className="flex justify-center gap-8 md:gap-14 mb-8 border-y border-brand/10 py-5 max-w-sm mx-auto">
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-black text-brand">3분</div>
                  <div className="text-[12px] md:text-[13px] font-bold text-slate-500 mt-0.5">평균 응답</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-black text-brand">무료</div>
                  <div className="text-[12px] md:text-[13px] font-bold text-slate-500 mt-0.5">상담 비용</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-black text-brand">10년+</div>
                  <div className="text-[12px] md:text-[13px] font-bold text-slate-500 mt-0.5">운영 경력</div>
                </div>
              </div>

              <a
                href="https://pf.kakao.com/_yeosonam"
                target="_blank"
                rel="noopener"
                className="inline-flex justify-center items-center gap-2 w-full md:w-auto md:px-14 py-4 bg-brand text-white font-bold text-base md:text-lg rounded-2xl hover:bg-brand-dark transition shadow-lg shadow-brand/25"
              >
                💬 카카오톡으로 무료 상담받기
              </a>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
