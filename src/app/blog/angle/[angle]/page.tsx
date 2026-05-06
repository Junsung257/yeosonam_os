import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getPackagesByAngle } from '@/lib/angle-matcher';
import GlobalNav from '@/components/customer/GlobalNav';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import SectionHeader from '@/components/customer/SectionHeader';

export const revalidate = 300;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';

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
        suppressHydrationWarning
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

      <GlobalNav />
      <main className="min-h-screen bg-white">
        <header className="border-b bg-gradient-to-r from-brand to-brand-dark text-white">
          <div className="mx-auto max-w-6xl px-4 md:px-6 py-14 md:py-20">
            <div className="flex items-center gap-2 text-[13px] md:text-sm text-blue-200 mb-4">
              <Link href="/" className="hover:text-white">홈</Link>
              <span>/</span>
              <Link href="/blog" className="hover:text-white">블로그</Link>
              <span>/</span>
              <span className="text-white">{meta.label}</span>
            </div>
            <div className="text-2xl md:text-4xl mb-2 opacity-90">{meta.emoji}</div>
            <h1 className="text-[40px] md:text-[60px] font-black tracking-tight leading-[1.05]">
              {meta.label} 여행 가이드
            </h1>
            <p className="mt-4 text-base md:text-lg text-blue-100 leading-relaxed">{meta.tagline} · {posts.length}편의 가이드</p>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-4 md:px-6 py-12 md:py-16 space-y-12 md:space-y-16">
          {/* 추천 상품 CTA */}
          {recommendedPackages.length > 0 && (
            <section>
              <SectionHeader
                title={`${meta.label} 추천 패키지`}
                actionHref="/packages"
                actionLabel="전체 상품 →"
              />
              <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {recommendedPackages.map(pkg => (
                  <Link
                    key={pkg.id}
                    href={`/packages/${pkg.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-5 hover:shadow-md hover:border-brand transition"
                  >
                    {pkg.destination && (
                      <span className="inline-block rounded-full bg-brand-light px-2.5 py-1 text-xs font-medium text-brand mb-2">
                        📍 {pkg.destination}
                      </span>
                    )}
                    <p className="text-base md:text-[19px] font-bold text-slate-900 line-clamp-2 leading-snug tracking-tight">
                      {pkg.display_title || pkg.title}
                    </p>
                    {pkg.price && (
                      <p className="text-xl md:text-2xl font-black text-slate-900 mt-3 tabular-nums">
                        ₩{pkg.price.toLocaleString()}~
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* 다른 앵글 둘러보기 */}
          <nav className="flex flex-wrap gap-2" aria-label="다른 앵글 둘러보기">
            {Object.entries(ANGLE_META).map(([key, m]) => (
              <Link
                key={key}
                href={`/blog/angle/${key}`}
                className={`rounded-full px-4 py-2 text-base font-medium transition ${
                  key === angle
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-900 hover:text-slate-900'
                }`}
              >
                {m.emoji} {m.label}
              </Link>
            ))}
          </nav>

          {/* 블로그 글 목록 */}
          <section>
            <SectionHeader title={`${meta.label} 가이드`} />
            {posts.length === 0 ? (
              <p className="py-20 text-center text-slate-400 text-base">{meta.label} 카테고리의 가이드가 준비 중입니다.</p>
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
                            <span className="text-4xl">{meta.emoji}</span>
                          </div>
                        }
                      />
                    </div>
                    <div className="p-5">
                      {post.travel_packages?.destination && (
                        <span className="rounded-full bg-brand-light px-2.5 py-1 text-xs font-medium text-brand mb-3 inline-block">
                          {post.travel_packages.destination}
                        </span>
                      )}
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
