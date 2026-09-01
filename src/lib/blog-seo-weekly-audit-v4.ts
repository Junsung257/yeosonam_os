import {
  BLOG_AUTOPILOT_PIPELINE_VERSION,
  BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION,
  readBlogDeploymentCommitShaV4,
} from '@/lib/blog-autopilot-v4-contract';
import { fetchBlogPageSpeedObservationV4, evaluateBlogPageSpeedObservationV4 } from '@/lib/blog-pagespeed-v4';
import { loadPublicBlogCatalogPage, type PublicBlogCatalogPost } from '@/lib/blog-public-catalog';
import {
  BLOG_SEO_AUDIT_VERSION_V4,
  createBlogSeoFindingV4,
  detectBlogCannibalizationV4,
  detectBlogContentDecayV4,
  detectBlogSeoDriftV4,
  evaluateBlogSeoSurfaceV4,
  inspectBlogSeoSurfaceV4,
  type BlogSearchMetricV4,
  type BlogSeoFindingV4,
  type BlogSeoSurfaceObservationV4,
} from '@/lib/blog-seo-operations-v4';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

const MAX_CATALOG_POSTS = 500;
const PUBLIC_RENDER_SAMPLE_SIZE = 30;
const PAGESPEED_SAMPLE_SIZE = 4;

type AuditScope = 'shadow' | 'weekly' | 'manual' | 'release';

type PersistedObservation = {
  id?: string;
  url: string;
  slug: string;
  http_status: number | null;
  canonical_url: string | null;
  robots_directive: string | null;
  title: string | null;
  description: string | null;
  h1_count: number | null;
  schema_types: string[] | null;
  sitemap_included: boolean | null;
  render_hash: string | null;
  metadata_hash: string | null;
  observed_at?: string;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function auditWeekKey(now: Date): string {
  const thursday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function baseOrigin(): string {
  const configured = String(process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com').trim();
  const url = new URL(configured);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('blog_seo_audit_https_origin_required');
  return url.origin;
}

async function loadCatalog(): Promise<{ posts: PublicBlogCatalogPost[]; sources: string[] }> {
  const posts: PublicBlogCatalogPost[] = [];
  const sources = new Set<string>();
  for (let page = 1; page <= Math.ceil(MAX_CATALOG_POSTS / 50); page += 1) {
    const result = await loadPublicBlogCatalogPage({ page, pageSize: 50 });
    sources.add(result.servedFrom);
    posts.push(...result.posts);
    if (posts.length >= result.total || result.posts.length < 50) break;
  }
  return { posts: posts.slice(0, MAX_CATALOG_POSTS), sources: [...sources] };
}

function rotateSample<T>(rows: T[], size: number, now: Date): T[] {
  if (rows.length <= size) return rows;
  const weekNumber = Math.floor(now.getTime() / (7 * 86_400_000));
  const start = (weekNumber * size) % rows.length;
  return Array.from({ length: size }, (_, index) => rows[(start + index) % rows.length]);
}

async function mapLimit<T, R>(rows: T[], limit: number, fn: (row: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await fn(rows[index], index);
    }
  }));
  return output;
}

function persistedToObservation(row: PersistedObservation): BlogSeoSurfaceObservationV4 | null {
  if (!row.render_hash || !row.metadata_hash) return null;
  return {
    url: row.url,
    slug: row.slug,
    httpStatus: row.http_status,
    canonicalUrl: row.canonical_url,
    robotsDirective: row.robots_directive,
    title: row.title,
    description: row.description,
    h1Count: Number(row.h1_count || 0),
    schemaTypes: row.schema_types || [],
    sitemapIncluded: row.sitemap_included,
    renderHash: row.render_hash,
    metadataHash: row.metadata_hash,
  };
}

