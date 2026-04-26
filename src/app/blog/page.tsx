import type { Metadata } from 'next';
import Link from 'next/link';

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const revalidate = 300; // 5분 ISR — 네이버 C-Rank 프레시니스 + Google 크롤러 재방문

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
const PER_PAGE = 12;

export const metadata: Metadata = {
  title: '여행 매거진',
  description: '여소남 운영팀이 직접 검증한 여행지 가이드와 엄선 패키지 — 목적지별 · 스타일별 큐레이션',
  alternates: { canonical: `${BASE_URL}/blog` },
  openGraph: {
    title: '여행 매거진 | 여소남',
    description: '여소남 운영팀이 직접 검증한 여행지 가이드와 엄선 패키지.',
    url: `${BASE_URL}/blog`,
    type: 'website',
    images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630 }],
  },
};

const ANGLE_LABELS: Record<string, string> = {
  value: '가성비', emotional: '감성', filial: '효도', luxury: '럭셔리',
  urgency: '긴급특가', activity: '액티비티', food: '미식',
};

const ANGLE_CHIPS = [
  { v: 'value', label: '💰 가성비' },
  { v: 'luxury', label: '✨ 럭셔리' },
  { v: 'filial', label: '🧡 효도' },
  { v: 'emotional', label: '🌸 감성' },
  { v: 'activity', label: '🏃 액티비티' },
  { v: 'food', label: '🍜 미식' },
];

const CONTENT_TYPE_LABELS: Record<string, string> = {
  guide: '📍 가이드',
  tip: '💡 꿀팁',
  review: '📝 리뷰',
  package_intro: '🧳 상품',
  pillar: '🏛 완벽 가이드',
};

interface BlogPost {
  id: string;
  slug: string;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  angle_type: string;
  published_at: string;
  product_id: string | null;
  destination: string | null;
  content_type: string | null;
  featured: boolean | null;
  featured_order: number | null;
  view_count: number | null;
  travel_packages: {
    id: string; title: string; destination: string;
    price: number | null; duration: string | null; category: string | null;
    avg_rating: number | null; review_count: number | null;
  } | null;
}

interface DestinationStat {
  destination: string;
  package_count: number;
  min_price: number | null;
}

async function getBlogData(page: number, filter: { destination?: string; angle?: string }): Promise<{
  featured: BlogPost[];
  posts: BlogPost[];
  total: number;
  destinations: DestinationStat[];
}> {
  if (!isSupabaseConfigured) return { featured: [], posts: [], total: 0, destinations: [] };

  const offset = (page - 1) * PER_PAGE;

  // 전체 목록 쿼리 빌더 (Promise 생성 전에 동적 필터 체이닝)
  let listQuery = supabaseAdmin
    .from('content_creatives')
    .select(
      'id, slug, seo_title, seo_description, og_image_url, angle_type, published_at, product_id, destination, content_type, featured, featured_order, view_count, travel_packages(id, title, destination, price, duration, category, avg_rating, review_count)',
      { count: 'exact' },
    )
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1);

  if (filter.angle) listQuery = listQuery.eq('angle_type', filter.angle);
  if (filter.destination) listQuery = listQuery.eq('destination', filter.destination);

  // 3개 독립 쿼리 병렬화 — TTFB / ISR 빌드 단축
  const [destRes, featuredRes, listRes] = await Promise.all([
    // 활성 목적지 통계 (destination hub 링크용)
    supabaseAdmin
      .from('active_destinations')
      .select('*')
      .order('package_count', { ascending: false })
      .limit(16),
    // Featured 블록 (상위 3개)
    supabaseAdmin
      .from('content_creatives')
      .select(
        'id, slug, seo_title, seo_description, og_image_url, angle_type, published_at, product_id, destination, content_type, featured, featured_order, view_count, travel_packages(id, title, destination, price, duration, category, avg_rating, review_count)',
      )
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .eq('featured', true)
      .not('slug', 'is', null)
      .order('featured_order', { ascending: true, nullsFirst: false })
      .order('published_at', { ascending: false })
      .limit(3),
    listQuery,
  ]);

  const destData = destRes.data;
  const featuredData = featuredRes.data;
  const data = listRes.data;
  const count = listRes.count;

  const posts = (data as BlogPost[]) || [];
  // featured 중복 제거
  const featuredIds = new Set((featuredData || []).map((f: any) => f.id));
  const filteredPosts = page === 1 && !filter.destination && !filter.angle
    ? posts.filter(p => !featuredIds.has(p.id))
    : posts;

  return {
    featured: page === 1 && !filter.destination && !filter.angle ? (featuredData as BlogPost[]) || [] : [],
    posts: filteredPosts,
    total: count ?? 0,
    destinations: (destData as DestinationStat[]) || [],
  };
}

