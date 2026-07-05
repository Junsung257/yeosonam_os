#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';
import { getBlogQueueOperationalState } from '../src/lib/blog-queue-operational-health';
import {
  buildBlogEditorialBacklogRecheckDecision,
  buildBlogEditorialBacklogRecheckGuidance,
  readBlogEditorialBacklogDedupKey,
} from '../src/lib/blog-editorial-backlog-recheck';

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
  slug_hint: string | null;
  last_error: string | null;
  target_publish_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  meta: unknown;
  generation_meta?: unknown;
};

type ActiveQueueRow = {
  id: string;
  product_id: string | null;
  topic: string | null;
  destination: string | null;
  status: string | null;
  angle_type: string | null;
  slug_hint: string | null;
  meta: unknown;
  generation_meta?: unknown;
};

type RecentPublishedRow = {
  id: string;
  product_id: string | null;
  slug: string | null;
  destination: string | null;
  status: string | null;
  angle_type: string | null;
  generation_meta: unknown;
};

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function numberArg(name: string, fallback: number, max: number): number {
  const parsed = Number(argValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function asOperationalRow(row: QueueRow) {
  return {
    status: row.status,
    attempts: row.attempts,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    target_publish_at: row.target_publish_at,
    meta: row.meta,
  };
}

function isEditorialBacklogRow(row: QueueRow): boolean {
  return getBlogQueueOperationalState(asOperationalRow(row)).action === 'editorial_backlog';
}

async function loadRows(limit: number): Promise<QueueRow[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,product_id,topic,destination,source,status,attempts,priority,angle_type,last_error,target_publish_at,updated_at,created_at,meta')
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as QueueRow[]).filter(isEditorialBacklogRow);
}

async function loadActiveDedupKeys(): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  for (let from = 0; from < 1000; from += 500) {
    const { data, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('id,product_id,topic,destination,status,angle_type,meta')
      .in('status', ['queued', 'generating'])
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ActiveQueueRow[];
    for (const row of rows) {
      const key = readBlogEditorialBacklogDedupKey(row);
      if (key && !keys.has(key)) keys.set(key, row.id);
    }
    if (rows.length < 500) break;
  }

  for (let from = 0; from < 1000; from += 500) {
    const { data, error } = await supabaseAdmin
      .from('content_creatives')
      .select('id,product_id,slug,destination,status,angle_type,generation_meta')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RecentPublishedRow[];
    for (const row of rows) {
      const key = readBlogEditorialBacklogDedupKey({
        id: row.id,
        product_id: row.product_id,
        destination: row.destination,
        status: row.status,
        angle_type: row.angle_type,
        slug: row.slug,
        generation_meta: row.generation_meta,
      });
      if (key && !keys.has(key)) keys.set(key, row.id);
    }
    if (rows.length < 500) break;
  }

  return keys;
}

async function main() {
  const write = hasFlag('--write');
  const json = hasFlag('--json');
  const limit = numberArg('--limit', 120, 500);
  const now = new Date().toISOString();
  const rows = await loadRows(limit);
  const activeDedupKeys = await loadActiveDedupKeys();
  const requeuedKeys = new Map<string, string>();
  const results: Array<Record<string, unknown>> = [];
  let requeue = 0;
  let duplicateSkipped = 0;
  let retiredLegacySeeds = 0;
  let keepBlocked = 0;
  let updated = 0;

  for (const row of rows) {
    const dedupKey = readBlogEditorialBacklogDedupKey(row);
    const decision = buildBlogEditorialBacklogRecheckDecision({
      row,
      checkedAt: now,
      activeDuplicateId: dedupKey ? activeDedupKeys.get(dedupKey) : null,
      alreadyRequeuedId: dedupKey ? requeuedKeys.get(dedupKey) : null,
    });
    const result: Record<string, unknown> = {
      queue_id: row.id,
      topic: row.topic,
      destination: row.destination,
      source: row.source,
      before_status: row.status,
      action: decision.action,
      reasons: decision.reasons,
      dedup_key: decision.dedup_key,
    };

    if (decision.action === 'requeue') {
      requeue += 1;
      if (dedupKey) requeuedKeys.set(dedupKey, row.id);
      if (write) {
        const { error } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'queued',
            attempts: 0,
            last_error: null,
            target_publish_at: now,
            updated_at: now,
            priority: Math.max(Number(row.priority ?? 0), 80),
            meta: decision.meta,
          } as never)
          .eq('id', row.id)
          .eq('status', 'failed');
        if (error) result.update_error = error.message;
        else {
          updated += 1;
          result.after_status = 'queued';
        }
      }
    } else if (decision.action === 'skip_duplicate') {
      duplicateSkipped += 1;
      if (write) {
        const { error } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'skipped',
            attempts: Math.max(Number(row.attempts ?? 0), 2),
            last_error: decision.last_error,
            updated_at: now,
            meta: decision.meta,
          } as never)
          .eq('id', row.id)
          .eq('status', 'failed');
        if (error) result.update_error = error.message;
        else {
          updated += 1;
          result.after_status = 'skipped';
        }
      }
    } else if (decision.action === 'retire_legacy_seed') {
      retiredLegacySeeds += 1;
      if (write) {
        const { error } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'skipped',
            attempts: Math.max(Number(row.attempts ?? 0), 3),
            last_error: decision.last_error,
            updated_at: now,
            meta: decision.meta,
          } as never)
          .eq('id', row.id)
          .eq('status', 'failed');
        if (error) result.update_error = error.message;
        else {
          updated += 1;
          result.after_status = 'skipped';
        }
      }
    } else {
      keepBlocked += 1;
      if (write) {
        const { error } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            last_error: decision.last_error,
            updated_at: now,
            meta: decision.meta,
          } as never)
          .eq('id', row.id)
          .eq('status', 'failed');
        if (error) result.update_error = error.message;
        else updated += 1;
      }
    }

    results.push(result);
  }

  const guidance = buildBlogEditorialBacklogRecheckGuidance({
    requeue,
    duplicateSkipped,
    retiredLegacySeeds,
  });
  const report = {
    mode: write ? 'write' : 'dry-run',
    checked_at: now,
    scanned: rows.length,
    requeue,
    duplicate_skipped: duplicateSkipped,
    retired_legacy_seed: retiredLegacySeeds,
    keep_blocked: keepBlocked,
    updated,
    ...guidance,
    results,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[blog-editorial-backlog-recheck] mode=${report.mode} scanned=${report.scanned} requeue=${requeue} duplicate_skipped=${duplicateSkipped} retired_legacy_seed=${retiredLegacySeeds} keep_blocked=${keepBlocked} updated=${updated} write_recommended=${guidance.write_recommended}`);
    if (guidance.write_reasons.length > 0) console.log(`write_reasons=${guidance.write_reasons.join(',')}`);
    for (const row of results.slice(0, 25)) {
      console.log(`- ${row.action} ${row.topic ?? ''}`);
    }
  }

  const failedUpdates = results.filter(row => row.update_error);
  if (failedUpdates.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
