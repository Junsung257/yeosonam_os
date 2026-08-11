import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import Papa from 'papaparse';
import { normalizeBlogSearchPerformanceRowV3, type BlogSearchPerformanceProviderV3 } from '../src/lib/blog-search-performance-import-v3';

const argument = (name: string) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || null;

async function main(): Promise<void> {
  const input = argument('--input');
  const provider = argument('--provider') as BlogSearchPerformanceProviderV3 | null;
  const apply = process.argv.includes('--apply');
  if (!input || !provider || !['google_search_console', 'naver_search_advisor'].includes(provider)) {
    throw new Error('usage: --input=<csv> --provider=naver_search_advisor|google_search_console [--apply]');
  }
  const bytes = readFileSync(input);
  const batchId = `${provider}-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
  const parsed = Papa.parse<Record<string, string>>(bytes.toString('utf8'), { header: true, skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new Error(`csv_parse_failed:${parsed.errors.map((error) => error.message).join('|')}`);
  const rows = parsed.data.map((row) => normalizeBlogSearchPerformanceRowV3({ provider, row, batchId }));
  if (!rows.length) throw new Error('empty_observed_metric_import');
  const preview = {
    dry_run: !apply,
    provider,
    batch_id: batchId,
    rows: rows.length,
    date_min: rows.map((row) => row.metric_date).sort()[0],
    date_max: rows.map((row) => row.metric_date).sort().at(-1),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
  };
  writeFileSync('docs/audits/blog-search-performance-import-preview.json', `${JSON.stringify({ ...preview, sample: rows.slice(0, 10) }, null, 2)}\n`);
  console.log(JSON.stringify(preview, null, 2));
  if (!apply) return;
  if (process.env.BLOG_SEARCH_IMPORT_APPLY_CONFIRM !== 'OBSERVED_METRICS_REVIEWED') throw new Error('apply_confirmation_missing');
  dotenv.config({ path: '.env.prod' });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_apply_configuration_missing');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.from('blog_search_performance').upsert(rows, { onConflict: 'provider,source_row_hash', ignoreDuplicates: true });
  if (error) throw new Error(`search_performance_import_failed:${error.message}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