async function loadSearchMetrics(now: Date): Promise<BlogSearchMetricV4[]> {
  const since = new Date(now.getTime() - 56 * 86_400_000);
  const data: Array<Record<string, any>> = [];
  const pageSize = 1_000;
  for (let page = 0; page < 50; page += 1) {
    const { data: batch, error } = await supabaseAdmin
      .from('rank_history')
      .select('slug,query,date,impressions,clicks,position')
      .in('source', ['gsc', 'gsc-page'])
      .gte('date', isoDate(since))
      .order('date', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`blog_seo_gsc_metrics_read_failed:${error.message}`);
    data.push(...(batch || []));
    if (!batch || batch.length < pageSize) break;
  }
  return data.map((row) => ({
    slug: String(row.slug || ''),
    query: String(row.query || ''),
    date: String(row.date || ''),
    impressions: typeof row.impressions === 'number' ? row.impressions : Number(row.impressions || 0),
    clicks: typeof row.clicks === 'number' ? row.clicks : Number(row.clicks || 0),
    position: row.position === null ? null : Number(row.position),
  }));
}

function aggregateGscBySlug(metrics: BlogSearchMetricV4[]) {
  const result = new Map<string, { impressions: number; clicks: number; bestPosition: number | null; observedRows: number }>();
  for (const metric of metrics) {
    const current = result.get(metric.slug) ?? { impressions: 0, clicks: 0, bestPosition: null, observedRows: 0 };
    current.impressions += Number(metric.impressions || 0);
    current.clicks += Number(metric.clicks || 0);
    current.observedRows += 1;
    if (typeof metric.position === 'number' && Number.isFinite(metric.position) && metric.position > 0) {
      current.bestPosition = current.bestPosition === null ? metric.position : Math.min(current.bestPosition, metric.position);
    }
    result.set(metric.slug, current);
  }
  return result;
}

async function readSitemapUrls(origin: string): Promise<{ urls: Set<string>; receipt: Record<string, unknown> }> {
  const sitemapUrl = `${origin}/sitemap.xml`;
  const response = await fetch(sitemapUrl, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`blog_seo_sitemap_http_${response.status}`);
  const urls = new Set([...body.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => normalizeUrlKey(match[1].replace(/&amp;/g, '&'))));
  return {
    urls,
    receipt: {
      url: sitemapUrl,
      status: response.status,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      urlCount: urls.size,
    },
  };
}

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value);
    let pathname = url.pathname;
    try { pathname = decodeURIComponent(pathname); } catch { /* preserve malformed escapes as received */ }
    return `${url.origin}${pathname}`.replace(/\/$/, '');
  } catch {
    return value.replace(/\/$/, '');
  }
}

