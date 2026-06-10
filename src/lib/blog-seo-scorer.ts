/**
 * Blog SEO score engine.
 *
 * This is a publish-time quality gate, not a loose diagnostics widget.
 * New auto-published posts should clear a high bar before they can be indexed.
 */

const SEMANTIC_DICTIONARY: Record<string, string[]> = {
  destination: ['여행', '목적지', '방문', '현지', '출발', '일정'],
  transport: ['항공권', '비행기', '공항', '기차', '버스', '픽업', '교통', '이동'],
  accommodation: ['숙소', '호텔', '리조트', '객실', '위치', '조식'],
  food: ['맛집', '식사', '음식', '레스토랑', '현지식', '먹거리'],
  weather: ['날씨', '기온', '계절', '우기', '건기', '옷차림', '월별'],
  currency: ['환전', '환율', '달러', '카드', '현금', '결제'],
  document: ['비자', '여권', '입국', '서류', '면세', '검역'],
  planning: ['준비물', '체크리스트', '예약', '포함사항', '주의사항', '예산'],
  communication: ['통신', '와이파이', '유심', 'esim', '로밍', '인터넷'],
  cost: ['가격', '비용', '경비', '예산', '요금', '할인', '특가', '가성비'],
};

const AUTHORITATIVE_HOST_HINTS = [
  '.go.kr',
  '.gov',
  'mofa.go.kr',
  '0404.go.kr',
  'visit',
  'tourism',
  'weather',
  'airport',
  'immigration',
  'embassy',
  'consulate',
  'iata.org',
  'iatatravelcentre.com',
  'who.int',
  'japan.travel',
  'travel-europe.europa.eu',
  'travel.state.gov',
  'cbp.dhs.gov',
];

export const BLOG_SEO_MAX_SCORE = 100;
export const BLOG_SEO_MIN_SCORE = {
  info: 85,
  product: 80,
} as const;

export interface SeoScoreResult {
  score: number;
  maxScore: number;
  passed: boolean;
  details: SeoScoreDetail[];
  summary: string;
  checkedAt: string;
}

export interface SeoScoreDetail {
  name: string;
  score: number;
  maxScore: number;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface ScorerInput {
  blogHtml: string;
  slug: string;
  seoTitle?: string;
  seoDescription?: string;
  primaryKeyword?: string | null;
  secondaryKeywords?: string[];
  destination?: string | null;
  blogType: 'product' | 'info';
  imageCount?: number;
  imagesWithAlt?: number;
  hasJsonLd?: {
    blogPosting?: boolean;
    faqPage?: boolean;
    howTo?: boolean;
    breadcrumbList?: boolean;
  };
}

function clampScore(score: number, max: number): number {
  return Math.max(0, Math.min(max, score));
}

function detail(
  name: string,
  score: number,
  maxScore: number,
  passAt: number,
  warnAt: number,
  message: string,
): SeoScoreDetail {
  const safeScore = clampScore(score, maxScore);
  return {
    name,
    score: safeScore,
    maxScore,
    status: safeScore >= passAt ? 'pass' : safeScore >= warnAt ? 'warn' : 'fail',
    message,
  };
}

function stripMarkdownAndHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)]\([^)]+\)/g, ' $1 ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, ' $1 ')
    .replace(/[#*_`>|=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractImages(markdownOrHtml: string): Array<{ alt: string; src: string }> {
  const images: Array<{ alt: string; src: string }> = [];
  const mdRe = /!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let mdMatch: RegExpExecArray | null;
  while ((mdMatch = mdRe.exec(markdownOrHtml)) !== null) {
    images.push({ alt: mdMatch[1] || '', src: mdMatch[2] || '' });
  }

  const htmlRe = /<img\b[^>]*>/gi;
  const attrRe = /\s(alt|src)=["']([^"']*)["']/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlRe.exec(markdownOrHtml)) !== null) {
    const tag = htmlMatch[0];
    const attrs: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(tag)) !== null) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
    }
    images.push({ alt: attrs.alt || '', src: attrs.src || '' });
  }

  return images;
}

function extractLinks(markdownOrHtml: string): string[] {
  const links: string[] = [];
  const mdRe = /(?<!!)\[[^\]]+]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let mdMatch: RegExpExecArray | null;
  while ((mdMatch = mdRe.exec(markdownOrHtml)) !== null) links.push(mdMatch[1]);

  const htmlRe = /<a\b[^>]*\shref=["']([^"']+)["'][^>]*>/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlRe.exec(markdownOrHtml)) !== null) links.push(htmlMatch[1]);

  return [...new Set(links.filter(Boolean))];
}

