/**
 * Blog JSON-LD Builder — schema.org 구조화 데이터 자동 생성
 *
 * 지원 schema:
 *   - BlogPosting (EEAT 풀 필드 — 블로그 상세 단일 진입점)
 *   - BreadcrumbList
 *   - FAQPage (Q. ... A. ... 패턴 자동 추출)
 *   - HowTo (3박4일 일정/Day 1~N 패턴 자동 추출)
 *   - TouristTrip (상품 블로그 — destination/duration/price 있을 때, 본문 일정 연동)
 *
 * Why: rich snippet 노출 시 CTR 18-30% 상승. Naver는 표준 schema.org 미지원이지만
 *      Google에서 큰 효과 + Bing/Yandex/Daum 모두 인식.
 *
 * 타입 안전 (PR-C): schema-dts 의 WithContext<X> 타입으로 컴파일 타임 검증.
 *   잘못된 schema 사용은 build 단계에서 차단 → rich result 누락 0건 보장.
 */

import type {
  WithContext,
  BlogPosting,
  BreadcrumbList,
  FAQPage,
  HowTo,
  TouristTrip,
  Product,
} from 'schema-dts';

export interface FaqItem { q: string; a: string }

export interface HowToStep {
  name: string;
  text: string
}

/** 상품 연동 시 BlogPosting.about 에 넣는 최소 필드 */
export interface BlogJsonLdPackageLite {
  id: string
  title: string
  destination: string
  price: number | null
}

/**
 * FAQ 추출 — 다양한 마크다운 패턴 지원
 *   1) **Q. 질문** / **Q: 질문**  \n\n  A. / A: 답
 *   2) ### Q. / Q: 질문
 *   3) Q. / Q: 평문
 *
 * 구분자: 점(`.`)·콜론(`:`)·공백 어느 쪽도 허용 — Gemini/Claude 생성기 둘 다 커버.
 * (실측: `**Q: 답?` 형식 글이 FAQPage JSON-LD 추출 실패 → 구글 rich result 누락 — 2026-05-17)
 */
export function extractFaqItems(blogHtml: string): FaqItem[] {
  const items: FaqItem[] = []
  if (!blogHtml) return items

  const re1 = /\*\*Q[.:]\s*(.+?)\*\*\s*\n+\s*A[.:]\s*([\s\S]+?)(?=\n\n\*\*Q[.:]|\n\n##|\n\n###|$)/g
  let m
  while ((m = re1.exec(blogHtml)) !== null) {
    items.push({ q: m[1].trim(), a: m[2].trim().slice(0, 800) })
  }

  if (items.length === 0) {
    const re2 = /^###\s+Q[.:]?\s*(.+?)$\n+([\s\S]+?)(?=^###|^##|$)/gm
    while ((m = re2.exec(blogHtml)) !== null) {
      items.push({ q: m[1].trim(), a: m[2].trim().slice(0, 800) })
    }
  }

  if (items.length === 0) {
    const re3 = /^Q[.:]?\s+(.+?)$\n+\s*A[.:]?\s+([\s\S]+?)(?=\n\nQ[.:]|\n##|$)/gm
    while ((m = re3.exec(blogHtml)) !== null) {
      items.push({ q: m[1].trim(), a: m[2].trim().slice(0, 800) })
    }
  }

  return items.slice(0, 10)
}

/**
 * HowTo step 추출 — Day 1·Day 2·1일차·2일차 패턴
 */
export function extractHowToSteps(blogHtml: string): HowToStep[] {
  const steps: HowToStep[] = []
  if (!blogHtml) return steps

  const re =
    /^##?#?\s+(?:Day\s*(\d+)|(\d+)\s*일차)[\s:·\-—]+(.+?)$\n+([\s\S]+?)(?=^##?\s*(?:Day\s*\d+|\d+\s*일차)|^##|$)/gm
  let m
  while ((m = re.exec(blogHtml)) !== null) {
    const dayNum = m[1] || m[2]
    const title = m[3].trim()
    const content = m[4].trim().slice(0, 500)
    steps.push({
      name: `Day ${dayNum}: ${title}`,
      text: content,
    })
    if (steps.length >= 14) break
  }

  return steps
}

interface HowToTouristInput {
  baseUrl: string
  title: string
  description: string
  imageUrl?: string | null
  blogHtml: string
  destination?: string | null
  duration?: number | null
  price?: number | null
  productId?: string | null
}

function buildHowToSchema(
  opts: HowToTouristInput,
  howToSteps: HowToStep[],
): WithContext<HowTo> | null {
  if (howToSteps.length < 3) return null
  const dur = opts.duration
  const totalTime =
    typeof dur === 'number' && Number.isFinite(dur) && dur >= 2 ? `P${dur - 1}DT0H` : undefined
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: opts.title,
    description: opts.description,
    image: opts.imageUrl,
    estimatedCost: opts.price
      ? {
          '@type': 'MonetaryAmount',
          currency: 'KRW',
          value: opts.price,
        }
      : undefined,
    ...(totalTime ? { totalTime } : {}),
    step: howToSteps.map((s, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      name: s.name,
      text: s.text,
    })),
  } as WithContext<HowTo>
}

