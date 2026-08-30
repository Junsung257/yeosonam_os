import { runQualityGates, type QualityGateReport } from './blog-quality-gate';
import { calculateBlogQualityScore, type BlogQualityScoreReport } from './blog-quality-score';
import { computeReadability, type ReadabilityResult } from './blog-readability';
import { computeSeoScore, type SeoScoreResult } from './blog-seo-scorer';
import { inspectBlogCustomerQuality, type BlogCustomerQualityReport } from './blog-customer-quality';
import { repairBlogPublishFormattingV3 } from './blog-safe-publish-repair-v3';
import {
  inspectPublicBlogCustomerQuality,
  type PublicBlogCustomerQualityReport,
} from './blog-public-customer-quality';
import {
  inspectBlogRenderedSeoQuality,
  type BlogRenderedSeoQualityReport,
} from './blog-rendered-seo-quality';
import { renderBlogContentToHtml } from './blog-renderer';
import { withPersistedBlogReadingTime } from './blog-reading-time';
import { stripBlogInformationalBodyCtas } from './blog-informational-cta';
import {
  sanitizePublicBlogBodyHtml,
  stripPublicDuplicateBodyTitleHeading,
} from './blog-public-render-normalizer';
import { extractFaqItems, extractHowToSteps } from './blog-jsonld';

type TravelPackageRef =
  | { destination?: string | null }
  | Array<{ destination?: string | null }>
  | null
  | undefined;

export interface BlogPublishQualityInput {
  id?: string | null;
  blog_html: string;
  slug: string;
  seo_title?: string | null;
  seo_description?: string | null;
  destination?: string | null;
  angle_type?: string | null;
  category?: string | null;
  content_type?: string | null;
  product_id?: string | null;
  micro_angle?: string | null;
  primary_keyword?: string | null;
  secondary_keywords?: string[] | null;
  generation_meta?: Record<string, unknown> | null;
  excludeContentCreativeId?: string | null;
  skipFuzzyDuplicate?: boolean;
  skipDuplicateCheck?: boolean;
  preserveBody?: boolean;
}

export type BlogPublishContractIssueCode =
  | 'deterministic_info_fallback_not_publishable';

export interface BlogPublishContractIssue {
  code: BlogPublishContractIssueCode;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface BlogPublishQualityReport {
  passed: boolean;
  publishContractIssues: BlogPublishContractIssue[];
  qualityGate: QualityGateReport;
  seoScore: SeoScoreResult;
  readability: ReadabilityResult;
  customerQuality: BlogCustomerQualityReport;
  publicCustomerQuality: PublicBlogCustomerQualityReport;
  renderedSeoQuality: BlogRenderedSeoQualityReport | null;
  readingTimeMinutes: number | null;
  blogQualityScore: BlogQualityScoreReport;
  summary: string;
}

export const PUBLIC_BLOG_CUSTOMER_PUBLISH_MIN_SCORE = 95;

const V3_SEO_BLOCKING_DETAILS = new Set([
  'public_link_integrity',
  'structured_data',
  'information_freshness',
]);

/** Legacy aggregate SEO heuristics remain visible for diagnosis, but a V3
 * article is blocked only by indexing/freshness invariants. Intent, evidence,
 * language and rendered usefulness are enforced by their dedicated gates. */
export function isBlogSeoDetailBlockingForPublish(
  detailName: string,
  flexibleV3: boolean,
): boolean {
  return flexibleV3 ? V3_SEO_BLOCKING_DETAILS.has(detailName) : true;
}

export interface BlogPublicCustomerQualityInput {
  blog_html: string;
  slug: string;
  seo_title?: string | null;
  destination?: string | null;
  product_id?: string | null;
}

export interface PreparedBlogPublishResult {
  blogHtml: string;
  changed: boolean;
  changes: string[];
  report: BlogPublishQualityReport;
}

export function resolveBlogDestination(row: {
  destination?: string | null;
  travel_packages?: TravelPackageRef;
}): string | null {
  const travelPackages = row.travel_packages;
  const packageDestination = Array.isArray(travelPackages)
    ? travelPackages[0]?.destination
    : travelPackages?.destination;
  return packageDestination ?? row.destination ?? null;
}

function resolveBlogPrimaryKeyword(input: BlogPublishQualityInput): string {
  const contentBrief = input.generation_meta?.content_brief;
  const briefPrimaryKeyword = contentBrief && typeof contentBrief === 'object' && !Array.isArray(contentBrief)
    ? (contentBrief as Record<string, unknown>).primary_keyword
    : null;
  return (typeof briefPrimaryKeyword === 'string' ? briefPrimaryKeyword.trim() : '')
    || input.primary_keyword
    || input.destination
    || input.seo_title
    || input.slug;
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
    const attrs: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(htmlMatch[0])) !== null) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
    }
    images.push({ alt: attrs.alt || '', src: attrs.src || '' });
  }

  return images;
}

