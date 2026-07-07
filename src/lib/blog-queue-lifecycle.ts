import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { classifyBlogQueueFailure } from '@/lib/blog-queue-failure-policy';
import { getBlogQueueOperationalState, type BlogQueueOperationalRow } from '@/lib/blog-queue-operational-health';
import {
  customerOpenContractBlogBlockReason,
  isCustomerOpenContractBlogPublishable,
  loadCustomerOpenContractForPackage,
} from '@/lib/product-registration/customer-open-contract';
import { inspectBlogCandidatePrepublishContract } from '@/lib/blog-candidate-prepublish-contract';
import { isRetiredBlogProductStatus } from '@/lib/blog-product-status';
import {
  buildBlogProductEvidenceArchivedProductDecision,
  buildBlogProductEvidenceDuplicateMeta,
  buildBlogProductEvidenceRecheckDecision,
  readBlogProductEvidenceDedupKey,
} from '@/lib/blog-product-evidence-recheck';
import {
  buildBlogEditorialBacklogRecheckDecision,
  readBlogEditorialBacklogDedupKey,
} from '@/lib/blog-editorial-backlog-recheck';

/**
 * 판매 불가·아카이브 등으로 블로그 자동발행 큐를 중단한다.
 * - product_id 직결 항목
 * - 동일 패키지를 물고 있는 card_news 경로 항목
 */
export async function skipBlogQueueForPackages(
  packageIds: string[],
  reason: string,
): Promise<{ skipped: number }> {
  if (!isSupabaseConfigured || packageIds.length === 0) return { skipped: 0 };

  const now = new Date().toISOString();
  const baseMeta = {
    cancelled_at: now,
    cancel_reason: reason,
  };

  let skipped = 0;

  const mergeMeta = (prev: unknown) => ({
    ...(typeof prev === 'object' && prev !== null && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {}),
    ...baseMeta,
  });

  const { data: qProduct } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, meta')
    .in('product_id', packageIds)
    .in('status', ['queued', 'generating']);

  for (const row of qProduct || []) {
    const { error } = await supabaseAdmin
      .from('blog_topic_queue')
      .update({
        status: 'skipped',
        last_error: reason,
        updated_at: now,
        meta: mergeMeta((row as { meta?: unknown }).meta) as never,
      })
      .eq('id', (row as { id: string }).id);
    if (!error) skipped += 1;
  }

  const { data: cnRows } = await supabaseAdmin
    .from('card_news')
    .select('id')
    .in('package_id', packageIds);

  const cardIds = (cnRows || []).map((r: { id: string }) => r.id).filter(Boolean);
  if (cardIds.length === 0) return { skipped };

  const { data: qCard } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, meta')
    .in('card_news_id', cardIds)
    .in('status', ['queued', 'generating']);

  for (const row of qCard || []) {
    const { error } = await supabaseAdmin
      .from('blog_topic_queue')
      .update({
        status: 'skipped',
        last_error: reason,
        updated_at: now,
        meta: mergeMeta((row as { meta?: unknown }).meta) as never,
      })
      .eq('id', (row as { id: string }).id);
    if (!error) skipped += 1;
  }

  return { skipped };
}

export function shouldQuarantineQueuedBlogItem(input: {
  attempts?: number | null;
  lastError?: string | null;
  meta?: unknown;
  maxAttempts?: number;
}): { quarantine: boolean; status: 'failed' | 'skipped'; reason: string | null } {
  const meta = input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
    ? input.meta as Record<string, unknown>
    : {};
  const lastError = input.lastError ?? '';
  const storedFailureCode = typeof meta.failure_code === 'string' && meta.failure_code !== 'unknown'
    ? meta.failure_code
    : null;
  const decision = classifyBlogQueueFailure(storedFailureCode || lastError);
  const attempts = input.attempts ?? 0;
  const maxAttempts = input.maxAttempts ?? 2;
  const explicitlyBlocked =
    meta.self_heal_blocked === true ||
    meta.evidence_insufficient === true ||
    typeof meta.quarantine_reason === 'string';

  if (!lastError && !storedFailureCode && !explicitlyBlocked && attempts < maxAttempts) {
    return { quarantine: false, status: 'failed', reason: null };
  }

  if (meta.evidence_insufficient === true || storedFailureCode === 'evidence_insufficient') {
    return { quarantine: true, status: 'failed', reason: 'evidence_insufficient' };
  }

  if (decision.skipped) {
    return { quarantine: true, status: 'skipped', reason: decision.code };
  }

  if (explicitlyBlocked || !decision.retryable || attempts >= maxAttempts) {
    return { quarantine: true, status: 'failed', reason: decision.code };
  }

  return { quarantine: false, status: 'failed', reason: null };
}

