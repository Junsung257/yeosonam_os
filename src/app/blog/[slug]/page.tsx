import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import BlogTracker from '@/components/BlogTracker';
import TableOfContents from '@/components/blog/TableOfContents';
import { extractTocAndInjectIds, shouldShowToc } from '@/lib/blog-toc';

export const revalidate = 3600; // 1시간 ISR

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

// ── 타입 ────────────────────────────────────────────────────
interface BlogPost {
  id: string;
  slug: string;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  blog_html: string | null;
  angle_type: string;
  channel: string;
  published_at: string;
  created_at: string;
  updated_at: string | null;
  product_id: string | null;
  tracking_id: string | null;
  travel_packages: {
    id: string;
    title: string;
    destination: string;
    price: number | null;
    duration: string | null;
    nights: number | null;
    category: string | null;
  } | null;
}

interface RelatedPost {
  id: string;
  slug: string;
  seo_title: string | null;
  og_image_url: string | null;
  angle_type: string;
  published_at: string;
  travel_packages: { destination: string; price: number | null } | null;
}

// ── 데이터 페칭 ──────────────────────────────────────────────
async function getPost(slug: string): Promise<BlogPost | null> {
  if (!isSupabaseConfigured) return null;

  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select(
      'id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, published_at, created_at, updated_at, product_id, tracking_id, travel_packages(id, title, destination, price, duration, nights, category)',
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .limit(1);

  if (!data || data.length === 0) return null;
  return data[0] as BlogPost;
}

async function getRelatedPosts(currentSlug: string, destination: string | undefined): Promise<RelatedPost[]> {
  if (!isSupabaseConfigured || !destination) return [];

  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select('id, slug, seo_title, og_image_url, angle_type, published_at, travel_packages(destination, price)')
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .neq('slug', currentSlug)
    .order('published_at', { ascending: false })
    .limit(20);

  if (!data) return [];

  // 같은 목적지 우선, 부족하면 다른 목적지에서 채움
  const posts = data as RelatedPost[];
  const sameDest = posts.filter(p => p.travel_packages?.destination === destination);
  const otherDest = posts.filter(p => p.travel_packages?.destination !== destination);
  return [...sameDest, ...otherDest].slice(0, 3);
}

// ── 동적 메타데이터 ──────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: '글을 찾을 수 없습니다' };

  const title = post.seo_title || post.travel_packages?.title || '여행 블로그';
  const description =
    post.seo_description ||
    `${post.travel_packages?.destination || ''} 여행 가이드 — 여소남이 추천하는 알찬 여행 정보`;
  // DB에 og_image_url이 있으면 우선, 없으면 opengraph-image.tsx가 자동 생성
  const dbOgImage = post.og_image_url;

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/blog/${slug}` },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `${BASE_URL}/blog/${slug}`,
      publishedTime: post.published_at,
      modifiedTime: post.updated_at || post.published_at,
      ...(dbOgImage ? { images: [{ url: dbOgImage, width: 1200, height: 630 }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(dbOgImage ? { images: [dbOgImage] } : {}),
    },
  };
}

// ── 앵글 라벨 ────────────────────────────────────────────────
const ANGLE_LABELS: Record<string, string> = {
  value: '가성비',
  emotional: '감성',
  filial: '효도',
  luxury: '럭셔리',
  urgency: '긴급특가',
  activity: '액티비티',
  food: '미식',
};

// ── 페이지 컴포넌트 ──────────────────────────────────────────
export default async function BlogDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const pkg = post.travel_packages;
  const title = post.seo_title || pkg?.title || '여행 가이드';
  const relatedPosts = await getRelatedPosts(slug, pkg?.destination);

  // 본문 sanitize + TOC 추출
  let bodyHtml = '';
  let toc: ReturnType<typeof extractTocAndInjectIds>['toc'] = [];
  let showToc = false;
  if (post.blog_html) {
    const rawHtml = /<[a-z][\s\S]*>/i.test(post.blog_html)
      ? post.blog_html
      : (marked.parse(
          post.blog_html.replace(/\*\*([^*\n\[]+?)\*\*/g, (_m, inner) => inner)
        ) as string);
    const sanitized = DOMPurify.sanitize(rawHtml);
    const result = extractTocAndInjectIds(sanitized);
    bodyHtml = result.html;
    toc = result.toc;
    showToc = shouldShowToc(sanitized, toc);
  }

  return (
    <>
      {/* JSON-LD: Article + 연결 상품 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: title,
            description: post.seo_description || '',
            image: post.og_image_url || `${BASE_URL}/og-image.png`,
            datePublished: post.published_at,
            dateModified: post.updated_at || post.published_at,
            inLanguage: 'ko-KR',
            author: {
              '@type': 'Organization',
              name: '여소남',
              url: BASE_URL,
            },
            publisher: {
              '@type': 'Organization',
              name: '여소남',
              logo: { '@type': 'ImageObject', url: `${BASE_URL}/logo.png` },
            },
            mainEntityOfPage: `${BASE_URL}/blog/${slug}`,
            ...(pkg && {
              about: {
                '@type': 'Product',
                name: pkg.title,
                description: `${pkg.destination} ${pkg.duration || ''} 여행 패키지`,
                ...(pkg.price && {
                  offers: {
                    '@type': 'Offer',
                    price: pkg.price,
                    priceCurrency: 'KRW',
                    availability: 'https://schema.org/InStock',
                    url: `${BASE_URL}/packages/${pkg.id}`,
                  },
                }),
              },
            }),
          }),
        }}
      />

      {/* BreadcrumbList JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: '홈', item: BASE_URL },
              { '@type': 'ListItem', position: 2, name: '블로그', item: `${BASE_URL}/blog` },
              { '@type': 'ListItem', position: 3, name: title, item: `${BASE_URL}/blog/${slug}` },
            ],
          }),
        }}
      />

      {/* FAQPage JSON-LD: 본문에 Q&A가 있으면 리치 스니펫 생성 */}
      {(() => {
        // blog_html에서 **Q. xxx** 패턴을 추출하여 FAQ 스키마 생성
        const faqRegex = /\*\*Q\.\s*(.+?)\*\*\s*\n\s*\n\s*A\.\s*(.+?)(?=\n\n|\n\*\*Q\.|\n##|$)/gs;
        const faqItems: { q: string; a: string }[] = [];
        if (post.blog_html) {
          let m;
          while ((m = faqRegex.exec(post.blog_html)) !== null) {
            faqItems.push({ q: m[1].trim(), a: m[2].trim() });
          }
        }
        if (faqItems.length === 0) return null;
        return (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: faqItems.map(faq => ({
                  '@type': 'Question',
                  name: faq.q,
                  acceptedAnswer: { '@type': 'Answer', text: faq.a },
                })),
              }),
            }}
          />
        );
      })()}

      <BlogTracker contentCreativeId={post.id} />

      <main className="min-h-screen bg-white">
        {/* 상단 네비 */}
        <nav className="border-b bg-white/80 backdrop-blur sticky top-0 z-30">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 text-sm text-gray-500">
            <Link href="/" className="hover:text-indigo-600">홈</Link>
            <span>/</span>
            <Link href="/blog" className="hover:text-indigo-600">블로그</Link>
            <span>/</span>
            <span className="truncate text-gray-900">{title}</span>
          </div>
        </nav>

        <div className="mx-auto max-w-6xl px-4 py-8 md:flex md:gap-10">
          <article className="flex-1 min-w-0 max-w-3xl">
          {/* 헤더 */}
          <header className="mb-8">
            <div className="mb-3 flex items-center gap-2">
              {pkg?.destination && (
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                  {pkg.destination}
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
                {ANGLE_LABELS[post.angle_type] || post.angle_type}
              </span>
            </div>

            <h1 className="text-2xl font-bold leading-tight text-gray-900 md:text-3xl">
              {title}
            </h1>

            {post.seo_description && (
              <p className="mt-3 text-base text-gray-500">{post.seo_description}</p>
            )}

            <div className="mt-4 flex items-center gap-4 text-sm text-gray-400">
              <time>
                {new Date(post.published_at).toLocaleDateString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </time>
              <span>여소남 에디터</span>
            </div>
          </header>

          {/* OG 이미지 */}
          {post.og_image_url && (
            <div className="mb-8 overflow-hidden rounded-xl relative aspect-[16/9]">
              <Image
                src={post.og_image_url}
                alt={title}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 768px"
                priority
              />
            </div>
          )}

          {/* 본문 — 모바일 TOC + 본문 HTML */}
          {bodyHtml ? (
            <>
              {showToc && <TableOfContents items={toc} variant="mobile" />}
              <div
                className="prose prose-lg prose-indigo max-w-none scroll-smooth"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            </>
          ) : (
            <p className="py-10 text-center text-gray-400">본문이 준비 중입니다.</p>
          )}

          {/* 연결 상품 CTA */}
          {pkg && (
            <div className="mt-12 rounded-xl border border-indigo-100 bg-indigo-50/50 p-6">
              <p className="mb-1 text-sm font-medium text-indigo-600">이 글의 추천 상품</p>
              <h3 className="text-lg font-bold text-gray-900">{pkg.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                {pkg.destination && <span>📍 {pkg.destination}</span>}
                {pkg.duration && <span>📅 {pkg.duration}</span>}
                {pkg.price && (
                  <span className="font-semibold text-indigo-600">
                    💰 {pkg.price.toLocaleString()}원~
                  </span>
                )}
              </div>
              <Link
                href={`/packages/${pkg.id}`}
                className="mt-4 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700"
              >
                상품 상세 보기 →
              </Link>
            </div>
          )}
          </article>

          {/* 데스크톱 사이드바 — TOC */}
          {showToc && (
            <aside className="hidden md:block w-56 shrink-0">
              <TableOfContents items={toc} variant="desktop" />
            </aside>
          )}
        </div>

        {/* 관련 글 */}
        {relatedPosts.length > 0 && (
          <section className="border-t bg-gray-50">
            <div className="mx-auto max-w-3xl px-4 py-10">
              <h2 className="mb-6 text-lg font-bold text-gray-900">관련 여행 가이드</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {relatedPosts.map((rp) => (
                  <Link
                    key={rp.id}
                    href={`/blog/${rp.slug}`}
                    className="group overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm transition hover:shadow-md"
                  >
                    {rp.og_image_url ? (
                      <div className="aspect-[16/9] overflow-hidden bg-gray-100 relative">
                        <Image
                          src={rp.og_image_url}
                          alt={rp.seo_title || ''}
                          fill
                          className="object-cover transition group-hover:scale-105"
                          sizes="(max-width: 640px) 100vw, 33vw"
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
                        <span className="text-2xl">✈️</span>
                      </div>
                    )}
                    <div className="p-3">
                      <div className="mb-1 flex items-center gap-1.5">
                        {rp.travel_packages?.destination && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                            {rp.travel_packages.destination}
                          </span>
                        )}
                        <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">
                          {ANGLE_LABELS[rp.angle_type] || rp.angle_type}
                        </span>
                      </div>
                      <h3 className="line-clamp-2 text-sm font-semibold text-gray-800 group-hover:text-indigo-600">
                        {rp.seo_title || '여행 가이드'}
                      </h3>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 하단 — 블로그 목록 돌아가기 */}
        <div className="border-t">
          <div className="mx-auto max-w-3xl px-4 py-6">
            <Link
              href="/blog"
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              ← 블로그 목록으로
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
