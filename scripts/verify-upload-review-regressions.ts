#!/usr/bin/env tsx

import process from 'node:process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import type { UploadReviewQueueFixtureRow } from '@/lib/product-registration/review-queue-fixture-candidates';
import {
  buildUploadReviewRegressionReport,
} from '@/lib/product-registration/upload-review-regression-verifier';

type Options = {
  days: number;
  limit: number;
  status: string;
  strict: boolean;
  failOnPartial: boolean;
  requireDb: boolean;
  json: boolean;
};

function numberArg(args: string[], name: string, fallback: number): number {
  const raw = args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringArg(args: string[], name: string, fallback: string): string {
  return args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}

function parseOptions(args: string[]): Options {
  return {
    days: Math.min(numberArg(args, '--days', 30), 365),
    limit: Math.min(numberArg(args, '--limit', 200), 2000),
    status: stringArg(args, '--status', 'pending'),
    strict: args.includes('--strict'),
    failOnPartial: args.includes('--fail-on-partial'),
    requireDb: args.includes('--require-db'),
    json: args.includes('--json'),
  };
}

async function loadRows(options: Options): Promise<UploadReviewQueueFixtureRow[] | null> {
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    if (options.requireDb) throw new Error('Missing Supabase URL or service role key');
    return null;
  }

  const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  let query = supabase
    .from('upload_review_queue')
    .select('id,created_at,status,severity,error_reason,source_filename,file_hash,normalized_content_hash,raw_text_chunk,parsed_draft_json,product_title,land_operator_id')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(options.limit);

  if (options.status !== 'all') query = query.eq('status', options.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as UploadReviewQueueFixtureRow[];
}

function printReport(report: ReturnType<typeof buildUploadReviewRegressionReport>): void {
  const formatCounts = (counts: Record<string, number>): string => (
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => `${code}:${count}`)
      .join(', ') || 'none'
  );

  console.log('[upload-review-regressions]');
  console.log(`sourceRows=${report.sourceRows}`);
  console.log(`dedupedRows=${report.dedupedRows}`);
  console.log(`checked=${report.checked}`);
  console.log(`passed=${report.passed}`);
  console.log(`partial=${report.partial}`);
  console.log(`failed=${report.failed}`);
  console.log(`skipped=${report.skipped}`);
  console.log(`codeCounts=${formatCounts(report.codeCounts as Record<string, number>)}`);
  console.log(`uncoveredCodeCounts=${formatCounts(report.uncoveredCodeCounts as Record<string, number>)}`);
  for (const check of report.checks.filter(item => item.status !== 'skipped').slice(0, 20)) {
    console.log(`- ${check.status.toUpperCase()} ${check.productTitle ?? check.sourceFilename ?? check.queueId} [${check.codes.join(', ')}] products=${check.productsRecovered}`);
    if (check.uncoveredCodes.length > 0) console.log(`  uncovered=${check.uncoveredCodes.join(', ')}`);
    console.log(`  ${check.reason}`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const rows = await loadRows(options);
  if (rows == null) {
    console.log('[upload-review-regressions] skipped: Supabase env is not configured.');
    return;
  }

  const report = buildUploadReviewRegressionReport({ rows });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (options.strict && report.failed > 0) {
    console.error(`[upload-review-regressions] failed: ${report.failed} supported historical blocker(s) still reproduce.`);
    process.exit(1);
  }
  if (options.failOnPartial && report.partial > 0) {
    console.error(`[upload-review-regressions] failed: ${report.partial} partially covered historical blocker(s) still have unverified codes.`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
