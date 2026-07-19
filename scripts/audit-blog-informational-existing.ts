import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { FALLBACK_BLOG_POSTS } from '../src/lib/blog-public-fallback';
import {
  auditBlogInformationPostsDryRun,
  formatBlogInformationExistingAuditSummary,
  type BlogInformationExistingAuditInput,
} from '../src/lib/blog-informational-existing-audit';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

async function loadRows(): Promise<{ source: string; rows: BlogInformationExistingAuditInput[] }> {
  const input = argument('--input');
  if (!input) {
    return {
      source: 'repository_fallback_snapshot',
      rows: FALLBACK_BLOG_POSTS,
    };
  }
  const inputPath = resolve(process.cwd(), input);
  const raw = await readFile(inputPath);
  const parsed = JSON.parse(raw.toString('utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('audit input must be a JSON array');
  return { source: `local_file:${input}`, rows: parsed as BlogInformationExistingAuditInput[] };
}

async function main(): Promise<void> {
  if (process.argv.includes('--apply')) {
    process.stderr.write('This auditor is dry-run only and has no apply mode.\n');
    process.exitCode = 1;
    return;
  }
  const { source, rows } = await loadRows();
  const outputDirectory = resolve(
    process.cwd(),
    argument('--output-dir') || 'docs/specs/20260715-informational-content-engine-v2/reports',
  );
  const jsonPath = resolve(outputDirectory, 'm11-existing-post-audit.json');
  const summaryPath = resolve(outputDirectory, 'm11-existing-post-audit-summary.md');
  const report = await auditBlogInformationPostsDryRun(rows, {
    source,
    ctaSettingsConfigured: false,
    auditedAt: '2026-07-15T09:00:00.000Z',
  });
  const summary = formatBlogInformationExistingAuditSummary(report);
  await mkdir(dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(summaryPath, summary, 'utf8'),
  ]);
  process.stdout.write(`${summary}\nMachine report: ${jsonPath}\n`);
}

void main();