function hasFaqBlock(markdownOrHtml: string): boolean {
  return extractFaqItems(markdownOrHtml).length > 0;
}

function hasHowToBlock(markdownOrHtml: string): boolean {
  // Keep the score aligned with the public page builder: checklist bullets are
  // not a HowTo schema unless the page contains three or more day/step blocks.
  return extractHowToSteps(markdownOrHtml).length >= 3;
}

function buildSummary(report: {
  publishContractIssues: BlogPublishContractIssue[];
  qualityGate: QualityGateReport;
  seoScore: SeoScoreResult;
  readability: ReadabilityResult;
  blogQualityScore: BlogQualityScoreReport;
  publicCustomerQuality: PublicBlogCustomerQualityReport;
  renderedSeoQuality?: BlogRenderedSeoQualityReport | null;
}): string {
  const parts: string[] = [];
  for (const issue of report.publishContractIssues) {
    parts.push(`[publish-contract] ${issue.code}: ${issue.message}`);
  }
  if (!report.blogQualityScore.passed) parts.push(`[score] ${report.blogQualityScore.summary}`);
  if (!report.qualityGate.passed) parts.push(`[quality] ${report.qualityGate.summary}`);
  if (!report.seoScore.passed) parts.push(`[seo] ${report.seoScore.summary}`);
  if (report.readability.issues.length > 0) {
    parts.push(`[readability] ${report.readability.score}/100 ${report.readability.issues.slice(0, 3).join(' / ')}`);
  }
  if (report.publicCustomerQuality.score < PUBLIC_BLOG_CUSTOMER_PUBLISH_MIN_SCORE) {
    parts.push(
      `[public-customer] ${report.publicCustomerQuality.score}/100 `
      + report.publicCustomerQuality.issues.map((issue) => issue.code).slice(0, 5).join(', '),
    );
  }
  if (report.renderedSeoQuality && !report.renderedSeoQuality.passed) {
    parts.push(`[rendered-seo] ${report.renderedSeoQuality.issues.map((issue) => issue.code).slice(0, 5).join(', ')}`);
  }
  return parts.length > 0
    ? parts.join(' | ')
    : `publish quality passed: strict score ${report.blogQualityScore.score}/100, SEO ${report.seoScore.score}/100, readability ${report.readability.score}/100`;
}

function inspectBlogPublishContract(input: BlogPublishQualityInput): BlogPublishContractIssue[] {
  if (input.product_id) return [];

  const generationMeta = input.generation_meta ?? {};
  const fallbackFlags = [
    'deterministic_info_fallback',
    'deterministic_fast_fallback',
  ].filter((flag) => generationMeta[flag] === true);

  if (fallbackFlags.length === 0) return [];

  return [{
    code: 'deterministic_info_fallback_not_publishable',
    message: '생성 실패 시 만든 비상용 정보성 글은 공개 발행할 수 없습니다.',
    evidence: { fallbackFlags },
  }];
}

export async function evaluateBlogPublicCustomerQuality(
  input: BlogPublicCustomerQualityInput,
): Promise<PublicBlogCustomerQualityReport> {
  const renderedCustomerHtml = await renderBlogContentToHtml(input.blog_html);
  const normalizedCustomerHtml = input.product_id
    ? renderedCustomerHtml
    : stripBlogInformationalBodyCtas(renderedCustomerHtml);
  const safePageTitle = input.seo_title ?? input.slug;
  const publicCustomerHtml = stripPublicDuplicateBodyTitleHeading(
    sanitizePublicBlogBodyHtml(normalizedCustomerHtml),
    safePageTitle,
  );
  const safeTitle = safePageTitle
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return inspectPublicBlogCustomerQuality({
    html: `<article><h1>${safeTitle}</h1>${publicCustomerHtml}</article>`,
    path: `/blog/${input.slug}`,
    title: input.seo_title,
    expectedType: input.product_id ? 'product' : 'info',
    expectedDestination: input.destination ?? null,
  });
}

