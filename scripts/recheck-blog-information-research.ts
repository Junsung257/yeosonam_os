#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';
import { readBlogEditorialBacklogDedupKey } from '../src/lib/blog-editorial-backlog-recheck';
import { buildBlogInformationResearchRecheckDecision } from '../src/lib/blog-information-research-recheck';

type QueueRow = {
  id: string;
  product_id: string | null;
  topic: string | null;
  destination: string | null;
  source: string | null;
  status: string | null;
  attempts: number | null;
  priority: number | null;
  angle_type: string | null;
  last_error: string | null;
  meta: unknown;
};

function value(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() || null;
}

function limitValue(): number {
  const parsed = Number(value('--limit'));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 120;
}

async function loadResearchFailureRows(
  limit: number,
  destination: string | null,
  queueId: string | null,
): Promise<QueueRow[]> {
  let query = supabaseAdmin
    .from('blog_topic_queue')
    .select('id,product_id,topic,destination,source,status,attempts,priority,angle_type,last_error,meta')
    .in('status', ['failed', 'skipped'])
    .is('product_id', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (destination) query = query.eq('destination', destination);
  if (queueId) query = query.eq('id', queueId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueRow[];
}

async function loadExistingDedupKeys(): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  const { data: queueRows, error: queueError } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,product_id,topic,destination,status,angle_type,meta')
    .in('status', ['queued', 'generating'])
    .limit(1000);
  if (queueError) throw new Error(queueError.message);
  for (const row of (queueRows ?? []) as QueueRow[]) {
    const key = readBlogEditorialBacklogDedupKey(row);
    if (key && !keys.has(key)) keys.set(key, row.id);
  }

  const { data: publishedRows, error: publishedError } = await supabaseAdmin
    .from('content_creatives')
    .select('id,product_id,slug,destination,status,angle_type,generation_meta')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .limit(1000);
  if (publishedError) throw new Error(publishedError.message);
  for (const row of publishedRows ?? []) {
    const key = readBlogEditorialBacklogDedupKey(row);
    if (key && !keys.has(key)) keys.set(key, String(row.id));
  }
  return keys;
}

async function main() {
  const write = process.argv.includes('--write');
  const destination = value('--destination');
  const queueId = value('--queue-id');
  const checkedAt = new Date().toISOString();
  const rows = await loadResearchFailureRows(limitValue(), destination, queueId);
  const existingKeys = await loadExistingDedupKeys();
  const requeuedThisRun = new Map<string, string>();
  const results: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const key = readBlogEditorialBacklogDedupKey(row);
    const decision = buildBlogInformationResearchRecheckDecision({
      row,
      checkedAt,
      activeDuplicateId: key ? existingKeys.get(key) : null,
      alreadyRequeuedId: key ? requeuedThisRun.get(key) : null,
    });
    if (!write && decision.action === 'requeue' && key) {
      requeuedThisRun.set(key, row.id);
    }
    let updated = false;
    let updateError: string | null = null;

    if (write && decision.action === 'requeue') {
      const { error } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({
          status: 'queued',
          attempts: 0,
          last_error: null,
          target_publish_at: null,
          priority: Math.max(Number(row.priority ?? 0), 90),
          meta: decision.meta,
          updated_at: checkedAt,
        } as never)
        .eq('id', row.id)
        .eq('status', row.status);
      updateError = error?.message ?? null;
      updated = !error;
      if (updated && key) requeuedThisRun.set(key, row.id);
    } else if (write && decision.action === 'skip_duplicate') {
      const { error } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({
          status: 'skipped',
          last_error: 'information_research_recheck_duplicate',
          meta: decision.meta,
          updated_at: checkedAt,
        } as never)
        .eq('id', row.id)
        .eq('status', row.status);
      updateError = error?.message ?? null;
      updated = !error;
    }

    results.push({
      queue_id: row.id,
      destination: row.destination,
      topic: row.topic,
      action: decision.action,
      intent: decision.intent,
      reason: decision.reason,
      dedup_key: decision.dedupKey,
      updated,
      update_error: updateError,
    });
  }

  const counts = results.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.action);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    mode: write ? 'write' : 'dry-run',
    checked_at: checkedAt,
    destination,
    queue_id: queueId,
    scanned: rows.length,
    counts,
    updated: results.filter((row) => row.updated).length,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
