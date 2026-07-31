import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { unstable_cache } from 'next/cache';

import { getPackagesByAngle, type AnglePackage } from '@/lib/angle-matcher';
import GlobalNav from '@/components/customer/GlobalNav';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import SectionHeader from '@/components/customer/SectionHeader';
import {
  BLOG_ANGLE_CACHE_TAG,
  createBlogDatabaseUnavailableError,
  isBlogDatabaseUnavailableError,
} from '@/lib/blog-cache';
import { toBlogImageDisplaySrc } from '@/lib/blog-image-proxy';
import { BLOG_PUBLIC_ANGLES, BLOG_PUBLIC_ANGLE_META } from '@/lib/blog-public-taxonomy';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';
import { serializeJsonLdForScript } from '@/lib/json-ld';
import {
  loadPublicBlogCatalog,
  type PublicBlogCatalogPost,
} from '@/lib/blog-public-catalog';

export const revalidate = 300;
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

const BASE_URL = resolveBlogCanonicalOrigin();

type BlogPost = Pick<
  PublicBlogCatalogPost,
  'id' | 'slug' | 'seo_title' | 'seo_description' | 'og_image_url' | 'angle_type' | 'published_at' | 'destination'
>;

type AnglePageData = {
  posts: BlogPost[];
  recommendedPackages: AnglePackage[];
  unavailable: boolean;
};

function getDisplayImageUrl(post: BlogPost): string | null {
  return toBlogImageDisplaySrc(post.og_image_url);
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

async function getAnglePageDataUncached(angle: string): Promise<AnglePageData> {
  try {
    const posts = (await loadPublicBlogCatalog())
      .filter((post) => post.angle_type === angle)
      .slice(0, 60) as BlogPost[];
    const recommendedPackages = await getPackagesByAngle(angle, 6).catch(() => []);

    return {
      posts,
      recommendedPackages,
      unavailable: false,
    };
  } catch {
    throw createBlogDatabaseUnavailableError();
  }
}

const getCachedAnglePageData = unstable_cache(
  async (angle: string) => {
    return getAnglePageDataUncached(angle);
  },
  ['blog-angle-page-v2-public-eligibility'],
  { revalidate: 300, tags: [BLOG_ANGLE_CACHE_TAG] },
);

async function getAnglePageData(angle: string): Promise<AnglePageData> {
  try {
    return await getCachedAnglePageData(angle);
  } catch (error) {
    if (!isBlogDatabaseUnavailableError(error)) throw error;
    return { posts: [], recommendedPackages: [], unavailable: true };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ angle?: string | string[] }> }): Promise<Metadata> {
  const { angle: rawAngle } = await params;
  const angle = getRouteParam(rawAngle);
  const canonical = `${BASE_URL}/blog/angle/${encodeURIComponent(angle)}`;
  const meta = BLOG_PUBLIC_ANGLE_META[angle];
  if (!meta) return { title: '블로그' };
  return {
    title: `${meta.label} 여행 가이드`,
    description: `${meta.tagline}. 여소남이 엄선한 ${meta.label} 여행 콘텐츠 모음.`,
    alternates: { canonical },
    openGraph: {
      title: `${meta.label} 여행 가이드 | 여소남`,
      description: meta.tagline,
      url: canonical,
    },
  };
}

export default async function AngleBlogPage({ params }: { params: Promise<{ angle?: string | string[] }> }) {
  const { angle: rawAngle } = await params;
  const angle = getRouteParam(rawAngle);
  const meta = BLOG_PUBLIC_ANGLE_META[angle];
  if (!meta) notFound();

  const { posts, recommendedPackages, unavailable } = await getAnglePageData(angle);

  return (
    <>
      {/* CollectionPage JSON-LD */}
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLdForScript({
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
            <div className="text-2xl md:text-4xl mb-2 opacity-90">{meta.icon}</div>
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
                    href={`/packages/${encodeURIComponent(pkg.id)}`}
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
            {BLOG_PUBLIC_ANGLES.map((m) => (
              <Link
                key={m.key}
                href={`/blog/angle/${m.key}`}
                className={`rounded-full px-4 py-2 text-base font-medium transition ${
                  m.key === angle
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-900 hover:text-slate-900'
                }`}
              >
                {m.icon} {m.label}
              </Link>
            ))}
          </nav>

          {/* 블로그 글 목록 */}
          <section>
            <SectionHeader title={`${meta.label} 가이드`} />
            {unavailable ? (
              <div className="py-20 text-center">
                <p className="text-[32px] mb-3">!</p>
                <p className="text-slate-500 text-base">블로그 데이터를 잠시 불러오지 못했습니다.</p>
                <p className="mt-2 text-sm text-slate-400">발행 글이 없는 상태가 아니라 DB 응답 지연입니다.</p>
              </div>
            ) : posts.length === 0 ? (
              <p className="py-20 text-center text-slate-400 text-base">{meta.label} 카테고리의 가이드가 준비 중입니다.</p>
            ) : (
              <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {posts.map(post => (
                  <Link key={post.id} href={`/blog/${post.slug}`}
                    className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
                    <div className="aspect-[16/9] overflow-hidden bg-slate-100 relative">
                      <SafeCoverImg
                        src={getDisplayImageUrl(post)}
                        alt={post.seo_title || ''}
                        className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
                        loading="lazy"
                        fallback={
                          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand-light to-[#F2F4F6]">
                            <span className="text-4xl">{meta.icon}</span>
                          </div>
                        }
                      />
                    </div>
                    <div className="p-5">
                      {post.destination && (
                        <span className="rounded-full bg-brand-light px-2.5 py-1 text-xs font-medium text-brand mb-3 inline-block">
                          {post.destination}
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
