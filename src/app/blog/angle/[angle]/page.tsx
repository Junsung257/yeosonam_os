import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { unstable_cache } from 'next/cache';

import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase';
import { getPackagesByAngle, type AnglePackage } from '@/lib/angle-matcher';
import GlobalNav from '@/components/customer/GlobalNav';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import SectionHeader from '@/components/customer/SectionHeader';
import {
  BLOG_ANGLE_CACHE_TAG,
  createBlogDatabaseUnavailableError,
  isBlogDatabaseUnavailableError,
} from '@/lib/blog-cache';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';

export const revalidate = 300;
export const dynamicParams = true;

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
  og_image_url: string | null; angle_type: string; published_at: string; destination: string | null;
  travel_packages: { id: string; title: string; destination: string; price: number | null } | null;
}

type AnglePageData = {
  posts: BlogPost[];
  recommendedPackages: AnglePackage[];
  unavailable: boolean;
};

type AbortableQuery<T> = {
  abortSignal: (signal: AbortSignal) => PromiseLike<T>;
};

type BlogAngleQueryResult<T> = T & { __blogQueryUnavailable?: true };

function isBlogAngleQueryUnavailable(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const maybeResult = result as { __blogQueryUnavailable?: true; error?: unknown };
  if (maybeResult.__blogQueryUnavailable) return true;
  const error = maybeResult.error;
  if (!error) return false;
  const message = typeof error === 'object' ? JSON.stringify(error) : String(error);
  return /abort|timeout|timed out|connection timeout/i.test(message);
}

async function runBlogAngleQuery<T>(
  label: string,
  query: AbortableQuery<T>,
  fallback: unknown,
  timeoutMs = 6000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unavailableFallback = () => {
    if (fallback && typeof fallback === 'object') {
      return { ...(fallback as Record<string, unknown>), __blogQueryUnavailable: true } as BlogAngleQueryResult<T>;
    }
    return fallback as T;
  };
  const queryPromise = Promise.resolve(query.abortSignal(controller.signal)).catch((err) => {
    console.warn(`[blog/angle] ${label} query timed out or failed`, err instanceof Error ? err.message : err);
    return unavailableFallback();
  });
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      console.warn(`[blog/angle] ${label} query timed out after ${timeoutMs}ms`);
      resolve(unavailableFallback());
    }, timeoutMs);
  });
  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

async function getAnglePageDataUncached(angle: string): Promise<AnglePageData> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    throw createBlogDatabaseUnavailableError();
  }
  if (shouldSkipPublicDbReadsForResourceSaver()) {
    throw createBlogDatabaseUnavailableError();
  }

  try {
    const postsResult = await runBlogAngleQuery(
      'posts',
      supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, seo_description, og_image_url, angle_type, published_at, destination, travel_packages(id, title, destination, price)')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .eq('angle_type', angle)
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(60),
      { data: [] as BlogPost[], error: null },
      6000,
    );

    if (isBlogAngleQueryUnavailable(postsResult) || postsResult.error) {
      throw createBlogDatabaseUnavailableError();
    }

    const recommendedPackages = await getPackagesByAngle(angle, 6);

    return {
      posts: (postsResult.data || []) as unknown as BlogPost[],
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
  ['blog-angle-page-v1'],
  { revalidate: 300, tags: [BLOG_ANGLE_CACHE_TAG] },
);

async function getAnglePageData(angle: string): Promise<AnglePageData> {
  try {
    return await getCachedAnglePageData(angle);
  } catch (err) {
    if (isBlogDatabaseUnavailableError(err)) {
      return { posts: [], recommendedPackages: [], unavailable: true };
    }
    throw err;
  }
}

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ angle?: string | string[] }> }): Promise<Metadata> {
  const { angle: rawAngle } = await params;
  const angle = getRouteParam(rawAngle);
  const canonical = `${BASE_URL}/blog/angle/${encodeURIComponent(angle)}`;
  const meta = ANGLE_META[angle];
  if (!meta) return { title: '블로그' };
  return {
    title: `${meta.label} 여행 가이드 | 여소남`,
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
  const meta = ANGLE_META[angle];
  if (!meta) notFound();

  const { posts, recommendedPackages, unavailable } = await getAnglePageData(angle);

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