function buildProductOpenContractFailure(blockers: string[]): string {
  const summary = blockers.slice(0, 5).join('|') || 'unknown_product_open_contract_blocker';
  return `product_customer_open_contract_failed:${summary}`;
}

export async function quarantineNonRetryableBlogQueueItems(opts?: {
  limit?: number;
  maxAttempts?: number;
}): Promise<{ scanned: number; quarantined: number; skipped: number; failed: number }> {
  if (!isSupabaseConfigured) return { scanned: 0, quarantined: 0, skipped: 0, failed: 0 };

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, attempts, last_error, meta, product_id, source, topic, destination, primary_keyword')
    .eq('status', 'queued')
    .or(`target_publish_at.is.null,target_publish_at.lte.${now}`)
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: true })
    .limit(opts?.limit ?? 60);

  if (error || !data || data.length === 0) {
    return { scanned: data?.length ?? 0, quarantined: 0, skipped: 0, failed: 0 };
  }

  let quarantined = 0;
  let skipped = 0;
  let failed = 0;
  const productContractCache = new Map<string, string | null>();

  for (const row of data as Array<{
    id: string;
    attempts: number | null;
    last_error: string | null;
    meta?: unknown;
    product_id?: string | null;
    source?: string | null;
    topic?: string | null;
    destination?: string | null;
    primary_keyword?: string | null;
  }>) {
    let lastError = row.last_error ?? null;
    let forcedReason: string | null = null;
    const candidateContract = inspectBlogCandidatePrepublishContract({
      topic: row.topic,
      destination: row.destination,
      primary_keyword: row.primary_keyword,
      meta: row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
        ? row.meta as Record<string, unknown>
        : null,
    });
    if (!candidateContract.passed) {
      lastError = `candidate_pre_publish_contract:${candidateContract.issues.map((issue) => issue.code).join('|')}`;
      forcedReason = 'candidate_pre_publish_contract';
    }
    if (row.product_id) {
      if (!productContractCache.has(row.product_id)) {
        try {
          const contract = await loadCustomerOpenContractForPackage(supabaseAdmin, row.product_id);
          productContractCache.set(
            row.product_id,
            isCustomerOpenContractBlogPublishable(contract)
              ? null
              : buildProductOpenContractFailure([customerOpenContractBlogBlockReason(contract)]),
          );
        } catch (err) {
          productContractCache.set(
            row.product_id,
            `product_customer_open_contract_failed:contract_lookup_error:${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      const contractFailure = productContractCache.get(row.product_id) ?? null;
      if (contractFailure) {
        lastError = contractFailure;
        forcedReason = 'product_open_contract';
      }
    }

    const decision = shouldQuarantineQueuedBlogItem({
      attempts: row.attempts,
      lastError,
      meta: row.meta,
      maxAttempts: opts?.maxAttempts,
    });
    const shouldQuarantine = forcedReason ? true : decision.quarantine;
    if (!shouldQuarantine) continue;

    const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
      ? row.meta as Record<string, unknown>
      : {};
    const reason = forcedReason ?? decision.reason ?? 'publisher_preflight';
    const status = forcedReason === 'candidate_pre_publish_contract'
      ? 'skipped'
      : forcedReason
        ? 'failed'
        : decision.status;
    const { error: updateError } = await supabaseAdmin
      .from('blog_topic_queue')
      .update({
        status,
        last_error: lastError ?? `publisher preflight quarantine: ${reason}`,
        updated_at: now,
        meta: {
          ...meta,
          failure_code: reason,
          self_heal_blocked: true,
          quarantine_reason: reason,
          quarantined_by: 'blog-publisher-preflight',
          quarantined_at: now,
        },
      } as never)
      .eq('id', row.id)
      .eq('status', 'queued');

    if (!updateError) {
      quarantined += 1;
      if (status === 'skipped') skipped += 1;
      else failed += 1;
    }
  }

  return { scanned: data.length, quarantined, skipped, failed };
}

type RecoverableQueueRow = {
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
  created_at: string | null;
  updated_at: string | null;
  meta: unknown;
};

type ActiveDedupRow = {
  id: string;
  product_id: string | null;
  topic?: string | null;
  destination?: string | null;
  status?: string | null;
  angle_type?: string | null;
  slug_hint?: string | null;
  slug?: string | null;
  meta?: unknown;
  generation_meta?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isProductEvidenceRecoveryRow(row: RecoverableQueueRow): boolean {
  const meta = asRecord(row.meta);
  return Boolean(row.product_id) && (
    meta.failure_code === 'product_open_contract' ||
    meta.quarantine_reason === 'product_open_contract' ||
    /product_customer_open_contract_failed|customer_open_contract|mobile_proof|registration_evidence_pack|blog_publish/i.test(row.last_error ?? '')
  );
}

function asOperationalRow(row: RecoverableQueueRow): BlogQueueOperationalRow {
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

async function loadActiveProductDedupKeys(): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,product_id,meta')
    .in('status', ['queued', 'generating'])
    .not('product_id', 'is', null)
    .limit(1000);
  if (error) return keys;
  for (const row of (data ?? []) as ActiveDedupRow[]) {
    const key = readBlogProductEvidenceDedupKey({ product_id: row.product_id, meta: row.meta });
    if (key && !keys.has(key)) keys.set(key, row.id);
  }
  return keys;
}

async function loadActiveEditorialDedupKeys(): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  const { data: activeRows } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,product_id,topic,destination,status,angle_type,slug_hint,meta')
    .in('status', ['queued', 'generating'])
    .limit(1000);
  for (const row of (activeRows ?? []) as ActiveDedupRow[]) {
    const key = readBlogEditorialBacklogDedupKey(row);
    if (key && !keys.has(key)) keys.set(key, row.id);
  }

  const { data: publishedRows } = await supabaseAdmin
    .from('content_creatives')
    .select('id,product_id,slug,destination,status,angle_type,generation_meta')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1000);
  for (const row of (publishedRows ?? []) as ActiveDedupRow[]) {
    const key = readBlogEditorialBacklogDedupKey(row);
    if (key && !keys.has(key)) keys.set(key, row.id);
  }
  return keys;
}

export async function recoverRequeueableFailedBlogQueueItems(opts?: {
  limit?: number;
  recoveredBy?: string;
}): Promise<{
  scanned: number;
  requeued: number;
  skipped: number;
  kept_blocked: number;
  errors: string[];
}> {
  if (!isSupabaseConfigured) return { scanned: 0, requeued: 0, skipped: 0, kept_blocked: 0, errors: [] };

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,product_id,topic,destination,source,status,attempts,priority,angle_type,slug_hint,last_error,target_publish_at,created_at,updated_at,meta')
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 80);
  if (error || !data) {
    return { scanned: 0, requeued: 0, skipped: 0, kept_blocked: 0, errors: [error?.message ?? 'recoverable_queue_scan_failed'] };
  }

  const rows = data as RecoverableQueueRow[];
  const productDedupKeys = await loadActiveProductDedupKeys();
  const editorialDedupKeys = await loadActiveEditorialDedupKeys();
  const requeuedProductKeys = new Map<string, string>();
  const requeuedEditorialKeys = new Map<string, string>();
  const productStatusCache = new Map<string, string | null>();
  let requeued = 0;
  let skipped = 0;
  let keptBlocked = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      if (isProductEvidenceRecoveryRow(row) && row.product_id) {
        if (!productStatusCache.has(row.product_id)) {
          const { data: product } = await supabaseAdmin
            .from('travel_packages')
            .select('id,status')
            .eq('id', row.product_id)
            .maybeSingle();
          productStatusCache.set(row.product_id, (product as { status?: string | null } | null)?.status ?? null);
        }
        const productStatus = productStatusCache.get(row.product_id) ?? null;
        const retiredProduct = isRetiredBlogProductStatus(productStatus);
        const contract = retiredProduct
          ? { ok: false, blockers: ['archived_product'] }
          : await loadCustomerOpenContractForPackage(supabaseAdmin, row.product_id);
        const decision = retiredProduct
          ? buildBlogProductEvidenceArchivedProductDecision({ meta: row.meta, checkedAt: now, productStatus })
          : buildBlogProductEvidenceRecheckDecision({
              meta: row.meta,
              contractOk: contract.ok,
              blockers: contract.blockers,
              checkedAt: now,
            });
        const dedupKey = readBlogProductEvidenceDedupKey({ product_id: row.product_id, meta: decision.meta });
        const duplicateKeepId = dedupKey
          ? productDedupKeys.get(dedupKey) ?? requeuedProductKeys.get(dedupKey) ?? null
          : null;

        if (decision.action === 'requeue' && duplicateKeepId) {
          const meta = buildBlogProductEvidenceDuplicateMeta({
            meta: decision.meta,
            checkedAt: now,
            duplicateKey: dedupKey,
            duplicateKeepId,
          });
          const { error: updateError } = await supabaseAdmin
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
          if (updateError) errors.push(updateError.message);
          else skipped += 1;
        } else if (decision.action === 'requeue') {
          const { error: updateError } = await supabaseAdmin
            .from('blog_topic_queue')
            .update({
              status: 'queued',
              attempts: 0,
              last_error: null,
              target_publish_at: now,
              updated_at: now,
              priority: Math.max(Number(row.priority ?? 0), 85),
              meta: {
                ...decision.meta,
                recovered_by: opts?.recoveredBy ?? 'blog-publisher-recoverable-preflight',
              },
            } as never)
            .eq('id', row.id)
            .eq('status', 'failed');
          if (updateError) errors.push(updateError.message);
          else {
            requeued += 1;
            if (dedupKey) requeuedProductKeys.set(dedupKey, row.id);
          }
        } else if (decision.action === 'skip_archived_product') {
          const { error: updateError } = await supabaseAdmin
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
          if (updateError) errors.push(updateError.message);
          else skipped += 1;
        } else {
          keptBlocked += 1;
        }
        continue;
      }

      if (getBlogQueueOperationalState(asOperationalRow(row)).action !== 'editorial_backlog') continue;
      const dedupKey = readBlogEditorialBacklogDedupKey(row);
      const decision = buildBlogEditorialBacklogRecheckDecision({
        row,
        checkedAt: now,
        activeDuplicateId: dedupKey ? editorialDedupKeys.get(dedupKey) : null,
        alreadyRequeuedId: dedupKey ? requeuedEditorialKeys.get(dedupKey) : null,
      });

      if (decision.action === 'requeue') {
        const { error: updateError } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'queued',
            attempts: 0,
            last_error: null,
            target_publish_at: now,
            updated_at: now,
            priority: Math.max(Number(row.priority ?? 0), 80),
            meta: {
              ...decision.meta,
              recovered_by: opts?.recoveredBy ?? 'blog-publisher-recoverable-preflight',
            },
          } as never)
          .eq('id', row.id)
          .eq('status', 'failed');
        if (updateError) errors.push(updateError.message);
        else {
          requeued += 1;
          if (dedupKey) requeuedEditorialKeys.set(dedupKey, row.id);
        }
      } else if (decision.action === 'skip_duplicate' || decision.action === 'retire_legacy_seed') {
        const { error: updateError } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'skipped',
            attempts: Math.max(Number(row.attempts ?? 0), decision.action === 'retire_legacy_seed' ? 3 : 2),
            last_error: decision.last_error,
            updated_at: now,
            meta: decision.meta,
          } as never)
          .eq('id', row.id)
          .eq('status', 'failed');
        if (updateError) errors.push(updateError.message);
        else skipped += 1;
      } else {
        keptBlocked += 1;
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { scanned: rows.length, requeued, skipped, kept_blocked: keptBlocked, errors };
}

export async function rescheduleOverdueQueuedBlogQueueItems(opts?: {
  limit?: number;
  now?: Date;
  write?: boolean;
  rescheduledBy?: string;
}): Promise<{
  scanned: number;
  rescheduled: number;
  actions: Array<{
    id: string;
    previous_target_publish_at: string | null;
    write: boolean;
    error: string | null;
  }>;
}> {
  if (!isSupabaseConfigured) return { scanned: 0, rescheduled: 0, actions: [] };

  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();
  const write = opts?.write !== false;
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, status, attempts, last_error, created_at, updated_at, target_publish_at, meta')
    .eq('status', 'queued')
    .not('target_publish_at', 'is', null)
    .lt('target_publish_at', nowIso)
    .order('target_publish_at', { ascending: true })
    .limit(opts?.limit ?? 100);

  if (error || !data || data.length === 0) {
    return { scanned: data?.length ?? 0, rescheduled: 0, actions: [] };
  }

  let rescheduled = 0;
  const actions: Array<{
    id: string;
    previous_target_publish_at: string | null;
    write: boolean;
    error: string | null;
  }> = [];

  for (const row of data as Array<BlogQueueOperationalRow & { id: string; meta?: unknown }>) {
    const state = getBlogQueueOperationalState(row, now);
    if (!state.attention) continue;

    const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
      ? row.meta as Record<string, unknown>
      : {};
    let updateError: string | null = null;
    if (write) {
      const { error: rescheduleError } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({
          target_publish_at: nowIso,
          updated_at: nowIso,
          meta: {
            ...meta,
            overdue_queued_rescheduled_at: nowIso,
            overdue_queued_previous_target_publish_at: row.target_publish_at ?? null,
            rescheduled_by: opts?.rescheduledBy ?? 'blog-queue-health-cleanup',
          },
        } as never)
        .eq('id', row.id)
        .eq('status', 'queued');
      updateError = rescheduleError?.message ?? null;
    }

    if (!updateError) rescheduled += 1;
    actions.push({
      id: row.id,
      previous_target_publish_at: row.target_publish_at ?? null,
      write,
      error: updateError,
    });
  }

  return { scanned: data.length, rescheduled, actions };
}
