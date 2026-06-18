import {
  buildPublicBlogSurfaceSpecs,
  type BlogPublicSurfaceKind,
  type BlogPublicSurfaceSpec,
} from '@/lib/blog-public-surfaces';

const SILENT_EMPTY_POSTS_TEXT = '0\uD3B8';
const DB_UNAVAILABLE_PAGE_TEXT =
  '\uBE14\uB85C\uADF8 \uB370\uC774\uD130\uB97C \uC7A0\uC2DC \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4';

export interface BlogPublicSurfaceCheckResult {
  id: string;
  label: string;
  kind: BlogPublicSurfaceKind;
  path: string;
  url: string;
  critical: boolean;
  ok: boolean;
  status: number | null;
  elapsed_ms: number;
  bytes: number;
  cache: string | null;
  issues: string[];
}

export interface BlogPublicSurfaceCheckReport {
  ok: boolean;
  checked: number;
  failed: number;
  warn: number;
  results: BlogPublicSurfaceCheckResult[];
  generated_at: string;
}

interface CheckPublicBlogSurfacesOptions {
  baseUrl?: string | null;
  slug?: string | null;
  destination?: string | null;
  includeDiagnostics?: boolean;
}

function hasSilentEmptyPosts(body: string): boolean {
  return body.includes(SILENT_EMPTY_POSTS_TEXT);
}

function hasDbTimeoutSignal(body: string): boolean {
  return body.includes('Blog database request timed out') || body.includes('"db":"timeout"');
}

function hasUnavailablePageMessage(body: string): boolean {
  return body.includes(DB_UNAVAILABLE_PAGE_TEXT);
}

function classifySurfaceIssues(spec: BlogPublicSurfaceSpec, status: number, body: string, elapsedMs: number): string[] {
  const issues: string[] = [];

  if (status >= 500) issues.push(`http_${status}`);
  if (status === 404) issues.push('http_404');
  if (elapsedMs > spec.warnAfterMs) issues.push(`slow_${elapsedMs}ms`);

  if (spec.kind === 'page') {
    if (hasSilentEmptyPosts(body)) issues.push('silent_zero_posts');
    if (hasUnavailablePageMessage(body)) issues.push('db_unavailable_page');
  }

  if (spec.kind === 'api' && status !== 200) {
    issues.push(`api_not_ok_${status}`);
  }

  if (spec.kind === 'health' && hasDbTimeoutSignal(body)) {
    issues.push('db_timeout');
  }

  if (spec.kind === 'sitemap' && !body.includes('/blog')) {
    issues.push('sitemap_missing_blog');
  }

  if (spec.kind === 'api' && hasDbTimeoutSignal(body)) {
    issues.push('blog_api_db_timeout');
  }

  return issues;
}

async function checkOneSurface(spec: BlogPublicSurfaceSpec): Promise<BlogPublicSurfaceCheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const response = await Promise.race([
      fetch(spec.url, {
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          accept: spec.kind === 'api' || spec.kind === 'health'
            ? 'application/json,text/plain,*/*'
            : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      }),
      new Promise<Response>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`surface_timeout_${spec.timeoutMs}ms`));
        }, spec.timeoutMs);
      }),
    ]);

    const body = await response.text();
    const elapsedMs = Date.now() - start;
    const issues = classifySurfaceIssues(spec, response.status, body, elapsedMs);
    const blockingIssues = issues.filter(issue => !issue.startsWith('slow_'));

    return {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      path: spec.path,
      url: spec.url,
      critical: spec.critical,
      ok: blockingIssues.length === 0,
      status: response.status,
      elapsed_ms: elapsedMs,
      bytes: body.length,
      cache: response.headers.get('x-vercel-cache'),
      issues,
    };
  } catch (err) {
    return {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      path: spec.path,
      url: spec.url,
      critical: spec.critical,
      ok: false,
      status: null,
      elapsed_ms: Date.now() - start,
      bytes: 0,
      cache: null,
      issues: [err instanceof Error ? err.message : 'surface_fetch_failed'],
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkPublicBlogSurfaces(
  options: CheckPublicBlogSurfacesOptions = {},
): Promise<BlogPublicSurfaceCheckReport> {
  const specs = buildPublicBlogSurfaceSpecs(options);
  const results = await Promise.all(specs.map(checkOneSurface));
  const failed = results.filter(result => !result.ok);
  const warn = results.filter(result => result.issues.some(issue => issue.startsWith('slow_')));

  return {
    ok: failed.length === 0,
    checked: results.length,
    failed: failed.length,
    warn: warn.length,
    results,
    generated_at: new Date().toISOString(),
  };
}

export function warmPublicBlogSurfacesBestEffort(options: CheckPublicBlogSurfacesOptions = {}): void {
  void checkPublicBlogSurfaces({ ...options, includeDiagnostics: false }).catch((err) => {
    console.warn('[blog/public-warmup] failed', err instanceof Error ? err.message : err);
  });
}
