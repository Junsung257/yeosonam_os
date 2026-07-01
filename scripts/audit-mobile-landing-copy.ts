import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import { chromium, type Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';

import {
  auditCustomerVisibleProductText,
  auditCustomerVisibleScreenText,
  type CustomerVisibleTextIssue,
} from '../src/lib/customer-visible-text-audit';
import {
  CUSTOMER_VISIBLE_STATUSES,
  isCustomerVisibleStatus,
} from '../src/lib/visibility-status';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });
if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY;
}

type AuditScope = 'public' | 'non-archived' | 'all';
type AuditSurface = 'packages' | 'lp';
type ScrapeInput = {
  baseUrl: string;
  pkg: PackageRow;
  surface: AuditSurface;
  textDir: string;
  proofSecret: string | null;
  pageTimeoutMs: number;
  textTimeoutMs: number;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type PackageRow = Record<string, unknown> & {
  id: string;
  title: string | null;
  internal_code: string | null;
  status: string | null;
  updated_at: string | null;
};

type SurfaceResult = {
  id: string;
  internal_code: string | null;
  title: string | null;
  status: string | null;
  surface: AuditSurface | 'db';
  url: string | null;
  mode: 'actual-screen' | 'db-fields';
  result: 'pass' | 'fail';
  issue_count: number;
  blocking_count: number;
  issues: CustomerVisibleTextIssue[];
  text_path?: string;
  error?: string;
  transient_error?: boolean;
  attempts?: number;
};

const args = process.argv.slice(2);

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = args.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function parseScope(value: string | null): AuditScope {
  if (value === 'public' || value === 'non-archived' || value === 'all') return value;
  return 'public';
}

function parseSurfaces(value: string | null): AuditSurface[] {
  const parsed = String(value ?? 'packages')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const surfaces = parsed.filter((item): item is AuditSurface => item === 'packages' || item === 'lp');
  return surfaces.length > 0 ? surfaces : ['packages'];
}

function parseList(value: string | null): string[] {
  return String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function isTransientScrapeError(error: string | undefined): boolean {
  return Boolean(error && /Timeout|timed out|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_HTTP2|fetch failed|terminated|Navigation failed/i.test(error));
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120);
}

function surfacePath(surface: AuditSurface, id: string): string {
  return surface === 'lp' ? `/lp/${encodeURIComponent(id)}` : `/packages/${encodeURIComponent(id)}`;
}

function compactIssues(issues: CustomerVisibleTextIssue[]): CustomerVisibleTextIssue[] {
  return issues.slice(0, 50);
}

async function loadPackages(ids: string[], limit: number, scope: AuditScope): Promise<PackageRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase URL and service key are required.');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let query = supabase
    .from('travel_packages')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (ids.length > 0) {
    query = query.in('id', ids);
  } else if (scope === 'public') {
    query = query.in('status', [...CUSTOMER_VISIBLE_STATUSES]);
  } else if (scope === 'non-archived') {
    query = query.not('status', 'in', '("archived","inactive","rejected","expired")');
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PackageRow[];
}

async function scrapeSurface(browser: Browser, input: ScrapeInput): Promise<SurfaceResult> {
  const url = `${input.baseUrl}${surfacePath(input.surface, input.pkg.id)}`;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'YeosonamMobileCopyAudit/2.0 Mobile Safari',
    extraHTTPHeaders: {
      ...(input.proofSecret ? { 'x-yeosonam-render-proof': input.proofSecret } : {}),
      'x-proof-request': 'true',
      'Cache-Control': 'no-store',
    },
  });
  const page = await context.newPage();
  try {
    await withTimeout(
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: input.pageTimeoutMs }),
      input.pageTimeoutMs + 2_000,
      `${input.surface} navigation`,
    );
    await page.waitForTimeout(Math.min(800, Math.max(0, Math.floor(input.textTimeoutMs / 10))));
    const text = await withTimeout(
      page.locator('body').innerText({ timeout: input.textTimeoutMs }).catch(() => ''),
      input.textTimeoutMs + 2_000,
      `${input.surface} text scrape`,
    );
    const textPath = path.join(
      input.textDir,
      `${safeName(input.pkg.internal_code || input.pkg.id)}-${input.surface}.txt`,
    );
    fs.writeFileSync(textPath, text, 'utf8');
    const issues = auditCustomerVisibleScreenText(text, { surface: input.surface });
    const blocking = issues.filter(issue => !issue.safeFixable);
    return {
      id: input.pkg.id,
      internal_code: input.pkg.internal_code,
      title: input.pkg.title,
      status: input.pkg.status,
      surface: input.surface,
      url,
      mode: 'actual-screen',
      result: issues.length === 0 ? 'pass' : 'fail',
      issue_count: issues.length,
      blocking_count: blocking.length,
      issues: compactIssues(issues),
      text_path: textPath,
    };
  } catch (error) {
    return {
      id: input.pkg.id,
      internal_code: input.pkg.internal_code,
      title: input.pkg.title,
      status: input.pkg.status,
      surface: input.surface,
      url,
      mode: 'actual-screen',
      result: 'fail',
      issue_count: 1,
      blocking_count: 1,
      issues: [],
      error: error instanceof Error ? error.message : String(error),
      transient_error: isTransientScrapeError(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    await withTimeout(context.close(), 3_000, `${input.surface} context close`).catch(() => undefined);
  }
}

async function scrapeSurfaceWithRetry(browser: Browser, input: ScrapeInput & { maxRetries: number }): Promise<SurfaceResult> {
  let last: SurfaceResult | null = null;
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    const result = await scrapeSurface(browser, input);
    result.attempts = attempt + 1;
    if (result.result === 'pass' || !isTransientScrapeError(result.error) || attempt === input.maxRetries) {
      return result;
    }
    last = result;
    await new Promise(resolve => setTimeout(resolve, Math.min(2_000, 500 * (attempt + 1))));
  }
  return last ?? await scrapeSurface(browser, input);
}

