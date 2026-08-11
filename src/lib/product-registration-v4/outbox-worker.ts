import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import { revalidateLandingPagesForPackage } from '@/lib/revalidate-lp-package';

const MAX_ATTEMPTS = 5;

export type ProductRegistrationV5OutboxPayload = {
  package_id: string;
  snapshot_id: string;
  snapshot_hash: string;
  revision_id: string;
};

export type ProductRegistrationV5ConvergenceRow = {
  package_id: string;
  snapshot_id: string;
  snapshot_hash: string;
  surface: 'packages' | 'lp' | 'og' | 'affiliate';
  route: string;
  status: 'pending';
};

type OutboxRow = {
  id: string;
  event_type: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  locked_by?: string | null;
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function parseProductRegistrationV5OutboxPayload(value: unknown): ProductRegistrationV5OutboxPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const packageId = asNonEmptyString(row.package_id);
  const snapshotId = asNonEmptyString(row.snapshot_id);
  const snapshotHash = asNonEmptyString(row.snapshot_hash)?.toLowerCase();
  const revisionId = asNonEmptyString(row.revision_id);
  if (!packageId || !snapshotId || !snapshotHash || !revisionId || !isSha256(snapshotHash)) return null;
  return { package_id: packageId, snapshot_id: snapshotId, snapshot_hash: snapshotHash, revision_id: revisionId };
}

export function buildProductRegistrationV5ConvergenceRows(input: {
  payload: ProductRegistrationV5OutboxPayload;
  shortCode?: string | null;
}): ProductRegistrationV5ConvergenceRow[] {
  const packageRoute = `/packages/${input.payload.package_id}`;
  const lpRoute = `/lp/${input.payload.package_id}`;
  const rows: ProductRegistrationV5ConvergenceRow[] = [
    { package_id: input.payload.package_id, snapshot_id: input.payload.snapshot_id, snapshot_hash: input.payload.snapshot_hash, surface: 'packages', route: packageRoute, status: 'pending' },
    { package_id: input.payload.package_id, snapshot_id: input.payload.snapshot_id, snapshot_hash: input.payload.snapshot_hash, surface: 'lp', route: lpRoute, status: 'pending' },
    { package_id: input.payload.package_id, snapshot_id: input.payload.snapshot_id, snapshot_hash: input.payload.snapshot_hash, surface: 'og', route: `/api/og/affiliate?pkg=${encodeURIComponent(input.payload.package_id)}`, status: 'pending' },
    { package_id: input.payload.package_id, snapshot_id: input.payload.snapshot_id, snapshot_hash: input.payload.snapshot_hash, surface: 'affiliate', route: `/api/og/affiliate?pkg=${encodeURIComponent(input.payload.package_id)}`, status: 'pending' },
  ];
  if (input.shortCode && input.shortCode !== input.payload.package_id) {
    rows.splice(2, 0, { package_id: input.payload.package_id, snapshot_id: input.payload.snapshot_id, snapshot_hash: input.payload.snapshot_hash, surface: 'lp', route: `/lp/${encodeURIComponent(input.shortCode)}`, status: 'pending' });
  }
  return rows;
}

