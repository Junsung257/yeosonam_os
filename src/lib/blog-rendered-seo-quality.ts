import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { resolveBlogCanonicalOrigin } from './blog-canonical-url';
import { inferBlogInformationIntent, type BlogInformationIntent } from './blog-information-contract';
import { readBlogInformationRepresentativeIdentity } from './blog-information-representative';
import { buildBlogPostPageJsonLd } from './blog-jsonld';
import { sanitizePublicBlogBodyHtml } from './blog-public-render-normalizer';
import { calculateBlogReadingTimeFromHtml } from './blog-reading-time';
import { inspectRenderedBlogIntegrity, renderBlogContentToHtml } from './blog-renderer';

export type BlogRenderedSeoIssueCode =
  | 'rendered_h1_count'
  | 'metadata_intent_mismatch'
  | 'raw_markdown'
  | 'literal_newline_escape'
  | 'broken_table'
  | 'empty_heading'
  | 'empty_table'
  | 'placeholder'
  | 'canonical_index_mismatch'
  | 'invalid_structured_data'
  | 'cta_replaces_answer'
  | 'duplicate_cta';

export interface BlogRenderedSeoIssue {
  code: BlogRenderedSeoIssueCode;
  message: string;
}

export interface BlogRenderedSeoQualityReport {
  passed: boolean;
  readingTimeMinutes: number;
  canonicalUrl: string;
  expectedIntent: BlogInformationIntent;
  issues: BlogRenderedSeoIssue[];
}

