#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';
import { loadCustomerOpenContractForPackage } from '../src/lib/product-registration/customer-open-contract';
import {
  buildBlogProductEvidenceDuplicateMeta,
  buildBlogProductEvidenceRecheckDecision,
  buildBlogProductEvidenceRecheckGuidance,
  readBlogProductEvidenceDedupKey,
} from '../src/lib/blog-product-evidence-recheck';

type QueueRow = {
  id: string;
  product_id: string | null;
  topic: string | null;
  destination: string | null;
  status: string | null;
  attempts: number | null;
  priority: number | null;
  last_error: string | null;
  target_publish_at: string | null;
  updated_at: string | null;
  meta: unknown;
};

type ActiveProductQueueRow = {
  id: string;
  product_id: string | null;
  meta: unknown;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isProductOpenContractRow(row: QueueRow): boolean {
  const meta = asRecord(row.meta);
  return row.product_id !== null && (
    meta.failure_code === 'product_open_contract' ||
    meta.quarantine_reason === 'product_open_contract' ||
    /product_customer_open_contract_failed|customer_open_contract|mobile_proof|registration_evidence_pack|blog_publish/i.test(row.last_error ?? '')
  );
}

async function loadRows(limit: number): Promise<QueueRow[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,product_id,topic,destination,status,attempts,priority,last_error,target_publish_at,updated_at,meta')
    .eq('status', 'failed')
    .not('product_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as QueueRow[]).filter(isProductOpenContractRow);
}

async function loadActiveProductDedupKeys(): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  for (let from = 0; from < 1000; from += 500) {
    const { data, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('id,product_id,meta')
      .in('status', ['queued', 'generating'])
      .not('product_id', 'is', null)
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ActiveProductQueueRow[];
    for (const row of rows) {
      const key = readBlogProductEvidenceDedupKey({
        product_id: row.product_id,
        meta: row.meta,
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
  const limit = numberArg('--limit', 100, 500);
  const now = new Date().toISOString();
  const rows = await loadRows(limit);
  const activeProductDedupKeys = await loadActiveProductDedupKeys();
  const results: Array<Record<string, unknown>> = [];
  let requeue = 0;
  let duplicateSkipped = 0;
  let keepBlocked = 0;
  let updated = 0;
  const requeuedProductKeys = new Map<string, string>();

  for (const row of rows) {
    const contract = await loadCustomerOpenContractForPackage(supabaseAdmin, row.product_id as string);
    const decision = buildBlogProductEvidenceRecheckDecision({
      meta: row.meta,
      contractOk: contract.ok,
      blockers: contract.blockers,
      checkedAt: now,
    });

    const result: Record<string, unknown> = {
      queue_id: row.id,
      product_id: row.product_id,
      topic: row.topic,
      destination: row.destination,
      before_status: row.status,
      action: decision.action,
      blockers: contract.blockers,
    };
    const dedupKey = readBlogProductEvidenceDedupKey({
      product_id: row.product_id,
      meta: decision.meta,
    });
    const activeDuplicateId = dedupKey ? activeProductDedupKeys.get(dedupKey) : null;
    const alreadyRequeuedId = dedupKey ? requeuedProductKeys.get(dedupKey) : null;

    if (decision.action === 'requeue' && (activeDuplicateId || alreadyRequeuedId)) {
      duplicateSkipped += 1;
      result.action = 'skip_duplicate_product';
      result.duplicate_key = dedupKey;
      result.duplicate_keep_id = activeDuplicateId ?? alreadyRequeuedId;
      if (write) {
        const meta = buildBlogProductEvidenceDuplicateMeta({
          meta: decision.meta,
          checkedAt: now,
          duplicateKey: dedupKey,
          duplicateKeepId: activeDuplicateId ?? alreadyRequeuedId,
        });
        const { error } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'skipped',
            attempts: Math.max(Number(row.attempts ?? 0), 2),
            last_error: 'product_open_contract_recheck_duplicate_product',
            updated_at: now,
            meta,
          } as never)
          .eq('id', row.id)
          .eq('status', 'failed');
        if (error) {
          result.update_error = error.message;
        } else {
          updated += 1;
          result.after_status = 'skipped';
        }
      }
    } else if (decision.action === 'requeue') {
      requeue += 1;
      if (dedupKey) requeuedProductKeys.set(dedupKey, row.id);
      if (write) {
        const { error } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'queued',
            attempts: 0,
            last_error: null,
            target_publish_at: now,
            updated_at: now,
            priority: Math.max(Number(row.priority ?? 0), 85),
            meta: decision.meta,
          } as never)
          .eq('id', row.id)
          .eq('status', 'failed');
        if (error) {
          result.update_error = error.message;
        } else {
          updated += 1;
          result.after_status = 'queued';
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

  const guidance = buildBlogProductEvidenceRecheckGuidance({
    requeue,
    duplicateSkipped,
    keepBlocked,
  });
  const report = {
    mode: write ? 'write' : 'dry-run',
    checked_at: now,
    scanned: rows.length,
    requeue,
    duplicate_skipped: duplicateSkipped,
    keep_blocked: keepBlocked,
    updated,
    ...guidance,
    results,
  };

  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[blog-product-evidence-recheck] mode=${report.mode} scanned=${report.scanned} requeue=${requeue} duplicate_skipped=${duplicateSkipped} keep_blocked=${keepBlocked} updated=${updated} write_recommended=${guidance.write_recommended}`);
    if (guidance.write_reasons.length > 0) {
      console.log(`write_reasons=${guidance.write_reasons.join(',')}`);
    }
    if (guidance.metadata_refresh_available) {
      console.log('metadata_refresh_available=true');
    }
    for (const row of results.slice(0, 20)) {
      console.log(`- ${row.action} ${row.product_id} ${row.topic ?? ''}`);
    }
  }

  const failedUpdates = results.filter(row => row.update_error);
  if (failedUpdates.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
