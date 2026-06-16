import { runQualityGates, type QualityGateReport } from './blog-quality-gate';
import { calculateBlogQualityScore, type BlogQualityScoreReport } from './blog-quality-score';
import { computeReadability, type ReadabilityResult } from './blog-readability';
import { computeSeoScore, type SeoScoreResult } from './blog-seo-scorer';
import { repairBlogEditorialQuality, repairBlogStructureQuality } from './blog-editorial-repair';

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
  primary_keyword?: string | null;
  secondary_keywords?: string[] | null;
  excludeContentCreativeId?: string | null;
  skipFuzzyDuplicate?: boolean;
}

export interface BlogPublishQualityReport {
  passed: boolean;
  qualityGate: QualityGateReport;
  seoScore: SeoScoreResult;
  readability: ReadabilityResult;
  blogQualityScore: BlogQualityScoreReport;
  summary: string;
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
  return /(^|\n)#{2,3}\s*(FAQ|자주 묻는 질문|Q\s*&\s*A)|(^|\n)\s*(Q\.|Q:|질문[:.]?)/i.test(markdownOrHtml);
}

function hasHowToBlock(markdownOrHtml: string): boolean {
  return /체크리스트|준비물|순서|방법|(^|\n)\s*(?:[-*]|\d+\.)\s+/i.test(markdownOrHtml);
}

function buildSummary(report: {
  qualityGate: QualityGateReport;
  seoScore: SeoScoreResult;
  readability: ReadabilityResult;
  blogQualityScore: BlogQualityScoreReport;
}): string {
  const parts: string[] = [];
  if (!report.blogQualityScore.passed) parts.push(`[score] ${report.blogQualityScore.summary}`);
  if (!report.qualityGate.passed) parts.push(`[quality] ${report.qualityGate.summary}`);
  if (!report.seoScore.passed) parts.push(`[seo] ${report.seoScore.summary}`);
  if (report.readability.issues.length > 0) {
    parts.push(`[readability] ${report.readability.score}/100 ${report.readability.issues.slice(0, 3).join(' / ')}`);
  }
  return parts.length > 0
    ? parts.join(' | ')
    : `publish quality passed: strict score ${report.blogQualityScore.score}/100, SEO ${report.seoScore.score}/100, readability ${report.readability.score}/100`;
}

export async function evaluateBlogPublishQuality(
  input: BlogPublishQualityInput,
): Promise<BlogPublishQualityReport> {
  const blogType = input.product_id ? 'product' : 'info';
  const destination = input.destination ?? null;
  const primaryKeyword = input.primary_keyword || destination || input.seo_title || input.slug;
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
    excludeContentCreativeId: input.excludeContentCreativeId ?? input.id ?? null,
    skipFuzzyDuplicate: input.skipFuzzyDuplicate ?? false,
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
    imageCount: images.length,
    imagesWithAlt: images.filter((image) => image.alt.trim().length >= 3).length,
    hasJsonLd: {
      blogPosting: true,
      breadcrumbList: true,
      faqPage: hasFaqBlock(input.blog_html),
      howTo: hasHowToBlock(input.blog_html),
    },
  });
  const readability = computeReadability(input.blog_html);
  const blogQualityScore = calculateBlogQualityScore({ qualityGate, seoScore, readability });
  const report = { qualityGate, seoScore, readability, blogQualityScore };

  return {
    ...report,
    passed: blogQualityScore.isPerfect,
    summary: buildSummary(report),
  };
}

export async function prepareBlogForPublish(
  input: BlogPublishQualityInput,
): Promise<PreparedBlogPublishResult> {
  const changes: string[] = [];
  let blogHtml = input.blog_html;
  const primaryKeyword = input.primary_keyword || input.destination || input.seo_title || input.slug;
  const contentType = input.content_type ?? (input.product_id ? 'package_intro' : 'guide');

  const editorialRepair = repairBlogEditorialQuality({
    title: input.seo_title ?? input.slug,
    slug: input.slug,
    primaryKeyword,
    angleType: input.angle_type ?? null,
    category: input.category ?? null,
    contentType,
    productId: input.product_id ?? null,
    blogHtml,
  });
  if (editorialRepair.changed) {
    blogHtml = editorialRepair.blogHtml;
    changes.push(...editorialRepair.changes);
  }

  const structureRepair = repairBlogStructureQuality({
    title: input.seo_title ?? input.slug,
    slug: input.slug,
    primaryKeyword,
    angleType: input.angle_type ?? null,
    category: input.category ?? null,
    contentType,
    productId: input.product_id ?? null,
    blogHtml,
  });
  if (structureRepair.changed) {
    blogHtml = structureRepair.blogHtml;
    changes.push(...structureRepair.changes);
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
    ...report.qualityGate.gates
      .filter((gate) => !gate.passed)
      .map((gate) => ({ type: 'quality', gate: gate.gate, reason: gate.reason })),
    ...report.seoScore.details
      .filter((detail) => detail.status === 'fail')
      .map((detail) => ({ type: 'seo', gate: detail.name, reason: detail.message })),
    ...report.blogQualityScore.issues
      .filter((issue) => issue.source !== 'quality_gate' && issue.source !== 'seo')
      .map((issue) => ({ type: issue.source, gate: issue.code, reason: issue.message })),
  ];
}

export function applyBlogPublishQualityToUpdate(
  updateData: Record<string, unknown>,
  report: BlogPublishQualityReport,
): void {
  updateData.quality_gate = report.qualityGate;
  updateData.seo_score = report.seoScore;
  updateData.readability_score = report.readability.score;
  updateData.readability_issues = report.readability.issues;
}
