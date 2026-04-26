import type { Metadata } from 'next';
import Link from 'next/link';

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

const ANGLE_LABELS: Record<string, string> = {
  value: '가성비', emotional: '감성', filial: '효도', luxury: '럭셔리',
  urgency: '긴급특가', activity: '액티비티', food: '미식',
};

interface BlogPost {
  id: string; slug: string; seo_title: string | null; seo_description: string | null;
  og_image_url: string | null; angle_type: string; published_at: string;
  travel_packages: { id: string; title: string; destination: string; price: number | null; duration: string | null } | null;
}

async function getPostsByDestination(dest: string): Promise<{ posts: BlogPost[]; packages: { id: string; title: string; price: number | null }[] }> {
  if (!isSupabaseConfigured) return { posts: [], packages: [] };

  try {
    // 블로그 글 (해당 목적지)
    const { data: allPosts } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, seo_description, og_image_url, angle_type, published_at, travel_packages(id, title, destination, price, duration)')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(100);

    const posts = ((allPosts || []) as BlogPost[]).filter(
      p => p.travel_packages?.destination?.includes(decodeURIComponent(dest))
    );

    // 관련 상품
    const { data: pkgData } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, price')
      .ilike('destination', `%${decodeURIComponent(dest)}%`)
      .in('status', ['active', 'approved'])
      .order('price', { ascending: true })
      .limit(6);

    return { posts, packages: (pkgData || []) as { id: string; title: string; price: number | null }[] };
  } catch {
    return { posts: [], packages: [] };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ dest: string }> }): Promise<Metadata> {
  const { dest } = await params;
  const destination = decodeURIComponent(dest);
  return {
    title: `${destination} 여행 가이드`,
    description: `${destination} 여행의 모든 것. 가성비 패키지부터 럭셔리까지, 여소남이 엄선한 ${destination} 여행 정보를 만나보세요.`,
    alternates: { canonical: `${BASE_URL}/blog/destination/${dest}` },
    openGraph: {
      title: `${destination} 여행 가이드 | 여소남`,
      description: `${destination} 여행 패키지 추천, 관광지 정보, 꿀팁 가이드`,
      url: `${BASE_URL}/blog/destination/${dest}`,
    },
  };
}

export default async function DestinationBlogPage({ params }: { params: Promise<{ dest: string }> }) {
  const { dest } = await params;
  const destination = decodeURIComponent(dest);
  const { posts, packages } = await getPostsByDestination(dest);

  return (
    <>
      {/* CollectionPage JSON-LD */}
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: `${destination} 여행 가이드`,
            description: `${destination} 여행 패키지 추천 및 관광 정보`,
            url: `${BASE_URL}/blog/destination/${dest}`,
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: posts.length,
              itemListElement: posts.slice(0, 10).map((p, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                url: `${BASE_URL}/blog/${p.slug}`,
                name: p.seo_title || destination,
              })),
            },
          }),
        }}
      />

      <main className="min-h-screen bg-white">
        <header className="border-b bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
          <div className="mx-auto max-w-5xl px-4 py-12">
            <div className="flex items-center gap-2 text-sm text-indigo-200 mb-4">
              <Link href="/" className="hover:text-white">홈</Link>
              <span>/</span>
              <Link href="/blog" className="hover:text-white">블로그</Link>
              <span>/</span>
              <span className="text-white">{destination}</span>
            </div>
            <h1 className="text-3xl font-bold md:text-4xl">{destination} 여행 가이드</h1>
            <p className="mt-2 text-indigo-100">{destination} 여행의 모든 것 · {posts.length}편의 가이드</p>
          </div>
        </header>

        <div className="mx-auto max-w-5xl px-4 py-10">
          {/* 관련 상품 CTA */}
          {packages.length > 0 && (
            <div className="mb-8 rounded-xl border border-indigo-100 bg-indigo-50/50 p-5">
              <h2 className="text-sm font-semibold text-indigo-700 mb-3">{destination} 추천 패키지</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                {packages.map(pkg => (
                  <Link key={pkg.id} href={`/packages/${pkg.id}`}
                    className="rounded-lg border border-indigo-100 bg-white p-3 hover:shadow-sm transition">
                    <p className="text-sm font-medium text-gray-900 line-clamp-1">{pkg.title}</p>
                    {pkg.price && <p className="text-xs text-indigo-600 font-semibold mt-1">{pkg.price.toLocaleString()}원~</p>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* 블로그 글 목록 */}
          {posts.length === 0 ? (
            <p className="py-20 text-center text-gray-400">{destination} 관련 가이드가 준비 중입니다.</p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map(post => (
                <Link key={post.id} href={`/blog/${post.slug}`}
                  className="group overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md">
                  {post.og_image_url ? (
                    <div className="aspect-[16/9] overflow-hidden bg-gray-100 relative">
                      <img src={post.og_image_url} alt={post.seo_title || ''} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                    </div>
                  ) : (
                    <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
                      <span className="text-4xl">✈️</span>
                    </div>
                  )}
                  <div className="p-4">
                    <span className="rounded-full bg-gray-50 px-2.5 py-0.5 text-xs text-gray-500 mb-2 inline-block">
                      {ANGLE_LABELS[post.angle_type] || post.angle_type}
                    </span>
                    <h2 className="line-clamp-2 text-base font-semibold text-gray-900 group-hover:text-indigo-600">
                      {post.seo_title || '여행 가이드'}
                    </h2>
                    {post.seo_description && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-gray-500">{post.seo_description}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