export async function runBlogSeoWeeklyAuditV4(input: {
  scope?: AuditScope;
  now?: Date;
  forceKey?: string;
} = {}) {
  if (!isSupabaseAdminConfigured) throw new Error('blog_seo_audit_supabase_admin_missing');
  const now = input.now ?? new Date();
  const scope = input.scope ?? 'weekly';
  const auditKey = input.forceKey || `${scope}:${auditWeekKey(now)}:${BLOG_SEO_AUDIT_VERSION_V4}`;
  const provenance = {
    pipeline_version: BLOG_AUTOPILOT_PIPELINE_VERSION,
    deployment_commit_sha: readBlogDeploymentCommitShaV4(),
    schema_migration_version: BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION,
  };
  const { data: created, error: createError } = await supabaseAdmin
    .from('blog_seo_audit_runs')
    .insert({ audit_key: auditKey, audit_version: BLOG_SEO_AUDIT_VERSION_V4, scope, ...provenance })
    .select('id,status,summary')
    .single();
  if (createError) {
    if (createError.code === '23505') {
      const { data: existing, error } = await supabaseAdmin.from('blog_seo_audit_runs')
        .select('id,status,summary,completed_at').eq('audit_key', auditKey).single();
      if (error) throw new Error(`blog_seo_audit_existing_read_failed:${error.message}`);
      return { skipped: true, reason: 'audit_key_already_exists', auditKey, run: existing };
    }
    throw new Error(`blog_seo_audit_run_create_failed:${createError.message}`);
  }
  const runId = String(created.id);
  try {
    const origin = baseOrigin();
    const [{ posts, sources }, sitemap, metrics] = await Promise.all([
      loadCatalog(),
      readSitemapUrls(origin),
      loadSearchMetrics(now),
    ]);
    const catalogFindings: BlogSeoFindingV4[] = posts
      .filter((post) => !sitemap.urls.has(normalizeUrlKey(`${origin}/blog/${post.slug}`)))
      .map((post) => createBlogSeoFindingV4({
        category: 'technical', severity: 'critical', code: 'sitemap_missing_public_url', action: 'freeze',
        slug: post.slug, url: `${origin}/blog/${post.slug}`, evidence: { catalogSource: sources },
      }));
    const sample = rotateSample(posts, PUBLIC_RENDER_SAMPLE_SIZE, now);
    const sampleUrls = sample.map((post) => `${origin}/blog/${encodeURIComponent(post.slug)}`);
    const { data: previousRows, error: previousError } = sampleUrls.length
      ? await supabaseAdmin.from('blog_seo_observations')
        .select('id,url,slug,http_status,canonical_url,robots_directive,title,description,h1_count,schema_types,sitemap_included,render_hash,metadata_hash,observed_at')
        .in('url', sampleUrls)
        .order('observed_at', { ascending: false })
        .limit(sampleUrls.length * 5)
      : { data: [], error: null };
    if (previousError) throw new Error(`blog_seo_previous_observation_read_failed:${previousError.message}`);
    const previousByUrl = new Map<string, BlogSeoSurfaceObservationV4>();
    for (const row of (previousRows || []) as PersistedObservation[]) {
      if (previousByUrl.has(row.url)) continue;
      const observation = persistedToObservation(row);
      if (observation) previousByUrl.set(row.url, observation);
    }

    const gscBySlug = aggregateGscBySlug(metrics);
    const pageSpeedSlugs = new Set(
      [...sample]
        .sort((left, right) => (gscBySlug.get(right.slug)?.clicks || 0) - (gscBySlug.get(left.slug)?.clicks || 0))
        .slice(0, PAGESPEED_SAMPLE_SIZE)
        .map((post) => post.slug),
    );
    const pageSpeedKey = getSecret('GOOGLE_PAGESPEED_API_KEY') || null;
    const pageSpeedBySlug = new Map<string, Awaited<ReturnType<typeof fetchBlogPageSpeedObservationV4>>>();
    const pageSpeedErrors: string[] = [];
    for (const post of sample.filter((row) => pageSpeedSlugs.has(row.slug))) {
      const url = `${origin}/blog/${encodeURIComponent(post.slug)}`;
      try {
        pageSpeedBySlug.set(post.slug, await fetchBlogPageSpeedObservationV4({ url, apiKey: pageSpeedKey, timeoutMs: 30_000 }));
      } catch (error) {
        pageSpeedErrors.push(`${post.slug}:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const fetchErrors: string[] = [];
    const surfaces = await mapLimit(sample, 5, async (post) => {
      const url = `${origin}/blog/${encodeURIComponent(post.slug)}`;
      try {
        const response = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(15_000) });
        const html = await response.text();
        return {
          post,
          observation: inspectBlogSeoSurfaceV4({
            url,
            slug: post.slug,
            html,
            httpStatus: response.status,
            sitemapIncluded: sitemap.urls.has(normalizeUrlKey(`${origin}/blog/${post.slug}`)),
          }),
          receipt: {
            requestedUrl: url,
            finalUrl: response.url,
            status: response.status,
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified'),
          },
        };
      } catch (error) {
        fetchErrors.push(`${post.slug}:${error instanceof Error ? error.message : String(error)}`);
        return {
          post,
          observation: inspectBlogSeoSurfaceV4({ url, slug: post.slug, html: '', httpStatus: null, sitemapIncluded: null }),
          receipt: { requestedUrl: url, error: error instanceof Error ? error.message : String(error) },
        };
      }
    });

    const observationRows = surfaces.map(({ post, observation, receipt }) => {
      const pageSpeed = pageSpeedBySlug.get(post.slug) ?? null;
      return {
        run_id: runId,
        content_creative_id: post.id,
        slug: post.slug,
        url: observation.url,
        http_status: observation.httpStatus,
        canonical_url: observation.canonicalUrl,
        robots_directive: observation.robotsDirective,
        title: observation.title,
        description: observation.description,
        h1_count: observation.h1Count,
        schema_types: observation.schemaTypes,
        sitemap_included: observation.sitemapIncluded,
        render_hash: observation.renderHash,
        metadata_hash: observation.metadataHash,
        gsc_observation: gscBySlug.get(post.slug) ?? {},
        crux_observation: pageSpeed ? {
          fieldSource: pageSpeed.fieldSource,
          inpMs: pageSpeed.inpMs,
          lcpMs: pageSpeed.lcpMs,
          cls: pageSpeed.cls,
        } : {},
        pagespeed_observation: pageSpeed ? { performanceScore: pageSpeed.performanceScore } : {},
        provider_receipts: { publicSurface: receipt, sitemap: sitemap.receipt, pageSpeed: pageSpeed?.receipt ?? null },
      };
    });
    const { data: insertedObservations, error: observationError } = observationRows.length
      ? await supabaseAdmin.from('blog_seo_observations').insert(observationRows).select('id,url')
      : { data: [], error: null };
    if (observationError) throw new Error(`blog_seo_observation_insert_failed:${observationError.message}`);
    const observationIdByUrl = new Map((insertedObservations || []).map((row) => [String(row.url), String(row.id)]));

    const collectedFindings: BlogSeoFindingV4[] = [
      ...catalogFindings,
      ...detectBlogCannibalizationV4(metrics),
      ...detectBlogContentDecayV4(metrics, now),
    ];
    for (const { post, observation } of surfaces) {
      collectedFindings.push(...evaluateBlogSeoSurfaceV4(observation));
      collectedFindings.push(...detectBlogSeoDriftV4(observation, previousByUrl.get(observation.url) ?? null));
      const pageSpeed = pageSpeedBySlug.get(post.slug);
      if (pageSpeed) {
        for (const code of evaluateBlogPageSpeedObservationV4(pageSpeed)) {
          collectedFindings.push(createBlogSeoFindingV4({
            category: code.startsWith('pagespeed') ? 'pagespeed' : 'crux',
            severity: code === 'crux_field_data_missing' ? 'info' : 'warning',
            code,
            action: 'review',
            url: observation.url,
            slug: post.slug,
            evidence: pageSpeed,
          }));
        }
      }
    }
    const findings = [...new Map(collectedFindings.map((finding) => [
      `${finding.category}|${finding.code}|${finding.slug || ''}|${finding.url || ''}`,
      finding,
    ])).values()];
    const postBySlug = new Map(posts.map((post) => [post.slug, post]));
    const findingRows = findings.map((item) => {
      const post = item.slug ? postBySlug.get(item.slug) : null;
      return {
        run_id: runId,
        observation_id: item.url ? observationIdByUrl.get(item.url) ?? null : null,
        content_creative_id: post?.id ?? null,
        url: item.url ?? null,
        category: item.category,
        severity: item.severity,
        code: item.code,
        action: item.action,
        fingerprint: item.fingerprint,
        evidence: item.evidence,
      };
    });
    if (findingRows.length > 0) {
      const { error } = await supabaseAdmin.from('blog_seo_audit_findings').insert(findingRows);
      if (error) throw new Error(`blog_seo_finding_insert_failed:${error.message}`);
    }
    const critical = findings.filter((row) => row.severity === 'critical').length;
    const warning = findings.filter((row) => row.severity === 'warning').length;
    const summary = {
      catalog_posts: posts.length,
      catalog_sources: sources,
      public_render_sample: sample.length,
      sitemap_url_count: sitemap.urls.size,
      gsc_rows: metrics.length,
      pagespeed_sample: pageSpeedBySlug.size,
      observations: observationRows.length,
      findings: findings.length,
      critical,
      warning,
      fetch_errors: fetchErrors,
      pagespeed_errors: pageSpeedErrors,
      healthy: critical === 0 && fetchErrors.length === 0,
      automatic_content_changes: 0,
    };
    const status = fetchErrors.length > 0 || pageSpeedErrors.length > 0 ? 'partial' : 'completed';
    const { error: completeError } = await supabaseAdmin.from('blog_seo_audit_runs').update({
      status,
      completed_at: new Date().toISOString(),
      target_count: posts.length,
      summary,
    }).eq('id', runId);
    if (completeError) throw new Error(`blog_seo_audit_complete_failed:${completeError.message}`);
    return { skipped: false, auditKey, runId, status, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from('blog_seo_audit_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      summary: { error: message.slice(0, 1_000) },
    }).eq('id', runId);
    throw error;
  }
}
