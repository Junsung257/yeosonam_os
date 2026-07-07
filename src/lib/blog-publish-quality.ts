import { runQualityGates, type QualityGateReport } from './blog-quality-gate';
import { calculateBlogQualityScore, type BlogQualityScoreReport } from './blog-quality-score';
import type { BlogEngineEvaluation } from './blog-engine-v2';
import { repairBlogEngineV2Readiness } from './blog-engine-v2-repair';
import { computeReadability, type ReadabilityResult } from './blog-readability';
import { computeSeoScore, type SeoScoreResult } from './blog-seo-scorer';
import { repairBlogEditorialQuality, repairBlogStructureQuality, repairKeywordDensityToTarget } from './blog-editorial-repair';
import { repairPublishReadiness } from './blog-publish-readiness-repair';

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
  generation_meta?: Record<string, unknown> | null;
  excludeContentCreativeId?: string | null;
  skipFuzzyDuplicate?: boolean;
}

export interface BlogPublishQualityReport {
  passed: boolean;
  qualityGate: QualityGateReport;
  seoScore: SeoScoreResult;
  readability: ReadabilityResult;
  blogQualityScore: BlogQualityScoreReport;
  criticScore: BlogEngineEvaluation | null;
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
  criticScore?: BlogEngineEvaluation | null;
}): string {
  const parts: string[] = [];
  if (report.criticScore && !report.criticScore.passed) {
    parts.push(`[critic] engine v2 ${report.criticScore.score}/100 ${report.criticScore.failure_bucket}`);
  }
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

function extractBlogEngineEvaluation(report: QualityGateReport): BlogEngineEvaluation | null {
  const engineGate = report.gates.find((gate) => gate.gate === 'engine_v2');
  const evidence = engineGate?.evidence;
  if (!evidence || typeof evidence !== 'object') return null;
  const evaluation = (evidence as Record<string, unknown>).evaluation;
  return evaluation && typeof evaluation === 'object' ? evaluation as BlogEngineEvaluation : null;
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
    generation_meta: input.generation_meta ?? null,
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
  const criticScore = extractBlogEngineEvaluation(qualityGate);
  const report = { qualityGate, seoScore, readability, blogQualityScore, criticScore };

  return {
    ...report,
    passed: blogQualityScore.isPerfect && (!criticScore || criticScore.passed),
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

  const densityRepair = repairKeywordDensityToTarget(blogHtml, primaryKeyword, input.product_id ? 'product' : 'info');
  if (densityRepair.changed) {
    blogHtml = densityRepair.blogHtml;
    changes.push('repaired_keyword_density_after_surface_repair');
  }

  const readinessRepair = repairPublishReadiness({
    markdown: blogHtml,
    blogType: input.product_id ? 'product' : 'info',
    slug: input.slug,
    destination: input.destination ?? null,
    topic: input.seo_title ?? input.slug,
    primaryKeyword,
  });
  if (readinessRepair.changed) {
    blogHtml = readinessRepair.markdown;
    changes.push(...readinessRepair.changes);
  }

  let report = await evaluateBlogPublishQuality({
    ...input,
    blog_html: blogHtml,
    primary_keyword: primaryKeyword,
    content_type: contentType,
  });

  if (report.criticScore && !report.criticScore.passed) {
    const engineRepair = repairBlogEngineV2Readiness({
      markdown: blogHtml,
      topic: input.seo_title ?? input.slug,
      primaryKeyword,
      destination: input.destination ?? null,
      productId: input.product_id ?? null,
      generationMeta: input.generation_meta ?? null,
      evaluation: report.criticScore,
    });
    if (engineRepair.changed) {
      blogHtml = engineRepair.markdown;
      changes.push(...engineRepair.changes);
      report = await evaluateBlogPublishQuality({
        ...input,
        blog_html: blogHtml,
        primary_keyword: primaryKeyword,
        content_type: contentType,
        generation_meta: engineRepair.generationMeta,
      });
    }
  }

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
  if (report.criticScore) {
    updateData.generation_meta = {
      ...((updateData.generation_meta && typeof updateData.generation_meta === 'object')
        ? updateData.generation_meta as Record<string, unknown>
        : {}),
      engine_version: report.criticScore.evidence_pack.engine_version,
      writer: report.criticScore.brief.writer_type,
      brief_score: report.criticScore.metrics.task_completion,
      evidence_score: report.criticScore.metrics.source_support,
      critic_score: report.criticScore.score,
      engine_score: report.criticScore.score,
      failure_bucket: report.criticScore.failure_bucket,
      evidence_pack: report.criticScore.evidence_pack,
    };
  }
}
