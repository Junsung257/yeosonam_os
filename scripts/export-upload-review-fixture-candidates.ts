#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import {
  buildUploadReviewFixtureCandidateReport,
  type UploadReviewQueueFixtureRow,
} from '@/lib/product-registration/review-queue-fixture-candidates';
import { buildUploadReviewFixtureScaffolds } from '@/lib/product-registration/review-queue-fixture-scaffold';

type Options = {
  limit: number;
  status: string;
  json: boolean;
  write: boolean;
  output: string;
  scaffold: boolean;
  scaffoldDir: string;
  scaffoldLimit: number;
  selfTest: boolean;
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
    limit: Math.min(numberArg(args, '--limit', 100), 1000),
    status: stringArg(args, '--status', 'pending'),
    json: args.includes('--json'),
    write: args.includes('--write'),
    output: stringArg(args, '--output', 'docs/audits/upload-review-fixture-candidates.json'),
    scaffold: args.includes('--scaffold'),
    scaffoldDir: stringArg(args, '--scaffold-dir', '.tmp/product-registration-fixture-scaffolds'),
    scaffoldLimit: Math.min(numberArg(args, '--scaffold-limit', 10), 100),
    selfTest: args.includes('--self-test'),
  };
}

function selfTestRows(): UploadReviewQueueFixtureRow[] {
  return [
    {
      id: '11111111-1111-4111-8111-111111111111',
      created_at: '2026-06-15T00:00:00.000Z',
      status: 'pending',
      severity: 'critical',
      error_reason: 'Customer landing/A4 blocked: price_dates missing | flight time source mismatch',
      source_filename: 'sample.txt',
      file_hash: 'a'.repeat(64),
      normalized_content_hash: 'b'.repeat(64),
      raw_text_chunk: 'sample raw text with price table and BX371 09:00 11:20',
      parsed_draft_json: { title: '장가계' },
      product_title: '장가계',
      land_operator_id: null,
    },
  ];
}

async function loadRows(options: Options): Promise<UploadReviewQueueFixtureRow[]> {
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL or service role key');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  let query = supabase
    .from('upload_review_queue')
    .select('id,created_at,status,severity,error_reason,source_filename,file_hash,normalized_content_hash,raw_text_chunk,parsed_draft_json,product_title,land_operator_id')
    .order('created_at', { ascending: false })
    .limit(options.limit);

  if (options.status !== 'all') query = query.eq('status', options.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as UploadReviewQueueFixtureRow[];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const rows = options.selfTest ? selfTestRows() : await loadRows(options);
  const report = buildUploadReviewFixtureCandidateReport({ rows });

  if (options.write) {
    const outputPath = path.resolve(process.cwd(), options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[upload-review-fixtures] wrote ${report.candidateCount} candidates to ${options.output}`);
  }

  if (options.scaffold) {
    const scaffolds = buildUploadReviewFixtureScaffolds({
      candidates: report.candidates,
      baseDir: options.scaffoldDir,
      limit: options.scaffoldLimit,
    });
    for (const scaffold of scaffolds) {
      for (const file of scaffold.files) {
        const outputPath = path.resolve(process.cwd(), file.path);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, file.content, 'utf8');
      }
    }
    console.log(`[upload-review-fixtures] wrote ${scaffolds.length} fixture scaffolds to ${options.scaffoldDir}`);
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('[upload-review-fixtures]');
  console.log(`sourceRows=${report.sourceRows}`);
  console.log(`candidateCount=${report.candidateCount}`);
  console.log(`dedupedCount=${report.dedupedCount}`);
  const codeLine = Object.entries(report.codeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => `${code}:${count}`)
    .join(', ');
  console.log(`codes=${codeLine || 'none'}`);
  for (const candidate of report.candidates.slice(0, 10)) {
    console.log(`- ${candidate.fixtureId} [${candidate.codes.join(', ')}] ${candidate.productTitle ?? candidate.sourceFilename ?? candidate.queueId}`);
    console.log(`  next=${candidate.nextAction}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
