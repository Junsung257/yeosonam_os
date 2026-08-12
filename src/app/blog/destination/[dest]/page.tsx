import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase';
import { encodeDestinationPathSegment, destinationSlugMatches } from '@/lib/regions';
import GlobalNav from '@/components/customer/GlobalNav';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import SectionHeader from '@/components/customer/SectionHeader';
import {
  createBlogDatabaseUnavailableError,
  isBlogDatabaseUnavailableError,
} from '@/lib/blog-cache';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';
import { toBlogImageDisplaySrc } from '@/lib/blog-image-proxy';
import { BLOG_PUBLIC_ANGLE_LABELS } from '@/lib/blog-public-taxonomy';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';
import { listCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';
import { isObviouslyInvalidDestinationRoute } from '../public-route';
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

type DestinationPackage = {
  id: string;
  title: string;
  price: number | null;
  status?: string | null;
  publication_state?: string | null;
  package_revision?: number | null;
  audit_status?: string | null;
  audit_report?: unknown;
  updated_at?: string | null;
  optional_tours?: unknown;
  itinerary_data?: unknown;
};

type DestinationPageData = {
  destination: string;
  posts: BlogPost[];
  packages: DestinationPackage[];
  unavailable: boolean;
};

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getDisplayImageUrl(post: BlogPost): string | null {
  return toBlogImageDisplaySrc(post.og_image_url);
}

async function resolveDestinationRouteParamUncached(value: string): Promise<string> {
  const decoded = safeDecodePathSegment(value).trim();
  if (!decoded || !isSupabaseConfigured || !isSupabaseAdminConfigured) return decoded;

  try {
    const match = (await loadPublicBlogCatalog())
      .map((row) => row.destination?.trim() ?? '')
      .find(destination => destination && destinationSlugMatches(destination, decoded));

    return match || decoded;
  } catch {
    return decoded;
  }
}

const resolveDestinationRouteParam = cache(async (value: string): Promise<string> => {
  const decoded = safeDecodePathSegment(value).trim();
  try {
    return await resolveDestinationRouteParamUncached(value);
  } catch (err) {
    if (isBlogDatabaseUnavailableError(err)) return decoded;
    throw err;
  }
});

async function getDestinationPageDataUncached(dest: string): Promise<DestinationPageData> {
  const decoded = safeDecodePathSegment(dest).trim();
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    throw createBlogDatabaseUnavailableError();
  }

  const destination = await resolveDestinationRouteParam(dest);

  try {
    const posts = (await loadPublicBlogCatalog())
      .filter(p => {
        const postDestination = (p.destination || '').trim();
        return (
          postDestination.includes(destination) ||
          destinationSlugMatches(postDestination, destination)
        );
      })
      .slice(0, 60) as BlogPost[];

    if (shouldSkipPublicDbReadsForResourceSaver()) {
      return { destination, posts, packages: [], unavailable: false };
    }

    const packages = (await listCurrentPublicPackageCardSnapshots(supabaseAdmin, { limit: 1_000 }))
      .filter(row => String(row.destination ?? '').includes(destination))
      .sort((a, b) => Number(a.price ?? Number.MAX_SAFE_INTEGER) - Number(b.price ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 6);

    return {
      destination,
      posts,
      packages: packages as unknown as DestinationPackage[],
      unavailable: false,
    };
  } catch {
    throw createBlogDatabaseUnavailableError();
  }
}

async function getDestinationPageData(dest: string): Promise<DestinationPageData> {
  try {
    return await getDestinationPageDataUncached(dest);
  } catch (error) {
    if (!isBlogDatabaseUnavailableError(error)) throw error;
    return {
      destination: safeDecodePathSegment(dest).trim(),
      posts: [],
      packages: [],
      unavailable: true,
    };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ dest?: string | string[] }> }): Promise<Metadata> {
  const { dest: rawDest } = await params;
  const dest = getRouteParam(rawDest);
  if (isObviouslyInvalidDestinationRoute(dest)) notFound();
  const destination = await resolveDestinationRouteParam(dest);
  if (isObviouslyInvalidDestinationRoute(destination)) notFound();
  const canonical = `${BASE_URL}/blog/destination/${encodeDestinationPathSegment(destination)}`;
  return {
    title: `${destination} 여행 가이드`,
    description: `${destination} 여행의 모든 것. 가성비 패키지부터 럭셔리까지, 여소남이 엄선한 ${destination} 여행 정보를 만나보세요.`,
    alternates: { canonical },
    openGraph: {
      title: `${destination} 여행 가이드 | 여소남`,
      description: `${destination} 여행 패키지 추천, 관광지 정보, 꿀팁 가이드`,
      url: canonical,
    },
  };
}

export default async function DestinationBlogPage({ params }: { params: Promise<{ dest?: string | string[] }> }) {
  const { dest: rawDest } = await params;
  const dest = getRouteParam(rawDest);
  if (isObviouslyInvalidDestinationRoute(dest)) notFound();
  const { destination, posts, packages, unavailable } = await getDestinationPageData(dest);
  if (!unavailable && posts.length === 0) notFound();
  const canonical = `${BASE_URL}/blog/destination/${encodeDestinationPathSegment(destination)}`;

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
            name: `${destination} 여행 가이드`,
            description: `${destination} 여행 패키지 추천 및 관광 정보`,
            url: canonical,
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: posts.length,
              itemListElement: posts.slice(0, 10).map((p, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                url: `${BASE_URL}/blog/${p.slug}`,
                name: p.seo_title || `${destination} 여행 가이드`,
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
            <p className="mt-4 text-base md:text-lg text-blue-100 leading-relaxed">{destination} 여행의 모든 것</p>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-4 md:px-6 py-12 md:py-16 space-y-12 md:space-y-16">
          <DestinationContent destination={destination} posts={posts} packages={packages} unavailable={unavailable} />
        </div>
      </main>
    </>
  );
}

function DestinationContent({
  destination,
  posts,
  packages,
  unavailable,
}: {
  destination: string;
  posts: BlogPost[];
  packages: DestinationPackage[];
  unavailable: boolean;
}) {
  return (
    <>
      {/* 관련 상품 CTA */}
      {packages.length > 0 && (
        <section>
          <SectionHeader title={`${destination} 추천 패키지`} />
              <div className="grid gap-4 md:gap-6 sm:grid-cols-3">
                {packages.map(pkg => (
                  <Link key={pkg.id} href={`/packages/${encodeURIComponent(pkg.id)}`}
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
            {unavailable ? (
              <div className="py-20 text-center">
                <p className="text-[32px] mb-3">!</p>
                <p className="text-slate-500 text-base">블로그 데이터를 잠시 불러오지 못했습니다.</p>
                <p className="mt-2 text-sm text-slate-400">발행 글이 없는 상태가 아니라 DB 응답 지연입니다.</p>
              </div>
            ) : posts.length === 0 ? (
              <p className="py-20 text-center text-slate-400 text-base">{destination} 관련 가이드가 준비 중입니다.</p>
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
                            <span className="text-4xl">✈️</span>
                          </div>
                        }
                      />
                    </div>
                    <div className="p-5">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 mb-3 inline-block">
                        {BLOG_PUBLIC_ANGLE_LABELS[post.angle_type] || post.angle_type}
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
    </>
  );
}
