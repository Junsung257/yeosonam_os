#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';
import {
  buildBlogPublishableDuplicateMeta,
  planBlogPublishableDuplicateCleanup,
} from '../src/lib/blog-publishable-duplicate-cleanup';

type QueueRow = {
  id: string;
  product_id: string | null;
  topic: string | null;
  destination: string | null;
  status: string | null;
  source: string | null;
  angle_type: string | null;
  priority: number | null;
  updated_at: string | null;
  meta: unknown;
};

type PublishedRow = {
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

async function loadActiveRows(limit: number): Promise<QueueRow[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,product_id,topic,destination,status,source,angle_type,priority,updated_at,meta')
    .in('status', ['queued', 'generating'])
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueRow[];
}

async function loadRecentPublishedRows(limit: number): Promise<PublishedRow[]> {
  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .select('id,product_id,slug,destination,status,angle_type,generation_meta')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PublishedRow[];
}

async function main() {
  const write = hasFlag('--write');
  const json = hasFlag('--json');
  const limit = numberArg('--limit', 300, 1000);
  const recentLimit = numberArg('--recent-limit', 500, 1000);
  const now = new Date().toISOString();
  const activeRows = await loadActiveRows(limit);
  const recentPublishedRows = await loadRecentPublishedRows(recentLimit);
  const actionPlan = planBlogPublishableDuplicateCleanup({
    activeRows,
    recentPublishedRows,
  });
  const rowsById = new Map(activeRows.map(row => [row.id, row]));
  const results: Array<Record<string, unknown>> = [];
  let updated = 0;

  for (const action of actionPlan) {
    const row = rowsById.get(action.id);
    if (!row) continue;
    const result: Record<string, unknown> = {
      queue_id: action.id,
      topic: row.topic,
      destination: row.destination,
      reason: action.reason,
      duplicate_key: action.duplicate_key,
      duplicate_keep_id: action.duplicate_keep_id,
    };
    if (write) {
      const { error } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({
          status: 'skipped',
          last_error: 'candidate_duplicate_preclaim',
          updated_at: now,
          meta: buildBlogPublishableDuplicateMeta({
            meta: row.meta,
            duplicateKey: action.duplicate_key,
            duplicateKeepId: action.duplicate_keep_id,
            reason: action.reason,
            checkedAt: now,
          }),
        } as never)
        .eq('id', action.id)
        .in('status', ['queued', 'generating']);
      if (error) result.update_error = error.message;
      else {
        updated += 1;
        result.after_status = 'skipped';
      }
    }
    results.push(result);
  }

  const report = {
    mode: write ? 'write' : 'dry-run',
    checked_at: now,
    scanned_active: activeRows.length,
    scanned_recent_published: recentPublishedRows.length,
    duplicate_candidates: actionPlan.length,
    updated,
    write_recommended: actionPlan.length > 0,
    results,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[blog-publishable-duplicates] mode=${report.mode} scanned_active=${report.scanned_active} duplicates=${report.duplicate_candidates} updated=${updated} write_recommended=${report.write_recommended}`);
    for (const row of results.slice(0, 25)) {
      console.log(`- ${row.reason} ${row.topic ?? ''}`);
    }
  }

  const failedUpdates = results.filter(row => row.update_error);
  if (failedUpdates.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
