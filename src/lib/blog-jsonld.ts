import type { BlogPosting, BreadcrumbList, FAQPage, HowTo, Product, TouristTrip, WithContext } from 'schema-dts';
import { normalizeJsonLdText, normalizeJsonLdUrl } from './json-ld';

export interface FaqItem { q: string; a: string }
export interface HowToStep { name: string; text: string }

export interface BlogJsonLdPackageLite {
  id: string;
  title: string;
  destination: string;
  price: number | null;
  isCurrentlyAvailable?: boolean;
}

export function extractFaqItems(markdown: string): FaqItem[] {
  if (!markdown) return [];
  const items: FaqItem[] = [];
  const patterns = [
    /\*\*Q\d{0,2}[.:]\s*(.+?)\*\*\s*\n+\s*A[.:]\s*([\s\S]+?)(?=\n\n\*\*Q\d{0,2}[.:]|\n\n##|\n\n###|$)/g,
    /^###\s+Q\d{0,2}[.:]?\s*(.+?)$\n+([\s\S]+?)(?=^###|^##|$)/gm,
    /^Q\d{0,2}[.:]?\s+(.+?)$\n+\s*A[.:]?\s+([\s\S]+?)(?=\n\nQ\d{0,2}[.:]|\n##|$)/gm,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(markdown)) !== null) {
      items.push({
        q: normalizeJsonLdText(match[1], 240),
        a: normalizeJsonLdText(match[2], 800),
      });
      if (items.length >= 10) return items;
    }
    if (items.length) break;
  }
  return items;
}

export function extractHowToSteps(markdown: string): HowToStep[] {
  if (!markdown) return [];
  const steps: HowToStep[] = [];
  const pattern = /^#{2,3}\s+(?:Day\s*(\d+)|(\d+)\s*일차)[\s:·\-–]+(.+?)$\n+([\s\S]+?)(?=^#{2,3}\s*(?:Day\s*\d+|\d+\s*일차)|^##|$)/gim;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null && steps.length < 14) {
    steps.push({
      name: normalizeJsonLdText(`Day ${match[1] || match[2]}: ${match[3]}`, 160),
      text: normalizeJsonLdText(match[4], 500),
    });
  }
  return steps;
}

export interface BlogPostPageJsonLdInput {
  baseUrl: string;
  pageUrl: string;
  title: string;
  description: string;
  publishedAt: string;
  modifiedAt: string | null;
  ogImageUrl: string | null;
  blogHtmlMarkdown: string;
  bodyHtmlForWordCount: string;
  readingMinutes: number;
  angleLabel: string;
  pkg: BlogJsonLdPackageLite | null;
  durationStr: string;
  productDurationDays?: number | null;
  includeFaqSchema?: boolean;
  includeHowToSchema?: boolean;
  includeTouristTripSchema?: boolean;
  authorProfile?: { name: string; url: string } | null;
  reviewer?: { name: string; url?: string | null; reviewedAt: string; scope: string } | null;
}

export interface BlogPostPageJsonLdBundle {
  blogPosting: WithContext<BlogPosting>;
  breadcrumbList: WithContext<BreadcrumbList>;
  faqPage: WithContext<FAQPage> | null;
  howTo: WithContext<HowTo> | null;
  touristTrip: WithContext<TouristTrip> | null;
  product: WithContext<Product> | null;
}

