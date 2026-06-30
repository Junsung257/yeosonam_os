import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { classifyBlogQueueFailure } from '@/lib/blog-queue-failure-policy';
import { loadCustomerOpenContractForPackage } from '@/lib/product-registration/customer-open-contract';

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
    .select('id, attempts, last_error, meta, product_id, source')
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
  }>) {
    let lastError = row.last_error ?? null;
    let forcedReason: string | null = null;
    if (row.product_id) {
      if (!productContractCache.has(row.product_id)) {
        try {
          const contract = await loadCustomerOpenContractForPackage(supabaseAdmin, row.product_id);
          productContractCache.set(
            row.product_id,
            contract.ok ? null : buildProductOpenContractFailure(contract.blockers),
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
    const status = forcedReason ? 'failed' : decision.status;
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