export async function evaluateBlogPublishQuality(
  input: BlogPublishQualityInput,
): Promise<BlogPublishQualityReport> {
  const blogType = input.product_id ? 'product' : 'info';
  const flexibleV3 = Boolean(input.generation_meta?.content_brief_v3);
  const publishContractIssues = inspectBlogPublishContract(input);
  const destination = input.destination ?? null;
  const primaryKeyword = resolveBlogPrimaryKeyword(input);
  const images = extractImages(input.blog_html);
  const qualityGate = await runQualityGates({
    blog_html: input.blog_html,
    slug: input.slug,
    destination,
    angle_type: input.angle_type ?? null,
    blog_type: blogType,
    primary_keyword: primaryKeyword,
    category: input.category ?? null,
    content_type: input.content_type ?? null,
    product_id: input.product_id ?? null,
    micro_angle: input.micro_angle ?? null,
    generation_meta: input.generation_meta ?? null,
    excludeContentCreativeId: input.excludeContentCreativeId ?? input.id ?? null,
    skipFuzzyDuplicate: input.skipFuzzyDuplicate ?? false,
    skipDuplicateCheck: input.skipDuplicateCheck ?? false,
  });
  const seoScore = computeSeoScore({
    blogHtml: input.blog_html,
    slug: input.slug,
    seoTitle: input.seo_title ?? undefined,
    seoDescription: input.seo_description ?? undefined,
    primaryKeyword,
    secondaryKeywords: input.secondary_keywords ?? [],
    destination,
    blogType,
    generationMeta: input.generation_meta,
    hasRenderedPageH1: true,
    imageCount: images.length,
    imagesWithAlt: images.filter((image) => image.alt.trim().length >= 3).length,
    hasJsonLd: {
      blogPosting: true,
      breadcrumbList: true,
      faqPage: hasFaqBlock(input.blog_html),
      howTo: hasHowToBlock(input.blog_html),
    },
    hasRuntimeInformationalCta: blogType === 'info',
  });
  const readability = computeReadability(input.blog_html);
  const customerQuality = inspectBlogCustomerQuality({
    blogHtml: input.blog_html,
    blogType,
    title: input.seo_title,
    primaryKeyword,
    destination,
    productId: input.product_id ?? null,
    generationMeta: input.generation_meta ?? null,
  });
  const publicCustomerQuality = await evaluateBlogPublicCustomerQuality({
    blog_html: input.blog_html,
    slug: input.slug,
    seo_title: input.seo_title,
    destination,
    product_id: input.product_id,
  });
  const publicCustomerGatePassed =
    publicCustomerQuality.passed
    && publicCustomerQuality.score >= PUBLIC_BLOG_CUSTOMER_PUBLISH_MIN_SCORE;
  qualityGate.gates.push({
    gate: 'public_customer_quality',
    passed: publicCustomerGatePassed,
    reason: publicCustomerGatePassed
      ? undefined
      : `public customer quality ${publicCustomerQuality.score}/100 `
        + `(minimum ${PUBLIC_BLOG_CUSTOMER_PUBLISH_MIN_SCORE})`,
    evidence: {
      score: publicCustomerQuality.score,
      minimum_score: PUBLIC_BLOG_CUSTOMER_PUBLISH_MIN_SCORE,
      metrics: publicCustomerQuality.metrics,
      issues: publicCustomerQuality.issues.slice(0, 12),
    },
  });
  if (!publicCustomerGatePassed) {
    qualityGate.passed = false;
    qualityGate.summary = `공개 고객품질 ${publicCustomerQuality.score}/100: ${publicCustomerQuality.issues
      .map((issue) => issue.code)
      .slice(0, 5)
      .join(', ')}`;
  }
  const renderedSeoQuality = blogType === 'info'
    ? await inspectBlogRenderedSeoQuality({
        markdown: input.blog_html,
        slug: input.slug,
        title: input.seo_title || input.slug,
        description: input.seo_description || input.seo_title || input.slug,
        destination,
        generationMeta: input.generation_meta ?? null,
      })
    : null;
  const blogQualityScore = calculateBlogQualityScore({
    qualityGate,
    seoScore,
    readability,
    customerQuality,
    renderedAudit: renderedSeoQuality
      ? {
          failed: !renderedSeoQuality.passed,
          error: renderedSeoQuality.passed
            ? null
            : renderedSeoQuality.issues.map((issue) => `${issue.code}: ${issue.message}`).join(' / '),
          score: renderedSeoQuality.passed ? 100 : 0,
        }
      : null,
  });
  const report = {
    publishContractIssues,
    qualityGate,
    seoScore,
    readability,
    customerQuality,
    publicCustomerQuality,
    renderedSeoQuality,
    readingTimeMinutes: renderedSeoQuality?.readingTimeMinutes ?? null,
    blogQualityScore,
  };
  const v3SeoBlockingFailures = flexibleV3
    ? seoScore.details.filter((detail) =>
        detail.status === 'fail' && isBlogSeoDetailBlockingForPublish(detail.name, true))
    : [];
  const passed = flexibleV3
    ? qualityGate.passed
      && publishContractIssues.length === 0
      && publicCustomerGatePassed
      && v3SeoBlockingFailures.length === 0
      && (renderedSeoQuality?.passed ?? true)
    : blogQualityScore.isPerfect
      && publishContractIssues.length === 0
      && publicCustomerGatePassed;

  return {
    ...report,
    passed,
    summary: passed && flexibleV3
      ? `V3 publish contract passed: public customer ${publicCustomerQuality.score}/100, `
        + 'claim/intent/render gates passed; legacy SEO aggregate retained as diagnostic only'
      : buildSummary(report),
  };
}

