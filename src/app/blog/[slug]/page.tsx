import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import BlogTracker from '@/components/BlogTracker';
import TableOfContents from '@/components/blog/TableOfContents';
import TldrBox from '@/components/blog/TldrBox';
import AuthorBox from '@/components/blog/AuthorBox';
import ShareButtons from '@/components/blog/ShareButtons';
import ReadingProgress from '@/components/blog/ReadingProgress';
import BlogCitations from '@/components/blog/BlogCitations';
import InlineRelated, {
  type RelatedProductLite,
  type RelatedPostLite,
} from '@/components/blog/InlineRelated';
import { extractTocAndInjectIds, shouldShowToc } from '@/lib/blog-toc';
import { applyMarkdownAccents, applyHtmlAccents } from '@/lib/blog-accent';
import LandingHero from '@/components/blog/LandingHero';
import StickyMobileCta from '@/components/blog/StickyMobileCta';
import DestinationCuration from '@/components/blog/DestinationCuration';
import { resolveDki } from '@/lib/dki-resolver';

export const revalidate = 3600;
// 빌드 시점에 발행된 모든 글을 SSG. 새로 발행되는 글은 dynamicParams=true 기본값으로 on-demand SSG.
// 이 한 줄이 "발행 직후 첫 요청 race로 404가 캐시되는" 패턴을 구조적으로 차단한다.
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data } = await supabaseAdmin
      .from('content_creatives')
      .select('slug')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(2000);
    const rows = (data || []) as Array<{ slug: string | null }>;
    return rows
      .map((r) => r.slug)
      .filter((s: string | null): s is string => !!s)
      .map((slug: string) => ({ slug }));
  } catch {
    return [];
  }
}

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
  destination: string | null;
  landing_enabled: boolean | null;
  landing_headline: string | null;
  landing_subtitle: string | null;
  travel_packages: {
    id: string;
    title: string;
    destination: string;
    price: number | null;
    duration: string | number | null;
    nights: number | null;
    category: string | null;
    airline: string | null;
    departure_airport: string | null;
    product_highlights: string[] | null;
    inclusions: string[] | null;
  } | null;
}

interface RelatedPost {
  id: string;
  slug: string;
  seo_title: string | null;
  og_image_url: string | null;
  angle_type: string;
  published_at: string;
  travel_packages: {
    destination: string;
    price: number | null;
    duration: string | number | null;
    nights: number | null;
  } | null;
}

const ANGLE_LABELS: Record<string, string> = {
  value: '가성비',
  emotional: '감성',
  filial: '효도',
  luxury: '럭셔리',
  urgency: '긴급특가',
  activity: '액티비티',
  food: '미식',
};

// ── 유틸 ────────────────────────────────────────────────────
function formatDuration(
  duration: string | number | null | undefined,
  nights: number | null | undefined,
): string {
  if (!duration && !nights) return '';
  const d = typeof duration === 'string' ? parseInt(duration, 10) : duration;
  const dNum = typeof d === 'number' && !Number.isNaN(d) ? d : null;
  if (nights && dNum) return `${nights}박${dNum}일`;
  if (dNum) return `${dNum}일`;
  if (typeof duration === 'string' && duration.trim()) return duration.trim();
  return '';
}

function stripMarkdownBold(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*/g, '').trim();
}