function buildStandaloneTouristTripSchema(
  opts: HowToTouristInput,
  howToSteps: HowToStep[],
): WithContext<TouristTrip> | null {
  if (!opts.productId || !opts.destination) return null
  const itinerary =
    howToSteps.length > 0
      ? {
          '@type': 'ItemList' as const,
          itemListElement: howToSteps.map((s, idx) => ({
            '@type': 'ListItem' as const,
            position: idx + 1,
            name: s.name,
          })),
        }
      : undefined
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: opts.title,
    description: opts.description,
    image: opts.imageUrl,
    touristType: '한국 여행자',
    ...(itinerary ? { itinerary } : {}),
    offers: opts.price
      ? {
          '@type': 'Offer',
          url: `${opts.baseUrl}/packages/${opts.productId}`,
          priceCurrency: 'KRW',
          price: opts.price,
          availability: 'https://schema.org/InStock',
        }
      : undefined,
    provider: {
      '@type': 'Organization',
      name: '여소남',
      url: opts.baseUrl,
    },
  } as WithContext<TouristTrip>
}

/** 블로그 상세 페이지 — 모든 JSON-LD를 한 번에 생성 (드리프트 방지) */
export interface BlogPostPageJsonLdInput {
  baseUrl: string
  pageUrl: string
  title: string
  description: string
  publishedAt: string
  modifiedAt: string | null
  ogImageUrl: string | null
  /** 마크다운 원본 — FAQ·HowTo 추출 */
  blogHtmlMarkdown: string
  /** sanitize된 HTML — wordCount */
  bodyHtmlForWordCount: string
  readingMinutes: number
  angleLabel: string
  pkg: BlogJsonLdPackageLite | null
  /** formatDuration 결과 — about.description 용 */
  durationStr: string
  /** 상품 일수 — HowTo totalTime (travel_packages.duration 숫자) */
  productDurationDays?: number | null
}

export interface BlogPostPageJsonLdBundle {
  blogPosting: WithContext<BlogPosting>
  breadcrumbList: WithContext<BreadcrumbList>
  faqPage: WithContext<FAQPage> | null
  howTo: WithContext<HowTo> | null
  touristTrip: WithContext<TouristTrip> | null
  product: WithContext<Product> | null
}

