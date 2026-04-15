import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getPackagesByAngle } from '@/lib/angle-matcher';

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

const ANGLE_META: Record<string, { label: string; tagline: string; emoji: string }> = {
  value:     { label: '가성비',   tagline: '합리적인 가격으로 즐기는 알찬 여행',         emoji: '💰' },
  emotional: { label: '감성',     tagline: '잊지 못할 순간을 만드는 감성 여행',          emoji: '🌸' },
  filial:    { label: '효도',     tagline: '부모님과 함께하는 편안한 효도 여행',         emoji: '👨‍👩‍👧' },
  luxury:    { label: '럭셔리',   tagline: '특별한 하루를 위한 프리미엄 여행',           emoji: '✨' },
  urgency:   { label: '긴급특가', tagline: '지금 떠나야 가장 저렴한 한정 특가 여행',     emoji: '⏰' },
  activity:  { label: '액티비티', tagline: '온몸으로 즐기는 다이내믹한 액티비티 여행',   emoji: '🏄' },
  food:      { label: '미식',     tagline: '현지 입맛으로 즐기는 미식 여행',             emoji: '🍴' },
};

interface BlogPost {
  id: string; slug: string; seo_title: string | null; seo_description: string | null;
  og_image_url: string | null; angle_type: string; published_at: string;
  travel_packages: { id: string; title: string; destination: string; price: number | null } | null;
}

async function getPostsByAngle(angle: string): Promise<BlogPost[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, seo_description, og_image_url, angle_type, published_at, travel_packages(id, title, destination, price)')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .eq('angle_type', angle)
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(60);
    return (data || []) as BlogPost[];
  } catch {
    return [];
  }
}

export function generateStaticParams() {
  return Object.keys(ANGLE_META).map(angle => ({ angle }));
}

export async function generateMetadata({ params }: { params: Promise<{ angle: string }> }): Promise<Metadata> {
  const { angle } = await params;
  const meta = ANGLE_META[angle];
  if (!meta) return { title: '블로그' };
  return {
    title: `${meta.label} 여행 가이드 | 여소남`,
    description: `${meta.tagline}. 여소남이 엄선한 ${meta.label} 여행 콘텐츠 모음.`,
    alternates: { canonical: `${BASE_URL}/blog/angle/${angle}` },
    openGraph: {
      title: `${meta.label} 여행 가이드 | 여소남`,
      description: meta.tagline,
      url: `${BASE_URL}/blog/angle/${angle}`,
    },
  };
}

export default async function AngleBlogPage({ params }: { params: Promise<{ angle: string }> }) {
  const { angle } = await params;
  const meta = ANGLE_META[angle];
  if (!meta) notFound();

  const [posts, recommendedPackages] = await Promise.all([
    getPostsByAngle(angle),
    getPackagesByAngle(angle, 6),
  ]);

  return (
    <>
      {/* CollectionPage JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: `${meta.label} 여행 가이드`,
            description: meta.tagline,
            url: `${BASE_URL}/blog/angle/${angle}`,
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: posts.length,
              itemListElement: posts.slice(0, 10).map((p, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                url: `${BASE_URL}/blog/${p.slug}`,
                name: p.seo_title || meta.label,
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
              <span className="text-white">{meta.label}</span>
            </div>
            <h1 className="text-3xl font-bold md:text-4xl">
              {meta.emoji} {meta.label} 여행 가이드
            </h1>
            <p className="mt-2 text-indigo-100">{meta.tagline} · {posts.length}편의 가이드</p>
          </div>
        </header>

        <div className="mx-auto max-w-5xl px-4 py-10">
          {/* 추천 상품 CTA */}
          {recommendedPackages.length > 0 && (
            <section className="mb-10 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 md:p-6">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-base md:text-lg font-bold text-indigo-900">
                  {meta.emoji} {meta.label} 추천 패키지
                </h2>
                <Link href="/packages" className="text-xs md:text-sm text-indigo-600 hover:text-indigo-800">
                  전체 상품 보기 →
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recommendedPackages.map(pkg => (
                  <Link
                    key={pkg.id}
                    href={`/packages/${pkg.id}`}
                    className="block rounded-xl border border-indigo-100 bg-white p-3 hover:shadow-md hover:border-indigo-300 transition"
                  >
                    {pkg.destination && (
                      <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 mb-1.5">
                        📍 {pkg.destination}
                      </span>
                    )}
                    <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug">
                      {pkg.display_title || pkg.title}
                    </p>
                    {pkg.price && (
                      <p className="text-sm font-bold text-indigo-600 mt-2">
                        ₩{pkg.price.toLocaleString()}~
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* 다른 앵글 둘러보기 */}
          <nav className="mb-8 flex flex-wrap gap-2" aria-label="다른 앵글 둘러보기">
            {Object.entries(ANGLE_META).map(([key, m]) => (
              <Link
                key={key}
                href={`/blog/angle/${key}`}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  key === angle
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {m.emoji} {m.label}
              </Link>
            ))}
          </nav>

          {/* 블로그 글 목록 */}
          {posts.length === 0 ? (
            <p className="py-20 text-center text-gray-400">{meta.label} 카테고리의 가이드가 준비 중입니다.</p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map(post => (
                <Link key={post.id} href={`/blog/${post.slug}`}
                  className="group overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md">
                  {post.og_image_url ? (
                    <div className="aspect-[16/9] overflow-hidden bg-gray-100">
                      <img src={post.og_image_url} alt={post.seo_title || ''} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                    </div>
                  ) : (
                    <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
                      <span className="text-4xl">{meta.emoji}</span>
                    </div>
                  )}
                  <div className="p-4">
                    {post.travel_packages?.destination && (
                      <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 mb-2 inline-block">
                        {post.travel_packages.destination}
                      </span>
                    )}
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
