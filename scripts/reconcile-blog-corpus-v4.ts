import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  classifyFailedBlogQueueV4,
  planReviewBlockedDispositionV4,
  reconcilePublishedQueueV4,
} from '../src/lib/blog-corpus-reconciliation-v4';

dotenv.config({ path: '.env.prod' });

type JsonRow = Record<string, unknown>;
type BlogReadPage = {
  data: unknown[] | null;
  error: { message: string } | null;
};

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('blog_corpus_reconciliation_configuration_missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readAll(
  table: string,
  loadPage: (from: number, to: number) => PromiseLike<BlogReadPage>,
): Promise<JsonRow[]> {
  const pageSize = 500;
  const rows: JsonRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) throw new Error(`${table}_read_failed:${error.message}`);
    const page = (data ?? []) as JsonRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function csv(rows: JsonRow[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const encode = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [headers.map(encode).join(','), ...rows.map((row) => headers.map((key) => encode(row[key])).join(','))].join('\n');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (apply && process.env.BLOG_CORPUS_RECONCILIATION_CONFIRM !== 'APPLY_REVIEWED_DISPOSITIONS_V4') {
    throw new Error('apply_confirmation_missing');
  }
  const db = client();
  const [blockedRows, dispositionRows, failedRows, publishedQueueRows] = await Promise.all([
    readAll('content_creatives', (from, to) => db.from('content_creatives')
      .select('id,slug,review_status').range(from, to)
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .not('slug', 'is', null)
      .in('review_status', ['pending_review', 'in_review', 'rejected', 'changes_requested'])),
    readAll('blog_url_dispositions', (from, to) => db.from('blog_url_dispositions')
      .select('creative_id,action,canonical_target,created_at').range(from, to)
      .order('created_at', { ascending: false })),
    readAll('blog_topic_queue', (from, to) => db.from('blog_topic_queue')
      .select('id,attempts,last_error,updated_at,content_creative_id').range(from, to)
      .eq('status', 'failed')),
    readAll('blog_topic_queue', (from, to) => db.from('blog_topic_queue')
      .select('id,status,content_creative_id').range(from, to)
      .eq('status', 'published')),
  ]);

  const latestDisposition = new Map<string, JsonRow>();
  for (const row of dispositionRows) {
    const id = String(row.creative_id ?? '');
    if (id && !latestDisposition.has(id)) latestDisposition.set(id, row);
  }
  const reviewBlocked = blockedRows.map((row) => {
    const existing = latestDisposition.get(String(row.id));
    return planReviewBlockedDispositionV4({
      creativeId: String(row.id),
      slug: String(row.slug),
      reviewStatus: String(row.review_status),
      canonicalTarget: typeof existing?.canonical_target === 'string' ? existing.canonical_target : null,
      existingAction: typeof existing?.action === 'string' ? existing.action : null,
    });
  });
  const failedQueue = failedRows.map((row) => classifyFailedBlogQueueV4({
    id: String(row.id),
    attempts: row.attempts == null ? null : Number(row.attempts),
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    contentCreativeId: typeof row.content_creative_id === 'string' ? row.content_creative_id : null,
  }));

  const creativeIds = [...new Set(publishedQueueRows.map((row) => String(row.content_creative_id ?? '')).filter(Boolean))];
  const creativeStatus = new Map<string, string>();
  for (let offset = 0; offset < creativeIds.length; offset += 200) {
    const { data, error } = await db.from('content_creatives').select('id,status').in('id', creativeIds.slice(offset, offset + 200));
    if (error) throw new Error(`published_creative_read_failed:${error.message}`);
    for (const row of data ?? []) creativeStatus.set(String(row.id), String(row.status));
  }
  const publishedQueueIssues = reconcilePublishedQueueV4(publishedQueueRows.map((row) => {
    const creativeId = typeof row.content_creative_id === 'string' ? row.content_creative_id : null;
    return {
      queueId: String(row.id),
      queueStatus: String(row.status),
      creativeId,
      creativeStatus: creativeId ? creativeStatus.get(creativeId) ?? null : null,
    };
  }));

  const pendingDispositions = reviewBlocked.filter((row) => !row.alreadyRecorded);
  let insertedDispositions = 0;
  if (apply && pendingDispositions.length) {
    const payload = pendingDispositions.map((row) => ({
      creative_id: row.creativeId,
      action: row.action,
      canonical_target: row.canonicalTarget,
      http_status: row.httpStatus,
      reason: row.reason,
    }));
    const { error } = await db.from('blog_url_dispositions').insert(payload);
    if (error) throw new Error(`disposition_apply_failed:${error.message}`);
    insertedDispositions = payload.length;
  }

  const report = {
    version: 'blog-corpus-reconciliation-v4',
    generatedAt: new Date().toISOString(),
    dryRun: !apply,
    summary: {
      reviewBlockedPublished: reviewBlocked.length,
      reviewBlockedWithDisposition: reviewBlocked.filter((row) => row.alreadyRecorded).length + insertedDispositions,
      dispositionWrites: insertedDispositions,
      failedQueue: failedQueue.length,
      retryTransient: failedQueue.filter((row) => row.action === 'retry_transient').length,
      archiveTerminal: failedQueue.filter((row) => row.action === 'archive_terminal').length,
      manualReview: failedQueue.filter((row) => row.action === 'manual_review').length,
      publishedQueueIssues: publishedQueueIssues.length,
    },
    reviewBlocked,
    failedQueue,
    publishedQueueIssues,
    applyLimitations: 'Only reviewed URL dispositions are inserted. Queue retries, archives, creative status, redirects, and indexing are never mutated by this script.',
  };
  mkdirSync('docs/audits', { recursive: true });
  writeFileSync('docs/audits/blog-corpus-reconciliation-v4-preview-2026-08-16.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(
    'docs/audits/blog-corpus-reconciliation-v4-preview-2026-08-16.csv',
    `${csv([
      ...reviewBlocked.map((row) => ({ kind: 'review_blocked', ...row })),
      ...failedQueue.map((row) => ({ kind: 'failed_queue', ...row })),
      ...publishedQueueIssues.map((row) => ({ kind: 'published_queue_issue', ...row })),
    ] as JsonRow[])}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`blog corpus reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
