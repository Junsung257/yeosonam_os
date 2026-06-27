import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { classifyBlogQueueFailure } from '@/lib/blog-queue-failure-policy';

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
  const storedFailureCode = typeof meta.failure_code === 'string' ? meta.failure_code : null;
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

export async function quarantineNonRetryableBlogQueueItems(opts?: {
  limit?: number;
  maxAttempts?: number;
}): Promise<{ scanned: number; quarantined: number; skipped: number; failed: number }> {
  if (!isSupabaseConfigured) return { scanned: 0, quarantined: 0, skipped: 0, failed: 0 };

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, attempts, last_error, meta')
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

  for (const row of data as Array<{ id: string; attempts: number | null; last_error: string | null; meta?: unknown }>) {
    const decision = shouldQuarantineQueuedBlogItem({
      attempts: row.attempts,
      lastError: row.last_error,
      meta: row.meta,
      maxAttempts: opts?.maxAttempts,
    });
    if (!decision.quarantine) continue;

    const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
      ? row.meta as Record<string, unknown>
      : {};
    const { error: updateError } = await supabaseAdmin
      .from('blog_topic_queue')
      .update({
        status: decision.status,
        last_error: row.last_error ?? `publisher preflight quarantine: ${decision.reason ?? 'non_retryable'}`,
        updated_at: now,
        meta: {
          ...meta,
          self_heal_blocked: true,
          quarantine_reason: decision.reason ?? 'publisher_preflight',
          quarantined_by: 'blog-publisher-preflight',
          quarantined_at: now,
        },
      } as never)
      .eq('id', row.id)
      .eq('status', 'queued');

    if (!updateError) {
      quarantined += 1;
      if (decision.status === 'skipped') skipped += 1;
      else failed += 1;
    }
  }

  return { scanned: data.length, quarantined, skipped, failed };
}
