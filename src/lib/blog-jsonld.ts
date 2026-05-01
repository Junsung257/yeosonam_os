/**
 * Blog JSON-LD Builder — schema.org 구조화 데이터 자동 생성
 *
 * 지원 schema:
 *   - BlogPosting (기본)
 *   - FAQPage (Q. ... A. ... 패턴 자동 추출)
 *   - HowTo (3박4일 일정/Day 1~N 패턴 자동 추출)
 *   - TouristTrip (상품 블로그 — destination/duration/price 있을 때)
 *   - BreadcrumbList
 *
 * Why: rich snippet 노출 시 CTR 18-30% 상승. Naver는 표준 schema.org 미지원이지만
 *      Google에서 큰 효과 + Bing/Yandex/Daum 모두 인식.
 */

export interface FaqItem { q: string; a: string }

export interface HowToStep {
  name: string;
  text: string;
}

/**
 * FAQ 추출 — 다양한 마크다운 패턴 지원
 *   1) **Q. 질문** \n\n A. 답
 *   2) Q. 질문\nA. 답 (평문)
 *   3) ### Q. 질문 / 답
 */
export function extractFaqItems(blogHtml: string): FaqItem[] {
  const items: FaqItem[] = [];
  if (!blogHtml) return items;

  // 패턴 1: **Q. ...** \n\n A. ... (가장 정확)
  const re1 = /\*\*Q\.\s*(.+?)\*\*\s*\n+\s*A\.\s*([\s\S]+?)(?=\n\n\*\*Q\.|\n\n##|\n\n###|$)/g;
  let m;
  while ((m = re1.exec(blogHtml)) !== null) {
    items.push({ q: m[1].trim(), a: m[2].trim().slice(0, 800) });
  }

  // 패턴 2: ### Q. 질문 \n 답 (H3 형식)
  if (items.length === 0) {
    const re2 = /^###\s+Q\.?\s*(.+?)$\n+([\s\S]+?)(?=^###|^##|$)/gm;
    while ((m = re2.exec(blogHtml)) !== null) {
      items.push({ q: m[1].trim(), a: m[2].trim().slice(0, 800) });
    }
  }

  // 패턴 3: 평문 Q. ... \n A. ... (마지막 fallback)
  if (items.length === 0) {
    const re3 = /^Q\.?\s+(.+?)$\n+\s*A\.?\s+([\s\S]+?)(?=\n\nQ\.|\n##|$)/gm;
    while ((m = re3.exec(blogHtml)) !== null) {
      items.push({ q: m[1].trim(), a: m[2].trim().slice(0, 800) });
    }
  }

  return items.slice(0, 10);  // schema.org 권장 상한
}

/**
 * HowTo step 추출 — Day 1·Day 2·1일차·2일차 패턴
 */
export function extractHowToSteps(blogHtml: string): HowToStep[] {
  const steps: HowToStep[] = [];
  if (!blogHtml) return steps;

  // Day 1, Day 2... 또는 1일차, 2일차...
  const re = /^##?#?\s+(?:Day\s*(\d+)|(\d+)\s*일차)[\s:·\-—]+(.+?)$\n+([\s\S]+?)(?=^##?\s*(?:Day\s*\d+|\d+\s*일차)|^##|$)/gm;
  let m;
  while ((m = re.exec(blogHtml)) !== null) {
    const dayNum = m[1] || m[2];
    const title = m[3].trim();
    const content = m[4].trim().slice(0, 500);
    steps.push({
      name: `Day ${dayNum}: ${title}`,
      text: content,
    });
    if (steps.length >= 14) break;
  }

  return steps;
}

interface BuildOptions {
  title: string;
  description: string;
  url: string;
  publishedAt: string | null;
  modifiedAt?: string | null;
  authorName?: string;
  imageUrl?: string | null;
  blogHtml: string;
  destination?: string | null;
  duration?: number | null;
  price?: number | null;
  productId?: string | null;
}

interface JsonLdBundle {
  blogPosting: object;
  faqPage: object | null;
  howTo: object | null;
  touristTrip: object | null;
}

/**
 * 블로그 1글 → JSON-LD 번들 생성
 */
export function buildBlogJsonLd(opts: BuildOptions): JsonLdBundle {
  const blogPosting = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: opts.title,
    description: opts.description,
    image: opts.imageUrl ? [opts.imageUrl] : undefined,
    author: {
      '@type': 'Organization',
      name: opts.authorName || '여소남',
      url: 'https://yeosonam.com',
    },
    publisher: {
      '@type': 'Organization',
      name: '여소남',
      logo: {
        '@type': 'ImageObject',
        url: 'https://yeosonam.com/logo.png',
      },
    },
    datePublished: opts.publishedAt,
    dateModified: opts.modifiedAt || opts.publishedAt,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': opts.url,
    },
  };

  // FAQ
  const faqItems = extractFaqItems(opts.blogHtml);
  const faqPage = faqItems.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(faq => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.a,
      },
    })),
  } : null;

  // HowTo (일정 블로그용)
  const howToSteps = extractHowToSteps(opts.blogHtml);
  const howTo = howToSteps.length >= 3 ? {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: opts.title,
    description: opts.description,
    image: opts.imageUrl,
    estimatedCost: opts.price ? {
      '@type': 'MonetaryAmount',
      currency: 'KRW',
      value: opts.price,
    } : undefined,
    totalTime: opts.duration ? `P${opts.duration - 1}DT0H` : undefined,
    step: howToSteps.map((s, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      name: s.name,
      text: s.text,
    })),
  } : null;

  // TouristTrip (상품 블로그용)
  const touristTrip = (opts.productId && opts.destination) ? {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: opts.title,
    description: opts.description,
    image: opts.imageUrl,
    touristType: '한국 여행자',
    itinerary: {
      '@type': 'ItemList',
      itemListElement: howToSteps.length > 0 ? howToSteps.map((s, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        name: s.name,
      })) : undefined,
    },
    offers: opts.price ? {
      '@type': 'Offer',
      url: `https://yeosonam.com/packages/${opts.productId}`,
      priceCurrency: 'KRW',
      price: opts.price,
      availability: 'https://schema.org/InStock',
    } : undefined,
    provider: {
      '@type': 'Organization',
      name: '여소남',
      url: 'https://yeosonam.com',
    },
  } : null;

  return { blogPosting, faqPage, howTo, touristTrip };
}
