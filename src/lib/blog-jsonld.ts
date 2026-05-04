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
 */

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
 *   1) **Q. 질문** \n\n A. 답
 *   2) Q. 질문\nA. 답 (평문)
 *   3) ### Q. 질문 / 답
 */
export function extractFaqItems(blogHtml: string): FaqItem[] {
  const items: FaqItem[] = []
  if (!blogHtml) return items

  const re1 = /\*\*Q\.\s*(.+?)\*\*\s*\n+\s*A\.\s*([\s\S]+?)(?=\n\n\*\*Q\.|\n\n##|\n\n###|$)/g
  let m
  while ((m = re1.exec(blogHtml)) !== null) {
    items.push({ q: m[1].trim(), a: m[2].trim().slice(0, 800) })
  }

  if (items.length === 0) {
    const re2 = /^###\s+Q\.?\s*(.+?)$\n+([\s\S]+?)(?=^###|^##|$)/gm
    while ((m = re2.exec(blogHtml)) !== null) {
      items.push({ q: m[1].trim(), a: m[2].trim().slice(0, 800) })
    }
  }

  if (items.length === 0) {
    const re3 = /^Q\.?\s+(.+?)$\n+\s*A\.?\s+([\s\S]+?)(?=\n\nQ\.|\n##|$)/gm
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
): object | null {
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
  }
}

function buildStandaloneTouristTripSchema(
  opts: HowToTouristInput,
  howToSteps: HowToStep[],
): object | null {
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
  }
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
  blogPosting: object
  breadcrumbList: object
  faqPage: object | null
  howTo: object | null
  touristTrip: object | null
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

  const faqPage =
    faqItems.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqItems.map(faq => ({
            '@type': 'Question',
            name: faq.q,
            acceptedAnswer: { '@type': 'Answer', text: faq.a },
          })),
        }
      : null

  const blogPosting: object = {
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
  }

  const breadcrumbList: object = {
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
  }

  return { blogPosting, breadcrumbList, faqPage, howTo, touristTrip }
}
