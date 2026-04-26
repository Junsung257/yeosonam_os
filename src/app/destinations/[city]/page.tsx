import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { applyMarkdownAccents, applyHtmlAccents } from '@/lib/blog-accent';

export const revalidate = 300;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

interface PillarData {
  destination: string;
  packageCount: number;
  avgRating: number | null;
  reviewCount: number;
  minPrice: number | null;
  attractions: Array<{ id: string; name: string; short_desc: string | null; photos: Array<{ src_medium?: string }> | null; badge_type: string | null }>;
  packages: Array<{ id: string; title: string; destination: string; duration: number | null; nights: number | null; price: number | null; airline: string | null; departure_airport: string | null; hero_image_url: string | null; avg_rating: number | null; review_count: number }>;
  relatedPosts: Array<{ id: string; slug: string; seo_title: string | null; og_image_url: string | null; content_type: string | null; angle_type: string; published_at: string }>;
  pillarPost: { blog_html: string; seo_title: string; seo_description: string | null; updated_at: string | null; published_at: string } | null;
}

async function getPillarData(city: string): Promise<PillarData | null> {
  if (!isSupabaseConfigured) return null;

  const today = new Date().toISOString().split('T')[0];

  const [
    { data: stats },
    { data: attractions },
    { data: packages },
    { data: posts },
    { data: pillarRow },
  ] = await Promise.all([
    supabaseAdmin.from('active_destinations').select('*').eq('destination', city).limit(1),
    supabaseAdmin.from('attractions').select('id, name, short_desc, photos, badge_type').eq('destination', city).order('created_at', { ascending: true }).limit(8),
    supabaseAdmin.from('travel_packages').select('id, title, destination, duration, nights, price, airline, departure_airport, hero_image_url, avg_rating, review_count, price_dates').eq('destination', city).in('status', ['approved', 'active']).order('price', { ascending: true }).limit(12),
    supabaseAdmin.from('content_creatives').select('id, slug, seo_title, og_image_url, content_type, angle_type, published_at').or(`destination.eq.${city},travel_packages.destination.eq.${city}`).eq('channel', 'naver_blog').eq('status', 'published').not('slug', 'is', null).order('published_at', { ascending: false }).limit(8),
    supabaseAdmin.from('content_creatives').select('blog_html, seo_title, seo_description, updated_at, published_at').eq('channel', 'naver_blog').eq('status', 'published').eq('content_type', 'pillar').eq('pillar_for', city).limit(1),
  ]);

  if (!stats || stats.length === 0) return null;
  const stat = stats[0] as any;

  // 출발일 살아있는 상품만
  const alivePkgs = ((packages || []) as any[]).filter(p => {
    const pd = (p.price_dates || []) as Array<{ date?: string }>;
    if (pd.length === 0) return true;
    return pd.some(d => d.date && d.date >= today);
  });

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

  const heroImage = data.attractions[0]?.photos?.[0]?.src_medium || data.packages[0]?.hero_image_url;
  const pillarHtml = data.pillarPost?.blog_html ? renderPillarBody(data.pillarPost.blog_html) : null;

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
                ...(data.avgRating ? {
                  aggregateRating: {
                    '@type': 'AggregateRating',
                    ratingValue: data.avgRating.toFixed(2),
                    reviewCount: data.reviewCount || 1,
                  },
                } : {}),
                includesAttraction: data.attractions.slice(0, 8).map(a => ({
                  '@type': 'TouristAttraction', name: a.name,
                })),
              },
              {
                '@type': 'BreadcrumbList',
                itemListElement: [
                  { '@type': 'ListItem', position: 1, name: '홈', item: BASE_URL },
                  { '@type': 'ListItem', position: 2, name: '여행지', item: `${BASE_URL}/destinations` },
                  { '@type': 'ListItem', position: 3, name: decoded, item: `${BASE_URL}/destinations/${encodeURIComponent(decoded)}` },
                ],
              },
              ...(data.packages.length > 0 ? [{
                '@type': 'ItemList',
                name: `${decoded} 여행 상품`,
                itemListElement: data.packages.slice(0, 10).map((p, i) => ({
                  '@type': 'ListItem', position: i + 1,
                  item: {
                    '@type': 'Product',
                    name: p.title,
                    url: `${BASE_URL}/packages/${p.id}`,
                    ...(p.avg_rating && p.review_count > 0 ? {
                      aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(p.avg_rating).toFixed(2), reviewCount: p.review_count },
                    } : {}),
                    ...(p.price ? { offers: { '@type': 'Offer', price: p.price, priceCurrency: 'KRW' } } : {}),
                  },
                })),
              }] : []),
            ],
          }),
        }}
      />

      <main className="min-h-screen bg-[#faf6f0]">
        {/* Hero */}
        <section className="relative min-h-[380px] md:min-h-[460px] overflow-hidden">
          {heroImage && (
            <div className="absolute inset-0">
              <img src={heroImage} alt={`${decoded} 여행 대표 이미지`} className="w-full h-full object-cover" fetchPriority="high" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/95 via-slate-900/60 to-slate-900/30" />
            </div>
          )}
          <div className="relative mx-auto max-w-6xl px-4 py-12 md:py-20 text-white">
            <nav className="text-[12px] text-slate-300 mb-3">
              <Link href="/" className="hover:underline">홈</Link>
              <span className="mx-1.5">/</span>
              <Link href="/destinations" className="hover:underline">여행지</Link>
              <span className="mx-1.5">/</span>
              <span className="text-white">{decoded}</span>
            </nav>
            <h1 className="text-[36px] md:text-[56px] font-extrabold tracking-tight">
              {decoded} 여행 완벽 가이드
            </h1>
            <p className="mt-3 text-[14px] md:text-[16px] text-slate-200 max-w-2xl">
              운영팀이 직접 답사·검증한 {decoded} 정보 · 관광지 {data.attractions.length}곳, 엄선 패키지 {data.packageCount}개
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-[12px]">
              <span className="px-3 py-1 bg-white/15 backdrop-blur rounded-full border border-white/20">
                🧳 {data.packageCount}개 상품
              </span>
              {data.minPrice && (
                <span className="px-3 py-1 bg-amber-400/20 backdrop-blur rounded-full border border-amber-300/30 text-amber-100 font-semibold">
                  {Math.round(data.minPrice / 10000).toLocaleString()}만원부터
                </span>
              )}
              {data.avgRating && data.reviewCount > 0 && (
                <span className="px-3 py-1 bg-white/15 backdrop-blur rounded-full border border-white/20">
                  ⭐ {data.avgRating.toFixed(1)} ({data.reviewCount}개 후기)
                </span>
              )}
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 py-10 space-y-12">
          {/* Pillar 본문 (AI 생성 또는 수동 작성) */}
          {pillarHtml ? (
            <article className="prose prose-lg prose-blog max-w-none">
              <div dangerouslySetInnerHTML={{ __html: pillarHtml }} />
            </article>
          ) : (
            <section className="p-6 bg-white border border-slate-200 rounded-xl">
              <h2 className="text-[18px] font-bold text-slate-800 mb-2">
                {decoded} 완벽 가이드가 곧 공개됩니다
              </h2>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                운영팀이 준비 중입니다. 아래 관광지 · 엄선 패키지 · 관련 가이드로 {decoded} 여행을 먼저 확인하세요.
              </p>
            </section>
          )}

          {/* 관광지 그리드 */}
          {data.attractions.length > 0 && (
            <section>
              <header className="mb-4 flex items-end justify-between">
                <div>
                  <h2 className="text-[22px] md:text-[26px] font-extrabold text-slate-900">
                    🗺 {decoded} 주요 관광지
                  </h2>
                  <p className="text-[12px] text-slate-500 mt-1">운영팀 답사 기준 · 최신 정보</p>
                </div>
              </header>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {data.attractions.map(a => {
                  const img = a.photos?.[0]?.src_medium;
                  return (
                    <div key={a.id} className="group bg-white border border-slate-200 rounded-xl overflow-hidden">
                      {img ? (
                        <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                          <img src={img} alt={`${decoded} ${a.name}`} className="w-full h-full object-cover group-hover:scale-105 transition" loading="lazy" />
                        </div>
                      ) : (
                        <div className="aspect-[4/3] bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center text-3xl">🏛</div>
                      )}
                      <div className="p-3">
                        <h3 className="text-[13px] font-bold text-slate-800 line-clamp-1">{a.name}</h3>
                        {a.short_desc && (
                          <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">{a.short_desc}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 엄선 패키지 */}
          {data.packages.length > 0 && (
            <section>
              <header className="mb-4 flex items-end justify-between">
                <div>
                  <h2 className="text-[22px] md:text-[26px] font-extrabold text-slate-900">
                    🧳 {decoded} 엄선 패키지
                  </h2>
                  <p className="text-[12px] text-slate-500 mt-1">가성비 · 중가 · 프리미엄 · 운영팀 검증</p>
                </div>
                <Link href={`/packages?destination=${encodeURIComponent(decoded)}`} className="text-[12px] text-indigo-600 hover:underline">
                  전체 보기 →
                </Link>
              </header>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {data.packages.slice(0, 6).map(p => (
                  <Link key={p.id} href={`/packages/${p.id}`} className="group bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition">
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      {p.hero_image_url ? (
                        <img src={p.hero_image_url} alt={`${p.destination} ${p.title}`} className="w-full h-full object-cover group-hover:scale-105 transition" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl">✈️</div>
                      )}
                    </div>
                    <div className="p-3">
                      <h3 className="text-[13px] font-bold text-slate-800 line-clamp-2 leading-snug min-h-[2.6em]">{p.title}</h3>
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
                        {p.duration && <span>{p.nights ?? p.duration - 1}박{p.duration}일</span>}
                        {p.airline && <span>· {p.airline}</span>}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        {p.price && (
                          <span className="text-[16px] font-extrabold text-orange-600 tabular-nums">
                            {Math.round(p.price / 10000).toLocaleString()}만원~
                          </span>
                        )}
                        {p.avg_rating && p.review_count > 0 && (
                          <span className="text-[10px] text-amber-500">⭐ {Number(p.avg_rating).toFixed(1)}</span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* 관련 블로그 */}
          {data.relatedPosts.length > 0 && (
            <section>
              <header className="mb-4">
                <h2 className="text-[22px] md:text-[26px] font-extrabold text-slate-900">
                  📚 {decoded} 여행 매거진
                </h2>
                <p className="text-[12px] text-slate-500 mt-1">가이드 · 꿀팁 · 후기</p>
              </header>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                {data.relatedPosts.map(p => (
                  <Link key={p.id} href={`/blog/${p.slug}`} className="group bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition">
                    {p.og_image_url ? (
                      <div className="aspect-[16/9] bg-slate-100 overflow-hidden">
                        <img src={p.og_image_url} alt={p.seo_title || ''} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    ) : (
                      <div className="aspect-[16/9] bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center text-3xl">📖</div>
                    )}
                    <div className="p-3">
                      <h3 className="text-[12px] font-bold text-slate-800 line-clamp-2 leading-snug min-h-[2.8em] group-hover:text-indigo-600">
                        {p.seo_title || '블로그 가이드'}
                      </h3>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* CTA */}
          <section className="text-center bg-white border border-slate-200 rounded-2xl p-8">
            <h3 className="text-[18px] font-bold text-slate-800 mb-2">
              {decoded} 여행 상담이 필요하신가요?
            </h3>
            <p className="text-[13px] text-slate-500 mb-5">
              여소남 운영팀이 {decoded} 최적 패키지를 맞춤 추천해드립니다.
            </p>
            <a href="https://pf.kakao.com/_yeosonam" target="_blank" rel="noopener" className="inline-flex items-center gap-2 px-6 py-3 bg-yellow-300 text-slate-900 font-bold text-[14px] rounded-full hover:bg-yellow-400">
              💬 카카오톡 상담하기
            </a>
          </section>
        </div>
      </main>
    </>
  );
}
