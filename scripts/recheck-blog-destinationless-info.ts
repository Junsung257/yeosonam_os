#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';
import {
  buildDestinationlessInfoGenericMeta,
  classifyDestinationlessInfoCandidate,
} from '../src/lib/blog-destinationless-info';

type QueueRow = {
  id: string;
  topic: string | null;
  destination: string | null;
  source: string | null;
  status: string | null;
  attempts: number | null;
  priority: number | null;
  primary_keyword: string | null;
  category: string | null;
  product_id: string | null;
  meta: Record<string, unknown> | null;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function numberArg(name: string, fallback: number, max: number): number {
  const parsed = Number(argValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

async function loadRows(limit: number): Promise<QueueRow[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,topic,destination,source,status,attempts,priority,primary_keyword,category,product_id,meta')
    .in('status', ['queued', 'generating'])
    .is('destination', null)
    .is('product_id', null)
    .order('priority', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueRow[];
}

async function main() {
  const write = hasFlag('--write');
  const json = hasFlag('--json');
  const limit = numberArg('--limit', 200, 1000);
  const now = new Date().toISOString();
  const rows = await loadRows(limit);
  const results: Array<Record<string, unknown>> = [];
  let markedGeneric = 0;
  let skippedMissingDestination = 0;
  let alreadyGeneric = 0;
  let unchanged = 0;
  let updated = 0;

  for (const row of rows) {
    const issue = classifyDestinationlessInfoCandidate(row);
    if (!issue) continue;
    const result: Record<string, unknown> = {
      queue_id: row.id,
      topic: row.topic,
      source: row.source,
      status: row.status,
      issue,
      action: 'none',
    };

    if (issue === 'intentionally_generic') {
      alreadyGeneric += 1;
      result.action = 'already_generic';
    } else if (issue === 'generic_unmarked') {
      markedGeneric += 1;
      result.action = 'mark_intentionally_generic';
      if (write) {
        const { error } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            updated_at: now,
            meta: buildDestinationlessInfoGenericMeta({ row, checkedAt: now }),
          } as never)
          .eq('id', row.id)
          .in('status', ['queued', 'generating']);
        if (error) result.update_error = error.message;
        else updated += 1;
      }
    } else if (issue === 'missing_destination') {
      skippedMissingDestination += 1;
      result.action = 'skip_missing_destination';
      if (write) {
        const { error } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'skipped',
            attempts: Math.max(Number(row.attempts ?? 0), 2),
            last_error: 'destinationless_info_missing_destination',
            updated_at: now,
            meta: {
              ...(row.meta ?? {}),
              self_heal_blocked: true,
              quarantine_reason: 'missing_destination',
              failure_code: 'missing_destination',
              skipped_by: 'blog-destinationless-info-recheck',
              skipped_at: now,
            },
          } as never)
          .eq('id', row.id)
          .in('status', ['queued', 'generating']);
        if (error) result.update_error = error.message;
        else {
          updated += 1;
          result.after_status = 'skipped';
        }
      }
    } else {
      unchanged += 1;
    }

    results.push(result);
  }

  const writeReasons = [
    ...(markedGeneric > 0 ? ['mark_intentionally_generic_info_rows'] : []),
    ...(skippedMissingDestination > 0 ? ['skip_missing_destination_info_rows'] : []),
  ];
  const report = {
    mode: write ? 'write' : 'dry-run',
    checked_at: now,
    scanned: rows.length,
    marked_generic: markedGeneric,
    skipped_missing_destination: skippedMissingDestination,
    already_generic: alreadyGeneric,
    unchanged,
    updated,
    write_recommended: writeReasons.length > 0,
    write_reasons: writeReasons,
    results,
  };

  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[blog-destinationless-info-recheck] mode=${report.mode} scanned=${report.scanned} marked_generic=${markedGeneric} skipped_missing_destination=${skippedMissingDestination} updated=${updated} write_recommended=${report.write_recommended}`);
    if (writeReasons.length > 0) console.log(`write_reasons=${writeReasons.join(',')}`);
    for (const row of results.slice(0, 25)) {
      console.log(`- ${row.action} ${row.topic ?? ''}`);
    }
  }

  if (results.some(row => row.update_error)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
