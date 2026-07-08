import { evaluateBlogEngineV2, type BlogEngineEvaluation } from './blog-engine-v2';
import { inspectBlogCustomerQuality, type BlogCustomerQualityReport } from './blog-customer-quality';
import { inspectRenderedBlogIntegrity, renderBlogContentToHtml, type RenderedBlogIntegrityReport } from './blog-renderer';

export interface BlogGeneratedQualityCanaryInput {
  markdown: string;
  title?: string | null;
  slug: string;
  destination?: string | null;
  primaryKeyword?: string | null;
  contentType?: string | null;
  productId?: string | null;
  generationMeta?: Record<string, unknown> | null;
}

export interface BlogGeneratedQualityCanaryResult {
  status: 'pass' | 'fail';
  score: number;
  failure_reasons: string[];
  engine: BlogEngineEvaluation;
  customer: BlogCustomerQualityReport;
  render: RenderedBlogIntegrityReport;
  summary: string;
}

export interface BlogGeneratedQualityCanaryRow {
  id?: string | null;
  slug?: string | null;
  seo_title?: string | null;
  title?: string | null;
  blog_html?: string | null;
  destination?: string | null;
  primary_keyword?: string | null;
  content_type?: string | null;
  product_id?: string | null;
  generation_meta?: Record<string, unknown> | null;
}

export interface BlogGeneratedQualityCanaryReport {
  status: 'pass' | 'warn' | 'block';
  requested: number;
  checked_count: number;
  pass_count: number;
  fail_count: number;
  samples: Array<{
    id: string | null;
    slug: string | null;
    writer_type: string;
    status: BlogGeneratedQualityCanaryResult['status'];
    score: number;
    failure_reasons: string[];
    summary: string;
  }>;
  next_action: string;
}

function statusScore(passed: boolean): number {
  return passed ? 100 : 0;
}

function failedEngineReasons(engine: BlogEngineEvaluation): string[] {
  if (engine.passed) return [];
  const failedCategories = engine.category_scores
    .filter((category) => !category.passed)
    .map((category) => `engine.${category.id}:${category.score}`);
  return failedCategories.length > 0
    ? failedCategories
    : [`engine.${engine.failure_bucket}:${engine.score}`];
}

function failedCustomerReasons(customer: BlogCustomerQualityReport): string[] {
  return customer.issues.map((issue) => `customer.${issue.code}`);
}

function failedRenderReasons(render: RenderedBlogIntegrityReport): string[] {
  const artifacts = Array.isArray(render.evidence?.artifacts) ? render.evidence.artifacts : [];
  return artifacts.map((artifact) => `render.${artifact}`);
}

export async function evaluateBlogGeneratedQualityCanary(
  input: BlogGeneratedQualityCanaryInput,
): Promise<BlogGeneratedQualityCanaryResult> {
  const blogType = input.productId || input.contentType === 'package_intro' ? 'product' : 'info';
  const primaryKeyword = input.primaryKeyword || input.destination || input.title || input.slug;
  const engine = evaluateBlogEngineV2({
    blogHtml: input.markdown,
    primaryKeyword,
    destination: input.destination ?? null,
    contentType: input.contentType ?? null,
    productId: input.productId ?? null,
    generationMeta: input.generationMeta ?? null,
  });
  const customer = inspectBlogCustomerQuality({
    blogHtml: input.markdown,
    blogType,
    title: input.title ?? input.slug,
    primaryKeyword,
    destination: input.destination ?? null,
    productId: input.productId ?? null,
    generationMeta: input.generationMeta ?? null,
  });
  const renderedHtml = await renderBlogContentToHtml(input.markdown);
  const render = inspectRenderedBlogIntegrity(input.markdown, renderedHtml);
  const failureReasons = [
    ...failedEngineReasons(engine),
    ...failedCustomerReasons(customer),
    ...failedRenderReasons(render),
  ];
  const score = Math.round((
    statusScore(engine.passed) +
    statusScore(customer.passed) +
    statusScore(render.passed)
  ) / 3);
  const passed = failureReasons.length === 0 && score === 100;

  return {
    status: passed ? 'pass' : 'fail',
    score,
    failure_reasons: failureReasons,
    engine,
    customer,
    render,
    summary: passed
      ? 'generated canary passed customer-surface 100 contract'
      : `generated canary failed: ${failureReasons.slice(0, 6).join(', ')}`,
  };
}