function countOccurrences(text: string, keyword: string): number {
  if (!keyword) return 0;
  const variants = [
    keyword,
    keyword.replace(/[-_]+/g, ' '),
    keyword.replace(/[-_\s]+/g, ''),
  ]
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return Math.max(
    ...[...new Set(variants)].map((variant) => {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (text.match(new RegExp(escaped, 'gi')) || []).length;
    }),
  );
}

function scoreTitle(input: ScorerInput, keyword: string, dest: string): SeoScoreDetail {
  const title = input.seoTitle?.trim() || '';
  let score = 0;
  const messages: string[] = [];

  if (title.length >= 25 && title.length <= 60) score += 4;
  else if (title.length >= 15 && title.length <= 70) score += 2;
  messages.push(`title ${title.length}자`);

  if (keyword && title.includes(keyword)) score += 3;
  if (dest && dest !== keyword && title.includes(dest)) score += 1;
  if (/\b20\d{2}\b|최신|월별|비용|일정|준비물|가격|코스|날씨|체크리스트/.test(title)) score += 3;
  if (!/(완벽|끝판왕|무조건|충격|대박|실화)/.test(title)) score += 1;

  return detail('title', score, 12, 10, 6, messages.join(', '));
}

function scoreMeta(input: ScorerInput, keyword: string): SeoScoreDetail {
  const desc = input.seoDescription?.trim() || '';
  let score = 0;
  const messages: string[] = [`description ${desc.length}자`];

  if (desc.length >= 70 && desc.length <= 160) score += 4;
  else if (desc.length >= 50 && desc.length <= 180) score += 2;
  if (keyword && desc.includes(keyword)) score += 3;
  if (/\d|비용|일정|준비|예약|포함|날씨|월별|체크/.test(desc)) score += 2;
  if (desc && desc !== input.seoTitle) score += 1;

  return detail('meta_description', score, 10, 8, 5, messages.join(', '));
}