export async function prepareBlogForPublish(
  input: BlogPublishQualityInput,
): Promise<PreparedBlogPublishResult> {
  const changes: string[] = [];
  let blogHtml = input.blog_html;
  const primaryKeyword = resolveBlogPrimaryKeyword(input);
  const contentType = input.content_type ?? (input.product_id ? 'package_intro' : 'guide');
  if (input.preserveBody) {
    const report = await evaluateBlogPublishQuality({
      ...input,
      primary_keyword: primaryKeyword,
      content_type: contentType,
    });
    return {
      blogHtml,
      changed: false,
      changes: ['preserved_verified_body_for_metadata_update'],
      report,
    };
  }
  const safeRepair = repairBlogPublishFormattingV3(blogHtml);
  if (safeRepair.changed) {
    blogHtml = safeRepair.markdown;
    changes.push(...safeRepair.changes);
  }

  const report = await evaluateBlogPublishQuality({
    ...input,
    blog_html: blogHtml,
    primary_keyword: primaryKeyword,
    content_type: contentType,
  });

  return {
    blogHtml,
    changed: blogHtml !== input.blog_html,
    changes,
    report,
  };
}

export function blogPublishQualityWarnings(report: BlogPublishQualityReport | null) {
  if (!report || report.passed) return null;
  return [
    ...report.publishContractIssues.map((issue) => ({
      type: 'publish_contract',
      gate: issue.code,
      reason: issue.message,
    })),
    ...report.qualityGate.gates
      .filter((gate) => !gate.passed)
      .map((gate) => ({ type: 'quality', gate: gate.gate, reason: gate.reason })),
    ...report.seoScore.details
      .filter((detail) => detail.status === 'fail')
      .map((detail) => ({ type: 'seo', gate: detail.name, reason: detail.message })),
    ...report.blogQualityScore.issues
      .filter((issue) => !['quality_gate', 'seo', 'render'].includes(issue.source))
      .map((issue) => ({ type: issue.source, gate: issue.code, reason: issue.message })),
    ...(report.renderedSeoQuality?.issues ?? []).map((issue) => ({
      type: 'rendered_seo',
      gate: issue.code,
      reason: issue.message,
    })),
    ...report.publicCustomerQuality.issues.map((issue) => ({
      type: 'public_customer_quality',
      gate: issue.code,
      reason: issue.message,
    })),
  ];
}

export function applyBlogPublishQualityToUpdate(
  updateData: Record<string, unknown>,
  report: BlogPublishQualityReport,
): void {
  updateData.quality_gate = report.readingTimeMinutes == null
    ? report.qualityGate
    : withPersistedBlogReadingTime(report.qualityGate, report.readingTimeMinutes);
  updateData.seo_score = report.seoScore;
  updateData.readability_score = report.readability.score;
  updateData.readability_issues = report.readability.issues;
}
