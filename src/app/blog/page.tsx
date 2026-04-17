import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const revalidate = 600; // 10분 ISR

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
const PER_PAGE = 12;

export const metadata: Metadata = {
  title: '여행 블로그',
  description: '여소남이 엄선한 여행지 정보, 가성비 패키지 추천, 꿀팁 가이드를 만나보세요.',
  alternates: { canonical: `${BASE_URL}/blog` },
  openGraph: {
    title: '여행 블로그 | 여소남',
    description: '여소남이 엄선한 여행지 정보, 가성비 패키지 추천, 꿀팁 가이드.',
    url: `${BASE_URL}/blog`,
    type: 'website',
    images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '여행 블로그 | 여소남',
    description: '여소남이 엄선한 여행지 정보, 가성비 패키지 추천, 꿀팁 가이드.',
    images: [`${BASE_URL}/og-image.png`],
  },
};

const ANGLE_LABELS: Record<string, string> = {
  value: '가성비', emotional: '감성', filial: '효도', luxury: '럭셔리',
  urgency: '긴급특가', activity: '액티비티', food: '미식',
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
  travel_packages: {
    id: string; title: string; destination: string;
    price: number | null; duration: string | null; category: string | null;
  } | null;
}

async function getPosts(page: number, destination?: string): Promise<{ posts: BlogPost[]; total: number; destinations: string[] }> {
  if (!isSupabaseConfigured) return { posts: [], total: 0, destinations: [] };

  try {
    const offset = (page - 1) * PER_PAGE;

    // 목적지 목록 (필터용)
    const { data: destData } = await supabaseAdmin
      .from('content_creatives')
      .select('travel_packages(destination)')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null);

    const destSet = new Set<string>();
    (destData || []).forEach((d: any) => {
      if (d.travel_packages?.destination) destSet.add(d.travel_packages.destination);
    });
    const destinations = [...destSet].sort();

    // 글 목록
    let query = supabaseAdmin
      .from('content_creatives')
      .select(
        'id, slug, seo_title, seo_description, og_image_url, angle_type, published_at, product_id, travel_packages(id, title, destination, price, duration, category)',
        { count: 'exact' },
      )
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .range(offset, offset + PER_PAGE - 1);

    // 목적지 필터 (travel_packages FK 기반)
    // Supabase FK 필터는 직접 지원하지 않으므로, 클라이언트에서 필터링
    const { data, count, error } = await query;
    if (error) throw error;

    let posts = (data as BlogPost[]) || [];
    if (destination) {
      posts = posts.filter(p => p.travel_packages?.destination === destination);
    }

    return { posts, total: count ?? 0, destinations };
  } catch (err) {
    console.error('[Blog] getPosts 실패:', err);
    return { posts: [], total: 0, destinations: [] };
  }
}

export default async function BlogListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; destination?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || '1'));
  const destination = params.destination || undefined;
  const { posts, total, destinations } = await getPosts(page, destination);
  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <>
      {/* CollectionPage JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: '여행 블로그',
            description: '여소남이 엄선한 여행지 정보, 가성비 패키지 추천, 꿀팁 가이드를 만나보세요.',
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
          }),
        }}
      />
    <main className="min-h-screen bg-white">
      {/* 헤더 */}
      <header className="border-b bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <Link href="/" className="mb-4 inline-block text-sm text-indigo-200 hover:text-white">
            ← 여소남 홈
          </Link>
          <h1 className="text-3xl font-bold md:text-4xl">여행 블로그</h1>
          <p className="mt-2 text-indigo-100">
            여소남이 엄선한 여행지 정보와 패키지 추천 · 총 {total}편
          </p>
        </div>
      </header>

      {/* 목적지 필터 칩 */}
      {destinations.length > 0 && (
        <div className="border-b bg-white">
          <div className="mx-auto max-w-5xl px-4 py-3 flex gap-2 flex-wrap">
            <Link
              href="/blog"
              className={`rounded-full px-3 py-1.5 text-sm transition ${
                !destination ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              전체
            </Link>
            {destinations.map(dest => (
              <Link
                key={dest}
                href={`/blog?destination=${encodeURIComponent(dest)}`}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  destination === dest ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {dest}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 글 목록 */}
      <section className="mx-auto max-w-5xl px-4 py-10">
        {posts.length === 0 ? (
          <p className="py-20 text-center text-gray-400">
            {destination ? `${destination} 관련 글이 없습니다.` : '아직 발행된 글이 없습니다.'}
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="group overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md"
              >
                {post.og_image_url ? (
                  <div className="aspect-[16/9] overflow-hidden bg-gray-100 relative">
                    <Image
                      src={post.og_image_url}
                      alt={post.seo_title || '블로그 썸네일'}
                      fill
                      className="object-cover transition group-hover:scale-105"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
                    <span className="text-4xl">✈️</span>
                  </div>
                )}

                <div className="p-4">
                  <div className="mb-2 flex items-center gap-2">
                    {post.travel_packages?.destination && (
                      <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                        {post.travel_packages.destination}
                      </span>
                    )}
                    <span className="rounded-full bg-gray-50 px-2.5 py-0.5 text-xs text-gray-500">
                      {ANGLE_LABELS[post.angle_type] || post.angle_type}
                    </span>
                  </div>

                  <h2 className="line-clamp-2 text-base font-semibold text-gray-900 group-hover:text-indigo-600">
                    {post.seo_title || post.travel_packages?.title || '여행 가이드'}
                  </h2>

                  {post.seo_description && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-gray-500">{post.seo_description}</p>
                  )}

                  <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
                    <time>
                      {new Date(post.published_at).toLocaleDateString('ko-KR', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </time>
                    {post.travel_packages?.price && (
                      <span className="font-medium text-indigo-600">
                        {post.travel_packages.price.toLocaleString()}원~
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <nav className="mt-10 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link
                href={`/blog?page=${page - 1}${destination ? `&destination=${encodeURIComponent(destination)}` : ''}`}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                ← 이전
              </Link>
            )}

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => Math.abs(p - page) <= 2 || p === 1 || p === totalPages)
              .map((p, idx, arr) => {
                const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
                return (
                  <span key={p}>
                    {showEllipsis && <span className="px-1 text-gray-300">...</span>}
                    <Link
                      href={`/blog?page=${p}${destination ? `&destination=${encodeURIComponent(destination)}` : ''}`}
                      className={`rounded-lg px-3 py-2 text-sm transition ${
                        p === page
                          ? 'bg-indigo-600 text-white'
                          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {p}
                    </Link>
                  </span>
                );
              })}

            {page < totalPages && (
              <Link
                href={`/blog?page=${page + 1}${destination ? `&destination=${encodeURIComponent(destination)}` : ''}`}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                다음 →
              </Link>
            )}
          </nav>
        )}
      </section>
    </main>
    </>
  );
}
