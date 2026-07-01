import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { shouldSelfHealBlogQueueItem } from '../src/lib/blog-queue-failure-policy';
import {
  classifyBlogQueueOperationalIssue,
  getBlogQueueOperationalState,
  summarizeBlogQueueOperationalHealth,
  type BlogQueueOperationalRow,
} from '../src/lib/blog-queue-operational-health';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

const args = process.argv.slice(2);
const write = args.includes('--write');
const json = args.includes('--json');
const limitArg = Number(args.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? 200);
const staleMinutesArg = Number(args.find((arg) => arg.startsWith('--stale-minutes='))?.split('=')[1] ?? 30);
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.min(limitArg, 1000) : 200;
const staleMinutes = Number.isFinite(staleMinutesArg) && staleMinutesArg > 0 ? staleMinutesArg : 30;

type QueueRow = BlogQueueOperationalRow & {
  id: string;
  source?: string | null;
  product_id?: string | null;
  meta?: Record<string, unknown> | null;
};

function asMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? { ...(meta as Record<string, unknown>) }
    : {};
}

function needsFailureMetaRepair(row: QueueRow, issue: string): boolean {
  const meta = asMeta(row.meta);
  const failureCode = typeof meta.failure_code === 'string' ? meta.failure_code : null;
  const quarantineReason = typeof meta.quarantine_reason === 'string' ? meta.quarantine_reason : null;
  const state = getBlogQueueOperationalState(row);

  if (row.status !== 'failed') return false;
  if (failureCode !== issue && issue !== 'other') return true;
  if (state.terminal && !state.retryable && meta.self_heal_blocked !== true) return true;
  if (state.terminal && !state.retryable && !quarantineReason) return true;
  return false;
}

async function updateRow(id: string, payload: Record<string, unknown>) {
  if (!write) return { dryRun: true, error: null };
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase
    .from('blog_topic_queue')
    .update(payload as never)
    .eq('id', id);
  return { dryRun: false, error };
}

async function main() {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - staleMinutes * 60 * 1000);
  const { data, error } = await supabase
    .from('blog_topic_queue')
    .select('id, status, source, product_id, attempts, last_error, created_at, updated_at, target_publish_at, meta')
    .in('status', ['queued', 'generating', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data || []) as QueueRow[];
  const before = summarizeBlogQueueOperationalHealth(rows, now);
  const actions: Array<Record<string, unknown>> = [];
  let staleRecovered = 0;
  let staleClosed = 0;
  let metaRepaired = 0;

  for (const row of rows) {
    const meta = asMeta(row.meta);
    const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
    const issue = classifyBlogQueueOperationalIssue(row);

    if (row.status === 'generating' && (!updatedAt || updatedAt < cutoff)) {
      const canRequeue = Number(row.attempts || 0) < 2 && shouldSelfHealBlogQueueItem({
        lastError: row.last_error,
        meta,
      });
      const payload = canRequeue
        ? {
            status: 'queued',
            target_publish_at: now.toISOString(),
            updated_at: now.toISOString(),
            last_error: `ops cleanup recovered stale generating ${now.toISOString()}: ${row.last_error || ''}`.slice(0, 500),
            meta: {
              ...meta,
              recovered_by: 'cleanup-blog-queue-health',
              stale_generating_recovered_at: now.toISOString(),
              stale_generating_attempts: row.attempts || 0,
            },
          }
        : {
            status: 'failed',
            attempts: Math.max(2, Number(row.attempts || 0)),
            updated_at: now.toISOString(),
            last_error: `ops cleanup closed stale generating ${now.toISOString()}: ${row.last_error || ''}`.slice(0, 500),
            meta: {
              ...meta,
              failure_code: issue,
              self_heal_blocked: true,
              quarantine_reason: issue === 'unknown_failure' || issue === 'none' ? 'stale_generating' : issue,
              stale_generating_closed_at: now.toISOString(),
              stale_generating_attempts: row.attempts || 0,
            },
          };
      const result = await updateRow(row.id, payload);
      if (!result.error) {
        if (canRequeue) staleRecovered += 1;
        else staleClosed += 1;
      }
      actions.push({
        id: row.id,
        status_before: row.status,
        action: canRequeue ? 'recover_stale_generating' : 'close_stale_generating',
        issue,
        write,
        error: result.error ? result.error.message : null,
      });
      continue;
    }

    if (needsFailureMetaRepair(row, issue)) {
      const state = getBlogQueueOperationalState(row, now);
      const payload = {
        updated_at: now.toISOString(),
        meta: {
          ...meta,
          failure_code: issue,
          ...(state.terminal && !state.retryable ? {
            self_heal_blocked: true,
            quarantine_reason: typeof meta.quarantine_reason === 'string'
              ? meta.quarantine_reason
              : issue,
          } : {}),
          operational_health_repaired_at: now.toISOString(),
          operational_health_repaired_by: 'cleanup-blog-queue-health',
        },
      };
      const result = await updateRow(row.id, payload);
      if (!result.error) metaRepaired += 1;
      actions.push({
        id: row.id,
        status_before: row.status,
        action: 'repair_failure_meta',
        issue,
        write,
        error: result.error ? result.error.message : null,
      });
    }
  }

  const { data: afterRows } = await supabase
    .from('blog_topic_queue')
    .select('id, status, attempts, last_error, created_at, updated_at, target_publish_at, meta')
    .in('status', ['queued', 'generating', 'failed'])
    .limit(1000);

  const report = {
    mode: write ? 'write' : 'dry-run',
    scanned: rows.length,
    stale_minutes: staleMinutes,
    before,
    after: summarizeBlogQueueOperationalHealth((afterRows || []) as BlogQueueOperationalRow[], now),
    changed: {
      stale_generating_recovered: staleRecovered,
      stale_generating_closed: staleClosed,
      failure_meta_repaired: metaRepaired,
      total: staleRecovered + staleClosed + metaRepaired,
    },
    actions,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`[cleanup-blog-queue-health] mode=${report.mode} scanned=${report.scanned} changed=${report.changed.total}`);
  console.log(`stale recovered=${staleRecovered} closed=${staleClosed} meta_repaired=${metaRepaired}`);
  console.log(`actionable_failed before=${before.actionable_failed_count} after=${report.after.actionable_failed_count}`);
  if (!write && actions.length > 0) {
    console.log('Dry-run only. Re-run with --write to apply safe queue health repairs.');
  }
}

main().catch((error) => {
  console.error('[cleanup-blog-queue-health] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