function scoreHeadings(input: ScorerInput, keyword: string, dest: string): SeoScoreDetail {
  const text = input.blogHtml;
  const h1 = text.match(/^#\s+.+$/gm) || [];
  const h2 = text.match(/^##\s+.+$/gm) || [];
  let score = 0;
  const expected = input.blogType === 'info' ? { min: 5, max: 9 } : { min: 3, max: 7 };

  if (h1.length === 1) score += 3;
  if (h2.length >= expected.min && h2.length <= expected.max) score += 3;
  else if (h2.length >= 2) score += 1;

  const headingText = [...h1, ...h2].join(' ');
  if (keyword && headingText.includes(keyword)) score += 2;
  if ((dest && headingText.includes(dest)) || /[?？]|비용|일정|준비물|날씨|FAQ|자주 묻는 질문/.test(headingText)) score += 2;

  return detail('heading_structure', score, 10, 8, 5, `H1 ${h1.length}개, H2 ${h2.length}개`);
}

function scorePrimaryKeyword(plainText: string, keyword: string, blogType: 'product' | 'info'): SeoScoreDetail {
  if (!keyword) return detail('primary_keyword', 2, 8, 6, 3, 'primary keyword 없음');
  const count = countOccurrences(plainText, keyword);
  const density = plainText.length > 0 ? (count * keyword.length / plainText.length) * 100 : 0;
  const min = blogType === 'product' ? 0.45 : 0.35;
  const max = blogType === 'product' ? 2.8 : 2.2;
  let score = 0;

  if (density >= min && density <= max) score = 8;
  else if (density > 0 && density <= max + 0.6) score = 5;
  else if (count > 0) score = 2;

  return detail('primary_keyword', score, 8, 7, 4, `${keyword} ${count}회, density ${density.toFixed(2)}%`);
}

function scoreSemanticCoverage(plainText: string, secondaryKeywords?: string[]): SeoScoreDetail {
  let score = 0;
  const matchedGroups: string[] = [];
  for (const [group, words] of Object.entries(SEMANTIC_DICTIONARY)) {
    const hits = words.filter((word) => plainText.includes(word));
    if (hits.length >= 2) {
      matchedGroups.push(group);
      score += 1;
    }
  }

  const secondary = (secondaryKeywords || []).filter(Boolean).slice(0, 8);
  const secondaryHits = secondary.filter((keyword) => plainText.includes(keyword)).length;
  if (secondary.length > 0) {
    score += Math.min(3, Math.round((secondaryHits / secondary.length) * 3));
  } else {
    score += Math.min(2, Math.floor(matchedGroups.length / 3));
  }

  return detail(
    'semantic_longtail_coverage',
    score,
    8,
    6,
    3,
    `semantic groups ${matchedGroups.length}, secondary ${secondaryHits}/${secondary.length}`,
  );
}

function scoreImages(input: ScorerInput, keyword: string, dest: string): SeoScoreDetail {
  const images = extractImages(input.blogHtml);
  const imageCount = input.imageCount ?? images.length;
  const altCount = input.imagesWithAlt ?? images.filter((image) => image.alt.trim().length >= 3).length;
  const altText = images.map((image) => image.alt).join(' ');
  let score = 0;

  if (imageCount >= 3) score += 3;
  else if (imageCount >= 2) score += 2;
  else if (imageCount >= 1) score += 1;

  if (imageCount > 0 && altCount / imageCount >= 0.9) score += 3;
  else if (altCount > 0) score += 1;

  if ((keyword && altText.includes(keyword)) || (dest && altText.includes(dest))) score += 1;
  if (images.some((image) => /pexels|supabase|images\.unsplash|cdn/i.test(image.src))) score += 1;

  return detail('image_seo', score, 8, 7, 4, `images ${imageCount}, alt ${altCount}`);
}

function scoreInternalLinks(blogHtml: string): SeoScoreDetail {
  const links = extractLinks(blogHtml);
  const internal = links.filter((href) => href.startsWith('/') || /yeosonam\.com/i.test(href));
  const cta = internal.filter((href) => /\/packages|utm_|kakao|consult|문의|예약/i.test(href));
  let score = 0;

  if (internal.length >= 3) score += 4;
  else if (internal.length >= 2) score += 3;
  else if (internal.length >= 1) score += 1;
  if (cta.length >= 2) score += 3;
  else if (cta.length >= 1) score += 1;

  return detail('internal_links_cta', score, 7, 6, 3, `internal ${internal.length}, cta ${cta.length}`);
}

function scoreExternalLinks(blogHtml: string): SeoScoreDetail {
  const links = extractLinks(blogHtml);
  const external = links.filter((href) => /^https?:\/\//i.test(href) && !/yeosonam\.com/i.test(href));
  const authority = external.filter((href) => {
    try {
      const host = new URL(href).hostname.toLowerCase();
      return AUTHORITATIVE_HOST_HINTS.some((hint) => host.includes(hint));
    } catch {
      return false;
    }
  });
  let score = 0;
  if (external.length >= 2) score += 3;
  else if (external.length >= 1) score += 1;
  if (authority.length >= 1) score += 3;

  return detail('external_authority_links', score, 6, 5, 2, `external ${external.length}, authority ${authority.length}`);
}

function scoreReadability(blogHtml: string, plainText: string): SeoScoreDetail {
  const sentences = plainText.split(/[.!?。！？]\s*|\n+/).filter((sentence) => sentence.trim().length >= 8);
  const avgSentenceLength = sentences.length > 0
    ? sentences.reduce((sum, sentence) => sum + sentence.trim().length, 0) / sentences.length
    : 0;
  const paragraphs = blogHtml.split(/\n{2,}/).filter((paragraph) => stripMarkdownAndHtml(paragraph).length >= 30);
  const listItems = (blogHtml.match(/(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g) || []).length;
  const tableRows = (blogHtml.match(/(^|\n)\s*\|.+\|/g) || []).length;
  let score = 0;

  if (avgSentenceLength >= 20 && avgSentenceLength <= 80) score += 2;
  if (paragraphs.length >= 5) score += 2;
  if (listItems >= 2 || tableRows >= 2) score += 2;
  if (!/!\[[^\]]*]\(|\[[^\]]+]\(https?:\/\/|^\s*#{1,6}\s/m.test(plainText)) score += 1;

  return detail('readability', score, 7, 6, 3, `avg sentence ${Math.round(avgSentenceLength)}자, paragraphs ${paragraphs.length}`);
}

function scoreSchema(input: ScorerInput): SeoScoreDetail {
  const jsonLd = input.hasJsonLd;
  let score = 0;
  if (jsonLd?.blogPosting) score += 3;
  if (jsonLd?.breadcrumbList) score += 2;
  if (jsonLd?.faqPage) score += 2;
  if (jsonLd?.howTo) score += 1;

  return detail('structured_data', score, 8, 7, 4, jsonLd ? JSON.stringify(jsonLd) : 'JSON-LD metadata 없음');
}

function scoreHelpfulContent(input: ScorerInput, plainText: string): SeoScoreDetail {
  const minLength = input.blogType === 'info' ? 2500 : 1200;
  let score = 0;
  if (plainText.length >= minLength) score += 3;
  else if (plainText.length >= minLength * 0.75) score += 1;
  if (/\d{1,3}(?:,\d{3})*원|\d+\s*(?:분|시간|일|월|도|℃|km|박)|20\d{2}/.test(plainText)) score += 2;
  if (/여소남|운영팀|검토|확인|공식|출처|기준/i.test(plainText)) score += 2;
  if (/> |“|”|"[^"]{8,}"/.test(input.blogHtml)) score += 1;

  return detail('helpful_content_eeat', score, 8, 6, 3, `body ${plainText.length}자, min ${minLength}자`);
}

function scoreMobile(blogHtml: string): SeoScoreDetail {
  const tableRows = (blogHtml.match(/(^|\n)\s*\|.+\|/g) || []).length;
  const longRawUrls = (blogHtml.match(/https?:\/\/\S{90,}/g) || []).length;
  let score = 0;
  if (tableRows <= 18) score += 2;
  if (longRawUrls === 0) score += 1;
  if (!/<table\b[^>]*style=/i.test(blogHtml)) score += 1;
  return detail('mobile_snippet_safety', score, 4, 3, 2, `table rows ${tableRows}, long raw urls ${longRawUrls}`);
}

function scoreSlug(input: ScorerInput, keyword: string): SeoScoreDetail {
  const slug = input.slug || '';
  let score = 0;
  if (slug.length >= 12 && slug.length <= 90) score += 1;
  if (!/untitled|draft|test|v\d+$/i.test(slug)) score += 1;
  if (/^[a-z0-9가-힣-]+$/i.test(slug)) score += 1;
  if (keyword && keyword.split(/\s+/).some((part) => part.length >= 2 && slug.toLowerCase().includes(part.toLowerCase()))) score += 1;
  else if (!keyword) score += 1;

  return detail('url_slug', score, 4, 3, 2, `slug ${slug.length}자`);
}

export function computeSeoScore(input: ScorerInput): SeoScoreResult {
  const plainText = stripMarkdownAndHtml(input.blogHtml);
  const keyword = input.primaryKeyword?.trim() || '';
  const dest = input.destination?.trim() || '';

  const details = [
    scoreTitle(input, keyword, dest),
    scoreMeta(input, keyword),
    scoreHeadings(input, keyword, dest),
    scorePrimaryKeyword(plainText, keyword, input.blogType),
    scoreSemanticCoverage(plainText, input.secondaryKeywords),
    scoreImages(input, keyword, dest),
    scoreInternalLinks(input.blogHtml),
    scoreExternalLinks(input.blogHtml),
    scoreReadability(input.blogHtml, plainText),
    scoreSchema(input),
    scoreHelpfulContent(input, plainText),
    scoreMobile(input.blogHtml),
    scoreSlug(input, keyword),
  ];

  const score = details.reduce((sum, item) => sum + item.score, 0);
  const minScore = BLOG_SEO_MIN_SCORE[input.blogType];
  const criticalFailures = details.filter((item) =>
    item.status === 'fail' &&
    ['title', 'meta_description', 'heading_structure', 'image_seo', 'internal_links_cta', 'structured_data', 'helpful_content_eeat'].includes(item.name),
  );
  const passed = score >= minScore && criticalFailures.length === 0;
  const summary = passed
    ? `SEO ${score}/${BLOG_SEO_MAX_SCORE} 통과 (${input.blogType}, 기준 ${minScore}점)`
    : `SEO ${score}/${BLOG_SEO_MAX_SCORE} 발행 보류 (${input.blogType}, 기준 ${minScore}점, critical=${criticalFailures.map((item) => item.name).join(', ') || 'none'})`;

  return {
    score,
    maxScore: BLOG_SEO_MAX_SCORE,
    passed,
    details,
    summary,
    checkedAt: new Date().toISOString(),
  };
}