export function buildBlogPostPageJsonLd(input: BlogPostPageJsonLdInput): BlogPostPageJsonLdBundle {
  const safeBase = normalizeJsonLdUrl(input.baseUrl, { fallback: 'https://www.yeosonam.com' })
    || 'https://www.yeosonam.com';
  const baseUrl = new URL(safeBase).origin;
  const pageUrl = normalizeJsonLdUrl(input.pageUrl, { fallback: `${baseUrl}/blog`, allowedOrigin: baseUrl })
    || `${baseUrl}/blog`;
  const title = normalizeJsonLdText(input.title, 110, '여소남 여행 정보');
  const description = normalizeJsonLdText(input.description, 500, title);
  const publishedAt = normalizeJsonLdText(input.publishedAt, 64, '1970-01-01T00:00:00.000Z');
  const modifiedAt = input.modifiedAt ? normalizeJsonLdText(input.modifiedAt, 64, publishedAt) : publishedAt;
  const image = normalizeJsonLdUrl(input.ogImageUrl, { fallback: `${baseUrl}/og-image.png` });
  const faqItems = input.includeFaqSchema ? extractFaqItems(input.blogHtmlMarkdown) : [];
  const steps = input.includeHowToSchema || input.includeTouristTripSchema
    ? extractHowToSteps(input.blogHtmlMarkdown)
    : [];

  const author = input.authorProfile
    ? { '@type': 'Person' as const, name: input.authorProfile.name, url: input.authorProfile.url }
    : { '@type': 'Organization' as const, name: '여소남', url: baseUrl };
  const blogPosting = ({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description,
    image,
    datePublished: publishedAt,
    dateModified: modifiedAt,
    inLanguage: 'ko-KR',
    wordCount: input.bodyHtmlForWordCount.replace(/<[^>]+>/g, '').trim().length,
    timeRequired: `PT${Math.max(1, Math.round(input.readingMinutes || 1))}M`,
    articleSection: normalizeJsonLdText(input.angleLabel, 80, '여행 정보'),
    author,
    ...(input.reviewer ? {
      reviewedBy: {
        '@type': 'Person',
        name: input.reviewer.name,
        ...(input.reviewer.url ? { url: input.reviewer.url } : {}),
      },
    } : {}),
    publisher: {
      '@type': 'Organization',
      name: '여소남',
      logo: { '@type': 'ImageObject', url: `${baseUrl}/logo.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
  } as WithContext<BlogPosting>);

  const breadcrumbList = ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '홈', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: '블로그', item: `${baseUrl}/blog` },
      ...(input.pkg?.destination ? [
        { '@type': 'ListItem' as const, position: 3, name: input.pkg.destination, item: `${baseUrl}/blog/destination/${encodeURIComponent(input.pkg.destination)}` },
        { '@type': 'ListItem' as const, position: 4, name: title, item: pageUrl },
      ] : [{ '@type': 'ListItem' as const, position: 3, name: title, item: pageUrl }]),
    ],
  } as WithContext<BreadcrumbList>);

  const faqPage = faqItems.length ? ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question', name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  } as WithContext<FAQPage>) : null;

  const howTo = input.includeHowToSchema && steps.length >= 3 ? ({
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    description,
    image,
    step: steps.map((step, index) => ({
      '@type': 'HowToStep', position: index + 1, name: step.name, text: step.text,
    })),
  } as WithContext<HowTo>) : null;

  const pkg = input.pkg;
  const touristTrip = input.includeTouristTripSchema && pkg?.isCurrentlyAvailable === true && pkg.destination
    ? ({
        '@context': 'https://schema.org', '@type': 'TouristTrip', name: pkg.title,
        description, image, touristType: '여행자',
        ...(steps.length ? { itinerary: { '@type': 'ItemList', itemListElement: steps.map((step, index) => ({ '@type': 'ListItem', position: index + 1, name: step.name })) } } : {}),
        ...(pkg.price != null ? { offers: { '@type': 'Offer', url: `${baseUrl}/packages/${encodeURIComponent(pkg.id)}`, price: pkg.price, priceCurrency: 'KRW', availability: 'https://schema.org/InStock' } } : {}),
      } as WithContext<TouristTrip>)
    : null;

  const product = pkg?.isCurrentlyAvailable === true && pkg.price != null ? ({
    '@context': 'https://schema.org', '@type': 'Product', name: pkg.title, description: description,
    category: pkg.destination,
    offers: {
      '@type': 'Offer', price: pkg.price, priceCurrency: 'KRW', availability: 'https://schema.org/InStock',
      url: `${baseUrl}/packages/${encodeURIComponent(pkg.id)}`,
      seller: { '@type': 'Organization', name: '여소남' },
    },
  } as WithContext<Product>) : null;

  return { blogPosting, breadcrumbList, faqPage, howTo, touristTrip, product };
}
