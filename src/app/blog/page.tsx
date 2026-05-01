import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import GlobalNav from '@/components/customer/GlobalNav';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const revalidate = 300;

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
  { v: 'value', label: '가성비' },
  { v: 'luxury', label: '럭셔리' },
  { v: 'filial', label: '효도' },
  { v: 'emotional', label: '감성' },
  { v: 'activity', label: '액티비티' },
  { v: 'food', label: '미식' },
];

const CONTENT_TYPE_LABELS: Record<string, string> = {
  guide: '가이드',
  tip: '꿀팁',
  review: '리뷰',
  package_intro: '상품',
  pillar: '완벽 가이드',
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

  const [destRes, featuredRes, listRes] = await Promise.all([
    supabaseAdmin
      .from('active_destinations')
      .select('*')
      .order('package_count', { ascending: false })
      .limit(16),
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

  const posts = (listRes.data as BlogPost[]) || [];
  const featuredIds = new Set((featuredRes.data || []).map((f: any) => f.id));
  const filteredPosts = page === 1 && !filter.destination && !filter.angle
    ? posts.filter(p => !featuredIds.has(p.id))
    : posts;

  return {
    featured: page === 1 && !filter.destination && !filter.angle ? (featuredRes.data as BlogPost[]) || [] : [],
    posts: filteredPosts,
    total: listRes.count ?? 0,
    destinations: (destRes.data as DestinationStat[]) || [],
  };
}

// ── 히어로 카드 (Featured 1번 슬롯 — 이미지 오버레이 타입) ──
function HeroCard({ post }: { post: BlogPost }) {
  const dest = post.destination || post.travel_packages?.destination;
  const ct = post.content_type || 'guide';
  const initial = dest?.[0] ?? '✈';

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group relative block overflow-hidden rounded-2xl"
    >
      {post.og_image_url ? (
        <div className="aspect-[16/9] overflow-hidden relative">
          <Image
            src={post.og_image_url}
            alt={`${dest || ''} ${post.seo_title || ''}`.trim()}
            fill
            sizes="(max-width: 768px) 100vw, 66vw"
            className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            priority
          />
        </div>
      ) : (
        <div className="aspect-[16/9] bg-[#F2F4F6] flex items-center justify-center">
          <span className="text-[80px] font-black text-[#D1D5DB]">{initial}</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10 text-white">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[11px] font-semibold border border-white/25 bg-white/10 backdrop-blur-sm px-2.5 py-1 rounded-full">
            {CONTENT_TYPE_LABELS[ct]}
          </span>
          {dest && <span className="text-[13px] text-white/60 font-medium">{dest}</span>}
        </div>
        <h2 className="text-[22px] md:text-[32px] font-extrabold leading-[1.2] line-clamp-2 tracking-[-0.03em]">
          {post.seo_title || post.travel_packages?.title || '여행 가이드'}
        </h2>
      </div>
    </Link>
  );
}

// ── 사이드 스택 카드 (Featured 2·3번 슬롯) ──
function SideCard({ post }: { post: BlogPost }) {
  const dest = post.destination || post.travel_packages?.destination;
  const ct = post.content_type || 'guide';
  const initial = dest?.[0] ?? '✈';

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex gap-4 overflow-hidden rounded-xl border border-[#F2F4F6] bg-white p-4 transition-all hover:shadow-[0_2px_16px_rgba(0,0,0,0.08)] hover:border-[#E5E7EB]"
    >
      {/* 섬네일 — 112×112 */}
      <div className="w-28 h-28 shrink-0 rounded-xl overflow-hidden bg-[#F2F4F6] relative">
        {post.og_image_url ? (
          <Image
            src={post.og_image_url}
            alt={dest || ''}
            fill
            sizes="112px"
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[36px] font-black text-[#D1D5DB]">{initial}</span>
          </div>
        )}
      </div>
      {/* 텍스트 */}
      <div className="flex flex-col justify-center min-w-0 py-1">
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="bg-[#F2F4F6] text-[#4E5968] text-[11px] font-medium px-2 py-0.5 rounded">
            {CONTENT_TYPE_LABELS[ct]}
          </span>
          {dest && (
            <span className="bg-[#F2F4F6] text-[#4E5968] text-[11px] font-medium px-2 py-0.5 rounded">
              {dest}
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 text-[15px] font-bold text-[#191F28] group-hover:text-[#3182F6] leading-[1.4] tracking-[-0.01em] transition-colors">
          {post.seo_title || post.travel_packages?.title || '여행 가이드'}
        </h3>
      </div>
    </Link>
  );
}

// ── 일반 카드 (글 목록) ──
function BlogCard({ post, compact = false }: { post: BlogPost; compact?: boolean }) {
  const dest = post.destination || post.travel_packages?.destination;
  const price = post.travel_packages?.price;
  const ct = post.content_type || 'guide';
  const initial = dest?.[0] ?? '✈';

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group overflow-hidden rounded-2xl border border-[#F2F4F6] bg-white transition-all hover:shadow-[0_4px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5"
    >
      {post.og_image_url ? (
        <div className={`${compact ? 'aspect-[16/9]' : 'aspect-[4/3]'} overflow-hidden bg-[#F2F4F6] relative`}>
          <Image
            src={post.og_image_url}
            alt={`${dest || ''} ${post.seo_title || ''}`.trim() || '블로그 썸네일'}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        </div>
      ) : (
        <div className={`${compact ? 'aspect-[16/9]' : 'aspect-[4/3]'} bg-[#F2F4F6] flex items-center justify-center`}>
          <span className="font-black text-[#D1D5DB]" style={{ fontSize: compact ? '36px' : '52px' }}>{initial}</span>
        </div>
      )}

      <div className="p-4 md:p-5">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          <span className="bg-[#F2F4F6] text-[#4E5968] text-[11px] font-medium px-2 py-0.5 rounded">
            {CONTENT_TYPE_LABELS[ct]}
          </span>
          {dest && (
            <span className="bg-[#F2F4F6] text-[#4E5968] text-[11px] font-medium px-2 py-0.5 rounded">
              {dest}
            </span>
          )}
          {post.angle_type && ANGLE_LABELS[post.angle_type] && (
            <span className="bg-[#F2F4F6] text-[#4E5968] text-[11px] px-2 py-0.5 rounded">
              {ANGLE_LABELS[post.angle_type]}
            </span>
          )}
        </div>

        <h2 className={`line-clamp-2 font-bold text-[#191F28] group-hover:text-[#3182F6] leading-[1.4] tracking-[-0.01em] transition-colors ${compact ? 'text-[15px]' : 'text-[17px]'}`}>
          {post.seo_title || post.travel_packages?.title || '여행 가이드'}
        </h2>

        {!compact && post.seo_description && (
          <p className="mt-1.5 line-clamp-1 text-[13px] text-[#8B95A1] leading-relaxed">
            {post.seo_description}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between">
          <time className="text-[11px] text-[#8B95A1]">
            {new Date(post.published_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })}
          </time>
          {price && (
            <span className="text-[12px] text-[#8B95A1] tabular-nums">
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

  const chipBase = 'shrink-0 rounded-full px-4 py-2 text-[14px] font-medium transition-all whitespace-nowrap';
  const chipActive = 'bg-[#191F28] text-white';
  const chipIdle = 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E8EAED]';

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
      <GlobalNav />

      <main className="min-h-screen bg-white">

        {/* ── 헤더 ── */}
        <header className="border-b border-[#F2F4F6] bg-white">
          <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
            <Link href="/" className="mb-3 inline-flex items-center gap-1 text-[13px] text-[#8B95A1] hover:text-[#3182F6] transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M10 12L6 8l4-4" />
              </svg>
              여소남 홈
            </Link>
            <h1 className="text-[28px] md:text-[40px] font-extrabold text-[#191F28] tracking-[-0.03em]">
              여행 매거진
            </h1>
            <p className="mt-2 text-[14px] md:text-[15px] text-[#8B95A1]">
              운영팀이 직접 검증한 가이드와 엄선 패키지
              <span className="mx-2 text-[#E5E7EB]">·</span>
              <b className="text-[#191F28] font-semibold">{total.toLocaleString()}</b>편
            </p>
          </div>
        </header>

        {/* ── 필터 — 스타일 단일 행 (매거진 에디토리얼 기준) ── */}
        <div className="border-b border-[#F2F4F6] bg-white sticky top-14 md:top-16 z-20">
          <div className="mx-auto max-w-6xl px-4 py-3">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <Link href="/blog" className={`${chipBase} ${!destination && !angle ? chipActive : chipIdle}`}>
                전체
              </Link>
              {ANGLE_CHIPS.map(c => (
                <Link
                  key={c.v}
                  href={buildHref({ angle: c.v, page: 1 })}
                  className={`${chipBase} ${angle === c.v ? chipActive : chipIdle}`}
                >
                  {c.label}
                </Link>
              ))}
              {/* 목적지 필터는 드롭다운으로 분리 — 아래 '목적지별 완벽 가이드' 섹션이 대체 */}
              {destination && (
                <span className={`${chipBase} ${chipActive} flex items-center gap-1.5`}>
                  {destination}
                  <Link href="/blog" aria-label="목적지 필터 해제" className="opacity-60 hover:opacity-100">
                    ×
                  </Link>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Featured — 에디토리얼 히어로 레이아웃 ── */}
        {featured.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-8 border-b border-[#F2F4F6]">
            <div className="mb-5 flex items-baseline justify-between">
              <div>
                <h2 className="text-[18px] font-bold text-[#191F28] tracking-[-0.02em]">에디터 픽</h2>
                <p className="text-[13px] text-[#8B95A1] mt-0.5">운영팀이 이번 주 추천하는 여행 가이드</p>
              </div>
            </div>

            {featured.length === 1 ? (
              <HeroCard post={featured[0]} />
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {/* 히어로 — 2/3 폭 */}
                <div className="md:col-span-2">
                  <HeroCard post={featured[0]} />
                </div>
                {/* 사이드 스택 — 1/3 폭 */}
                <div className="flex flex-col gap-4">
                  {featured.slice(1, 3).map(post => (
                    <SideCard key={post.id} post={post} />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── 목적지별 완벽 가이드 ── */}
        {destinations.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-6 border-b border-[#F2F4F6]">
            <div className="bg-[#F8F9FA] rounded-2xl px-5 py-5 md:px-7 md:py-6">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[15px] font-bold text-[#191F28] tracking-[-0.01em]">목적지별 완벽 가이드</h2>
                <Link href="/destinations" className="text-[12px] text-[#3182F6] font-medium hover:underline">
                  모든 여행지 →
                </Link>
              </div>
              <p className="text-[12px] text-[#8B95A1] mb-4">지역 Pillar 가이드 · 관광지 · 일정 · 준비물 총정리</p>
              <div className="divide-y divide-[#EAEAEA]">
                {destinations.slice(0, 8).map(d => (
                  <Link
                    key={d.destination}
                    href={`/destinations/${encodeURIComponent(d.destination)}`}
                    className="flex items-center justify-between py-5 group"
                  >
                    <span className="text-[15px] font-semibold text-[#191F28] group-hover:text-[#3182F6] transition-colors">
                      {d.destination}
                    </span>
                    <span className="text-[12px] text-[#8B95A1]">
                      {d.package_count}개 상품{d.min_price ? ` · ${Math.round(d.min_price / 10000)}만원~` : ''}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── 글 목록 ── */}
        <section className="mx-auto max-w-6xl px-4 py-10">
          {(destination || angle) && (
            <div className="mb-6 flex items-center gap-2 text-[13px]">
              <span className="text-[#191F28] font-semibold">
                {destination || ''}{destination && angle ? ' · ' : ''}{angle ? ANGLE_LABELS[angle] : ''}
              </span>
              <span className="text-[#8B95A1]">관련 글 {total}편</span>
              <Link href="/blog" className="ml-1 text-[#3182F6] hover:underline">필터 해제</Link>
            </div>
          )}

          {posts.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-[32px] mb-3">🔍</p>
              <p className="text-[#4E5968] font-medium">
                {destination || angle ? '조건에 맞는 글이 없습니다.' : '아직 발행된 글이 없습니다.'}
              </p>
              {(destination || angle) && (
                <Link href="/blog" className="mt-4 inline-block text-[13px] text-[#3182F6] hover:underline">
                  전체 글 보기
                </Link>
              )}
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map(post => <BlogCard key={post.id} post={post} compact />)}
            </div>
          )}

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <nav className="mt-12 flex items-center justify-center gap-1.5">
              {page > 1 && (
                <Link
                  href={buildHref({ page: page - 1 })}
                  className="rounded-full border border-[#E5E7EB] px-4 py-2 text-[13px] text-[#4E5968] hover:bg-[#F2F4F6] transition"
                >
                  ← 이전
                </Link>
              )}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => Math.abs(p - page) <= 2 || p === 1 || p === totalPages)
                .map((p, idx, arr) => {
                  const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
                  return (
                    <span key={p} className="flex items-center gap-1.5">
                      {showEllipsis && <span className="px-1 text-[#D1D5DB]">…</span>}
                      <Link
                        href={buildHref({ page: p })}
                        className={`rounded-full px-3.5 py-2 text-[13px] transition ${
                          p === page
                            ? 'bg-[#191F28] text-white font-semibold'
                            : 'border border-[#E5E7EB] text-[#4E5968] hover:bg-[#F2F4F6]'
                        }`}
                      >
                        {p}
                      </Link>
                    </span>
                  );
                })}
              {page < totalPages && (
                <Link
                  href={buildHref({ page: page + 1 })}
                  className="rounded-full border border-[#E5E7EB] px-4 py-2 text-[13px] text-[#4E5968] hover:bg-[#F2F4F6] transition"
                >
                  다음 →
                </Link>
              )}
            </nav>
          )}
        </section>

        {/* ── 카카오 플로팅 CTA ── */}
        <a
          href="https://pf.kakao.com/_yeosonam"
          target="_blank"
          rel="noopener"
          className="fixed bottom-6 right-6 bg-[#FEE500] text-[#3C1E1E] font-bold text-[13px] px-4 py-3 rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all z-40 flex items-center gap-2"
        >
          💬 카톡 상담
        </a>
      </main>
    </>
  );
}
