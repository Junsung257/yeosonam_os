import { chromium, type Page } from 'playwright';

type PendingPreview = {
  creativeId: string;
  slug: string;
  surface: 'preview' | 'public';
};

type PreviewDescriptor = {
  creativeId: string;
  contentHash: string;
  previewPath: string;
  requiredScore: number;
  surface: 'preview' | 'public';
};

const baseUrl = (process.env.BLOG_PREVIEW_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');
const cronSecret = process.env.CRON_SECRET?.trim();
if (!cronSecret) throw new Error('CRON_SECRET is required');

async function authorizedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cronSecret}`,
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

async function auditViewport(
  page: Page,
  url: string,
  label: 'mobile' | 'desktop',
  surface: 'preview' | 'public',
): Promise<string[]> {
  const issues: string[] = [];
  const runtimeErrors: string[] = [];
  const consoleHandler = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') runtimeErrors.push(message.text().slice(0, 240));
  };
  const pageErrorHandler = (error: Error) => runtimeErrors.push(error.message.slice(0, 240));
  page.on('console', consoleHandler);
  page.on('pageerror', pageErrorHandler);
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    if (!response || response.status() !== 200) issues.push(`http_status_${response?.status() ?? 'missing'}`);
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 500));
      window.scrollTo(0, 0);
    });

    const result = await page.evaluate(() => {
      const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content.toLowerCase() || '';
      const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '';
      const h1Count = [...document.querySelectorAll('h1')]
        .filter((node) => (node as HTMLElement).offsetParent !== null).length;
      const mainTextLength = (document.querySelector('article')?.textContent || document.querySelector('main')?.textContent || '')
        .replace(/\s+/g, ' ').trim().length;
      const schemaIssues: string[] = [];
      const schemaTypes: string[] = [];
      for (const [index, script] of [...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')].entries()) {
        try {
          const value = JSON.parse(script.textContent || '{}') as { '@type'?: string };
          if (value['@type']) schemaTypes.push(value['@type']);
        } catch {
          schemaIssues.push(`schema_json_invalid_${index}`);
        }
      }
      const invalidLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap((link) => {
        try {
          const parsed = new URL(link.href, window.location.href);
          return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol) ? [] : [link.getAttribute('href') || 'empty'];
        } catch {
          return [link.getAttribute('href') || 'empty'];
        }
      });
      const brokenImages = [...document.querySelectorAll<HTMLImageElement>('img')]
        .filter((img) => img.offsetParent !== null && (!img.complete || img.naturalWidth <= 0))
        .map((img) => img.currentSrc || img.src || img.alt || 'unknown');
      const text = document.body.innerText;
      return {
        robots,
        canonical,
        h1Count,
        mainTextLength,
        schemaIssues,
        schemaTypes,
        invalidLinks,
        brokenImages,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
        promptResidue: /(?:SYSTEM PROMPT|BEGIN PROMPT|internal[_ -]?label|claim[_ -]?fingerprint)/i.test(text),
      };
    });

    const expectedCanonical = new URL(url);
    expectedCanonical.search = '';
    expectedCanonical.hash = '';
    if (surface === 'preview' && !result.robots.includes('noindex')) issues.push('robots_noindex_missing');
    if (surface === 'public' && result.robots.includes('noindex')) issues.push('robots_public_noindex_present');
    if (result.canonical !== expectedCanonical.toString()) issues.push('canonical_mismatch');
    if (result.h1Count !== 1) issues.push(`visible_h1_count_${result.h1Count}`);
    if (result.mainTextLength < 500) issues.push(`main_text_too_short_${result.mainTextLength}`);
    issues.push(...result.schemaIssues);
    if (!result.schemaTypes.includes('BlogPosting')) issues.push('blogposting_schema_missing');
    if (result.invalidLinks.length > 0) issues.push(`invalid_links_${result.invalidLinks.length}`);
    if (result.brokenImages.length > 0) issues.push(`broken_images_${result.brokenImages.length}`);
    if (result.horizontalOverflow) issues.push('horizontal_overflow');
    if (result.promptResidue) issues.push('prompt_residue');
    if (runtimeErrors.length > 0) issues.push(`hydration_or_console_errors_${runtimeErrors.length}`);
  } catch (error) {
    issues.push(`navigation_failed:${error instanceof Error ? error.message.slice(0, 180) : String(error)}`);
  } finally {
    page.off('console', consoleHandler);
    page.off('pageerror', pageErrorHandler);
  }
  return issues.map((issue) => `${label}:${issue}`);
}

function scoreFor(issues: string[]): number {
  if (issues.length === 0) return 100;
  const critical = issues.filter((issue) => /http_status|navigation_failed|noindex|canonical|hydration|schema_json/.test(issue)).length;
  return Math.max(0, 100 - critical * 20 - (issues.length - critical) * 8);
}

const pendingResult = await authorizedJson<{ pending: PendingPreview[] }>('/api/internal/blog-preview/pending?limit=5');
if (pendingResult.pending.length === 0) {
  process.stdout.write('No blog draft previews are pending.\n');
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
let failed = 0;
try {
  for (const pending of pendingResult.pending) {
    const descriptor = await authorizedJson<PreviewDescriptor>(
      `/api/internal/blog-preview/${encodeURIComponent(pending.creativeId)}?surface=${pending.surface}`,
    );
    if (descriptor.surface !== pending.surface) throw new Error('browser_audit_surface_mismatch');
    const previewUrl = new URL(descriptor.previewPath, baseUrl).toString();
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const desktopIssues = await auditViewport(await desktopContext.newPage(), previewUrl, 'desktop', pending.surface);
    const mobileIssues = await auditViewport(await mobileContext.newPage(), previewUrl, 'mobile', pending.surface);
    await Promise.all([desktopContext.close(), mobileContext.close()]);
    const issues = [...desktopIssues, ...mobileIssues];
    const desktopScore = scoreFor(desktopIssues);
    const mobileScore = scoreFor(mobileIssues);
    const score = Math.min(desktopScore, mobileScore);
    await authorizedJson(`/api/internal/blog-preview/${encodeURIComponent(pending.creativeId)}`, {
      method: 'POST',
      body: JSON.stringify({ surface: pending.surface, contentHash: descriptor.contentHash, score, desktopScore, mobileScore, issues }),
    });
    if (score < descriptor.requiredScore || issues.length > 0) failed += 1;
    process.stdout.write(`${pending.surface}/${pending.slug}: score=${score}, issues=${issues.length}\n`);
  }
} finally {
  await browser.close();
}
if (failed > 0) throw new Error(`${failed} blog browser surface audit(s) failed the V4 gate`);