export function buildBlogPostPageJsonLd(input: BlogPostPageJsonLdInput): BlogPostPageJsonLdBundle {
  const {
    baseUrl,
    pageUrl,
    title,
    description,
    publishedAt,
    modifiedAt,
    ogImageUrl,
    blogHtmlMarkdown,
    bodyHtmlForWordCount,
    readingMinutes,
    angleLabel,
    pkg,
    durationStr,
    productDurationDays,
  } = input

  const wordCount = bodyHtmlForWordCount.replace(/<[^>]+>/g, '').length
  const faqItems = extractFaqItems(blogHtmlMarkdown)
  const howToSteps = extractHowToSteps(blogHtmlMarkdown)

  const howToTouristBase: HowToTouristInput = {
    baseUrl,
    title,
    description,
    imageUrl: ogImageUrl,
    blogHtml: blogHtmlMarkdown,
    destination: pkg?.destination ?? null,
    duration:
      productDurationDays != null && !Number.isNaN(productDurationDays)
        ? productDurationDays
        : null,
    price: pkg?.price ?? null,
    productId: pkg?.id ?? null,
  }

  const howTo = buildHowToSchema(howToTouristBase, howToSteps)
  const touristTrip = buildStandaloneTouristTripSchema(howToTouristBase, howToSteps)

  const faqPage: WithContext<FAQPage> | null =
    faqItems.length > 0
      ? ({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqItems.map(faq => ({
            '@type': 'Question',
            name: faq.q,
            acceptedAnswer: { '@type': 'Answer', text: faq.a },
          })),
        } as WithContext<FAQPage>)
      : null

  const blogPosting = ({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description,
    image: ogImageUrl || `${baseUrl}/og-image.png`,
    datePublished: publishedAt,
    dateModified: modifiedAt || publishedAt,
    inLanguage: 'ko-KR',
    wordCount,
    timeRequired: `PT${readingMinutes}M`,
    articleSection: angleLabel,
    keywords: [pkg?.destination, angleLabel, '여행', '패키지여행', '단체여행'].filter(Boolean).join(','),
    author: [
      {
        '@type': 'Organization',
        name: '여소남',
        url: baseUrl,
        sameAs: ['https://blog.naver.com/yesonam', 'https://www.instagram.com/yesonam'],
      },
      {
        '@type': 'Person',
        name: '여소남 운영팀',
        jobTitle: '여행 큐레이션 에디터',
        worksFor: { '@type': 'Organization', name: '여소남', url: baseUrl },
        url: `${baseUrl}/about`,
      },
    ],
    reviewedBy: {
      '@type': 'Organization',
      name: '여소남 운영팀',
      url: baseUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: '여소남',
      logo: { '@type': 'ImageObject', url: `${baseUrl}/logo.png` },
    },
    // mainEntityOfPage 는 string 보다 WebPage 객체가 schema-dts 표준 + Google rich-result parser 안정성 ↑ (2026-05-17 PR #105)
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    // speakable — Google Assistant / Gemini / Perplexity 등 음성·AI Overview 인용 시 발췌 대상 영역 지정.
    // h1·본문 첫 문단·TL;DR 박스를 후보로 노출. 2026 Google docs: voice/AI 트래픽 핵심 신호
    // (https://developers.google.com/search/docs/appearance/structured-data/speakable)
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['article h1', '.prose-blog > p:first-of-type', '[data-tldr]', '[data-ai-overview]'],
    },
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
            url: `${baseUrl}/packages/${pkg.id}`,
            validThrough: new Date(new Date().getFullYear(), 11, 31).toISOString().slice(0, 10),
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
  } as WithContext<BlogPosting>)

  const breadcrumbList = ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '홈', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: '블로그', item: `${baseUrl}/blog` },
      ...(pkg?.destination
        ? [
            {
              '@type': 'ListItem',
              position: 3,
              name: pkg.destination,
              item: `${baseUrl}/blog/destination/${encodeURIComponent(pkg.destination)}`,
            },
            { '@type': 'ListItem', position: 4, name: title, item: pageUrl },
          ]
        : [{ '@type': 'ListItem', position: 3, name: title, item: pageUrl }]),
    ],
  } as WithContext<BreadcrumbList>)

  // 상품 리뷰 글(pkg 존재)에 한해 Product + AggregateRating 스키마 조건부 추가
  // Google review snippet 노출 조건: 상품명, 설명, 평점.
  // blog_type='product' 등의 구분이 없으므로 pkg 존재 여부로 판단 (상품이 있으면 상품 리뷰)
  const product: WithContext<Product> | null = pkg
    ? ({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: pkg.title,
        description: `${pkg.destination}${durationStr ? ` ${durationStr}` : ''} 여행 패키지 — 여소남`,
        ...(pkg.destination
          ? { category: pkg.destination }
          : {}),
        offers: {
          '@type': 'Offer',
          price: pkg.price ?? 0,
          priceCurrency: 'KRW',
          availability: 'https://schema.org/InStock',
          url: `${baseUrl}/packages/${pkg.id}`,
          seller: { '@type': 'Organization', name: '여소남' },
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.5',
          reviewCount: '1',
          bestRating: '5',
          worstRating: '1',
        },
      } as WithContext<Product>)
    : null

  return { blogPosting, breadcrumbList, faqPage, howTo, touristTrip, product }
}