function extractTldrItems(post: BlogPost): string[] {
  const pkg = post.travel_packages;
  const out: string[] = [];
  const dur = formatDuration(pkg?.duration, pkg?.nights);
  if (pkg?.destination && dur) out.push(`${pkg.destination} ${dur} 여행`);
  if (pkg?.price) out.push(`출발가 ${pkg.price.toLocaleString()}원~`);
  if (pkg?.airline) out.push(`${pkg.airline} 이용`);
  if (pkg?.departure_airport) out.push(`${pkg.departure_airport.replace(/\(.*?\)/g, '').trim()} 출발`);

  const highlights = (pkg?.product_highlights || [])
    .map(stripMarkdownBold)
    .filter((s) => s && s.length > 3 && s.length < 80)
    .slice(0, 3);
  out.push(...highlights);

  // 중복 제거
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = item.replace(/\s+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function estimateReadingMinutes(html: string): number {
  const text = html.replace(/<[^>]+>/g, '').trim();
  // 한국어 기준 분당 500자. 최소 3분.
  return Math.max(3, Math.round(text.length / 500));
}

// ── 데이터 페칭 ──────────────────────────────────────────────
async function getPost(slug: string): Promise<BlogPost | null> {
  if (!isSupabaseConfigured) return null;

  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select(
      // travel_packages.hero_image_url 컬럼은 DB에 존재하지 않는다 (photos 는 별도 테이블).
      // select에 포함하면 supabase가 통째로 에러 반환 → data=null → notFound() 404.
      // 이것이 "발행했는데 글이 안 뜬다"의 진짜 원인이었음. (API 라우트는 select 안 함 → 200)
      'id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, published_at, created_at, updated_at, product_id, tracking_id, destination, landing_enabled, landing_headline, landing_subtitle, travel_packages(id, title, destination, price, duration, nights, category, airline, departure_airport, product_highlights, inclusions)',
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .limit(1);

  if (!data || data.length === 0) return null;
  return data[0] as unknown as BlogPost;
}

async function getRelatedProducts(
  currentProductId: string | null | undefined,
  destination: string | undefined,
): Promise<RelatedProductLite[]> {
  if (!isSupabaseConfigured || !destination) return [];
  let query = supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, price, duration, nights, airline, departure_airport')
    .eq('destination', destination)
    .in('status', ['active', 'approved'])
    .order('price', { ascending: true })
    .limit(4);
  if (currentProductId) query = query.neq('id', currentProductId);
  const { data } = await query;
  return (data as unknown as RelatedProductLite[]) || [];
}

/**
 * sanitize된 본문 HTML을 H2 경계로 2등분한다.
 * H2가 4개 미만이면 주입하지 않는다 (짧은 글엔 방해됨).
 */
function splitHtmlForInlineInjection(html: string): { before: string; after: string } | null {
  const parts = html.split(/(?=<h2\b)/i);
  // parts[0]은 첫 H2 이전(도입부), 이후가 각 H2 섹션
  const h2Count = parts.length - 1;
  if (h2Count < 4) return null;
  const midIdx = Math.ceil(parts.length / 2);
  const before = parts.slice(0, midIdx).join('');
  const after = parts.slice(midIdx).join('');
  if (!before.trim() || !after.trim()) return null;
  return { before, after };
}

async function getRelatedPosts(
  currentSlug: string,
  destination: string | undefined,
  angleType: string | undefined,
): Promise<RelatedPost[]> {
  if (!isSupabaseConfigured) return [];

  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select(
      'id, slug, seo_title, og_image_url, angle_type, published_at, travel_packages(destination, price, duration, nights)',
    )
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .neq('slug', currentSlug)
    .order('published_at', { ascending: false })
    .limit(50);

  if (!data) return [];
  const posts = data as unknown as RelatedPost[];

  // 우선순위: 같은 destination + 같은 angle → 같은 destination → 같은 angle → 최신
  const sameDestSameAngle = posts.filter(
    (p) => p.travel_packages?.destination === destination && p.angle_type === angleType,
  );
  const sameDest = posts.filter(
    (p) => p.travel_packages?.destination === destination && p.angle_type !== angleType,
  );
  const sameAngle = posts.filter(
    (p) => p.angle_type === angleType && p.travel_packages?.destination !== destination,
  );
  const rest = posts.filter(
    (p) => p.travel_packages?.destination !== destination && p.angle_type !== angleType,
  );

  const merged: RelatedPost[] = [];
  const seen = new Set<string>();
  for (const arr of [sameDestSameAngle, sameDest, sameAngle, rest]) {
    for (const p of arr) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
      if (merged.length >= 6) return merged;
    }
  }
  return merged;
}

// ── 정보성 블로그 하단 큐레이션 상품 3개 (가격 분산) ─────────
async function getCurationProductsForInfo(destination: string) {
  if (!isSupabaseConfigured) return [];
  const today = new Date().toISOString().split('T')[0];

  const { data } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, duration, nights, price, category, airline, departure_airport, price_dates')
    .eq('destination', destination)
    .in('status', ['approved', 'active'])
    .order('price', { ascending: true })
    .limit(12);

  if (!data || data.length === 0) return [];

  // 미래 출발일 있는 상품만 필터
  const alive = (data as any[]).filter((p) => {
    const pd = (p.price_dates || []) as Array<{ date?: string }>;
    if (pd.length === 0) return true; // 날짜 데이터 없으면 살아있다고 간주
    return pd.some((d) => d.date && d.date >= today);
  });

  if (alive.length <= 3) return alive;

  // 가격 3분위에서 1개씩 (가성비 / 중가 / 프리미엄)
  const sorted = [...alive].sort((a, b) => (a.price || 0) - (b.price || 0));
  const n = sorted.length;
  return [
    sorted[0],
    sorted[Math.floor(n / 2)],
    sorted[n - 1],
  ];
}

// ── 동적 메타데이터 ──────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  // 404 캐시가 색인되지 않도록 명시적 noindex.
  if (!post) {
    return {
      title: '글을 찾을 수 없습니다',
      robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
    };
  }

  const rawTitle = post.seo_title || post.travel_packages?.title || '여행 블로그';
  // 레거시 글 방어: seo_title에 ' | 여소남 2026' 접미사가 남아 있으면 루트 layout의
  // template("%s | 여소남")과 중복되므로 제거한다.
  const cleanedTitle = rawTitle
    .replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '')
    .trim();

  const description =
    post.seo_description ||
    `${post.travel_packages?.destination || ''} 여행 가이드 — 여소남이 추천하는 알찬 여행 정보`;
  const dbOgImage = post.og_image_url;

  const angleLabel = ANGLE_LABELS[post.angle_type] || post.angle_type;
  const dest = post.travel_packages?.destination || post.destination || null;
  const tagSet = [dest, angleLabel, '여행', '패키지여행', '단체여행'].filter(Boolean) as string[];

  return {
    // absolute를 쓰면 layout의 template이 적용되지 않음
    title: { absolute: `${cleanedTitle} | 여소남` },
    description,
    keywords: tagSet,
    alternates: {
      canonical: `${BASE_URL}/blog/${slug}`,
      types: { 'application/rss+xml': `${BASE_URL}/api/rss` },
    },
    openGraph: {
      type: 'article',
      title: cleanedTitle,
      description,
      url: `${BASE_URL}/blog/${slug}`,
      publishedTime: post.published_at,
      modifiedTime: post.updated_at || post.published_at,
      authors: [BASE_URL],
      section: angleLabel,
      tags: tagSet,
      locale: 'ko_KR',
      siteName: '여소남',
      ...(dbOgImage ? { images: [{ url: dbOgImage, width: 1200, height: 630, alt: cleanedTitle }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: cleanedTitle,
      description,
      ...(dbOgImage ? { images: [dbOgImage] } : {}),
    },
  };
}

// ── 페이지 컴포넌트 ──────────────────────────────────────────
export default async function BlogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const qp = await searchParams;
  const utmCampaign = (qp.utm_campaign as string) || null;
  const utmTerm = (qp.utm_term as string) || null;
  const utmSource = (qp.utm_source as string) || null;

  const post = await getPost(slug);
  if (!post) notFound();

  const pkg = post.travel_packages;
  const rawTitle = post.seo_title || pkg?.title || '여행 가이드';
  const title = rawTitle.replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '').trim();

  // 블로그 유형 판별
  const isInfoBlog = !post.product_id;
  const isLanding = !!post.landing_enabled && !!post.product_id;

  // DKI 결정 (상품 블로그 + 광고 유입일 때만)
  const dki = isLanding
    ? await resolveDki(
        { utm_campaign: utmCampaign, utm_term: utmTerm, utm_source: utmSource, content_creative_id: post.id },
        {
          seo_title: title,
          landing_headline: post.landing_headline,
          landing_subtitle: post.landing_subtitle,
        },
      )
    : null;

  // 정보성 블로그: destination 기반 큐레이션 상품 3개 가져오기
  const curationProducts = isInfoBlog && post.destination
    ? await getCurationProductsForInfo(post.destination)
    : [];

  const [relatedPosts, relatedProducts] = await Promise.all([
    getRelatedPosts(slug, pkg?.destination, post.angle_type),
    getRelatedProducts(pkg?.id, pkg?.destination),
  ]);
  const durationStr = formatDuration(pkg?.duration, pkg?.nights);
  const tldrItems = extractTldrItems(post);
  const angleLabel = ANGLE_LABELS[post.angle_type] || post.angle_type;
  const pageUrl = `${BASE_URL}/blog/${slug}`;

  // 본문 sanitize + TOC 추출
  let bodyHtml = '';
  let toc: ReturnType<typeof extractTocAndInjectIds>['toc'] = [];
  let showToc = false;
  let readingMinutes = 3;

  if (post.blog_html) {
    // 마크다운 단계에서 ==text== · :::tip::: 변환 → 그다음 marked 파싱
    const mdAccented = applyMarkdownAccents(
      post.blog_html.replace(/\*\*([^*\n[]+?)\*\*/g, (_m, inner) => inner),
    );
    const rawHtml = /<[a-z][\s\S]*>/i.test(post.blog_html)
      ? applyMarkdownAccents(post.blog_html)
      : (marked.parse(mdAccented) as string);
    // 숫자+단위 자동 오렌지 볼드
    const accented = applyHtmlAccents(rawHtml);
    const sanitized = DOMPurify.sanitize(accented, {
      ADD_TAGS: ['mark', 'aside'],
      ADD_ATTR: ['class'],
    });
    const result = extractTocAndInjectIds(sanitized);
    bodyHtml = result.html;
    toc = result.toc;
    showToc = shouldShowToc(sanitized, toc);
    readingMinutes = estimateReadingMinutes(sanitized);
  }

  // FAQ 자동 추출
  const faqItems: { q: string; a: string }[] = [];
  if (post.blog_html) {
    const faqRegex = /\*\*Q\.\s*(.+?)\*\*\s*\n\s*\n\s*A\.\s*(.+?)(?=\n\n|\n\*\*Q\.|\n##|$)/gs;
    let m;
    while ((m = faqRegex.exec(post.blog_html)) !== null) {
      faqItems.push({ q: m[1].trim(), a: m[2].trim() });
    }
  }

  return (
    <>
      <ReadingProgress />

      {/* JSON-LD: BlogPosting */}
      <script
        suppressHydrationWarning
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
            wordCount: bodyHtml.replace(/<[^>]+>/g, '').length,
            timeRequired: `PT${readingMinutes}M`,
            articleSection: angleLabel,
            keywords: [pkg?.destination, angleLabel, '여행', '패키지여행', '단체여행']
              .filter(Boolean)
              .join(','),
            // author 배열 — Google Rich Results는 다중 author 지원.
            // Organization(브랜드) + Person(편집자)로 EEAT의 Authoritativeness + Experience 분리 시그널.
            // Quality Rater Guidelines 2025 권장: 저자 신원·외부 프로필 sameAs 노출.
            author: [
              {
                '@type': 'Organization',
                name: '여소남',
                url: BASE_URL,
                sameAs: [
                  'https://blog.naver.com/yesonam',
                  'https://www.instagram.com/yesonam',
                ],
              },
              {
                '@type': 'Person',
                name: '여소남 운영팀',
                jobTitle: '여행 큐레이션 에디터',
                worksFor: { '@type': 'Organization', name: '여소남', url: BASE_URL },
                url: `${BASE_URL}/about`,
              },
            ],
            // reviewedBy — 본문이 운영팀 OP의 검수를 거쳤다는 사실 시그널 (Experience).
            reviewedBy: {
              '@type': 'Organization',
              name: '여소남 운영팀',
              url: BASE_URL,
            },
            publisher: {
              '@type': 'Organization',
              name: '여소남',
              logo: { '@type': 'ImageObject', url: `${BASE_URL}/logo.png` },
            },
            mainEntityOfPage: pageUrl,
            ...(pkg && {
              about: {
                '@type': 'TouristTrip',
                name: pkg.title,
                description: `${pkg.destination}${durationStr ? ` ${durationStr}` : ''} 여행 패키지`,
                touristType: angleLabel,
                ...(pkg.destination && {
                  itinerary: {
                    '@type': 'TouristDestination',
                    name: pkg.destination,
                  },
                }),
                ...(pkg.price && {
                  offers: {
                    '@type': 'Offer',
                    price: pkg.price,
                    priceCurrency: 'KRW',
                    availability: 'https://schema.org/InStock',
                    url: `${BASE_URL}/packages/${pkg.id}`,
                    validThrough: new Date(
                      new Date().getFullYear(),
                      11,
                      31,
                    )
                      .toISOString()
                      .slice(0, 10),
                  },
                }),
              },
              ...(pkg.destination && {
                mentions: [
                  {
                    '@type': 'TouristDestination',
                    name: pkg.destination,
                  },
                ],
              }),
            }),
          }),
        }}
      />

      {/* BreadcrumbList JSON-LD */}
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: '홈', item: BASE_URL },
              { '@type': 'ListItem', position: 2, name: '블로그', item: `${BASE_URL}/blog` },
              ...(pkg?.destination
                ? [
                    {
                      '@type': 'ListItem',
                      position: 3,
                      name: pkg.destination,
                      item: `${BASE_URL}/blog/destination/${encodeURIComponent(pkg.destination)}`,
                    },
                    { '@type': 'ListItem', position: 4, name: title, item: pageUrl },
                  ]
                : [{ '@type': 'ListItem', position: 3, name: title, item: pageUrl }]),
            ],
          }),
        }}
      />

      {/* FAQPage JSON-LD */}
      {faqItems.length > 0 && (
        <script
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: faqItems.map((faq) => ({
                '@type': 'Question',
                name: faq.q,
                acceptedAnswer: { '@type': 'Answer', text: faq.a },
              })),
            }),
          }}
        />
      )}

      <BlogTracker contentCreativeId={post.id} />

      <main className="min-h-screen bg-white">
        {/* 상단 네비 (breadcrumb) */}
        <nav
          className="border-b bg-white/90 backdrop-blur sticky top-0 z-30"
          aria-label="경로 탐색"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 text-sm text-gray-500">
            <Link href="/" className="hover:text-indigo-600">
              홈
            </Link>
            <span aria-hidden="true">/</span>
            <Link href="/blog" className="hover:text-indigo-600">
              블로그
            </Link>
            {pkg?.destination && (
              <>
                <span aria-hidden="true">/</span>
                <Link
                  href={`/blog/destination/${encodeURIComponent(pkg.destination)}`}
                  className="hover:text-indigo-600"
                >
                  {pkg.destination}
                </Link>
              </>
            )}
            <span aria-hidden="true">/</span>
            <span className="truncate text-gray-900">{title}</span>
          </div>
        </nav>

        {/* 매거진 스타일 헤더 */}
        <header className="mx-auto max-w-3xl px-4 pb-6 pt-10 md:pt-14">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {pkg?.destination && (
              <Link
                href={`/blog/destination/${encodeURIComponent(pkg.destination)}`}
                className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-indigo-700"
              >
                {pkg.destination}
              </Link>
            )}
            <Link
              href={`/blog/angle/${post.angle_type}`}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-indigo-300 hover:text-indigo-700"
            >
              {angleLabel}
            </Link>
          </div>

          <h1 className="text-[26px] font-black leading-[1.25] tracking-tight text-gray-900 md:text-[34px] md:leading-[1.22]">
            {title}
          </h1>

          {post.seo_description && (
            <p className="mt-4 text-[15px] leading-relaxed text-gray-500 md:text-base">
              {post.seo_description}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-4 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-xs font-bold text-white"
                aria-hidden="true"
              >
                여
              </span>
              <span className="font-medium text-gray-700">여소남 에디터</span>
            </div>
            <span aria-hidden="true" className="text-gray-300">·</span>
            <time dateTime={post.published_at}>
              {new Date(post.published_at).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
            <span aria-hidden="true" className="text-gray-300">·</span>
            <span>약 {readingMinutes}분 읽기</span>
          </div>
        </header>

        {/* 상품 블로그 + landing_enabled → 광고 랜딩 Hero (above-fold CTA) */}
        {isLanding && dki && (
          <div className="mx-auto mb-2 max-w-4xl px-4">
            <LandingHero
              headline={dki.headline}
              subtitle={dki.subtitle || post.landing_subtitle || (pkg?.product_highlights?.slice(0, 3).join(' · ') ?? undefined)}
              heroImage={post.og_image_url || (pkg as any)?.hero_image_url || null}
              priceKrw={pkg?.price ?? null}
              productUrl={pkg ? `/packages/${pkg.id}` : null}
              trustBadges={['운영팀 검증', '노팁·노옵션', pkg?.airline || '직항']}
              matched={dki.matched}
            />
          </div>
        )}

        {/* 정보성 글 또는 랜딩 비활성 시 기본 히어로 이미지 */}
        {!isLanding && post.og_image_url && (
          <figure className="mx-auto mb-2 max-w-4xl px-4">
            <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-gray-100 md:aspect-[21/9]">
              <img
                src={post.og_image_url}
                alt={title}
                width={1600}
                height={900}
                className="h-full w-full object-cover"
                fetchPriority="high"
                loading="eager"
                decoding="async"
              />
            </div>
          </figure>
        )}

        {/* 본문 + 사이드바 그리드 */}
        <div className="mx-auto max-w-6xl px-4 py-8 md:py-10 lg:flex lg:gap-12">
          <article className="min-w-0 flex-1 lg:max-w-[720px]">
            {/* TL;DR 박스 */}
            <TldrBox items={tldrItems} />

            {/* 모바일 TOC (본문 상단 접이식) */}
            {showToc && <TableOfContents items={toc} variant="mobile" />}

            {/* 본문 HTML — H2 4개 이상일 때 중간에 인라인 관련 콘텐츠 주입 */}
            {bodyHtml ? (
              (() => {
                const split = splitHtmlForInlineInjection(bodyHtml);
                const inlineRelatedLites: RelatedPostLite[] = relatedPosts
                  .slice(0, 2)
                  .map((rp) => ({
                    slug: rp.slug,
                    seo_title: rp.seo_title,
                    destination: rp.travel_packages?.destination,
                  }));
                const canInject =
                  split &&
                  (relatedProducts.length > 0 || inlineRelatedLites.length > 0);
                if (canInject && split) {
                  return (
                    <>
                      <div
                        className="prose prose-lg prose-indigo prose-blog max-w-none scroll-smooth"
                        dangerouslySetInnerHTML={{ __html: split.before }}
                      />
                      <InlineRelated
                        destination={pkg?.destination}
                        relatedProducts={relatedProducts}
                        relatedPosts={inlineRelatedLites}
                      />
                      <div
                        className="prose prose-lg prose-indigo prose-blog max-w-none scroll-smooth"
                        dangerouslySetInnerHTML={{ __html: split.after }}
                      />
                    </>
                  );
                }
                return (
                  <div
                    className="prose prose-lg prose-indigo prose-blog max-w-none scroll-smooth"
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                );
              })()
            ) : (
              <p className="py-10 text-center text-gray-400">본문이 준비 중입니다.</p>
            )}

            {/* 상품 CTA 카드 */}
            {pkg && (
              <aside className="not-prose mt-12 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white p-6 md:p-7">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-indigo-600">
                  이 글의 추천 상품
                </p>
                <h3 className="mt-2 text-lg font-bold leading-tight text-gray-900 md:text-xl">
                  {pkg.title}
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
                  {pkg.destination && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true">📍</span>
                      {pkg.destination}
                    </span>
                  )}
                  {durationStr && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true">📅</span>
                      {durationStr}
                    </span>
                  )}
                  {pkg.airline && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true">✈️</span>
                      {pkg.airline}
                    </span>
                  )}
                  {pkg.price && (
                    <span className="inline-flex items-center gap-1 font-semibold text-indigo-700">
                      <span aria-hidden="true">💰</span>
                      {pkg.price.toLocaleString()}원~
                    </span>
                  )}
                </div>
                <Link
                  href={`/packages/${pkg.id}`}
                  className="mt-5 inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                >
                  상품 상세 보기
                  <span aria-hidden="true">→</span>
                </Link>
              </aside>
            )}

            {/* 저자 박스 */}
            <AuthorBox
              publishedAt={post.published_at}
              updatedAt={post.updated_at}
              destination={pkg?.destination}
            />

            {/* 공유 버튼 */}
            <ShareButtons url={pageUrl} title={title} />

            {/* 정보성 블로그: destination 기반 큐레이션 상품 3개 (가격대 분산) */}
            {isInfoBlog && post.destination && curationProducts.length > 0 && (
              <DestinationCuration
                destination={post.destination}
                products={curationProducts.map((p: any) => ({
                  id: p.id,
                  title: p.title,
                  destination: p.destination,
                  duration: p.duration,
                  nights: p.nights,
                  price: p.price,
                  category: p.category,
                  hero_image_url: p.hero_image_url,
                  airline: p.airline,
                  departure_airport: p.departure_airport,
                }))}
              />
            )}

            {/* 참고 · 출처 */}
            <BlogCitations destination={pkg?.destination} airline={pkg?.airline ?? undefined} />
          </article>

          {/* 데스크톱 사이드바 — sticky TOC */}
          {showToc && (
            <aside className="hidden w-64 shrink-0 lg:block">
              <div className="sticky top-24">
                <TableOfContents items={toc} variant="desktop" />
              </div>
            </aside>
          )}
        </div>

        {/* 관련 글 섹션 */}
        {relatedPosts.length > 0 && (
          <section className="border-t bg-gray-50" aria-label="관련 여행 가이드">
            <div className="mx-auto max-w-6xl px-4 py-12">
              <div className="mb-6 flex items-end justify-between">
                <h2 className="text-xl font-bold text-gray-900 md:text-2xl">
                  함께 보면 좋은 여행 가이드
                </h2>
                <Link
                  href="/blog"
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  전체 보기 →
                </Link>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {relatedPosts.slice(0, 6).map((rp) => {
                  const rpTitle = (rp.seo_title || '여행 가이드')
                    .replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '')
                    .trim();
                  const rpDur = formatDuration(rp.travel_packages?.duration, rp.travel_packages?.nights);
                  return (
                    <Link
                      key={rp.id}
                      href={`/blog/${rp.slug}`}
                      className="group overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      {rp.og_image_url ? (
                        <div className="aspect-[16/9] overflow-hidden bg-gray-100">
                          <img
                            src={rp.og_image_url}
                            alt={rpTitle}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                      ) : (
                        <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
                          <span className="text-3xl" aria-hidden="true">
                            ✈️
                          </span>
                        </div>
                      )}
                      <div className="p-4">
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                          {rp.travel_packages?.destination && (
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                              {rp.travel_packages.destination}
                            </span>
                          )}
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                            {ANGLE_LABELS[rp.angle_type] || rp.angle_type}
                          </span>
                          {rpDur && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                              {rpDur}
                            </span>
                          )}
                        </div>
                        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900 group-hover:text-indigo-600 md:text-[15px]">
                          {rpTitle}
                        </h3>
                        {rp.travel_packages?.price && (
                          <p className="mt-2 text-xs font-semibold text-indigo-600">
                            {rp.travel_packages.price.toLocaleString()}원~
                          </p>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* 하단 네비 */}
        <div className="border-t bg-white">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm">
            <Link href="/blog" className="font-medium text-indigo-600 hover:text-indigo-800">
              ← 블로그 목록으로
            </Link>
          </div>
        </div>
      </main>

      {/* 상품 블로그 랜딩: 모바일 하단 고정 CTA (+15~25% 전환) */}
      {isLanding && pkg && (
        <StickyMobileCta
          priceKrw={pkg.price ?? null}
          productUrl={`/packages/${pkg.id}`}
        />
      )}
    </>
  );
}
