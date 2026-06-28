import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

import { customerCopyQualityIssues } from '../src/lib/customer-copy-quality';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });
if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY;
}

type PackageRow = {
  id: string;
  title: string | null;
  internal_code: string | null;
  updated_at: string | null;
};

const args = process.argv.slice(2);

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = args.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function parseList(value: string | null): string[] {
  return String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120);
}

function lineIssues(text: string): Array<{ line: string; issues: string[] }> {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => ({
      line,
      issues: customerCopyQualityIssues(line).map(issue => issue.code),
    }))
    .filter(row => row.issues.length > 0);
}

async function loadPackages(ids: string[], limit: number): Promise<PackageRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase URL and service key are required.');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let query = supabase
    .from('travel_packages')
    .select('id,title,internal_code,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (ids.length > 0) query = query.in('id', ids);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PackageRow[];
}

async function main() {
  const baseUrl = (argValue('base') || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const ids = parseList(argValue('package-ids'));
  const limit = Math.max(1, Math.min(Number(argValue('limit') ?? '200') || 200, 500));
  const outputDir = argValue('output-dir') || path.join(process.cwd(), 'data/product-registration/mobile-copy-audit');
  const textDir = path.join(outputDir, 'texts');
  ensureDir(textDir);

  const proofSecret = process.env.REVALIDATE_SECRET || process.env.ADMIN_API_TOKEN;
  if (!proofSecret) throw new Error('REVALIDATE_SECRET or ADMIN_API_TOKEN is required for internal mobile copy audit.');

  const packages = await loadPackages(ids, limit);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: 'YeosonamMobileCopyAudit/1.0 Mobile Safari',
    extraHTTPHeaders: {
      'x-yeosonam-render-proof': proofSecret,
      'Cache-Control': 'no-cache',
    },
  });

  const results: Array<{
    id: string;
    internal_code: string | null;
    title: string | null;
    url: string;
    status: 'pass' | 'fail';
    issue_count: number;
    issues: Array<{ line: string; issues: string[] }>;
    text_path: string;
  }> = [];

  for (const pkg of packages) {
    const url = `${baseUrl}/packages/${encodeURIComponent(pkg.id)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1200);
    const text = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
    const textPath = path.join(textDir, `${safeName(pkg.internal_code || pkg.id)}.txt`);
    fs.writeFileSync(textPath, text, 'utf8');
    const issues = lineIssues(text);
    results.push({
      id: pkg.id,
      internal_code: pkg.internal_code,
      title: pkg.title,
      url,
      status: issues.length === 0 ? 'pass' : 'fail',
      issue_count: issues.length,
      issues,
      text_path: textPath,
    });
  }

  await browser.close();

  const summary = {
    total: results.length,
    pass: results.filter(result => result.status === 'pass').length,
    fail: results.filter(result => result.status === 'fail').length,
    outputDir,
    checkedAt: new Date().toISOString(),
  };
  const report = { summary, results };
  const jsonPath = path.join(outputDir, `mobile-copy-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const md = [
    '# Mobile Landing Copy Audit',
    '',
    `- Total: ${summary.total}`,
    `- Pass: ${summary.pass}`,
    `- Fail: ${summary.fail}`,
    '',
    ...results
      .filter(result => result.status === 'fail')
      .flatMap(result => [
        `## ${result.internal_code || result.id}`,
        `- URL: ${result.url}`,
        `- Text: ${result.text_path}`,
        ...result.issues.slice(0, 20).map(issue => `- ${issue.issues.join(', ')}: ${issue.line}`),
        '',
      ]),
  ].join('\n');
  const mdPath = path.join(outputDir, 'mobile-copy-audit-summary.md');
  fs.writeFileSync(mdPath, md, 'utf8');

  console.log(JSON.stringify({ summary, jsonPath, mdPath }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