function readWriterType(meta: Record<string, unknown> | null | undefined, productId?: string | null): string {
  const writer = meta?.writer ?? meta?.writer_type;
  if (writer === 'info_writer' || writer === 'product_consultant_writer') return writer;
  return productId ? 'product_consultant_writer' : 'info_writer';
}

function selectGeneratedCanaryRows(
  posts: BlogGeneratedQualityCanaryRow[],
  requested: number,
): BlogGeneratedQualityCanaryRow[] {
  const candidates = posts.filter((post) => typeof post.blog_html === 'string' && post.blog_html.trim().length > 0);
  const selected: BlogGeneratedQualityCanaryRow[] = [];
  const selectedIds = new Set<string>();
  const keyFor = (post: BlogGeneratedQualityCanaryRow, index: number) => post.id ?? post.slug ?? String(index);
  const take = (post: BlogGeneratedQualityCanaryRow | undefined) => {
    if (!post || selected.length >= requested) return;
    const key = keyFor(post, posts.indexOf(post));
    if (selectedIds.has(key)) return;
    selectedIds.add(key);
    selected.push(post);
  };

  take(candidates.find((post) => readWriterType(post.generation_meta, post.product_id) === 'info_writer'));
  take(candidates.find((post) => readWriterType(post.generation_meta, post.product_id) === 'product_consultant_writer'));
  for (const post of candidates) take(post);
  return selected;
}

export async function evaluateBlogGeneratedQualityCanaryReport(input: {
  posts: BlogGeneratedQualityCanaryRow[];
  requested?: number;
}): Promise<BlogGeneratedQualityCanaryReport> {
  const requested = Math.max(1, Math.min(5, Math.round(input.requested ?? 3)));
  const candidates = selectGeneratedCanaryRows(input.posts, requested);
  const samples: BlogGeneratedQualityCanaryReport['samples'] = [];

  for (const post of candidates) {
    const result = await evaluateBlogGeneratedQualityCanary({
      markdown: post.blog_html ?? '',
      title: post.seo_title ?? post.title ?? post.slug ?? null,
      slug: post.slug ?? post.id ?? 'generated-canary',
      destination: post.destination ?? null,
      primaryKeyword: post.primary_keyword ?? post.destination ?? post.seo_title ?? post.slug ?? null,
      contentType: post.content_type ?? null,
      productId: post.product_id ?? null,
      generationMeta: post.generation_meta ?? null,
    });
    samples.push({
      id: post.id ?? null,
      slug: post.slug ?? null,
      writer_type: readWriterType(post.generation_meta, post.product_id),
      status: result.status,
      score: result.score,
      failure_reasons: result.failure_reasons,
      summary: result.summary,
    });
  }

  const passCount = samples.filter((sample) => sample.status === 'pass').length;
  const failCount = samples.length - passCount;
  const writerTypes = new Set(samples.map((sample) => sample.writer_type));
  const hasWriterMix = requested < 2 || (writerTypes.has('info_writer') && writerTypes.has('product_consultant_writer'));
  const status = samples.length < requested ? 'warn' : failCount > 0 ? 'block' : !hasWriterMix ? 'warn' : 'pass';

  return {
    status,
    requested,
    checked_count: samples.length,
    pass_count: passCount,
    fail_count: failCount,
    samples,
    next_action: status === 'pass'
      ? 'Generated canary samples passed engine, customer, and render contracts.'
      : status === 'warn'
        ? samples.length < requested
          ? 'Collect at least three recent posts with body content before expanding prompt or writer changes.'
          : 'Publish or dry-run at least one product-consultant sample so generated canary proof covers both writer paths.'
        : 'Repair generated canary failures before expanding automatic publishing.',
  };
}