export interface BlogRenderedSeoQualityInput {
  markdown: string;
  slug: string;
  title: string;
  description: string;
  destination?: string | null;
  generationMeta?: Record<string, unknown> | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function addIssue(
  issues: BlogRenderedSeoIssue[],
  code: BlogRenderedSeoIssueCode,
  message: string,
): void {
  if (!issues.some((issue) => issue.code === code)) issues.push({ code, message });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function renderedHeadingLevel(element: Element): number | null {
  const match = element.tagName?.toLowerCase().match(/^h([2-6])$/);
  return match ? Number(match[1]) : null;
}

function renderedHeadingHasSectionContent(
  $: cheerio.CheerioAPI,
  element: Element,
): boolean {
  const level = renderedHeadingLevel(element);
  if (level === null) return false;
  let sibling = $(element).next();
  while (sibling.length > 0) {
    const siblingElement = sibling.get(0);
    if (!siblingElement || siblingElement.type !== 'tag') break;
    const siblingHeadingLevel = renderedHeadingLevel(siblingElement);
    if (siblingHeadingLevel !== null && siblingHeadingLevel <= level) break;
    const text = sibling.text().replace(/\u00a0/g, ' ').trim();
    const hasNonTextContent = sibling.is('img,table,ul,ol,blockquote')
      || sibling.find('img,table,ul,ol,blockquote').length > 0;
    if (text || hasNonTextContent) return true;
    sibling = sibling.next();
  }
  return false;
}

function inspectCanonicalAndIndex(
  input: BlogRenderedSeoQualityInput,
  issues: BlogRenderedSeoIssue[],
): void {
  const meta = input.generationMeta ?? {};
  const representative = readRecord(meta.information_representative);
  const canonicalSlug = typeof representative?.canonical_slug === 'string'
    ? representative.canonical_slug
    : null;
  const representativeStatus = representative?.status;
  const robots = readRecord(meta.robots);
  const noindex = meta.noindex === true
    || robots?.index === false
    || (typeof robots?.directives === 'string' && /(?:^|,)\s*noindex\b/i.test(robots.directives));
  if (noindex || (representativeStatus === 'active' && canonicalSlug !== input.slug)) {
    addIssue(
      issues,
      'canonical_index_mismatch',
      '공개 정보성 글의 canonical slug와 index 상태가 일치하지 않습니다.',
    );
  }
}

function inspectIntent(
  input: BlogRenderedSeoQualityInput,
  expectedIntent: BlogInformationIntent,
  issues: BlogRenderedSeoIssue[],
): void {
  if (expectedIntent === 'general') return;
  const titleIntent = inferBlogInformationIntent({
    topic: input.title,
    destination: input.destination,
  });
  const descriptionIntent = inferBlogInformationIntent({
    topic: input.description,
    destination: input.destination,
  });
  if (titleIntent !== expectedIntent || descriptionIntent !== expectedIntent) {
    addIssue(
      issues,
      'metadata_intent_mismatch',
      `title/H1/description 의도가 계획된 ${expectedIntent} 의도와 일치하지 않습니다.`,
    );
  }
}

export async function inspectBlogRenderedSeoQuality(
  input: BlogRenderedSeoQualityInput,
): Promise<BlogRenderedSeoQualityReport> {
  const issues: BlogRenderedSeoIssue[] = [];
  const rendered = await renderBlogContentToHtml(input.markdown);
  const bodyHtml = sanitizePublicBlogBodyHtml(rendered);
  const publicHtml = `<main><article><h1>${escapeHtml(input.title)}</h1>${bodyHtml}</article></main>`;
  const $ = cheerio.load(publicHtml);
  const integrity = inspectRenderedBlogIntegrity(input.markdown, bodyHtml);

  if ($('h1').length !== 1) {
    addIssue(issues, 'rendered_h1_count', `공개 렌더의 H1은 1개여야 하지만 ${$('h1').length}개입니다.`);
  }
  if (!integrity.passed) {
    addIssue(issues, 'raw_markdown', integrity.reason || '렌더 결과에 원시 마크다운이 남았습니다.');
  }
  if ($.root().text().includes('\\n')) {
    addIssue(issues, 'literal_newline_escape', '공개 렌더에 문자 그대로의 \\n이 남았습니다.');
  }
  $('h2,h3,h4,h5,h6').each((_, element) => {
    const heading = $(element);
    const headingText = heading.text().replace(/\u00a0/g, ' ').trim();
    if (!headingText || !renderedHeadingHasSectionContent($, element)) {
      addIssue(issues, 'empty_heading', '내용이 없는 제목이 있습니다.');
    }
  });
  $('table').each((_, table) => {
    const rows = $(table).find('tr');
    const cells = $(table).find('th,td');
    const hasEmptyCell = cells.toArray().some((cell) => !$(cell).text().replace(/\u00a0/g, ' ').trim());
    if (rows.length < 2 || cells.length < 2) {
      addIssue(issues, 'empty_table', '데이터 행이 없는 표가 있습니다.');
    } else if (hasEmptyCell) {
      addIssue(issues, 'broken_table', '비어 있는 셀이 포함된 표가 있습니다.');
    }
  });

  const visibleText = $.root().text().replace(/\s+/g, ' ').trim();
  if (
    /(?:TODO|TBD|PLACEHOLDER|LOREM IPSUM|내용을 입력|추후 입력|작성 예정|이미지 준비 중)/i.test(visibleText)
    || /(?:\{\{[^{}]+}}|\[\[(?:[A-Z_ -]+)]]|\[(?:DESTINATION|CITY|COUNTRY|DATE|PRICE|TOKEN)])/i.test(visibleText)
  ) {
    addIssue(issues, 'placeholder', '공개 렌더에 placeholder 문구가 남았습니다.');
  }

  const ctaHrefs = $('a[href]')
    .toArray()
    .map((element) => $(element).attr('href') || '')
    .filter((href) => /\/(?:packages|group-inquiry)|pf\.kakao\.com/i.test(href));
  if (new Set(ctaHrefs).size < ctaHrefs.length) {
    addIssue(issues, 'duplicate_cta', '같은 CTA 링크가 공개 본문에 중복되었습니다.');
  }
  if (ctaHrefs.length > 0) {
    const firstParagraph = $('article p').first().text().replace(/\s+/g, ' ').trim();
    if (firstParagraph.length < 40 || $('article').text().replace(/\s+/g, '').length < 120) {
      addIssue(issues, 'cta_replaces_answer', 'CTA보다 먼저 독자의 질문에 답하는 본문이 필요합니다.');
    }
  }

  const identity = readBlogInformationRepresentativeIdentity(input.generationMeta);
  const expectedIntent = identity?.intent ?? inferBlogInformationIntent({
    topic: `${input.title} ${input.description}`,
    destination: input.destination,
  });
  inspectIntent(input, expectedIntent, issues);
  inspectCanonicalAndIndex(input, issues);

  const readingTimeMinutes = calculateBlogReadingTimeFromHtml(bodyHtml);
  const baseUrl = resolveBlogCanonicalOrigin();
  const canonicalUrl = `${baseUrl}/blog/${input.slug}`;
  const jsonLd = buildBlogPostPageJsonLd({
    baseUrl,
    pageUrl: canonicalUrl,
    title: input.title,
    description: input.description,
    publishedAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: null,
    ogImageUrl: null,
    blogHtmlMarkdown: input.markdown,
    bodyHtmlForWordCount: bodyHtml,
    readingMinutes: readingTimeMinutes,
    angleLabel: expectedIntent,
    pkg: null,
    durationStr: '',
  });
  try {
    JSON.parse(JSON.stringify(jsonLd));
    if (
      jsonLd.blogPosting['@type'] !== 'BlogPosting'
      || jsonLd.blogPosting.headline !== input.title
      || jsonLd.blogPosting.description !== input.description
      || jsonLd.blogPosting.timeRequired !== `PT${readingTimeMinutes}M`
      || jsonLd.breadcrumbList['@type'] !== 'BreadcrumbList'
    ) {
      throw new Error('required structured data fields do not match the rendered page');
    }
  } catch {
    addIssue(issues, 'invalid_structured_data', '공개 페이지 구조화 데이터가 렌더 결과와 일치하지 않습니다.');
  }

  return {
    passed: issues.length === 0,
    readingTimeMinutes,
    canonicalUrl,
    expectedIntent,
    issues,
  };
}
