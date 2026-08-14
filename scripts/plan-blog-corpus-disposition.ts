import { mkdirSync, writeFileSync } from 'node:fs';
import { getReadOnlySupabaseV3, loadCorpusRowsV3, planCorpusDispositionV3, toCsvV3 } from './lib/blog-corpus-v3';

export async function runBlogDispositionPreviewV3(): Promise<void> {
  if (process.argv.includes('--apply')) throw new Error('plan-blog-corpus-disposition is read-only; use quarantine-invalid-blog-pages.ts --apply after approval');
  const client = getReadOnlySupabaseV3();
  const rows = await loadCorpusRowsV3(client);
  const { data: metricRows, error } = await client.from('blog_search_metrics').select('content_creative_id, clicks, impressions');
  if (error) throw new Error(`performance_read_failed:${error.message}`);
  const performance = new Map<string, { clicks: number; impressions: number }>();
  for (const row of metricRows || []) {
    const current = performance.get(row.content_creative_id) || { clicks: 0, impressions: 0 };
    current.clicks += Number(row.clicks || 0);
    current.impressions += Number(row.impressions || 0);
    performance.set(row.content_creative_id, current);
  }
  const dispositions = planCorpusDispositionV3(rows, performance);
  const redirects = dispositions.filter((row) => ['MERGE', 'REDIRECT'].includes(row.action) && row.canonical_target).map((row) => ({
    creative_id: row.creative_id, source_slug: row.slug, target_slug: row.canonical_target,
    http_status: 301, reason: row.reason, apply_state: 'preview_only',
  }));
  mkdirSync('docs/audits', { recursive: true });
  writeFileSync('docs/audits/blog-content-disposition-preview.json', `${JSON.stringify(dispositions, null, 2)}\n`);
  writeFileSync('docs/audits/blog-content-disposition-preview.csv', `${toCsvV3(dispositions as unknown as Array<Record<string, unknown>>)}\n`);
  writeFileSync('docs/audits/blog-redirect-plan-preview.csv', `${toCsvV3(redirects)}\n`);
  console.log(JSON.stringify({
    dry_run: true,
    total: dispositions.length,
    actions: Object.fromEntries([...new Set(dispositions.map((row) => row.action))].map((action) => [action, dispositions.filter((row) => row.action === action).length])),
    redirects: redirects.length,
  }, null, 2));
}

void runBlogDispositionPreviewV3().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