async function claimNextOutboxEvent(input: { supabase: SupabaseClient; workerId: string; aggregateIds?: string[] }): Promise<OutboxRow | null> {
  let candidateQuery = input.supabase
    .from('product_registration_v5_publication_outbox')
    .select('id,event_type,dedupe_key,payload,attempts')
    .in('status', ['pending', 'failed'])
    .lte('available_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(1);
  if (input.aggregateIds && input.aggregateIds.length > 0) candidateQuery = candidateQuery.in('aggregate_id', input.aggregateIds);
  const { data: candidate, error: candidateError } = await candidateQuery.maybeSingle();
  if (candidateError || !candidate) return null;

  const { data: claimed, error: claimError } = await input.supabase
    .from('product_registration_v5_publication_outbox')
    .update({
      status: 'processing',
      locked_at: new Date().toISOString(),
      locked_by: input.workerId,
      attempts: Number(candidate.attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidate.id)
    .in('status', ['pending', 'failed'])
    .select('id,event_type,dedupe_key,payload,attempts,locked_by')
    .maybeSingle();
  if (claimError || !claimed) return null;
  return claimed as OutboxRow;
}

async function markOutboxFailed(input: { supabase: SupabaseClient; event: OutboxRow; workerId: string; error: string }): Promise<void> {
  const attempts = Number(input.event.attempts ?? 1);
  const terminal = attempts >= MAX_ATTEMPTS;
  const retryAt = new Date(Date.now() + Math.min(15 * 60_000, 2 ** Math.min(attempts, 8) * 5_000)).toISOString();
  await input.supabase
    .from('product_registration_v5_publication_outbox')
    .update({
      status: terminal ? 'dead_letter' : 'failed',
      available_at: retryAt,
      locked_at: null,
      locked_by: null,
      last_error: input.error.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.event.id)
    .eq('status', 'processing')
    .eq('locked_by', input.workerId);
}

async function processOutboxEvent(input: { supabase: SupabaseClient; event: OutboxRow; workerId: string }): Promise<{ ok: boolean; reason?: string; packageId?: string }> {
  if (input.event.event_type !== 'package.publication.pointer_committed') {
    await markOutboxFailed({ supabase: input.supabase, event: input.event, workerId: input.workerId, error: `UNSUPPORTED_EVENT:${input.event.event_type}` });
    return { ok: false, reason: 'UNSUPPORTED_EVENT' };
  }
  const payload = parseProductRegistrationV5OutboxPayload(input.event.payload);
  if (!payload) {
    await markOutboxFailed({ supabase: input.supabase, event: input.event, workerId: input.workerId, error: 'OUTBOX_PAYLOAD_INVALID' });
    return { ok: false, reason: 'OUTBOX_PAYLOAD_INVALID' };
  }

  const { data: packageRow } = await input.supabase
    .from('travel_packages')
    .select('short_code')
    .eq('id', payload.package_id)
    .maybeSingle();
  const shortCode = asNonEmptyString((packageRow as { short_code?: unknown } | null)?.short_code);

  let revalidationError: string | null = null;
  try {
    revalidatePath('/packages');
    revalidatePath(`/packages/${payload.package_id}`);
    revalidateLandingPagesForPackage(payload.package_id, shortCode, { throwOnError: true });
  } catch (error) {
    // Cache invalidation is an external side effect. Keep the publication
    // event durable and let the convergence observer verify/retry the actual
    // customer surfaces; a transient Next cache API error must not discard the
    // convergence rows or strand an otherwise committed pointer.
    const detail = error instanceof Error ? error.message : String(error);
    revalidationError = `REVALIDATION_DEFERRED:${detail}`.slice(0, 1000);
  }

  const convergenceRows = buildProductRegistrationV5ConvergenceRows({ payload, shortCode });
  const { error: convergenceError } = await input.supabase
    .from('product_registration_v5_cache_convergence_runs')
    // A duplicate outbox delivery must never reset a converged row back to
    // pending. Failed/stale rows remain observable by the convergence worker.
    .upsert(convergenceRows, { onConflict: 'package_id,snapshot_hash,surface,route', ignoreDuplicates: true });
  if (convergenceError) {
    await markOutboxFailed({ supabase: input.supabase, event: input.event, workerId: input.workerId, error: convergenceError.message });
    return { ok: false, reason: 'CONVERGENCE_WRITE_FAILED', packageId: payload.package_id };
  }

  const { error: deliveredError } = await input.supabase
    .from('product_registration_v5_publication_outbox')
    .update({ status: 'delivered', locked_at: null, locked_by: null, last_error: revalidationError, updated_at: new Date().toISOString() })
    .eq('id', input.event.id)
    .eq('status', 'processing')
    .eq('locked_by', input.workerId);
  if (deliveredError) return { ok: false, reason: deliveredError.message, packageId: payload.package_id };
  return { ok: true, packageId: payload.package_id };
}

export async function processProductRegistrationV5OutboxBatch(input: { supabase: SupabaseClient; limit?: number; workerId?: string; aggregateIds?: string[] }): Promise<Array<{ eventId: string; ok: boolean; reason?: string; packageId?: string }>> {
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 5), 20));
  const workerId = input.workerId ?? `v5-outbox-${randomUUID()}`;
  const results: Array<{ eventId: string; ok: boolean; reason?: string; packageId?: string }> = [];
  for (let index = 0; index < limit; index += 1) {
    const event = await claimNextOutboxEvent({ supabase: input.supabase, workerId, aggregateIds: input.aggregateIds });
    if (!event) break;
    const result = await processOutboxEvent({ supabase: input.supabase, event, workerId });
    results.push({ eventId: event.id, ...result });
  }
  return results;
}
