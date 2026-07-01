#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';
import { loadCustomerOpenContractForPackage } from '../src/lib/product-registration/customer-open-contract';
import { buildBlogProductEvidenceRecheckDecision } from '../src/lib/blog-product-evidence-recheck';

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

async function main() {
  const write = hasFlag('--write');
  const json = hasFlag('--json');
  const limit = numberArg('--limit', 100, 500);
  const now = new Date().toISOString();
  const rows = await loadRows(limit);
  const results: Array<Record<string, unknown>> = [];
  let requeue = 0;
  let duplicateSkipped = 0;
  let keepBlocked = 0;
  let updated = 0;
  const requeuedProductIds = new Set<string>();

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

    if (decision.action === 'requeue' && requeuedProductIds.has(row.product_id as string)) {
      duplicateSkipped += 1;
      result.action = 'skip_duplicate_product';
      if (write) {
        const meta = {
          ...decision.meta,
          duplicate_product_recheck: true,
          duplicate_product_recheck_at: now,
        };
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
      requeuedProductIds.add(row.product_id as string);
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

  const report = {
    mode: write ? 'write' : 'dry-run',
    checked_at: now,
    scanned: rows.length,
    requeue,
    duplicate_skipped: duplicateSkipped,
    keep_blocked: keepBlocked,
    updated,
    results,
  };

  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[blog-product-evidence-recheck] mode=${report.mode} scanned=${report.scanned} requeue=${requeue} duplicate_skipped=${duplicateSkipped} keep_blocked=${keepBlocked} updated=${updated}`);
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