function auditDbFields(pkg: PackageRow): SurfaceResult {
  const issues = auditCustomerVisibleProductText(pkg);
  const blocking = issues.filter(issue => !issue.safeFixable);
  return {
    id: pkg.id,
    internal_code: pkg.internal_code,
    title: pkg.title,
    status: pkg.status,
    surface: 'db',
    url: null,
    mode: 'db-fields',
    result: issues.length === 0 ? 'pass' : 'fail',
    issue_count: issues.length,
    blocking_count: blocking.length,
    issues: compactIssues(issues),
  };
}

async function runConcurrently<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) break;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const baseUrl = (argValue('base') || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const ids = parseList(argValue('package-ids'));
  const scope = parseScope(argValue('scope'));
  const surfaces = parseSurfaces(argValue('surfaces'));
  const concurrency = Math.max(1, Math.min(Number(argValue('concurrency') ?? '4') || 4, 8));
  const limit = Math.max(1, Math.min(Number(argValue('limit') ?? '200') || 200, 2_000));
  const pageTimeoutMs = Math.max(5_000, Math.min(Number(argValue('page-timeout-ms') ?? '15_000') || 15_000, 60_000));
  const textTimeoutMs = Math.max(2_000, Math.min(Number(argValue('text-timeout-ms') ?? '5_000') || 5_000, 30_000));
  const retryCount = Math.max(0, Math.min(Number(argValue('retry') ?? '1') || 1, 3));
  const outputDir = argValue('output-dir') || path.join(process.cwd(), 'data/product-registration/mobile-copy-audit');
  const textDir = path.join(outputDir, 'texts');
  const jsonOnly = hasFlag('json');
  ensureDir(textDir);

  const proofSecret = process.env.REVALIDATE_SECRET || process.env.ADMIN_API_TOKEN || null;
  const packages = await loadPackages(ids, limit, scope);
  const screenTargets = packages
    .filter(pkg => isCustomerVisibleStatus(pkg.status))
    .flatMap(pkg => surfaces.map(surface => ({ pkg, surface })));
  const dbTargets = packages.filter(pkg => !isCustomerVisibleStatus(pkg.status));

  const browser = screenTargets.length > 0 ? await chromium.launch({ headless: true }) : null;
  const screenResults = browser
    ? await runConcurrently(screenTargets, concurrency, target => scrapeSurfaceWithRetry(browser, {
      baseUrl,
      pkg: target.pkg,
      surface: target.surface,
      textDir,
      proofSecret,
      pageTimeoutMs,
      textTimeoutMs,
      maxRetries: retryCount,
    }))
    : [];
  if (browser) await withTimeout(browser.close(), 5_000, 'browser close').catch(() => undefined);

  const dbResults = dbTargets.map(auditDbFields);
  const results = [...screenResults, ...dbResults];
  const issueCountsByCode: Record<string, number> = {};
  for (const result of results) {
    for (const issue of result.issues) {
      issueCountsByCode[issue.code] = (issueCountsByCode[issue.code] ?? 0) + 1;
    }
  }

  const summary = {
    scope,
    surfaces,
    totalPackages: packages.length,
    totalChecks: results.length,
    pass: results.filter(result => result.result === 'pass').length,
    fail: results.filter(result => result.result === 'fail').length,
    blocking: results.reduce((sum, result) => sum + result.blocking_count, 0),
    safeFixable: results.reduce((sum, result) => sum + Math.max(0, result.issue_count - result.blocking_count), 0),
    issueCountsByCode,
    transientFailures: results.filter(result => result.result === 'fail' && result.transient_error).length,
    retryCount,
    outputDir,
    checkedAt: new Date().toISOString(),
  };
  const report = { summary, results };
  const jsonPath = path.join(outputDir, `mobile-copy-audit-v2-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const md = [
    '# Mobile Landing Copy Audit V2',
    '',
    `- Scope: ${summary.scope}`,
    `- Surfaces: ${summary.surfaces.join(', ')}`,
    `- Packages: ${summary.totalPackages}`,
    `- Checks: ${summary.totalChecks}`,
    `- Pass: ${summary.pass}`,
    `- Fail: ${summary.fail}`,
    `- Blocking issues: ${summary.blocking}`,
    `- Safe-fix issues: ${summary.safeFixable}`,
    `- Transient failures: ${summary.transientFailures}`,
    `- Retry count: ${summary.retryCount}`,
    '',
    ...results
      .filter(result => result.result === 'fail')
      .slice(0, 80)
      .flatMap(result => [
        `## ${result.internal_code || result.id} (${result.surface})`,
        `- Mode: ${result.mode}`,
        `- URL: ${result.url ?? 'DB fields'}`,
        ...(result.text_path ? [`- Text: ${result.text_path}`] : []),
        ...(result.error ? [`- Error: ${result.error}`] : []),
        ...result.issues.slice(0, 12).map(issue => `- ${issue.safeFixable ? 'safe-fix' : 'blocking'} ${issue.code} ${issue.fieldPath}: ${issue.value}`),
        '',
      ]),
  ].join('\n');
  const mdPath = path.join(outputDir, 'mobile-copy-audit-v2-summary.md');
  fs.writeFileSync(mdPath, md, 'utf8');

  const output = { summary, jsonPath, mdPath };
  if (jsonOnly) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(md);
    console.log(JSON.stringify(output, null, 2));
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
