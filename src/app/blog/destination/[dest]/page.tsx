import type { Metadata } from 'next';
import Link from 'next/link';

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import GlobalNav from '@/components/customer/GlobalNav';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import SectionHeader from '@/components/customer/SectionHeader';

export const revalidate = 300;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';

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

      <GlobalNav />
      <main className="min-h-screen bg-white">
        <header className="border-b bg-gradient-to-r from-brand to-brand-dark text-white">
          <div className="mx-auto max-w-6xl px-4 md:px-6 py-14 md:py-20">
            <div className="flex items-center gap-2 text-[13px] md:text-sm text-blue-200 mb-4">
              <Link href="/" className="hover:text-white">홈</Link>
              <span>/</span>
              <Link href="/blog" className="hover:text-white">블로그</Link>
              <span>/</span>
              <span className="text-white">{destination}</span>
            </div>
            <h1 className="text-[40px] md:text-[60px] font-black tracking-tight leading-[1.05]">{destination} 여행 가이드</h1>
            <p className="mt-4 text-base md:text-lg text-blue-100 leading-relaxed">{destination} 여행의 모든 것 · {posts.length}편의 가이드</p>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-4 md:px-6 py-12 md:py-16 space-y-12 md:space-y-16">
          {/* 관련 상품 CTA */}
          {packages.length > 0 && (
            <section>
              <SectionHeader title={`${destination} 추천 패키지`} />
              <div className="grid gap-4 md:gap-6 sm:grid-cols-3">
                {packages.map(pkg => (
                  <Link key={pkg.id} href={`/packages/${pkg.id}`}
                    className="rounded-xl border border-slate-200 bg-white p-5 hover:shadow-md hover:border-brand transition">
                    <p className="text-base font-bold text-slate-900 line-clamp-2 leading-snug tracking-tight">{pkg.title}</p>
                    {pkg.price && <p className="mt-2 text-lg md:text-xl font-black text-slate-900 tabular-nums">{pkg.price.toLocaleString()}원~</p>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* 블로그 글 목록 */}
          <section>
            <SectionHeader title={`${destination} 가이드`} subtitle="운영팀이 직접 작성한 여행 매거진" />
            {posts.length === 0 ? (
              <p className="py-20 text-center text-slate-400 text-base">{destination} 관련 가이드가 준비 중입니다.</p>
            ) : (
              <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {posts.map(post => (
                  <Link key={post.id} href={`/blog/${post.slug}`}
                    className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
                    <div className="aspect-[16/9] overflow-hidden bg-slate-100 relative">
                      <SafeCoverImg
                        src={post.og_image_url}
                        alt={post.seo_title || ''}
                        className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
                        loading="lazy"
                        fallback={
                          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand-light to-[#F2F4F6]">
                            <span className="text-4xl">✈️</span>
                          </div>
                        }
                      />
                    </div>
                    <div className="p-5">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 mb-3 inline-block">
                        {ANGLE_LABELS[post.angle_type] || post.angle_type}
                      </span>
                      <h2 className="line-clamp-2 text-base md:text-[19px] font-bold text-slate-900 group-hover:text-brand tracking-tight leading-snug">
                        {post.seo_title || '여행 가이드'}
                      </h2>
                      {post.seo_description && (
                        <p className="mt-2 line-clamp-2 text-sm md:text-[15px] text-slate-500 leading-relaxed">{post.seo_description}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