function BlogCard({ post, compact = false }: { post: BlogPost; compact?: boolean }) {
  const dest = post.destination || post.travel_packages?.destination;
  const price = post.travel_packages?.price;
  const rating = post.travel_packages?.avg_rating;
  const reviewCount = post.travel_packages?.review_count;
  const ct = post.content_type || 'guide';

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md hover:-translate-y-0.5"
    >
      {post.og_image_url ? (
        <div className={`${compact ? 'aspect-[16/9]' : 'aspect-[4/3]'} overflow-hidden bg-gray-100`}>
          <img
            src={post.og_image_url}
            alt={`${dest || ''} ${post.seo_title || ''}`.trim() || '블로그 썸네일'}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        </div>
      ) : (
        <div className={`${compact ? 'aspect-[16/9]' : 'aspect-[4/3]'} flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50`}>
          <span className="text-4xl">✈️</span>
        </div>
      )}

      <div className="p-4">
        <div className="mb-2 flex items-center gap-1.5 flex-wrap">
          <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
            {CONTENT_TYPE_LABELS[ct] || '📖'}
          </span>
          {dest && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              {dest}
            </span>
          )}
          {post.angle_type && ANGLE_LABELS[post.angle_type] && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
              {ANGLE_LABELS[post.angle_type]}
            </span>
          )}
        </div>

        <h2 className={`line-clamp-2 ${compact ? 'text-[14px]' : 'text-[15px]'} font-bold text-gray-900 group-hover:text-indigo-600 leading-snug`}>
          {post.seo_title || post.travel_packages?.title || '여행 가이드'}
        </h2>

        {!compact && post.seo_description && (
          <p className="mt-1.5 line-clamp-2 text-[12.5px] text-gray-500 leading-relaxed">{post.seo_description}</p>
        )}

        <div className="mt-3 flex items-center justify-between text-[11px] text-gray-400">
          <div className="flex items-center gap-2">
            <time>
              {new Date(post.published_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })}
            </time>
            {rating && reviewCount && reviewCount > 0 && (
              <span className="flex items-center gap-0.5 text-amber-500">
                ⭐ {rating} ({reviewCount})
              </span>
            )}
          </div>
          {price && (
            <span className="font-semibold text-orange-600 tabular-nums">
              {Math.round(price / 10000).toLocaleString()}만원~
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default async function BlogListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; destination?: string; angle?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || '1'));
  const destination = params.destination || undefined;
  const angle = params.angle || undefined;
  const { featured, posts, total, destinations } = await getBlogData(page, { destination, angle });
  const totalPages = Math.ceil(total / PER_PAGE);

  const buildHref = (override: Partial<{ page: number; destination: string; angle: string }>) => {
    const next = new URLSearchParams();
    if (override.page && override.page !== 1) next.set('page', String(override.page));
    const d = override.destination ?? destination;
    const a = override.angle ?? angle;
    if (d) next.set('destination', d);
    if (a) next.set('angle', a);
    const q = next.toString();
    return `/blog${q ? `?${q}` : ''}`;
  };

  return (
    <>
      {/* CollectionPage + WebSite+SearchAction JSON-LD */}
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'WebSite',
                name: '여소남',
                url: BASE_URL,
                potentialAction: {
                  '@type': 'SearchAction',
                  target: { '@type': 'EntryPoint', urlTemplate: `${BASE_URL}/blog?destination={search_term_string}` },
                  'query-input': 'required name=search_term_string',
                },
              },
              {
                '@type': 'CollectionPage',
                name: '여행 매거진',
                description: '여소남 운영팀이 직접 검증한 여행지 가이드와 엄선 패키지.',
                url: `${BASE_URL}/blog`,
                inLanguage: 'ko-KR',
                mainEntity: {
                  '@type': 'ItemList',
                  numberOfItems: total,
                  itemListElement: posts.slice(0, 10).map((p, i) => ({
                    '@type': 'ListItem',
                    position: i + 1,
                    url: `${BASE_URL}/blog/${p.slug}`,
                    name: p.seo_title || p.travel_packages?.title || '여행 가이드',
                  })),
                },
              },
            ],
          }),
        }}
      />
      <main className="min-h-screen bg-[#faf6f0]">
        {/* ── 트러스트 바 (E-E-A-T) ───────────────── */}
        <div className="bg-slate-900 text-slate-100 text-[11px] md:text-[12px]">
          <div className="mx-auto max-w-6xl px-4 py-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-center">
            <span>⭐ 운영팀 검증 · 랜드사 직접 확인</span>
            <span className="text-slate-400">·</span>
            <span>🏢 관광사업 등록 제 2024-XXXXX호</span>
            <span className="text-slate-400">·</span>
            <span>✓ 국내 여행공제 가입</span>
          </div>
        </div>

        {/* ── 헤더 ───────────────────────────── */}
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
            <Link href="/" className="mb-2 inline-block text-[13px] text-slate-500 hover:text-indigo-600">
              ← 여소남 홈
            </Link>
            <h1 className="text-[28px] md:text-[36px] font-extrabold text-slate-900 tracking-tight">
              여행 매거진
            </h1>
            <p className="mt-1.5 text-[14px] text-slate-500">
              운영팀이 직접 검증한 가이드와 엄선 패키지 · 총 <b className="text-slate-900">{total.toLocaleString()}</b>편
            </p>
          </div>
        </header>

        {/* ── 2축 필터 (목적지 × 스타일) ───────── */}
        <div className="border-b border-slate-200 bg-white sticky top-0 z-20">
          <div className="mx-auto max-w-6xl px-4 py-3 space-y-2">
            {/* 목적지 축 */}
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              <span className="flex items-center text-[11px] font-bold text-slate-600 whitespace-nowrap pr-1 border-r border-slate-200 mr-1">
                🌏 목적지
              </span>
              <Link href={buildHref({ destination: '', page: 1 })} className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition ${!destination ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                전체
              </Link>
              {destinations.map(d => (
                <Link
                  key={d.destination}
                  href={buildHref({ destination: d.destination, page: 1 })}
                  className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition ${destination === d.destination ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {d.destination} <span className="text-[10px] opacity-60">({d.package_count})</span>
                </Link>
              ))}
            </div>
            {/* 스타일 축 */}
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              <span className="flex items-center text-[11px] font-bold text-slate-600 whitespace-nowrap pr-1 border-r border-slate-200 mr-1">
                ✨ 스타일
              </span>
              <Link href={buildHref({ angle: '', page: 1 })} className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition ${!angle ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                전체
              </Link>
              {ANGLE_CHIPS.map(c => (
                <Link
                  key={c.v}
                  href={buildHref({ angle: c.v, page: 1 })}
                  className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition ${angle === c.v ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {c.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── Featured 블록 (1페이지 + 필터 없을 때) ───── */}
        {featured.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-8 border-b border-slate-200">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="text-[20px] font-bold text-slate-900">⭐ 여소남 추천 매거진</h2>
                <p className="text-[12px] text-slate-500 mt-0.5">운영팀이 골라드리는 이번 주 가이드</p>
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {featured.map(post => <BlogCard key={post.id} post={post} />)}
            </div>
          </section>
        )}

        {/* ── 목적지 허브 빠른 링크 ──────────────── */}
        {destinations.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-6 border-b border-slate-200">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <h2 className="text-[16px] font-bold text-slate-900">🗺 목적지별 완벽 가이드</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">지역 Pillar 가이드 · 관광지/일정/준비물 총정리</p>
              </div>
              <Link href="/destinations" className="text-[12px] text-indigo-600 hover:underline">
                모든 여행지 →
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {destinations.slice(0, 8).map(d => (
                <Link
                  key={d.destination}
                  href={`/destinations/${encodeURIComponent(d.destination)}`}
                  className="p-3 bg-white border border-slate-200 rounded-lg hover:border-indigo-300 hover:shadow-sm transition group"
                >
                  <div className="text-[14px] font-bold text-slate-800 group-hover:text-indigo-600">
                    {d.destination}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {d.package_count}개 상품 {d.min_price ? `· ${Math.round(d.min_price / 10000)}만원~` : ''}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── 글 목록 ───────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-10">
          {(destination || angle) && (
            <div className="mb-5 text-[13px] text-slate-600">
              <b className="text-slate-900">{destination || ''}{destination && angle ? ' · ' : ''}{angle ? ANGLE_LABELS[angle] : ''}</b> 관련 글 {total}편
              <Link href="/blog" className="ml-2 text-indigo-600 hover:underline">필터 해제</Link>
            </div>
          )}

          {posts.length === 0 ? (
            <p className="py-20 text-center text-slate-400">
              {destination || angle ? '조건에 맞는 글이 없습니다.' : '아직 발행된 글이 없습니다.'}
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map(post => <BlogCard key={post.id} post={post} compact />)}
            </div>
          )}

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <nav className="mt-10 flex items-center justify-center gap-2">
              {page > 1 && (
                <Link href={buildHref({ page: page - 1 })} className="rounded-lg border border-slate-200 px-3 py-2 text-[12px] text-slate-600 hover:bg-slate-50">
                  ← 이전
                </Link>
              )}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => Math.abs(p - page) <= 2 || p === 1 || p === totalPages)
                .map((p, idx, arr) => {
                  const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
                  return (
                    <span key={p}>
                      {showEllipsis && <span className="px-1 text-slate-300">...</span>}
                      <Link
                        href={buildHref({ page: p })}
                        className={`rounded-lg px-3 py-2 text-[12px] transition ${
                          p === page ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {p}
                      </Link>
                    </span>
                  );
                })}
              {page < totalPages && (
                <Link href={buildHref({ page: page + 1 })} className="rounded-lg border border-slate-200 px-3 py-2 text-[12px] text-slate-600 hover:bg-slate-50">
                  다음 →
                </Link>
              )}
            </nav>
          )}
        </section>

        {/* ── 카카오 플로팅 CTA ───────────────── */}
        <a
          href="https://pf.kakao.com/_yeosonam"
          target="_blank"
          rel="noopener"
          className="fixed bottom-6 right-6 bg-yellow-300 text-slate-900 font-bold text-[13px] px-4 py-3 rounded-full shadow-lg hover:bg-yellow-400 z-40 flex items-center gap-2"
        >
          💬 카톡 상담
        </a>
      </main>
    </>
  );
}
